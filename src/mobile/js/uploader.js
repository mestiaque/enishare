// Upload queue with chunked, resumable, checksummed uploads.
//
// Each file: POST /api/uploads (create or resume) → PUT each missing chunk with an
// X-Chunk-CRC32 header → POST /complete. XMLHttpRequest is used for chunks because it
// reports upload progress (fetch does not). Network failures pause the item and it
// retries with back-off; it continues where it stopped when the connection returns.
import { api, csrfHeader, ApiError } from './api.js';
import { crc32, crc32Hex } from '../vendor/crc32.js';

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const READ_TIMEOUT_MS = 30_000;
const STALL_MS = 30_000; // no progress on the phone *and* on the PC for this long = dead connection
const POLL_MS = 1500; // ask the PC whether a chunk arrived once the phone has sent it
const PARALLEL_CHUNKS = 2; // chunks of one file in flight at the same time
const SLOW_CHUNK_MS = 10_000;

/** Sends a diagnostic line to the PC's log (best effort, never throws). */
export function reportToPc(level, message, extra) {
  try {
    void fetch('/api/client-log', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...csrfHeader() },
      body: JSON.stringify({ level, message: String(message).slice(0, 500), extra }),
    }).catch(() => {});
  } catch { /* */ }
}
let seq = 0;

export class Uploader extends EventTarget {
  constructor() {
    super();
    this.items = [];
    this.concurrency = 3;
    this.maxBytes = Infinity;
    this.slotsUsed = 0;
    this.slotWaiters = [];
  }

  /** Chunk requests in flight across all files never exceed the PC's per-device limit. */
  acquireSlot() {
    if (this.slotsUsed < this.concurrency) { this.slotsUsed++; return Promise.resolve(); }
    return new Promise((resolve) => this.slotWaiters.push(resolve));
  }

