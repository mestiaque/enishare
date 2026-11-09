# Installation

## Users

### Windows 10/11

1. Run `ENiShare-Setup-1.0.0.exe`. The installer is not code-signed yet, so SmartScreen may show *Windows protected your PC*. Click *More info → Run anyway*.
2. Choose the install folder. The installer creates a desktop shortcut, a Start-menu entry and a firewall rule for **private** networks.
3. Start ENiShare from the Start menu. Uninstall it from *Settings → Apps*; the firewall rule is removed too. Your files in `Downloads\ENiShare` are kept.
4. Optional: for USB, install **Apple Devices** from the Microsoft Store.

### Ubuntu 22.04 and newer

```bash
# .deb (adds a menu entry, updates through the package manager)
sudo apt install ./enishare_1.0.0_amd64.deb
# uninstall: sudo apt remove enishare

# or AppImage (no install)
chmod +x ENiShare-1.0.0-x86_64.AppImage
./ENiShare-1.0.0-x86_64.AppImage
```

On Ubuntu 22.04 the AppImage needs FUSE 2: `sudo apt install libfuse2`. On Ubuntu 24.04 use `libfuse2t64`.
Optional: `sudo apt install usbmuxd libimobiledevice-utils` (USB), `libheif-examples` (HEIC thumbnails), `samba` (Files app access).
If UFW is enabled: `sudo ufw allow 8080/tcp`. ENiShare runs as your normal user and never needs root.

## Developers

### Prerequisites

* **Node.js 22.12+** and npm. Electron 45's install script and electron-builder need it.
  * Ubuntu: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`, or use nvm: `nvm install 22`.
  * Windows: install "Node.js 22 LTS" from nodejs.org (it includes npm).
* Git.

There are no native npm modules, so no compiler or Python is needed.

### Commands

```bash
npm install             # dependencies + generated vendor files (icons, CRC-32)
npm start               # run
npm run dev             # run with DevTools and verbose logs (ENISHARE_DEV)
npm test                # automated tests (Electron's Node 24, node:sqlite)
npm run check           # syntax check
```

### Production builds

| Target | Command | Output |
|---|---|---|
| Ubuntu AppImage + .deb | `npm run build:linux` | `release/ENiShare-1.0.0-x86_64.AppImage`, `release/enishare_1.0.0_amd64.deb` |
| Windows installer (on Windows) | `npm run build:win` | `release/ENiShare-Setup-1.0.0.exe` |
| Windows installer (on Linux) | `scripts/docker/build-windows.sh` | same (uses the `electronuserland/builder:wine` Docker image) |

Code signing is not configured. For a signed Windows build, set electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables.

### Headless checks on Linux (no Xvfb on the host)

`scripts/docker/run.sh` runs commands in a local build container that has Xvfb:

```bash
scripts/docker/run.sh 'scripts/docker/smoke.sh'              # desktop screenshots → .cache/shots
scripts/docker/run.sh 'scripts/docker/smoke-seeded.sh'       # same, with sharing on and sample files
scripts/docker/run.sh 'tests/e2e/run-e2e.sh'                 # simulated iPhone: pair, upload 20 MB, compare bytes
```
