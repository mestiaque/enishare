// Syntax-checks every JavaScript file in src/ and scripts/ (fast pre-commit sanity check).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const files = ['src', 'scripts', 'tests'].flatMap((d) => fs.readdirSync(d, { recursive: true })
  .map((f) => path.join(d, f)).filter((f) => /\.(c|m)?js$/.test(f) && !f.includes('vendor')));
let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (err) { failed++; console.error(String(err.stderr)); }
}
console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
