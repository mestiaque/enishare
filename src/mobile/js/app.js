// ENiShare mobile client.
import { api, setCsrf } from './api.js';
import { Uploader } from './uploader.js';
import { createPhoneStage } from './stage.js';
import { $, esc, icon, hydrateIcons, fmtBytes, fmtEta, kindOf, kindIcon, toast } from './util.js';

const uploader = new Uploader();
const state = { shared: [], sent: [], query: '', selectMode: false, selected: new Set(), downloads: new Map(), connected: false, pcName: '' };
let stage = null;

// ---------------------------------------------------------------- session
async function init() {
  hydrateIcons();
  try {
    const s = await api('/api/session');
    setCsrf(s.csrfToken);
    $('#pc-name').textContent = `Sharing with “${s.pcName}”`;
    $('#pc-name').title = s.pcName;
    state.pcName = s.pcName;
    uploader.concurrency = s.limits.maxConcurrent;
    uploader.maxBytes = s.limits.maxUploadBytes;
  } catch (err) {
    if (err.status === 401) return goPair();
    banner(err.message, 'err');
  }
  stage = createPhoneStage({ uploader, downloads: state.downloads, pcName: () => state.pcName, connected: () => state.connected });
  stage.update();
  initTabs();
  initUpload();
  initDownloads();
  initSocket();
  await Promise.all([loadShared(), loadSent()]);
}

function goPair() { window.location.replace('/pair'); }
window.addEventListener('enishare:unauthorized', () => {
  banner('This iPhone is no longer paired. Scan the QR code on your PC again.', 'err');
  setTimeout(goPair, 2500);
});

function banner(text, kind = '') {
  const b = $('#banner');
  if (!text) { b.classList.add('hidden'); return; }
  b.className = `notice ${kind}`;
  b.textContent = text;
}

function setConn(on, label) {
  state.connected = on;
  stage?.update();
  const c = $('#conn');
  c.className = `conn ${on ? 'on' : 'off'}`;
  c.innerHTML = `<span class="dot"></span><span>${esc(label)}</span>`;
}

// ---------------------------------------------------------------- tabs
function initTabs() {
  const show = (tab) => {
    for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab);
    $('#tab-send').classList.toggle('hidden', tab !== 'send');
    $('#tab-get').classList.toggle('hidden', tab !== 'get');
    try { sessionStorage.setItem('enishare.tab', tab); } catch { /* */ }
  };
  for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => show(b.dataset.tab);
  let saved = 'send';
  try { saved = sessionStorage.getItem('enishare.tab') || 'send'; } catch { /* */ }
  show(saved);
}

