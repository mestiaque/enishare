// ENiShare — Electron main process.
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, Notification, protocol, net, nativeTheme, ipcMain } from 'electron';
import { createLogger } from '../shared/logger.js';
import { readConfig, writeConfig } from './bootstrap-config.js';
import * as updater from './updater.js';
import { createServerHost } from './server-host.js';
import { createMainWindow } from './window-manager.js';
import { registerIpc } from './ipc.js';

const dev = process.argv.includes('--dev') || (!app.isPackaged && process.env.ENISHARE_DEV === '1');
if (dev) process.env.ENISHARE_DEV = '1';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName('ENiShare');
  if (process.platform === 'win32') app.setAppUserModelId('com.mestiaque.enishare');

  // enishare://thumb/<id> and enishare://file/<id> let the desktop UI show thumbnails and
  // previews of shared/received files without exposing file paths or file:// access.
  protocol.registerSchemesAsPrivileged([
    { scheme: 'enishare', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);

  const logsDir = app.getPath('logs');
  const logger = createLogger(logsDir, 'main');
  const version = app.getVersion();
  let mainWindow = null;

  process.on('uncaughtException', (err) => logger.error('uncaught exception (main)', err));
  process.on('unhandledRejection', (err) => logger.error('unhandled rejection (main)', err));

  const send = (name, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('server:event', name, payload);
  };

  let notifySettings = { notifyOnReceive: true, notifyOnConnect: true };
  const host = createServerHost({
    logger, logsDir, version,
    onEvent: (name, payload) => {
      if (name === 'settings:changed') notifySettings = payload;
      if (name === 'upload:received' && notifySettings.notifyOnReceive && Notification.isSupported() && !mainWindow?.isFocused()) {
        new Notification({ title: 'File received', body: `${payload.name} from ${payload.deviceName}`, silent: false }).show();
      }
      if (name === 'devices:changed' && payload?.reason === 'paired' && notifySettings.notifyOnConnect && Notification.isSupported() && !mainWindow?.isFocused()) {
        new Notification({ title: 'Device connected', body: `${payload.device?.name ?? 'A device'} paired with ENiShare` }).show();
      }
      send(name, payload);
    },
  });

  // ---- updates: a quiet check about once a day (only when allowed in Settings) ----
  const DAY = 20 * 3600 * 1000; // a little under a day, so a PC started at the same time each day still checks
  let updateInfo = null;
  let checking = null;
  async function checkForUpdate({ manual = false } = {}) {
    if (checking) return checking;
    checking = (async () => {
      try {
        const { info, note } = await updater.check();
        writeConfig({ lastUpdateCheck: Date.now() });
        updateInfo = info;
        logger.info(`update check: ${info ? `ENiShare ${info.version} available (${info.kind}, installable=${info.installable})` : note || 'up to date'}`);
        if (info) send('update:available', { ...info, manual });
        return { info, message: info ? `ENiShare ${info.version} is available` : note || 'You have the latest version' };
      } catch (err) {
        logger.warn('update check failed', err.message);
        if (manual) throw Object.assign(err, { userMessage: 'Could not check for updates. Are you online?' });
        return { info: null, message: 'Could not check for updates. Are you online?' };
      } finally {
        checking = null;
      }
    })();
    return checking;
  }
  function maybeCheckDaily() {
    if (notifySettings.checkUpdates === false) return;
    if (Date.now() - readConfig().lastUpdateCheck < DAY) return;
    void checkForUpdate();
  }

  ipcMain.handle('update:check', async (e) => {
    if (!e.senderFrame?.url?.startsWith('file://')) return { __error: true, message: 'Not allowed.' };
    try { return await checkForUpdate({ manual: true }); } catch (err) { return { __error: true, code: 'UPDATE_CHECK', message: err.userMessage }; }
  });
  ipcMain.handle('update:state', () => ({ info: updateInfo, version, kind: updater.installKind().kind, lastCheck: readConfig().lastUpdateCheck }));
  ipcMain.handle('update:install', async (e) => {
    if (!e.senderFrame?.url?.startsWith('file://')) return { __error: true, message: 'Not allowed.' };
    try {
      return await updater.install(updateInfo, (p) => send('update:progress', p));
    } catch (err) {
      logger.error('update install failed', err);
      return { __error: true, code: 'UPDATE_INSTALL', message: err.message };
    }
  });
  ipcMain.handle('update:restart', () => { updater.restart(); return true; });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    protocol.handle('enishare', async (req) => {
      try {
        const u = new URL(req.url);
        const id = u.pathname.replace(/^\//, '');
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return new Response('Not found', { status: 404 });
        const p = u.host === 'thumb' ? await host.call('files.thumbPath', { id })
          : u.host === 'file' ? await host.call('files.localPath', { id }) : null;
        if (!p) return new Response('Not found', { status: 404 });
        return net.fetch(pathToFileURL(p).href);
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });

    registerIpc({ host, logger, logsDir, version });
    const { storageRoot } = readConfig();
    logger.info(`ENiShare ${version} starting (storage ${storageRoot})`);
    host.start(storageRoot).then(async () => {
      try {
        const s = await host.call('settings.get');
        notifySettings = s;
        nativeTheme.themeSource = s.theme === 'light' ? 'light' : s.theme === 'system' ? 'system' : 'dark';
        setTimeout(maybeCheckDaily, 8000);
        setInterval(maybeCheckDaily, 3 * 3600 * 1000).unref?.();
      } catch { /* UI will show the error */ }
    }).catch((err) => logger.error('server start failed', err));

    mainWindow = createMainWindow({ dev });
    mainWindow.on('closed', () => { mainWindow = null; });
  });

  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    host.stop().finally(() => app.exit(0));
  });

  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow({ dev });
  });
}
