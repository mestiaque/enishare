import { icon, hydrateIcons } from '../vendor/icons.js';

export { icon, hydrateIcons };

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function fmtEta(sec) {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${Math.ceil(sec)}s left`;
  if (sec < 3600) return `${Math.round(sec / 60)} min left`;
  return `${(sec / 3600).toFixed(1)} h left`;
}

const IMAGE = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i;
const AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;
export function kindOf(name) {
  if (IMAGE.test(name)) return 'image';
  if (VIDEO.test(name)) return 'video';
  if (AUDIO.test(name)) return 'audio';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.(xlsx?|csv|ods|numbers)$/i.test(name)) return 'sheet';
  if (/\.(pptx?|odp|key)$/i.test(name)) return 'slides';
  if (/\.(docx?|txt|rtf|odt|pages|md)$/i.test(name)) return 'document';
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'archive';
  return 'other';
}

const KIND_ICON = { image: 'file-image', video: 'file-play', audio: 'file-music', pdf: 'file-text', sheet: 'file-spreadsheet', slides: 'presentation', document: 'file-text', archive: 'file-archive', other: 'file' };
export const kindIcon = (kind, size = 24) => `<span class="k-${esc(kind)}">${icon(KIND_ICON[kind] || 'file', size)}</span>`;

export function toast(text, kind = '', ms = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
}
