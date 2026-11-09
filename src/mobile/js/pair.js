// Pairing page: explains QR pairing, offers PIN entry when enabled on the PC.
const $ = (s) => document.querySelector(s);

const REASONS = {
  PAIR_TOKEN_INVALID: 'That QR code has expired or was already used. Scan the code currently shown on your PC.',
  RATE_LIMIT: 'Too many attempts. Wait a minute and try again.',
};

async function init() {
  const reason = new URLSearchParams(location.search).get('reason');
  if (reason) {
    $('#reason').textContent = REASONS[reason] || 'Could not connect. Scan the QR code on your PC again.';
    $('#reason').classList.remove('hidden');
  }
  try {
    const info = await (await fetch('/api/pair/info', { cache: 'no-store' })).json();
    $('#pc').textContent = `Connect to the PC “${info.pcName}”`;
    if (info.pinEnabled) $('#pin-box').classList.remove('hidden');
  } catch {
    $('#pc').textContent = 'Cannot reach the PC';
  }

  const input = $('#pin');
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
  $('#pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#pin-error');
    err.classList.add('hidden');
    try {
      const res = await fetch('/api/pair/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: input.value }), credentials: 'same-origin',
      });
      if (res.ok) { location.replace('/'); return; }
      const data = await res.json().catch(() => ({}));
      err.textContent = data?.error?.message || 'Could not connect.';
    } catch {
      err.textContent = 'Cannot reach the PC.';
    }
    err.classList.remove('hidden');
    input.value = '';
    input.focus();
  });
}

init();
