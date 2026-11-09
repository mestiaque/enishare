// IPC handlers for the desktop UI. Every channel is explicit; server methods are allow-listed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, ipcMain, dialog, shell, clipboard, nativeTheme, BrowserWindow } from 'electron';
import { writeConfig } from './bootstrap-config.js';
import { isAllowedExternal } from './window-manager.js';

const SERVER_METHODS = new Set([
  'app.snapshot', 'settings.reset', 'server.start', 'server.stop', 'server.state', 'server.qr', 'pairing.refresh',
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

  // ---- frameless window controls
  handle('window:minimize', (e) => { win(e)?.minimize(); return true; });
  handle('window:toggleMaximize', (e) => {
    const w = win(e);
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
    return w.isMaximized();
  });
  handle('window:close', (e) => { win(e)?.close(); return true; });
  handle('window:isMaximized', (e) => Boolean(win(e)?.isMaximized()));

  // ---- logs and diagnostics
  handle('logs:read', (_e, lines = 400) => {
    const out = [];
    for (const name of ['main.log', 'server.log']) {
      try {
        const text = fs.readFileSync(path.join(logsDir, name), 'utf8');
        out.push(...text.trimEnd().split('\n').slice(-Math.min(2000, Number(lines) || 400)).map((l) => `[${name.replace('.log', '')}] ${l}`));
      } catch { /* no log yet */ }
    }
    // Both files start each line with an ISO time stamp after the prefix: sort by it.
    return out.sort((a, b) => a.replace(/^\[\w+\] /, '').localeCompare(b.replace(/^\[\w+\] /, ''))).slice(-(Number(lines) || 400)).join('\n');
  });

  handle('app:diagnostics', async () => {
    const [state, net, settings, stats] = await Promise.all([
      host.call('server.state').catch(() => null), host.call('network.refresh').catch(() => null),
      host.call('settings.get').catch(() => null), host.call('stats.get').catch(() => null),
    ]);
    if (settings) delete settings.pin;
    return [
      `ENiShare ${version} · Electron ${process.versions.electron} · Node ${process.versions.node} · Chrome ${process.versions.chrome}`,
      `System: ${process.platform} ${process.arch} ${os.release()}`,
      `Server: ${state ? `${state.running ? 'running' : 'stopped'} on ${state.address ?? '-'}:${state.port}${state.error ? ` (error ${state.error.code})` : ''}` : 'unavailable'}`,
      `Interfaces: ${net ? net.interfaces.map((i) => `${i.name}=${i.address} (${i.kind})`).join(', ') || 'none' : '-'}`,
      `Selection: ${net ? JSON.stringify(net.selection) : '-'}`,
      `Stats: ${stats ? JSON.stringify(stats) : '-'}`,
      `Settings: ${settings ? JSON.stringify(settings) : '-'}`,
    ].join('\n');
  });

  // ---- settings file
  handle('settings:export', async (e) => {
    const r = await dialog.showSaveDialog(win(e), { title: 'Export ENiShare settings', defaultPath: 'enishare-settings.json', filters: [{ name: 'Settings', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(await host.call('settings.export'), null, 2));
    return r.filePath;
  });
  handle('settings:import', async (e) => {
    const r = await dialog.showOpenDialog(win(e), { title: 'Import ENiShare settings', properties: ['openFile'], filters: [{ name: 'Settings', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    let data;
    try { data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch {
      throw Object.assign(new Error('bad file'), { userMessage: 'This file is not a valid settings file.' });
    }
    return host.call('settings.import', { data });
  });

  handle('app:info', () => ({
    version, electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
    platform: process.platform, arch: process.arch, logsDir, storageRoot: host.storageRoot, userData: app.getPath('userData'),
    dark: nativeTheme.shouldUseDarkColors,
  }));
}
