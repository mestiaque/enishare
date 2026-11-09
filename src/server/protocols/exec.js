import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** execFile wrapper that never throws: resolves { ok, code, stdout, stderr }. */
export function run(cmd, args, { timeout = 10_000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
    });
  });
}

/** Runs a PowerShell script passed as -EncodedCommand (no quoting/injection problems). */
export function powershell(script, opts) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], opts);
}

/** Single-quoted PowerShell string literal. */
export const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Finds an executable in PATH plus the usual sbin directories (Ubuntu keeps smbd in /usr/sbin). */
export function which(name) {
  const dirs = [...String(process.env.PATH || '').split(path.delimiter), '/usr/sbin', '/sbin', '/usr/local/sbin'];
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* keep looking */ }
  }
  return null;
}
