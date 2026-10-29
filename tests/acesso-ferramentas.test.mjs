/**
 * CENTRAL AMORIM — Autorização de ferramentas (o portão que faltava)
 *
 * Antes: as 10 rotas de ferramentas OSINT não checavam sessão, plano nem papel.
 * Qualquer pessoa — inclusive visitante sem conta — chamava a API direto pela
 * URL e gastava o crédito de terceiros do dono. O `access/check` existia mas
 * devolvia `allowed:true` para limite numérico e ninguém o chamava.
 *
 * Aqui travamos os quatro níveis: visitante (guest), conta gratuita (free),
 * conta de plano (pro) e admin (role). E provamos que a role administrativa
 * contorna o plano, sem nunca ser confundida com ele.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/backend/app.js';
import { createLocalDb } from '../scripts/local-db.js';

const BASE = 'https://senhoramorim.com.br';
let app;
let db;

function makeEnv(overrides = {}) {
  return {
    PUBLIC_ORIGIN: BASE,
    COOKIE_DOMAIN: '.senhoramorim.com.br',
    COOKIE_SECURE: 'true',
    RATE_LIMIT_MAX: '10000',
    ADMIN_EMAILS: 'boss@central.com',
    ...overrides,
  };
}

async function call(path, { method = 'GET', body, cookie, origin = BASE } = {}) {
  const headers = { origin };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { res, data };
}

async function account(name, email, { pro = false } = {}) {
  const reg = await call('/api/auth/register', { method: 'POST', body: { name, email, password: 'senha-forte-123' } });
  assert.equal(reg.res.status, 201, `cadastro de ${email}: ${reg.data && reg.data.error}`);
  if (pro) {
    db._exec("UPDATE entitlements SET plan = 'pro' WHERE user_id = '" + reg.data.user.id + "'");
  }
  return reg.data.user;
}

async function login(email) {
  const res = await call('/api/auth/login', { method: 'POST', body: { email, password: 'senha-forte-123' } });
  return (res.res.headers.get('set-cookie') || '').split(';')[0];
}

before(() => {
  db = createLocalDb(':memory:');
  app = createApp({ db, env: makeEnv() });
});

/* ------------------------------------------------------------------ */
/* 1. Visitante sem conta é barrado                                    */
/* ------------------------------------------------------------------ */

test('visitante sem sessão é barrado das ferramentas que exigem login', async () => {
  const free = await call('/api/crypto-check', { method: 'POST', body: {} });
  assert.equal(free.res.status, 401);
  assert.equal(free.data.reason, 'login_required');
  assert.equal(free.data.loginUrl, '/entrar');

  const search = await call('/api/search/phone', { method: 'POST', body: { phone: '11999999999' } });
  assert.equal(search.res.status, 401, 'a busca também exige conta');
});

test('visitante é barrado das ferramentas PRO com motivo de upgrade', async () => {
  const ig = await call('/api/instagram', { method: 'POST', body: { username: 'sr__amorim' } });
  assert.equal(ig.res.status, 401, 'sem sessão é 401 (login), não 403');
  assert.equal(ig.data.reason, 'login_required');

  const wa = await call('/api/whatsapp-lookup', { method: 'POST', body: { phone: '554797876098' } });
  assert.equal(wa.res.status, 401);
});

/* ------------------------------------------------------------------ */
/* 2. Conta gratuita: passa no free, barrada no pro                   */
/* ------------------------------------------------------------------ */

test('conta FREE usa as ferramentas gratuitas e não as de plano', async () => {
  const u = await account('Ana Free', 'ana@central.com');
  assert.equal(u.plan, 'FREE');
  const cookie = await login('ana@central.com');

  const crypto = await call('/api/crypto-check', { method: 'POST', body: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }, cookie });
  assert.equal(crypto.res.status, 200, 'crypto-check é gratuito');

  const search = await call('/api/search/phone', { method: 'POST', body: { phone: '11999999999' }, cookie });
  assert.equal(search.res.status, 200);

  const ig = await call('/api/instagram', { method: 'POST', body: { username: 'sr__amorim' }, cookie });
  assert.equal(ig.res.status, 403, 'PRO exige plano pago');
  assert.equal(ig.data.reason, 'upgrade_required');
  assert.equal(ig.data.upgradeUrl, null, 'sem página de planos: não há para onde mandar');
});

