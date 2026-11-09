// Starts and supervises the server utility process and relays its events to the UI.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utilityProcess } from 'electron';
import { createRpc } from '../shared/rpc.js';
import { makeThumbnail } from './thumbnailer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, '..', 'server', 'index.js');

export function createServerHost({ logger, logsDir, version, onEvent }) {
  let child = null;
  let rpc = null;
  let ready = null; // promise resolved on 'server:ready'
  let stopping = false;
  let storageRoot = null;
  let restarts = 0;

  function start(root) {
    storageRoot = root;
    stopping = false;
    child = utilityProcess.fork(ENTRY, [], {
      serviceName: 'ENiShare Server',
      stdio: 'pipe',
      env: { ...process.env, ENISHARE_STORAGE: root, ENISHARE_LOGS: logsDir, ENISHARE_VERSION: version },
    });
    child.stdout?.on('data', (d) => logger.info(`[server stdout] ${String(d).trim()}`));
    child.stderr?.on('data', (d) => logger.warn(`[server stderr] ${String(d).trim()}`));

    const thisChild = child;
    rpc = createRpc({
      send: (msg) => thisChild.postMessage(msg),
      logger,
      handlers: { 'thumbnail.make': ({ src, dest }) => makeThumbnail(src, dest) },
    });
    thisChild.on('message', (msg) => rpc.receive(msg));

    let resolveReady; let rejectReady;
    ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
    ready.catch(() => {});
    rpc.onEvent((name, payload) => {
      if (name === 'server:ready') { restarts = 0; resolveReady(payload); }
      if (name === 'server:fatal') rejectReady(Object.assign(new Error(payload.message), { userMessage: payload.message, code: payload.code }));
      onEvent(name, payload);
    });

    thisChild.on('exit', (code) => {
      if (thisChild !== child) return;
      rpc.failAll('server process exited');
      child = null;
      rejectReady(Object.assign(new Error('Server process exited'), { userMessage: 'The sharing service stopped.' }));
      if (stopping) return;
      logger.error(`server process exited unexpectedly (code ${code})`);
      onEvent('server:crashed', { code });
      if (restarts < 3) {
        restarts += 1;
        setTimeout(() => { if (!child && !stopping) start(storageRoot); }, 1000 * restarts);
      }
    });
    return ready;
  }

  async function stop() {
    if (!child) return;
    stopping = true;
    const c = child;
    try {
      await Promise.race([rpc.call('process.shutdown'), new Promise((r) => setTimeout(r, 4000))]);
    } catch { /* process may already be gone */ }
    await new Promise((resolve) => {
      if (!child) return resolve();
      const t = setTimeout(() => { try { c.kill(); } catch { /* */ } resolve(); }, 1500);
      c.once('exit', () => { clearTimeout(t); resolve(); });
    });
    child = null;
  }

  return {
    start,
    stop,
    async restart(root) { await stop(); return start(root ?? storageRoot); },
    async call(method, params) {
      if (!child) {
        if (stopping) throw Object.assign(new Error('stopped'), { userMessage: 'The sharing service is not running.' });
        await start(storageRoot);
      }
      await ready;
      return rpc.call(method, params);
    },
    get running() { return Boolean(child); },
    get storageRoot() { return storageRoot; },
  };
}
