/**
 * Protecao do credito pago (Apify) e headers de seguranca.
 *
 * Contexto: as rotas /api/instagram e /api/whatsapp-lookup nao exigem login (o
 * Shandon Elite tem sessao propria e nao manda a cookie da Central), ou seja,
 * qualquer pessoa na internet podia chamar. O unico teto era um contador na
 * memoria do isolate, que o Cloudflare reinicia a cada cold start e replica
 * por datacenter — ou seja, nao era teto nenhum. Estes testes travam a cota no
 * D1 (global) e os headers de seguranca.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalDb } from '../scripts/local-db.js';
import { createApp } from '../src/backend/app.js';

const BASE = 'https://senhoramorim.com.br';
const apps = new Map();

/* Nenhum teste pode sair para a internet: sem isto o teste gastaria credito
   real do Apify e o resultado dependeria da rede. A cota e consumida ANTES da
   chamada ao provedor, entao o contador continua sendo exercitado. */
const fetchReal = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error('rede desligada no teste'));
process.on('exit', () => { globalThis.fetch = fetchReal; });

function handlerName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '');
}

function makeEnv(overrides = {}) {
  return {
    PUBLIC_ORIGIN: BASE,
    ADMIN_EMAILS: '',
    ...overrides,
  };
}

function freshApp(name, envOverrides = {}) {
  const db = createLocalDb(':memory:');
  const env = makeEnv(envOverrides);
  const app = createApp({ db, env });
  apps.set(handlerName(name), { app, db, env });
  return { app, db, env };
}

async function call(name, path, { method = 'GET', body, cookie, origin, headers = {} } = {}) {
  const { app } = apps.get(handlerName(name));
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  if (cookie) init.headers.cookie = cookie;
  if (origin) init.headers.origin = origin;
  const res = await app.fetch(new Request(`${BASE}${path}`, init));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { res, data };
}

/* ------------------------------------------------------------------ */

test('cota do dia e global: e o D1 quem barra, nao a memoria do isolate', async () => {
  freshApp('quota', { APIFY_API_TOKEN: 'apify_teste', APIFY_DAILY_LIMIT: '3' });

  // Três chamadas passam pelo limite.
  for (let i = 1; i <= 3; i++) {
    const { data } = await call('quota', '/api/instagram', { method: 'POST', body: { username: `alvo${i}` } });
    const joined = JSON.stringify(data);
    assert.ok(!joined.includes('Limite diário'), `chamada ${i} não deveria bater no teto`);
  }

  // A quarta é recusada pelo banco.
  const quarta = await call('quota', '/api/instagram', { method: 'POST', body: { username: 'alvo4' } });
  assert.match(JSON.stringify(quarta.data), /Limite diário/,
    'a quarta chamada tem de bater no teto mesmo sem ter lido nada da memoria');
});

test('um isolate novo (banco novo) continua enxergando o consumo do dia', async () => {
  // Esta e a regressao que importa: o contador antigo vivia na memoria, entao
  // um isolate novo comecava em zero e o limite nao era global.
  const { db, env } = apps.get(handlerName('quota'));
  const outro = createApp({ db, env }); // simula outra instancia do Worker no mesmo D1

  const res = await outro.fetch(new Request(`${BASE}/api/instagram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'outro-isolate' }),
  }));
  const data = await res.json();
  assert.match(JSON.stringify(data), /Limite diário/,
    'nova instancia do Worker precisa ver o consumo ja registrado no D1');
});

test('a cota zera no dia seguinte', async () => {
  // App novo, com teto alto: isola o comportamento da virada de dia sem
  // esbarrar no teto que os testes anteriores ja consumiram.
  freshApp('quotaDia', { APIFY_API_TOKEN: 'apify_teste', APIFY_DAILY_LIMIT: '40' });
  const { db, env } = apps.get(handlerName('quotaDia'));

  const hoje = new Date().toISOString().slice(0, 10);
  const ontem = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  // Ontem esgotado, hoje zerado.
  await db.prepare('INSERT OR REPLACE INTO paid_quota (day, used) VALUES (?, ?)').bind(ontem, 99).run();
  await db.prepare('INSERT OR REPLACE INTO paid_quota (day, used) VALUES (?, ?)').bind(hoje, 0).run();

  const res = await createApp({ db, env }).fetch(new Request(`${BASE}/api/instagram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'hoje' }),
  }));
  const data = await res.json();
  assert.ok(!JSON.stringify(data).includes('Limite diário'),
    'ontem esgotado não pode impedir a consulta de hoje');

  const row = await db.prepare('SELECT used FROM paid_quota WHERE day = ?').bind(hoje).first();
  assert.equal(row.used, 1, 'hoje começa do zero e conta 1, sem herdar o 99 de ontem');
});