/* ------------------------------------------------------------------ */
/* 3. Conta de plano: passa em tudo                                   */
/* ------------------------------------------------------------------ */

test('conta PRO usa as ferramentas pagas', async () => {
  await account('Bruno Pro', 'bruno@central.com', { pro: true });
  const cookie = await login('bruno@central.com');

  const ig = await call('/api/instagram', { method: 'POST', body: { username: 'sr__amorim' }, cookie });
  assert.equal(ig.res.status, 200, 'sem chave configurada responde 200 com configured:false');
  assert.equal(ig.data.success, true);

  const wa = await call('/api/whatsapp-lookup', { method: 'POST', body: { phone: '554797876098' }, cookie });
  assert.equal(wa.res.status, 200);
});

/* ------------------------------------------------------------------ */
/* 4. Admin: role vence plano                                         */
/* ------------------------------------------------------------------ */

test('admin com plano FREE passa em tudo — é a role, não o plano', async () => {
  const boss = await account('Boss', 'boss@central.com');
  assert.equal(boss.role, 'admin');
  assert.equal(boss.plan, 'FREE', 'admin não comprou plano e mesmo assim tem acesso total');
  const cookie = await login('boss@central.com');

  const ig = await call('/api/instagram', { method: 'POST', body: { username: 'sr__amorim' }, cookie });
  assert.equal(ig.res.status, 200, 'role admin contorna o plano');

  const cat = await call('/api/tools', { cookie });
  assert.equal(cat.data.isAdmin, true);
  assert.ok(cat.data.tools.every((t) => t.access.allowed), 'admin vê tudo liberado');
});

/* ------------------------------------------------------------------ */
/* 5. O admin controla o catálogo SEM novo deploy                      */
/* ------------------------------------------------------------------ */

test('admin abre e fecha uma ferramenta pelo painel, na hora', async () => {
  const cookie = await login('boss@central.com');

  // Fecha o crypto-check, que todo mundo FREE usa.
  const off = await call('/api/admin/tools/crypto-check', { method: 'PATCH', cookie, body: { status: 'blocked' } });
  assert.equal(off.res.status, 200);
  assert.equal(off.data.tool.status, 'blocked');
  assert.equal(off.data.tool.blocked, true);

  const ana = await login('ana@central.com');
  const blocked = await call('/api/crypto-check', { method: 'POST', body: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }, cookie: ana });
  assert.equal(blocked.res.status, 403, 'bloqueio vale para todos os planos');
  assert.equal(blocked.data.reason, 'blocked');

  // Admin continua passando (senão o dono tranca a si mesmo).
  const bossStill = await call('/api/crypto-check', { method: 'POST', body: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }, cookie });
  assert.equal(bossStill.res.status, 200, 'admin não fica trancado pelo próprio bloqueio');

  // Reabre.
  const on = await call('/api/admin/tools/crypto-check', { method: 'PATCH', cookie, body: { status: 'published' } });
  assert.equal(on.res.status, 200);
  assert.equal(on.data.tool.published, true);
  const back = await call('/api/crypto-check', { method: 'POST', body: { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }, cookie: ana });
  assert.equal(back.res.status, 200, 'reabrir volta a valer sem novo deploy');
});

test('admin rebaixa uma ferramenta de PRO para gratuita', async () => {
  const cookie = await login('boss@central.com');
  const r = await call('/api/admin/tools/instagram', { method: 'PATCH', cookie, body: { minPlan: 'free' } });
  assert.equal(r.res.status, 200);
  assert.equal(r.data.tool.minPlan, 'free');

  const ana = await login('ana@central.com');
  const now = await call('/api/instagram', { method: 'POST', body: { username: 'sr__amorim' }, cookie: ana });
  assert.equal(now.res.status, 200, 'agora conta gratuita já usa');

  // Devolve ao estado inicial (PRO).
  const back = await call('/api/admin/tools/instagram', { method: 'PATCH', cookie, body: { minPlan: 'pro' } });
  assert.equal(back.data.tool.minPlan, 'pro');
});

