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

test('POST /api/whatsapp-lookup com APIFY_API_TOKEN usa o provedor Apify (foto, nome do leak, Telegram)', async () => {
  const appApify = createApp({
    db: createLocalDb(),
    env: makeEnv({ APIFY_API_TOKEN: 'apify_api_test', APIFY_DAILY_LIMIT: '10' }),
  });
  const offline = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.apify.com')) {
      return new Response(
        JSON.stringify([
          {
            number: '554797876098',
            exists: true,
            isBusiness: false,
            urlImage: 'https://whatsapp-db.example/554797876098.jpg',
            about: 'Disponível',
            telegram: { username: 'dono', first_name: 'Dono', last_name: 'Teste', premium: true },
            fbLeak: {
              data: {
                firstName: 'Dono',
                lastName: 'Teste',
                fbId: '123',
                gender: 'male',
                regionCode: 'BR',
                other: { location: 'Itajaí' },
              },
            },
            facebookProfile: 'https://facebook.com/123',
            facebookProfilePicUrl: 'https://wa-fb.example/123.jpg',
            leakedData: { results: 1, entries: [{ entry: { name: 'Dono Teste', database_name: 'Facebook' } }] },
            source: 'fresh',
            fetchedAt: '2026-09-26T15:00:00.000Z',
          },
        ]),
        { status: 200 }
      );
    }
    throw new Error('rede bloqueada no teste');
  };

  try {
    const res = await appApify.fetch(
      new Request('https://central.test/api/whatsapp-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '554797876098' }),
      })
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    const d = body.data;
    assert.equal(d.provider, 'apify');
    assert.equal(d.onWhatsApp, true);
    assert.equal(d.name, 'Dono Teste');
    assert.equal(d.photo.hasPhoto, true);
    assert.equal(d.photo.image, 'https://whatsapp-db.example/554797876098.jpg');
    assert.equal(d.photo.facebookPhoto, 'https://wa-fb.example/123.jpg');
    assert.equal(d.telegram.username, 'dono');
    assert.equal(d.hasTelegram, true);
    assert.equal(d.source, 'fresh');
    assert.equal(d.facebook.details.location, 'Itajaí');
    assert.ok(Array.isArray(d.errors));
  } finally {
    globalThis.fetch = offline;
  }
});

test('POST /api/whatsapp-lookup Apify: número fora do WhatsApp responde onWhatsApp:false', async () => {
  const appApify = createApp({
    db: createLocalDb(),
    env: makeEnv({ APIFY_API_TOKEN: 'apify_api_test' }),
  });
  const offline = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.apify.com')) {
      return new Response(JSON.stringify([{ number: '5599999999999', exists: false, source: 'not-found' }]), { status: 200 });
    }
    throw new Error('rede bloqueada no teste');
  };
  try {
    const res = await appApify.fetch(
      new Request('https://central.test/api/whatsapp-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '5599999999999' }),
      })
    );
    const body = await res.json();
    assert.equal(body.data.provider, 'apify');
    assert.equal(body.data.onWhatsApp, false);
    assert.equal(body.data.source, 'not-found');
  } finally {
    globalThis.fetch = offline;
  }
});

test('GET /api/instagram descreve o serviço', async () => {
  const { status, data } = await call('/api/instagram');
  assert.equal(status, 200);
  assert.equal(data.success, true);
  assert.equal(data.data.service, 'instagram-lookup');
});

test('POST /api/instagram valida username e responde configured:false sem chave', async () => {
  const missing = await call('/api/instagram', { method: 'POST', body: {} });
  assert.equal(missing.status, 400);

  const noKey = await call('/api/instagram', { method: 'POST', body: { username: 'dono@teste ' } });
  assert.equal(noKey.status, 200);
  assert.equal(noKey.data.data.configured, false);
  assert.ok(noKey.data.data.errors.some((e) => e.includes('APIFY_API_TOKEN')));
});

test('POST /api/instagram com APIFY_API_TOKEN entrega perfil completo (modo details)', async () => {
  const appIg = createApp({
    db: createLocalDb(),
    env: makeEnv({ APIFY_API_TOKEN: 'apify_api_test', APIFY_DAILY_LIMIT: '10' }),
  });
  const offline = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.apify.com')) {
      return new Response(
        JSON.stringify([
          {
            inputUrl: 'https://www.instagram.com/torvalds/',
            id: '242598499',
            username: 'torvalds',
            url: 'https://www.instagram.com/torvalds',
            fullName: 'Linus Torvalds',
            biography: 'Linux founder.',
            externalUrl: 'https://torvalds-family.blogspot.com',
            followersCount: 350000,
            followsCount: 88,
            highlightReelCount: 2,
            isBusinessAccount: false,
            businessCategoryName: null,
            private: false,
            verified: true,
            profilePicUrl: 'https://scontent.example/torvalds.jpg',
            profilePicUrlHD: 'https://scontent.example/torvalds_hd.jpg',
            fbid: '17841401154973790',
            postsCount: 300,
            latestPosts: [
              {
                url: 'https://www.instagram.com/p/ABC123/',
                type: 'Image',
                caption: 'Testing the new kernel',
                likesCount: 1000,
                commentsCount: 50,
                timestamp: '2026-01-01T00:00:00.000Z',
                displayUrl: 'https://scontent.example/post1.jpg',
              },
            ],
          },
        ]),
        { status: 200 }
      );
    }
    throw new Error('rede bloqueada no teste');
  };

  try {
    const res = await appIg.fetch(
      new Request('https://central.test/api/instagram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'https://www.instagram.com/torvalds/' }),
      })
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    const d = body.data;
    assert.equal(d.configured, true);
    assert.equal(d.provider, 'apify-instagram');
    assert.equal(d.profile.fullName, 'Linus Torvalds');
    assert.equal(d.profile.username, 'torvalds');
    assert.equal(d.profile.followersCount, 350000);
    assert.equal(d.profile.verified, true);
    assert.equal(d.profile.isPrivate, false);
    assert.equal(d.profile.externalUrl, 'https://torvalds-family.blogspot.com');
    assert.equal(d.profile.latestPosts.length, 1);
    assert.equal(d.profile.latestPosts[0].caption, 'Testing the new kernel');
  } finally {
    globalThis.fetch = offline;
  }
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