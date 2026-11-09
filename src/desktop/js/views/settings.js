import { state, api } from '../store.js';
import { icon, esc, toast, toastError, confirmDialog, checkRow, cmdRow, wireCopyButtons, busy } from '../ui.js';

let root; let ctx; let smb = null;

async function save(patch, okText) {
  try {
    state.settings = await api.call('settings.update', { patch });
    if (okText) toast({ kind: 'success', title: okText, timeout: 1800 });
    return true;
  } catch (err) {
    toastError(err, 'Setting not saved');
    render();
    return false;
  }
}

const toggle = (key, value) => `<label class="switch"><input type="checkbox" data-bool="${key}" ${value ? 'checked' : ''}><span></span></label>`;
const row = (title, hint, control) => `<div class="setting"><div><div>${title}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div><div class="row end">${control}</div></div>`;

function themeCards(current) {
  return `<div class="theme-cards">${[['system', 'System'], ['dark', 'Dark'], ['light', 'Light'], ['glass', 'Glass']].map(([k, l]) =>
    `<button class="theme-card ${current === k ? 'active' : ''}" data-theme="${k}"><div class="sw ${k}"></div><div class="small"><b>${l}</b></div></button>`).join('')}</div>`;
}

function smbHtml() {
  if (!smb) return `<div class="empty">${icon('loader-circle', 22, 'spin')}<div>Checking SMB…</div></div>`;
  if (!smb.supported) return '<div class="muted">SMB sharing is not supported on this system.</div>';
  const url = state.server?.address ? `smb://${state.server.address}` : 'smb://<PC IP address>';
  return `
    <div class="alert info">${icon('info', 18)}<div><b>Optional · Experimental</b>Lets the iPhone <b>Files</b> app browse the ENiShare folder:
      Files → Browse → ⋯ → <b>Connect to Server</b> → <span class="mono selectable">${esc(url)}</span>, then sign in as <b class="selectable">${esc(smb.user)}</b>.
      This uses your computer's own SMB service, not ENiShare's web server.</div></div>
    <div class="checks">${smb.checks.map(checkRow).join('')}</div>
    ${!smb.ready ? `<div class="section-label">One-time setup</div>${smb.setupCommands.map((c) => (/^(sudo|net) /.test(c) ? cmdRow(c) : `<div class="small muted" style="margin:4px 0">• ${esc(c)}</div>`)).join('')}` : ''}
    <div class="row mt">
      ${smb.share ? `<button class="btn danger" id="smb-off">${icon('x', 16)} Remove share</button>` : `<button class="btn primary" id="smb-on">${icon('folder-plus', 16)} Create share "${esc(state.settings.smbShareName)}"</button>`}
      <button class="btn ghost" id="smb-check">${icon('refresh-cw', 16)} Check again</button>
      ${smb.platform === 'win32' && !smb.share ? '<span class="small faint">Windows will ask for administrator permission.</span>' : ''}
    </div>`;
}

async function loadSmb() {
  try { smb = await api.call('smb.status'); } catch (err) { smb = { supported: false }; toastError(err, 'SMB check failed'); }
  const box = root?.querySelector('#smb');
  if (box) { box.innerHTML = smbHtml(); wireSmb(); }
}

function wireSmb() {
  const box = root.querySelector('#smb');
  wireCopyButtons(box);
  const on = box.querySelector('#smb-on');
  if (on) on.onclick = busy(on, async () => { smb = await api.call('smb.enable'); box.innerHTML = smbHtml(); wireSmb(); toast({ kind: 'success', title: 'SMB share created' }); });
  const off = box.querySelector('#smb-off');
  if (off) off.onclick = busy(off, async () => { smb = await api.call('smb.disable'); box.innerHTML = smbHtml(); wireSmb(); toast({ kind: 'success', title: 'SMB share removed' }); });
  const check = box.querySelector('#smb-check');
  if (check) check.onclick = busy(check, loadSmb);
}

