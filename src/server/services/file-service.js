// Shared and received file management.
//
// Shared files are either "linked" (served from where they are; default, no copy, good for
// big videos) or "copied" into Shared/. Only files that the user explicitly added are ever
// reachable over HTTP; they are addressed by random id, never by path.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import mime from 'mime-types';
import { fileKind } from '../../shared/constants.js';
import { randomId } from './ids.js';
import { resolveFileRecord, isInside } from '../storage/paths.js';
import { sanitizeFileName, uniquePath } from '../storage/sanitize.js';
import { AppError, Errors, friendlyFsError } from '../errors.js';

const MAX_FOLDER_FILES = 5000;

export async function hashFile(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

export function createFileService({ repos, storage, settings, thumbnails, events, logger }) {
  const hashQueue = [];
  let hashing = false;
  let registerChain = Promise.resolve();
  let stopped = false;

  function toPublic(rec, { includePath = false } = {}) {
    const out = {
      id: rec.id,
      name: rec.original_name,
      size: rec.file_size,
      mime: rec.mime_type || 'application/octet-stream',
      kind: fileKind(rec.original_name),
      hasThumb: Boolean(rec.thumb_name),
      createdAt: rec.created_at,
      source: rec.source,
      deviceId: rec.device_id,
    };
    if (includePath) out.path = rec.file_path;
    return out;
  }

  function queueHash(id) {
    hashQueue.push(id);
    void runHashQueue();
  }

  async function runHashQueue() {
    if (hashing) return;
    hashing = true;
    while (hashQueue.length && !stopped) {
      const id = hashQueue.shift();
      try {
        const rec = repos.files.get(id);
        if (!rec || rec.file_hash) continue;
        const { path: p } = await resolveFileRecord(storage, rec);
        const hash = await hashFile(p);
        if (!stopped) repos.files.setHash(id, hash);
      } catch (err) {
        logger.debug(`hash skipped for ${id}: ${err.message}`);
      }
    }
    hashing = false;
    hashDone?.();
  }

  let hashDone = null;

  function requestThumb(rec, src) {
    thumbnails.request(rec.id, src, rec.original_name, (thumbName) => {
      if (stopped) return;
      repos.files.setThumb(rec.id, thumbName);
      events.emit(rec.direction === 'shared' ? 'files:shared:changed' : 'files:received:changed', { id: rec.id });
    });
  }

  async function walk(dir, out) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (out.length >= MAX_FOLDER_FILES) return;
      if (e.name.startsWith('.')) continue; // skip hidden files such as .DS_Store, .git
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, out);
      else if (e.isFile()) out.push(full); // symlinks are skipped on purpose
    }
  }

  async function addOne(filePath, copy) {
    const abs = path.resolve(filePath);
    const existing = repos.files.findSharedByPath(abs);
    if (existing) return { skipped: true, id: existing.id };
    const st = await fsp.stat(abs);
    if (!st.isFile()) return { skipped: true };
    const name = sanitizeFileName(path.basename(abs));
    let storedPath = abs;
    let source = 'linked';
    if (copy && !isInside(storage.dirs.shared, abs)) {
      storedPath = uniquePath(storage.dirs.shared, name);
      await fsp.copyFile(abs, storedPath, fs.constants.COPYFILE_EXCL);
      source = 'copied';
    } else if (isInside(storage.dirs.shared, abs)) {
      source = 'copied';
    }
    const rec = {
      id: randomId(12), original_name: name, stored_name: path.basename(storedPath), file_path: storedPath, source,
      mime_type: mime.lookup(name) || 'application/octet-stream', file_size: st.size, file_mtime: Math.floor(st.mtimeMs),
      direction: 'shared', created_at: Date.now(),
    };
    repos.files.insert(rec);
    queueHash(rec.id);
    requestThumb(rec, storedPath);
    return { id: rec.id };
  }

  return {
    toPublic,

    /** Adds files and/or folders chosen on the desktop. */
    async addShared(paths) {
      const copy = settings.get('copySharedFiles');
      const files = [];
      for (const p of paths ?? []) {
        try {
          const st = await fsp.stat(p);
          if (st.isDirectory()) await walk(p, files);
          else if (st.isFile()) files.push(p);
        } catch (err) {
          logger.warn(`cannot add ${p}`, err.message);
        }
        if (files.length >= MAX_FOLDER_FILES) break;
      }
      let added = 0; let skipped = 0; const errors = [];
      for (const f of files) {
        try {
          const r = await addOne(f, copy);
          if (r.skipped) skipped++; else added++;
        } catch (err) {
          errors.push({ file: path.basename(f), message: friendlyFsError(err, 'add the file').userMessage });
        }
      }
      if (added) { events.emit('files:shared:changed', {}); events.emit('stats:changed'); }
      return { added, skipped, errors, truncated: files.length >= MAX_FOLDER_FILES };
    },

    async removeShared(id) {
      const rec = repos.files.getInDirection(id, 'shared');
      if (!rec) throw Errors.notFound();
      if (rec.source === 'copied' && isInside(storage.dirs.shared, rec.file_path)) {
        await fsp.rm(rec.file_path, { force: true });
      }
      thumbnails.remove(rec.thumb_name);
      repos.files.delete(id);
      events.emit('files:shared:changed', {});
      events.emit('stats:changed');
    },

    /** Renames how a shared file is presented and downloaded. The file on disk is not touched. */
    renameShared(id, newName) {
      const rec = repos.files.getInDirection(id, 'shared');
      if (!rec) throw Errors.notFound();
      let name = sanitizeFileName(newName, '');
      if (!name) throw new AppError('BAD_NAME', 'Enter a file name.');
      if (!path.extname(name) && path.extname(rec.original_name)) name += path.extname(rec.original_name);
      repos.files.rename(id, name);
      events.emit('files:shared:changed', {});
      return name;
    },

    async listShared() {
      const rows = repos.files.list('shared');
      return Promise.all(rows.map(async (r) => {
        let available = true;
        try { await fsp.access(r.file_path, fs.constants.R_OK); } catch { available = false; }
        return { ...toPublic(r), available };
      }));
    },

    listReceived(deviceId = null) {
      const rows = deviceId ? repos.files.listByDevice('received', deviceId) : repos.files.list('received');
      const names = new Map();
      return rows.map((r) => {
        if (r.device_id && !names.has(r.device_id)) names.set(r.device_id, repos.devices.get(r.device_id)?.device_name ?? '');
        return { ...toPublic(r), deviceName: names.get(r.device_id) ?? '' };
      });
    },

    async deleteReceived(id, deviceId = null) {
      const rec = repos.files.getInDirection(id, 'received');
      if (!rec) throw Errors.notFound();
      if (deviceId && rec.device_id !== deviceId) throw Errors.forbidden('You can only delete files uploaded from this device.');
      if (isInside(storage.dirs.received, rec.file_path)) {
        try { await fsp.rm(rec.file_path, { force: true }); } catch (err) { throw friendlyFsError(err, 'delete the file'); }
      }
      thumbnails.remove(rec.thumb_name);
      repos.files.delete(id);
      events.emit('files:received:changed', {});
      events.emit('stats:changed');
    },

    /**
     * Validates and returns the on-disk location of a file record.
     * Linked files that changed on disk get their size refreshed (hash recomputed later).
     */
    async resolve(id, direction) {
      const rec = direction ? repos.files.getInDirection(id, direction) : repos.files.get(id);
      if (!rec) throw Errors.notFound();
      let resolved;
      try {
        resolved = await resolveFileRecord(storage, rec);
      } catch (err) {
        throw friendlyFsError(err, 'read the file');
      }
      const mtime = Math.floor(resolved.stat.mtimeMs);
      if (resolved.stat.size !== rec.file_size || (rec.file_mtime && mtime !== rec.file_mtime)) {
        repos.files.updateStat(rec.id, resolved.stat.size, mtime);
        rec.file_size = resolved.stat.size;
        queueHash(rec.id);
      }
      return { rec, path: resolved.path, size: resolved.stat.size };
    },

    /** Moves a verified upload from Temp/ into Received/ and records it. */
    registerReceived(args) {
      // Serialised so that two uploads with the same name can never pick the same target path.
      const run = registerChain.then(() => registerReceivedNow(args));
      registerChain = run.catch(() => {});
      return run;
    },

    resumeHashing() {
      for (const r of repos.files.missingHash(200)) queueHash(r.id);
    },

    /** Stops background work before the database closes; waits for a running hash to finish. */
    stop() {
      stopped = true;
      hashQueue.length = 0;
      if (!hashing) return Promise.resolve();
      return new Promise((resolve) => { hashDone = resolve; setTimeout(resolve, 5000); });
    },
  };

  async function registerReceivedNow({ tempPath, originalName, mimeType, deviceId, size, hash }) {
      const name = sanitizeFileName(originalName);
      const finalPath = uniquePath(storage.dirs.received, name);
      try {
        await fsp.rename(tempPath, finalPath);
      } catch (err) {
        if (err.code !== 'EXDEV') throw friendlyFsError(err, 'save the file');
        await fsp.copyFile(tempPath, finalPath);
        await fsp.rm(tempPath, { force: true });
      }
      try { await fsp.chmod(finalPath, 0o644); } catch { /* not supported on some filesystems */ }
      const st = await fsp.stat(finalPath);
      const rec = {
        id: randomId(12), original_name: path.basename(finalPath), stored_name: path.basename(finalPath), file_path: finalPath,
        source: 'received', mime_type: mimeType || mime.lookup(name) || 'application/octet-stream', file_size: size,
        file_mtime: Math.floor(st.mtimeMs), file_hash: hash, direction: 'received', device_id: deviceId, created_at: Date.now(),
      };
      repos.files.insert(rec);
      requestThumb(rec, finalPath);
      events.emit('files:received:changed', { id: rec.id });
      events.emit('stats:changed');
      return rec;
  }
}
