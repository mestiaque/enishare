// USB / Cable. Shows only what real checks report. Never shows a fake "connected" state.
import { state, api } from '../store.js';
import { icon, esc, toast, checkRow, cmdRow, wireCopyButtons, busy } from '../ui.js';

let root; let ctx; let timer = null; let status = null; let tab = null; let loading = false;

const STATE_TEXT = {
  ready: { cls: 'ok', icon: 'circle-check', title: 'USB network ready', text: 'The iPhone\'s Personal Hotspot is connected over the cable. Safari on the iPhone can open ENiShare at the address below.' },
  'device-no-network': { cls: 'warn', icon: 'plug-zap', title: 'iPhone connected, but no USB network yet', text: 'Turn on Personal Hotspot on the iPhone (Settings → Personal Hotspot → Allow Others to Join). Keep the cable connected and tap "Trust" if the iPhone asks.' },
  'driver-missing': { cls: 'err', icon: 'circle-exclamation-point', title: 'iPhone found, but the USB network driver is missing', text: 'Install the driver for your system (see the steps below), then reconnect the cable.' },
  'no-device': { cls: '', icon: 'unplug', title: 'No iPhone detected on USB', text: 'Connect the iPhone with a cable. You can always use Wi-Fi instead.' },
  'unsupported-platform': { cls: '', icon: 'unplug', title: 'USB detection is not available on this system', text: 'Use Wi-Fi sharing instead.' },
  unknown: { cls: 'warn', icon: 'triangle-exclamation-point', title: 'Could not check USB devices', text: 'Windows did not answer the device query. Use Wi-Fi sharing, or try again.' },
};

async function poll() {
  if (loading) return;
  loading = true;
  try {
    status = await api.call('usb.status');
    if (root) render();
  } catch (err) {
    if (root && !status) { status = { state: 'unknown', checks: [], urls: [] }; render(); }
    console.warn(err);
  } finally { loading = false; }
}

function windowsSteps() {
  return `<ol class="steps">
    <li>Install <b>Apple Devices</b> from the Microsoft Store (or iTunes). It contains the "Apple Mobile Device Ethernet" driver.</li>
    <li>Connect the iPhone with a USB cable, unlock it and tap <b>Trust</b>.</li>
    <li>On the iPhone: <b>Settings → Personal Hotspot → Allow Others to Join</b>. (Wi-Fi on the iPhone can stay on; mobile data must allow hotspot.)</li>
    <li>Windows adds a new network adapter. When it shows up here, press <b>Use USB network</b> and scan the QR code.</li>
    <li>If Windows asks whether to allow ENiShare on the network, choose <b>Private networks</b>.</li>
  </ol>`;
}

function ubuntuSteps() {
  return `<ol class="steps">
    <li>Install the pairing service (one time):</li>
  </ol>
  ${cmdRow('sudo apt install usbmuxd libimobiledevice-utils')}
  <ol class="steps" start="2">
    <li>Connect the iPhone with a USB cable, unlock it and tap <b>Trust</b>. If it does not ask, run <code>idevicepair pair</code>.</li>
    <li>On the iPhone: <b>Settings → Personal Hotspot → Allow Others to Join</b>.</li>
    <li>Ubuntu creates a wired connection using the <code>ipheth</code> driver (included in the Ubuntu kernel). When it shows up here, press <b>Use USB network</b>.</li>
    <li>If UFW is enabled, allow the port:</li>
  </ol>
  ${cmdRow(`sudo ufw allow ${state.settings?.port ?? 8080}/tcp`)}`;
}

