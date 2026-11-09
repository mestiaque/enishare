// Desktop UI entry: EN* layout — sidebar with sections and counts, app bar with window
// controls, status bar, theme and accent, Settings as a dialog.
import { state, subscribe, loadSnapshot, initEvents, api } from './store.js';
import { icon, esc, toast, toastError, h, reportAdded, fmtBytes } from './ui.js';
import { openSettings, settingsChanged } from './settings-dialog.js';
import { showUpdateDialog } from './update-dialog.js';
import { transferTotals } from './stage.js';
import { toggleSharing } from './views/common.js';
import dashboard from './views/dashboard.js';
import wifi from './views/wifi.js';
import usb from './views/usb.js';
import shared from './views/shared.js';
import received from './views/received.js';
import history from './views/history.js';

const SECTIONS = [
  { title: 'Sharing', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', view: dashboard },
    { id: 'wifi', label: 'Wi-Fi Sharing', icon: 'wifi', view: wifi },
    { id: 'usb', label: 'USB / Cable', icon: 'usb', view: usb },
  ] },
  { title: 'Files', items: [
    { id: 'shared', label: 'Shared Files', icon: 'folder-up', view: shared },
    { id: 'received', label: 'Received Files', icon: 'folder-down', view: received },
    { id: 'history', label: 'Transfer History', icon: 'clock', view: history },
  ] },
];
const VIEWS = SECTIONS.flatMap((s) => s.items);

const $ = (id) => document.getElementById(id);
const nav = $('nav');
const content = $('content');
let current = null;
let currentId = null;

function remembered() {
  try { return localStorage.getItem('enishare.view') || 'dashboard'; } catch { return 'dashboard'; }
}

// ---------- sidebar ----------
function buildNav() {
  nav.innerHTML = SECTIONS.map((s) => `<div class="nav-section"><div class="nav-label">${esc(s.title)}</div>
    ${s.items.map((v) => `<button class="nav-item" data-view="${v.id}" title="${esc(v.label)}">${icon(v.icon, 16)}<span class="label">${esc(v.label)}</span><span class="nav-count" data-count="${v.id}"></span></button>`).join('')}
  </div>`).join('');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) go(b.dataset.view);
  });
}

function renderCounts() {
  const st = state.stats ?? {};
  const counts = { shared: st.sharedCount, received: st.receivedCount, history: state.transfers.size, dashboard: st.devicesOnline };
  for (const el of nav.querySelectorAll('[data-count]')) {
    const n = counts[el.dataset.count];
    el.textContent = n ? n.toLocaleString() : '';
    el.classList.toggle('accent', (el.dataset.count === 'history' || el.dataset.count === 'dashboard') && n > 0);
  }
}

function applySidebar() {
  const collapsed = Boolean(state.settings?.sidebarCollapsed);
  $('app').classList.toggle('collapsed', collapsed);
  $('toggle-sidebar').title = `${collapsed ? 'Show' : 'Hide'} sidebar (Ctrl+B)`;
}

async function toggleSidebar() {
  try { state.settings = await api.call('settings.update', { patch: { sidebarCollapsed: !state.settings?.sidebarCollapsed } }); applySidebar(); } catch (err) { toastError(err); }
}

// ---------- views ----------
export function go(id) {
  const entry = VIEWS.find((v) => v.id === id) || VIEWS[0];
  current?.view.unmount?.();
  currentId = entry.id;
  current = entry;
  try { localStorage.setItem('enishare.view', entry.id); } catch { /* */ }
  for (const b of nav.querySelectorAll('[data-view]')) b.classList.toggle('active', b.dataset.view === entry.id);
  $('view-title').textContent = entry.label;
  $('view-sub').textContent = entry.view.subtitle || '';
  $('topbar-actions').innerHTML = '';
  content.scrollTop = 0;
  const root = document.createElement('div');
  root.className = 'view';
  content.replaceChildren(root);
  if (!state.ready) {
    root.innerHTML = state.fatal ? fatalHtml() : `<div class="empty">${icon('loader-circle', 28, 'spin')}<div>Starting ENiShare…</div></div>`;
    wireFatal(root);
    return;
  }
  entry.view.mount(root, {
    actions: $('topbar-actions'), go, openSettings,
    setSubtitle: (t) => { $('view-sub').textContent = t; },
  });
  wireSettingsLinks(root);
}

