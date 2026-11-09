// Small rotating file logger shared by the main and server processes.
// Technical details go to the log file; users only ever see friendly messages.
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

export function createLogger(dir, name) {
  let file = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, `${name}.log`);
  } catch {
    file = null; // logging must never crash the app
  }

  function rotate() {
    try {
      if (!file || !fs.existsSync(file) || fs.statSync(file).size < MAX_BYTES) return;
      for (let i = KEEP - 1; i >= 1; i--) {
        const from = `${file}.${i}`;
        if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i + 1}`);
      }
      fs.renameSync(file, `${file}.1`);
    } catch { /* ignore */ }
  }

  function write(level, msg, extra) {
    let line = `${new Date().toISOString()} [${level}] ${msg}`;
    if (extra instanceof Error) line += `\n${extra.stack || extra.message}`;
    else if (extra !== undefined) {
      try { line += ` ${JSON.stringify(extra)}`; } catch { line += ` ${String(extra)}`; }
    }
    if (process.env.ENISHARE_DEV || level === 'ERROR') {
      (level === 'ERROR' ? console.error : console.log)(`[${name}] ${line}`);
    }
    if (!file) return;
    rotate();
    try { fs.appendFileSync(file, line + '\n'); } catch { /* ignore */ }
  }

  return {
    file,
    info: (m, e) => write('INFO', m, e),
    warn: (m, e) => write('WARN', m, e),
    error: (m, e) => write('ERROR', m, e),
    debug: (m, e) => { if (process.env.ENISHARE_DEV) write('DEBUG', m, e); },
  };
}

export const nullLogger = { file: null, info() {}, warn() {}, error() {}, debug() {} };
