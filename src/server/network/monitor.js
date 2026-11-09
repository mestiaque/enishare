// Polls the network interfaces (Node has no change event) and reports changes.
import { NETWORK_POLL_MS } from '../../shared/constants.js';
import { listInterfaces, chooseAddress } from './interfaces.js';

export function createNetworkMonitor({ settings, logger, onChange }) {
  let timer = null;
  let state = { interfaces: [], selection: { address: null, source: 'none', warning: 'NO_NETWORK' } };
  let signature = '';

  async function refresh() {
    try {
      const interfaces = await listInterfaces();
      const selection = chooseAddress(interfaces, settings.all());
      const sig = JSON.stringify([interfaces.map((i) => [i.name, i.address, i.kind]), selection.address, selection.warning]);
      const previous = state.selection.address;
      state = { interfaces, selection };
      if (sig !== signature) {
        signature = sig;
        if (previous && selection.address && previous !== selection.address) {
          logger.info(`IP address changed ${previous} → ${selection.address}`);
        }
        onChange(state, { previousAddress: previous });
      }
    } catch (err) {
      logger.warn('network refresh failed', err);
    }
    return state;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(refresh, NETWORK_POLL_MS);
      timer.unref?.();
      return refresh();
    },
    stop() { clearInterval(timer); timer = null; },
    refresh,
    get state() { return state; },
  };
}
