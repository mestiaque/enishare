// File-name sanitising and collision-free naming.
import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const MAX_NAME_BYTES = 200;

/**
 * Makes an uploaded or user-supplied name safe on both Windows and Linux.
 * Keeps Unicode (Bangla, emoji, …), removes path separators and control characters.
 */
export function sanitizeFileName(input, fallback = 'file') {
  let name = String(input ?? '').normalize('NFC');
  name = name.replace(/[\u0000-\u001f\u007f]/g, '');
  name = name.replace(/[\\/:*?"<>|]/g, '_');
  name = name.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
  if (!name) name = fallback;
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  return truncateBytes(name, MAX_NAME_BYTES);
}

function truncateBytes(name, max) {
  if (Buffer.byteLength(name) <= max) return name;
  const ext = path.extname(name);
  const keepExt = Buffer.byteLength(ext) < 20 ? ext : '';
  let base = name.slice(0, name.length - keepExt.length);
  while (Buffer.byteLength(base + keepExt) > max) base = Array.from(base).slice(0, -1).join('');
  return base + keepExt;
}

/** Returns `dir/name`, or `dir/name (1).ext`, `(2)` … so that nothing is overwritten. */
export function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    if (i > 9999) throw new Error('Too many files with the same name');
  }
  return candidate;
}

/** RFC 6266 / 5987 Content-Disposition value with a UTF-8 filename. */
export function contentDisposition(type, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