  releaseSlot() {
    const next = this.slotWaiters.shift();
    if (next) next(); else this.slotsUsed = Math.max(0, this.slotsUsed - 1);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  add(files) {
    const added = [];
    const pending = (f) => this.items.some((i) => i.file.name === f.name && i.size === f.size && i.file.lastModified === f.lastModified
      && !['done', 'cancelled', 'error'].includes(i.status));
    for (const file of files) {
      if (pending(file)) continue; // the same file picked twice
      const item = {
        id: ++seq, file, name: file.name || 'file', size: file.size, sent: 0, status: 'queued', error: '',
        uploadId: null, chunkSize: 0, chunkCount: 0, received: new Set(), xhrs: new Set(), inflight: new Map(), attempts: 0, speed: 0, samples: [],
      };
      if (file.size > this.maxBytes) { item.status = 'error'; item.error = 'Larger than the limit set on the PC'; }
      this.items.push(item);
      added.push(item);
    }
    this.emit('change');
    this.pump();
    return added;
  }

  get active() { return this.items.filter((i) => ['uploading', 'verifying', 'starting'].includes(i.status)); }
  get busy() { return this.items.some((i) => ['queued', 'uploading', 'verifying', 'starting', 'waiting'].includes(i.status)); }

  pump() {
    const running = this.active.length;
    const next = this.items.filter((i) => i.status === 'queued').slice(0, Math.max(0, this.concurrency - running));
    for (const item of next) void this.run(item);
  }

  /** Called when the connection is back: waiting items start again immediately. */
  resumeWaiting() {
    for (const i of this.items) if (i.status === 'waiting') { clearTimeout(i.retryTimer); i.status = 'queued'; }
    this.pump();
    this.emit('change');
  }

  async run(item) {
    item.status = 'starting';
    item.error = '';
    this.emit('change');
    try {
      {
        // Creates the session, or resumes it: the server matches name + size + lastModified
        // and returns which chunks it already has.
        const s = await api('/api/uploads', {
          method: 'POST', body: { name: item.name, size: item.size, lastModified: item.file.lastModified, mime: item.file.type },
        });
        item.uploadId = s.uploadId;
        item.chunkSize = s.chunkSize;
        item.chunkCount = s.chunkCount;
        item.received = new Set(s.received);
        item.sent = s.receivedBytes;
      }
      item.status = 'uploading';
      this.emit('change');
      // A few chunks at once keep the Wi-Fi busy while the PC confirms the previous one.
      const todo = [];
      for (let i = 0; i < item.chunkCount; i++) if (!item.received.has(i)) todo.push(i);
      const worker = async () => {
        while (todo.length && item.status === 'uploading') {
          const i = todo.shift();
          await this.acquireSlot();
          try {
            if (item.status !== 'uploading') return;
            await this.sendChunk(item, i);
          } finally {
            this.releaseSlot();
          }
          item.received.add(i);
          item.inflight.delete(i);
          item.attempts = 0;
          item.sent = this.receivedBytes(item) + this.inflightBytes(item);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, todo.length) }, worker));
      if (item.status !== 'uploading') return;
      item.status = 'verifying';
      this.emit('change');
      const done = await api(`/api/uploads/${item.uploadId}/complete`, { method: 'POST' });
      item.status = 'done';
      item.sent = item.size;
      item.savedAs = done.file.name;
      this.emit('change');
      this.emit('done', item);
    } catch (err) {
      if (item.status === 'cancelled') return;
      this.handleError(item, err);
    } finally {
      this.pump();
      if (!this.busy) this.emit('idle');
    }
  }

  /**
   * Reads one slice of the file. FileReader is used because Blob.arrayBuffer() on slices of
   * large Photos-library videos can hang in iOS WebKit; a timeout turns a hang into a retry.
   */
  readSlice(item, start, end) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const timer = setTimeout(() => {
        try { reader.abort(); } catch { /* */ }
        reject(new ApiError(0, 'READ_STALL', `Reading the file on the iPhone stalled at ${start} bytes`));
      }, READ_TIMEOUT_MS);
      reader.onload = () => { clearTimeout(timer); resolve(new Uint8Array(reader.result)); };
      reader.onerror = () => {
        clearTimeout(timer);
        reject(new ApiError(0, 'READ', 'This file could not be read on the iPhone. It may have been moved or is still downloading from iCloud.'));
      };
      reader.readAsArrayBuffer(item.file.slice(start, end));
    });
  }

  async sendChunk(item, index) {
    const start = index * item.chunkSize;
    const end = Math.min(item.size, start + item.chunkSize);
    const bytes = await this.readSlice(item, start, end);
    if (item.status !== 'uploading') throw new ApiError(0, 'CANCELLED', 'Cancelled');
    if (bytes.length !== end - start) {
      throw new ApiError(0, 'READ_SHORT', `The iPhone returned ${bytes.length} of ${end - start} bytes for chunk ${index}`);
    }
    const crc = crc32Hex(crc32(bytes));
    const began = Date.now();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      item.xhrs.add(xhr);
      let lastMove = Date.now();
      let loaded = 0;
      let pcBytes = -1;
      let settled = false;
      let polling = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        item.xhrs.delete(xhr);
        const took = Date.now() - began;
        if (fn === resolve && took > SLOW_CHUNK_MS) {
          reportToPc('info', `slow chunk ${index} of "${item.name}": ${(took / 1000).toFixed(1)} s for ${bytes.length} bytes`);
        }
        fn(arg);
      };
      // Watchdog. Once the phone has handed the chunk to the network, ask the PC: if the chunk is
      // already stored, carry on at once (iOS sometimes delivers the reply late or not at all);
      // if bytes are still arriving the network is just slow; only when nothing moves on either
      // side for STALL_MS is the request dropped and retried.
      const watchdog = setInterval(async () => {
        const sentAll = loaded >= bytes.length;
        if ((sentAll || Date.now() - lastMove > POLL_MS * 4) && !polling) {
          polling = true;
          try {
            const st = await api(`/api/uploads/${item.uploadId}`);
            if (st.received?.includes(index)) {
              done(resolve);
              try { xhr.abort(); } catch { /* reply no longer needed */ }
              return;
            }
            const now = st.writing?.[index] ?? -1;
            if (now > pcBytes) { pcBytes = now; lastMove = Date.now(); }
          } catch { /* the poll itself failed: rely on the timer */ }
          polling = false;
        }
        if (Date.now() - lastMove > STALL_MS) {
          done(reject, new ApiError(0, 'NETWORK', `Chunk ${index} stalled`));
          try { xhr.abort(); } catch { /* */ }
        }
      }, POLL_MS);
      xhr.open('PUT', `/api/uploads/${item.uploadId}/chunks/${index}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Chunk-CRC32', crc);
      for (const [k, v] of Object.entries(csrfHeader())) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.loaded > loaded) lastMove = Date.now();
        loaded = e.loaded;
        item.inflight.set(index, e.loaded);
        item.sent = this.receivedBytes(item) + this.inflightBytes(item);
        this.sample(item);
        this.emit('progress', item);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return done(resolve);
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* */ }
        if (xhr.status === 401) window.dispatchEvent(new CustomEvent('enishare:unauthorized'));
        done(reject, new ApiError(xhr.status, body?.error?.code || 'HTTP', body?.error?.message || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => done(reject, new ApiError(0, 'NETWORK', 'Connection lost'));
      xhr.onabort = () => done(reject, new ApiError(0, 'CANCELLED', 'Cancelled'));
      xhr.ontimeout = () => done(reject, new ApiError(0, 'NETWORK', 'Timed out'));
      xhr.timeout = 10 * 60 * 1000;
      xhr.send(bytes);
    });
  }

  inflightBytes(item) {
    let n = 0;
    for (const v of item.inflight.values()) n += v;
    return n;
  }

  receivedBytes(item) {
    let n = 0;
    for (const i of item.received) n += i < item.chunkCount - 1 ? item.chunkSize : item.size - item.chunkSize * (item.chunkCount - 1);
    return n;
  }

  sample(item) {
    const now = performance.now();
    item.samples.push([now, item.sent]);
    while (item.samples.length > 2 && now - item.samples[0][0] > 3000) item.samples.shift();
    const [t0, b0] = item.samples[0];
    item.speed = now > t0 ? ((item.sent - b0) * 1000) / (now - t0) : 0;
  }

  abortChunks(item) {
    for (const x of [...item.xhrs]) { try { x.abort(); } catch { /* */ } }
    item.xhrs.clear();
    item.inflight.clear();
  }

  handleError(item, err) {
    this.abortChunks(item);
    if (err.code !== 'BUSY' && err.code !== 'CHUNK_BUSY') {
      reportToPc('warn', `upload "${item.name}" ${err.code}: ${err.message}`, {
        size: item.size, received: item.received.size, chunks: item.chunkCount, attempts: item.attempts, status: err.status,
      });
    }
    // After repeated read stalls the file reference is probably unusable: ask the user to pick it again.
    if (err.code === 'READ_STALL' && item.attempts >= 3) {
      err = new ApiError(0, 'READ', 'The iPhone stopped giving access to this file. Select it again to continue where it stopped.');
    }
    const retryable = err.code === 'NETWORK' || err.code === 'CHUNK_CORRUPT' || err.code === 'CHUNK_INCOMPLETE'
      || err.code === 'READ_STALL' || err.code === 'READ_SHORT'
      || err.code === 'BUSY' || err.code === 'CHUNK_BUSY' || err.code === 'RATE_LIMIT' || err.status >= 500 || err.status === 0;
    if (err.status === 401) { item.status = 'error'; item.error = 'Not connected to the PC. Scan the QR code again.'; this.emit('change'); return; }
    if (err.code === 'UPLOAD_CLOSED') { item.uploadId = null; }
    if (retryable && err.code !== 'READ' && err.code !== 'DISK_FULL') {
      const delay = err.code === 'BUSY' || err.code === 'CHUNK_BUSY' ? 700 : RETRY_DELAYS[Math.min(item.attempts, RETRY_DELAYS.length - 1)];
      item.attempts += 1;
      item.status = 'waiting';
      item.speed = 0;
      item.samples = [];
      item.error = err.code === 'NETWORK' ? 'Waiting for connection…' : err.code === 'BUSY' ? '' : 'Retrying…';
      item.sent = this.receivedBytes(item);
      clearTimeout(item.retryTimer);
      item.retryTimer = setTimeout(() => {
        if (item.status === 'waiting') { item.status = 'queued'; this.pump(); }
      }, delay);
      this.emit('change');
      return;
    }
    item.status = 'error';
    item.error = err.message;
    this.emit('change');
    this.emit('failed', item);
  }

  async cancel(item) {
    const wasUploading = item.uploadId && !['done', 'cancelled', 'error'].includes(item.status);
    item.status = 'cancelled';
    clearTimeout(item.retryTimer);
    this.abortChunks(item);
    this.emit('change');
    if (wasUploading) {
      try { await api(`/api/uploads/${item.uploadId}`, { method: 'DELETE' }); } catch { /* server cleans up expired uploads */ }
    }
    this.pump();
  }

  retry(item) {
    if (item.status !== 'error') return;
    item.status = 'queued';
    item.attempts = 0;
    item.error = '';
    this.emit('change');
    this.pump();
  }

  cancelAll() { for (const i of this.items) if (!['done', 'cancelled', 'error'].includes(i.status)) void this.cancel(i); }

  clearFinished() {
    this.items = this.items.filter((i) => !['done', 'cancelled', 'error'].includes(i.status));
    this.emit('change');
  }

  totals() {
    const live = this.items.filter((i) => i.status !== 'cancelled');
    const total = live.reduce((n, i) => n + i.size, 0);
    const sent = live.reduce((n, i) => n + (i.status === 'done' ? i.size : i.sent), 0);
    const speed = this.items.filter((i) => i.status === 'uploading').reduce((n, i) => n + i.speed, 0);
    return {
      total, sent, speed, remaining: Math.max(0, total - sent),
      done: live.filter((i) => i.status === 'done').length, count: live.length,
      failed: live.filter((i) => i.status === 'error').length,
    };
  }
}
