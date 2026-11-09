import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeCore, pairPhone, tempDir, HOST } from '../helpers.js';

let ctx; let phone; let srcDir; let data;
before(async () => {
  ctx = makeCore();
  phone = await pairPhone(ctx.app, ctx.core);
  srcDir = tempDir('enishare-src-');
  data = crypto.randomBytes(300_000);
  fs.writeFileSync(path.join(srcDir, 'report.pdf'), data);
  fs.writeFileSync(path.join(srcDir, 'ছবি.txt'), 'bangla name');
  fs.writeFileSync(path.join(srcDir, 'page.html'), '<script>alert(1)</script>');
  fs.mkdirSync(path.join(srcDir, 'sub'));
  fs.writeFileSync(path.join(srcDir, 'sub', 'inner.txt'), 'inner');
  fs.writeFileSync(path.join(srcDir, '.hidden'), 'skip me');
});
after(async () => { await ctx.cleanup(); fs.rmSync(srcDir, { recursive: true, force: true }); });

const list = async () => (await phone.agent.get('/api/files/shared').set('Host', HOST)).body.files;

test('adding a folder shares its files recursively and skips hidden files', async () => {
  const r = await ctx.core.files.addShared([srcDir]);
  assert.equal(r.added, 4);
  const files = await list();
  assert.deepEqual(files.map((f) => f.name).sort(), ['inner.txt', 'page.html', 'report.pdf', 'ছবি.txt']);
  assert.ok(files.every((f) => !('path' in f) && !('source' in f)), 'paths must not leak to the phone');
  const again = await ctx.core.files.addShared([srcDir]);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 4);
});

test('download streams the exact bytes with attachment disposition', async () => {
  const f = (await list()).find((x) => x.name === 'report.pdf');
  const r = await phone.agent.get(`/api/files/shared/${f.id}`).set('Host', HOST).buffer(true).parse((res, cb) => {
    const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => cb(null, Buffer.concat(parts)));
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.equals(data));
  assert.match(r.headers['content-disposition'], /^attachment; filename="report.pdf"/);
  assert.equal(r.headers['content-type'], 'application/pdf');
  // let the response 'close' handler record history
  await new Promise((res) => setTimeout(res, 50));
  const hist = ctx.core.repos.transfers.list(10, 0, 'download');
  assert.equal(hist[0].status, 'completed');
});

test('UTF-8 file names use RFC 5987 encoding', async () => {
  const f = (await list()).find((x) => x.name === 'ছবি.txt');
  const r = await phone.agent.get(`/api/files/shared/${f.id}`).set('Host', HOST);
  assert.match(r.headers['content-disposition'], /filename\*=UTF-8''%E0%A6%9B/);
});

test('Range requests return 206 with the right slice', async () => {
  const f = (await list()).find((x) => x.name === 'report.pdf');
  const r = await phone.agent.get(`/api/files/shared/${f.id}`).set('Host', HOST).set('Range', 'bytes=100-199').buffer(true)
    .parse((res, cb) => { const p = []; res.on('data', (c) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], `bytes 100-199/${data.length}`);
  assert.ok(r.body.equals(data.subarray(100, 200)));
});

test('inline preview allowed for PDF, never for HTML', async () => {
  const files = await list();
  const pdf = files.find((x) => x.name === 'report.pdf');
  const html = files.find((x) => x.name === 'page.html');
  const a = await phone.agent.get(`/api/files/shared/${pdf.id}?inline=1`).set('Host', HOST);
  assert.match(a.headers['content-disposition'], /^inline/);
  const b = await phone.agent.get(`/api/files/shared/${html.id}?inline=1`).set('Host', HOST);
  assert.match(b.headers['content-disposition'], /^attachment/);
});

test('ZIP of selected files', async () => {
  const ids = (await list()).map((f) => f.id).join(',');
  const r = await phone.agent.get(`/api/files/shared-zip?ids=${ids}`).set('Host', HOST).buffer(true)
    .parse((res, cb) => { const p = []; res.on('data', (c) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/zip');
  assert.equal(r.body.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(r.body.length > data.length);
});

test('unknown ids and path-like ids are 404', async () => {
  assert.equal((await phone.agent.get('/api/files/shared/doesnotexist1').set('Host', HOST)).status, 404);
  assert.equal((await phone.agent.get('/api/files/shared/..%2F..%2Fetc%2Fpasswd').set('Host', HOST)).status, 404);
});

test('a removed linked file is reported unavailable, and removing a share keeps the original', async () => {
  const f = (await list()).find((x) => x.name === 'inner.txt');
  fs.renameSync(path.join(srcDir, 'sub', 'inner.txt'), path.join(srcDir, 'sub', 'moved.txt'));
  const after = (await list()).find((x) => x.id === f.id);
  assert.equal(after.available, false);
  const r = await phone.agent.get(`/api/files/shared/${f.id}`).set('Host', HOST);
  assert.equal(r.status, 410);
  assert.equal(r.body.error.code, 'FILE_MISSING');
  const pdf = (await list()).find((x) => x.name === 'report.pdf');
  await ctx.core.files.removeShared(pdf.id);
  assert.ok(fs.existsSync(path.join(srcDir, 'report.pdf')), 'linked original must not be deleted');
});

test('copy mode copies into Shared/ and deletes the copy on removal', async () => {
  ctx.core.settings.update({ copySharedFiles: true });
  const file = path.join(srcDir, 'copied.txt');
  fs.writeFileSync(file, 'copy me');
  await ctx.core.files.addShared([file]);
  const rec = ctx.core.repos.files.list('shared').find((r) => r.original_name === 'copied.txt');
  assert.equal(rec.source, 'copied');
  assert.ok(rec.file_path.startsWith(path.join(ctx.root, 'Shared')));
  await ctx.core.files.removeShared(rec.id);
  assert.ok(!fs.existsSync(rec.file_path));
  assert.ok(fs.existsSync(file));
  ctx.core.settings.update({ copySharedFiles: false });
});

test('rename changes the download name only', async () => {
  const f = (await list()).find((x) => x.name === 'ছবি.txt');
  const name = ctx.core.files.renameShared(f.id, 'renamed');
  assert.equal(name, 'renamed.txt');
  assert.ok(fs.existsSync(path.join(srcDir, 'ছবি.txt')));
});
