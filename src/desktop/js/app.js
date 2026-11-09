// Desktop UI entry: navigation, theme, global server status and drag-and-drop.
import { state, subscribe, loadSnapshot, initEvents, api } from './store.js';
import { icon, esc, toast, toastError, h, reportAdded } from './ui.js';
import dashboard from './views/dashboard.js';
import wifi from './views/wifi.js';
import usb from './views/usb.js';
import shared from './views/shared.js';
import received from './views/received.js';
import history from './views/history.js';
import settings from './views/settings.js';
import about from './views/about.js';

const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', view: dashboard },
  { id: 'wifi', label: 'Wi-Fi Sharing', icon: 'wifi', view: wifi },
  { id: 'usb', label: 'USB / Cable', icon: 'usb', view: usb },
  { sep: true },
  { id: 'shared', label: 'Shared Files', icon: 'folder-up', view: shared },
  { id: 'received', label: 'Received Files', icon: 'folder-down', view: received },
  { id: 'history', label: 'Transfer History', icon: 'clock', view: history },
  { sep: true },
  { id: 'settings', label: 'Settings', icon: 'settings', view: settings },
  { id: 'about', label: 'About', icon: 'info', view: about },
];

const nav = document.getElementById('nav');
const content = document.getElementById('content');
const titleEl = document.getElementById('view-title');
const subEl = document.getElementById('view-sub');
const actionsEl = document.getElementById('topbar-actions');
let current = null;
let currentId = null;

function remembered() {
  try { return localStorage.getItem('enishare.view') || 'dashboard'; } catch { return 'dashboard'; }
}

function buildNav() {
  nav.innerHTML = VIEWS.map((v) => (v.sep ? '<div class="nav-sep"></div>'
    : `<button class="nav-item" data-view="${v.id}">${icon(v.icon, 17)}<span>${esc(v.label)}</span><span class="badge hidden" data-badge="${v.id}"></span></button>`)).join('');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) go(b.dataset.view);
  });
}

export function go(id) {
  const entry = VIEWS.find((v) => v.id === id) || VIEWS[0];
  current?.view.unmount?.();
  currentId = entry.id;
  current = entry;
  try { localStorage.setItem('enishare.view', entry.id); } catch { /* */ }
  for (const b of nav.querySelectorAll('[data-view]')) b.classList.toggle('active', b.dataset.view === entry.id);
  titleEl.textContent = entry.label;
  subEl.textContent = entry.view.subtitle || '';
  actionsEl.innerHTML = '';
  content.scrollTop = 0;
  const root = document.createElement('div');
  root.className = 'view';
  content.replaceChildren(root);
  if (!state.ready) {
    root.innerHTML = state.fatal ? fatalHtml() : `<div class="empty">${icon('loader-circle', 28, 'spin')}<div>Starting ENiShare…</div></div>`;
    wireFatal(root);
    return;
  }
  entry.view.mount(root, { actions: actionsEl, go, setSubtitle: (t) => { subEl.textContent = t; } });
}

function fatalHtml() {
  return `<div class="card"><div class="alert err">${icon('circle-exclamation-point', 18)}<div><b>The sharing service could not start</b>${esc(state.fatal.message)}</div></div>
    <div class="row"><button class="btn primary" id="fatal-storage">${icon('folder-open', 16)} Choose another storage folder</button>
    <button class="btn" id="fatal-retry">${icon('rotate-ccw', 16)} Try again</button><button class="btn ghost" id="fatal-logs">Open logs</button></div></div>`;
}

function wireFatal(root) {
  root.querySelector('#fatal-storage')?.addEventListener('click', async () => {
    try { await api.changeStorage(); await loadSnapshot(); go(currentId); } catch (err) { toastError(err); }
  });
  root.querySelector('#fatal-retry')?.addEventListener('click', async () => {
    try { await api.restartServer(); await loadSnapshot(); go(currentId); } catch (err) { toastError(err); }
  });
  root.querySelector('#fatal-logs')?.addEventListener('click', () => api.openLogs());
}

function renderPill() {
  const pill = document.getElementById('server-pill');
  const s = state.server;
  if (!s) { pill.innerHTML = '<span class="dot"></span><span>Starting…</span>'; return; }
  const online = state.stats?.devicesOnline ?? 0;
  pill.innerHTML = s.running
    ? `<span class="dot on"></span><span class="grow ellipsis">Sharing · ${esc(s.address || '')}:${s.port}</span><span class="badge ${online ? 'ok' : ''}" title="Devices online">${icon('smartphone', 12)} ${online}</span>`
    : `<span class="dot ${s.error ? 'err' : ''}"></span><span>${s.error ? 'Not sharing (error)' : 'Not sharing'}</span>`;
  const active = state.transfers.size;
  const badge = nav.querySelector('[data-badge="history"]');
  if (badge) { badge.textContent = active; badge.classList.toggle('hidden', !active); badge.className = `badge info ${active ? '' : 'hidden'}`; }
}

// ---------- theme ----------
const media = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(theme = state.settings?.theme || 'system') {
  const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
  document.documentElement.className = resolved;
}
media.addEventListener('change', () => applyTheme());

// ---------- drag and drop anywhere = share files ----------
function initDragDrop() {
  let depth = 0;
  let overlay = null;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    if (!overlay) { overlay = h(`<div class="drop-overlay"><div class="row">${icon('upload', 26)} Drop to share with your iPhone</div></div>`); document.body.append(overlay); }
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) { overlay?.remove(); overlay = null; } });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0; overlay?.remove(); overlay = null;
    const paths = [...(e.dataTransfer?.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    try {
      const r = await api.call('shared.add', { paths });
      reportAdded(r);
      if (currentId !== 'shared') go('shared');
    } catch (err) { toastError(err, 'Could not share the files'); }
  });
}

// ---------- boot ----------
buildNav();
initEvents();
initDragDrop();
subscribe((what, payload) => {
  if (what === 'settings' || what === 'all') applyTheme();
  if (['server', 'stats', 'all', 'transfers', 'devices'].includes(what)) renderPill();
  if (what === 'all' || what === 'fatal') go(currentId || remembered());
  if (what === 'uploadReceived' && document.hasFocus()) toast({ kind: 'success', title: 'File received', detail: `${payload.name} · ${payload.deviceName}` });
  current?.view.update?.(what, payload);
});
applyTheme();
go(remembered());
loadSnapshot().catch(() => { /* waits for server:ready */ });
