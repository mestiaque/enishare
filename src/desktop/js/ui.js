// Small UI helpers shared by all desktop views.
import { icon } from '../vendor/icons.js';

export { icon };

/** Escapes text for safe insertion into HTML templates. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export const fmtSpeed = (bps) => (bps ? `${fmtBytes(bps)}/s` : '—');

export function fmtEta(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s left`;
  if (sec < 3600) return `${Math.round(sec / 60)} min left`;
  return `${(sec / 3600).toFixed(1)} h left`;
}

export function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtAgo(ms) {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(ms);
}

const KIND_ICON = {
  image: 'file-image', video: 'file-play', audio: 'file-music', pdf: 'file-text', sheet: 'file-spreadsheet',
  slides: 'presentation', document: 'file-text', archive: 'file-archive', other: 'file',
};
export const kindIcon = (kind, size = 18) => `<span class="k-${esc(kind)}">${icon(KIND_ICON[kind] || 'file', size)}</span>`;

export function thumbHtml(f, size = 18) {
  if (f.hasThumb) return `<div class="thumb"><img src="enishare://thumb/${esc(f.id)}" alt="" loading="lazy"></div>`;
  if (f.kind === 'image' && /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name) && f.size < 15 * 1024 * 1024) {
    return `<div class="thumb"><img src="enishare://file/${esc(f.id)}" alt="" loading="lazy"></div>`;
  }
  return `<div class="thumb">${kindIcon(f.kind, size)}</div>`;
}

// ---------- toasts ----------
export function toast({ kind = 'info', title, detail = '', timeout = 4500 }) {
  const ic = kind === 'error' ? 'circle-exclamation-point' : kind === 'success' ? 'circle-check' : 'info';
  const el = h(`<div class="toast ${kind}">${icon(ic, 18)}<div class="grow"><div><b>${esc(title)}</b></div>${detail ? `<div class="detail">${esc(detail)}</div>` : ''}</div>
    <button class="btn ghost icon-only sm" aria-label="Close">${icon('x', 14)}</button></div>`);
  el.querySelector('button').onclick = () => el.remove();
  document.getElementById('toasts').append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
}

export const toastError = (err, title = 'Something went wrong') => toast({ kind: 'error', title, detail: err?.message || String(err), timeout: 7000 });

// ---------- modals ----------
export function modal({ title, body = '', actions = [], wide = false, onMount }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const back = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3><div class="body"></div><div class="row end"></div></div></div>`);
    const bodyEl = back.querySelector('.body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.append(body);
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    const bar = back.querySelector('.row.end');
    for (const a of actions) {
      const b = h(`<button class="btn ${a.kind || ''}">${esc(a.label)}</button>`);
      b.onclick = () => close(typeof a.value === 'function' ? a.value(bodyEl) : a.value);
      bar.append(b);
    }
    root.append(back);
    onMount?.(bodyEl, close);
    (back.querySelector('input') || bar.lastElementChild)?.focus();
  });
}

export function confirmDialog(title, message, { okLabel = 'OK', danger = false } = {}) {
  return modal({
    title, body: `<p style="margin:0">${esc(message)}</p>`,
    actions: [{ label: 'Cancel', value: false }, { label: okLabel, kind: danger ? 'danger' : 'primary', value: true }],
  });
}

export function promptDialog(title, label, value = '') {
  return modal({
    title,
    body: `<label class="col"><span class="small muted">${esc(label)}</span><input class="input" value="${esc(value)}"></label>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', value: (b) => b.querySelector('input').value }],
    onMount: (b, close) => {
      const input = b.querySelector('input');
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); });
      const dot = value.lastIndexOf('.');
      setTimeout(() => input.setSelectionRange(0, dot > 0 ? dot : value.length), 0);
    },
  });
}

/** Wraps an async button handler: disables the button while running and reports errors. */
export function busy(btn, fn) {
  return async (...args) => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { return await fn(...args); } catch (err) { toastError(err); } finally { btn.disabled = false; }
  };
}

export function checkRow(c) {
  const cls = c.ok ? 'ok' : c.warn ? 'wn' : 'no';
  const ic = c.ok ? 'circle-check' : c.warn ? 'triangle-exclamation-point' : 'circle-x';
  return `<div class="check"><span class="${cls}">${icon(ic, 18)}</span><div><div><b>${esc(c.label)}</b></div><div class="small muted selectable">${esc(c.detail || '')}</div></div></div>`;
}

export function cmdRow(text) {
  return `<div class="cmd"><code class="selectable">${esc(text)}</code><button class="btn ghost icon-only sm" data-copy="${esc(text)}" title="Copy">${icon('copy', 14)}</button></div>`;
}

export function wireCopyButtons(root) {
  for (const b of root.querySelectorAll('[data-copy]')) {
    b.onclick = async () => { await window.enishare.copyText(b.dataset.copy); toast({ kind: 'success', title: 'Copied', timeout: 1500 }); };
  }
}

/** Summarises the result of shared.add in toasts. */
export function reportAdded(r) {
  if (!r) return;
  if (r.added) toast({ kind: 'success', title: `${r.added} file${r.added === 1 ? '' : 's'} shared`, detail: r.skipped ? `${r.skipped} already shared` : '' });
  else if (r.skipped) toast({ kind: 'info', title: 'Already shared', detail: `${r.skipped} file(s) were already in the list` });
  if (r.truncated) toast({ kind: 'info', title: 'Folder limit reached', detail: 'Only the first 5000 files were added.' });
  for (const e of r.errors || []) toast({ kind: 'error', title: `Could not add ${e.file}`, detail: e.message });
}