function render() {
  const s = state.settings;
  if (!s) return;
  root.innerHTML = `
    <div class="card"><h2>${icon('server', 16)} Sharing</h2>
      ${row('Server port', 'Default 8080. Use a number between 1024 and 65535.', `<input class="input" style="width:110px" type="number" min="1024" max="65535" data-num="port" value="${s.port}">`)}
      ${row('Start sharing when ENiShare opens', '', toggle('autoStart', s.autoStart))}
      ${row('Listen on', 'All local networks lets Wi-Fi and the USB hotspot work at the same time. Only connections from private (LAN) addresses are accepted either way.',
        `<select class="input" data-str="bindMode" style="width:240px"><option value="lan" ${s.bindMode === 'lan' ? 'selected' : ''}>All local networks (recommended)</option><option value="selected" ${s.bindMode === 'selected' ? 'selected' : ''}>Only the selected interface</option></select>`)}
      ${row('PC name shown on the iPhone', '', `<input class="input" style="width:240px" data-str="pcName" placeholder="${esc(state.server?.pcName || '')}" value="${esc(s.pcName)}">`)}
      ${row('Network interface &amp; manual IP', 'Choose the adapter or override the IP address.', `<button class="btn" data-go="wifi">${icon('network', 16)} Open Wi-Fi Sharing</button>`)}
    </div>

    <div class="card"><h2>${icon('hard-drive', 16)} Storage</h2>
      ${row('Storage folder', `<span class="mono selectable">${esc(state.server?.storageRoot || '')}</span><br>Received, Shared, Thumbnails, Temp and Database folders live here.`,
        `<button class="btn" id="open-storage">${icon('folder-open', 16)} Open</button><button class="btn" id="change-storage">Change…</button>`)}
      ${row('Copy shared files into the ENiShare folder', 'Off: files are shared from where they are (no extra disk space). On: a copy is made in Shared/.', toggle('copySharedFiles', s.copySharedFiles))}
    </div>

    <div class="card"><h2>${icon('arrow-up-down', 16)} Transfers</h2>
      ${row('Maximum upload size (MB)', 'Larger files from the iPhone are refused. 4096 MB = 4 GB.', `<input class="input" style="width:110px" type="number" min="1" data-num="maxUploadMB" value="${s.maxUploadMB}">`)}
      ${row('Simultaneous transfers per device', 'How many files an iPhone uploads at the same time (1–8).', `<input class="input" style="width:110px" type="number" min="1" max="8" data-num="maxConcurrent" value="${s.maxConcurrent}">`)}
    </div>

    <div class="card"><h2>${icon('shield', 16)} Security</h2>
      ${row('Pairing PIN', 'Lets an iPhone connect by typing the address and a 6-digit PIN instead of scanning the QR code.', toggle('pinEnabled', s.pinEnabled))}
      ${row('PIN', s.pinSet ? 'A PIN is set. Type a new one to change it.' : 'Exactly 6 digits.', `<input class="input" style="width:140px" inputmode="numeric" maxlength="6" placeholder="${s.pinSet ? '••••••' : '6 digits'}" id="pin"><button class="btn" id="pin-save">Save</button>`)}
      ${row('Session length (hours)', 'Paired iPhones must scan again after this time.', `<input class="input" style="width:110px" type="number" min="1" max="720" data-num="sessionHours" value="${s.sessionHours}">`)}
      ${row('QR code lifetime (minutes)', 'Each QR code works once and expires after this time.', `<input class="input" style="width:110px" type="number" min="1" max="60" data-num="pairTokenMinutes" value="${s.pairTokenMinutes}">`)}
      ${row('Paired devices', `${state.devices.length} device(s) paired`, `<button class="btn danger" id="revoke-all" ${state.devices.length ? '' : 'disabled'}>${icon('log-out', 16)} Disconnect all</button>`)}
      <div class="alert" style="margin:12px 0 0">${icon('lock', 18)}<div class="small muted">ENiShare uses plain HTTP on your local network so the iPhone needs no certificate setup. Pairing tokens, session cookies and a per-session security token protect access, and only private network addresses can connect — but anyone able to watch your Wi-Fi traffic could see transferred files. Use trusted networks. Details: docs/SECURITY.md.</div></div>
    </div>

    <div class="card"><h2>${icon('sun', 16)} Appearance</h2>${themeCards(s.theme)}</div>

    <div class="card"><h2>${icon('bell', 16)} Notifications</h2>
      ${row('When a file is received', '', toggle('notifyOnReceive', s.notifyOnReceive))}
      ${row('When a new device pairs', '', toggle('notifyOnConnect', s.notifyOnConnect))}
    </div>

    <div class="card"><h2>${icon('folder-open', 16)} iPhone Files app (SMB)</h2>
      ${row('Share name', 'Letters, digits, - and _ only.', `<input class="input" style="width:180px" data-str="smbShareName" value="${esc(s.smbShareName)}">`)}
      <div id="smb" class="mt">${smbHtml()}</div>
    </div>

    <div class="card"><h2>${icon('file-text', 16)} Logs</h2>
      ${row('Technical logs', 'Useful when reporting a problem.', `<button class="btn" id="open-logs">${icon('folder-open', 16)} Open log folder</button>`)}
    </div>`;

  for (const el of root.querySelectorAll('[data-bool]')) {
    el.onchange = async () => {
      const ok = await save({ [el.dataset.bool]: el.checked });
      if (!ok) el.checked = !el.checked;
    };
  }
  for (const el of root.querySelectorAll('[data-num]')) {
    el.onchange = () => save({ [el.dataset.num]: Number(el.value) }, 'Saved');
  }
  for (const el of root.querySelectorAll('[data-str]')) {
    el.onchange = () => save({ [el.dataset.str]: el.value }, 'Saved').then(() => { if (el.dataset.str === 'smbShareName') loadSmb(); });
  }
  for (const b of root.querySelectorAll('[data-theme]')) {
    b.onclick = async () => { if (await save({ theme: b.dataset.theme })) { await api.setTheme(b.dataset.theme); render(); } };
  }
  for (const a of root.querySelectorAll('[data-go]')) a.onclick = () => ctx.go(a.dataset.go);
  const pinSave = root.querySelector('#pin-save');
  pinSave.onclick = busy(pinSave, async () => {
    const v = root.querySelector('#pin').value.trim();
    if (!/^\d{6}$/.test(v)) throw new Error('The PIN must be exactly 6 digits.');
    if (await save({ pin: v }, 'PIN saved')) root.querySelector('#pin').value = '';
  });
  root.querySelector('#open-storage').onclick = () => api.openStorage('');
  const change = root.querySelector('#change-storage');
  change.onclick = busy(change, async () => {
    if (!(await confirmDialog('Change storage folder?', 'Sharing stops briefly. Files already in the current folder stay there; ENiShare starts with a fresh file list in the new folder.', { okLabel: 'Choose folder' }))) return;
    const r = await api.changeStorage();
    if (r) toast({ kind: 'success', title: 'Storage folder changed', detail: r.storageRoot });
  });
  const revokeAll = root.querySelector('#revoke-all');
  revokeAll.onclick = busy(revokeAll, async () => {
    if (!(await confirmDialog('Disconnect all devices?', 'Every iPhone has to scan the QR code again.', { okLabel: 'Disconnect all', danger: true }))) return;
    state.devices = await api.call('devices.revokeAll');
    render();
  });
  root.querySelector('#open-logs').onclick = () => api.openLogs();
  wireSmb();
}

export default {
  subtitle: 'Changes are saved automatically',
  mount(el, c) { root = el; ctx = c; smb = null; render(); loadSmb(); },
  update(what) {
    if (!root) return;
    if (what === 'settings' || what === 'all') {
      // Do not re-render while the user is typing in a field.
      if (root.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox])')) return;
      render();
    }
  },
  unmount() { root = null; },
};
