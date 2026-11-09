import { api } from '../store.js';
import { icon, esc, fmtBytes, fmtDate, thumbHtml, kindIcon, toast, toastError, confirmDialog, busy } from '../ui.js';
import { previewFile } from './shared.js';

let root; let ctx; let files = []; let query = ''; let sortKey = 'date'; let layout = 'grid';
const selected = new Set();

function savedLayout() { try { return localStorage.getItem('enishare.receivedLayout') || 'grid'; } catch { return 'grid'; } }

async function load() {
  try {
    files = await api.call('received.list');
    for (const id of [...selected]) if (!files.some((f) => f.id === id)) selected.delete(id);
    if (root) renderList();
  } catch (err) { toastError(err, 'Could not load received files'); }
}

function visible() {
  const q = query.toLowerCase();
  const list = files.filter((f) => !q || f.name.toLowerCase().includes(q) || (f.deviceName || '').toLowerCase().includes(q));
  const cmp = {
    date: (a, b) => b.createdAt - a.createdAt,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    size: (a, b) => b.size - a.size,
  }[sortKey];
  return list.sort(cmp);
}

function renderList() {
  const list = visible();
  const total = files.reduce((n, f) => n + f.size, 0);
  ctx.setSubtitle(`${files.length} file${files.length === 1 ? '' : 's'} · ${fmtBytes(total)} received from your iPhone`);
  const del = root.querySelector('#delete-sel');
  del.disabled = !selected.size;
  del.innerHTML = `${icon('trash', 16)} Delete${selected.size ? ` (${selected.size})` : ''}`;
  const box = root.querySelector('#list');
  if (!files.length) {
    box.innerHTML = `<div class="card"><div class="empty">${icon('folder-down', 32)}<div><b>Nothing received yet</b></div><div class="small">Photos and documents you upload from the iPhone appear here.</div></div></div>`;
    return;
  }
  if (!list.length) { box.innerHTML = `<div class="card"><div class="empty">${icon('search', 26)}<div>No files match your search</div></div></div>`; return; }

  if (layout === 'grid') {
    box.innerHTML = `<div class="gallery">${list.map((f) => `
      <div class="tile ${selected.has(f.id) ? 'selected' : ''}" data-id="${esc(f.id)}" title="${esc(f.name)}" style="${selected.has(f.id) ? 'border-color:rgb(var(--accent))' : ''}">
        <div class="pic">${f.hasThumb ? `<img src="enishare://thumb/${esc(f.id)}" alt="" loading="lazy">`
          : f.kind === 'image' && /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name) && f.size < 15 * 1024 * 1024 ? `<img src="enishare://file/${esc(f.id)}" alt="" loading="lazy">` : kindIcon(f.kind, 40)}</div>
        <div class="meta"><div class="ellipsis small"><b>${esc(f.name)}</b></div><div class="tiny faint">${fmtBytes(f.size)} · ${esc(fmtDate(f.createdAt))}</div></div>
      </div>`).join('')}</div>`;
    for (const t of box.querySelectorAll('.tile')) {
      const f = files.find((x) => x.id === t.dataset.id);
      t.onclick = (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) { selected.has(f.id) ? selected.delete(f.id) : selected.add(f.id); renderList(); return; }
        void previewFile(f).catch((err) => toastError(err));
      };
      t.oncontextmenu = (e) => { e.preventDefault(); selected.has(f.id) ? selected.delete(f.id) : selected.add(f.id); renderList(); };
    }
    return;
  }

  box.innerHTML = `<div class="card" style="padding:6px 12px"><table class="table"><thead><tr>
    <th class="nosort" style="width:30px"><input type="checkbox" id="sel-all" ${list.every((f) => selected.has(f.id)) ? 'checked' : ''}></th>
    <th class="nosort">Name</th><th class="nosort">From</th><th class="nosort">Size</th><th class="nosort">Received</th><th class="nosort"></th></tr></thead>
    <tbody>${list.map((f) => `<tr data-id="${esc(f.id)}" class="${selected.has(f.id) ? 'selected' : ''}">
      <td><input type="checkbox" data-sel="${esc(f.id)}" ${selected.has(f.id) ? 'checked' : ''}></td>
      <td><div class="name-cell">${thumbHtml(f)}<span class="ellipsis selectable">${esc(f.name)}</span></div></td>
      <td class="muted">${esc(f.deviceName || '—')}</td>
      <td class="muted">${fmtBytes(f.size)}</td>
      <td class="muted">${esc(fmtDate(f.createdAt))}</td>
      <td><div class="actions">
        <button class="btn ghost icon-only sm" data-act="open" title="Open">${icon('external-link', 15)}</button>
        <button class="btn ghost icon-only sm" data-act="show" title="Show in folder">${icon('folder-open', 15)}</button>
        <button class="btn ghost icon-only sm" data-act="delete" title="Delete">${icon('trash', 15)}</button>
      </div></td></tr>`).join('')}</tbody></table></div>`;
  box.querySelector('#sel-all').onchange = (e) => { for (const f of list) e.target.checked ? selected.add(f.id) : selected.delete(f.id); renderList(); };
  for (const cb of box.querySelectorAll('[data-sel]')) cb.onchange = () => { cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel); renderList(); };
  for (const b of box.querySelectorAll('[data-act]')) {
    const f = files.find((x) => x.id === b.closest('tr').dataset.id);
    b.onclick = busy(b, async () => {
      if (b.dataset.act === 'open') return api.openFile(f.id);
      if (b.dataset.act === 'show') return api.showFile(f.id);
      if (await confirmDialog(`Delete "${f.name}"?`, 'The file is permanently deleted from this PC.', { okLabel: 'Delete', danger: true })) {
        await api.call('received.delete', { ids: [f.id] });
      }
    });
  }
}

