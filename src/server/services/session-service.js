// Pairing (QR token / PIN), device sessions and online tracking.
//
// QR pairing token: 128-bit random, single use, short-lived. It is rotated as soon
// as a phone uses it, when it expires, and when the user presses "Refresh QR".
// Session: 256-bit random cookie value; only its SHA-256 is stored in the database.
import { randomId, sha256, safeEqual } from './ids.js';
import { DEVICE_ONLINE_WINDOW_MS } from '../../shared/constants.js';
import { AppError } from '../errors.js';

const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;

export function deviceNameFromUA(ua = '') {
  const model = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android phone'
    : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux PC' : 'Device';
  const browser = /CriOS/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /EdgiOS|Edg\//.test(ua) ? 'Edge'
    : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${model} · ${browser}`;
}

export function createSessionService({ repos, settings, events, logger }) {
  let pairToken = null; // { value, expiresAt }
  let rotateTimer = null;
  const pinFailures = new Map(); // ip -> { count, lockedUntil }
  const sockets = new Map(); // deviceId -> live socket count
  const touchCache = new Map(); // deviceId -> last DB touch, to throttle writes

  function rotatePairToken(reason = 'rotate') {
    const minutes = settings.get('pairTokenMinutes');
    pairToken = { value: randomId(16), expiresAt: Date.now() + minutes * 60_000 };
    clearTimeout(rotateTimer);
    rotateTimer = setTimeout(() => rotatePairToken('expired'), minutes * 60_000);
    rotateTimer.unref?.();
    logger.debug(`pairing token rotated (${reason})`);
    events.emit('pairing:changed', { expiresAt: pairToken.expiresAt });
    return pairToken;
  }

  function currentPairToken() {
    if (!pairToken || pairToken.expiresAt <= Date.now()) rotatePairToken('expired');
    return pairToken;
  }

  function createDevice({ ip, userAgent }) {
    const token = randomId(32);
    const now = Date.now();
    const device = {
      id: randomId(12),
      device_name: deviceNameFromUA(userAgent),
      session_id: sha256(token),
      csrf_token: randomId(24),
      ip_address: ip,
      user_agent: String(userAgent || '').slice(0, 300),
      expires_at: now + settings.get('sessionHours') * 3600_000,
      last_seen: now,
      created_at: now,
    };
    repos.devices.insert(device);
    logger.info(`device paired: ${device.device_name} from ${ip}`);
    events.emit('devices:changed', { reason: 'paired', device: publicDevice(device) });
    return { token, device };
  }

  function pairWithToken(value, ctx) {
    const t = currentPairToken();
    if (!value || !safeEqual(value, t.value)) {
      throw new AppError('PAIR_TOKEN_INVALID', 'This QR code has expired or was already used. Scan the current QR code on your PC.', 401);
    }
    rotatePairToken('used'); // single use
    return createDevice(ctx);
  }

  function pairWithPin(pin, ctx) {
    if (!settings.get('pinEnabled') || !settings.get('pin')) {
      throw new AppError('PIN_DISABLED', 'PIN pairing is turned off on the PC. Scan the QR code instead.', 403);
    }
    const f = pinFailures.get(ctx.ip) ?? { count: 0, lockedUntil: 0 };
    if (f.lockedUntil > Date.now()) {
      const mins = Math.ceil((f.lockedUntil - Date.now()) / 60_000);
      throw new AppError('PIN_LOCKED', `Too many wrong PINs. Try again in ${mins} minute(s).`, 429);
    }
    if (!/^\d{6}$/.test(String(pin)) || !safeEqual(String(pin), settings.get('pin'))) {
      f.count += 1;
      if (f.count >= PIN_MAX_FAILS) { f.lockedUntil = Date.now() + PIN_LOCK_MS; f.count = 0; }
      pinFailures.set(ctx.ip, f);
      logger.warn(`wrong pairing PIN from ${ctx.ip}`);
      throw new AppError('PIN_WRONG', 'Wrong PIN.', 401);
    }
    pinFailures.delete(ctx.ip);
    return createDevice(ctx);
  }

  /** Returns the device for a raw session token, or null if missing/expired/revoked. */
  function authenticate(token, ip) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const d = repos.devices.bySession(sha256(token));
    if (!d || d.revoked || d.expires_at <= Date.now()) return null;
    touch(d.id, ip);
    return d;
  }

  function touch(deviceId, ip) {
    const now = Date.now();
    const last = touchCache.get(deviceId) ?? 0;
    if (now - last < 15_000) return;
    touchCache.set(deviceId, now);
    repos.devices.touch(deviceId, ip ?? null, now);
  }

  function isOnline(d) {
    return (sockets.get(d.id) ?? 0) > 0 && Date.now() - Math.max(d.last_seen, touchCache.get(d.id) ?? 0) < DEVICE_ONLINE_WINDOW_MS;
  }

  function publicDevice(d) {
    return {
      id: d.id, name: d.device_name, ip: d.ip_address, lastSeen: Math.max(d.last_seen, touchCache.get(d.id) ?? 0),
      createdAt: d.created_at, expiresAt: d.expires_at, online: isOnline(d),
    };
  }

  return {
    currentPairToken,
    rotatePairToken,
    pairWithToken,
    pairWithPin,
    authenticate,
    touch,
    publicDevice,
    listDevices: () => repos.devices.listActive(Date.now()).map(publicDevice),
    onlineCount: () => repos.devices.listActive(Date.now()).filter(isOnline).length,
    renameDevice(id, name) {
      const clean = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
      if (!clean) throw new AppError('BAD_NAME', 'Enter a device name.');
      repos.devices.rename(id, clean);
      events.emit('devices:changed', { reason: 'renamed' });
      return clean;
    },
    revoke(id) {
      repos.devices.revoke(id);
      events.emit('session:revoked', { deviceId: id });
      events.emit('devices:changed', { reason: 'revoked' });
    },
    revokeAll() {
      repos.devices.revokeAll();
      events.emit('session:revoked', { all: true });
      events.emit('devices:changed', { reason: 'revoked' });
    },
    socketConnected(id) {
      const wasOnline = (sockets.get(id) ?? 0) > 0;
      sockets.set(id, (sockets.get(id) ?? 0) + 1);
      touchCache.set(id, 0);
      touch(id);
      if (!wasOnline) events.emit('devices:changed', { reason: 'connected', deviceId: id });
    },
    socketDisconnected(id) {
      const n = Math.max(0, (sockets.get(id) ?? 1) - 1);
      if (n) sockets.set(id, n); else sockets.delete(id);
      if (!n) events.emit('devices:changed', { reason: 'disconnected', deviceId: id });
    },
    stop() { clearTimeout(rotateTimer); },
  };
}
