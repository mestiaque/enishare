// Test helpers: a fresh server core in a temp folder, plus a paired "phone" agent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createServerCore } from '../src/server/core.js';
import { createApp } from '../src/server/app.js';
import { createDownloadService } from '../src/server/services/download-service.js';
import { createThumbnailService } from '../src/server/services/thumbnail-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const mobileDir = path.join(here, '..', 'src', 'mobile');

export function tempDir(prefix = 'enishare-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function makeCore() {
  const root = tempDir();
  const core = createServerCore({ storageRoot: root, mobileDir, version: 'test' });
  const thumbnails = createThumbnailService({ storage: core.storage, thumbnailer: null, logger: console });
  const app = createApp({
    sessions: core.sessions, settings: core.settings, files: core.files, uploads: core.uploads,
    downloads: createDownloadService({ files: core.files, transfers: core.transfers, logger: console }),
    thumbnails, repos: core.repos, logger: { info() {}, warn() {}, error: console.error, debug() {} }, mobileDir, version: 'test',
  });
  return { core, app, root, cleanup: async () => { await core.shutdown(); fs.rmSync(root, { recursive: true, force: true }); } };
}

/** Pairs through the real QR URL flow and returns an agent with the session cookie + CSRF token. */
export async function pairPhone(app, core, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1') {
  const agent = request.agent(app);
  const token = core.sessions.currentPairToken().value;
  const res = await agent.get(`/p/${token}`).set('Host', '192.168.1.10:8080').set('User-Agent', ua);
  if (res.status !== 303 || res.headers.location !== '/') throw new Error(`pairing failed: ${res.status} ${res.headers.location}`);
  const s = await agent.get('/api/session').set('Host', '192.168.1.10:8080');
  return { agent, csrf: s.body.csrfToken, device: s.body.device };
}

export const HOST = '192.168.1.10:8080';
