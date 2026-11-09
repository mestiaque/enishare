// Socket.IO: authenticated with the same session cookie as HTTP.
// A socket connection alone is never treated as proof of a device — devices are
// sessions with last-seen timestamps; the socket only adds "online right now".
import { Server } from 'socket.io';
import net from 'node:net';
import { SESSION_COOKIE } from '../../shared/constants.js';
import { parseCookies, isAllowedSource } from '../middleware/security.js';

export function attachSockets(httpServer, { sessions, events, logger }) {
  const io = new Server(httpServer, {
    serveClient: true,
    cors: { origin: false },
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, cb) => {
      const raw = req.socket.remoteAddress || '';
      const ip = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
      const host = String(req.headers.host || '').split(':')[0];
      cb(null, isAllowedSource(ip) && (net.isIP(host) > 0 || host === 'localhost'));
    },
  });

  io.use((socket, next) => {
    const token = parseCookies(socket.request.headers.cookie)[SESSION_COOKIE];
    const raw = socket.request.socket.remoteAddress || '';
    const device = sessions.authenticate(token, raw.replace(/^::ffff:/, ''));
    if (!device) return next(new Error('unauthorized'));
    socket.data.device = device;
    socket.data.token = token;
    next();
  });

  io.on('connection', (socket) => {
    const device = socket.data.device;
    socket.join(`device:${device.id}`);
    sessions.socketConnected(device.id);
    logger.debug(`socket connected ${device.device_name}`);

    socket.on('heartbeat', () => {
      const ip = (socket.request.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const still = sessions.authenticate(socket.data.token, ip);
      if (!still) {
        socket.emit('session:revoked');
        socket.disconnect(true);
        return;
      }
      sessions.touch(device.id, ip);
    });
    socket.on('disconnect', () => sessions.socketDisconnected(device.id));
  });

  const forward = (name, payload) => {
    switch (name) {
      case 'files:shared:changed':
      case 'files:received:changed':
        io.emit(name, {});
        break;
      case 'transfer:progress':
      case 'transfer:done':
      case 'transfer:error':
        if (payload?.deviceId) io.to(`device:${payload.deviceId}`).emit(name, payload);
        break;
      case 'session:revoked':
        if (payload?.all) { io.emit('session:revoked'); io.disconnectSockets(true); } else if (payload?.deviceId) {
          io.to(`device:${payload.deviceId}`).emit('session:revoked');
          io.in(`device:${payload.deviceId}`).disconnectSockets(true);
        }
        break;
      default:
    }
  };
  events.on('*', forward);

  return {
    io,
    close() {
      events.off('*', forward);
      io.emit('server:stopping');
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}
