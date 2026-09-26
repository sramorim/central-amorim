/**
 * CENTRAL AMORIM — Test-suite das ferramentas SHANDON ELITE hospedadas no Worker.
 *
 * Cobre as três rotas portadas (whatsapp-lookup, phone-osint, crypto-check):
 * shape das respostas, comportamento sem chave da RapidAPI (configured:false),
 * validação de entrada, CORS para o app do Shandon e bloqueio de origem estranha.
 * As chamadas externas são neutralizadas com um fetch stub offline para o teste
 * ficar determinístico e rápido.
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

async function call(path, { method = 'GET', body, origin } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  const res = await app.fetch(
    new Request('https://central.test' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* resposta não-JSON (ex.: 204) */
  }
  return { status: res.status, data, headers: res.headers };
}

before(() => {
  globalThis.fetch = async () => {
    throw new Error('rede bloqueada no teste (stub offline)');
  };
  app = createApp({ db: createLocalDb(), env: makeEnv() });
});

after(() => {
  globalThis.fetch = originalFetch;
});

test('GET /api/whatsapp-lookup descreve o serviço', async () => {
  const { status, data } = await call('/api/whatsapp-lookup');
  assert.equal(status, 200);
  assert.equal(data.success, true);
  assert.equal(data.data.service, 'whatsapp-lookup');
  assert.ok(typeof data.data.description === 'string');
});

test('POST /api/phone-osint valida corpo e responde no shape do Shandon', async () => {
  const missing = await call('/api/phone-osint', { method: 'POST', body: {} });
  assert.equal(missing.status, 400);

  const ok = await call('/api/phone-osint', { method: 'POST', body: { phone: '554797876098' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.success, true);
  const d = ok.data.data;
  assert.equal(d.phone, '554797876098');
  assert.equal(typeof d.valid, 'boolean');
  assert.equal(typeof d.country, 'string');
  assert.equal(typeof d.whatsapp, 'boolean');
  assert.ok(Array.isArray(d.socialMedia));
});

test('POST /api/phone-osint também aceita número com caracteres variados', async () => {
  const ok = await call('/api/phone-osint', { method: 'POST', body: { phone: '+55 (47) 98776-8098' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.success);
  assert.equal(typeof ok.data.data.valid, 'boolean');
});

test('POST /api/crypto-check aceita address BTC e ETH', async () => {
  const btc = await call('/api/crypto-check', { method: 'POST', body: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' } });
  assert.equal(btc.status, 200);
  assert.ok(btc.data.success);
  assert.match(btc.data.data.blockchain, /Bitcoin|Unknown/);
  assert.equal(typeof btc.data.data.balance, 'string');
  assert.equal(typeof btc.data.data.txCount, 'number');
  assert.ok(Array.isArray(btc.data.data.riskFlags));

  const eth = await call('/api/crypto-check', { method: 'POST', body: { address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe' } });
  assert.equal(eth.status, 200);
  assert.ok(eth.data.success);
  assert.match(eth.data.data.blockchain, /Ethereum|Unknown/);
});

test('POST /api/crypto-check valida address obrigatório', async () => {
  const missing = await call('/api/crypto-check', { method: 'POST', body: {} });
  assert.equal(missing.status, 400);

  const bad = await call('/api/crypto-check', { method: 'POST', body: { address: 'abc!' } });
  assert.equal(bad.status, 200);
  assert.equal(bad.data.data.blockchain, 'Unknown');
});

test('POST /api/whatsapp-lookup sem chave responde configured:false', async () => {
  const ok = await call('/api/whatsapp-lookup', { method: 'POST', body: { phone: '554797876098' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.success, true);
  assert.equal(ok.data.data.configured, false);
  assert.ok(ok.data.data.errors.some((e) => e.includes('RAPIDAPI_WHATSAPP_KEY')));
});

test('POST /api/whatsapp-lookup valida número', async () => {
  const missing = await call('/api/whatsapp-lookup', { method: 'POST', body: {} });
  assert.equal(missing.status, 400);

  const short = await call('/api/whatsapp-lookup', { method: 'POST', body: { phone: '123' } });
  assert.equal(short.status, 500);
  assert.equal(short.data.success, false);
});

test('Origem do Shandon liberada (CORS + osint), origens estranhas bloqueadas', async () => {
  const elite = await call('/api/phone-osint', {
    method: 'POST',
    body: { phone: '554797876098' },
    origin: 'https://elite.senhoramorim.com.br',
  });
  assert.equal(elite.status, 200);
  assert.equal(elite.headers.get('access-control-allow-origin'), 'https://elite.senhoramorim.com.br');

  const evil = await call('/api/phone-osint', {
    method: 'POST',
    body: { phone: '554797876098' },
    origin: 'https://evil.example',
  });
  assert.equal(evil.status, 403);
});

test('CORS pré-flight (OPTIONS) respondido para o app do Shandon', async () => {
  const res = await app.fetch(
    new Request('https://central.test/api/whatsapp-lookup', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://elite.senhoramorim.com.br',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://elite.senhoramorim.com.br');
});

test('Rotas do Shandon não conflitam com o health check', async () => {
  const { status, data } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
});