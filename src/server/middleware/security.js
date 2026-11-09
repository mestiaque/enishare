// HTTP security layers, applied in this order:
//   1. LAN-only source address filter
//   2. Host header check (blocks DNS-rebinding attacks from web pages)
//   3. Security headers (CSP etc.)
//   4. Session authentication (cookie) and CSRF header check on state-changing requests
import net from 'node:net';
import rateLimit from 'express-rate-limit';
import { SESSION_COOKIE, CSRF_HEADER } from '../../shared/constants.js';
import { isPrivateIPv4 } from '../network/interfaces.js';
import { safeEqual } from '../services/ids.js';
import { AppError, Errors } from '../errors.js';

export function clientIp(req) {
  const raw = req.socket?.remoteAddress || '';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/** Only private (RFC 1918), loopback and the iPhone hotspot range may connect. */
export function isAllowedSource(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  return ip === '::1';
}

export function lanOnly(logger) {
  return (req, res, next) => {
    const ip = clientIp(req);
    if (isAllowedSource(ip)) return next();
    logger.warn(`blocked request from non-LAN address ${ip}`);
    res.status(403).type('text/plain').send('ENiShare only accepts connections from your local network.');
  };
}

export function hostCheck() {
  return (req, res, next) => {
    const host = String(req.headers.host || '');
    const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
    if (net.isIP(name) || name === 'localhost') return next();
    res.status(421).type('text/plain').send('Open ENiShare using the IP address shown on your PC.');
  };
}

export function securityHeaders() {
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:",
    "media-src 'self' blob:", "connect-src 'self' ws: wss:", "frame-src 'self'", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.removeHeader('X-Powered-By');
    next();
  };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie */ }
  }
  return out;
}

export function sessionCookie(token, maxAgeSec) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** Attaches req.device when a valid session cookie is present (does not reject). */
export function loadSession(sessions) {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.device = token ? sessions.authenticate(token, clientIp(req)) : null;
    next();
  };
}

export function requireDevice(req, _res, next) {
  if (!req.device) return next(Errors.unauthorized());
  next();
}

/** Double protection against cross-site requests: SameSite=Strict cookie + this header token. */
export function requireCsrf(req, _res, next) {
  const sent = req.headers[CSRF_HEADER];
  if (!req.device || !sent || !safeEqual(sent, req.device.csrf_token)) {
    return next(new AppError('CSRF', 'Security check failed. Reload the page and try again.', 403));
  }
  next();
}

export function pairingLimiter() {
  return rateLimit({
    windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (req) => clientIp(req),
    handler: (_req, _res, next) => next(new AppError('RATE_LIMIT', 'Too many attempts. Wait a minute and try again.', 429)),
  });
}

export function apiLimiter() {
  // Generous: one big upload is many chunk requests.
  return rateLimit({
    windowMs: 60_000, limit: 3000, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: (req) => clientIp(req),
    handler: (_req, _res, next) => next(new AppError('RATE_LIMIT', 'Too many requests. Slow down a little.', 429)),
  });
}

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    const appErr = err instanceof AppError ? err
      : err?.type === 'entity.too.large' ? new AppError('BAD_REQUEST', 'Request too large.', 413)
        : err?.type === 'entity.parse.failed' ? new AppError('BAD_REQUEST', 'Invalid request body.', 400)
          : new AppError('INTERNAL', 'Something went wrong on the PC. Please try again.', 500, err);
    if (appErr.status >= 500) logger.error(`${req.method} ${req.path} failed`, err);
    else logger.debug(`${req.method} ${req.path} → ${appErr.status} ${appErr.code}`);
    if (res.headersSent) { res.destroy(); return; }
    res.status(appErr.status === 499 ? 400 : appErr.status).json({ error: { code: appErr.code, message: appErr.userMessage } });
  };
}
