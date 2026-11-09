// Main window: secure defaults, remembered size, navigation locked to the app.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, nativeTheme, screen, shell } from 'electron';
import { readConfig, writeConfig } from './bootstrap-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED_EXTERNAL = [/^https:\/\/mestiaque\.com(\/|$)/, /^mailto:info@mestiaque\.com$/];

export function isAllowedExternal(url) {
  return ALLOWED_EXTERNAL.some((re) => re.test(url));
}

function initialBounds() {
  const saved = readConfig().windowBounds;
  const fallback = { width: 1240, height: 800 };
  if (!saved) return fallback;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width && saved.y < a.y + a.height;
  });
  return visible ? saved : { width: saved.width || fallback.width, height: saved.height || fallback.height };
}

export function createMainWindow({ dev }) {
  const bounds = initialBounds();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 980,
    minHeight: 660,
    show: false,
    frame: false, // own title bar, like the other EN* apps
    title: 'ENiShare',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#131315' : '#f4f4f6',
    autoHideMenuBar: true,
    icon: path.join(here, '..', 'desktop', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: dev,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(here, '..', 'desktop', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Never navigate away from the app; open the two allowed external links in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (isAllowedExternal(url)) void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) writeConfig({ windowBounds: win.getBounds() });
    }, 500);
  };
  win.on('resize', save);
  win.on('move', save);
  const sendState = () => { if (!win.isDestroyed()) win.webContents.send('window:state', { maximized: win.isMaximized() }); };
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  if (dev) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}