// ---------------------------------------------------------------- upload
function initUpload() {
  for (const id of ['#pick-photos', '#pick-docs', '#pick-any']) {
    const input = $(id);
    input.addEventListener('change', () => {
      const files = [...input.files];
      input.value = ''; // allow picking the same files again later
      if (!files.length) return;
      const added = uploader.add(files);
      const tooBig = added.filter((i) => i.status === 'error').length;
      if (tooBig) toast(`${tooBig} file(s) are larger than the limit set on the PC`, 'err');
    });
  }
  $('#cancel-all').onclick = () => uploader.cancelAll();
  $('#clear-done').onclick = () => uploader.clearFinished();
  uploader.addEventListener('change', () => { renderQueue(); stage?.update(); });
  uploader.addEventListener('progress', (e) => { updateItem(e.detail); stage?.update(); });
  uploader.addEventListener('done', (e) => { loadSent(); if (!uploader.busy) return; toast(`Sent ${e.detail.name}`, 'ok', 1800); });
  uploader.addEventListener('idle', () => {
    const t = uploader.totals();
    if (t.count && t.done === t.count) toast(t.count === 1 ? 'Upload complete' : `All ${t.count} uploads complete`, 'ok');
    else if (t.failed) toast(`${t.failed} upload(s) failed`, 'err');
  });
  window.addEventListener('beforeunload', (e) => {
    if (uploader.busy) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('online', () => uploader.resumeWaiting());
  // iOS suspends background tabs; continue right away when the page is visible again.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) uploader.resumeWaiting(); });
  setInterval(renderOverall, 1000);
}

const STATUS_TEXT = {
  queued: 'Waiting…', starting: 'Starting…', uploading: '', verifying: 'Checking on the PC…', waiting: '',
  done: 'Sent', error: '', cancelled: 'Cancelled',
};

function itemHtml(i) {
  const pct = i.size ? Math.floor((i.status === 'done' ? i.size : i.sent) / i.size * 100) : (i.status === 'done' ? 100 : 0);
  const cls = i.status === 'done' ? 'ok' : i.status === 'error' ? 'err' : i.status === 'waiting' ? 'warn' : '';
  const right = i.status === 'uploading' ? `${fmtBytes(i.speed)}/s` : '';
  const text = i.status === 'error' || i.status === 'waiting' ? i.error || STATUS_TEXT[i.status] : i.status === 'uploading' ? `${fmtBytes(i.sent)} of ${fmtBytes(i.size)}` : STATUS_TEXT[i.status];
  const kind = kindOf(i.name);
  const action = i.status === 'error' ? `<button class="btn sm" data-retry="${i.id}">Retry</button>`
    : ['done', 'cancelled'].includes(i.status) ? '' : `<button class="btn icon-btn ghost" data-cancel="${i.id}" aria-label="Cancel">${icon('x', 18)}</button>`;
  return `<li class="item" data-item="${i.id}">
    <div class="thumb">${i.status === 'done' ? `<span style="color:rgb(var(--success))">${icon('circle-check', 26)}</span>` : kindIcon(kind)}</div>
    <div class="info"><div class="name">${esc(i.name)}</div>
      <div class="progress ${i.status === 'done' ? 'done' : i.status === 'error' ? 'err' : ''}"><i style="width:${pct}%"></i></div>
      <div class="status ${cls}"><span class="ellipsis">${esc(text)}</span><span>${esc(right)}</span></div></div>
    ${action}</li>`;
}

function renderQueue() {
  const list = $('#queue');
  list.innerHTML = uploader.items.slice().reverse().map(itemHtml).join('');
  for (const b of list.querySelectorAll('[data-cancel]')) b.onclick = () => uploader.cancel(uploader.items.find((i) => i.id === Number(b.dataset.cancel)));
  for (const b of list.querySelectorAll('[data-retry]')) b.onclick = () => uploader.retry(uploader.items.find((i) => i.id === Number(b.dataset.retry)));
  renderOverall();
}

function updateItem(i) {
  const li = document.querySelector(`[data-item="${i.id}"]`);
  if (!li) return renderQueue();
  const pct = i.size ? Math.floor((i.sent / i.size) * 100) : 0;
  li.querySelector('.progress i').style.width = `${pct}%`;
  const spans = li.querySelectorAll('.status span');
  spans[0].textContent = `${fmtBytes(i.sent)} of ${fmtBytes(i.size)}`;
  spans[1].textContent = `${fmtBytes(i.speed)}/s`;
}

function renderOverall() {
  const t = uploader.totals();
  const box = $('#overall');
  const live = uploader.items.some((i) => i.status !== 'cancelled');
  box.classList.toggle('hidden', !live);
  if (!live) return;
  const pct = t.total ? Math.floor((t.sent / t.total) * 100) : 100;
  $('#overall-title').textContent = uploader.busy ? `Uploading ${Math.min(t.done + 1, t.count)} of ${t.count}` : `${t.done} of ${t.count} sent`;
  $('#overall-pct').textContent = `${pct}%`;
  $('#overall-bar').style.width = `${pct}%`;
  $('#overall-bar').parentElement.className = `progress ${!uploader.busy && !t.failed ? 'done' : ''}`;
  $('#overall-speed').textContent = uploader.busy && t.speed ? `${fmtBytes(t.speed)}/s · ${fmtEta(t.remaining / t.speed)}` : '';
  $('#overall-left').textContent = uploader.busy ? `${fmtBytes(t.remaining)} left` : '';
  $('#cancel-all').classList.toggle('hidden', !uploader.busy);
}

async function loadSent() {
  try {
    const r = await api('/api/files/received');
    state.sent = r.files;
    renderSent();
  } catch { /* shown via connection state */ }
}

function renderSent() {
  const list = $('#sent');
  if (!state.sent.length) { list.innerHTML = `<li class="empty">${icon('upload', 28)}Nothing sent yet</li>`; return; }
  list.innerHTML = state.sent.slice(0, 100).map((f) => `<li class="item">
    <div class="thumb">${f.hasThumb ? `<img src="/api/files/received/${esc(f.id)}/thumb" alt="" loading="lazy">` : kindIcon(f.kind)}</div>
    <div class="info"><div class="name">${esc(f.name)}</div><div class="meta">${fmtBytes(f.size)} · ${esc(new Date(f.createdAt).toLocaleString())}</div></div>
    <button class="btn icon-btn ghost" data-del="${esc(f.id)}" aria-label="Delete from PC">${icon('trash', 18)}</button></li>`).join('');
  for (const b of list.querySelectorAll('[data-del]')) {
    b.onclick = async () => {
      const f = state.sent.find((x) => x.id === b.dataset.del);
      if (!window.confirm(`Delete "${f.name}" from the PC?`)) return;
      try { await api(`/api/files/received/${f.id}`, { method: 'DELETE' }); toast('Deleted from the PC'); loadSent(); } catch (err) { toast(err.message, 'err'); }
    };
  }
}

// ---------------------------------------------------------------- downloads
function initDownloads() {
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderFiles(); });
  $('#select-mode').onclick = () => {
    state.selectMode = !state.selectMode;
    state.selected.clear();
    $('#select-mode').textContent = state.selectMode ? 'Done' : 'Select';
    renderFiles();
  };
  $('#sel-all').onclick = () => {
    const vis = visibleFiles();
    const all = vis.every((f) => state.selected.has(f.id));
    for (const f of vis) all ? state.selected.delete(f.id) : state.selected.add(f.id);
    renderFiles();
  };
  $('#dl-zip').onclick = () => {
    if (!state.selected.size) return;
    window.location.href = `/api/files/shared-zip?ids=${[...state.selected].join(',')}`;
  };
  $('#dl-each').onclick = async () => {
    const ids = [...state.selected];
    if (ids.length > 1) toast('If Safari asks, allow multiple downloads', '', 4000);
    for (const id of ids) {
      triggerDownload(id);
      await new Promise((r) => setTimeout(r, 1200)); // Safari blocks downloads started too quickly
    }
  };
  $('#viewer-close').onclick = closeViewer;
}

