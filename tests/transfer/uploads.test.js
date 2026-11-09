import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeCore, pairPhone, HOST } from '../helpers.js';
import { crc32, crc32Hex } from '../../src/shared/crc32.js';
import { CHUNK_SIZE } from '../../src/shared/constants.js';

let ctx; let phone;
before(async () => { ctx = makeCore(); phone = await pairPhone(ctx.app, ctx.core); });
after(() => ctx.cleanup());

const put = (id, i, buf, crc = crc32Hex(crc32(buf))) => phone.agent.put(`/api/uploads/${id}/chunks/${i}`)
  .set('Host', HOST).set('X-ENiShare-CSRF', phone.csrf).set('X-Chunk-CRC32', crc)
  .set('Content-Type', 'application/octet-stream').send(buf);
const create = (body) => phone.agent.post('/api/uploads').set('Host', HOST).set('X-ENiShare-CSRF', phone.csrf).send(body);
const complete = (id) => phone.agent.post(`/api/uploads/${id}/complete`).set('Host', HOST).set('X-ENiShare-CSRF', phone.csrf);

test('chunked upload: multi-chunk file arrives intact with SHA-256', async () => {
  const data = crypto.randomBytes(CHUNK_SIZE * 2 + 12345);
  const c = await create({ name: 'holiday video.mp4', size: data.length, lastModified: 1700000000000 });
  assert.equal(c.status, 201);
  assert.equal(c.body.chunkCount, 3);
  for (let i = 0; i < 3; i++) {
    const r = await put(c.body.uploadId, i, data.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const done = await complete(c.body.uploadId);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.sha256, crypto.createHash('sha256').update(data).digest('hex'));
  const saved = path.join(ctx.root, 'Received', 'holiday video.mp4');
  assert.ok(fs.readFileSync(saved).equals(data));
  assert.equal(fs.readdirSync(path.join(ctx.root, 'Temp')).length, 0);
});

test('duplicate names never overwrite', async () => {
  for (let n = 0; n < 2; n++) {
    const buf = Buffer.from(`copy ${n}`);
    const c = await create({ name: 'note.txt', size: buf.length, lastModified: n });
    await put(c.body.uploadId, 0, buf);
    assert.equal((await complete(c.body.uploadId)).status, 200);
  }
  const names = fs.readdirSync(path.join(ctx.root, 'Received')).filter((f) => f.startsWith('note'));
  assert.deepEqual(names.sort(), ['note (1).txt', 'note.txt']);
});

test('corrupted chunk is rejected and can be re-sent', async () => {
  const buf = Buffer.from('hello world');
  const c = await create({ name: 'crc.txt', size: buf.length });
  const bad = await put(c.body.uploadId, 0, buf, '00000000');
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'CHUNK_CORRUPT');
  const incomplete = await complete(c.body.uploadId);
  assert.equal(incomplete.status, 409);
  assert.equal((await put(c.body.uploadId, 0, buf)).status, 200);
  assert.equal((await complete(c.body.uploadId)).status, 200);
});

test('interrupted upload resumes from the received chunks', async () => {
  const data = crypto.randomBytes(CHUNK_SIZE + 500);
  const body = { name: 'resume.bin', size: data.length, lastModified: 42 };
  const c = await create(body);
  await put(c.body.uploadId, 0, data.subarray(0, CHUNK_SIZE));
  // "page reload": same file picked again
  const again = await create(body);
  assert.equal(again.body.resumed, true);
  assert.equal(again.body.uploadId, c.body.uploadId);
  assert.deepEqual(again.body.received, [0]);
  await put(c.body.uploadId, 1, data.subarray(CHUNK_SIZE));
  const done = await complete(c.body.uploadId);
  assert.equal(done.status, 200);
  assert.ok(fs.readFileSync(path.join(ctx.root, 'Received', 'resume.bin')).equals(data));
});

test('wrong chunk size and out-of-range index are rejected', async () => {
  const c = await create({ name: 'x.bin', size: 10 });
  assert.equal((await put(c.body.uploadId, 0, Buffer.alloc(9))).status, 400);
  assert.equal((await put(c.body.uploadId, 5, Buffer.alloc(10))).status, 400);
});

test('cancel removes the temp file', async () => {
  const c = await create({ name: 'cancel.bin', size: 100 });
  const r = await phone.agent.delete(`/api/uploads/${c.body.uploadId}`).set('Host', HOST).set('X-ENiShare-CSRF', phone.csrf);
  assert.equal(r.status, 200);
  assert.ok(!fs.readdirSync(path.join(ctx.root, 'Temp')).some((f) => f.startsWith(c.body.uploadId)));
  const status = ctx.core.repos.transfers.list(50, 0).find((t) => t.file_name === 'cancel.bin');
  assert.equal(status.status, 'cancelled');
});

test('upload size limit is enforced', async () => {
  ctx.core.settings.update({ maxUploadMB: 1 });
  const r = await create({ name: 'big.bin', size: 2 * 1024 * 1024 });
  assert.equal(r.status, 413);
  ctx.core.settings.update({ maxUploadMB: 4096 });
});

test('malicious file names are sanitised (no path traversal)', async () => {
  const buf = Buffer.from('x');
  const c = await create({ name: '../../etc/passwd', size: 1 });
  await put(c.body.uploadId, 0, buf);
  const done = await complete(c.body.uploadId);
  assert.equal(done.status, 200);
  assert.ok(!done.body.file.name.includes('/'));
  assert.ok(fs.existsSync(path.join(ctx.root, 'Received', done.body.file.name)));
});

test('another device cannot touch my upload or delete my files', async () => {
  const other = await pairPhone(ctx.app, ctx.core);
  const buf = Buffer.from('mine');
  const c = await create({ name: 'mine.txt', size: buf.length });
  const steal = await other.agent.put(`/api/uploads/${c.body.uploadId}/chunks/0`).set('Host', HOST)
    .set('X-ENiShare-CSRF', other.csrf).set('X-Chunk-CRC32', crc32Hex(crc32(buf))).send(buf);
  assert.equal(steal.status, 404);
  await put(c.body.uploadId, 0, buf);
  const done = await complete(c.body.uploadId);
  const del = await other.agent.delete(`/api/files/received/${done.body.file.id}`).set('Host', HOST).set('X-ENiShare-CSRF', other.csrf);
  assert.equal(del.status, 403);
  const list = await other.agent.get('/api/files/received').set('Host', HOST);
  assert.ok(!list.body.files.some((f) => f.id === done.body.file.id));
  const own = await phone.agent.delete(`/api/files/received/${done.body.file.id}`).set('Host', HOST).set('X-ENiShare-CSRF', phone.csrf);
  assert.equal(own.status, 200);
});

test('simple multipart upload with several files', async () => {
  const r = await phone.agent.post('/api/upload').set('Host', HOST).set('X-ENiShare-CSRF', phone.csrf)
    .attach('files', Buffer.from('%PDF-1.4 test'), 'doc one.pdf')
    .attach('files', Buffer.from('second file'), 'two.txt');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.files.length, 2);
  assert.deepEqual(r.body.files.map((f) => f.name).sort(), ['doc one.pdf', 'two.txt']);
});

test('history records completed uploads and totals', () => {
  const stats = ctx.core.stats();
  assert.ok(stats.receivedCount >= 5);
  assert.ok(stats.totalBytes > CHUNK_SIZE * 2);
});
