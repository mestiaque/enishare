// Builds the Ubuntu packages: AppImage and .deb (x64) into release/.
import { execFileSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(process.execPath, ['scripts/vendor.js'], { stdio: 'inherit' });
execFileSync(npx, ['electron-builder', '--linux', 'AppImage', 'deb', '--x64', '--publish', 'never', ...process.argv.slice(2)], { stdio: 'inherit' });
