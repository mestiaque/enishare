// Builds the Windows NSIS installer (x64) into release/.
// On Windows this needs nothing extra. On Linux, electron-builder needs Wine to write the
// icon and version info into ENiShare.exe; use the electronuserland/builder:wine image
// (see docs/INSTALLATION.md) or pass --no-edit to skip that step.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const noEdit = args.includes('--no-edit');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(process.execPath, ['scripts/vendor.js'], { stdio: 'inherit' });
execFileSync(npx, ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never',
  ...(noEdit ? ['-c.win.signAndEditExecutable=false'] : []), ...args.filter((a) => a !== '--no-edit')], { stdio: 'inherit' });
