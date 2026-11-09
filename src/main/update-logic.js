// Update logic without Electron dependencies (unit-tested in tests/network/update.test.js).
export const RELEASES_PAGE = 'https://github.com/mestiaque/enishare/releases/latest';

export function parseVersion(s) {
  const core = String(s).replace(/^[^0-9]*/, '').split('-')[0];
  const [a = 0, b = 0, c = 0] = core.split('.').map((p) => Number.parseInt(p, 10) || 0);
  return [a, b, c];
}

export function isNewer(candidate, current) {
  const x = parseVersion(candidate);
  const y = parseVersion(current);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Release asset names, as produced by electron-builder.yml. */
export function pickAsset(assets, kind) {
  return (assets || []).find((a) => {
    const n = String(a.name || '');
    if (kind === 'deb') return /^enishare_.*_amd64\.deb$/.test(n);
    if (kind === 'appimage') return /^ENiShare-.*-x86_64\.AppImage$/.test(n);
    if (kind === 'windows') return /^ENiShare-Setup-.*\.exe$/.test(n);
    return false;
  }) ?? null;
}

export function updateFromRelease(rel, current, kind) {
  const tag = rel?.tag_name;
  if (!tag || rel.draft || rel.prerelease || !isNewer(tag, current)) return null;
  const v = parseVersion(tag).join('.');
  const info = {
    version: v, notes: String(rel.body || '').trim(), page: rel.html_url || RELEASES_PAGE,
    assetName: '', url: '', size: 0, sha256: '', installable: false, kind,
  };
  const a = pickAsset(rel.assets, kind);
  if (a) {
    info.assetName = a.name;
    info.url = a.browser_download_url || '';
    info.size = a.size || 0;
    info.sha256 = String(a.digest || '').replace(/^sha256:/, '').toLowerCase();
    // Without a published checksum nothing is installed.
    info.installable = Boolean(info.url) && /^[0-9a-f]{64}$/.test(info.sha256);
  }
  return info;
}