/** Any element with data-settings="<section>" opens the Settings dialog there. */
function wireSettingsLinks(root) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-settings]');
    if (a) { e.preventDefault(); openSettings(a.dataset.settings); }
  });
}

function fatalHtml() {
  return `<div class="card"><div class="alert err">${icon('circle-exclamation-point', 16)}<div><b>The sharing service could not start</b>${esc(state.fatal.message)}</div></div>
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

// ---------- app bar ----------
function renderShareButton() {
  const b = $('share-toggle');
  const running = Boolean(state.server?.running);
  b.className = `btn sm ${running ? '' : 'primary'}`;
  b.innerHTML = `${icon(running ? 'square' : 'play', 14)} ${running ? 'Stop Sharing' : 'Start Sharing'}`;
  b.disabled = !state.ready;
}

const THEMES = [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['glass', 'Glass', 'sparkles'], ['system', 'System', 'monitor']];
function renderThemeButton() {
  const t = THEMES.find(([id]) => id === (state.settings?.theme || 'dark')) || THEMES[0];
  $('theme-btn').innerHTML = icon(t[2], 16);
  $('theme-btn').title = `Theme: ${t[1]}`;
}

function openThemeMenu() {
  document.querySelector('.menu-pop')?.remove();
  const btn = $('theme-btn');
  const r = btn.getBoundingClientRect();
  const menu = h(`<div class="menu-pop" role="menu" style="top:${r.bottom + 6}px;right:${window.innerWidth - r.right}px">
    ${THEMES.map(([id, label, ic]) => `<button data-theme="${id}">${icon(ic, 15)} ${label}${state.settings?.theme === id ? `<span class="check">${icon('check', 14)}</span>` : ''}</button>`).join('')}
  </div>`);
  const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); };
  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-theme]');
    if (!b) return;
    close();
    try {
      state.settings = await api.call('settings.update', { patch: { theme: b.dataset.theme } });
      await api.setTheme(b.dataset.theme);
      applyTheme();
      renderThemeButton();
    } catch (err) { toastError(err); }
  });
  document.addEventListener('mousedown', outside, true);
  document.body.append(menu);
}

function initWindowControls() {
  const w = api.window;
  $('win-min').onclick = () => w.minimize();
  $('win-max').onclick = () => w.toggleMaximize();
  $('win-close').onclick = () => w.close();
  $('appbar').addEventListener('dblclick', (e) => { if (!e.target.closest('button,input,select')) w.toggleMaximize(); });
  const setMax = (m) => {
    $('win-max').innerHTML = icon(m ? 'copy' : 'square', m ? 12 : 12);
    $('win-max').title = m ? 'Restore' : 'Maximize';
  };
  w.isMaximized().then(setMax).catch(() => {});
  w.onState((s) => setMax(s.maximized));
}

// ---------- status bar ----------
function renderStatus() {
  const s = state.server;
  const st = state.stats ?? {};
  const list = [...state.transfers.values()];
  const up = list.filter((t) => t.direction === 'upload' && t.status === 'active').reduce((n, t) => n + (t.speed || 0), 0);
  const down = list.filter((t) => t.direction === 'download' && t.status === 'active').reduce((n, t) => n + (t.speed || 0), 0);
  const sharing = s?.running
    ? `<span class="item"><span class="dot on"></span>Sharing at <span class="fg mono selectable">${esc(s.url || '')}</span></span>`
    : `<span class="item"><span class="dot ${s?.error ? 'err' : ''}"></span>${s?.error ? 'Not sharing — see Dashboard' : 'Not sharing'}</span>`;
  $('statusbar').innerHTML = `${sharing}
    <span class="item">${(st.devicesOnline ?? 0).toLocaleString()} of ${(st.devicesPaired ?? 0).toLocaleString()} devices online</span>
    <span class="spacer"></span>
    <span class="item">${list.length ? `${list.length} active transfer${list.length === 1 ? '' : 's'}` : 'No active transfers'}</span>
    <span class="item fg">${icon('arrow-down', 12)} ${fmtBytes(up)}/s</span>
    <span class="item fg">${icon('arrow-up', 12)} ${fmtBytes(down)}/s</span>`;
}

// ---------- iTunes-style progress under the app bar ----------
// iPhone → PC fills from the right, PC → iPhone from the left.
function renderXferBar() {
  const t = transferTotals();
  const bar = $('xfer-bar');
  const [out, inn] = bar.querySelectorAll('i');
  const set = (el, s) => {
    el.style.width = s.count ? `${Math.max(2, s.percent)}%` : '0';
    el.classList.toggle('paused', s.count > 0 && s.names.length === 0);
  };
  set(out, t.out);
  set(inn, t.in);
  bar.classList.toggle('show', t.in.count + t.out.count > 0);
  const parts = [];
  if (t.in.count) parts.push(`iPhone → PC ${Math.floor(t.in.percent)}%`);
  if (t.out.count) parts.push(`PC → iPhone ${Math.floor(t.out.percent)}%`);
  $('appbar').title = parts.join(' · ');
}

// ---------- theme, accent, motion ----------
const media = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const s = state.settings ?? {};
  const theme = s.theme || 'dark';
  const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
  const root = document.documentElement;
  root.classList.remove('dark', 'light', 'glass');
  root.classList.add(resolved);
  root.classList.toggle('reduce-motion', s.animations === false);
  const hex = /^#([0-9a-f]{6})$/i.exec(s.accent || '#3b82f6');
  if (hex) {
    const n = parseInt(hex[1], 16);
    root.style.setProperty('--accent', `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`);
  }
}
media.addEventListener('change', applyTheme);

// ---------- drag and drop anywhere = share files ----------
function initDragDrop() {
  let depth = 0;
  let overlay = null;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    if (!overlay) { overlay = h(`<div class="drop-overlay"><div class="row">${icon('upload', 24)} Drop to share with your iPhone</div></div>`); document.body.append(overlay); }
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) { overlay?.remove(); overlay = null; } });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0; overlay?.remove(); overlay = null;
    const paths = [...(e.dataTransfer?.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    try {
      reportAdded(await api.call('shared.add', { paths }));
      if (currentId !== 'shared') go('shared');
    } catch (err) { toastError(err, 'Could not share the files'); }
  });
}

// ---------- boot ----------
buildNav();
initEvents();
initDragDrop();
initWindowControls();
$('toggle-sidebar').onclick = toggleSidebar;
$('settings-btn').onclick = () => openSettings();
$('theme-btn').onclick = openThemeMenu;
$('share-toggle').onclick = (e) => toggleSharing(e.currentTarget);
window.addEventListener('enishare:go', (e) => go(e.detail));
// Update found by the daily background check: a toast with an Update button (like the other EN* apps).
api.onEvent(async (name, info) => {
  if (name !== 'update:available' || info?.manual) return;
  const { version } = await api.update.state().catch(() => ({ version: '' }));
  toast({ kind: 'info', title: `ENiShare ${info.version} is available`, timeout: 30000, action: { label: 'Update', run: () => showUpdateDialog(info, version) } });
});
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === 'b') { e.preventDefault(); void toggleSidebar(); }
  if (e.key === ',') { e.preventDefault(); openSettings(); }
});
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 16);

subscribe((what, payload) => {
  if (what === 'settings' || what === 'all') { applyTheme(); applySidebar(); renderThemeButton(); settingsChanged(); }
  if (['server', 'all'].includes(what)) renderShareButton();
  if (['server', 'stats', 'all', 'transfers', 'devices'].includes(what)) { renderStatus(); renderCounts(); }
  if (what === 'transfers' || what === 'all') renderXferBar();
  if (what === 'all' || what === 'fatal') go(currentId || remembered());
  if (what === 'uploadReceived' && document.hasFocus()) toast({ kind: 'success', title: 'File received', detail: `${payload.name} · ${payload.deviceName}` });
  current?.view.update?.(what, payload);
});
applyTheme();
renderShareButton();
renderThemeButton();
renderStatus();
go(remembered());
loadSnapshot().catch(() => { /* waits for server:ready */ });
