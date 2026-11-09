// Central app state for the desktop UI, kept up to date by server events.
const api = window.enishare;

export const state = {
  server: null, network: null, settings: null, stats: null, devices: [], transfers: new Map(),
  fatal: null, ready: false, crashed: false,
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify(what, payload) { for (const fn of subs) fn(what, payload); }

let statsTimer = null;
function refreshStatsSoon() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(async () => {
    try { state.stats = await api.call('stats.get'); notify('stats'); } catch { /* server restarting */ }
  }, 300);
}

let devicesTimer = null;
function refreshDevicesSoon() {
  clearTimeout(devicesTimer);
  devicesTimer = setTimeout(async () => {
    try { state.devices = await api.call('devices.list'); notify('devices'); refreshStatsSoon(); } catch { /* */ }
  }, 200);
}

export async function loadSnapshot() {
  const s = await api.call('app.snapshot');
  state.server = s.server;
  state.network = s.network;
  state.settings = s.settings;
  state.stats = s.stats;
  state.devices = s.devices;
  state.transfers = new Map(s.transfers.map((t) => [t.id, t]));
  state.ready = true;
  state.fatal = null;
  state.crashed = false;
  notify('all');
}

export function initEvents() {
  api.onEvent((name, payload) => {
    switch (name) {
      case 'server:ready': loadSnapshot().catch(() => {}); break;
      case 'server:state': state.server = payload; notify('server'); break;
      case 'server:fatal': state.fatal = payload; notify('fatal'); break;
      case 'server:crashed': state.crashed = true; notify('server'); break;
      case 'network:changed': state.network = payload; notify('network'); break;
      case 'settings:changed': state.settings = payload; notify('settings'); break;
      case 'stats:changed': refreshStatsSoon(); break;
      case 'devices:changed': refreshDevicesSoon(); break;
      case 'transfer:progress': state.transfers.set(payload.id, payload); notify('transfers'); break;
      case 'transfer:done':
      case 'transfer:error':
        state.transfers.delete(payload.id); notify('transfers'); notify(`history`); refreshStatsSoon(); break;
      case 'files:shared:changed': notify('shared'); break;
      case 'files:received:changed': notify('received'); break;
      case 'upload:received': notify('uploadReceived', payload); break;
      default:
    }
  });
  // Online status relies on last-seen times, so re-evaluate it periodically.
  setInterval(refreshDevicesSoon, 20_000);
}

export { api };
