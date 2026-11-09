// Entry point of the server utility process (started by src/main/server-host.js).
// Talks to the main process over process.parentPort using the small RPC protocol in shared/rpc.js.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerCore } from './core.js';
import { createRpc } from '../shared/rpc.js';
import { createLogger } from '../shared/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { ENISHARE_STORAGE, ENISHARE_LOGS, ENISHARE_VERSION } = process.env;
const logger = createLogger(ENISHARE_LOGS || path.join(ENISHARE_STORAGE || '.', 'logs'), 'server');
const port = process.parentPort;

const rpc = createRpc({ send: (msg) => port.postMessage(msg), logger, timeoutMs: 60_000 });
port.on('message', (e) => rpc.receive(e.data));

process.on('uncaughtException', (err) => { logger.error('uncaught exception', err); });
process.on('unhandledRejection', (err) => { logger.error('unhandled rejection', err); });

let core;
try {
  core = createServerCore({
    storageRoot: ENISHARE_STORAGE,
    logger,
    version: ENISHARE_VERSION,
    mobileDir: path.join(here, '..', 'mobile'),
    // Image decoding happens in the main process (Electron nativeImage).
    thumbnailer: (src, dest) => rpc.call('thumbnail.make', { src, dest }).catch(() => false),
  });
} catch (err) {
  logger.error('server failed to start', err);
  rpc.emit('server:fatal', { code: err.code || 'STARTUP_FAILED', message: err.userMessage || 'The sharing service could not start.' });
  setTimeout(() => process.exit(1), 200);
}

if (core) {
  rpc.setHandlers({
    ...core.handlers,
    'process.shutdown': async () => {
      await core.shutdown();
      setTimeout(() => process.exit(0), 50);
      return true;
    },
  });
  core.events.on('*', (name, payload) => {
    // Socket-only events stay inside this process; everything else goes to the desktop UI.
    if (name === 'pairing:changed') return rpc.emit('server:state', core.serverState());
    rpc.emit(name, payload ?? null);
  });
  await core.init();
  rpc.emit('server:ready', { state: core.serverState() });
  logger.info('server process ready');
}
