// Transfer stage: PC on the left, iPhone on the right. While files move, small file icons
// fly along the lane (iPhone → PC right-to-left, PC → iPhone left-to-right) and the
// receiving device "catches" them.
import { state } from './store.js';
import { icon, esc, fmtBytes, kindIcon } from './ui.js';

const KINDS = [
  [/\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i, 'image'], [/\.(mp4|mov|m4v|mkv|webm|avi|3gp)$/i, 'video'],
  [/\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i, 'audio'], [/\.pdf$/i, 'pdf'], [/\.(xlsx?|csv|ods|numbers)$/i, 'sheet'],
  [/\.(pptx?|odp|key)$/i, 'slides'], [/\.(docx?|txt|rtf|odt|pages|md)$/i, 'document'], [/\.(zip|rar|7z|tar|gz)/i, 'archive'],
];
const kindOf = (name) => (KINDS.find(([re]) => re.test(name)) || [null, 'other'])[1];

/** Sums the live transfers per direction. upload = iPhone → PC, download = PC → iPhone. */
export function transferTotals() {
  const sum = { in: { bytes: 0, total: 0, speed: 0, count: 0, names: [] }, out: { bytes: 0, total: 0, speed: 0, count: 0, names: [] } };
  for (const t of state.transfers.values()) {
    if (t.status !== 'active' && t.status !== 'paused') continue;
    const s = t.direction === 'upload' ? sum.in : sum.out;
    s.bytes += t.bytes || 0;
    s.total += t.total || 0;
    s.count += 1;
    if (t.status === 'active') { s.speed += t.speed || 0; s.names.push(t.fileName); }
  }
  for (const s of [sum.in, sum.out]) s.percent = s.total ? Math.min(100, (s.bytes / s.total) * 100) : 0;
  return sum;
}

export function createStage() {
  const el = document.createElement('div');
  el.className = 'stage';
  el.innerHTML = `
    <div class="end pc"><div class="dev">${icon('monitor', 30)}</div><b>This PC</b><small class="pc-name"></small></div>
    <div class="lane"><div class="track"></div><div class="fliers"></div><div class="lane-label"></div></div>
    <div class="end phone"><div class="dev">${icon('smartphone', 30)}</div><b class="phone-name">iPhone</b><small class="phone-sub"></small></div>`;
  const fliers = el.querySelector('.fliers');
  const pcEnd = el.querySelector('.end.pc');
  const phoneEnd = el.querySelector('.end.phone');
  let timer = null;
  let flip = false;

  function spawn(direction, name) {
    if (fliers.childElementCount > 8) return;
    const f = document.createElement('div');
    f.className = `flier ${direction === 'in' ? 'rtl' : 'ltr'}`;
    f.innerHTML = kindIcon(kindOf(name || ''), 15);
    f.addEventListener('animationend', () => {
      f.remove();
      const target = direction === 'in' ? pcEnd : phoneEnd;
      target.classList.remove('catch');
      void target.offsetWidth; // restart the "catch" animation
      target.classList.add('catch');
    });
    fliers.append(f);
  }

  function tick() {
    const t = transferTotals();
    const dirs = [];
    if (t.in.names.length) dirs.push(['in', t.in.names]);
    if (t.out.names.length) dirs.push(['out', t.out.names]);
    if (!dirs.length) return;
    // Alternate when both directions are busy, so both streams stay visible.
    flip = !flip;
    const [dir, names] = dirs[flip ? 0 : dirs.length - 1];
    spawn(dir, names[Math.floor(Math.random() * names.length)]);
  }

  function update() {
    const t = transferTotals();
    const devices = state.devices.filter((d) => d.online);
    const active = t.in.names.length > 0 || t.out.names.length > 0;
    el.classList.toggle('in', t.in.names.length > 0);
    el.classList.toggle('out', t.out.names.length > 0);
    el.classList.toggle('active', active);
    pcEnd.classList.toggle('on', Boolean(state.server?.running));
    phoneEnd.classList.toggle('on', devices.length > 0);
    el.querySelector('.pc-name').textContent = state.server?.pcName || '';
    el.querySelector('.phone-name').textContent = devices.length > 1 ? `${devices.length} iPhones` : devices[0]?.name || 'iPhone';
    el.querySelector('.phone-sub').textContent = devices.length ? 'Connected' : 'Not connected';

    const parts = [];
    if (t.in.count) parts.push(`${icon('arrow-left', 13)} Receiving ${t.in.count} file${t.in.count === 1 ? '' : 's'} · ${Math.floor(t.in.percent)}%${t.in.speed ? ` · ${fmtBytes(t.in.speed)}/s` : t.in.names.length ? '' : ' · paused'}`);
    if (t.out.count) parts.push(`Sending ${t.out.count} file${t.out.count === 1 ? '' : 's'} · ${Math.floor(t.out.percent)}%${t.out.speed ? ` · ${fmtBytes(t.out.speed)}/s` : ''} ${icon('arrow-right', 13)}`);
    el.querySelector('.lane-label').innerHTML = parts.length ? parts.map((p) => `<span>${p}</span>`).join('')
      : `<span class="idle">${esc(!state.server?.running ? 'Start sharing to connect your iPhone' : devices.length ? 'Ready — send files from the iPhone, or share files from this PC' : 'Waiting for an iPhone to connect')}</span>`;

    if (active && !timer) { tick(); timer = setInterval(tick, 650); }
    if (!active && timer) { clearInterval(timer); timer = null; }
  }

  return {
    el,
    update,
    destroy() { clearInterval(timer); timer = null; el.remove(); },
  };
}
