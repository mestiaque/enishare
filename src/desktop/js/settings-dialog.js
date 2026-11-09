// Settings dialog — same structure as the other EN* apps: section list on the left,
// rows (label · hint · control) on the right; About and Logs live inside Settings.
import { state, api } from './store.js';
import { showUpdateDialog } from './update-dialog.js';
import { icon, esc, h, modal, toast, toastError, confirmDialog, checkRow, cmdRow, wireCopyButtons, busy } from './ui.js';

const SECTIONS = [
  ['general', 'General'],
  ['sharing', 'Sharing'],
  ['transfers', 'Transfers'],
  ['security', 'Security'],
  ['files', 'Files app (SMB)'],
  ['appearance', 'Appearance'],
  ['logs', 'Logs'],
  ['about', 'About'],
];

export const ACCENTS = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4'];

const THEME_CARDS = [
  { id: 'dark', label: 'Dark', bg: '#131315', side: '#19191c', bar: '#2c2c32', tile: '#222226' },
  { id: 'light', label: 'Light', bg: '#f4f4f6', side: '#fcfcfd', bar: '#dcdce2', tile: '#ffffff' },
  {
    id: 'glass', label: 'Glass',
    bg: 'radial-gradient(circle at 15% 20%, rgba(139,108,255,.9), transparent 55%), radial-gradient(circle at 90% 10%, rgba(226,64,122,.8), transparent 50%), radial-gradient(circle at 70% 95%, rgba(56,189,248,.75), transparent 55%), #1a1530',
    side: 'rgba(255,255,255,.14)', bar: 'rgba(255,255,255,.3)', tile: 'rgba(255,255,255,.18)',
  },
  { id: 'system', label: 'System', bg: 'linear-gradient(135deg, #f4f4f6 50%, #131315 50%)', side: 'rgba(127,127,127,.25)', bar: 'rgba(127,127,127,.4)', tile: 'rgba(127,127,127,.3)' },
];

const FEATURES = [
  ['Wi-Fi sharing (Safari / Chrome on iPhone)', 'Implemented', 'ok'],
  ['QR pairing, optional PIN, sessions', 'Implemented', 'ok'],
  ['Chunked, resumable uploads with checksums', 'Implemented', 'ok'],
  ['Downloads with Range support, ZIP of selection', 'Implemented', 'ok'],
  ['USB via iPhone Personal Hotspot', 'Experimental', 'warn'],
  ['iPhone Files app via SMB (OS SMB service)', 'Experimental', 'warn'],
  ['HEIC thumbnails on the PC', 'Partial', 'warn'],
  ['USB without Personal Hotspot', 'Not supported', 'err'],
];

const LIBRARIES = [
  ['Electron', 'desktop shell', 'MIT'],
  ['Express · Socket.IO', 'local web server, live updates', 'MIT'],
  ['SQLite (node:sqlite)', 'files, devices, history', 'public domain'],
  ['busboy · archiver · file-type', 'uploads, ZIP, type checks', 'MIT'],
  ['qrcode', 'pairing QR codes', 'MIT'],
  ['Lucide', 'icons', 'ISC'],
];

let current = 'general';
let pane = null;
let closeFn = null;
let smb = null;
let appVersion = '';

// ---------- building blocks ----------
const field = (label, hint, control) => `<div class="setting"><div><div>${label}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div><div class="ctl">${control}</div></div>`;
const toggle = (key) => `<label class="switch"><input type="checkbox" data-bool="${key}" ${state.settings[key] ? 'checked' : ''}><span></span></label>`;
const num = (key, min, max, width = 96) => `<input class="input" style="width:${width}px" type="number" min="${min}" ${max ? `max="${max}"` : ''} data-num="${key}" value="${state.settings[key]}">`;

async function save(patch, okText) {
  try {
    state.settings = await api.call('settings.update', { patch });
    if (okText) toast({ kind: 'success', title: okText, timeout: 1600 });
    return true;
  } catch (err) {
    toastError(err, 'Setting not saved');
    render();
    return false;
  }
}

