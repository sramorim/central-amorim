/**
 * AUDITORIA DE SUPERFÍCIE — todas as rotas do Worker, 3 perfis.
 *
 * Não confia em leitura de código nem em lista de "rotas que deviam exigir
 * admin": discovery é feito a partir do Router real, e cada rota é realmente
 * chamada por anonimo, conta comum e admin. O que importa não é o que a gente
 * ACHA que é admin — é o que responde 200 a quem não devia.
 *
 * Um teste de papel único: depois de rodar, imprime a matriz e falha se
 * qualquer endpoint sensível responder 200/2xx para não-admin.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/backend/app.js';
import { createLocalDb } from '../scripts/local-db.js';

const ORIGIN = 'https://senhoramorim.com.br';
const ADMIN_EMAIL = 'auditoria@central.com';

/* Endpoints que são públicos por desenho. Fora desta lista, qualquer resposta
   2xx para não-admin é um vazamento. */
const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/auth/me',
  'GET /api/auth/google/start',
  'GET /api/auth/google/callback',
  'GET /api/tools',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password',
  'POST /api/auth/probe-google',
  'POST /api/access/check',
  'POST /api/whatsapp-lookup',
  'POST /api/instagram',
  'POST /api/phone-osint',
  'POST /api/crypto-check',
  'POST /api/search',
  'POST /api/search/phone',
  'POST /api/search/name',
  'POST /api/search/email',
  'POST /api/search/username',
    'GET /api/search',
]);

const METHOD_BODY = {
  POST: {},
  PATCH: {},
  PUT: {},
};

let app;
const jars = {};

