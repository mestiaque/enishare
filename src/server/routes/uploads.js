// Upload routes (chunked + simple multipart).
import express from 'express';
import { requireDevice, requireCsrf } from '../middleware/security.js';
import { Errors } from '../errors.js';

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

export function uploadRoutes({ uploads, logger }) {
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

  // Diagnostics from the phone (read stalls, retries) so problems on the iPhone show up in server.log.
  const logBudget = new Map(); // deviceId -> { windowStart, count }
  r.post('/api/client-log', requireDevice, requireCsrf, express.json({ limit: '4kb' }), (req, res) => {
    const now = Date.now();
    const b = logBudget.get(req.device.id) ?? { windowStart: now, count: 0 };
    if (now - b.windowStart > 60_000) { b.windowStart = now; b.count = 0; }
    b.count += 1;
    logBudget.set(req.device.id, b);
    if (b.count <= 30) {
      const msg = String(req.body?.message ?? '').replace(/[\r\n]+/g, ' ').slice(0, 500);
      const level = req.body?.level === 'error' ? 'error' : req.body?.level === 'info' ? 'info' : 'warn';
      logger[level](`[phone ${req.device.device_name}] ${msg}`, req.body?.extra ?? undefined);
    }
    res.status(204).end();
  });

  return r;
}
