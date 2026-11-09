import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeCore, pairPhone, HOST } from '../helpers.js';
import { isAllowedSource } from '../../src/server/middleware/security.js';

let ctx;
before(() => { ctx = makeCore(); });
after(() => ctx.cleanup());

test('unpaired phone is redirected to /pair and API refuses it', async () => {
  const r = await request(ctx.app).get('/').set('Host', HOST);
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/pair');
  const api = await request(ctx.app).get('/api/files/shared').set('Host', HOST);
  assert.equal(api.status, 401);
  assert.equal(api.body.error.code, 'UNAUTHORIZED');
});

test('QR pairing token is single-use and rotates', async () => {
  const token = ctx.core.sessions.currentPairToken().value;
  const first = await request(ctx.app).get(`/p/${token}`).set('Host', HOST);
  assert.equal(first.status, 303);
  assert.equal(first.headers.location, '/');
  const cookie = first.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const second = await request(ctx.app).get(`/p/${token}`).set('Host', HOST);
  assert.equal(second.status, 303);
  assert.match(second.headers.location, /^\/pair\?reason=PAIR_TOKEN_INVALID/);
  assert.notEqual(ctx.core.sessions.currentPairToken().value, token);
});

test('session endpoint returns CSRF token and device name from user agent', async () => {
  const { device, csrf } = await pairPhone(ctx.app, ctx.core);
  assert.equal(device.name, 'iPhone · Safari');
  assert.ok(csrf.length >= 20);
});

test('state-changing requests without CSRF header are rejected', async () => {
  const { agent } = await pairPhone(ctx.app, ctx.core);
  const r = await agent.post('/api/uploads').set('Host', HOST).send({ name: 'a.txt', size: 3 });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'CSRF');
});

test('Host header must be an IP address (DNS rebinding protection)', async () => {
  const r = await request(ctx.app).get('/api/status').set('Host', 'evil.example.com');
  assert.equal(r.status, 421);
  const ok = await request(ctx.app).get('/api/status').set('Host', HOST);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.app, 'ENiShare');
});

test('only LAN source addresses are allowed', () => {
  for (const ip of ['192.168.0.5', '10.1.2.3', '172.20.10.2', '172.31.255.1', '127.0.0.1', '::1']) assert.ok(isAllowedSource(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.1.1', '169.254.3.4', '2001:db8::1']) assert.ok(!isAllowedSource(ip), ip);
});

test('PIN pairing: disabled by default, then works, then locks out after 5 failures', async () => {
  const off = await request(ctx.app).post('/api/pair/pin').set('Host', HOST).send({ pin: '123456' });
  assert.equal(off.status, 403);
  ctx.core.settings.update({ pin: '246810', pinEnabled: true });
  const info = await request(ctx.app).get('/api/pair/info').set('Host', HOST);
  assert.equal(info.body.pinEnabled, true);
  const good = await request(ctx.app).post('/api/pair/pin').set('Host', HOST).send({ pin: '246810' });
  assert.equal(good.status, 200);
  assert.match(good.headers['set-cookie'][0], /enishare_sid=/);
  for (let i = 0; i < 5; i++) {
    const bad = await request(ctx.app).post('/api/pair/pin').set('Host', HOST).send({ pin: '000000' });
    assert.equal(bad.status, 401);
  }
  const locked = await request(ctx.app).post('/api/pair/pin').set('Host', HOST).send({ pin: '246810' });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'PIN_LOCKED');
});

test('revoked device loses access immediately', async () => {
  const { agent, device } = await pairPhone(ctx.app, ctx.core);
  assert.equal((await agent.get('/api/files/shared').set('Host', HOST)).status, 200);
  ctx.core.sessions.revoke(device.id);
  assert.equal((await agent.get('/api/files/shared').set('Host', HOST)).status, 401);
});

test('phone cannot delete shared files', async () => {
  const { agent, csrf } = await pairPhone(ctx.app, ctx.core);
  const r = await agent.delete('/api/files/shared/abcdefghijkl').set('Host', HOST).set('X-ENiShare-CSRF', csrf);
  assert.equal(r.status, 403);
});

test('security headers are set', async () => {
  const r = await request(ctx.app).get('/api/status').set('Host', HOST);
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-powered-by'], undefined);
});