function triggerDownload(id) {
  const a = document.createElement('a');
  a.href = `/api/files/shared/${id}`;
  a.download = state.shared.find((f) => f.id === id)?.name || '';
  document.body.append(a);
  a.click();
  a.remove();
}

async function loadShared() {
  try {
    const r = await api('/api/files/shared');
    state.shared = r.files;
    for (const id of [...state.selected]) if (!state.shared.some((f) => f.id === id)) state.selected.delete(id);
    $('#shared-count').textContent = state.shared.length || '';
    renderFiles();
  } catch (err) {
    if (err.status !== 401) $('#files').innerHTML = `<li class="empty">${esc(err.message)}</li>`;
  }
}

function visibleFiles() {
  const q = state.query.trim().toLowerCase();
  return state.shared.filter((f) => !q || f.name.toLowerCase().includes(q));
}

function fileHtml(f) {
  const sel = state.selected.has(f.id);
  const dl = state.downloads.get(f.id);
  const canView = f.available && (f.kind === 'image' && !/\.(heic|heif|tiff?)$/i.test(f.name) || f.kind === 'pdf' || f.kind === 'video' || f.kind === 'audio' || /\.(txt|csv)$/i.test(f.name));
  const smallImage = f.kind === 'image' && /\.(jpe?g|png|gif|webp)$/i.test(f.name) && f.size < 3 * 1024 * 1024;
  const thumb = f.hasThumb ? `<img src="/api/files/shared/${esc(f.id)}/thumb" alt="" loading="lazy">`
    : smallImage && f.available ? `<img src="/api/files/shared/${esc(f.id)}?inline=1" alt="" loading="lazy">` : kindIcon(f.kind);
  const actions = state.selectMode ? `<span class="check">${sel ? icon('check', 14) : ''}</span>`
    : !f.available ? '<span class="meta">Unavailable</span>'
      : `${canView ? `<button class="btn icon-btn ghost" data-view="${esc(f.id)}" aria-label="Preview">${icon('eye', 20)}</button>` : ''}
         <a class="btn icon-btn primary" href="/api/files/shared/${esc(f.id)}" download="${esc(f.name)}" aria-label="Download">${icon('download', 20)}</a>`;
  return `<li class="item ${sel ? 'selected' : ''}" data-file="${esc(f.id)}">
    <div class="thumb">${thumb}</div>
    <div class="info"><div class="name">${esc(f.name)}</div>
      <div class="meta">${fmtBytes(f.size)} · ${esc(f.kind === 'other' ? (f.name.split('.').pop() || '').toUpperCase() || 'File' : f.kind)}</div>
      ${dl ? `<div class="progress ${dl.status === 'completed' ? 'done' : ''}"><i style="width:${dl.percent}%"></i></div>
        <div class="status ${dl.status === 'completed' ? 'ok' : ''}"><span>${dl.status === 'completed' ? 'Sent to Safari downloads' : `Sending ${dl.percent}%`}</span><span>${dl.status === 'active' ? `${fmtBytes(dl.speed)}/s` : ''}</span></div>` : ''}
    </div>${actions}</li>`;
}