function render() {
  root.innerHTML = `
    <div class="toolbar">
      <button class="btn" id="open-folder">${icon('folder-open', 16)} Open folder</button>
      <button class="btn danger" id="delete-sel" disabled>${icon('trash', 16)} Delete</button>
      <div class="spacer"></div>
      <div class="tabs"><button data-layout="grid" class="${layout === 'grid' ? 'active' : ''}">${icon('images', 14)}</button><button data-layout="list" class="${layout === 'list' ? 'active' : ''}">${icon('list-checks', 14)}</button></div>
      <select class="input" id="sort" style="width:150px">
        <option value="date" ${sortKey === 'date' ? 'selected' : ''}>Newest first</option>
        <option value="name" ${sortKey === 'name' ? 'selected' : ''}>Name</option>
        <option value="size" ${sortKey === 'size' ? 'selected' : ''}>Largest first</option>
      </select>
      <div class="search">${icon('search', 16)}<input class="input" id="q" placeholder="Search received files" value="${esc(query)}"></div>
    </div>
    ${layout === 'grid' ? '<div class="tiny faint" style="margin:-6px 0 10px">Click to preview · Ctrl+click or right-click to select</div>' : ''}
    <div id="list"></div>`;
  root.querySelector('#open-folder').onclick = () => api.openStorage('Received');
  const del = root.querySelector('#delete-sel');
  del.onclick = busy(del, async () => {
    if (!(await confirmDialog(`Delete ${selected.size} file(s)?`, 'The files are permanently deleted from this PC.', { okLabel: 'Delete', danger: true }))) return;
    await api.call('received.delete', { ids: [...selected] });
    selected.clear();
    toast({ kind: 'success', title: 'Deleted' });
  });
  for (const b of root.querySelectorAll('[data-layout]')) {
    b.onclick = () => { layout = b.dataset.layout; try { localStorage.setItem('enishare.receivedLayout', layout); } catch { /* */ } render(); };
  }
  root.querySelector('#sort').onchange = (e) => { sortKey = e.target.value; renderList(); };
  root.querySelector('#q').oninput = (e) => { query = e.target.value; renderList(); };
  renderList();
  load();
}

export default {
  subtitle: 'Files uploaded from your iPhone',
  mount(el, c) { root = el; ctx = c; layout = savedLayout(); render(); },
  update(what) { if (root && (what === 'received' || what === 'all')) load(); },
  unmount() { root = null; },
};