// ---------- sections ----------
function general() {
  return `
    ${field('Start sharing when ENiShare opens', 'iPhones can connect as soon as the app is running', toggle('autoStart'))}
    ${field('Notify when a file is received', 'Shown while ENiShare is in the background', toggle('notifyOnReceive'))}
    ${field('Notify when a new device pairs', '', toggle('notifyOnConnect'))}
    ${field('Check for updates automatically', 'Looks for a new ENiShare release on GitHub once a day. This is the only time ENiShare uses the internet', toggle('checkUpdates'))}
    ${field('Updates', `<span id="u-status">You have version ${esc(appVersion)}</span>`, `<button class="btn sm" id="s-check-update">Check now</button>`)}
    ${field('PC name shown on the iPhone', 'Empty uses the computer name', `<input class="input" style="width:220px" data-str="pcName" placeholder="${esc(state.server?.pcName || '')}" value="${esc(state.settings.pcName)}">`)}
    ${field('Settings file', 'Move your settings to another computer (the PIN is never exported)', `<button class="btn sm" id="s-import">Import…</button><button class="btn sm" id="s-export">Export…</button>`)}
    ${field('Reset all settings', 'Shared files, received files and history are kept', `<button class="btn sm danger" id="s-reset">Reset</button>`)}`;
}

function sharing() {
  const s = state.settings;
  return `
    ${field('Server port', 'Default 8080 (1024–65535). Sharing restarts when you change it', num('port', 1024, 65535))}
    ${field('Listen on', 'All local networks lets Wi-Fi and the USB hotspot work together. Only private (LAN) addresses can connect either way',
      `<select class="input" data-str="bindMode" style="width:230px"><option value="lan" ${s.bindMode === 'lan' ? 'selected' : ''}>All local networks (recommended)</option><option value="selected" ${s.bindMode === 'selected' ? 'selected' : ''}>Only the selected interface</option></select>`)}
    ${field('Network interface and manual IP', 'Choose the adapter used for the QR code, or override the address', `<button class="btn sm" data-go="wifi">${icon('network', 14)} Wi-Fi Sharing</button>`)}
    ${field('Storage folder', `<span class="mono selectable">${esc(state.server?.storageRoot || '')}</span>`, `<button class="btn sm" id="s-open-storage">${icon('folder-open', 14)} Open</button><button class="btn sm" id="s-change-storage">Change…</button>`)}
    ${field('Copy shared files into the ENiShare folder', 'Off: files are shared from where they are, using no extra space', toggle('copySharedFiles'))}`;
}

function transfers() {
  return `
    ${field('Maximum upload size (MB)', 'Larger files from the iPhone are refused. 4096 MB = 4 GB', num('maxUploadMB', 1, 0, 110))}
    ${field('Simultaneous transfers per device', 'How many files one iPhone uploads at the same time (1–8)', num('maxConcurrent', 1, 8))}`;
}

function security() {
  const s = state.settings;
  return `
    ${field('Pairing PIN', 'Lets an iPhone connect by typing the address and a 6-digit PIN instead of scanning the QR code', toggle('pinEnabled'))}
    ${field('PIN', s.pinSet ? 'A PIN is set. Type a new one to change it' : 'Exactly 6 digits', `<input class="input" style="width:120px" inputmode="numeric" maxlength="6" placeholder="${s.pinSet ? '••••••' : '6 digits'}" id="s-pin"><button class="btn sm" id="s-pin-save">Save</button>`)}
    ${field('Session length (hours)', 'Paired iPhones must scan again after this time', num('sessionHours', 1, 720))}
    ${field('QR code lifetime (minutes)', 'Each QR code works once and expires after this time', num('pairTokenMinutes', 1, 60))}
    ${field('Paired devices', `${state.devices.length} device(s) paired`, `<button class="btn sm danger" id="s-revoke-all" ${state.devices.length ? '' : 'disabled'}>${icon('log-out', 14)} Disconnect all</button>`)}
    <div class="alert" style="margin:14px 0 4px">${icon('lock', 16)}<div class="small muted">ENiShare uses plain HTTP on your local network, so the iPhone needs no certificate setup. Single-use pairing codes, session cookies and a per-session security token protect access, and only private network addresses can connect. Someone able to watch your Wi-Fi traffic could still see transferred files, so use trusted networks.</div></div>`;
}

