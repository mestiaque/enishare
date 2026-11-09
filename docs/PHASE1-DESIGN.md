# ENiShare — Phase 1 Design (for approval)

Status: **Approved and implemented** (2026-11-09). Changes made during implementation:
* SQLite uses Node's built-in `node:sqlite` (Electron 45 bundles Node 24) instead of better-sqlite3, and thumbnails use Electron `nativeImage` instead of sharp, so there are no native modules (see ARCHITECTURE.md).
* The ZIP download is a plain `GET /api/files/shared-zip?ids=…` instead of a ticket.
* The SMB assistant lives in Settings, not in its own screen.
Date: 2026-11-09. Project root: `UBWIN/enishare/`.

This document covers what §19 of `plan.md` asks for before implementation:
architecture, feasibility, dependencies, database, project structure, API,
networking, and roadmap.

---

## 1. Final architecture

```
┌──────────────────────────── PC (Windows 10/11 · Ubuntu 22.04+) ────────────────────────────┐
│                                                                                            │
│  Electron main process (src/main)                                                          │
│   • windows, tray, native dialogs, shell.openPath / showItemInFolder                       │
│   • typed IPC bridge  ◄──── preload.js (contextBridge, allow-listed channels) ────► Desktop │
│   • starts / restarts / stops the server process                           renderer (UI) │
│            │  MessagePort (JSON messages: commands + events)                 src/desktop  │
│            ▼                                                                               │
│  Server utility process (src/server)  — Electron utilityProcess.fork()                     │
│   ┌─────────────┐ ┌──────────────┐ ┌────────────────┐ ┌──────────────┐ ┌───────────────┐   │
│   │ Express app │ │ Socket.IO    │ │ Transfer engine│ │ Storage mgr  │ │ SQLite (DB)   │   │
│   │ REST + static│ │ auth'd rooms │ │ chunk sessions │ │ paths, quota │ │ better-sqlite3│   │
│   └─────┬───────┘ └──────┬───────┘ └───────┬────────┘ └──────┬───────┘ └───────────────┘   │
│         │  security middleware: IP allow-list · session · CSRF · rate limit · path guard   │
│   ┌─────┴───────────┐  ┌─────────────────┐  ┌───────────────────────────────┐              │
│   │ Network monitor │  │ Thumbnailer     │  │ Protocol helpers              │              │
│   │ interfaces, poll│  │ sharp           │  │ SMB assistant · USB detector  │              │
│   └─────────────────┘  └─────────────────┘  └───────────────────────────────┘              │
│              │ HTTP :8080 (all LAN interfaces, private-range filter)                       │
└──────────────┼─────────────────────────────────────────────────────────────────────────────┘
               │  Wi-Fi LAN  ─or─  USB "Personal Hotspot" network (172.20.10.0/28)
               ▼
┌──────────── iPhone (no app installed) ────────────┐
│ Safari / Chrome → mobile web client (src/mobile)  │
│  pair via QR → session cookie → upload / download │
│ Files app → SMB "Connect to Server" (optional)    │
└───────────────────────────────────────────────────┘
```

### Why the server runs in a separate utility process
Uploads, hashing, SQLite writes and thumbnail work all use CPU and disk. In a
separate process they cannot slow down the Electron main process (window, menus,
IPC). If the server crashes, the app stays open, the UI shows "Server stopped
unexpectedly" and offers a restart. The main process is the only part that talks
to the OS shell (open file or folder). The server never gets the renderer's
privileges.

### Process responsibilities
| Process | Owns | Does not do |
|---|---|---|
| Main | windows, tray, dialogs, server lifecycle, bootstrap config (`userData/config.json`: storage root only) | HTTP, DB |
| Server (utility) | Express, Socket.IO, DB, files, thumbnails, network monitor, transfer engine | any UI |
| Desktop renderer | UI only, sandboxed, `contextIsolation`, no Node | filesystem access |
| Mobile client | UI in Safari, talks to REST + Socket.IO | — |

---

## 2. Technical feasibility assessment

Status labels used everywhere: **Planned** → after coding **Implemented** → after a
real device run **Tested**. Also **Partial**, **Experimental**, **Not supported**.

