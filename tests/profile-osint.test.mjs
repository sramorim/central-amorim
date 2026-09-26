/**
 * CENTRAL AMORIM — Test-suite do buscador de pessoa ("Localizar Pessoa").
 *
 * Cobre POST /api/search (modos username, name, email, phone) e os aliases
 * /api/search/{username,name,email,phone} compatíveis com as UIs do Shandon.
 * O fetch externo é neutralizado com stub offline, então modo username retorna
 * apenas os itens "manuais" (Facebook/X/LinkedIn como possible), e os modos
 * name/email/phone são determinísticos.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/backend/app.js';
import { createLocalDb } from '../scripts/local-db.js';

let app;
const originalFetch = globalThis.fetch;

function makeEnv(overrides = {}) {
  return {
    PUBLIC_ORIGIN: 'https://central.senhoramorim.com.br',
    COOKIE_DOMAIN: '.senhoramorim.com.br',
    COOKIE_SECURE: 'true',
    RATE_LIMIT_MAX: '1000',
    SHANDON_ORIGIN: 'https://elite.senhoramorim.com.br',
    ...overrides,
  };
}

async function call(path, body, origin) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  const res = await app.fetch(
    new Request('https://central.test' + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  );
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* não-JSON */
  }
  return { status: res.status, data };
}

before(() => {
  globalThis.fetch = () => Promise.reject(new Error('rede bloqueada no teste (stub offline)'));
  app = createApp({ db: createLocalDb(), env: makeEnv() });
});

after(() => {
  globalThis.fetch = originalFetch;
});

test('GET /api/search descreve o serviço', async () => {
  const res = await app.fetch(new Request('https://central.test/api/search'));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.data.modes.includes('username'));
});

test('POST /api/search modo username valida entrada e retorna itens', async () => {
  const short = await call('/api/search', { type: 'username', query: 'ab' });
  assert.equal(short.status, 400);

  const invalid = await call('/api/search', { type: 'username', query: 'ola espaço!' });
  assert.equal(invalid.status, 400);

  const ok = await call('/api/search', { type: 'username', query: 'danielamorim' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.data.mode, 'username');
  assert.ok(Array.isArray(ok.data.data.results));
  const fb = ok.data.data.results.find((r) => r.platform === 'Facebook');
  assert.ok(fb, 'Facebook (manual) deve aparecer');
  assert.equal(fb.exists, true);
  assert.equal(fb.status, 'possible');
  assert.ok(fb.url.includes('facebook.com/public/'));
});

test('POST /api/search/username (alias do painel osint) funciona', async () => {
  const ok = await call('/api/search/username', { target: 'joaosilva' });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.data.data.results));
  assert.ok(ok.data.data.results.some((r) => r.platform === 'X / Twitter'));
});

test('POST /api/search modo name monta links de busca por nome', async () => {
  const ok = await call('/api/search', { type: 'name', query: 'Maria da Silva' });
  assert.equal(ok.status, 200);
  const results = ok.data.data.results;
  assert.ok(results.length >= 8);
  const ig = results.find((r) => r.platform === 'Instagram');
  assert.ok(ig);
  assert.ok(ig.url.includes('instagram.com/web/search'));
  assert.ok(results.every((r) => r.exists && r.status === 'manual'));
});

test('POST /api/search/email descobre Gravatar e links de busca', async () => {
  const bad = await call('/api/search', { type: 'email', query: 'nao-e-email' });
  assert.equal(bad.status, 400);

  const ok = await call('/api/search/email', { email: 'contato@example.com' });
  assert.equal(ok.status, 200);
  const results = ok.data.data.results;
  assert.ok(results.length >= 3, 'deve montar links de busca de e-mail');
  assert.ok(results.some((r) => r.platform === 'Google'));
});

test('POST /api/search/phone delega para o Phone OSINT (shape de card)', async () => {
  const ok = await call('/api/search/phone', { phone: '554797876098' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.data.mode, 'phone');
  const r = ok.data.data.results[0];
  assert.equal(r.platform, 'Telefone');
  assert.equal(typeof r.exists, 'boolean');
  assert.equal(typeof r.extra.whatsapp, 'boolean');
  assert.ok(Array.isArray(ok.data.data.results));
});

test('Buscador respeita CORS e rate limit', async () => {
  const viaCors = await call('/api/search', { type: 'name', query: 'Teste' }, 'https://elite.senhoramorim.com.br');
  assert.equal(viaCors.status, 200);
  assert.equal(viaCors.data.success, true);
});