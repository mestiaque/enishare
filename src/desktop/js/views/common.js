// Pieces used by more than one view.
import { state, api } from '../store.js';
import { icon, esc, fmtBytes, fmtSpeed, fmtEta, fmtAgo, kindIcon, toast, toastError, confirmDialog, busy } from '../ui.js';

export function activeTransfersHtml() {
  const list = [...state.transfers.values()];
  if (!list.length) return `<div class="empty">${icon('arrow-up-down', 26)}<div>No active transfers</div></div>`;
  return list.map((t) => {
    const up = t.direction === 'upload';
    const status = t.status === 'paused' ? '<span class="badge warn">Paused</span>' : `${fmtSpeed(t.speed)} · ${esc(fmtEta(t.eta))}`;
    return `<div class="transfer">
      <span class="${up ? 'k-image' : 'k-document'}" title="${up ? 'iPhone → PC' : 'PC → iPhone'}">${icon(up ? 'arrow-down' : 'arrow-up', 20)}</span>
      <div class="grow"><div class="row"><b class="ellipsis grow">${esc(t.fileName)}</b><span class="small muted">${fmtBytes(t.bytes)} / ${fmtBytes(t.total)}</span></div>
        <div class="progress"><i style="width:${t.percent}%"></i></div>
        <div class="tiny faint mt-s">${up ? 'From' : 'To'} ${esc(t.deviceName || 'device')}</div></div>
      <div class="small muted" style="min-width:120px;text-align:right">${status}</div></div>`;
  }).join('');
}

export function devicesHtml() {
  if (!state.devices.length) return `<div class="empty">${icon('smartphone', 26)}<div>No paired devices yet.<br>Start sharing and scan the QR code with your iPhone.</div></div>`;
  return `<div class="checks">${state.devices.map((d) => `
    <div class="transfer">
      <span>${icon('smartphone', 20)}</span>
      <div class="grow"><div class="row"><b>${esc(d.name)}</b>${d.online ? '<span class="badge ok"><span class="dot on"></span>Online</span>' : '<span class="badge">Offline</span>'}</div>
        <div class="tiny faint">${esc(d.ip || '')} · last seen ${esc(fmtAgo(d.lastSeen))}</div></div>
      <button class="btn sm danger" data-revoke="${esc(d.id)}" title="Disconnect this device and require a new QR scan">${icon('log-out', 14)} Disconnect</button>
    </div>`).join('')}</div>`;
}

export function wireDevices(root) {
  for (const b of root.querySelectorAll('[data-revoke]')) {
    b.onclick = busy(b, async () => {
      const d = state.devices.find((x) => x.id === b.dataset.revoke);
      if (!(await confirmDialog('Disconnect device?', `${d?.name ?? 'This device'} will have to scan the QR code again to reconnect.`, { okLabel: 'Disconnect', danger: true }))) return;
      state.devices = await api.call('devices.revoke', { id: b.dataset.revoke });
      toast({ kind: 'success', title: 'Device disconnected' });
    });
  }
}

export async function toggleSharing(btn) {
  try {
    btn.disabled = true;
    if (state.server?.running) await api.call('server.stop');
    else {
      await api.call('server.start');
      toast({ kind: 'success', title: 'Sharing started', detail: 'Scan the QR code on the Wi-Fi Sharing page with your iPhone camera.' });
    }
  } catch (err) {
    toastError(err, 'Could not start sharing');
  } finally {
    btn.disabled = false;
  }
}

export const WARNINGS = {
  NO_NETWORK: 'No network connection found. Connect this PC to Wi-Fi or Ethernet (or the iPhone\'s USB hotspot).',
  ONLY_VIRTUAL: 'Only virtual or VPN adapters were found. Connect to Wi-Fi, or pick an interface manually in Settings.',
  SELECTED_INTERFACE_GONE: 'The network interface chosen in Settings is not available. Using the best available one instead.',
  MANUAL_IP_NOT_FOUND: 'The manual IP address in Settings does not belong to this PC right now. The iPhone may not be able to connect.',
};

export { kindIcon };
