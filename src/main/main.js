// ENiShare — Electron main process.
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, Notification, protocol, net, nativeTheme } from 'electron';
import { createLogger } from '../shared/logger.js';
import { readConfig } from './bootstrap-config.js';
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
