// Downloads to the phone: streamed files with Range support, inline previews, and a
// streamed ZIP for "download selected" (Safari often blocks several downloads at once).
import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import { contentDisposition } from '../storage/sanitize.js';
import { Errors, AppError } from '../errors.js';

// Types that could run script if rendered inline from our origin — always downloaded instead.
const NEVER_INLINE = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|application\/javascript|text\/javascript)/i;
const INLINE_OK = /^(image\/|application\/pdf|video\/|audio\/|text\/plain|text\/csv)/i;

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start; let end;
  if (m[1] === '') { // suffix range: last N bytes
    const n = Number(m[2]);
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

export function createDownloadService({ files, transfers, logger }) {
  return {
    async sendFile(req, res, device, id, { inline = false } = {}) {
      const { rec, path: filePath, size } = await files.resolve(id, 'shared');
      const mimeType = rec.mime_type || 'application/octet-stream';
      const asInline = inline && INLINE_OK.test(mimeType) && !NEVER_INLINE.test(mimeType);

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', contentDisposition(asInline ? 'inline' : 'attachment', rec.original_name));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Last-Modified', new Date(rec.file_mtime || rec.created_at).toUTCString());

      let start = 0; let end = size - 1;
      const range = req.headers.range ? parseRange(req.headers.range, size) : null;
      if (range === 'invalid') {
        res.setHeader('Content-Range', `bytes */${size}`);
        throw new AppError('RANGE', 'Requested range not satisfiable.', 416);
      }
      if (range) {
        ({ start, end } = range);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      const length = size === 0 ? 0 : end - start + 1;
      res.setHeader('Content-Length', String(length));
      if (req.method === 'HEAD' || length === 0) { res.end(); return; }

      // History rows only for real downloads (not inline previews or partial media requests).
      const track = !asInline && start === 0;
      const transferId = track ? transfers.begin({ direction: 'download', fileName: rec.original_name, total: length, device, fileId: rec.id }) : null;
      let sent = 0;
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('data', (chunk) => {
        sent += chunk.length;
        if (transferId) transfers.progress(transferId, sent);
      });
      stream.on('error', (err) => {
        logger.error(`download read error ${rec.original_name}`, err);
        if (transferId) transfers.fail(transferId, 'failed', 'Could not read the file on the PC.');
        res.destroy(err);
      });
      res.on('close', () => {
        stream.destroy();
        if (!transferId) return;
        if (res.writableFinished && sent === length) transfers.complete(transferId);
        else transfers.fail(transferId, 'cancelled', 'Download stopped before it finished');
      });
      stream.pipe(res);
    },

    async sendZip(req, res, device, ids) {
      const unique = [...new Set(ids)].slice(0, 500);
      if (!unique.length) throw Errors.badRequest('No files selected.');
      const entries = [];
      for (const id of unique) {
        try { entries.push(await files.resolve(id, 'shared')); } catch { /* skip missing files */ }
      }
      if (!entries.length) throw Errors.notFound('Files');
      const total = entries.reduce((n, e) => n + e.size, 0);
      const zipName = `ENiShare-${new Date().toISOString().slice(0, 10)}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', contentDisposition('attachment', zipName));
      res.setHeader('Cache-Control', 'private, no-store');

      const transferId = transfers.begin({ direction: 'download', fileName: `${zipName} (${entries.length} files)`, total, device });
      const archive = new ZipArchive({ store: true, forceZip64: total > 0xfffffff0 }); // store only: photos/videos are already compressed
      const used = new Set();
      let sentPayload = 0;
      archive.on('progress', (p) => { sentPayload = p.fs.processedBytes; transfers.progress(transferId, sentPayload); });
      archive.on('warning', (w) => logger.warn('zip warning', w.message));
      archive.on('error', (err) => {
        logger.error('zip error', err);
        transfers.fail(transferId, 'failed', 'Could not create the ZIP file.');
        res.destroy(err);
      });
      res.on('close', () => {
        if (res.writableFinished) transfers.complete(transferId);
        else { archive.abort(); transfers.fail(transferId, 'cancelled', 'Download stopped before it finished'); }
      });
      archive.pipe(res);
      for (const e of entries) {
        let name = e.rec.original_name;
        const ext = path.extname(name);
        for (let i = 1; used.has(name.toLowerCase()); i++) name = `${path.basename(e.rec.original_name, ext)} (${i})${ext}`;
        used.add(name.toLowerCase());
        archive.file(e.path, { name, date: new Date(e.rec.file_mtime || e.rec.created_at) });
      }
      await archive.finalize();
    },
  };
}
