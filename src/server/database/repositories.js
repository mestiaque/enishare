// Data access. Every query is a prepared statement with bound parameters.
import { plain } from './db.js';

export function createRepositories(db) {
  const q = (sql) => db.prepare(sql);

  const files = {
    insert: (f) => q(`INSERT INTO files (id, original_name, stored_name, file_path, source, mime_type, file_size,
        file_mtime, file_hash, direction, device_id, thumb_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(f.id, f.original_name, f.stored_name, f.file_path, f.source, f.mime_type ?? null, f.file_size,
        f.file_mtime ?? null, f.file_hash ?? null, f.direction, f.device_id ?? null, f.thumb_name ?? null, f.created_at),
    get: (id) => plain(q('SELECT * FROM files WHERE id = ?').get(id)),
    getInDirection: (id, direction) => plain(q('SELECT * FROM files WHERE id = ? AND direction = ?').get(id, direction)),
    list: (direction) => q('SELECT * FROM files WHERE direction = ? ORDER BY created_at DESC').all(direction).map(plain),
    listByDevice: (direction, deviceId) =>
      q('SELECT * FROM files WHERE direction = ? AND device_id = ? ORDER BY created_at DESC').all(direction, deviceId).map(plain),
    findSharedByPath: (filePath) => plain(q("SELECT * FROM files WHERE direction = 'shared' AND file_path = ?").get(filePath)),
    rename: (id, name) => q('UPDATE files SET original_name = ? WHERE id = ?').run(name, id),
    setHash: (id, hash) => q('UPDATE files SET file_hash = ? WHERE id = ?').run(hash, id),
    setThumb: (id, thumb) => q('UPDATE files SET thumb_name = ? WHERE id = ?').run(thumb, id),
    updateStat: (id, size, mtime) => q('UPDATE files SET file_size = ?, file_mtime = ?, file_hash = NULL WHERE id = ?').run(size, mtime, id),
    delete: (id) => q('DELETE FROM files WHERE id = ?').run(id),
    count: (direction) => q('SELECT COUNT(*) AS n FROM files WHERE direction = ?').get(direction).n,
    missingHash: (limit = 20) => q('SELECT * FROM files WHERE file_hash IS NULL ORDER BY created_at LIMIT ?').all(limit).map(plain),
  };

  const devices = {
    insert: (d) => q(`INSERT INTO devices (id, device_name, session_id, csrf_token, ip_address, user_agent, expires_at,
        revoked, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(d.id, d.device_name, d.session_id, d.csrf_token, d.ip_address, d.user_agent, d.expires_at, d.last_seen, d.created_at),
    get: (id) => plain(q('SELECT * FROM devices WHERE id = ?').get(id)),
    bySession: (sessionHash) => plain(q('SELECT * FROM devices WHERE session_id = ?').get(sessionHash)),
    touch: (id, ip, at) => q('UPDATE devices SET last_seen = ?, ip_address = ? WHERE id = ?').run(at, ip, id),
    rename: (id, name) => q('UPDATE devices SET device_name = ? WHERE id = ?').run(name, id),
    revoke: (id) => q('UPDATE devices SET revoked = 1 WHERE id = ?').run(id),
    revokeAll: () => q('UPDATE devices SET revoked = 1 WHERE revoked = 0').run(),
    listActive: (now) => q('SELECT * FROM devices WHERE revoked = 0 AND expires_at > ? ORDER BY last_seen DESC').all(now).map(plain),
    deleteStale: (before) => q('DELETE FROM devices WHERE (revoked = 1 OR expires_at < ?) AND last_seen < ?').run(before, before),
  };

  const transfers = {
    insert: (t) => q(`INSERT INTO transfers (id, file_id, device_id, device_name, file_name, direction, total_size,
        transferred_size, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(t.id, t.file_id ?? null, t.device_id ?? null, t.device_name ?? null, t.file_name, t.direction,
        t.total_size, t.transferred_size ?? 0, t.status, t.started_at),
    get: (id) => plain(q('SELECT * FROM transfers WHERE id = ?').get(id)),
    progress: (id, bytes) => q('UPDATE transfers SET transferred_size = ? WHERE id = ?').run(bytes, id),
    setStatus: (id, status, error = null) => q(`UPDATE transfers SET status = ?, error = ?,
        completed_at = CASE WHEN ? IN ('completed', 'failed', 'cancelled') THEN ? ELSE completed_at END WHERE id = ?`)
      .run(status, error, status, Date.now(), id),
    complete: (id, fileId, bytes) => q(`UPDATE transfers SET status = 'completed', file_id = COALESCE(?, file_id),
        transferred_size = ?, completed_at = ?, error = NULL WHERE id = ?`).run(fileId ?? null, bytes, Date.now(), id),
    list: (limit, offset, direction) => (direction
      ? q('SELECT * FROM transfers WHERE direction = ? ORDER BY started_at DESC LIMIT ? OFFSET ?').all(direction, limit, offset)
      : q('SELECT * FROM transfers ORDER BY started_at DESC LIMIT ? OFFSET ?').all(limit, offset)).map(plain),
    countAll: (direction) => (direction
      ? q('SELECT COUNT(*) AS n FROM transfers WHERE direction = ?').get(direction).n
      : q('SELECT COUNT(*) AS n FROM transfers').get().n),
    active: () => q("SELECT * FROM transfers WHERE status IN ('active', 'queued') ORDER BY started_at").all().map(plain),
    totalBytes: () => q("SELECT COALESCE(SUM(transferred_size), 0) AS n FROM transfers WHERE status = 'completed'").get().n,
    pauseActiveUploads: () => q("UPDATE transfers SET status = 'paused' WHERE status IN ('active', 'queued') AND direction = 'upload'").run(),
    failActiveDownloads: () => q("UPDATE transfers SET status = 'failed', error = 'Interrupted' WHERE status IN ('active', 'queued') AND direction = 'download'").run(),
    clearFinished: () => q("DELETE FROM transfers WHERE status IN ('completed', 'failed', 'cancelled')").run(),
  };

  const uploads = {
    insert: (u) => q(`INSERT INTO upload_sessions (id, transfer_id, device_id, original_name, mime_type, file_size,
        last_modified, chunk_size, chunk_count, received_chunks, chunk_map, temp_path, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'open', ?, ?)`)
      .run(u.id, u.transfer_id, u.device_id, u.original_name, u.mime_type ?? null, u.file_size, u.last_modified ?? null,
        u.chunk_size, u.chunk_count, u.chunk_map, u.temp_path, u.created_at, u.created_at),
    get: (id) => plain(q('SELECT * FROM upload_sessions WHERE id = ?').get(id)),
    findResumable: (deviceId, name, size, lastModified) => plain(q(`SELECT * FROM upload_sessions
        WHERE device_id = ? AND original_name = ? AND file_size = ? AND (last_modified IS ? OR last_modified = ?)
        AND status = 'open' ORDER BY updated_at DESC LIMIT 1`).get(deviceId, name, size, lastModified ?? null, lastModified ?? null)),
    markChunk: (id, map, received) => q('UPDATE upload_sessions SET chunk_map = ?, received_chunks = ?, updated_at = ? WHERE id = ?')
      .run(map, received, Date.now(), id),
    setStatus: (id, status) => q('UPDATE upload_sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id),
    expired: (before) => q("SELECT * FROM upload_sessions WHERE status IN ('open', 'completing') AND updated_at < ?").all(before).map(plain),
    openTempPaths: () => new Set(q("SELECT temp_path FROM upload_sessions WHERE status IN ('open', 'completing')").all().map((r) => r.temp_path)),
    resetCompleting: () => q("UPDATE upload_sessions SET status = 'open' WHERE status = 'completing'").run(),
    deleteFinished: () => q("DELETE FROM upload_sessions WHERE status IN ('completed', 'cancelled', 'expired')").run(),
  };

  const settings = {
    all: () => Object.fromEntries(q('SELECT key, value FROM settings').all().map((r) => [r.key, JSON.parse(r.value)])),
    set: (key, value) => q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value)),
  };

  return { files, devices, transfers, uploads, settings };
}
