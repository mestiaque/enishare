// In-app updates from GitHub releases (mestiaque/enishare), same design as the other EN* apps.
//
// * check()   – asks the GitHub API for the latest release. This is ENiShare's only internet
//               request, and it only happens when the user allows it (Settings → General) or
//               presses "Check now".
// * install() – downloads the file for this kind of install, verifies the SHA-256 that GitHub
//               publishes for every release asset, and installs it in place:
//                 .deb      → `pkexec apt-get install` (Ubuntu asks for the password)
//                 AppImage  → the AppImage file is replaced atomically
//                 Windows   → the NSIS installer runs silently after ENiShare quits
// * restart() – starts the new version.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, net } from 'electron';
import { updateFromRelease, RELEASES_PAGE } from './update-logic.js';

const API_LATEST = 'https://api.github.com/repos/mestiaque/enishare/releases/latest';

/** How this copy was installed, which decides how it can update itself. */
export function installKind() {
  if (!app.isPackaged) return { kind: 'dev' };
  if (process.platform === 'win32') {
    const dir = path.dirname(process.execPath);
    return fs.existsSync(path.join(dir, 'Uninstall ENiShare.exe')) ? { kind: 'windows' } : { kind: 'unmanaged' };
  }
  if (process.env.APPIMAGE) return { kind: 'appimage', file: process.env.APPIMAGE };
  if (process.execPath.startsWith('/opt/') && fs.existsSync('/usr/bin/apt-get')) return { kind: 'deb' };
  return { kind: 'unmanaged' };
}

const userAgent = () => `ENiShare/${app.getVersion()} (update check)`;

export async function check() {
  const res = await net.fetch(API_LATEST, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent() } });
  if (res.status === 404) return { info: null, note: 'No ENiShare release has been published yet' };
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const rel = await res.json();
  return { info: updateFromRelease(rel, app.getVersion(), installKind().kind), note: '' };
}

async function download(info, onProgress) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enishare-update-'));
  const file = path.join(dir, info.assetName);
  const res = await net.fetch(info.url, { headers: { 'User-Agent': userAgent() } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || info.size || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let done = 0;
  let last = 0;
  for await (const chunk of res.body) {
    const buf = Buffer.from(chunk);
    hash.update(buf);
    done += buf.length;
    if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
    if (Date.now() - last > 200) { last = Date.now(); onProgress({ done, total }); }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  onProgress({ done, total });
  const digest = hash.digest('hex');
  if (digest !== info.sha256) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('The downloaded file did not match its published checksum. Nothing was installed.');
  }
  return file;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(Object.assign(new Error(`${cmd} exited with ${code}`), { code }))));
  });
}

/** Returns 'installed' (restart to use it) or 'exiting' (ENiShare quits and the installer takes over). */
export async function install(info, onProgress) {
  const { kind, file: appImage } = installKind();
  if (!info?.installable || kind !== info.kind) throw new Error('This copy of ENiShare cannot update itself.');
  const file = await download(info, onProgress);
  onProgress({ done: 1, total: 1, phase: 'installing' });
  if (kind === 'deb') {
    try {
      await run('pkexec', ['apt-get', 'install', '-y', '--allow-downgrades', file]);
    } catch (err) {
      if (err.code === 126 || err.code === 127) throw new Error('The password prompt was cancelled. Nothing was installed.');
      throw new Error('Ubuntu could not install the update. Install the .deb from the release page instead.');
    }
    return 'installed';
  }
  if (kind === 'appimage') {
    const next = `${appImage}.new`;
    fs.copyFileSync(file, next);
    fs.chmodSync(next, 0o755);
    fs.renameSync(next, appImage);
    return 'installed';
  }
  if (kind === 'windows') {
    // Silent install after this process exits; --force-run starts ENiShare again afterwards.
    spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 500);
    return 'exiting';
  }
  throw new Error('This copy of ENiShare cannot update itself.');
}

export function restart() {
  const { kind, file } = installKind();
  if (kind === 'appimage') app.relaunch({ execPath: file, args: [] });
  else app.relaunch();
  app.quit();
}

export { RELEASES_PAGE };
