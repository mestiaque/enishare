// Express application factory. Has no Electron dependency, so tests can run it directly.
import express from 'express';
import path from 'node:path';
import { lanOnly, hostCheck, securityHeaders, loadSession, apiLimiter, errorHandler } from './middleware/security.js';
import { pairRoutes } from './routes/pair.js';
import { fileRoutes } from './routes/files.js';
import { uploadRoutes } from './routes/uploads.js';
import { Errors } from './errors.js';

export function createApp(ctx) {
  const { sessions, settings, logger, mobileDir, version } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('trust proxy', false);

  app.use(lanOnly(logger));
  app.use(hostCheck());
  app.use(securityHeaders());
  app.use(loadSession(sessions));
  app.use('/api', apiLimiter());

  app.get('/api/status', (_req, res) => res.json({ app: 'ENiShare', pcName: settings.pcName(), version, time: Date.now() }));

  app.use(pairRoutes({ sessions, settings, mobileDir, version }));
  app.use(fileRoutes(ctx));
  app.use(uploadRoutes(ctx));

  // The app shell needs a session; everything else in src/mobile is static and harmless.
  app.get(['/', '/index.html'], (req, res) => {
    if (!req.device) return res.redirect(303, '/pair');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(mobileDir, 'index.html'));
  });
  app.use(express.static(mobileDir, { index: false, dotfiles: 'deny', maxAge: '1h' }));

  app.use('/api', (_req, _res, next) => next(Errors.notFound('Endpoint')));
  app.use(errorHandler(logger));
  return app;
}
