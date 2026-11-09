// Preload (sandboxed, CommonJS). Exposes a small, named API to the desktop UI.
// The renderer never gets ipcRenderer itself, Node.js, or arbitrary channel access.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Set();
ipcRenderer.on('server:event', (_e, name, payload) => {
  for (const fn of listeners) {
    try { fn(name, payload); } catch (err) { console.error(err); }
  }
});

async function invoke(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && r.__error) {
    const err = new Error(r.message);
    err.code = r.code;
    throw err;
  }
  return r;
}

contextBridge.exposeInMainWorld('enishare', {
  /** Calls an allow-listed server method, e.g. call('shared.list'). */
  call: (method, params) => invoke('server:call', method, params ?? {}),
  onEvent: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  pickFiles: () => invoke('dialog:pickFiles'),
  pickFolders: () => invoke('dialog:pickFolders'),
  changeStorage: () => invoke('storage:change'),
  openFile: (id) => invoke('shell:openFile', id),
  showFile: (id) => invoke('shell:showFile', id),
  openStorage: (sub) => invoke('shell:openStorage', sub),
  openLogs: () => invoke('shell:openLogs'),
  openExternal: (url) => invoke('shell:openExternal', url),
  copyText: (text) => invoke('clipboard:write', text),
  setTheme: (theme) => invoke('theme:set', theme),
  appInfo: () => invoke('app:info'),
  restartServer: () => invoke('server:restart'),
  /** Absolute path of a dropped file (drag-and-drop). */
  pathForFile: (file) => webUtils.getPathForFile(file),
});
