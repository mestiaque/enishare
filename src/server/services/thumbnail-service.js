// Thumbnails for images. Decoding is done by the Electron main process (nativeImage),
// reached through an injected `thumbnailer(src, dest)` function, so the server stays free of
// native image libraries. Outside Electron (tests) no thumbnailer is injected and files simply
// have no thumbnail.
import fs from 'node:fs';
import { fileKind } from '../../shared/constants.js';
import { safeJoin } from '../storage/paths.js';

export function createThumbnailService({ storage, thumbnailer, logger }) {
  const queue = [];
  let running = false;

  async function run() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      try {
        const dest = safeJoin(storage.dirs.thumbnails, `${job.id}.jpg`);
        const ok = await thumbnailer(job.src, dest);
        if (ok && fs.existsSync(dest)) job.done(`${job.id}.jpg`);
      } catch (err) {
        logger.debug(`thumbnail failed for ${job.src}`, err?.message);
      }
    }
    running = false;
  }

  return {
    enabled: typeof thumbnailer === 'function',
    /** Queues a thumbnail; `done(thumbName)` is called when it exists. */
    request(id, src, name, done) {
      if (typeof thumbnailer !== 'function' || fileKind(name) !== 'image') return;
      queue.push({ id, src, done });
      void run();
    },
    pathOf(thumbName) {
      return thumbName ? safeJoin(storage.dirs.thumbnails, thumbName) : null;
    },
    remove(thumbName) {
      if (!thumbName) return;
      try { fs.unlinkSync(safeJoin(storage.dirs.thumbnails, thumbName)); } catch { /* already gone */ }
    },
  };
}
