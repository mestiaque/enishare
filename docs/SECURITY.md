# Security

ENiShare is a local-network tool, but it still treats every request as untrusted.

## What protects access

| Layer | Implementation (file) |
|---|---|
| LAN only | Requests from addresses other than RFC 1918 (10/8, 172.16/12, 192.168/16) and loopback are refused, both for HTTP and the Socket.IO handshake (`middleware/security.js`, `sockets/index.js`). |
| DNS-rebinding protection | The `Host` header must be an IP address or `localhost`. A web page on another site cannot use a hostname that resolves to your PC. |
| QR pairing | A 128-bit random token, **single use**, expires after 5 min (setting), rotated by "Refresh QR" (`services/session-service.js`). |
| PIN pairing (optional, off by default) | 6 digits, compared in constant time, 5 failures per IP lock it for 5 min, plus a rate limit of 20 requests per minute. |
| Sessions | A 256-bit random cookie (`HttpOnly`, `SameSite=Strict`). Only its SHA-256 is stored. It expires after 24 h (setting) and can be revoked per device or all at once; revoking disconnects live sockets. |
| CSRF | Every state-changing request needs the `X-ENiShare-CSRF` header with the per-session token, in addition to SameSite=Strict. |
| WebSocket auth | Socket.IO authenticates the same cookie in its handshake. The heartbeat re-checks the session, and revoked sessions are dropped. |
| Rate limiting | Pairing: 20 per minute per IP. API: 3000 per minute per IP (high, because large uploads make many chunk requests). |

## File access rules

* Files are addressed **only by random ID**. No endpoint accepts a path.
* Only explicitly shared files and files in `Received/` are reachable. Received files are checked to be inside `Received/` (after resolving symlinks), copied shared files inside `Shared/`, and linked shared files must be the exact regular file that was picked.
* A phone sees and can delete only **its own** uploads. Shared files can only be removed on the PC.
* Upload names are sanitised: control characters, `/ \ : * ? " < > |`, leading and trailing dots/spaces, and Windows reserved names (CON, NUL, …) are removed, and names are limited to 200 bytes. Collisions become `name (1).ext`, so nothing is overwritten.
* Uploads are checked against a size limit (4 GB default) and free disk space (200 MB reserve). They are written to `Temp/` with mode 0600, verified, then moved. Partial files are deleted on cancel, after 24 h, and on startup when orphaned.
* MIME validation: the magic bytes are sniffed. If they disagree with the extension, the event is logged and the *detected* type is stored and served.
* HTML, SVG, XML and JavaScript files are never served inline, which prevents stored XSS through shared files. Responses carry a strict CSP, `nosniff`, `no-referrer` and `X-Frame-Options: DENY`.

## Desktop app hardening

`contextIsolation`, `sandbox`, `nodeIntegration: false`, a CSP meta tag, blocked navigation and `window.open`, and only two allowed external links (mailto + website). The preload exposes named functions only; server methods are allow-listed in `src/main/ipc.js`. IPC calls are accepted only from the app's own `file://` page.

## HTTP vs HTTPS: the trade-off

ENiShare uses **plain HTTP on the local network**. To use HTTPS without warnings, an iPhone must install a certificate profile and then turn on *Settings → General → About → Certificate Trust Settings* by hand. That setup step is the opposite of "scan a QR code and go".

What this means:

* Someone who can capture traffic on the same Wi-Fi (for example on an open public network) could see transferred files and the session cookie. The pairing token is single-use, so capturing it after use gains nothing.
* Use ENiShare on networks you trust (home, office), or use the iPhone's own Personal Hotspot (Wi-Fi with WPA2/3 encryption, or USB).
* Never port-forward ENiShare's port on your router. ENiShare refuses non-private source addresses anyway.

A future optional HTTPS mode (local CA + downloadable profile) is possible, but it is not part of 1.0.

## Firewall

* **Windows:** the installer adds one inbound rule for `ENiShare.exe`, for **Private** networks only. It is removed on uninstall. On networks marked *Public*, Windows blocks incoming connections; the "iPhone can't connect?" check reports this.
* **Ubuntu:** UFW is off by default. If it is on, allow the port yourself with `sudo ufw allow 8080/tcp`. ENiShare never runs `sudo`.

## SMB (optional)

ENiShare does not include an SMB server. The Settings screen creates and removes one share of the ENiShare folder in the **operating system's** SMB service (Windows file sharing or Samba usershares). Authentication is your OS account password; guest access is disabled. Don't use SMB on untrusted networks.

## Reporting

Send security issues to info@mestiaque.com.
