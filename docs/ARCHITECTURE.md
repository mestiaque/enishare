# Architecture

```
┌──────────────────────────── PC (Windows 10/11 · Ubuntu 22.04+) ─────────────────────────────┐
│                                                                                             │
│  Electron main process (src/main)                       Desktop renderer (src/desktop)      │
│   • window, dialogs, shell open/show                     sandboxed, contextIsolation,       │
│   • enishare:// protocol (thumbs/previews)  ◄── IPC ──►  no Node; talks only through        │
│   • nativeImage thumbnailer                              preload.cjs (named functions)      │
│   • notifications                                                                           │
│   • supervises the server process (auto-restart ×3)                                         │
│            │  MessagePort RPC (src/shared/rpc.js): calls both ways + events                 │
│            ▼                                                                                │
│  Server utility process (src/server/index.js → core.js)                                     │
│   Express app ─ routes (pair, files, uploads) ─ middleware (LAN filter, Host check,         │
│   CSP, session, CSRF, rate limits) ─ Socket.IO (cookie-authenticated)                       │
│   services: session · transfer-manager · upload · download · file · thumbnail               │
│   database: node:sqlite (WAL) + migrations · storage: paths, sanitize, disk                 │
│   network: interfaces/monitor/port · protocols: usb detection, smb assistant                │
│              │ HTTP :8080 on all LAN interfaces (private-address filter)                    │
└──────────────┼──────────────────────────────────────────────────────────────────────────────┘
               │ Wi-Fi LAN  ─or─  iPhone Personal Hotspot over USB (172.20.10.0/28)
               ▼
┌──────────── iPhone (no app) ─────────────┐
│ Safari / Chrome → src/mobile (vanilla JS) │
│ Files app → OS SMB share (optional)       │
└───────────────────────────────────────────┘
```

## Why these choices

| Decision | Reason |
|---|---|
| The server runs in an Electron `utilityProcess` | Uploads, hashing and SQLite work never block the window. A crash in the server leaves the app open; it is restarted automatically and the UI says so. |
| `node:sqlite` instead of better-sqlite3 | Electron 45 bundles Node 24, which has SQLite built in. Without native npm modules, Windows installers can be cross-built from Linux and nothing needs to be rebuilt per Electron version. Queries are prepared statements, just as with better-sqlite3. |
| `nativeImage` instead of sharp | Same reason: no native module. JPEG/PNG thumbnails work on every platform, and on Windows the shell thumbnailer (HEIC/WEBP with Store codecs) is used. |
| busboy instead of Multer | Multer is a wrapper around busboy. Using busboy directly keeps streaming to disk simple and leaves one dependency out. |
| Own chunk protocol + CRC-32 | iOS Safari has no `crypto.subtle` on plain-HTTP pages, so checksums use a table-driven CRC-32 (same file on both sides). The server hashes the final file with SHA-256. |
| Plain HTTP by default | A self-signed certificate on iOS requires installing a profile and turning on full trust by hand, which is too much for non-technical users. See SECURITY.md. |
| Listen on 0.0.0.0 + private-address filter | Wi-Fi and the USB hotspot network work at the same time, and IP changes don't require a restart. A strict "selected interface only" mode exists in Settings. |
| Shared files are linked by default | Large videos are not copied. Every access validates the stored path, and missing files show as "Missing". Copy mode is a setting. |

## Processes and messages

* Renderer → main: `ipcRenderer.invoke` on explicit channels (`server:call`, `dialog:*`, `shell:*`, …). `server:call` only forwards method names from an allow-list (`src/main/ipc.js`).
* Main ↔ server: `createRpc` (`src/shared/rpc.js`) over `utilityProcess` messages. The server calls the main process for `thumbnail.make`. The main process calls the server's handlers (`src/server/core.js` → `handlers`).
* Server → UI events: `server:state`, `network:changed`, `settings:changed`, `stats:changed`, `devices:changed`, `transfer:progress|done|error`, `files:shared:changed`, `files:received:changed`, `upload:received`, `server:ready|fatal|crashed`.

## HTTP API (phone)