function render() {
  const s = status;
  const meta = STATE_TEXT[s?.state] ?? null;
  const usingUsb = state.network?.interfaces?.find((i) => i.name === state.network?.selection?.iface)?.kind === 'iphone-usb';
  root.innerHTML = `
    <div class="card">
      <h2>${icon('cable', 16)} Cable status <span class="badge info" style="margin-left:6px">Experimental</span>
        <span class="grow"></span><button class="btn sm ghost" id="recheck">${icon('refresh-cw', 14)} Check again</button></h2>
      ${!s ? `<div class="empty">${icon('loader-circle', 24, 'spin')}<div>Checking USB devices…</div></div>` : `
        <div class="alert ${meta?.cls ?? ''}">${icon(meta?.icon ?? 'info', 18)}<div><b>${esc(meta?.title ?? '')}</b>${esc(meta?.text ?? '')}</div></div>
        <div class="checks">${(s.checks || []).map(checkRow).join('')}</div>
        ${s.state === 'ready' ? `
          <div class="section-label">Open on the iPhone</div>
          ${s.urls.map((u) => `<div class="url-box mt-s"><span class="grow selectable">${esc(u)}</span></div>`).join('')}
          <div class="row mt">
            ${usingUsb ? `<span class="badge ok">${icon('check', 12)} QR code uses the USB network</span><button class="btn" data-go="wifi">${icon('qr-code', 16)} Show QR code</button>`
              : `<button class="btn primary" id="use-usb">${icon('cable', 16)} Use USB network for the QR code</button>`}
            ${state.server?.running ? '' : `<span class="small muted">Sharing is off — start it on the Dashboard.</span>`}
          </div>` : ''}`}
    </div>
    <div class="card">
      <h2>${icon('info', 16)} How a cable connection works</h2>
      <p class="muted" style="margin-top:0">Plugging in a cable alone does <b>not</b> create a network between the PC and the iPhone, and Safari cannot reach the PC through iTunes/usbmuxd connections.
        The only way that needs no iPhone app is the iPhone's <b>Personal Hotspot over USB</b>: the iPhone becomes a USB network adapter, and Safari opens ENiShare through it. Files travel over the cable.</p>
      <ul class="steps">
        <li><b>Needs:</b> Personal Hotspot available on the iPhone (some carriers or iPhones without a SIM hide it).</li>
        <li><b>Not possible without an iPhone app:</b> reverse USB tunnels, usbmuxd/iproxy port forwarding to the PC, mounting the PC in the Files app over USB.</li>
        <li><b>Alternative:</b> Wi-Fi sharing works the same way and needs no cable.</li>
      </ul>
    </div>
    <div class="card">
      <div class="row" style="margin-bottom:10px"><h2 style="margin:0" class="grow">${icon('list-checks', 16)} Setup steps</h2>
        <div class="tabs"><button data-tab="win" class="${tab === 'win' ? 'active' : ''}">Windows</button><button data-tab="linux" class="${tab === 'linux' ? 'active' : ''}">Ubuntu</button></div></div>
      ${tab === 'win' ? windowsSteps() : ubuntuSteps()}
    </div>`;
  const recheck = root.querySelector('#recheck');
  recheck.onclick = busy(recheck, async () => { await api.call('network.refresh'); await poll(); });
  for (const b of root.querySelectorAll('[data-tab]')) b.onclick = () => { tab = b.dataset.tab; render(); };
  for (const a of root.querySelectorAll('[data-go]')) a.onclick = () => ctx.go(a.dataset.go);
  const use = root.querySelector('#use-usb');
  if (use) {
    use.onclick = busy(use, async () => {
      const iface = state.network.interfaces.find((i) => i.kind === 'iphone-usb');
      if (!iface) throw new Error('The USB network disappeared. Check again.');
      await api.call('settings.update', { patch: { interfaceName: iface.name, autoDetectIp: true, manualIp: '' } });
      toast({ kind: 'success', title: 'QR code now uses the USB network' });
    });
  }
  wireCopyButtons(root);
}

export default {
  subtitle: 'Share over a USB cable using the iPhone Personal Hotspot',
  mount(el, c) {
    root = el; ctx = c; status = null; tab = navigator.platform.startsWith('Win') ? 'win' : 'linux';
    render();
    poll();
    timer = setInterval(poll, 5000);
  },
  update(what) { if (root && ['network', 'settings', 'server'].includes(what)) render(); },
  unmount() { clearInterval(timer); root = null; },
};
