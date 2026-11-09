// Upload routes (chunked + simple multipart).
import express from 'express';
import { requireDevice, requireCsrf } from '../middleware/security.js';
import { Errors } from '../errors.js';

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

export function uploadRoutes({ uploads }) {
  const r = express.Router();
  const checkId = (req, _res, next) => (ID_RE.test(req.params.id) ? next() : next(Errors.notFound('Upload')));

  r.post('/api/upload', requireDevice, requireCsrf, async (req, res) => {
    res.json(await uploads.handleMultipart(req.device, req));
  });

  r.post('/api/uploads', requireDevice, requireCsrf, express.json({ limit: '8kb' }), async (req, res) => {
    res.status(201).json(await uploads.createSession(req.device, req.body));
  });

  r.get('/api/uploads/:id', requireDevice, checkId, (req, res) => {
    res.json(uploads.status(req.device, req.params.id));
  });

  r.put('/api/uploads/:id/chunks/:index', requireDevice, requireCsrf, checkId, async (req, res) => {
    res.json(await uploads.writeChunk(req.device, req.params.id, req.params.index, req));
  });

  r.post('/api/uploads/:id/complete', requireDevice, requireCsrf, checkId, async (req, res) => {
    res.json(await uploads.complete(req.device, req.params.id));
  });

  r.delete('/api/uploads/:id', requireDevice, requireCsrf, checkId, async (req, res) => {
    res.json(await uploads.cancel(req.device, req.params.id));
  });

  return r;
}
