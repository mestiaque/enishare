# Troubleshooting

Start with **Wi-Fi Sharing → iPhone can't connect?**. It runs the checks below automatically.

| Problem | Cause | Fix |
|---|---|---|
| "No usable network connection" | PC not on Wi-Fi/Ethernet, or only virtual adapters | Connect to Wi-Fi; or pick the adapter on the Wi-Fi Sharing page |
| QR shows a 172.17.x / 192.168.56.x / 10.0.75.x address | Docker / VirtualBox / Hyper-V adapter chosen | Pick your Wi-Fi adapter on the Wi-Fi Sharing page |
| "Port 8080 is already used by another program" | Another app listens on 8080 | Settings → Server port → use the suggested free port |
| iPhone: "Safari cannot open the page" | Different network, AP isolation, firewall, VPN | Same Wi-Fi; disable AP isolation/VPN; Windows: set the network to *Private*; Ubuntu: `sudo ufw allow 8080/tcp` |
| "This QR code has expired or was already used" | QR codes are single-use and expire after 5 min | Scan the code currently on the PC, or press Refresh QR |
| Phone keeps going back to the pairing page | Session expired or revoked, or Safari cleared cookies (Private Browsing) | Scan again; avoid Private Browsing tabs |
| Upload stuck at "Waiting for connection…" | Wi-Fi dropped or the iPhone screen locked | Unlock the iPhone and keep Safari in front; it continues automatically |
| "This file could not be read on the iPhone" | iCloud photo not downloaded yet, or the file was moved | Open the photo in Photos first (it downloads), then pick it again |
| Upload refused: larger than the limit | Settings → Maximum upload size | Raise the limit |
| "The PC does not have enough free disk space" | Less than file size + 200 MB free | Free space or change the storage folder |
| Several downloads: only the first starts | Safari blocks rapid multiple downloads | Allow when Safari asks, or use **Download as ZIP** |
| Shared file shows "Missing" | The original was moved, renamed or deleted on the PC | Add it again |
| No thumbnail for HEIC/WEBP on Ubuntu | nativeImage decodes JPEG/PNG only | `sudo apt install libheif-examples` for HEIC; files still transfer |
| "The sharing service could not start" | Storage folder not writable | Choose another folder (button shown), or fix permissions |
| "The sharing service restarted" | The server process crashed and was restarted | Send the logs (Settings → Logs) to info@mestiaque.com |
| AppImage does not start on Ubuntu 22.04 | FUSE 2 missing | `sudo apt install libfuse2` |
| Windows SmartScreen warning | Installer not code-signed | More info → Run anyway |

## Logs

Settings → Logs → **Open log folder**: `main.log` (desktop) and `server.log` (sharing service), rotated at 5 MB, 3 kept.
Ubuntu: `~/.config/ENiShare/logs` · Windows: `%APPDATA%\ENiShare\logs`.
Start with `npm run dev` (or `ENISHARE_DEV=1`) for verbose logging.
