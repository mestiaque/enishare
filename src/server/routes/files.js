// File listing, download, preview, thumbnail and delete routes for the phone.
import express from 'express';
import fs from 'node:fs';
import { requireDevice, requireCsrf } from '../middleware/security.js';
import { Errors } from '../errors.js';

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

export function fileRoutes({ files, downloads, thumbnails, repos }) {
  const r = express.Router();
  r.use('/api/files', requireDevice);

  const checkId = (req, _res, next) => (ID_RE.test(req.params.id) ? next() : next(Errors.notFound()));

  r.get('/api/files/shared', async (_req, res) => {
    const list = await files.listShared();
    res.json({ files: list.map(({ source, deviceId, ...f }) => f) }); // never expose paths or link mode
  });

  r.get('/api/files/shared-zip', async (req, res) => {
    const ids = String(req.query.ids || '').split(',').filter((id) => ID_RE.test(id));
    await downloads.sendZip(req, res, req.device, ids);
  });

  r.get('/api/files/shared/:id', checkId, async (req, res) => {
    await downloads.sendFile(req, res, req.device, req.params.id, { inline: req.query.inline === '1' });
  });

  r.get('/api/files/:direction/:id/thumb', checkId, (req, res, next) => {
    const { direction, id } = req.params;
    if (direction !== 'shared' && direction !== 'received') return next(Errors.notFound());
    const rec = repos.files.getInDirection(id, direction);
    if (!rec || !rec.thumb_name) return next(Errors.notFound('Thumbnail'));
    if (direction === 'received' && rec.device_id !== req.device.id) return next(Errors.notFound('Thumbnail'));
    const p = thumbnails.pathOf(rec.thumb_name);
    if (!p || !fs.existsSync(p)) return next(Errors.notFound('Thumbnail'));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type('image/jpeg');
    fs.createReadStream(p).pipe(res);
  });

  // The phone sees only what it uploaded itself.
  r.get('/api/files/received', (req, res) => {
    res.json({ files: files.listReceived(req.device.id).map(({ source, deviceId, deviceName, ...f }) => f) });
  });

  r.delete('/api/files/received/:id', checkId, requireCsrf, async (req, res) => {
    await files.deleteReceived(req.params.id, req.device.id);
    res.json({ ok: true });
  });

  // Removing shared files is a desktop-only action.
  r.delete('/api/files/shared/:id', (_req, _res, next) => next(Errors.forbidden('Shared files can only be removed on the PC.')));

  return r;
}
