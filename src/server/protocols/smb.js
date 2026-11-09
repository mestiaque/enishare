// Optional SMB access for the iOS Files app (Files → Browse → ⋯ → Connect to Server → smb://PC-IP).
//
// No maintained Node.js SMB2/3 *server* exists, so ENiShare uses the operating system's own
// SMB server and only manages one share pointing at the ENiShare storage folder:
//   * Windows: built-in SMB server, share created with New-SmbShare (one UAC prompt).
//   * Ubuntu:  Samba "usershares" (`net usershare`), which work without root once Samba is
//              installed and the user is in the `sambashare` group.
// Status values come from real checks (service installed, share exists, port 445 listening).
import os from 'node:os';
import { run, powershell, psQuote, which } from './exec.js';
import { canConnect } from '../network/port.js';
import { AppError } from '../errors.js';

async function linuxStatus(shareName) {
  const smbd = which('smbd');
  const net = which('net');
  const groups = await run('id', ['-nG']);
  const inGroup = groups.stdout.split(/\s+/).includes('sambashare');
  let share = null;
  if (net) {
    const info = await run(net, ['usershare', 'info', shareName]);
    if (info.ok && info.stdout.includes('path=')) {
      share = { name: shareName, path: (/path=(.*)/.exec(info.stdout) || [])[1]?.trim() };
    }
  }
  const listening = await canConnect(445);
  const user = os.userInfo().username;
  return {
    platform: 'linux', supported: true, user, share, listening,
    checks: [
      { id: 'samba', label: 'Samba installed', ok: Boolean(smbd && net), detail: smbd ? smbd : 'Not installed' },
      { id: 'group', label: `User "${user}" in sambashare group`, ok: inGroup, detail: inGroup ? 'Yes' : 'No (needed to create a share without root)' },
      { id: 'share', label: `Share "${shareName}"`, ok: Boolean(share), detail: share ? share.path : 'Not created' },
      { id: 'port', label: 'SMB port 445 listening', ok: listening, detail: listening ? 'Yes' : 'No — Samba service is not running' },
    ],
    setupCommands: [
      'sudo apt install samba',
      `sudo usermod -aG sambashare ${user}`,
      `sudo smbpasswd -a ${user}`,
      'Log out and log in again (so the group change applies)',
    ],
    ready: Boolean(smbd && net && share && listening),
  };
}

async function windowsStatus(shareName) {
  const r = await powershell(`$s = Get-SmbShare -Name ${psQuote(shareName)} -ErrorAction SilentlyContinue | Select-Object Name, Path; if ($s) { $s | ConvertTo-Json -Compress } else { 'null' }`);
  let share = null;
  try { const j = JSON.parse(r.stdout.trim() || 'null'); if (j) share = { name: j.Name, path: j.Path }; } catch { /* */ }
  const listening = await canConnect(445);
  const user = `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;
  return {
    platform: 'win32', supported: true, user, share, listening,
    checks: [
      { id: 'service', label: 'Windows file sharing (port 445)', ok: listening, detail: listening ? 'Running' : 'Not reachable — enable "File and printer sharing" for private networks' },
      { id: 'share', label: `Share "${shareName}"`, ok: Boolean(share), detail: share ? share.path : 'Not created' },
    ],
    setupCommands: [
      'Settings → Network & Internet → your Wi-Fi → Network profile: Private',
      'Control Panel → Network and Sharing Center → Advanced sharing settings → turn on File and printer sharing (Private)',
      'On the iPhone, sign in with your Windows user name and password (Microsoft account: its e-mail and password)',
    ],
    ready: Boolean(share && listening),
  };
}

export async function smbStatus(shareName) {
  if (process.platform === 'linux') return linuxStatus(shareName);
  if (process.platform === 'win32') return windowsStatus(shareName);
  return { platform: process.platform, supported: false, checks: [], ready: false };
}

export async function smbEnable(shareName, folder) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(shareName)) throw new AppError('BAD_SETTING', 'Invalid share name.');
  if (process.platform === 'linux') {
    const net = which('net');
    if (!net) throw new AppError('SMB_NOT_INSTALLED', 'Samba is not installed. Run the setup commands shown on this screen first.');
    const r = await run(net, ['usershare', 'add', shareName, folder, 'ENiShare files', 'Everyone:F', 'guest_ok=n']);
    if (!r.ok) {
      const msg = /permission denied|not allowed/i.test(r.stderr) ? 'Your user is not allowed to create shares yet. Add it to the sambashare group, then log out and back in.'
        : /usershare.*not.*enabled|max_usershares|usershares are currently disabled/i.test(r.stderr) ? 'Samba usershares are disabled in /etc/samba/smb.conf.'
          : `Could not create the share: ${r.stderr.trim() || 'unknown error'}`;
      throw new AppError('SMB_FAILED', msg, 500);
    }
    return smbStatus(shareName);
  }
  if (process.platform === 'win32') {
    const inner = `New-SmbShare -Name ${psQuote(shareName)} -Path ${psQuote(folder)} -FullAccess ${psQuote(`${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`)} | Out-Null`;
    await elevated(inner);
    return smbStatus(shareName);
  }
  throw new AppError('SMB_UNSUPPORTED', 'SMB sharing is not supported on this system.');
}

export async function smbDisable(shareName) {
  if (process.platform === 'linux') {
    const net = which('net');
    if (net) await run(net, ['usershare', 'delete', shareName]);
    return smbStatus(shareName);
  }
  if (process.platform === 'win32') {
    await elevated(`Remove-SmbShare -Name ${psQuote(shareName)} -Force`);
    return smbStatus(shareName);
  }
  throw new AppError('SMB_UNSUPPORTED', 'SMB sharing is not supported on this system.');
}

/** Runs a PowerShell snippet as administrator (Windows shows a UAC prompt). */
async function elevated(inner) {
  const encodedInner = Buffer.from(inner, 'utf16le').toString('base64');
  const r = await powershell(`$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encodedInner}'; exit $p.ExitCode`, { timeout: 120_000 });
  if (!r.ok) {
    if (/canceled by the user|cancelled by the user/i.test(r.stderr)) throw new AppError('SMB_CANCELLED', 'Administrator permission was not granted.');
    throw new AppError('SMB_FAILED', 'Windows could not change the share. Check the log for details.', 500);
  }
}
