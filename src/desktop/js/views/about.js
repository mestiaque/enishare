import { api } from '../store.js';
import { icon, esc } from '../ui.js';

let root;

const FEATURES = [
  ['Wi-Fi sharing (Safari / Chrome on iPhone)', 'Implemented', 'ok'],
  ['QR pairing, optional PIN, sessions', 'Implemented', 'ok'],
  ['Chunked, resumable uploads with checksums', 'Implemented', 'ok'],
  ['Downloads with Range support, ZIP of selection', 'Implemented', 'ok'],
  ['USB via iPhone Personal Hotspot', 'Experimental', 'warn'],
  ['iPhone Files app via SMB (OS SMB service)', 'Experimental', 'warn'],
  ['HEIC thumbnails on the PC', 'Partial', 'warn'],
  ['USB without Personal Hotspot / reverse tunnel', 'Not supported (needs an iPhone app)', 'err'],
  ['WebDAV mounting in iOS Files', 'Not supported by iOS', 'err'],
];

async function render() {
  let info = {};
  try { info = await api.appInfo(); } catch { /* */ }
  if (!root) return;
  root.innerHTML = `
    <div class="card"><div class="row" style="gap:18px">
      <img class="about-logo" src="assets/icon.svg" alt="">
      <div class="grow"><h2 style="font-size:20px;margin:0">ENiShare</h2>
        <div class="muted">Share files between your PC and iPhone — no iPhone app, no cloud.</div>
        <div class="small faint mt-s">Version ${esc(info.version || '')} · Electron ${esc(info.electron || '')} · Node ${esc(info.node || '')} · ${esc(info.platform || '')} ${esc(info.arch || '')}</div></div>
    </div></div>

    <div class="card"><h2>${icon('shield', 16)} Privacy</h2>
      <div class="muted">ENiShare works entirely on your local network. Files go directly between your iPhone and this PC; nothing is uploaded to any server or cloud service, and ENiShare makes no internet requests.</div>
    </div>

    <div class="card"><h2>${icon('list-checks', 16)} Feature status</h2>
      <div class="checks">${FEATURES.map(([f, s, c]) => `<div class="row" style="padding:7px 0;border-bottom:1px solid rgb(var(--line))"><span class="grow">${esc(f)}</span><span class="badge ${c}">${esc(s)}</span></div>`).join('')}</div>
      <div class="tiny faint mt-s">"Implemented" means automated tests pass on this build. Behaviour on a real iPhone, Windows firewall and USB drivers still needs testing on your devices.</div>
    </div>

    <div class="section-label">Developer</div>
    <div class="card" style="padding:4px 16px">
      <div class="setting"><span>Developed by</span><span class="muted" style="justify-self:end">M. Estiaque Ahmed Khan</span></div>
      <div class="setting"><span>Contact</span><a style="justify-self:end" id="mail">info@mestiaque.com</a></div>
      <div class="setting"><span>Website</span><a style="justify-self:end" id="web">mestiaque.com</a></div>
      <div class="setting"><span>Also by the developer<div class="hint">ENViewer · ENPlayer · ENDownloader</div></span><span class="muted" style="justify-self:end">EN* apps</span></div>
      <div class="setting"><span>License</span><span class="muted" style="justify-self:end">© 2026 M. Estiaque Ahmed Khan · MIT</span></div>
    </div>`;
  root.querySelector('#mail').onclick = () => api.openExternal('mailto:info@mestiaque.com');
  root.querySelector('#web').onclick = () => api.openExternal('https://mestiaque.com');
}

export default {
  subtitle: '',
  mount(el) { root = el; render(); },
  unmount() { root = null; },
};
