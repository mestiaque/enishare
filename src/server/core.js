// Wires all server services together. Used by the utility-process entry (index.js)
// and directly by the tests. Has no Electron dependency.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { createStorage } from './storage/paths.js';
import { openDatabase } from './database/db.js';
import { createRepositories } from './database/repositories.js';
import { createSettingsService } from './config/settings-service.js';
import { createSessionService } from './services/session-service.js';
import { createTransferManager } from './services/transfer-manager.js';
import { createThumbnailService } from './services/thumbnail-service.js';
import { createFileService } from './services/file-service.js';
import { createUploadService } from './services/upload-service.js';
import { createDownloadService } from './services/download-service.js';
import { createNetworkMonitor } from './network/monitor.js';
import { isPortFree, findFreePort } from './network/port.js';
import { createApp } from './app.js';
import { attachSockets } from './sockets/index.js';
import { detectUsb } from './protocols/usb.js';
import { smbStatus, smbEnable, smbDisable } from './protocols/smb.js';
import { run, powershell } from './protocols/exec.js';
import { freeSpace } from './storage/disk.js';
import { AppError } from './errors.js';
import { nullLogger } from '../shared/logger.js';

function createBus() {
  const map = new Map();
  return {
    on(name, fn) { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); },
    off(name, fn) { map.get(name)?.delete(fn); },
    emit(name, payload) {
      for (const fn of map.get(name) ?? []) fn(payload);
      for (const fn of map.get('*') ?? []) fn(name, payload);
    },
  };
}

