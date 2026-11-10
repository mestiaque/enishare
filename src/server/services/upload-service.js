// Uploads from the phone.
//
// Chunked protocol (used by the ENiShare mobile client for every file):
//   POST   /api/uploads                 create or resume a session
//   PUT    /api/uploads/:id/chunks/:i   raw chunk body + X-Chunk-CRC32 header
//   POST   /api/uploads/:id/complete    verify, hash, move into Received/
//   DELETE /api/uploads/:id             cancel
// Each chunk is streamed straight to its offset in a Temp/ file, so memory use stays
// at one stream buffer regardless of file size. The chunk bitmap lives in SQLite, so an
// interrupted upload can continue from where it stopped, even after an app restart.
//
// Simple protocol: POST /api/upload (multipart/form-data, several files) for other clients.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import { fileTypeFromFile } from 'file-type';
import mime from 'mime-types';
import { CHUNK_SIZE, DISK_SPACE_RESERVE, UPLOAD_SESSION_TTL_MS } from '../../shared/constants.js';
import { crc32Update, crc32Hex } from '../../shared/crc32.js';
import { randomId } from './ids.js';
import { hashFile } from './file-service.js';
import { freeSpace } from '../storage/disk.js';
import { safeJoin } from '../storage/paths.js';
import { sanitizeFileName } from '../storage/sanitize.js';
import { AppError, Errors, friendlyFsError } from '../errors.js';

const IDLE_PAUSE_MS = 45_000;

// Container formats whose magic bytes legitimately differ from the extension
// (e.g. .docx is a zip). A mismatch is logged, never silently trusted.
const COMPATIBLE = { zip: ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'pages', 'numbers', 'key', 'epub', 'apk', 'ipa', 'jar'],
  cfb: ['doc', 'xls', 'ppt', 'msg'], heic: ['heif', 'heic'], mov: ['mov', 'qt'], mp4: ['m4v', 'm4a', 'mov', '3gp'], jpg: ['jpeg', 'jpg'] };

const bitGet = (map, i) => (map[i >> 3] >> (i & 7)) & 1;
const bitSet = (map, i) => { map[i >> 3] |= 1 << (i & 7); };