| Feature | Verdict | Notes |
|---|---|---|
| Wi-Fi: iPhone Safari ↔ PC over HTTP | **Feasible (core)** | Phone and PC must be on the same LAN. Some routers have "AP/client isolation", which blocks this; the error screen explains it. |
| QR pairing | Feasible | The iPhone Camera app opens `http://IP:PORT/p/<token>` in Safari. |
| Upload photos / documents from iPhone | Feasible | `<input type=file multiple>`. With `accept="image/*"` iOS shows Photo Library / Take Photo / Choose File. **iOS may convert HEIC→JPEG** ("Most Compatible" setting, and Safari sometimes transcodes). We keep whatever bytes arrive and don't promise that originals are preserved. |
| Large-file chunked + resumable upload | Feasible | Resume works within the same page session (Wi-Fi drop, screen lock). After a page reload the browser loses the `File` object. The user must pick the same file again; we match it by name+size+lastModified and continue from the server's chunk map. |
| Download PC → iPhone | Feasible | `Content-Disposition: attachment` → Safari's download manager → Files › Downloads. iOS 13+. |
| Multiple downloads | Partial | Safari asks "allow multiple downloads" or skips files. We provide **"Download selected as ZIP"** (streamed, store-only, no temp file) as the reliable path. |
| Download progress on phone | Partial | Safari's native download UI shows progress on the phone. Our UI shows progress from the **server's count of bytes sent**, pushed over Socket.IO. That's accurate for "sent", not "saved". Cancellation happens in Safari's download list; the server detects the abort and marks the transfer cancelled. |
| Image preview (mobile) | Feasible | Server thumbnails (sharp) for JPG/PNG/WEBP/GIF/AVIF/TIFF. Full-size view uses the original. |
| PDF preview (mobile) | Feasible | Opened `inline` in a new tab; Safari's built-in PDF viewer renders it. |
| HEIC thumbnails on PC | **Partial** | Chromium and sharp's prebuilt libvips can't decode HEIC (HEVC patents). Windows: decoded only if the "HEIF/HEVC Image Extensions" are installed, through the Windows thumbnail API (Experimental). Ubuntu: used only if `heif-convert` (package `libheif-examples`) is present. Otherwise a generic image icon. The file itself always transfers fine. |
| Office documents preview on PC | Not supported (in-app) | Icon + "Open" in the system default app. |
| HTTPS | **Optional, off by default** | On iOS a self-signed cert needs a profile install plus Settings › General › About › Certificate Trust Settings. That's too much for non-technical users, so HTTP + token pairing is the default. The optional HTTPS mode creates a local CA and a downloadable profile. Consequence of HTTP: `crypto.subtle` doesn't exist on the phone, so chunk integrity uses a pure-JS **CRC32** and the server computes **SHA-256** of the final file. HTTP limitations are documented in SECURITY.md. |
| SMB via iOS Files | **Experimental, assisted setup** | See §2.1. |
| WebDAV | **Not planned** | iOS Files can't mount it, and the browser client already covers the use case. Dropped to avoid dead weight; can be added later if needed. |
| USB cable | **Partial: only via iPhone Personal Hotspot over USB** | See §2.2. |

### 2.1 SMB — findings
* iOS Files (iOS 13+) connects to SMB 2/3 servers through *Browse › ⋯ › Connect to Server* (`smb://IP`). It expects the **standard port 445**.
* **No maintained Node.js SMB2/3 server exists.** `@marsaud/smb2`, `smb2` and similar packages are *clients*. Adobe's `node-smb-server` is archived and mostly SMB1. → We do **not** ship a JS SMB server.
* Platform-native route:
  * **Windows**: built-in SMB server. Creating a share needs admin (`New-SmbShare`, run through one UAC prompt). Access uses the Windows account password; a Microsoft account works with its MS password. Port 445 is already open on private networks.
  * **Ubuntu**: Samba isn't installed by default (it isn't on this machine). This needs a one-time `sudo apt install samba`, adding the user to the `sambashare` group and running `sudo smbpasswd -a $USER`. After that, ENiShare can manage a **usershare** (`net usershare add`) **without root**.