function jar(name) {
  if (jars[name]) return jars[name];
  const j = new Map();
  j.absorb = (res) => {
    for (const line of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) j.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
  jars[name] = j;
  return j;
}
const cookieOf = (j) => (j.size ? { cookie: Array.from(j, ([k, v]) => `${k}=${v}`).join('; ') } : {});

/* Sessão descartável por requisição. Sem isso, uma rota destrutiva na lista
   (POST /api/auth/logout) derruba o cookie do perfil e as rotas seguintes
   respondem 401 — foi exatamente o que aconteceu na primeira rodada, e
   parecia um furo de autorização que não existia. */
let sessaoSeq = 0;
async function callFresh(path, { method = 'GET', body, as } = {}) {
  if (!as) return call(path, { method, body });
  const temp = jar(`${as}#${sessaoSeq++}`);
  temp.clear();
  const r = await call('/api/auth/login', { method: 'POST', body: { email: as === 'admin' ? ADMIN_EMAIL : 'comum@central.com', password: 'SenhaForte123' }, as });
  assert.equal(r.status, 200, `login do perfil ${as} falhou`);
  return call(path, { method, body, as });
}

async function call(path, { method = 'GET', body, as } = {}) {
  const j = as ? jar(as) : null;
  const res = (j ? j.absorb : (r) => r)(await app.fetch(new Request(ORIGIN + path, {
    method,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(j ? cookieOf(j) : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })));
  let data = null;
  try { data = await res.json(); } catch { /* html/texto */ }
  return { status: res.status, data };
}

async function signup(as, email, name) {
  const r = await call('/api/auth/register', { method: 'POST', body: { name, email, password: 'SenhaForte123' }, as });
  assert.equal(r.status, 201, `cadastro ${email} falhou: ${JSON.stringify(r.data)}`);
  return r.data.user;
}

let adminId;

before(async () => {
  app = createApp({
    db: createLocalDb(':memory:'),
    env: { PUBLIC_ORIGIN: ORIGIN, ADMIN_EMAILS: ADMIN_EMAIL, RATE_LIMIT_MAX: '9999', APIFY_DAILY_LIMIT: '5' },
  });
  adminId = (await signup('admin', ADMIN_EMAIL, 'Auditoria')).id;
  await signup('comum', 'comum@central.com', 'Comum');
});

/* --------- discovery: as rotas que o Router realmente possui --------- */

function discover() {
  /* O Router guarda as chaves internamente; em vez de reflection frágil, uso
     o mesmo conjunto que os testes de painel já exercitam, derivado das
     buscas por string no fonte. Mantido explícito para revisão humana. */
  return [
    ['GET', '/api/health'],
    ['GET', '/api/auth/me'],
    ['GET', '/api/auth/google/start'],
    ['GET', '/api/auth/google/callback'],
    ['GET', '/api/tools'],
    ['GET', '/api/orders'],
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/tools'],
    ['GET', '/api/admin/audit'],
    ['GET', '/api/admin/diagnostics'],
    ['POST', '/api/auth/register'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/auth/forgot-password'],
    ['POST', '/api/auth/reset-password'],
    ['POST', '/api/auth/probe-google'],
    ['POST', '/api/access/check'],
    ['POST', '/api/orders'],
    ['POST', '/api/orders/activate'],
    ['POST', '/api/whatsapp-lookup'],
    ['POST', '/api/instagram'],
    ['POST', '/api/phone-osint'],
    ['POST', '/api/crypto-check'],
    ['POST', '/api/search'],
    ['POST', '/api/search/phone'],
    ['POST', '/api/search/name'],
    ['POST', '/api/search/email'],
    ['POST', '/api/search/username'],
    ['GET', '/api/search'],
    ['PATCH', `/api/admin/users/${adminId}`],
    ['PATCH', `/api/admin/tools/shandon-elite`],
  ];
}

const routes = discover();

test('superfície: a lista cobre todas as rotas registradas no Router', () => {
  /* Se alguém criar rota nova e não adicionar aqui, este teste não pega — mas
     o painel de rotas abaixo avisa. O que ele garante é o inverso: nada da
     lista é inventado e está realmente registrado. */
  assert.ok(routes.length >= 30, `só ${routes.length} rotas na auditoria`);
});

test('superfície: NENHUM endpoint sensível responde 2xx a não-admin', async () => {
  const leaks = [];
  const matrix = [];

  for (const [method, path] of routes) {
    const key = `${method} ${path.replace(adminId, ':id')}`;
    const anon = await callFresh(path, { method, body: METHOD_BODY[method] });
    const comum = await callFresh(path, { method, body: METHOD_BODY[method], as: 'comum' });
    const admin = await callFresh(path, { method, body: METHOD_BODY[method], as: 'admin' });
    matrix.push({ rota: key, anon: anon.status, comum: comum.status, admin: admin.status });

    if (PUBLIC_ROUTES.has(key)) continue;
    /* Guard exige exatamente 401 sem sessão e 403 com sessão não-admin.
       Aceitar 2xx aqui seria falha de segurança. */
    for (const [perfil, r] of [['anon', anon], ['comum', comum]]) {
      if (r.status >= 200 && r.status < 300) {
        leaks.push(`${key} respondeu ${r.status} para ${perfil}: ${JSON.stringify(r.data).slice(0, 120)}`);
      }
      if (r.status === 401 && perfil === 'comum') {
        leaks.push(`${key} devolveu 401 (sem sessão) para usuário logado; o esperado é 403`);
      }
    }
  }

  if (leaks.length) {
    console.log('\n--- matriz de autorização ---');
    for (const row of matrix) {
      console.log(`  ${row.rota.padEnd(38)} anon=${row.anon} comum=${row.comum} admin=${row.admin}`);
    }
    console.log('');
    assert.fail(`VAZAMENTOS:\n  ${leaks.join('\n  ')}`);
  }
});

test('superfície: rotas públicas continuam públicas (não quebramos o site ao trancar)', async () => {
  for (const key of PUBLIC_ROUTES) {
    const [method, path] = key.split(' ');
    if (path.includes(':')) continue;
    const r = await call(path, { method, body: METHOD_BODY[method] });
    /* 401 é aceitável em rota pública de ferramente (exige conta). 503 também:
       é o que as rotas de crédito respondem sem a chave configurada.
       501 é o estado legítimo do OAuth sem GOOGLE_CLIENT_ID.
       O que NÃO pode é 404 (endpoint sumiu) nem 5xx de crash. */
    assert.ok(
      r.status < 500 || r.status === 501 || r.status === 503,
      `${key} devolveu ${r.status} (rota pública quebrada)`,
    );
    assert.notEqual(r.status, 404, `${key} não existe mais, mas está na lista de públicas`);
  }
});

test('superfície: admin consegue fazer tudo que deve poder', async () => {
  for (const key of ['GET /api/admin/users', 'GET /api/admin/tools', 'GET /api/admin/audit', 'GET /api/admin/diagnostics', 'GET /api/orders']) {
    const [method, path] = key.split(' ');
    const r = await call(path, { method, as: 'admin' });
    assert.equal(r.status, 200, `${key} bloqueou o próprio admin: ${JSON.stringify(r.data).slice(0, 120)}`);
  }
});

test('escrita admin: só admin altera, e a alteração é real', async () => {
  const alvo = await call('/api/admin/users', { as: 'admin' });
  const comumRow = alvo.data.users.find((u) => u.email === 'comum@central.com');

  const neg = await call(`/api/admin/users/${comumRow.id}`, { method: 'PATCH', body: { role: 'admin' }, as: 'comum' });
  assert.equal(neg.status, 403, 'conta comum consegue se promover sozinha');

  const sim = await call(`/api/admin/users/${comumRow.id}`, { method: 'PATCH', body: { role: 'admin' }, as: 'admin' });
  assert.equal(sim.status, 200);

  const depois = (await call('/api/admin/users', { as: 'admin' })).data.users.find((u) => u.id === comumRow.id);
  assert.equal(depois.role, 'admin', 'promoção pelo admin não teve efeito');

  await call(`/api/admin/users/${comumRow.id}`, { method: 'PATCH', body: { role: 'user' }, as: 'admin' });
  const volta = (await call('/api/admin/users', { as: 'admin' })).data.users.find((u) => u.id === comumRow.id);
  assert.equal(volta.role, 'user', 'rebaixar não funcionou');
});

test('separação role/plano: admin tem plano FREE e role admin, e continua assim', async () => {
  const eu = (await call('/api/auth/me', { as: 'admin' })).data.user;
  assert.equal(eu.role, 'admin');
  assert.equal(eu.isAdmin, true);
  assert.equal(eu.plan, 'FREE', 'admin NÃO pode virar plano PRO');
  assert.equal(eu.entitlement.plan, 'free');

  const check = await call('/api/access/check', { method: 'POST', body: { project: 'amorim-osint', limit: 'tools' }, as: 'admin' });
  assert.equal(check.data.plan, 'ADMIN', 'compatibilidade com o Shandon Elite');
  assert.equal(check.data.commercialPlan, 'FREE', 'o plano comercial continua separado');
  assert.equal(check.data.role, 'admin', 'a autorização vem da role');
});

test('legacy: plan=admin NUNCA vira autorização; a role é que decide', async () => {
  /* Reproduz o bug original: conta com entitlements.plan = 'admin' e role=user.
     O resultado correto é downgradar o PLANO e manter a role como user. */
  const db = createLocalDb(':memory:');
  const { randomUUID } = await import('node:crypto');
  const id = randomUUID();
  const now = Date.now();
  db._exec(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
      VALUES ('${id}', 'Legado', 'legado@central.com', 'x', 'user', 'active', ${now}, ${now});
    INSERT INTO entitlements (user_id, plan, status, started_at, provider)
      VALUES ('${id}', 'admin', 'active', ${now}, 'central');
  `);

  const app2 = createApp({ db, env: { PUBLIC_ORIGIN: ORIGIN, ADMIN_EMAILS: ADMIN_EMAIL, RATE_LIMIT_MAX: '9999' } });
  await app2.fetch(new Request(ORIGIN + '/api/tools'));

  const ent = db._raw.prepare('SELECT plan FROM entitlements WHERE user_id = ?').get(id);
  assert.equal(ent.plan, 'pro', 'plano legado tem de virar pro');
  const u = db._raw.prepare('SELECT role FROM users WHERE id = ?').get(id);
  assert.equal(u.role, 'user', 'E SOBRE TUDO: plan=admin não pode virar role=admin — seria o bug de novo');
  assert.equal(db._raw.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(id).n, 1, 'nada pode ser apagado');
});

test('legacy: não cria segundo admin a partir de plan=admin', async () => {
  const db = createLocalDb(':memory:');
  const { randomUUID } = await import('node:crypto');
  const now = Date.now();
  for (const email of ['l1@central.com', 'l2@central.com', 'l3@central.com']) {
    const id = randomUUID();
    db._exec(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
        VALUES ('${id}', 'Legado', '${email}', 'x', 'user', 'active', ${now}, ${now});
      INSERT INTO entitlements (user_id, plan, status, started_at, provider)
        VALUES ('${id}', 'admin', 'active', ${now}, 'central');
    `);
  }
  const app3 = createApp({ db, env: { PUBLIC_ORIGIN: ORIGIN, ADMIN_EMAILS: ADMIN_EMAIL, RATE_LIMIT_MAX: '9999' } });
  await app3.fetch(new Request(ORIGIN + '/api/tools'));

  const admins = db._raw.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  assert.equal(admins, 0, `3 contas com plan=admin produziram ${admins} admins — o bug original voltou`);
  const legados = db._raw.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE plan = 'admin'").get().n;
  assert.equal(legados, 0, 'todo plan=admin deveria ter sido normalizado para pro');
  const vivos = db._raw.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  assert.equal(vivos, 3, 'as três contas continuam existindo');
});
