/** Métricas de cliques da bio: POST público grava, GET admin lê. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/backend/app.js';
import { createLocalDb } from '../scripts/local-db.js';

const BASE = 'https://central.test';
function makeApp() {
  const db = createLocalDb(':memory:');
  const env = { PUBLIC_ORIGIN: 'https://central.test', COOKIE_DOMAIN: '.test', COOKIE_SECURE: 'false', RATE_LIMIT_MAX: '1000' };
  return createApp({ db, env });
}
async function call(app, path, opts = {}) {
  const headers = {};
  if (opts.cookie) headers['cookie'] = opts.cookie;
  const req = new Request(`${BASE}${path}`, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (opts.body !== undefined) req.headers.set('content-type', 'application/json');
  const res = await app.fetch(req, { ip: '127.0.0.1' });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('POST /api/metrics/click grava sem login e valida target', async () => {
  const app = makeApp();
  const bad = await call(app, '/api/metrics/click', { method: 'POST', body: {} });
  assert.equal(bad.status, 400);
  const ok = await call(app, '/api/metrics/click', { method: 'POST', body: { target: 'https://elite.senhoramorim.com.br', kind: 'project' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.ok, true);
});

test('GET /api/admin/metrics exige admin', async () => {
  const app = makeApp();
  await call(app, '/api/metrics/click', { method: 'POST', body: { target: 'https://x.com/', kind: 'social' } });
  const anon = await call(app, '/api/admin/metrics');
  assert.ok([401, 403].includes(anon.status));
});
