// IPC handlers for the desktop UI. Every channel is explicit; server methods are allow-listed.
import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, dialog, shell, clipboard, nativeTheme, BrowserWindow } from 'electron';
import { writeConfig } from './bootstrap-config.js';
import { isAllowedExternal } from './window-manager.js';

const SERVER_METHODS = new Set([
  'app.snapshot', 'server.start', 'server.stop', 'server.state', 'server.qr', 'pairing.refresh',
  'network.refresh', 'network.diagnostics', 'settings.get', 'settings.update', 'stats.get',
  'devices.list', 'devices.revoke', 'devices.revokeAll', 'shared.add', 'shared.list', 'shared.remove', 'shared.rename',
  'received.list', 'received.delete', 'transfers.active', 'transfers.history', 'transfers.clear',
  'usb.status', 'smb.status', 'smb.enable', 'smb.disable',
]);

function wrap(fn, logger) {
  return async (event, ...args) => {
    // Only our own window (loaded from file://) may call in.
    if (!event.senderFrame?.url?.startsWith('file://')) return { __error: true, code: 'FORBIDDEN', message: 'Not allowed.' };
    try {
      return await fn(event, ...args);
    } catch (err) {
      if (!err.userMessage) logger.error('IPC handler failed', err);
      return { __error: true, code: err.code || 'INTERNAL', message: err.userMessage || 'Something went wrong. See the log for details.' };
    }
  };
}

export function registerIpc({ host, logger, logsDir, version }) {
  const handle = (ch, fn) => ipcMain.handle(ch, wrap(fn, logger));
  const win = (e) => BrowserWindow.fromWebContents(e.sender);

  handle('server:call', (_e, method, params) => {
    if (!SERVER_METHODS.has(method)) throw Object.assign(new Error('blocked'), { code: 'FORBIDDEN', userMessage: 'Not allowed.' });
    return host.call(method, params);
  });

  handle('server:restart', async () => { await host.restart(); return true; });

  handle('dialog:pickFiles', async (e) => {
    const r = await dialog.showOpenDialog(win(e), { title: 'Share files with your iPhone', properties: ['openFile', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return null;
    return host.call('shared.add', { paths: r.filePaths });
  });

  handle('dialog:pickFolders', async (e) => {
    const r = await dialog.showOpenDialog(win(e), { title: 'Share a folder with your iPhone', properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return null;
    return host.call('shared.add', { paths: r.filePaths });
  });

  handle('storage:change', async (e) => {
    const r = await dialog.showOpenDialog(win(e), { title: 'Choose where ENiShare keeps its files', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths.length) return null;
    let root = r.filePaths[0];
    if (path.basename(root) !== 'ENiShare') root = path.join(root, 'ENiShare');
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.accessSync(root, fs.constants.W_OK);
    } catch {
      throw Object.assign(new Error('not writable'), { code: 'STORAGE_NOT_WRITABLE', userMessage: `ENiShare cannot write to ${root}. Choose another folder.` });
    }
    const old = host.storageRoot;
    writeConfig({ storageRoot: root });
    await host.restart(root);
    logger.info(`storage moved from ${old} to ${root}`);
    return { storageRoot: root, previous: old };
  });

  handle('shell:openFile', async (_e, id) => {
    const p = await host.call('files.localPath', { id });
    const err = await shell.openPath(p);
    if (err) throw Object.assign(new Error(err), { userMessage: `No app could open this file (${err}).` });
    return true;
  });

  handle('shell:showFile', async (_e, id) => {
    shell.showItemInFolder(await host.call('files.localPath', { id }));
    return true;
  });

  handle('shell:openStorage', async (_e, sub) => {
    const allowed = ['Received', 'Shared', ''];
    const target = path.join(host.storageRoot, allowed.includes(sub) ? sub : '');
    fs.mkdirSync(target, { recursive: true });
    await shell.openPath(target);
    return true;
  });

  handle('shell:openLogs', async () => { await shell.openPath(logsDir); return true; });

  handle('shell:openExternal', async (_e, url) => {
    if (!isAllowedExternal(String(url))) throw Object.assign(new Error('blocked'), { userMessage: 'Link blocked.' });
    await shell.openExternal(url);
    return true;
  });

  handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text).slice(0, 2000)); return true; });

  handle('theme:set', (_e, theme) => {
    nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark';
    return nativeTheme.shouldUseDarkColors;
  });

  handle('app:info', () => ({
    version, electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
    platform: process.platform, arch: process.arch, logsDir, storageRoot: host.storageRoot, userData: app.getPath('userData'),
    dark: nativeTheme.shouldUseDarkColors,
  }));
}