function smbHtml() {
  if (!smb) return `<div class="empty">${icon('loader-circle', 20, 'spin')}<div>Checking SMB…</div></div>`;
  if (!smb.supported) return '<div class="muted" style="padding:12px 0">SMB sharing is not supported on this system.</div>';
  const url = state.server?.address ? `smb://${state.server.address}` : 'smb://<PC IP address>';
  return `
    <div class="alert info" style="margin-top:12px">${icon('info', 16)}<div class="small"><b>Optional · Experimental</b>The iPhone <b>Files</b> app can browse the ENiShare folder: Files → Browse → ⋯ → <b>Connect to Server</b> → <span class="mono selectable">${esc(url)}</span>, then sign in as <b class="selectable">${esc(smb.user)}</b>. This uses your computer's own SMB service.</div></div>
    <div class="checks">${smb.checks.map(checkRow).join('')}</div>
    ${!smb.ready ? `<div class="group-label">One-time setup</div>${smb.setupCommands.map((c) => (/^(sudo|net) /.test(c) ? cmdRow(c) : `<div class="small muted" style="margin:4px 0">• ${esc(c)}</div>`)).join('')}` : ''}
    <div class="row" style="padding:12px 0">
      ${smb.share ? `<button class="btn sm danger" id="smb-off">Remove share</button>` : `<button class="btn sm primary" id="smb-on">Create share "${esc(state.settings.smbShareName)}"</button>`}
      <button class="btn sm ghost" id="smb-check">${icon('refresh-cw', 14)} Check again</button>
      ${smb.platform === 'win32' && !smb.share ? '<span class="tiny faint">Windows asks for administrator permission.</span>' : ''}
    </div>`;
}

function files() {
  return `${field('Share name', 'Letters, digits, - and _ only', `<input class="input" style="width:170px" data-str="smbShareName" value="${esc(state.settings.smbShareName)}">`)}<div id="smb">${smbHtml()}</div>`;
}

function appearance() {
  const s = state.settings;
  const cards = THEME_CARDS.map((t) => `<button class="theme-card ${s.theme === t.id ? 'active' : ''}" data-theme="${t.id}">
      <div class="pv" style="background:${t.bg}"><div class="side" style="background:${t.side}"></div>
        <div class="body"><div class="bar" style="background:${t.bar}"></div><div class="tiles"><i style="background:${t.tile}"></i><i style="background:${t.tile}"></i><i style="background:${t.tile}"></i></div></div></div>
      <div class="name">${t.label}</div></button>`).join('');
  const swatches = ACCENTS.map((c) => `<button class="swatch" data-accent="${c}" aria-label="${c}" style="background:${c};${s.accent === c ? `box-shadow:0 0 0 2px rgb(var(--panel)),0 0 0 4px ${c}` : ''}">${s.accent === c ? icon('check', 14) : ''}</button>`).join('');
  return `
    <div class="theme-block"><div>Theme</div><div class="theme-cards">${cards}</div>
      <div class="tiny faint mt-s">Glass uses frosted, blurred panels over a colour gradient.</div></div>
    ${field('Accent color', '', `<div class="swatches">${swatches}</div>`)}
    ${field('Animations', 'Turn off to reduce motion', toggle('animations'))}`;
}

function logs() {
  return `
    <div class="row" style="padding:12px 0 10px">
      <div class="grow tiny faint">Technical details from the desktop app (main) and the sharing service (server). Session tokens and PINs are never logged.</div>
      <button class="btn sm ghost" id="l-refresh">${icon('refresh-cw', 14)} Refresh</button>
      <button class="btn sm" id="l-open">${icon('folder-open', 14)} Open folder</button>
      <button class="btn sm primary" id="l-copy">${icon('copy', 14)} Copy diagnostics</button>
    </div>
    <pre class="logbox" id="l-text">Loading…</pre>`;
}

