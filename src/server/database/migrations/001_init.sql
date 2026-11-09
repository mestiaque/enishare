CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  session_id  TEXT NOT NULL UNIQUE,   -- sha256 of the session token; the raw token is never stored
  csrf_token  TEXT NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  expires_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  last_seen   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE files (
  id            TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('linked', 'copied', 'received')),
  mime_type     TEXT,
  file_size     INTEGER NOT NULL,
  file_mtime    INTEGER,
  file_hash     TEXT,
  direction     TEXT NOT NULL CHECK (direction IN ('shared', 'received')),
  device_id     TEXT REFERENCES devices(id) ON DELETE SET NULL,
  thumb_name    TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_files_direction ON files(direction, created_at);

CREATE TABLE transfers (
  id               TEXT PRIMARY KEY,
  file_id          TEXT REFERENCES files(id) ON DELETE SET NULL,
  device_id        TEXT REFERENCES devices(id) ON DELETE SET NULL,
  device_name      TEXT,
  file_name        TEXT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('upload', 'download')),
  total_size       INTEGER NOT NULL,
  transferred_size INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL CHECK (status IN ('queued', 'active', 'paused', 'completed', 'failed', 'cancelled')),
  error            TEXT,
  started_at       INTEGER NOT NULL,
  completed_at     INTEGER
);
CREATE INDEX idx_transfers_started ON transfers(started_at);

CREATE TABLE upload_sessions (
  id              TEXT PRIMARY KEY,
  transfer_id     TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  original_name   TEXT NOT NULL,
  mime_type       TEXT,
  file_size       INTEGER NOT NULL,
  last_modified   INTEGER,
  chunk_size      INTEGER NOT NULL,
  chunk_count     INTEGER NOT NULL,
  received_chunks INTEGER NOT NULL DEFAULT 0,
  chunk_map       BLOB NOT NULL,
  temp_path       TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open', 'completing', 'completed', 'cancelled', 'expired')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_upload_sessions_match ON upload_sessions(device_id, original_name, file_size, status);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
