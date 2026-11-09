// E2E helper: runs the real server core (no desktop UI) in a temp folder and starts sharing.
// Writes the QR pairing URL to <out>/pair-url.txt. Run with Electron's Node (ELECTRON_RUN_AS_NODE=1).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerCore } from '../../src/server/core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'enishare-e2e-'));
const root = path.join(out, 'storage');
const src = path.join(out, 'pc-files');
fs.mkdirSync(src, { recursive: true });
fs.writeFileSync(path.join(src, 'Quarterly report.pdf'), '%PDF-1.4\n% demo\n');
fs.writeFileSync(path.join(src, 'notes.txt'), 'Hello from the PC\n');
fs.copyFileSync(path.join(here, '..', '..', 'build', 'icon.png'), path.join(src, 'logo.png'));
fs.writeFileSync(path.join(src, 'big-video.mp4'), Buffer.alloc(3 * 1024 * 1024, 7));

const core = createServerCore({ storageRoot: root, mobileDir: path.join(here, '..', '..', 'src', 'mobile'), version: 'e2e', logger: console });
await core.init();
const iface = core.network.state.interfaces[0];
if (!iface) { console.error('no network interface'); process.exit(1); }
core.settings.update({ interfaceName: iface.name, port: Number(process.env.PORT || 8080) });
await core.network.refresh();
await core.files.addShared([src]);
await core.startSharing();
const state = core.serverState();
fs.writeFileSync(path.join(out, 'pair-url.txt'), state.pairUrl);
console.log(`READY ${state.pairUrl} storage=${root}`);
process.on('SIGTERM', async () => { await core.shutdown(); process.exit(0); });
