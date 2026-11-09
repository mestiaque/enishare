# ENiShare

Share files between a **Windows or Ubuntu PC** and an **iPhone**. Nothing needs to be installed on the iPhone. Safari opens ENiShare after you scan a QR code. No cloud, no account: files go directly between the two devices on your local network.

1. Open ENiShare on the PC and click **Start Sharing**.
2. Scan the QR code with the iPhone camera.
3. In Safari, upload photos and documents to the PC, or download the files the PC shares.

## Feature status

| Feature | Status |
|---|---|
| Wi-Fi sharing, QR pairing, optional 6-digit PIN, sessions | Implemented; automated tests pass |
| iPhone → PC uploads: several files, chunked (8 MiB), CRC-32 per chunk, SHA-256 per file, resumable, cancellable | Implemented; automated + simulated-phone E2E pass |
| PC → iPhone downloads: streaming, Range requests, "download selected as ZIP", inline image/PDF preview | Implemented; automated tests pass |
| Live progress (Socket.IO), auto-reconnect, device list with last-seen | Implemented |
| Desktop UI in the EN* family layout: frameless window, sidebar sections, status bar, Settings dialog (General, Sharing, Transfers, Security, Files app, Appearance, Logs, About), dark/light/glass/system themes, accent colours | Implemented; screenshots checked under Xvfb |
| USB via the iPhone's Personal Hotspot over USB | **Experimental** (detection is real; needs testing on a device) |
| iOS Files app via the OS's own SMB server | **Experimental** (assisted setup; needs testing on a device) |
| HEIC thumbnails on the PC | **Partial** (Windows with HEIF codecs; Ubuntu with `heif-convert`) |
| USB without Personal Hotspot, reverse tunnels, WebDAV mounting in iOS Files | **Not supported**: impossible without an iPhone app, or not supported by iOS. See [docs/USB-LIMITATIONS.md](docs/USB-LIMITATIONS.md) |

"Tested on a real iPhone" is still pending. See [docs/TESTING.md](docs/TESTING.md) for the device checklist.

## Quick start (development)

Requires Node.js 22.12 or newer (the build tools for Electron 45 need it).

```bash
npm install        # also generates src/*/vendor (icons, CRC-32 for the phone)
npm start          # run the app
npm run dev        # run with DevTools and verbose logs
npm test           # 39 automated tests, run on Electron's own Node 24
npm run check      # syntax check of all sources
```

## Building installers

```bash
npm run build:linux                  # release/ENiShare-1.0.0-x86_64.AppImage + release/enishare_1.0.0_amd64.deb
npm run build:win                    # on Windows: release/ENiShare-Setup-1.0.0.exe
scripts/docker/build-windows.sh      # on Linux: the same Windows installer, built with Wine in Docker
```

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for step-by-step instructions for each platform.

## How it is built

* **Electron 45** desktop app. The UI uses vanilla HTML/CSS/JS, Lucide icons and the EN* family theme tokens.
* A separate **server utility process** runs Express 5, Socket.IO 4, the transfer engine and SQLite (Node's built-in `node:sqlite`, so there are **no native modules**).
* The **mobile web client** is vanilla JS with a chunked uploader using XHR progress and CRC-32.
* Image thumbnails come from Electron `nativeImage` in the main process.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/SECURITY.md](docs/SECURITY.md) · [docs/NETWORKING.md](docs/NETWORKING.md) · [docs/USB-LIMITATIONS.md](docs/USB-LIMITATIONS.md) · [docs/SMB-SETUP.md](docs/SMB-SETUP.md) · [docs/USER-MANUAL.md](docs/USER-MANUAL.md) · [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Project layout

```
src/main/       Electron main process: window, IPC, thumbnails, server supervisor, preload
src/server/     Server utility process: Express app, routes, services, DB, network, SMB/USB helpers
src/shared/     Code used by both processes: constants, logger, RPC, CRC-32
src/desktop/    Desktop UI (renderer)
src/mobile/     iPhone web client served by the server
tests/          node:test suites (api, transfer, network) + e2e phone simulation
scripts/        vendor, test runner, build scripts, Docker helpers
docs/           Documentation
```

## License

MIT © 2026 M. Estiaque Ahmed Khan · info@mestiaque.com · https://mestiaque.com
