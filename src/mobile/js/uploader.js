// Upload queue with chunked, resumable, checksummed uploads.
//
// Each file: POST /api/uploads (create or resume) → PUT each missing chunk with an
// X-Chunk-CRC32 header → POST /complete. XMLHttpRequest is used for chunks because it
// reports upload progress (fetch does not). Network failures pause the item and it
// retries with back-off; it continues where it stopped when the connection returns.
import { api, csrfHeader, ApiError } from './api.js';
import { crc32, crc32Hex } from '../vendor/crc32.js';

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
let seq = 0;

export class Uploader extends EventTarget {
  constructor() {
    super();
    this.items = [];
    this.concurrency = 3;
    this.maxBytes = Infinity;
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
        uploadId: null, chunkSize: 0, chunkCount: 0, received: new Set(), xhr: null, attempts: 0, speed: 0, samples: [],
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
      for (let i = 0; i < item.chunkCount; i++) {
        if (item.received.has(i)) continue;
        if (item.status !== 'uploading') return;
        await this.sendChunk(item, i);
        item.received.add(i);
        item.attempts = 0;
      }
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
      item.xhr = null;
      this.pump();
      if (!this.busy) this.emit('idle');
    }
  }

  sendChunk(item, index) {
    return new Promise((resolve, reject) => {
      const start = index * item.chunkSize;
      const blob = item.file.slice(start, Math.min(item.size, start + item.chunkSize));
      blob.arrayBuffer().then((buf) => {
        if (item.status !== 'uploading') return reject(new ApiError(0, 'CANCELLED', 'Cancelled'));
        const bytes = new Uint8Array(buf);
        const crc = crc32Hex(crc32(bytes));
        const xhr = new XMLHttpRequest();
        item.xhr = xhr;
        const base = this.receivedBytes(item);
        xhr.open('PUT', `/api/uploads/${item.uploadId}/chunks/${index}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-Chunk-CRC32', crc);
        for (const [k, v] of Object.entries(csrfHeader())) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => {
          item.sent = base + e.loaded;
          this.sample(item);
          this.emit('progress', item);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve();
          let body = null;
          try { body = JSON.parse(xhr.responseText); } catch { /* */ }
          if (xhr.status === 401) window.dispatchEvent(new CustomEvent('enishare:unauthorized'));
          reject(new ApiError(xhr.status, body?.error?.code || 'HTTP', body?.error?.message || `Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Connection lost'));
        xhr.onabort = () => reject(new ApiError(0, 'CANCELLED', 'Cancelled'));
        xhr.ontimeout = () => reject(new ApiError(0, 'NETWORK', 'Timed out'));
        xhr.timeout = 5 * 60 * 1000;
        xhr.send(bytes);
      }, () => reject(new ApiError(0, 'READ', 'This file could not be read on the iPhone. It may have been moved or is still downloading from iCloud.')));
    });
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

  handleError(item, err) {
    const retryable = err.code === 'NETWORK' || err.code === 'CHUNK_CORRUPT' || err.code === 'CHUNK_INCOMPLETE'
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
    try { item.xhr?.abort(); } catch { /* */ }
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
