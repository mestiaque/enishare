// Storage layout and the path-safety checks every file access goes through.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { STORAGE_DIRS } from '../../shared/constants.js';
import { AppError } from '../errors.js';

export function createStorage(rootDir) {
  const root = path.resolve(rootDir);
  const dirs = Object.fromEntries(STORAGE_DIRS.map((d) => [d.toLowerCase(), path.join(root, d)]));

  function ensure() {
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
    // Probe write access so a read-only location fails at startup with a clear message.
    const probe = path.join(dirs.temp, `.write-test-${process.pid}`);
    try {
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch (err) {
      throw new AppError('STORAGE_NOT_WRITABLE', `ENiShare cannot write to the storage folder ${root}. Choose another folder in Settings.`, 500, err);
    }
  }

  return { root, dirs, ensure };
}

/** True if `child` is inside `parent` (or equal to it), after resolving `..`. */
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Joins a single file name onto a root directory and refuses anything that could
 * escape it: separators, `..`, absolute paths, NUL bytes.
 */
export function safeJoin(root, name) {
  const n = String(name);
  if (!n || n.includes('\0') || n.includes('/') || n.includes('\\') || n === '.' || n === '..' || path.isAbsolute(n)) {
    throw new AppError('BAD_PATH', 'Invalid file name.', 400);
  }
  const full = path.resolve(root, n);
  if (!isInside(root, full) || path.dirname(full) !== path.resolve(root)) throw new AppError('BAD_PATH', 'Invalid file name.', 400);
  return full;
}

/**
 * Validates that a stored file record still points at an allowed location.
 * Received/copied files must be inside their storage folder (symlinks resolved);
 * linked shared files must be the exact regular file the user picked.
 */
export async function resolveFileRecord(storage, rec) {
  let real;
  try {
    real = await fsp.realpath(rec.file_path);
  } catch (err) {
    if (err.code === 'ENOENT') throw new AppError('FILE_MISSING', 'The file no longer exists on the PC.', 410);
    throw err;
  }
  if (rec.source === 'received' && !isInside(await fsp.realpath(storage.dirs.received), real)) {
    throw new AppError('BAD_PATH', 'File access denied.', 403);
  }
  if (rec.source === 'copied' && !isInside(await fsp.realpath(storage.dirs.shared), real)) {
    throw new AppError('BAD_PATH', 'File access denied.', 403);
  }
  const st = await fsp.stat(real);
  if (!st.isFile()) throw new AppError('BAD_PATH', 'File access denied.', 403);
  return { path: real, stat: st };
}
