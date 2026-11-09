# Testing

Status words: **Implemented** (code complete) · **Tested (auto)** (automated tests pass) · **Tested (device)** (checked on a real iPhone/PC) · **Partial** · **Experimental** · **Not supported**.

## Automated (run on every change)

`npm test` runs 39 tests with Electron's bundled Node 24:

| Suite | Covers |
|---|---|
| `tests/api/pairing-security.test.js` | Unpaired redirect + 401; single-use QR token; session cookie flags; CSRF required; Host-header check; LAN address filter; PIN enable, success, lockout; revocation; phone cannot delete shared files; security headers |
| `tests/transfer/uploads.test.js` | 3-chunk upload byte-identical + SHA-256; duplicate names → `(1)`; corrupt chunk 422 then resend; resume after "reload"; wrong chunk size/index; cancel deletes temp; size limit 413; path-traversal names; device isolation; multipart multi-file upload; stats |
| `tests/transfer/downloads.test.js` | Recursive folder share, hidden files skipped, no path leakage; exact bytes + attachment header; UTF-8 (Bangla) names (RFC 5987); Range 206; inline PDF but never HTML; ZIP; bad IDs 404; moved file → 410 "Missing"; linked originals never deleted; copy mode; rename |
| `tests/network/network.test.js` | Interface classification (Linux + Windows descriptions, iPhone USB, Docker, Hyper-V, VPN); address choice never auto-selects virtual/VPN; manual IP; port conflict → next free port; filename sanitising; safeJoin; Content-Disposition; CRC-32 check value |

### End-to-end with a simulated iPhone

`scripts/docker/run.sh 'tests/e2e/run-e2e.sh'` starts the real server and opens an Electron window with an iPhone user agent and screen size. It pairs through the QR URL, uploads a 20 MB file plus a CSV through the real `<input type=file>`, waits for "2 of 2 sent", opens the download tab and preview, and finally compares the received files **byte for byte**. Last result: pass. This is Chromium, **not Safari**, so it does not replace the device tests below.

### Desktop UI smoke test

`scripts/docker/run.sh 'scripts/docker/smoke-seeded.sh "<xdotool steps>"'` launches the app under Xvfb with sharing on and saves screenshots to `.cache/shots/`. The packaged `release/linux-unpacked` build was checked the same way (server, pairing page, socket.io client and static assets served from inside the asar).

## Manual device checklist

Fill in the results; until then these items stay at *Implemented*.

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Windows PC → iPhone | Share files, download from Safari | File in Files → Downloads, correct name/size | ☐ |
| 2 | iPhone → Windows PC | Select Photos (3+), Select Documents (PDF, DOCX) | Files in `Downloads\ENiShare\Received`, thumbnails for JPG/PNG | ☐ |
| 3 | Ubuntu PC → iPhone | as 1 | as 1 | ☐ |
| 4 | iPhone → Ubuntu PC | as 2 | as 2 | ☐ |
| 5 | Multiple images | 20 photos at once | All arrive; overall progress correct | ☐ |
| 6 | Multiple documents | 10 mixed documents | All arrive | ☐ |
| 7 | Large file | 2–4 GB video | Arrives; RAM use of ENiShare stays flat | ☐ |
| 8 | Interrupted transfer | Turn Wi-Fi off mid-upload for 30 s, then on | Item shows "Waiting for connection…", continues from the last chunk | ☐ |
| 9 | Resumable after reload | Reload Safari mid-upload, pick the same file again | Continues instead of restarting | ☐ |
| 10 | QR connection | Camera app scan | Safari opens the app; the QR on the PC changes | ☐ |
| 11 | IP change | Switch the PC to another Wi-Fi | QR/URL update; phone reconnects after scanning again | ☐ |
| 12 | Several devices | Two iPhones uploading | Both listed as online; each sees only its own uploads | ☐ |
| 13 | Deletion | Delete a received file on the phone, then on the PC | Removed from disk and lists | ☐ |
| 14 | Security | Revoke a device; try an old QR; enable PIN and enter it wrong 5× | Revoked phone goes to /pair; old QR rejected; lockout message | ☐ |
| 15 | SMB via iOS Files | SMB-SETUP.md steps | Browse/read/write the ENiShare share | ☐ |
| 16a | USB on Windows | Apple Devices installed, hotspot on | USB screen "ready", Safari opens 172.20.10.x | ☐ |
| 16b | USB on Ubuntu | usbmuxd installed, hotspot on | as 16a | ☐ |
| 17 | Multiple downloads in Safari | Select 3 → One by one; then Download as ZIP | Safari prompt/behaviour noted; ZIP opens in Files | ☐ |
| 18 | HEIC | Upload HEIC (camera format "High Efficiency") | File arrives; thumbnail only if codec/heif-convert present | ☐ |
| 19 | Windows firewall | Fresh install on a *Public* network | Diagnostics warn; works after switching to Private | ☐ |