test('catálogo recusa plano/status inventado', async () => {
  const cookie = await login('boss@central.com');
  const badPlan = await call('/api/admin/tools/instagram', { method: 'PATCH', cookie, body: { minPlan: 'platinum' } });
  assert.equal(badPlan.res.status, 400);
  const badStatus = await call('/api/admin/tools/instagram', { method: 'PATCH', cookie, body: { status: 'explodido' } });
  assert.equal(badStatus.res.status, 400);
});

test('usuário comum não mexe no catálogo', async () => {
  const ana = await login('ana@central.com');
  assert.equal((await call('/api/admin/tools', { cookie: ana })).res.status, 403);
  assert.equal((await call('/api/admin/tools/crypto-check', { method: 'PATCH', cookie: ana, body: { status: 'blocked' } })).res.status, 403);
  assert.equal((await call('/api/admin/users', { cookie: ana })).res.status, 403);
});

/* ------------------------------------------------------------------ */
/* 6. O catálogo público: o frontend consegue desenhar o cadeado      */
/* ------------------------------------------------------------------ */

test('catálogo público esconde o que está bloqueado/draft e diz o porquê', async () => {
  const cookie = await login('boss@central.com');
  await call('/api/admin/tools/sonda', { method: 'PATCH', cookie, body: { status: 'draft' } });

  const anon = await call('/api/tools');
  assert.equal(anon.res.status, 200);
  const sonda = anon.data.tools.find((t) => t.id === 'sonda');
  assert.equal(sonda.visible, false, 'rascunho não aparece para o público');
  assert.equal(sonda.access.allowed, false);
  assert.equal(sonda.access.reason, 'not_published');

  const boss = await call('/api/tools', { cookie });
  const sondaBoss = boss.data.tools.find((t) => t.id === 'sonda');
  assert.equal(sondaBoss.visible, true, 'admin continua enxergando para poder reverter');

  await call('/api/admin/tools/sonda', { method: 'PATCH', cookie, body: { status: 'published' } });
});

test('catálogo traz as 7 ferramentas já publicadas — nada foi removido', async () => {
  const { data } = await call('/api/tools');
  const ids = data.tools.map((t) => t.id).sort();
  for (const esperado of ['shandon-elite', 'amorim-osint', 'amorim-follow', 'ig-radar', 'sonda', 'panorama', 'sentinela']) {
    assert.ok(ids.includes(esperado), `ferramenta ${esperado} continua no catálogo`);
  }
});

test('visitante vê o que está liberado e o que exige conta', async () => {
  const { data } = await call('/api/tools');
  assert.equal(data.plan, 'VISITOR');
  const byId = Object.fromEntries(data.tools.map((t) => [t.id, t]));

  // Locais e gratuitas: continuam abertas para quem não tem conta.
  for (const gratis of ['amorim-follow', 'ig-radar', 'panorama', 'sentinela', 'sonda']) {
    assert.equal(byId[gratis].access.allowed, true, `${gratis} continua gratuito`);
    assert.equal(byId[gratis].minPlan, 'guest');
  }
  assert.equal(byId['amorim-osint'].access.allowed, false);
  assert.equal(byId['amorim-osint'].access.reason, 'login_required');
  assert.equal(byId['shandon-elite'].access.reason, 'login_required');
});

/* ------------------------------------------------------------------ */
/* 7. access/check corrigido: limite numérico é comparação de verdade  */
/* ------------------------------------------------------------------ */

test('access/check compara limite numérico em vez de devolver true fixo', async () => {
  // Bug antigo: `typeof value === 'boolean' ? value : true` => allowed sempre true.
  const visitanteDentro = await call('/api/access/check', { method: 'POST', body: { project: 'amorim-osint', limit: 'tools', current: 12 } });
  assert.equal(visitanteDentro.data.allowed, true, 'visitante tem 12 e pediu 12');
  assert.equal(visitanteDentro.data.limit, 12);

  const visitanteAcima = await call('/api/access/check', { method: 'POST', body: { project: 'amorim-osint', limit: 'tools', current: 13 } });
  assert.equal(visitanteAcima.data.allowed, false, 'pedir 13 ao limite 12 tem de negar');

  const free = await call('/api/access/check', { method: 'POST', body: { project: 'amorim-osint', limit: 'tools', current: 156 }, cookie: await login('ana@central.com') });
  assert.equal(free.data.allowed, true, 'FREE tem 156');
  const freeAcima = await call('/api/access/check', { method: 'POST', body: { project: 'amorim-osint', limit: 'tools', current: 157 }, cookie: await login('ana@central.com') });
  assert.equal(freeAcima.data.allowed, false);
});