export function createServerCore({ storageRoot, logger = nullLogger, thumbnailer = null, mobileDir, version = '0.0.0', dbFile }) {
  const events = createBus();
  const storage = createStorage(storageRoot);
  storage.ensure();
  const db = openDatabase(dbFile ?? path.join(storage.dirs.database, 'enishare.db'), logger);
  const repos = createRepositories(db);

  let http$ = null; // { server, sockets, host, port }
  let lastError = null;
  let startedAt = null;
  const timers = [];

  const settings = createSettingsService(repos, (changed) => onSettingsChanged(changed));
  const sessions = createSessionService({ repos, settings, events, logger });
  const transfers = createTransferManager({ repos, settings, events });
  const thumbnails = createThumbnailService({ storage, thumbnailer, logger });
  const files = createFileService({ repos, storage, settings, thumbnails, events, logger });
  const uploads = createUploadService({ repos, storage, settings, files, transfers, events, logger });
  const downloads = createDownloadService({ files, transfers, logger });
  const network = createNetworkMonitor({
    settings, logger,
    onChange: (state, { previousAddress }) => {
      events.emit('network:changed', publicNetwork());
      if (http$ && settings.get('bindMode') === 'selected' && state.selection.address !== http$.host) {
        logger.info('selected interface address changed, restarting listener');
        void restartSharing();
      } else if (http$ && previousAddress !== state.selection.address) {
        events.emit('server:state', serverState());
      }
    },
  });

  // ---- crash/restart recovery -------------------------------------------------
  repos.transfers.pauseActiveUploads();
  repos.transfers.failActiveDownloads();
  repos.uploads.resetCompleting();
  cleanTemp();

  function cleanTemp() {
    const keep = repos.uploads.openTempPaths();
    try {
      for (const f of fs.readdirSync(storage.dirs.temp)) {
        const p = path.join(storage.dirs.temp, f);
        if (!keep.has(p)) fs.rmSync(p, { force: true, recursive: true });
      }
    } catch (err) { logger.warn('temp cleanup failed', err); }
  }

  function publicNetwork() {
    const { interfaces, selection } = network.state;
    return { interfaces, selection: { address: selection.address, source: selection.source, warning: selection.warning, iface: selection.iface?.name ?? null } };
  }

  function urls() {
    const address = network.state.selection.address;
    const port = http$?.port ?? settings.get('port');
    if (!address) return { url: null, pairUrl: null };
    const url = `http://${address}:${port}`;
    return { url, pairUrl: `${url}/p/${sessions.currentPairToken().value}` };
  }

  function serverState() {
    const { url, pairUrl } = urls();
    return {
      running: Boolean(http$), port: http$?.port ?? settings.get('port'), bindHost: http$?.host ?? null,
      address: network.state.selection.address, addressWarning: network.state.selection.warning,
      url, pairUrl: http$ ? pairUrl : null, pairExpiresAt: sessions.currentPairToken().expiresAt,
      startedAt, error: lastError, pcName: settings.pcName(), storageRoot: storage.root,
    };
  }

  function stats() {
    return {
      sharedCount: repos.files.count('shared'), receivedCount: repos.files.count('received'),
      totalBytes: repos.transfers.totalBytes(), activeTransfers: transfers.activeCount(),
      devicesOnline: sessions.onlineCount(), devicesPaired: sessions.listDevices().length,
    };
  }

  async function startSharing() {
    if (http$) return serverState();
    lastError = null;
    await network.refresh();
    const port = settings.get('port');
    const host = settings.get('bindMode') === 'selected' ? network.state.selection.address : '0.0.0.0';
    if (!host) {
      lastError = { code: 'NO_NETWORK', message: 'No usable network connection. Connect this PC to Wi-Fi (or the iPhone hotspot) first.' };
      events.emit('server:state', serverState());
      throw new AppError('NO_NETWORK', lastError.message);
    }
    if (!(await isPortFree(port, host))) {
      const suggestion = await findFreePort(port + 1, host);
      lastError = { code: 'PORT_IN_USE', message: `Port ${port} is already used by another program.`, suggestion };
      events.emit('server:state', serverState());
      throw new AppError('PORT_IN_USE', `Port ${port} is already used by another program.${suggestion ? ` Port ${suggestion} is free — change it in Settings.` : ''}`);
    }
    const app = createApp({ sessions, settings, files, uploads, downloads, thumbnails, repos, logger, mobileDir, version });
    const server = http.createServer(app);
    server.requestTimeout = 0; // large uploads/downloads may take a long time
    server.headersTimeout = 60_000;
    server.keepAliveTimeout = 10_000;
    const sockets = attachSockets(server, { sessions, events, logger });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port, host }, () => { server.off('error', reject); resolve(); });
    }).catch((err) => {
      lastError = { code: err.code || 'LISTEN_FAILED', message: err.code === 'EACCES' ? `Not allowed to use port ${port}.` : `Could not start the server (${err.code || err.message}).` };
      events.emit('server:state', serverState());
      throw new AppError(lastError.code, lastError.message);
    });
    http$ = { server, sockets, host, port };
    startedAt = Date.now();
    sessions.rotatePairToken('start');
    logger.info(`sharing started on ${host}:${port} (QR address ${network.state.selection.address})`);
    events.emit('server:state', serverState());
    return serverState();
  }

  async function stopSharing() {
    if (!http$) return serverState();
    const { server, sockets } = http$;
    http$ = null;
    startedAt = null;
    await sockets.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
    logger.info('sharing stopped');
    events.emit('server:state', serverState());
    return serverState();
  }

  async function restartSharing() {
    if (!http$) return;
    await stopSharing();
    try { await startSharing(); } catch (err) { logger.warn('restart after change failed', err.userMessage || err.message); }
  }

  function onSettingsChanged(changed) {
    if (changed.some((k) => ['interfaceName', 'manualIp', 'autoDetectIp'].includes(k))) {
      void network.refresh().then(() => events.emit('server:state', serverState()));
    }
    if (changed.some((k) => ['port', 'bindMode'].includes(k))) void restartSharing();
    if (changed.includes('pairTokenMinutes')) sessions.rotatePairToken('settings');
    events.emit('settings:changed', settings.publicView());
  }

  async function diagnostics() {
    const { url } = urls();
    const out = { url, running: Boolean(http$), checks: [] };
    out.checks.push({ id: 'network', label: 'Network connection', ok: Boolean(network.state.selection.address),
      detail: network.state.selection.address ? `${network.state.selection.iface?.label ?? 'Address'} ${network.state.selection.address}` : 'No usable network address' });
    out.checks.push({ id: 'server', label: 'Sharing server running', ok: Boolean(http$), detail: http$ ? `Listening on port ${http$.port}` : 'Press Start Sharing' });
    if (http$ && network.state.selection.address) {
      const ok = await new Promise((resolve) => {
        const req = http.get({ host: network.state.selection.address, port: http$.port, path: '/api/status', timeout: 3000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      out.checks.push({ id: 'self', label: 'Server reachable on the network address', ok, detail: ok ? 'Yes' : 'The PC cannot reach its own server on this address' });
    }
    if (process.platform === 'linux') {
      let ufw = 'unknown';
      try { ufw = /ENABLED\s*=\s*yes/i.test(fs.readFileSync('/etc/ufw/ufw.conf', 'utf8')) ? 'enabled' : 'disabled'; } catch { /* ufw not installed */ }
      out.checks.push({ id: 'firewall', label: 'UFW firewall', ok: ufw !== 'enabled', warn: ufw === 'enabled',
        detail: ufw === 'enabled' ? `UFW is on and may block the iPhone. ENiShare cannot read UFW rules without root; unless port ${settings.get('port')} is already allowed, run: sudo ufw allow ${settings.get('port')}/tcp` : ufw === 'disabled' ? 'Off (no rule needed)' : 'Not installed' });
    } else if (process.platform === 'win32') {
      const r = await powershell('Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory | ConvertTo-Json -Compress', { timeout: 8000 });
      let profiles = [];
      try { profiles = [].concat(JSON.parse(r.stdout || '[]')); } catch { /* */ }
      const pub = profiles.filter((p) => p.NetworkCategory === 0 || p.NetworkCategory === 'Public');
      out.checks.push({ id: 'firewall', label: 'Windows network profile', ok: pub.length === 0, warn: pub.length > 0,
        detail: pub.length ? `"${pub.map((p) => p.InterfaceAlias).join(', ')}" is a Public network. Windows Firewall blocks incoming connections there — set it to Private, or allow ENiShare when Windows asks.` : 'Private network' });
    }
    const free = await freeSpace(storage.root);
    out.checks.push({ id: 'disk', label: 'Free disk space', ok: free === null || free > 1024 ** 3, warn: free !== null && free <= 1024 ** 3,
      detail: free === null ? 'Unknown' : `${(free / 1024 ** 3).toFixed(1)} GB free in ${storage.root}` });
    out.tips = [
      'The iPhone and the PC must be on the same Wi-Fi network (not a guest network).',
      'Some routers block devices from talking to each other ("AP/client isolation"). Turn it off in the router, or use the iPhone hotspot.',
      'Turn off VPN apps on the iPhone or PC while sharing.',
    ];
    return out;
  }

  // Housekeeping
  timers.push(setInterval(() => uploads.watchdog(), 15_000));
  timers.push(setInterval(() => { void uploads.expireOld(); repos.devices.deleteStale(Date.now() - 30 * 86400_000); }, 10 * 60_000));
  timers.forEach((t) => t.unref?.());
  void uploads.expireOld();
  files.resumeHashing();

  /** Methods callable from the desktop UI through the main process. */
  const handlers = {
    'app.snapshot': async () => ({
      server: serverState(), network: publicNetwork(), settings: settings.publicView(), stats: stats(),
      devices: sessions.listDevices(), transfers: transfers.activeList(),
    }),
    'server.start': () => startSharing(),
    'server.stop': () => stopSharing(),
    'server.state': () => serverState(),
    'server.qr': async () => {
      const { pairUrl } = urls();
      if (!http$ || !pairUrl) return { svg: null, pairUrl: null };
      const svg = await QRCode.toString(pairUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
      return { svg, pairUrl, expiresAt: sessions.currentPairToken().expiresAt };
    },
    'pairing.refresh': () => { sessions.rotatePairToken('manual'); return serverState(); },
    'network.refresh': async () => { await network.refresh(); return publicNetwork(); },
    'network.diagnostics': () => diagnostics(),
    'settings.get': () => settings.publicView(),
    'settings.update': ({ patch }) => { settings.update(patch); return settings.publicView(); },
    'settings.reset': () => { settings.reset(); return settings.publicView(); },
    'settings.export': () => settings.exportable(),
    'settings.import': ({ data }) => { settings.importFile(data); return settings.publicView(); },
    'logs.dir': () => logger.file ? path.dirname(logger.file) : null,
    'stats.get': () => stats(),
    'devices.list': () => sessions.listDevices(),
    'devices.revoke': ({ id }) => { sessions.revoke(id); return sessions.listDevices(); },
    'devices.revokeAll': () => { sessions.revokeAll(); return sessions.listDevices(); },
    'shared.add': ({ paths }) => files.addShared(paths),
    'shared.list': () => files.listShared(),
    'shared.remove': ({ ids }) => Promise.all([].concat(ids).map((id) => files.removeShared(id))).then(() => true),
    'shared.rename': ({ id, name }) => files.renameShared(id, name),
    'received.list': () => files.listReceived(),
    'received.delete': ({ ids }) => Promise.all([].concat(ids).map((id) => files.deleteReceived(id))).then(() => true),
    'files.localPath': async ({ id }) => (await files.resolve(id)).path,
    'files.thumbPath': ({ id }) => {
      const rec = repos.files.get(id);
      return rec?.thumb_name ? thumbnails.pathOf(rec.thumb_name) : null;
    },
    'transfers.active': () => transfers.activeList(),
    'transfers.history': ({ limit = 100, offset = 0, direction = null }) => ({
      items: repos.transfers.list(Math.min(500, limit), offset, direction), total: repos.transfers.countAll(direction),
    }),
    'transfers.clear': () => { repos.transfers.clearFinished(); events.emit('stats:changed'); return true; },
    'usb.status': async () => detectUsb(network.state.interfaces, http$?.port ?? settings.get('port')),
    'smb.status': () => smbStatus(settings.get('smbShareName')),
    'smb.enable': () => smbEnable(settings.get('smbShareName'), storage.root),
    'smb.disable': () => smbDisable(settings.get('smbShareName')),
    'system.which': ({ name }) => run(process.platform === 'win32' ? 'where' : 'which', [name]).then((r) => r.ok),
  };

  return {
    events, handlers, settings, sessions, repos, storage, files, uploads, transfers, network,
    startSharing, stopSharing, serverState, stats,
    async init() {
      await network.start();
      if (settings.get('autoStart')) {
        try { await startSharing(); } catch (err) { logger.warn('auto start failed', err.userMessage || err.message); }
      }
    },
    async shutdown() {
      timers.forEach(clearInterval);
      network.stop();
      sessions.stop();
      await stopSharing();
      await files.stop();
      try { db.close(); } catch { /* already closed */ }
    },
    get httpServer() { return http$?.server ?? null; },
  };
}