All JSON errors look like `{ "error": { "code", "message" } }`. `message` is safe to show to users.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /p/:token` | rate-limited | QR target. A valid single-use token sets the session cookie and redirects (303) to `/` |
| `GET /pair` | – | Pairing page (QR instructions, PIN form if enabled) |
| `GET /api/pair/info` | – | `{pcName, pinEnabled, version}` |
| `POST /api/pair/pin` `{pin}` | rate-limited, lockout after 5 failures | PIN pairing |
| `GET /api/session` | session | `{device, pcName, csrfToken, limits}` |
| `PATCH /api/session` `{deviceName}` | session + CSRF | Rename this device |
| `DELETE /api/session` | session + CSRF | Log out |
| `GET /api/status` | – | Health check |
| `GET /api/files/shared` | session | Shared file list (no paths) |
| `GET /api/files/shared/:id[?inline=1]` | session | Stream download; Range supported; inline only for safe types |
| `GET /api/files/shared-zip?ids=a,b` | session | Streamed store-only ZIP (ZIP64 when needed) |
| `GET /api/files/{shared,received}/:id/thumb` | session | JPEG thumbnail |
| `GET /api/files/received` | session | Files this device uploaded |
| `DELETE /api/files/received/:id` | session + CSRF | Delete own upload |
| `DELETE /api/files/shared/:id` | – | Always 403 (desktop-only action) |
| `POST /api/upload` (multipart, many files) | session + CSRF | Simple upload path for other clients |
| `POST /api/uploads` `{name,size,lastModified,mime}` | session + CSRF | Create **or resume** a chunked upload → `{uploadId, chunkSize, chunkCount, received[]}` |
| `GET /api/uploads/:id` | session | Status + received chunk list |
| `PUT /api/uploads/:id/chunks/:i` + `X-Chunk-CRC32` | session + CSRF | Raw chunk body, streamed to its offset |
| `POST /api/uploads/:id/complete` | session + CSRF | Size check, magic-byte MIME check, SHA-256, unique name, move to `Received/` |
| `DELETE /api/uploads/:id` | session + CSRF | Cancel and delete the temp file |

Socket.IO (same cookie): server → phone `files:*:changed`, `transfer:*` (own device only), `session:revoked`, `server:stopping`; phone → server `heartbeat` (every 20 s).

## Database (`<storage>/Database/enishare.db`)

Defined in `src/server/database/migrations/001_init.sql`: `devices` (session hash, CSRF token, expiry, last seen), `files` (shared/received, source linked/copied/received, size, mtime, sha256, thumbnail), `transfers` (history + progress), `upload_sessions` (chunk bitmap for resume), `settings` (JSON values), `schema_migrations`.

The storage root itself is kept in `<userData>/config.json`, because the database lives inside it.

## Storage layout

`%USERPROFILE%\Downloads\ENiShare` or `~/Downloads/ENiShare` (can be changed in Settings):
`Received/` uploads from phones · `Shared/` copies (copy mode only) · `Thumbnails/` · `Temp/` partial uploads (cleaned at start and after 24 h) · `Database/`.
Logs: Electron's logs folder (`~/.config/ENiShare/logs` on Ubuntu, `%APPDATA%\ENiShare\logs` on Windows). Settings → Logs opens it.

## Upload data flow

1. The phone `POST`s `/api/uploads`. The server checks the size limit and free disk space, creates `Temp/<id>.part`, and inserts `transfers` and `upload_sessions` rows. If name + size + lastModified match an open session, it returns that session instead (resume).
2. For each missing chunk, the phone reads the slice, computes its CRC-32, and `PUT`s it with XHR (upload progress). The server pipes the request through a CRC/size meter into `createWriteStream(temp, {start: i*chunk})` and marks the bit in the bitmap. A mismatch returns 422 and the phone resends the chunk.
3. `complete` verifies the size, sniffs magic bytes (a mismatch is logged and the detected MIME is stored), hashes with SHA-256, picks a unique name (`name (1).ext`) and renames the file into `Received/` (serialised, so there are no races). It then queues a thumbnail and emits events.
4. A watchdog marks uploads idle for 45 s as `paused`. The phone retries with back-off and resumes when the connection or socket returns.