export function createUploadService({ repos, storage, settings, files, transfers, events, logger }) {
  const lastActivity = new Map(); // uploadId -> ms
  const writing = new Map(); // uploadId -> Set(chunk index) currently being written
  const arriving = new Map(); // uploadId -> Map(chunk index -> bytes received so far)

  const maxBytes = () => settings.get('maxUploadMB') * 1024 * 1024;

  function chunkLength(s, index) {
    if (s.file_size === 0) return 0;
    return index < s.chunk_count - 1 ? s.chunk_size : s.file_size - s.chunk_size * (s.chunk_count - 1);
  }

  function receivedBytes(s, map = s.chunk_map) {
    let bytes = 0;
    for (let i = 0; i < s.chunk_count; i++) if (bitGet(map, i)) bytes += chunkLength(s, i);
    return bytes;
  }

  function receivedIndices(s) {
    const out = [];
    for (let i = 0; i < s.chunk_count; i++) if (bitGet(s.chunk_map, i)) out.push(i);
    return out;
  }

  function sessionView(s) {
    return {
      uploadId: s.id, name: s.original_name, size: s.file_size, chunkSize: s.chunk_size, chunkCount: s.chunk_count,
      received: receivedIndices(s), receivedBytes: receivedBytes(s), status: s.status, transferId: s.transfer_id,
    };
  }

  function getOwned(device, id) {
    const s = repos.uploads.get(String(id));
    if (!s || s.device_id !== device.id) throw Errors.notFound('Upload');
    s.chunk_map = Buffer.from(s.chunk_map);
    return s;
  }

  function ensureLive(s, device) {
    if (!transfers.isLive(s.transfer_id)) {
      transfers.begin({
        direction: 'upload', fileName: s.original_name, total: s.file_size, device,
        existingId: s.transfer_id, initialBytes: receivedBytes(s), uploadId: s.id,
      });
    }
    lastActivity.set(s.id, Date.now());
  }

  async function checkSpace(size) {
    const free = await freeSpace(storage.dirs.temp);
    if (free !== null && free < size + DISK_SPACE_RESERVE) throw Errors.diskFull();
  }

  async function detectMime(file, name) {
    const byExt = mime.lookup(name) || 'application/octet-stream';
    let detected = null;
    try { detected = await fileTypeFromFile(file); } catch { /* unreadable or too small */ }
    if (!detected) return byExt;
    const ext = path.extname(name).slice(1).toLowerCase();
    const ok = detected.ext === ext || (COMPATIBLE[detected.ext] ?? []).includes(ext);
    if (!ok) logger.warn(`upload "${name}" content looks like .${detected.ext} (${detected.mime}); stored with detected MIME type`);
    // Office/zip containers keep their extension-based MIME; otherwise trust the content.
    return ok && detected.ext === 'zip' ? byExt : detected.mime;
  }

  const service = {
    async createSession(device, body) {
      const name = sanitizeFileName(body?.name);
      const size = Number(body?.size);
      const lastModified = Number.isFinite(Number(body?.lastModified)) ? Math.floor(Number(body.lastModified)) : null;
      if (!Number.isSafeInteger(size) || size < 0) throw Errors.badRequest('Invalid file size.');
      if (size > maxBytes()) throw Errors.tooLarge(settings.get('maxUploadMB'));

      const existing = repos.uploads.findResumable(device.id, name, size, lastModified);
      if (existing && fs.existsSync(existing.temp_path)) {
        existing.chunk_map = Buffer.from(existing.chunk_map);
        ensureLive(existing, device);
        logger.info(`resuming upload ${existing.id} (${name}) at chunk ${existing.received_chunks}/${existing.chunk_count}`);
        return { ...sessionView(existing), resumed: true };
      }

      await checkSpace(size);
      const id = randomId(12);
      const chunkCount = Math.max(1, Math.ceil(size / CHUNK_SIZE));
      const tempPath = safeJoin(storage.dirs.temp, `${id}.part`);
      try {
        await fsp.writeFile(tempPath, '', { flag: 'wx', mode: 0o600 });
      } catch (err) { throw friendlyFsError(err, 'create a temporary file'); }

      const transferId = transfers.begin({ direction: 'upload', fileName: name, total: size, device, uploadId: id });
      repos.uploads.insert({
        id, transfer_id: transferId, device_id: device.id, original_name: name, mime_type: String(body?.mime || '').slice(0, 100),
        file_size: size, last_modified: lastModified, chunk_size: CHUNK_SIZE, chunk_count: chunkCount,
        chunk_map: Buffer.alloc(Math.ceil(chunkCount / 8)), temp_path: tempPath, created_at: Date.now(),
      });
      lastActivity.set(id, Date.now());
      logger.info(`upload started "${name}" (${size} bytes, ${chunkCount} chunks) from ${device.device_name}`);
      return { ...sessionView(repos.uploads.get(id)), resumed: false };
    },

    /**
     * Status for resuming, and for the phone's chunk watchdog: `writing` tells how many bytes of
     * each in-flight chunk have arrived, so the phone can tell a slow network from a lost response.
     */
    status(device, id) {
      const s = getOwned(device, id);
      return { ...sessionView(s), writing: Object.fromEntries(arriving.get(id) ?? []) };
    },

    async writeChunk(device, id, indexRaw, req) {
      const s = getOwned(device, id);
      if (s.status !== 'open') throw new AppError('UPLOAD_CLOSED', 'This upload is no longer active.', 409);
      const index = Number(indexRaw);
      if (!Number.isInteger(index) || index < 0 || index >= s.chunk_count) throw Errors.badRequest('Invalid chunk index.');
      const expected = chunkLength(s, index);
      const declared = req.headers['content-length'];
      if (declared !== undefined && Number(declared) !== expected) {
        throw Errors.badRequest(`Chunk ${index} must be ${expected} bytes.`);
      }
      const expectedCrc = String(req.headers['x-chunk-crc32'] || '').toLowerCase();
      if (!/^[0-9a-f]{8}$/.test(expectedCrc)) throw Errors.badRequest('Missing chunk checksum.');

      if (bitGet(s.chunk_map, index)) { req.resume(); return { ...sessionView(s), duplicate: true }; }
      const busy = writing.get(id) ?? new Set();
      if (busy.has(index)) throw new AppError('CHUNK_BUSY', 'This chunk is already being uploaded.', 409);

      const release = transfers.acquireSlot(device.id);
      busy.add(index);
      writing.set(id, busy);
      ensureLive(s, device);
      const base = receivedBytes(s);
      let count = 0;
      const arrivingFor = arriving.get(id) ?? new Map();
      arriving.set(id, arrivingFor);
      arrivingFor.set(index, 0);
      let crc = 0;
      try {
        const meter = new Transform({
          transform(chunk, _enc, cb) {
            count += chunk.length;
            arrivingFor.set(index, count);
            if (count > expected) return cb(new AppError('CHUNK_TOO_BIG', 'Chunk larger than expected.', 400));
            crc = crc32Update(crc, chunk);
            transfers.progress(s.transfer_id, base + count);
            lastActivity.set(id, Date.now());
            cb(null, chunk);
          },
        });
        const out = fs.createWriteStream(s.temp_path, { flags: 'r+', start: index * s.chunk_size });
        await pipeline(req, meter, out);
      } catch (err) {
        if (req.destroyed || err.code === 'ERR_STREAM_PREMATURE_CLOSE' || err.code === 'ECONNRESET') {
          transfers.idle(s.transfer_id);
          throw new AppError('CHUNK_ABORTED', 'Upload interrupted.', 499, err);
        }
        throw err instanceof AppError ? err : friendlyFsError(err, 'write the upload');
      } finally {
        busy.delete(index);
        arrivingFor.delete(index);
        if (!arrivingFor.size) arriving.delete(id);
        release();
      }

      if (count !== expected) throw new AppError('CHUNK_INCOMPLETE', `Chunk ${index} was incomplete.`, 422);
      if (crc32Hex(crc) !== expectedCrc) {
        logger.warn(`CRC mismatch on upload ${id} chunk ${index}`);
        throw new AppError('CHUNK_CORRUPT', `Chunk ${index} failed its checksum. It will be sent again.`, 422);
      }
      // Read-modify-write of the bitmap happens synchronously, so concurrent chunks cannot lose updates.
      const fresh = repos.uploads.get(id);
      const map = Buffer.from(fresh.chunk_map);
      bitSet(map, index);
      let received = 0;
      for (let i = 0; i < s.chunk_count; i++) received += bitGet(map, i);
      repos.uploads.markChunk(id, map, received);
      transfers.progress(s.transfer_id, receivedBytes(s, map), true);
      return { index, receivedChunks: received, chunkCount: s.chunk_count };
    },

    async complete(device, id) {
      const s = getOwned(device, id);
      if (s.status === 'completed') throw new AppError('UPLOAD_DONE', 'This upload has already been completed.', 409);
      if (s.status !== 'open') throw new AppError('UPLOAD_CLOSED', 'This upload is no longer active.', 409);
      if (s.received_chunks !== s.chunk_count) {
        throw new AppError('UPLOAD_INCOMPLETE', `Upload is missing ${s.chunk_count - s.received_chunks} chunk(s).`, 409);
      }
      repos.uploads.setStatus(id, 'completing');
      try {
        const st = await fsp.stat(s.temp_path);
        if (st.size !== s.file_size) {
          throw new AppError('UPLOAD_SIZE_MISMATCH', 'The received file size does not match. Please upload it again.', 422);
        }
        const mimeType = await detectMime(s.temp_path, s.original_name);
        const hash = await hashFile(s.temp_path);
        const rec = await files.registerReceived({
          tempPath: s.temp_path, originalName: s.original_name, mimeType, deviceId: device.id, size: s.file_size, hash,
        });
        repos.uploads.setStatus(id, 'completed');
        transfers.complete(s.transfer_id, { fileId: rec.id });
        lastActivity.delete(id);
        logger.info(`received "${rec.original_name}" (${s.file_size} bytes) from ${device.device_name}`);
        events.emit('upload:received', { name: rec.original_name, size: s.file_size, deviceName: device.device_name, id: rec.id });
        return { file: files.toPublic(rec), sha256: hash };
      } catch (err) {
        if (err.code === 'UPLOAD_SIZE_MISMATCH') {
          repos.uploads.setStatus(id, 'cancelled');
          transfers.fail(s.transfer_id, 'failed', err.userMessage);
          await fsp.rm(s.temp_path, { force: true });
        } else {
          repos.uploads.setStatus(id, 'open'); // allow a retry of /complete
        }
        throw err instanceof AppError ? err : friendlyFsError(err, 'save the upload');
      }
    },

    async cancel(device, id) {
      const s = getOwned(device, id);
      if (s.status === 'completed') return { ok: true };
      repos.uploads.setStatus(id, 'cancelled');
      transfers.fail(s.transfer_id, 'cancelled', 'Cancelled on the phone');
      lastActivity.delete(id);
      await fsp.rm(s.temp_path, { force: true });
      return { ok: true };
    },

    /** POST /api/upload — multipart/form-data, one or more files in field "files". */
    handleMultipart(device, req) {
      return new Promise((resolve, reject) => {
        let bb;
        try {
          bb = Busboy({ headers: req.headers, limits: { fileSize: maxBytes(), files: 100, fields: 10 }, defParamCharset: 'utf8' });
        } catch {
          reject(Errors.badRequest('Expected multipart/form-data.'));
          return;
        }
        const results = [];
        const pending = [];
        let failed = null;
        const totalHint = Number(req.headers['content-length']) || 0;

        bb.on('file', (_field, stream, info) => {
          const name = sanitizeFileName(info.filename);
          const tempPath = safeJoin(storage.dirs.temp, `${randomId(12)}.part`);
          const transferId = transfers.begin({ direction: 'upload', fileName: name, total: totalHint, device });
          let bytes = 0;
          stream.on('data', (c) => { bytes += c.length; transfers.progress(transferId, bytes); });
          const job = (async () => {
            try {
              await pipeline(stream, fs.createWriteStream(tempPath, { mode: 0o600 }));
              if (stream.truncated) throw Errors.tooLarge(settings.get('maxUploadMB'));
              const mimeType = await detectMime(tempPath, name);
              const hash = await hashFile(tempPath);
              const rec = await files.registerReceived({ tempPath, originalName: name, mimeType, deviceId: device.id, size: bytes, hash });
              transfers.complete(transferId, { fileId: rec.id });
              events.emit('upload:received', { name: rec.original_name, size: bytes, deviceName: device.device_name, id: rec.id });
              results.push(files.toPublic(rec));
            } catch (err) {
              await fsp.rm(tempPath, { force: true }).catch(() => {});
              const e = err instanceof AppError ? err : friendlyFsError(err, 'save the upload');
              transfers.fail(transferId, req.destroyed ? 'cancelled' : 'failed', e.userMessage);
              failed ??= e;
            }
          })();
          pending.push(job);
        });
        bb.on('error', (err) => { failed ??= Errors.badRequest(`Upload failed: ${err.message}`); });
        bb.on('close', async () => {
          await Promise.allSettled(pending);
          if (failed && !results.length) reject(failed);
          else resolve({ files: results, error: failed?.userMessage ?? null });
        });
        req.on('aborted', () => { failed ??= new AppError('UPLOAD_ABORTED', 'Upload interrupted.', 499); });
        req.pipe(bb);
      });
    },

    /** Pauses uploads that stopped sending data, so they show as "paused" instead of "active". */
    watchdog() {
      const now = Date.now();
      for (const [id, at] of lastActivity) {
        if (now - at < IDLE_PAUSE_MS || writing.get(id)?.size) continue;
        const s = repos.uploads.get(id);
        lastActivity.delete(id);
        if (s && s.status === 'open' && transfers.isLive(s.transfer_id)) transfers.pause(s.transfer_id);
      }
    },

    /** Deletes temp files of uploads that were abandoned for longer than 24 h. */
    async expireOld() {
      for (const s of repos.uploads.expired(Date.now() - UPLOAD_SESSION_TTL_MS)) {
        repos.uploads.setStatus(s.id, 'expired');
        repos.transfers.setStatus(s.transfer_id, 'failed', 'Upload expired before it was finished');
        await fsp.rm(s.temp_path, { force: true }).catch(() => {});
      }
      repos.uploads.deleteFinished();
    },
  };
  return service;
}
