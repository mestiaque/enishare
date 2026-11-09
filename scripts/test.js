// Runs the test suite with Electron's bundled Node (same runtime and node:sqlite as the app).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron'); // path to the Electron binary
const files = process.argv.slice(2);
const targets = files.length ? files : fs.readdirSync('tests', { recursive: true })
  .filter((f) => f.endsWith('.test.js')).map((f) => path.join('tests', f));

const r = spawnSync(electron, ['--test', '--test-concurrency=1', ...targets], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(r.status ?? 1);
