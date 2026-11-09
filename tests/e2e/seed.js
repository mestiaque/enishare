// Prepares a storage folder for desktop UI smoke tests: picks the first network interface,
// enables auto-start and shares a few sample files. Run with ELECTRON_RUN_AS_NODE=1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerCore } from '../../src/server/core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.argv[2];
const src = path.join(path.dirname(root), 'sample-files');
fs.mkdirSync(src, { recursive: true });
fs.copyFileSync(path.join(here, '../../build/icon.png'), path.join(src, 'ENiShare logo.png'));
fs.copyFileSync(path.join(here, '../../build/icons/128x128.png'), path.join(src, 'small icon.png'));
fs.writeFileSync(path.join(src, 'Invoice 2026.pdf'), '%PDF-1.4\n');
fs.writeFileSync(path.join(src, 'Budget.xlsx'), 'PK');
fs.writeFileSync(path.join(src, 'Holiday video.mp4'), Buffer.alloc(5_000_000, 1));
const core = createServerCore({ storageRoot: root, mobileDir: path.join(here, '../../src/mobile') });
await core.network.refresh();
core.settings.update({ interfaceName: core.network.state.interfaces[0]?.name ?? '', autoStart: true, theme: process.env.THEME || 'dark' });
await core.files.addShared([src]);
await core.shutdown();
console.log('seeded', root);
