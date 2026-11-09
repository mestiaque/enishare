import { api } from '../store.js';
import { icon, esc, fmtBytes, fmtDate, thumbHtml, toast, toastError, confirmDialog, promptDialog, modal, busy, reportAdded } from '../ui.js';

let root; let ctx; let files = []; let query = ''; let kind = 'all'; let sort = { key: 'createdAt', dir: -1 };
const selected = new Set();

const KINDS = [['all', 'All types'], ['image', 'Images'], ['video', 'Videos'], ['pdf', 'PDF'], ['document', 'Documents'], ['sheet', 'Spreadsheets'], ['slides', 'Presentations'], ['audio', 'Audio'], ['archive', 'Archives'], ['other', 'Other']];

async function load() {
  try {
    files = await api.call('shared.list');
    for (const id of [...selected]) if (!files.some((f) => f.id === id)) selected.delete(id);
    if (root) renderTable();
  } catch (err) { toastError(err, 'Could not load shared files'); }
}

function visible() {
  const q = query.toLowerCase();
  return files
    .filter((f) => (kind === 'all' || f.kind === kind) && (!q || f.name.toLowerCase().includes(q)))
    .sort((a, b) => {
      const x = a[sort.key]; const y = b[sort.key];
      return (typeof x === 'string' ? x.localeCompare(y, undefined, { numeric: true }) : x - y) * sort.dir;
    });
}

function header(key, label) {
  const arrow = sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : '';
  return `<th data-sort="${key}">${label}${arrow}</th>`;
}

function renderTable() {
  const list = visible();
  const total = files.reduce((n, f) => n + f.size, 0);
  ctx.setSubtitle(`${files.length} file${files.length === 1 ? '' : 's'} · ${fmtBytes(total)} available to your iPhone`);
  const box = root.querySelector('#list');
  root.querySelector('#remove-sel').disabled = !selected.size;
  root.querySelector('#remove-sel').innerHTML = `${icon('trash', 16)} Remove${selected.size ? ` (${selected.size})` : ''}`;
  if (!files.length) {
    box.innerHTML = `<div class="empty">${icon('folder-up', 32)}<div><b>No shared files yet</b></div><div class="small">Add files or folders, or drag them onto this window. They stay where they are on your PC.</div></div>`;
    return;
  }
  if (!list.length) { box.innerHTML = `<div class="empty">${icon('search', 26)}<div>No files match your search</div></div>`; return; }
  box.innerHTML = `<table class="table"><thead><tr>
      <th class="nosort" style="width:30px"><input type="checkbox" id="sel-all" ${list.every((f) => selected.has(f.id)) ? 'checked' : ''}></th>
      ${header('name', 'Name')}${header('kind', 'Type')}${header('size', 'Size')}${header('createdAt', 'Added')}<th class="nosort">Status</th><th class="nosort"></th></tr></thead>
    <tbody>${list.map((f) => `<tr data-id="${esc(f.id)}" class="${selected.has(f.id) ? 'selected' : ''}">
      <td><input type="checkbox" data-sel="${esc(f.id)}" ${selected.has(f.id) ? 'checked' : ''}></td>
      <td><div class="name-cell">${thumbHtml(f)}<span class="ellipsis selectable" title="${esc(f.name)}">${esc(f.name)}</span>${f.source === 'copied' ? '<span class="badge" title="Copied into the ENiShare Shared folder">copy</span>' : ''}</div></td>
      <td class="muted">${esc(f.kind)}</td>
      <td class="muted">${fmtBytes(f.size)}</td>
      <td class="muted">${esc(fmtDate(f.createdAt))}</td>
      <td>${f.available ? '<span class="badge ok">Available</span>' : '<span class="badge err" title="The file was moved or deleted on this PC">Missing</span>'}</td>
      <td><div class="actions">
        <button class="btn ghost icon-only sm" data-act="preview" title="Preview">${icon('eye', 15)}</button>
        <button class="btn ghost icon-only sm" data-act="rename" title="Rename for iPhone">${icon('pencil', 15)}</button>
        <button class="btn ghost icon-only sm" data-act="show" title="Show in folder">${icon('folder-open', 15)}</button>
        <button class="btn ghost icon-only sm" data-act="remove" title="Stop sharing">${icon('x', 15)}</button>
      </div></td></tr>`).join('')}</tbody></table>`;

  box.querySelector('#sel-all').onchange = (e) => { for (const f of list) e.target.checked ? selected.add(f.id) : selected.delete(f.id); renderTable(); };
  for (const th of box.querySelectorAll('[data-sort]')) {
    th.onclick = () => { sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort ? -sort.dir : 1 }; renderTable(); };
  }
  for (const cb of box.querySelectorAll('[data-sel]')) {
    cb.onchange = () => { cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel); renderTable(); };
  }
  for (const b of box.querySelectorAll('[data-act]')) {
    const id = b.closest('tr').dataset.id;
    const f = files.find((x) => x.id === id);
    b.onclick = busy(b, () => act(b.dataset.act, f));
  }
}