function about(info = {}) {
  const row = (label, value, hint) => `<div class="grow-row"><span class="grow">${label}${hint ? `<span class="hint">${hint}</span>` : ''}</span>${value}</div>`;
  return `
    <div class="about-head" style="padding-top:12px">
      <img src="assets/icon.svg" alt="">
      <div><div class="name">ENiShare <span>${esc(info.version || '')}</span></div>
        <div class="muted">Share files between your PC and iPhone — no iPhone app, no cloud.</div>
        <div class="tiny faint" style="margin-top:4px">Scan a QR code, then send photos and documents both ways over Wi-Fi or a USB hotspot.</div></div>
    </div>
    <div class="group-label">This copy</div>
    <div class="group">
      ${row('Version', `<span class="mono muted">${esc(info.version || '')}</span>`)}
      ${row('System', `<span class="muted">${esc(info.platform === 'win32' ? 'Windows' : info.platform === 'linux' ? 'Linux' : info.platform || '')} · ${esc(info.arch || '')}</span>`)}
      ${row('Electron · Node', `<span class="mono muted">${esc(info.electron || '')} · ${esc(info.node || '')}</span>`)}
      ${row('Storage folder', `<button class="btn sm" id="a-storage">${icon('folder-open', 14)} Open</button>`, esc(info.storageRoot || ''))}
      ${row('Logs', `<button class="btn sm" id="a-logs">${icon('folder-open', 14)} Open</button>`, esc(info.logsDir || ''))}
    </div>
    <div class="row end mt-s"><button class="btn sm ghost" id="a-diag">${icon('copy', 14)} Copy diagnostics</button></div>
    <div class="group-label">Privacy</div>
    <div class="group"><div class="grow-row"><span class="muted small">Files go directly between your iPhone and this PC on your local network; nothing is uploaded to any server or cloud. The only internet request is the optional update check (General → Check for updates), which asks GitHub for the latest version number.</span></div></div>
    <div class="group-label">Feature status</div>
    <div class="group">${FEATURES.map(([f, st, c]) => row(esc(f), `<span class="badge ${c}">${esc(st)}</span>`)).join('')}</div>
    <div class="group-label">Developer</div>
    <div class="group">
      ${row('Developed by', '<span class="muted">M. Estiaque Ahmed Khan</span>')}
      ${row('Contact', '<a id="a-mail">info@mestiaque.com</a>', 'Bug reports, ideas and feedback are welcome')}
      ${row('Website', `<a id="a-web" class="row" style="gap:4px">mestiaque.com ${icon('external-link', 12)}</a>`)}
      ${row('Also by the developer', '<span class="muted">ENViewer · ENPlayer · ENSave · ENPost</span>', 'Same look and themes')}
      ${row('Licence', '<span class="muted">© 2026 M. Estiaque Ahmed Khan · MIT</span>')}
    </div>
    <div class="group-label">Built with</div>
    <div class="group">${LIBRARIES.map(([n, w, l]) => `<div class="grow-row small"><span>${esc(n)} <span class="faint">· ${esc(w)}</span></span><span class="faint">${esc(l)}</span></div>`).join('')}</div>
    <div style="height:12px"></div>`;
}

// ---------- rendering and wiring ----------
async function render() {
  if (!pane || !state.settings) return;
  const nav = pane.parentElement.querySelector('.settings-nav');
  for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b.dataset.section === current);
  pane.classList.toggle('fill', current === 'logs');
  let info = {};
  if (current === 'about' || !appVersion) { try { info = await api.appInfo(); appVersion = info.version; } catch { /* */ } }
  pane.innerHTML = { general, sharing, transfers, security, files, appearance, logs, about }[current](info);
  pane.scrollTop = 0;
  wire();
}

