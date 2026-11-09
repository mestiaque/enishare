import net from 'node:net';

/** Resolves true if the port can be bound on `host`. */
export function isPortFree(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

/** Finds the next free port after `start` (inclusive), or null. */
export async function findFreePort(start, host = '0.0.0.0', attempts = 50) {
  for (let p = start; p < start + attempts && p <= 65535; p++) {
    if (await isPortFree(p, host)) return p;
  }
  return null;
}

/** TCP connect test, used to check whether a local service (e.g. SMB on 445) is listening. */
export function canConnect(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}
