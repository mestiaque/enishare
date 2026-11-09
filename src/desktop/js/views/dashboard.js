import { state } from '../store.js';
import { icon, esc, fmtBytes } from '../ui.js';
import { activeTransfersHtml, devicesHtml, wireDevices, toggleSharing, WARNINGS } from './common.js';

let root; let ctx;

function render() {
  const s = state.server ?? {};
  const st = state.stats ?? {};
  const warning = state.network?.selection?.warning;
  root.innerHTML = `
    ${s.error ? `<div class="alert err">${icon('circle-exclamation-point', 18)}<div><b>Sharing could not start</b>${esc(s.error.message)}${s.error.suggestion ? ` Port ${s.error.suggestion} is free — change it in <a data-go="settings">Settings</a>.` : ''}</div></div>` : ''}
    ${state.crashed ? `<div class="alert warn">${icon('triangle-exclamation-point', 18)}<div><b>The sharing service restarted</b>It stopped unexpectedly and was restarted automatically. Details are in the log.</div></div>` : ''}
    ${warning && WARNINGS[warning] ? `<div class="alert warn">${icon('wifi-off', 18)}<div>${esc(WARNINGS[warning])}</div></div>` : ''}
    <div class="card">
      <div class="hero">
        <div class="status-ring ${s.running ? 'on' : ''}">${icon(s.running ? 'wifi' : 'wifi-off', 30)}</div>
        <div class="grow">
          <h2>${s.running ? 'Sharing is on' : 'Sharing is off'}</h2>
          <div class="muted">${s.running
            ? `iPhones on the same network can connect at <b class="selectable mono">${esc(s.url || '')}</b>`
            : 'Start sharing, then scan the QR code with your iPhone camera. No app needed on the iPhone.'}</div>
        </div>
        <div class="row">
          ${s.running ? `<button class="btn lg" data-go="wifi">${icon('qr-code', 18)} Show QR code</button>` : ''}
          <button class="btn lg ${s.running ? 'danger' : 'primary'}" id="toggle">${icon(s.running ? 'square' : 'play', 18)} ${s.running ? 'Stop Sharing' : 'Start Sharing'}</button>
        </div>
      </div>
    </div>
    <div class="grid cols-4 mt">
      ${stat('server', 'Server', s.running ? '<span class="badge ok"><span class="dot on"></span>Running</span>' : '<span class="badge">Stopped</span>')}
      ${stat('network', 'Network IP', `<span class="mono selectable" style="font-size:16px">${esc(s.address || '—')}</span>`)}
      ${stat('hard-drive', 'Port', s.port ?? '—')}
      ${stat('smartphone', 'Devices online', `${st.devicesOnline ?? 0}<span class="small faint"> / ${st.devicesPaired ?? 0} paired</span>`)}
      ${stat('folder-up', 'Files shared', st.sharedCount ?? 0)}
      ${stat('folder-down', 'Files received', st.receivedCount ?? 0)}
      ${stat('activity', 'Total transferred', fmtBytes(st.totalBytes ?? 0))}
      ${stat('arrow-up-down', 'Active transfers', state.transfers.size)}
    </div>
    <div class="grid cols-2 collapse mt">
      <div class="card"><h2>${icon('arrow-up-down', 16)} Active transfers</h2><div id="transfers">${activeTransfersHtml()}</div></div>
      <div class="card"><h2>${icon('smartphone', 16)} Devices</h2><div id="devices">${devicesHtml()}</div></div>
    </div>`;
  root.querySelector('#toggle').onclick = (e) => toggleSharing(e.currentTarget);
  for (const a of root.querySelectorAll('[data-go]')) a.onclick = () => ctx.go(a.dataset.go);
  wireDevices(root);
}

function stat(ic, label, value) {
  return `<div class="card stat"><div class="label">${icon(ic, 14)} ${esc(label)}</div><div class="value">${value}</div></div>`;
}

export default {
  subtitle: 'Overview of sharing, devices and transfers',
  mount(el, c) { root = el; ctx = c; render(); },
  update(what) {
    if (!root) return;
    if (what === 'transfers') {
      const t = root.querySelector('#transfers');
      if (t) t.innerHTML = activeTransfersHtml();
      const values = root.querySelectorAll('.stat .value');
      if (values[7]) values[7].textContent = state.transfers.size;
      return;
    }
    if (['server', 'stats', 'devices', 'network', 'all'].includes(what)) render();
  },
  unmount() { root = null; },
};