function wire() {
  for (const el of pane.querySelectorAll('[data-bool]')) {
    el.onchange = async () => { if (!(await save({ [el.dataset.bool]: el.checked }))) el.checked = !el.checked; };
  }
  for (const el of pane.querySelectorAll('[data-num]')) el.onchange = () => save({ [el.dataset.num]: Number(el.value) }, 'Saved');
  for (const el of pane.querySelectorAll('[data-str]')) {
    el.onchange = () => save({ [el.dataset.str]: el.value }, 'Saved').then(() => { if (el.dataset.str === 'smbShareName') loadSmb(); });
  }
  for (const a of pane.querySelectorAll('[data-go]')) a.onclick = () => { closeFn?.(); window.dispatchEvent(new CustomEvent('enishare:go', { detail: a.dataset.go })); };
  for (const b of pane.querySelectorAll('[data-theme]')) b.onclick = async () => { if (await save({ theme: b.dataset.theme })) { await api.setTheme(b.dataset.theme); render(); } };
  for (const b of pane.querySelectorAll('[data-accent]')) b.onclick = async () => { if (await save({ accent: b.dataset.accent })) render(); };
  wireCopyButtons(pane);
  const on = (id, fn) => { const el = pane.querySelector(id); if (el) el.onclick = busy(el, fn); };

  // General
  on('#s-check-update', async () => {
    const status = pane.querySelector('#u-status');
    status.textContent = 'Checking…';
    try {
      const r = await api.update.check();
      status.textContent = r.message;
      if (r.info) { closeFn?.(); showUpdateDialog(r.info, appVersion); }
    } catch (err) {
      status.textContent = err.message;
      throw err;
    }
  });
  on('#s-export', async () => { const p = await api.exportSettings(); if (p) toast({ kind: 'success', title: 'Settings exported', detail: p }); });
  on('#s-import', async () => { const s = await api.importSettings(); if (s) { state.settings = s; await api.setTheme(s.theme); toast({ kind: 'success', title: 'Settings imported' }); render(); } });
  on('#s-reset', async () => {
    if (!(await confirmDialog('Reset all settings?', 'All settings go back to their defaults. Shared files, received files and history are kept.', { okLabel: 'Reset', danger: true }))) return;
    state.settings = await api.call('settings.reset');
    await api.setTheme(state.settings.theme);
    toast({ kind: 'success', title: 'Settings reset' });
    render();
  });
  // Sharing
  on('#s-open-storage', () => api.openStorage(''));
  on('#s-change-storage', async () => {
    if (!(await confirmDialog('Change storage folder?', 'Sharing stops briefly. Files in the current folder stay there; ENiShare starts with a fresh file list in the new folder.', { okLabel: 'Choose folder' }))) return;
    const r = await api.changeStorage();
    if (r) toast({ kind: 'success', title: 'Storage folder changed', detail: r.storageRoot });
  });
  // Security
  on('#s-pin-save', async () => {
    const v = pane.querySelector('#s-pin').value.trim();
    if (!/^\d{6}$/.test(v)) throw new Error('The PIN must be exactly 6 digits.');
    if (await save({ pin: v }, 'PIN saved')) render();
  });
  on('#s-revoke-all', async () => {
    if (!(await confirmDialog('Disconnect all devices?', 'Every iPhone has to scan the QR code again.', { okLabel: 'Disconnect all', danger: true }))) return;
    state.devices = await api.call('devices.revokeAll');
    render();
  });
  // Files app
  if (current === 'files') { if (!smb) loadSmb(); else wireSmb(); }
  // Logs
  if (current === 'logs') {
    const load = async () => {
      const box = pane.querySelector('#l-text');
      if (!box) return;
      box.textContent = (await api.readLogs(400).catch(() => '')) || 'The log is empty.';
      box.scrollTop = box.scrollHeight;
    };
    void load();
    on('#l-refresh', load);
    on('#l-open', () => api.openLogs());
    on('#l-copy', copyDiagnostics);
  }
  // About
  on('#a-storage', () => api.openStorage(''));
  on('#a-logs', () => api.openLogs());
  on('#a-diag', copyDiagnostics);
  const mail = pane.querySelector('#a-mail');
  if (mail) mail.onclick = () => api.openExternal('mailto:info@mestiaque.com');
  const web = pane.querySelector('#a-web');
  if (web) web.onclick = () => api.openExternal('https://mestiaque.com');
}

async function copyDiagnostics() {
  await api.copyText(await api.diagnostics());
  toast({ kind: 'success', title: 'Diagnostics copied', detail: 'Paste them into your bug report (no PINs or tokens included).' });
}

async function loadSmb() {
  try { smb = await api.call('smb.status'); } catch (err) { smb = { supported: false }; toastError(err, 'SMB check failed'); }
  wireSmb();
}

function wireSmb() {
  const box = pane?.querySelector('#smb');
  if (!box) return;
  box.innerHTML = smbHtml();
  wireCopyButtons(box);
  const b = (id, fn) => { const el = box.querySelector(id); if (el) el.onclick = busy(el, fn); };
  b('#smb-on', async () => { smb = await api.call('smb.enable'); wireSmb(); toast({ kind: 'success', title: 'SMB share created' }); });
  b('#smb-off', async () => { smb = await api.call('smb.disable'); wireSmb(); toast({ kind: 'success', title: 'SMB share removed' }); });
  b('#smb-check', loadSmb);
}

/** Opens the dialog, optionally at a section ("general", "security", "about", …). */
export function openSettings(section) {
  if (section && SECTIONS.some(([id]) => id === section)) current = section;
  if (pane) { render(); return; }
  smb = null;
  const body = h(`<div style="display:contents"><nav class="settings-nav">${SECTIONS.map(([id, label]) => `<button data-section="${id}">${label}</button>`).join('')}</nav><div class="settings-pane"></div></div>`);
  modal({
    title: 'Settings', body, size: 'settings-modal',
    onMount: (bodyEl, close) => {
      closeFn = close;
      pane = bodyEl.querySelector('.settings-pane');
      for (const b of bodyEl.querySelectorAll('.settings-nav button')) b.onclick = () => { current = b.dataset.section; render(); };
      render();
    },
  }).then(() => { pane = null; closeFn = null; });
}

/** Re-render when settings change elsewhere (unless the user is typing in a field). */
export function settingsChanged() {
  if (!pane) return;
  const a = document.activeElement;
  if (pane.contains(a) && a.matches('input:not([type=checkbox]), select')) return;
  if (current === 'logs') return;
  render();
}
