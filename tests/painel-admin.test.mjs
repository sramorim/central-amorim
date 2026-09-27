/* Contrato entre o painel (admin.html) e as rotas que ele chama.
 * O painel é JS antigo de propósito; se alguém renomear campo na API e o
 * painel quebrar em silêncio, isso aqui quebra junto. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/backend/app.js';
import { createLocalDb } from '../scripts/local-db.js';

const ORIGIN = 'http://localhost:8787';
const ADMIN_EMAIL = 'painel@central.com';

let db;
let app;
let me = null;
let users = [];
let tools = [];
let diagnostics = null;

/* Um jar por sessão. O painel real abre o navegador como uma pessoa só, mas
   o teste precisa alternar entre admin e comum sem que o login do comum
   derrube a sessão do admin. */
function makeJar() {
  const jar = new Map();
  jar.header = () => Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ');
  jar.absorb = (res) => {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    return res;
  };
  return jar;
}

const admin = makeJar();

async function call(path, { method = 'GET', body, jar = admin } = {}) {
  const res = jar.absorb(await app.fetch(new Request(ORIGIN + path, {
    method,
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(jar.size ? { cookie: jar.header() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })));
  return { status: res.status, data: await res.json() };
}

async function signup(email, name, jar) {
  return call('/api/auth/register', {
    method: 'POST',
    jar,
    body: { name, email, password: 'SenhaForte123' },
  });
}

before(async () => {
  db = createLocalDb(':memory:');
  app = createApp({
    db,
    env: {
      PUBLIC_ORIGIN: ORIGIN,
      ADMIN_EMAILS: ADMIN_EMAIL,
      APIFY_DAILY_LIMIT: '20',
      RATE_LIMIT_MAX: '10000',
    },
  });
  const reg = await signup(ADMIN_EMAIL, 'Dono', admin);
  assert.equal(reg.status, 201);
  me = reg.data.user;
  users = (await call('/api/admin/users')).data.users;
  tools = (await call('/api/admin/tools')).data.tools;
  diagnostics = (await call('/api/admin/diagnostics')).data;
});

test('painel: /api/auth/me devolve o que o painel usa para decidir mostrar ou não', () => {
  assert.equal(me.isAdmin, true);
  assert.equal(me.role, 'admin');
  assert.equal(me.email, ADMIN_EMAIL);
  assert.ok(me.id, 'o painel precisa do id para comparar com a linha da tabela');
  assert.ok(me.name, 'o painel mostra o nome');
});

test('painel: toda linha de /api/admin/users tem os campos que o painel renderiza', () => {
  assert.equal(users.length, 1);
  const [u] = users;
  for (const field of ['id', 'email', 'role', 'account_status', 'created_at', 'plan']) {
    assert.ok(field in u, `falta "${field}" — o painel quebra sem ele`);
  }
  assert.equal(u.role, 'admin');
  assert.equal(u.account_status, 'active');
  assert.ok(['free', 'pro'].includes(u.plan));
});

test('painel: os <select> de role/status/plano só oferecem valores aceitos pela API', async () => {
  const target = users[0].id;
  const bad = await call(`/api/admin/users/${target}`, { method: 'PATCH', body: { role: 'owner' } });
  assert.equal(bad.status, 400, 'a API precisa recusar valor fora da lista, senão o painel grava lixo');

  const badPlan = await call(`/api/admin/users/${target}`, { method: 'PATCH', body: { plan: 'vip' } });
  assert.equal(badPlan.status, 400);

  const badStatus = await call(`/api/admin/users/${target}`, { method: 'PATCH', body: { status: 'banned' } });
  assert.equal(badStatus.status, 400);
});

test('painel: suspender a conta listada reflete na tabela e no diagnóstico', async () => {
  const alvo = makeJar();
  const reg = await signup('alvo@central.com', 'Teste', alvo);
  assert.equal(reg.status, 201);
  const alvoId = reg.data.user.id;
  assert.equal(reg.data.user.role, 'user', 'cadastro normal não é admin');

  const before = (await call('/api/admin/diagnostics')).data;
  assert.equal(before.database.suspended, 0);

  const res = await call(`/api/admin/users/${alvoId}`, { method: 'PATCH', body: { status: 'suspended' } });
  assert.equal(res.status, 200);
  assert.equal(res.data.changed.status, 'suspended');

  const after = (await call('/api/admin/users')).data.users.find((u) => u.id === alvoId);
  assert.equal(after.account_status, 'suspended', 'o painel lê account_status, não status');

  const diag = (await call('/api/admin/diagnostics')).data;
  assert.equal(diag.database.suspended, 1, 'o contador do painel precisa acompanhar');
});

test('painel: subir plano de alguém que não comprou aparece como PRO no catálogo', async () => {
  const alvo = (await call('/api/admin/users')).data.users.find((u) => u.email === 'alvo@central.com');
  const res = await call(`/api/admin/users/${alvo.id}`, { method: 'PATCH', body: { plan: 'pro' } });
  assert.equal(res.status, 200);

  const row = (await call('/api/admin/users')).data.users.find((u) => u.id === alvo.id);
  assert.equal(row.plan, 'pro');

  const catalog = (await call('/api/tools', { jar: makeJar() })).data;
  const elite = catalog.tools.find((t) => t.id === 'shandon-elite');
  assert.equal(elite.access.allowed, false, 'sem sessão, PRO continua barrado');
});

test('painel: campos de /api/admin/tools batem com o que os <select> mandam', () => {
  assert.ok(tools.length > 0);
  for (const t of tools) {
    for (const field of ['id', 'name', 'kind', 'minPlan', 'status', 'position']) {
      assert.ok(field in t, `falta "${field}" em /api/admin/tools`);
    }
    assert.ok(['guest', 'free', 'pro'].includes(t.minPlan), `minPlan inesperado: ${t.minPlan}`);
    assert.ok(['published', 'draft', 'blocked'].includes(t.status), `status inesperado: ${t.status}`);
  }
});

test('painel: mudar plano mínimo e status de ferramenta vale na hora no catálogo público', async () => {
  const res = await call('/api/admin/tools/amorim-follow', { method: 'PATCH', body: { minPlan: 'pro' } });
  assert.equal(res.status, 200);
  assert.equal(res.data.tool.minPlan, 'pro');

  const anon = (await call('/api/tools', { jar: makeJar() })).data;
  const follow = anon.tools.find((t) => t.id === 'amorim-follow');
  assert.equal(follow.access.allowed, false, 'virou PRO, então visitante sem conta perdeu o acesso');
  assert.equal(follow.access.reason, 'login_required', 'visitante sem conta é mandado criar conta antes de falar de plano');
  assert.equal(follow.minPlan, 'pro');

  const back = await call('/api/admin/tools/amorim-follow', { method: 'PATCH', body: { minPlan: 'guest' } });
  assert.equal(back.status, 200);
  const restored = (await call('/api/tools', { jar: makeJar() })).data.tools.find((t) => t.id === 'amorim-follow');
  assert.equal(restored.access.allowed, true, 'volta a ser livre como estava');
});

test('painel: bloquear ferramenta some da lista do visitante mas segue visível pro admin', async () => {
  const block = await call('/api/admin/tools/sonda', { method: 'PATCH', body: { status: 'blocked' } });
  assert.equal(block.status, 200);

  const anon = (await call('/api/tools', { jar: makeJar() })).data;
  const anonSonda = anon.tools.find((t) => t.id === 'sonda');
  assert.ok(anonSonda, 'o catálogo é a mesma lista para todo mundo; quem esconde e o front, via visible');
  assert.equal(anonSonda.visible, false, 'bloqueada não pode ser desenhada pelo visitante');
  assert.equal(anonSonda.access.allowed, false);
  assert.equal(anonSonda.access.reason, 'blocked');

  const adminView = (await call('/api/tools')).data;
  const adminSonda = adminView.tools.find((t) => t.id === 'sonda');
  assert.ok(adminSonda, 'admin precisa ver o que bloqueou, senão não consegue reverter');
  assert.equal(adminSonda.status, 'blocked');
  assert.equal(adminSonda.access.allowed, true, 'admin não perde acesso por bloqueio');

  const back = await call('/api/admin/tools/sonda', { method: 'PATCH', body: { status: 'published' } });
  assert.equal(back.status, 200);
  assert.ok((await call('/api/tools', { jar: makeJar() })).data.tools.find((t) => t.id === 'sonda'));
});

test('painel: diagnóstico traz contadores no lugar que o painel os lê', () => {
  assert.equal(diagnostics.ok, true);
  for (const field of ['users', 'admins', 'suspended', 'tools', 'withPro', 'legacyAdminPlans']) {
    assert.equal(typeof diagnostics.database[field], 'number', `diagnostics.database.${field} ausente`);
  }
  assert.equal(diagnostics.database.admins, 1, 'tem de existir exatamente um admin');
  assert.equal(diagnostics.database.legacyAdminPlans, 0, 'plano legado tem de estar zerado');
  assert.ok(Array.isArray(diagnostics.pending), 'o painel avisa quais segredos faltam');
  assert.ok(diagnostics.pending.includes('APIFY_API_TOKEN'), 'chave do Apify não está configurada neste teste');
});

test('painel: conta não-admin não enxerga nada do painel', async () => {
  const comum = makeJar();
  const reg = await signup('comum@central.com', 'Comum', comum);
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.isAdmin, false);

  for (const path of ['/api/admin/users', '/api/admin/tools', '/api/orders', '/api/admin/diagnostics', '/api/admin/audit']) {
    const res = await call(path, { jar: comum });
    assert.equal(res.status, 403, `${path} respondeu ${res.status} para conta comum`);
  }
  const write = await call('/api/admin/users/1', { method: 'PATCH', jar: comum, body: { role: 'admin' } });
  assert.equal(write.status, 403, 'promover a si mesmo é o ataque clássico; tem de ser barrado');

  const selfPromote = await call(`/api/admin/users/${reg.data.user.id}`, { method: 'PATCH', jar: comum, body: { role: 'admin' } });
  assert.equal(selfPromote.status, 403, 'conta comum não promove a si mesma');

  const selfSuspend = await call(`/api/admin/users/${reg.data.user.id}`, { method: 'PATCH', jar: comum, body: { status: 'suspended' } });
  assert.equal(selfSuspend.status, 403);

  const promoteByAdmin = await call(`/api/admin/users/${reg.data.user.id}`, { method: 'PATCH', body: { role: 'admin' } });
  assert.equal(promoteByAdmin.status, 200, 'promover pelo painel é o caminho legítimo');
  assert.equal(promoteByAdmin.data.user.role, 'admin');

  const rebaixa = await call(`/api/admin/users/${reg.data.user.id}`, { method: 'PATCH', body: { role: 'user' } });
  assert.equal(rebaixa.status, 200, 'e o caminho para devolver a conta a user, sem apagar nada');
});
