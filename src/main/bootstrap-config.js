// The one setting that cannot live in the database: where the database (and all
// ENiShare files) are stored. Kept in <userData>/config.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

const file = () => path.join(app.getPath('userData'), 'config.json');

export function defaultStorageRoot() {
  // %USERPROFILE%\Downloads\ENiShare on Windows, ~/Downloads/ENiShare on Ubuntu.
  // Without an XDG download folder Electron returns the home folder; use ~/Downloads then.
  let downloads = app.getPath('downloads');
  if (path.resolve(downloads) === path.resolve(os.homedir())) downloads = path.join(os.homedir(), 'Downloads');
  return path.join(downloads, 'ENiShare');
}

export function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return { ...cfg, storageRoot: cfg.storageRoot || defaultStorageRoot(), windowBounds: cfg.windowBounds ?? null, lastUpdateCheck: Number(cfg.lastUpdateCheck) || 0 };
  } catch {
    return { storageRoot: defaultStorageRoot(), windowBounds: null, lastUpdateCheck: 0 };
  }
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}
