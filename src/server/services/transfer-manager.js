// Live transfer tracking: progress, speed, ETA, history rows and concurrency limits.
import { randomId } from './ids.js';
import { PROGRESS_THROTTLE_MS } from '../../shared/constants.js';
import { Errors } from '../errors.js';

const SPEED_WINDOW_MS = 3000;
const DB_FLUSH_MS = 2000;

export function createTransferManager({ repos, settings, events }) {
  const live = new Map(); // transferId -> state
  const inFlight = new Map(); // deviceId -> number of chunk requests in progress

  function view(t) {
    const remaining = Math.max(0, t.total - t.bytes);
    return {
      id: t.id, direction: t.direction, fileName: t.fileName, deviceId: t.deviceId, deviceName: t.deviceName,
      total: t.total, bytes: t.bytes, percent: t.total ? Math.min(100, Math.floor((t.bytes / t.total) * 100)) : 100,
      speed: Math.round(t.speed), eta: t.speed > 1 ? Math.round(remaining / t.speed) : null,
      status: t.status, startedAt: t.startedAt, uploadId: t.uploadId ?? null, fileId: t.fileId ?? null, error: t.error ?? null,
    };
  }

  function sample(t) {
    const now = Date.now();
    t.samples.push([now, t.bytes]);
    while (t.samples.length > 2 && now - t.samples[0][0] > SPEED_WINDOW_MS) t.samples.shift();
    const [t0, b0] = t.samples[0];
    t.speed = now > t0 ? ((t.bytes - b0) * 1000) / (now - t0) : 0;
  }

  function flush(t, force = false) {
    if (force || Date.now() - t.lastFlush > DB_FLUSH_MS) {
      repos.transfers.progress(t.id, t.bytes);
      t.lastFlush = Date.now();
    }
  }

  return {
    /** Creates a history row and a live entry. `existingId` resumes a paused upload's row. */
    begin({ direction, fileName, total, device, fileId = null, existingId = null, initialBytes = 0, uploadId = null }) {
      const id = existingId ?? randomId(12);
      if (existingId) repos.transfers.setStatus(id, 'active');
      else {
        repos.transfers.insert({
          id, file_id: fileId, device_id: device?.id, device_name: device?.device_name, file_name: fileName,
          direction, total_size: total, transferred_size: initialBytes, status: 'active', started_at: Date.now(),
        });
      }
      const t = {
        id, direction, fileName, total, bytes: initialBytes, deviceId: device?.id ?? null, deviceName: device?.device_name ?? '',
        status: 'active', startedAt: Date.now(), samples: [[Date.now(), initialBytes]], speed: 0, lastEmit: 0, lastFlush: 0, uploadId, fileId,
      };
      live.set(id, t);
      events.emit('transfer:progress', view(t));
      return id;
    },

    progress(id, bytes) {
      const t = live.get(id);
      if (!t) return;
      t.bytes = Math.min(bytes, t.total || bytes);
      sample(t);
      flush(t);
      if (Date.now() - t.lastEmit >= PROGRESS_THROTTLE_MS) {
        t.lastEmit = Date.now();
        events.emit('transfer:progress', view(t));
      }
    },

    /** Marks a live upload as waiting for more chunks (e.g. the phone lost Wi-Fi). */
    idle(id) {
      const t = live.get(id);
      if (t) { t.speed = 0; t.samples = [[Date.now(), t.bytes]]; flush(t, true); }
    },

    complete(id, { fileId = null } = {}) {
      const t = live.get(id);
      const bytes = t ? t.total : repos.transfers.get(id)?.total_size ?? 0;
      repos.transfers.complete(id, fileId, bytes);
      if (t) {
        t.bytes = t.total; t.status = 'completed';
        events.emit('transfer:done', view(t));
        live.delete(id);
      }
      events.emit('stats:changed');
    },

    fail(id, status, error) {
      const t = live.get(id);
      repos.transfers.setStatus(id, status, error ?? null);
      if (t) {
        if (t.bytes) repos.transfers.progress(id, t.bytes);
        t.status = status; t.error = error ?? null;
        events.emit(status === 'cancelled' ? 'transfer:done' : 'transfer:error', view(t));
        live.delete(id);
      }
      events.emit('stats:changed');
    },

    pause(id) {
      const t = live.get(id);
      if (t) repos.transfers.progress(id, t.bytes);
      repos.transfers.setStatus(id, 'paused');
      if (t) { t.status = 'paused'; events.emit('transfer:progress', view(t)); live.delete(id); }
    },

    isLive: (id) => live.has(id),
    activeList: () => [...live.values()].map(view),
    activeCount: () => live.size,

    /** Per-device limit on parallel chunk requests (setting: Maximum simultaneous transfers). */
    acquireSlot(deviceId) {
      const n = inFlight.get(deviceId) ?? 0;
      if (n >= settings.get('maxConcurrent')) throw Errors.busy();
      inFlight.set(deviceId, n + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const m = (inFlight.get(deviceId) ?? 1) - 1;
        if (m > 0) inFlight.set(deviceId, m); else inFlight.delete(deviceId);
      };
    },
  };
}
