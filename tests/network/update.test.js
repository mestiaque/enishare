import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, isNewer, pickAsset, updateFromRelease } from '../../src/main/update-logic.js';

const SHA = 'a'.repeat(64);
const release = (tag, extra = {}) => ({
  tag_name: tag, body: 'Notes', html_url: 'https://github.com/mestiaque/enishare/releases/tag/' + tag,
  assets: [
    { name: `enishare_${tag.slice(1)}_amd64.deb`, browser_download_url: 'https://x/deb', size: 10, digest: `sha256:${SHA}` },
    { name: `ENiShare-${tag.slice(1)}-x86_64.AppImage`, browser_download_url: 'https://x/appimage', size: 20, digest: `sha256:${SHA}` },
    { name: `ENiShare-Setup-${tag.slice(1)}.exe`, browser_download_url: 'https://x/exe', size: 30 },
  ],
  ...extra,
});

test('version parsing and comparison', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.10.0-beta.1'), [1, 10, 0]);
  assert.ok(isNewer('v1.0.1', '1.0.0'));
  assert.ok(isNewer('1.10.0', '1.9.9'));
  assert.ok(!isNewer('v1.0.0', '1.0.0'));
  assert.ok(!isNewer('0.9.9', '1.0.0'));
});

test('asset picked per install kind', () => {
  const r = release('v1.1.0');
  assert.equal(pickAsset(r.assets, 'deb').name, 'enishare_1.1.0_amd64.deb');
  assert.equal(pickAsset(r.assets, 'appimage').name, 'ENiShare-1.1.0-x86_64.AppImage');
  assert.equal(pickAsset(r.assets, 'windows').name, 'ENiShare-Setup-1.1.0.exe');
  assert.equal(pickAsset(r.assets, 'dev'), null);
});

test('update info: newer release with checksum is installable', () => {
  const u = updateFromRelease(release('v1.1.0'), '1.0.0', 'deb');
  assert.equal(u.version, '1.1.0');
  assert.equal(u.sha256, SHA);
  assert.equal(u.installable, true);
});

test('no checksum, dev build, same version, drafts and pre-releases', () => {
  assert.equal(updateFromRelease(release('v1.1.0'), '1.0.0', 'windows').installable, false); // asset has no digest
  assert.equal(updateFromRelease(release('v1.1.0'), '1.0.0', 'dev').installable, false);
  assert.equal(updateFromRelease(release('v1.0.0'), '1.0.0', 'deb'), null);
  assert.equal(updateFromRelease(release('v2.0.0', { draft: true }), '1.0.0', 'deb'), null);
  assert.equal(updateFromRelease(release('v2.0.0', { prerelease: true }), '1.0.0', 'deb'), null);
});