function renderFiles() {
  const list = $('#files');
  const vis = visibleFiles();
  $('#select-bar').classList.toggle('hidden', !state.selectMode);
  $('#sel-count').textContent = `${state.selected.size} selected`;
  $('#dl-zip').disabled = !state.selected.size;
  $('#dl-each').disabled = !state.selected.size;
  if (!state.shared.length) {
    list.innerHTML = `<li class="empty">${icon('folder-up', 30)}No files shared yet.<br>Add files in ENiShare on your PC — they appear here automatically.</li>`;
    return;
  }
  if (!vis.length) { list.innerHTML = `<li class="empty">${icon('search', 26)}No files match</li>`; return; }
  list.innerHTML = vis.map(fileHtml).join('');
  for (const li of list.querySelectorAll('[data-file]')) {
    const f = state.shared.find((x) => x.id === li.dataset.file);
    if (state.selectMode) {
      li.onclick = () => { state.selected.has(f.id) ? state.selected.delete(f.id) : state.selected.add(f.id); renderFiles(); };
    }
    const v = li.querySelector('[data-view]');
    if (v) v.onclick = () => openViewer(f);
  }
}

function openViewer(f) {
  if (f.kind === 'image') {
    $('#viewer-name').textContent = f.name;
    $('#viewer-img').src = `/api/files/shared/${f.id}?inline=1`;
    $('#viewer-dl').href = `/api/files/shared/${f.id}`;
    $('#viewer-dl').setAttribute('download', f.name);
    $('#viewer').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    return;
  }
  // PDF, video, audio and text open in Safari's own viewer.
  window.open(`/api/files/shared/${f.id}?inline=1`, '_blank', 'noopener');
}

function closeViewer() {
  $('#viewer').classList.add('hidden');
  $('#viewer-img').removeAttribute('src');
  document.body.style.overflow = '';
}

// ---------------------------------------------------------------- realtime
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; renderFiles(); }, 300);
}

function initSocket() {
  if (typeof window.io !== 'function') { setConn(false, 'Offline'); return; }
  const socket = window.io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
  let heartbeat = null;
  let wasConnected = false;

  socket.on('connect', () => {
    setConn(true, 'Connected');
    banner('');
    heartbeat = setInterval(() => socket.emit('heartbeat'), 20_000);
    if (wasConnected) { loadShared(); loadSent(); uploader.resumeWaiting(); }
    wasConnected = true;
  });
  socket.on('disconnect', () => {
    clearInterval(heartbeat);
    setConn(false, 'Reconnecting');
  });
  socket.on('connect_error', (err) => {
    setConn(false, 'Offline');
    if (err?.message === 'unauthorized') { socket.disconnect(); goPair(); }
  });
  socket.on('server:stopping', () => banner('The PC stopped sharing. This page reconnects automatically when sharing starts again.', 'warn'));
  socket.on('session:revoked', () => { socket.disconnect(); window.dispatchEvent(new CustomEvent('enishare:unauthorized')); });
  socket.on('files:shared:changed', () => loadShared());
  socket.on('files:received:changed', () => loadSent());

  const onTransfer = (t) => {
    if (t.direction !== 'download' || !t.fileId) return;
    state.downloads.set(t.fileId, t);
    scheduleRender();
    stage?.update();
    if (t.status === 'completed' || t.status === 'cancelled' || t.status === 'failed') {
      setTimeout(() => { state.downloads.delete(t.fileId); renderFiles(); stage?.update(); }, 4000);
    }
  };
  socket.on('transfer:progress', onTransfer);
  socket.on('transfer:done', onTransfer);
  socket.on('transfer:error', onTransfer);
}

init();