export async function previewFile(f) {
  if (f.kind === 'image' && /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(f.name) && !/\.svg$/i.test(f.name)) {
    await modal({
      title: f.name, wide: true,
      body: `<img class="preview-img" src="enishare://file/${esc(f.id)}" alt="">`,
      actions: [{ label: 'Open with default app', value: 'open' }, { label: 'Close', kind: 'primary', value: null }],
    }).then((v) => (v === 'open' ? api.openFile(f.id) : null));
    return;
  }
  await api.openFile(f.id);
}

async function act(action, f) {
  if (!f) return;
  if (action === 'preview') return previewFile(f);
  if (action === 'show') return api.showFile(f.id);
  if (action === 'rename') {
    const name = await promptDialog('Rename for iPhone', 'The iPhone sees and downloads the file under this name. The file on your PC is not renamed.', f.name);
    if (name == null || name.trim() === '' || name === f.name) return;
    await api.call('shared.rename', { id: f.id, name });
    return load();
  }
  if (action === 'remove') {
    const msg = f.source === 'copied' ? 'The copy in the ENiShare Shared folder will be deleted.' : 'The original file on your PC is not deleted.';
    if (!(await confirmDialog(`Stop sharing "${f.name}"?`, msg, { okLabel: 'Stop sharing' }))) return;
    await api.call('shared.remove', { ids: [f.id] });
    selected.delete(f.id);
  }
}

function render() {
  root.innerHTML = `
    <div class="toolbar">
      <button class="btn primary" id="add-files">${icon('file-plus', 16)} Add files</button>
      <button class="btn" id="add-folder">${icon('folder-plus', 16)} Add folder</button>
      <button class="btn danger" id="remove-sel" disabled>${icon('trash', 16)} Remove</button>
      <div class="spacer"></div>
      <select class="input" id="kind" style="width:150px">${KINDS.map(([k, l]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="search">${icon('search', 16)}<input class="input" id="q" placeholder="Search shared files" value="${esc(query)}"></div>
    </div>
    <div class="dropzone" id="drop">${icon('upload', 22)}<div class="mt-s">Drag files or folders here to share them with your iPhone</div>
      <div class="tiny faint">Files are shared in place (not copied) unless you change this in Settings.</div></div>
    <div class="card" style="padding:6px 12px"><div id="list"></div></div>`;
  const addFiles = root.querySelector('#add-files');
  addFiles.onclick = busy(addFiles, async () => { reportAdded(await api.pickFiles()); });
  const addFolder = root.querySelector('#add-folder');
  addFolder.onclick = busy(addFolder, async () => { reportAdded(await api.pickFolders()); });
  const removeSel = root.querySelector('#remove-sel');
  removeSel.onclick = busy(removeSel, async () => {
    if (!(await confirmDialog(`Stop sharing ${selected.size} file(s)?`, 'Original files on your PC are not deleted. Copies in the ENiShare Shared folder are.', { okLabel: 'Stop sharing' }))) return;
    await api.call('shared.remove', { ids: [...selected] });
    selected.clear();
    toast({ kind: 'success', title: 'Removed from sharing' });
  });
  root.querySelector('#q').oninput = (e) => { query = e.target.value; renderTable(); };
  root.querySelector('#kind').onchange = (e) => { kind = e.target.value; renderTable(); };
  const drop = root.querySelector('#drop');
  drop.addEventListener('dragover', () => drop.classList.add('over'));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', () => drop.classList.remove('over'));
  renderTable();
  load();
}

export default {
  subtitle: 'Files your iPhone can download',
  mount(el, c) { root = el; ctx = c; render(); },
  update(what) { if (root && (what === 'shared' || what === 'all')) load(); },
  unmount() { root = null; },
};