test('access/check ignora plano enviado pelo cliente e resolve pelo servidor', async () => {
  const mentiroso = await call('/api/access/check', {
    method: 'POST',
    body: { project: 'amorim-osint', limit: 'tools', current: 5000, plan: 'pro', role: 'admin' },
  });
  assert.equal(mentiroso.data.allowed, false, 'mandar plan:pro no corpo não libera nada');
  assert.equal(mentiroso.data.role, 'guest');
});

test('access/check também decide por ferramenta', async () => {
  const { data } = await call('/api/access/check', { method: 'POST', body: { tool: 'shandon-elite' }, cookie: await login('ana@central.com') });
  assert.equal(data.tool.allowed, false);
  assert.equal(data.tool.reason, 'upgrade_required');
});

/* ------------------------------------------------------------------ */
/* 8. SSO: a Central precisa responder com credenciais ao app irmão     */
/* ------------------------------------------------------------------ */

test('CORS com credenciais para o app do Shandon Elite', async () => {
  const res = await app.fetch(new Request(`${BASE}/api/auth/me`, {
    headers: { origin: 'https://elite.senhoramorim.com.br' },
  }));
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://elite.senhoramorim.com.br');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true', 'sem isso o cookie nunca atravessa o navegador');
  assert.equal(res.headers.get('vary'), 'Origin');
});

test('origem não autorizada não recebe cabeçalho de CORS', async () => {
  const res = await app.fetch(new Request(`${BASE}/api/auth/me`, { headers: { origin: 'https://site-malicioso.example' } }));
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('preflight OPTIONS responde com as credenciais', async () => {
  const res = await app.fetch(new Request(`${BASE}/api/crypto-check`, {
    method: 'OPTIONS',
    headers: { origin: 'https://elite.senhoramorim.com.br', 'access-control-request-method': 'POST' },
  }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  assert.match(res.headers.get('access-control-allow-methods') || '', /PATCH/);
});

/* ------------------------------------------------------------------ */
/* 9. Cadastro aberto continua sendo cadastro aberto                   */
/* ------------------------------------------------------------------ */

test('a resposta de acesso não vaza segredo do usuário', async () => {
  const cookie = await login('ana@central.com');
  const { data } = await call('/api/auth/me', { cookie });
  assert.equal(data.user.password_hash, undefined);
  assert.equal(data.user.passwordHash, undefined);
  assert.equal(data.user.role, 'user');
  assert.equal(data.user.isAdmin, false);
});

test('mudança de plano pelo painel não dá poder administrativo', async () => {
  const boss = await login('boss@central.com');
  const users = await call('/api/admin/users', { cookie: boss });
  const ana = users.data.users.find((u) => u.email === 'ana@central.com');
  const r = await call(`/api/admin/users/${ana.id}`, { method: 'PATCH', cookie: boss, body: { plan: 'pro' } });
  assert.equal(r.res.status, 200);
  assert.equal(r.data.user.plan, 'pro');
  assert.equal(r.data.user.role, 'user', 'comprar plano não promove a role');

  const cookie = await login('ana@central.com');
  assert.equal((await call('/api/admin/users', { cookie })).res.status, 403, 'PRO não entra no painel');
  const ig = await call('/api/instagram', { method: 'POST', body: { username: 'sr__amorim' }, cookie });
  assert.equal(ig.res.status, 200, 'mas usa as ferramentas pagas');
});

test('a trilha de auditoria registra quem mexeu no quê', async () => {
  const boss = await login('boss@central.com');
  const { data } = await call('/api/admin/audit', { cookie: boss });
  assert.equal(data.ok, true);
  assert.ok(data.entries.length > 0, 'houve alteração de ferramenta neste teste');
  const last = data.entries[0];
  assert.equal(last.actor_email, 'boss@central.com');
  assert.ok(['tool.update', 'user.update'].includes(last.action));
});
