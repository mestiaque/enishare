// Pairing and session routes.
import express from 'express';
import path from 'node:path';
import { clientIp, sessionCookie, clearSessionCookie, requireDevice, requireCsrf, pairingLimiter } from '../middleware/security.js';
import { AppError } from '../errors.js';

export function pairRoutes({ sessions, settings, mobileDir, version }) {
  const r = express.Router();
  const limiter = pairingLimiter();

  // QR code target. Valid token → session cookie → app.
  r.get('/p/:token', limiter, (req, res, next) => {
    try {
      const { token } = sessions.pairWithToken(req.params.token, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
      res.setHeader('Set-Cookie', sessionCookie(token, settings.get('sessionHours') * 3600));
      res.redirect(303, '/');
    } catch (err) {
      if (req.device) return res.redirect(303, '/'); // already paired: an old QR code is harmless
      if (err instanceof AppError) return res.redirect(303, `/pair?reason=${encodeURIComponent(err.code)}`);
      next(err);
    }
  });

  r.get('/pair', (req, res) => {
    if (req.device) return res.redirect(303, '/');
    res.sendFile(path.join(mobileDir, 'pair.html'));
  });

  r.get('/api/pair/info', (_req, res) => {
    res.json({ pcName: settings.pcName(), pinEnabled: Boolean(settings.get('pinEnabled') && settings.get('pin')), version });
  });

  r.post('/api/pair/pin', limiter, express.json({ limit: '2kb' }), (req, res) => {
    const { token } = sessions.pairWithPin(req.body?.pin, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
    res.setHeader('Set-Cookie', sessionCookie(token, settings.get('sessionHours') * 3600));
    res.json({ ok: true });
  });

  r.get('/api/session', requireDevice, (req, res) => {
    res.json({
      device: { id: req.device.id, name: req.device.device_name, expiresAt: req.device.expires_at },
      pcName: settings.pcName(),
      csrfToken: req.device.csrf_token,
      limits: { maxUploadBytes: settings.get('maxUploadMB') * 1024 * 1024, maxConcurrent: settings.get('maxConcurrent') },
      version,
    });
  });

  r.patch('/api/session', requireDevice, requireCsrf, express.json({ limit: '2kb' }), (req, res) => {
    res.json({ name: sessions.renameDevice(req.device.id, req.body?.deviceName) });
  });

  r.delete('/api/session', requireDevice, requireCsrf, (req, res) => {
    sessions.revoke(req.device.id);
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  return r;
}
