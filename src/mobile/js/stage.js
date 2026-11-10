// Phone-side transfer visual: thin progress bar under the header (iPhone → PC fills from the
// right, PC → iPhone from the left) and a stage with the PC on the left, this iPhone on the
// right and file icons flying between them while anything transfers.
import { icon, esc, fmtBytes, kindOf, kindIcon } from './util.js';

export function createPhoneStage({ uploader, downloads, pcName, connected }) {
  const bar = document.getElementById('xfer-bar');
  const el = document.getElementById('stage');
  el.innerHTML = `
    <div class="end pc"><div class="dev">${icon('monitor', 24)}</div><small class="ellipsis"></small></div>
    <div class="lane"><div class="track"></div><div class="fliers"></div><div class="lane-label"></div></div>
    <div class="end phone"><div class="dev">${icon('smartphone', 24)}</div><small>This iPhone</small></div>`;
  const fliers = el.querySelector('.fliers');
  const pcEnd = el.querySelector('.end.pc');
  const phoneEnd = el.querySelector('.end.phone');
  let timer = null;
  let flip = false;

  function totals() {
    const inn = { bytes: 0, total: 0, speed: 0, names: [] };
    const out = { bytes: 0, total: 0, speed: 0, names: [] };
    for (const i of uploader.items) {
      if (!['queued', 'starting', 'uploading', 'verifying', 'waiting'].includes(i.status)) continue;
      inn.bytes += i.sent; inn.total += i.size;
      if (i.status === 'uploading') { inn.speed += i.speed || 0; inn.names.push(i.name); }
    }
    for (const d of downloads.values()) {
      if (d.status !== 'active') continue;
      out.bytes += d.bytes || 0; out.total += d.total || 0; out.speed += d.speed || 0; out.names.push(d.fileName);
    }
    for (const s of [inn, out]) s.percent = s.total ? Math.min(100, (s.bytes / s.total) * 100) : 0;
    return { inn, out };
  }

  function spawn(dir, name) {
    if (fliers.childElementCount > 6) return;
    const f = document.createElement('div');
    f.className = `flier ${dir === 'in' ? 'rtl' : 'ltr'}`;
    f.innerHTML = kindIcon(kindOf(name || ''), 14);
    f.addEventListener('animationend', () => {
      f.remove();
      const target = dir === 'in' ? pcEnd : phoneEnd;
      target.classList.remove('catch');
      void target.offsetWidth;
      target.classList.add('catch');
    });
    fliers.append(f);
  }

  function tick() {
    const { inn, out } = totals();
    const dirs = [];
    if (inn.names.length) dirs.push(['in', inn.names]);
    if (out.names.length) dirs.push(['out', out.names]);
    if (!dirs.length) return;
    flip = !flip;
    const [dir, names] = dirs[flip ? 0 : dirs.length - 1];
    spawn(dir, names[Math.floor(Math.random() * names.length)]);
  }

  function update() {
    const { inn, out } = totals();
    const busy = inn.total > 0 || out.total > 0;
    const moving = inn.names.length > 0 || out.names.length > 0;
    // header bar
    const [barOut, barIn] = bar.querySelectorAll('i');
    barOut.style.width = out.total ? `${Math.max(2, out.percent)}%` : '0';
    barIn.style.width = inn.total ? `${Math.max(2, inn.percent)}%` : '0';
    barIn.classList.toggle('paused', inn.total > 0 && !inn.names.length);
    bar.classList.toggle('show', busy);
    // stage (always shown; idle it tells the connection state)
    el.classList.toggle('active', moving);
    el.classList.toggle('offline', !connected());
    el.classList.toggle('in', inn.names.length > 0);
    el.classList.toggle('out', out.names.length > 0);
    el.querySelector('.end.pc small').textContent = pcName() || 'PC';
    const parts = [];
    if (inn.total) parts.push(`Sending to PC · ${Math.floor(inn.percent)}%${inn.speed ? ` · ${fmtBytes(inn.speed)}/s` : inn.names.length ? '' : ' · waiting'}`);
    if (out.total) parts.push(`Receiving · ${Math.floor(out.percent)}%${out.speed ? ` · ${fmtBytes(out.speed)}/s` : ''}`);
    if (!parts.length) parts.push(connected() ? (busy ? 'Waiting…' : 'Ready') : 'Connecting…');
    el.querySelector('.lane-label').innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join('');
    if (moving && !timer) { tick(); timer = setInterval(tick, 700); }
    if (!moving && timer) { clearInterval(timer); timer = null; }
  }

  return { update };
}
