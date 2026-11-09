// "Update available" dialog — same flow as the other EN* apps: notes, download progress,
// install in place, then restart.
import { api } from './store.js';
import { icon, esc, h, fmtBytes } from './ui.js';

let open = false;

export function showUpdateDialog(info, currentVersion) {
  if (open || !info) return;
  open = true;
  const kindText = {
    deb: 'The update downloads, is checked against its published checksum and installed. Ubuntu asks for your password. Your files, history and settings are kept.',
    appimage: 'The update downloads, is checked against its published checksum and replaces this AppImage. Your files, history and settings are kept.',
    windows: 'The update downloads, is checked against its published checksum and installs after ENiShare closes. ENiShare starts again by itself.',
  };
  const back = h(`<div class="modal-back"><div class="modal narrow" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>Update available</h3><button class="x" aria-label="Close">${icon('x', 16)}</button></div>
    <div class="body" style="color:rgb(var(--fg))">
      <div class="row" style="gap:14px"><img src="assets/icon.svg" alt="" style="width:56px;height:56px">
        <div><div style="font-size:16px;font-weight:600">ENiShare ${esc(info.version)} is available</div>
        <div class="small faint">You have version ${esc(currentVersion)}.</div></div></div>
      ${info.notes ? `<div class="selectable small muted" style="margin-top:14px;max-height:200px;overflow:auto;white-space:pre-wrap;background:rgb(var(--raised));border-radius:8px;padding:12px">${esc(info.notes)}</div>` : ''}
      <div id="u-progress" class="hidden" style="margin-top:14px"><div class="progress"><i style="width:0%"></i></div><div class="tiny faint mt-s" id="u-progress-text"></div></div>
      <div class="small faint" id="u-text" style="margin-top:14px">${esc(info.installable ? kindText[info.kind] || '' : 'This copy cannot update itself (development build or unknown install type). Download the new version from the release page.')}</div>
    </div>
    <div class="modal-foot" id="u-foot"></div></div></div>`);
  document.getElementById('modal-root').append(back);
  const foot = back.querySelector('#u-foot');
  let busy = false;
  const close = () => { if (busy) return; back.remove(); open = false; offProgress(); };
  back.querySelector('.x').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });

  const offProgress = api.onEvent((name, p) => {
    if (name !== 'update:progress') return;
    const bar = back.querySelector('#u-progress');
    bar.classList.remove('hidden');
    const pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
    bar.querySelector('i').style.width = `${p.phase === 'installing' ? 100 : pct}%`;
    back.querySelector('#u-progress-text').textContent = p.phase === 'installing'
      ? (info.kind === 'deb' ? 'Installing… enter your password if Ubuntu asks for it.' : 'Installing…')
      : `Downloading… ${fmtBytes(p.done)}${p.total ? ` of ${fmtBytes(p.total)}` : ''}`;
  });

  const buttons = (list) => {
    foot.innerHTML = '';
    for (const [label, kind, fn] of list) {
      const b = h(`<button class="btn ${kind}">${esc(label)}</button>`);
      b.onclick = fn;
      foot.append(b);
    }
  };
  const text = (t, err = false) => { const el = back.querySelector('#u-text'); el.textContent = t; el.style.color = err ? 'rgb(var(--danger))' : ''; };

  const start = async () => {
    busy = true;
    buttons([['Updating…', 'primary', () => {}]]);
    foot.querySelector('button').disabled = true;
    try {
      const r = await api.update.install();
      busy = false;
      if (r === 'exiting') { text('Installing… ENiShare will start again by itself.'); buttons([]); return; }
      text(`ENiShare ${info.version} is installed. Restart to use it.`);
      buttons([['Restart later', '', close], ['Restart now', 'primary', () => api.update.restart()]]);
    } catch (err) {
      busy = false;
      text(err.message, true);
      buttons([['Close', '', close], ['Try again', 'primary', start]]);
    }
  };

  if (info.installable) buttons([['Later', '', close], ['Update now', 'primary', start]]);
  else buttons([['Close', '', close]]);
}