* ENiShare's SMB screen = a **setup assistant + live status check**: it checks whether the service is installed, the share exists and port 445 is listening, using real checks only. It shares the `ENiShare` storage folder. "Connected" is never shown; SMB has no per-client signal that we can read reliably without root.
* Verifying read/write from a real iPhone is a manual test in Phase 7 (I can't drive a physical iPhone from here).

### 2.2 USB — findings
| Mechanism | Lets iPhone Safari reach the PC? | Verdict |
|---|---|---|
| **Personal Hotspot over USB** (iPhone acts as a USB network adapter; Linux `ipheth` driver + `usbmuxd` for pairing, Windows "Apple Mobile Device Ethernet" driver from Apple Devices/iTunes) | **Yes.** The PC gets `172.20.10.x`, the phone is `172.20.10.1`, and the phone can open `http://172.20.10.x:8080`. Data goes over the cable. | **Supported when available.** Needs Personal Hotspot to be allowed (some carriers or SIM-less phones hide it). No iOS app needed. |
| usbmuxd / `iproxy` port forwarding | No: it forwards **PC → a port on the iPhone**. Nothing on the phone listens except Apple services, and Safari can't use it in the reverse direction. | **Not supported** (would need an iOS companion app) |
| Reverse USB tunnel | Needs an app on the iPhone. | **Not supported** |
| "Plain cable creates a network" | False. Without Personal Hotspot no network interface exists. | — |
| SMB over USB | Works only through the hotspot network above (same IP path). | Experimental |

**USB screen behaviour:** the screen detects (a) a hotspot interface. On Linux that's `/sys/class/net/*/device/driver → ipheth`; on Windows the adapter description contains "Apple Mobile Device Ethernet", plus the 172.20.10.0/28 subnet. It also detects (b) whether an iPhone is plugged in at all: Linux uses `idevice_id -l` if libimobiledevice-utils is installed, Windows the Apple Mobile Device service/driver presence. Possible states:
`No iPhone detected` → `iPhone plugged in, Personal Hotspot not active (steps shown)` → `USB network ready: <URL + QR>`.
Every state comes from a real check. Nothing is faked.

---

## 3. Dependencies

Exact versions get pinned at the start of Phase 2 with `npm view <pkg> version` and a compatibility check. I won't pin versions from memory.

**Runtime**
| Package | Purpose | Why this one |
|---|---|---|
| `electron` (current stable) | desktop shell | required by spec |
| `express` 5.x | HTTP | required; v5 handles async errors natively |
| `socket.io` 4.x (+ client bundle served locally) | realtime | required; built-in reconnect |
| `better-sqlite3` | SQLite | synchronous, fast, parameterised statements, Electron prebuilds |
| `busboy` | streaming multipart for the simple `POST /api/upload` path | the engine Multer uses, without Multer's extra layer; streams straight to disk |
| `sharp` | thumbnails | prebuilt for linux-x64/win32-x64, streams, small memory use |
| `qrcode` | QR as SVG/data-URL (in server and desktop) | maintained npm equivalent of "QRCode.js", no CDN |
| `lucide` | icons | required; SVGs bundled locally |
| `express-rate-limit` | rate limiting on pairing/PIN/auth | small, maintained |
| `archiver` | streamed ZIP for multi-download | streams, no temp file |
| `mime-types` | MIME by extension | tiny, standard |
| `file-type` | magic-byte MIME check on uploads | MIME validation per spec (ESM; loaded with dynamic `import()`) |

**Not used (deliberate):** Bootstrap (own CSS reusing the EN* family theme tokens dark/light/glass/system from ENViewer), Multer, any WebDAV/SMB npm package, any cloud SDK, winston (a small own rotating logger is enough).

**Dev**
`electron-builder`, `@electron/rebuild` (via `install-app-deps`), `supertest` (API tests with `node:test`), `playwright` with **WebKit + iPhone device profile** (closest to Safari available on Linux; doesn't replace real-device tests), `eslint`.

---

## 4. Database design (SQLite, `<storage>/Database/enishare.db`, WAL mode)

```sql
CREATE TABLE files (
  id            TEXT PRIMARY KEY,           -- random 128-bit, base64url
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  file_path     TEXT NOT NULL,              -- absolute; validated against allowed roots on every use
  source        TEXT NOT NULL,              -- 'copied' (inside Shared/) | 'linked' (user file referenced in place) | 'received'
  mime_type     TEXT,
  file_size     INTEGER NOT NULL,
  file_hash     TEXT,                       -- sha256 hex (computed in background for shared files)
  direction     TEXT NOT NULL CHECK (direction IN ('shared','received')),
  device_id     TEXT REFERENCES devices(id) ON DELETE SET NULL,
  thumb_name    TEXT,
  created_at    INTEGER NOT NULL            -- unix ms
);
CREATE INDEX idx_files_direction ON files(direction, created_at);

CREATE TABLE devices (
  id          TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,                -- "iPhone · Safari" from UA, user can rename on phone
  session_id  TEXT NOT NULL UNIQUE,         -- sha256 of the session token (raw token never stored)
  ip_address  TEXT,
  user_agent  TEXT,
  expires_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  last_seen   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE transfers (
  id               TEXT PRIMARY KEY,
  file_id          TEXT REFERENCES files(id) ON DELETE SET NULL,
  device_id        TEXT REFERENCES devices(id) ON DELETE SET NULL,
  file_name        TEXT NOT NULL,           -- kept for history after the file is deleted
  direction        TEXT NOT NULL CHECK (direction IN ('upload','download')),
  total_size       INTEGER NOT NULL,
  transferred_size INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL,           -- queued|active|paused|completed|failed|cancelled
  error            TEXT,
  started_at       INTEGER NOT NULL,
  completed_at     INTEGER
);
CREATE INDEX idx_transfers_started ON transfers(started_at);

CREATE TABLE upload_sessions (               -- added: needed for chunked/resumable uploads
  id              TEXT PRIMARY KEY,         -- upload ID
  transfer_id     TEXT NOT NULL REFERENCES transfers(id),
  device_id       TEXT NOT NULL REFERENCES devices(id),
  original_name   TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  last_modified   INTEGER,                  -- for resume matching
  chunk_size      INTEGER NOT NULL,
  chunk_count     INTEGER NOT NULL,
  received_chunks INTEGER NOT NULL DEFAULT 0,
  chunk_map       BLOB NOT NULL,            -- bitmap, 1 bit per chunk
  temp_path       TEXT NOT NULL,            -- inside Temp/
  status          TEXT NOT NULL,            -- open|completing|completed|cancelled|expired
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- JSON-encoded values
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
```
All queries are prepared statements. Migrations are numbered SQL files applied at startup.
Shared files can be **linked** (no copy, good for large videos) or **copied** into `Shared/`. Linked is the default; the path is re-validated, and a file that is missing or changed is marked unavailable.

---

## 5. Project structure

```
enishare/
├── package.json · electron-builder.yml · README.md · .gitignore · .eslintrc.json
├── build/                      icons (png/ico), installer.nsh (firewall rule), linux after-install
├── src/
│   ├── main/
│   │   ├── main.js             app lifecycle, single-instance lock
│   │   ├── preload.js          contextBridge API (allow-listed channels only)
│   │   ├── window-manager.js   window state, CSP, navigation lock
│   │   ├── server-host.js      utilityProcess spawn/restart, MessagePort relay
│   │   ├── ipc.js              IPC handlers (dialogs, open file/folder, server commands)
│   │   ├── bootstrap-config.js userData/config.json (storage root)
│   │   └── tray.js
│   ├── shared/                 code used by main + server
│   │   ├── channels.js  constants.js  logger.js  crc32.js
│   ├── server/
│   │   ├── index.js            utility-process entry, message protocol
│   │   ├── app.js              express app factory (testable without Electron)
│   │   ├── config/             defaults.js, settings-service.js
│   │   ├── routes/             pair.js, files.js, uploads.js, devices.js, status.js
│   │   ├── controllers/        one per route file
│   │   ├── services/           transfer-manager.js, upload-service.js, download-service.js,
│   │   │                       file-service.js, thumbnail-service.js, pairing-service.js, session-service.js
│   │   ├── middleware/         ip-allowlist.js, auth.js, csrf.js, rate-limit.js, errors.js, security-headers.js
│   │   ├── sockets/            index.js (auth handshake, rooms, event fan-out)
│   │   ├── network/            interfaces.js (detect+classify), monitor.js (poll+diff), port.js
│   │   ├── storage/            paths.js (roots, safe-join), disk.js (statfs), sanitize.js, cleanup.js
│   │   ├── database/           db.js, migrations/001_init.sql, repositories/*.js
│   │   └── protocols/          smb/ (windows.js, linux.js, status.js), usb/ (detect-linux.js, detect-windows.js)
│   ├── desktop/                index.html, css/ (tokens.css, app.css), js/ (app.js, router.js,
│   │                           views/*.js, components/*.js, api.js), assets/
│   └── mobile/                 index.html, pair.html, css/, js/ (app.js, uploader.js, downloads.js,
│                               socket.js, crc32.js), assets/
├── scripts/                    build-windows.js, build-linux.js
├── tests/                      api/, network/, transfer/, security/, e2e-mobile/ (Playwright WebKit)
└── docs/                       ARCHITECTURE.md, SECURITY.md, NETWORKING.md, USB-LIMITATIONS.md,
                                SMB-SETUP.md, INSTALLATION.md, TESTING.md, TROUBLESHOOTING.md, USER-MANUAL.md
```
Storage (default `~/Downloads/ENiShare` or `%USERPROFILE%\Downloads\ENiShare`, resolved with `app.getPath('downloads')`):
`Received/ Shared/ Thumbnails/ Temp/ Database/`. Logs go to `app.getPath('logs')`.

---

## 6. API specification

Base: `http://<ip>:<port>`. JSON errors look like `{ "error": { "code": "UPLOAD_TOO_LARGE", "message": "…" } }`.
Mobile auth = `enishare_sid` cookie (HttpOnly, SameSite=Strict, Path=/). Mutating requests also need the header
`X-ENiShare-CSRF: <token>` (token returned by `/api/session`). The desktop doesn't use HTTP; it talks to the server over the MessagePort.

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /` | session or redirect to `/pair` | mobile app shell |
| `GET /p/:pairToken` | — (rate limited) | QR target. Valid token → create device session, set cookie, 302 `/`. Invalid/expired → friendly page. |
| `GET /pair` | — | manual entry: shows a PIN form if a PIN is enabled; otherwise asks the user to scan the QR |
| `POST /api/pair/pin` `{pin}` | — (rate limited 5/min/IP, lockout) | PIN pairing |
| `GET /api/session` | session | `{device, pcName, csrfToken, limits:{maxUploadBytes, chunkSize}}` |
| `PATCH /api/session` `{deviceName}` | session+csrf | rename this device |
| `DELETE /api/session` | session+csrf | log out |
| `GET /api/files/shared` | session | `[{id,name,size,mime,kind,hasThumb,createdAt,available}]` |
| `GET /api/files/shared/:id` | session | stream download, `attachment`, Range supported (resumable downloads) |
| `GET /api/files/shared/:id?inline=1` | session | inline view (images, PDF) |
| `GET /api/files/shared/:id/thumb` | session | JPEG/WebP thumbnail |
| `POST /api/files/shared/zip` `{ids:[]}` | session+csrf | returns one-time URL `GET /api/files/zip/:ticket` → streamed ZIP |
| `GET /api/files/received` | session | files this device uploaded (other devices' uploads are hidden from the phone) |
| `DELETE /api/files/received/:id` | session+csrf | phone can delete only its own uploads |
| `DELETE /api/files/shared/:id` | **desktop only** | not exposed over HTTP; the phone gets 403 |
| `POST /api/upload` (multipart, `multiple`) | session+csrf | simple path for small files (≤ chunk size); busboy streams to Temp, then verify+move |
| `POST /api/uploads` `{name,size,lastModified,mime}` | session+csrf | create chunked session → `{uploadId, chunkSize, chunkCount, receivedMap}`; returns the existing session if a resume matches; disk-space check |
| `GET /api/uploads/:id` | session | status + chunk bitmap (for resume) |
| `PUT /api/uploads/:id/chunks/:index` raw body, `X-Chunk-CRC32` | session+csrf | stream chunk to Temp file at offset; CRC mismatch → 422, client retries |
| `POST /api/uploads/:id/complete` | session+csrf | verify all chunks + size, magic-byte MIME check, SHA-256, unique name, atomic move to Received/ |
| `DELETE /api/uploads/:id` | session+csrf | cancel + delete temp |
| `GET /api/devices` | desktop only (MessagePort); HTTP 403 | devices with last_seen, online = socket connected **and** last_seen < 60 s |
| `GET /api/status` | session | `{serverName, version, time}` — health/reconnect probe |

**Socket.IO** (`/socket.io`, auth = same cookie, checked in the handshake middleware; socket dropped when the session is revoked or expires)
Server→phone: `files:shared:changed`, `files:received:changed`, `transfer:progress {id,bytes,total,speed,eta}`, `transfer:done`, `transfer:error`, `session:revoked`, `server:stopping`.
Phone→server: `heartbeat` every 20 s (updates last_seen).
Server→desktop (MessagePort): `server:state`, `network:changed`, `devices:changed`, `transfer:*`, `files:*`, `stats:changed`, `log:error`.

---

## 7. Networking design

**Interface detection** (`os.networkInterfaces()`, polled every 5 s and diffed, since Node has no change event):
* keep IPv4, `!internal`, not `169.254/16`.
* classify each interface: `wifi` (Linux: `/sys/class/net/<if>/wireless` exists or name `wl*`; Windows: name/description "Wi-Fi"/"WLAN"/"Wireless"), `ethernet`, `iphone-usb` (driver `ipheth` / "Apple Mobile Device Ethernet" / 172.20.10.0/28), `virtual` (docker*, br-*, veth*, virbr*, vmnet*, vboxnet*, "vEthernet", "VirtualBox", "VMware", "Hyper-V"), `vpn` (tun*, tap*, wg*, tailscale*, zt*, utun*, ppp*, "TAP-Windows", "WireGuard").
* Default pick order: user-selected → wifi → ethernet → iphone-usb. Virtual and VPN interfaces are never auto-picked but can be chosen manually. A private address doesn't count as Wi-Fi unless the interface is classified as Wi-Fi.
* Manual IP override (validated as an IPv4 address that exists on the machine, or forced with a warning).
* When the IP changes: the QR and URL regenerate, the desktop shows a banner, connected phones get disconnected; they need to scan the new QR (old cookies keep working once they reach the new IP).

**Binding:** listen on `0.0.0.0:<port>` and apply an **IP allow-list middleware** to HTTP and Socket.IO. Allowed: RFC1918 (10/8, 172.16/12, 192.168/16) and the machine's own addresses. Every other source gets refused. Reasons: IP changes and the USB hotspot interface work without restarting the server, and the server is still LAN-only. An option "Bind to selected interface only" exists for strict users. The `Host` header must be an IP or `localhost` (blocks DNS rebinding).

**Port:** default 8080, configurable. Before starting, a test listen; on `EADDRINUSE` the UI says "Port 8080 is used by another program" and offers the next free port.

**Firewall:** Windows: the NSIS installer adds an inbound rule for private profiles only (`netsh advfirewall`, elevated installer); otherwise Windows shows its own prompt and the UI explains it. Ubuntu: UFW is off by default; if `ufw status` reports active, show `sudo ufw allow <port>/tcp` (we don't run sudo ourselves).

**"iPhone can't connect" helper:** a desktop diagnostic that lists the chosen IP, the port listening check, firewall hints, AP-isolation hint and a "same Wi-Fi?" checklist.

---

## 8. Security design (summary; full version in SECURITY.md)
* **Pairing token:** 128-bit random, single-use, expires after 5 min (configurable), rotated by "Refresh QR" and after each use. Embedded only in the QR URL.
* **Session:** 256-bit random cookie; only its SHA-256 is stored. Expires (default 24 h, configurable), can be revoked from the desktop Devices list.
* **PIN (optional):** 6 digits, rate limited, lockout after 5 failures for 5 min.
* **CSRF:** SameSite=Strict cookie + per-session header token on all mutating routes.
* **Paths:** files are addressed only by DB id. Every resolved path passes `safeResolve(root, name)`, which rejects `..`, absolute paths and symlinks escaping the root. Linked shared files are checked against the exact path stored when the user picked them.
* **Filenames:** strip control characters, `/ \ : * ? " < > |`, trailing dots/spaces, Windows reserved names (CON, NUL…); limit 200 bytes; collisions become `name (1).ext`.
* **Uploads:** max size (default 4 GB, configurable), disk-space check, magic-byte MIME check (mismatch is allowed but logged, and the MIME is set from the content), stored with no execute bit, temp cleanup on cancel/expiry (24 h) and at startup.
* **Headers:** CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; previews of HTML/SVG are always served as `attachment` (prevents stored XSS from shared files).
* **Electron:** `contextIsolation`, `sandbox`, `nodeIntegration:false`, strict CSP, navigation and `window.open` blocked, preload exposes named functions only.

---

## 9. Transfer engine
* One `TransferManager` in the server process: queue + configurable concurrency (default 3 active files; one file's chunks go sequentially, which keeps memory flat and lets resume order work).
* Chunk size 8 MB (adaptive later if needed). Chunks are streamed from `req` into `fs.createWriteStream(temp, {flags:'r+', start: index*chunkSize})` with a CRC32 tap. Memory per transfer stays at one stream buffer.
* Progress events are throttled to 4/s per transfer. Speed = EWMA over 2 s. ETA = remaining/speed.
* Downloads: `fs.createReadStream` with Range support, a byte counter on the response stream, `close` before finish = cancelled.
* All history goes to `transfers`. Crash safety: on startup, `active` uploads become `paused` (resumable) and old expired sessions get cleaned.

---

## 10. Development roadmap

| Phase | Deliverable | How it gets verified here |
|---|---|---|
| 1 Architecture | this document | your approval |
| 2 Desktop foundation | Electron shell, sidebar + 8 screens (EN* theme: dark/light/glass/system), settings persistence, storage manager, network detection | unit tests (network classification, paths, sanitize); app launched under Xvfb + screenshots |
| 3 HTTP server | utility-process server, mobile shell hosting, QR, pairing/PIN/sessions, security middleware, Socket.IO auth | supertest API + security tests; Playwright WebKit iPhone profile pairs via the QR URL |
| 4 File transfers | simple + chunked upload, resume, download (Range), ZIP, thumbnails, file management, history | tests: 5 GB sparse file upload, kill mid-upload → resume, CRC corruption → retry, path-traversal attempts |
| 5 Mobile interface | full iPhone UI: photo/document pickers, queue, per-file + overall progress, speed, cancel, previews, auto-reconnect | Playwright WebKit e2e; **you test on a real iPhone** with the checklist |
| 6 Advanced networking | SMB assistant (Win/Ubuntu), USB hotspot detection + screen, diagnostics | real checks on this Ubuntu machine; Windows + iPhone parts listed for you to verify |
| 7 Testing & security | full TESTING.md matrix, security review, bug fixes | status table: Implemented / Tested / Partial / Experimental / Not supported |
| 8 Packaging | AppImage + DEB (built here), NSIS Windows installer, docs, user manual | Linux packages built and installed here; Windows build: see note |

**Windows build note:** native modules (`better-sqlite3`, `sharp`) must be built for win32. Cross-building NSIS from Linux works through electron-builder's Wine Docker image, but native prebuilds can be fragile. A **GitHub Actions `windows-latest` job** is recommended for the release installer; I'll set up both and report which one works.

**Things I can't verify myself (they need your iPhone / a Windows PC):** real Safari behaviour, iOS Files SMB connect, Personal Hotspot over USB, Windows firewall/driver detection. Those features stay **Implemented** (not **Tested**) until you report results.
