import { api } from '../store.js';
import { icon, esc, fmtBytes, fmtDate, toastError, confirmDialog, busy } from '../ui.js';
import { activeTransfersHtml } from './common.js';

let root; let ctx; let items = []; let total = 0; let filter = null; const PAGE = 100;

const STATUS = {
  completed: 'ok', failed: 'err', cancelled: '', paused: 'warn', active: 'info', queued: 'info',
};

async function load(append = false) {
  try {
    const r = await api.call('transfers.history', { limit: PAGE, offset: append ? items.length : 0, direction: filter });
    items = append ? items.concat(r.items) : r.items;
    total = r.total;
    if (root) renderTable();
  } catch (err) { toastError(err, 'Could not load the history'); }
}

function duration(t) {
  if (!t.completed_at) return '';
  const s = Math.max(0, Math.round((t.completed_at - t.started_at) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function renderTable() {
  ctx.setSubtitle(`${total} transfer${total === 1 ? '' : 's'} recorded`);
  const box = root.querySelector('#hist');
  if (!items.length) { box.innerHTML = `<div class="empty">${icon('clock', 28)}<div>No transfers yet</div></div>`; return; }
  box.innerHTML = `<table class="table"><thead><tr><th class="nosort"></th><th class="nosort">File</th><th class="nosort">Device</th><th class="nosort">Size</th>
    <th class="nosort">Status</th><th class="nosort">Started</th><th class="nosort">Took</th></tr></thead><tbody>
    ${items.map((t) => `<tr>
      <td title="${t.direction === 'upload' ? 'iPhone → PC' : 'PC → iPhone'}">${icon(t.direction === 'upload' ? 'arrow-down' : 'arrow-up', 16)}</td>
      <td><span class="ellipsis selectable" style="display:block;max-width:340px" title="${esc(t.file_name)}">${esc(t.file_name)}</span></td>
      <td class="muted">${esc(t.device_name || '—')}</td>
      <td class="muted">${t.status === 'completed' ? fmtBytes(t.total_size) : `${fmtBytes(t.transferred_size)} / ${fmtBytes(t.total_size)}`}</td>
      <td><span class="badge ${STATUS[t.status] ?? ''}" title="${esc(t.error || '')}">${esc(t.status)}</span></td>
      <td class="muted">${esc(fmtDate(t.started_at))}</td>
      <td class="muted">${esc(duration(t))}</td></tr>`).join('')}
    </tbody></table>
    ${items.length < total ? `<div class="row end mt-s"><button class="btn sm" id="more">Load more</button></div>` : ''}`;
  const more = box.querySelector('#more');
  if (more) more.onclick = busy(more, () => load(true));
}

function render() {
  root.innerHTML = `
    <div class="card"><h2>${icon('arrow-up-down', 16)} Active transfers</h2><div id="active">${activeTransfersHtml()}</div></div>
    <div class="card">
      <div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">${icon('clock', 16)} History</h2>
        <div class="tabs"><button data-f="" class="${!filter ? 'active' : ''}">All</button><button data-f="upload" class="${filter === 'upload' ? 'active' : ''}">Received</button><button data-f="download" class="${filter === 'download' ? 'active' : ''}">Sent</button></div>
        <button class="btn sm ghost" id="clear">${icon('trash', 14)} Clear finished</button></div>
      <div id="hist"></div>
    </div>`;
  for (const b of root.querySelectorAll('[data-f]')) b.onclick = () => { filter = b.dataset.f || null; render(); };
  const clear = root.querySelector('#clear');
  clear.onclick = busy(clear, async () => {
    if (!(await confirmDialog('Clear transfer history?', 'Finished, failed and cancelled entries are removed. Files are not deleted.', { okLabel: 'Clear' }))) return;
    await api.call('transfers.clear');
    await load();
  });
  load();
}

export default {
  subtitle: '',
  mount(el, c) { root = el; ctx = c; render(); },
  update(what) {
    if (!root) return;
    if (what === 'transfers') { const a = root.querySelector('#active'); if (a) a.innerHTML = activeTransfersHtml(); }
    if (what === 'history') load();
  },
  unmount() { root = null; },
};