test('requisições simultâneas não furam o teto (o limite é do banco)', async () => {
  freshApp('quotaPar', { APIFY_API_TOKEN: 'apify_teste', APIFY_DAILY_LIMIT: '5' });
  const { db, env } = apps.get(handlerName('quotaPar'));

  // Dez chamadas ao mesmo tempo, teto 5: no maximo cinco podem ter sido aceitas.
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    createApp({ db, env }).fetch(new Request(`${BASE}/api/instagram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: `corrida${i}` }),
    })).then((r) => r.json())
  ));

  const row = await db.prepare('SELECT used FROM paid_quota WHERE day = ?')
    .bind(new Date().toISOString().slice(0, 10)).first();
  assert.ok(row.used <= 5, `o banco deixou passar ${row.used} de 5 — o teto tem de ser do D1`);
});

test('erro interno não vaza URL do provedor nem o token para o cliente', async () => {
  freshApp('erro', { APIFY_API_TOKEN: 'apify_segredo_que_nao_pode_vazar', APIFY_DAILY_LIMIT: '40' });
  // Sem rede: o fetch ao Apify falha e a mensagem do erro normalmente carregaria
  // a URL do provedor e o id do Actor.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('GET https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync?token=apify_segredo_que_nao_pode_vazar failed'));
  try {
    const { res, data } = await call('erro', '/api/instagram', { method: 'POST', body: { username: 'erro' } });
    const cru = JSON.stringify(data);
    assert.ok(!cru.includes('apify_segredo'), 'o token não pode aparecer na resposta');
    assert.ok(!cru.includes('api.apify.com'), 'a URL do provedor não pode vazar');
    assert.equal(res.status, 500);
    assert.match(data.error, /Tente novamente/i, 'a mensagem precisa ser acionável para o usuário');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('toda resposta traz os headers de segurança', async () => {
  freshApp('sec');
  const { res } = await call('sec', '/api/admin/diagnostics');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp && csp.includes("frame-ancestors 'none'"), 'CSP precisa barrar iframes de terceiros');
  assert.ok(csp && csp.includes("object-src 'none'"));
  assert.ok(csp && csp.includes("base-uri 'self'"));
});

/* ------------------------------------------------------------------ */

test('perfil inexistente do Apify é "não encontrado", não erro interno 500', async () => {
  freshApp('igAusente', { APIFY_API_TOKEN: 'apify_teste', APIFY_DAILY_LIMIT: '40' });

  // O Actor devolve o item com a mensagem no campo `error` quando o perfil
  // não existe. Antes disso virava HTTP 500 e o chamador não conseguia
  // distinguir "não existe" de "a API caiu".
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify([{ error: 'Profile not found or private' }]),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
  try {
    const { res, data } = await call('igAusente', '/api/instagram', { method: 'POST', body: { username: 'nao_existe_zzz' } });
    assert.equal(res.status, 200, 'perfil inexistente não pode ser erro 500');
    assert.match(JSON.stringify(data), /não encontrado/i);
    assert.equal(data.data.profile, undefined, 'não pode inventar perfil');
  } finally {
    globalThis.fetch = fetchReal;
  }
});

test('falha real do Actor continua sendo erro, não "não encontrado"', async () => {
  freshApp('igErroReal', { APIFY_API_TOKEN: 'apify_teste', APIFY_DAILY_LIMIT: '40' });

  const fetchReal = globalThis.fetch;
  // Erro de cota/limite do ator não significa perfil inexistente.
  globalThis.fetch = async () => new Response(
    JSON.stringify([{ error: 'Actor run failed: monthly usage limit reached' }]),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
  try {
    const { res } = await call('igErroReal', '/api/instagram', { method: 'POST', body: { username: 'sr__amorim' } });
    assert.equal(res.status, 500, 'erro real do ator precisa continuar sendo erro');
  } finally {
    globalThis.fetch = fetchReal;
  }
});
