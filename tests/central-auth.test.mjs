/**
 * CENTRAL AMORIM — Auth & Access test-suite.
 *
 * Runs the EXACT production handler (createApp) against a real SQLite
 * (node:sqlite shim), covering: register/login/logout/me, duplicate &
 * invalid input, FREE/ADMIN plans, admin routes, plans catalog, server-side
 * access/check for VISITOR/FREE/PRO, password recovery flow, rate limit,
 * cookie attributes, Origin checks and Google probe gating.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/backend/app.js';
import { createLocalDb } from '../scripts/local-db.js';

const BASE = 'https://central.senhoramim.com.br';

let apps = {};

function makeEnv(overrides = {}) {
  return {
    PUBLIC_ORIGIN: 'https://central.senhoramim.com.br',
    COOKIE_DOMAIN: '.senhoramim.com.br',
    COOKIE_SECURE: 'true',
    RATE_LIMIT_MAX: '1000',
    ...overrides,
  };
}

function handlerName(name) {
  return `app-${name}`;
}

function freshApp(name, envOverrides = {}) {
  const db = createLocalDb(':memory:');
  const env = makeEnv(envOverrides);
  const app = createApp({ db, env });
  apps[handlerName(name)] = { app, db, env };
  return { app, db, env };
}

async function call(name, path, { method = 'GET', body, cookie, origin, base = BASE } = {}) {
  const { app } = apps[handlerName(name)];
  const headers = {};
  if (cookie) headers['cookie'] = cookie;
  if (origin) headers['origin'] = origin;
  const req = new Request(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (body !== undefined) req.headers.set('content-type', 'application/json');
  const res = await app.fetch(req);
  let data = null;
  if (res.headers.get('content-type')?.includes('application/json')) {
    data = await res.json();
  }
  return { res, data, headers: res.headers };
}

function cookieFrom(res) {
  const c = res.headers.get('set-cookie');
  return c ? c : null;
}

function sessionTokenFrom(setCookie) {
  const m = /sam_session=([^;]+)/.exec(setCookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}

function sessionCookieName() {
  return 'sam_session';
}

async function register(name, { name: n, email, password }) {
  return call(name, '/api/auth/register', {
    method: 'POST',
    body: { name: n, email, password },
  });
}

before(() => {
  freshApp('main');
});

test('health responde ok e cria o serviço', async () => {
  const { data, res } = await call('main', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.service, 'central-amorim');
});

test('registro cria conta FREE e define cookie de sessão', async () => {
  const { data, res } = await register('main', {
    name: 'Ana Teste',
    email: 'ana@teste.com',
    password: 'senha-segura-123',
  });
  assert.equal(res.status, 201);
  assert.equal(data.ok, true);
  assert.equal(data.user.email, 'ana@teste.com');
  assert.equal(data.user.plan, 'FREE');
  assert.equal(data.user.planLabel, 'Plano gratuito');
  assert.equal(data.user.entitlement.plan, 'free');
  assert.match(cookieFrom(res), /sam_session=[0-9a-f]+/);
});

test('registro rejeita e-mail duplicado', async () => {
  await register('main', { name: 'Ana Teste', email: 'ana@teste.com', password: 'senha-segura-123' });
  const { data, res } = await register('main', {
    name: 'Ana 2',
    email: 'ana@teste.com',
    password: 'outra-senha-456',
  });
  assert.equal(res.status, 409);
  assert.equal(data.ok, false);
});

test('registro rejeita entradas inválidas', async () => {
  for (const body of [
    { name: 'A', email: 'x@y.com', password: 'senha-segura-123' },
    { name: 'Nome', email: 'invalido', password: 'senha-segura-123' },
    { name: 'Nome', email: 'x@y.com', password: '123' },
    { name: 'Nome', email: 'x@y.com', password: '' },
  ]) {
    const { data, res } = await call('main', '/api/auth/register', { method: 'POST', body });
    assert.equal(res.status, 400, `esperava 400 para ${JSON.stringify(body)}`);
    assert.equal(data.ok, false);
  }
});

test('senha é armazenada como hash PBKDF2 (nunca em texto puro)', async () => {
  const { db } = apps[handlerName('main')];
  const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').bind('ana@teste.com').first();
  assert.ok(row);
  assert.match(row.password_hash, /^pbkdf2_sha256\$100000\$/);
  assert.notEqual(row.password_hash, 'senha-segura-123');
  assert.equal(row.password_hash.includes('senha-segura-123'), false);
});

test('login com senha incorreta retorna 401', async () => {
  const { res, data } = await call('main', '/api/auth/login', {
    method: 'POST',
    body: { email: 'ana@teste.com', password: 'senha-errada' },
  });
  assert.equal(res.status, 401);
  assert.equal(data.ok, false);
});

test('login correto cria sessão e me() devolve o usuário', async () => {
  const { res, headers } = await call('main', '/api/auth/login', {
    method: 'POST',
    body: { email: 'ana@teste.com', password: 'senha-segura-123' },
  });
  assert.equal(res.status, 200);
  const setCookie = headers.get('set-cookie');
  assert.ok(setCookie, 'esperava set-cookie no login');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Domain=\.senhoramim\.com\.br/);

  const token = sessionTokenFrom(setCookie);
  const me = await call('main', '/api/auth/me', { cookie: `${sessionCookieName()}=${token}` });
  assert.equal(me.res.status, 200);
  assert.equal(me.data.authenticated, true);
  assert.equal(me.data.user.email, 'ana@teste.com');
  assert.equal(me.data.user.plan, 'FREE');
});

test('me() sem sessão retorna não autenticado', async () => {
  const { res, data } = await call('main', '/api/auth/me');
  assert.equal(res.status, 401);
  assert.equal(data.authenticated, false);
});

test('logout invalida a sessão', async () => {
  const { headers } = await call('main', '/api/auth/login', {
    method: 'POST',
    body: { email: 'ana@teste.com', password: 'senha-segura-123' },
  });
  const token = sessionTokenFrom(headers.get('set-cookie'));
  const cookie = `${sessionCookieName()}=${token}`;

  const logout = await call('main', '/api/auth/logout', { method: 'POST', cookie });
  assert.equal(logout.res.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

  const me = await call('main', '/api/auth/me', { cookie });
  assert.equal(me.res.status, 401);
});

test('mutação com Origin não permitido é bloqueada', async () => {
  const { res } = await call('main', '/api/auth/register', {
    method: 'POST',
    body: { name: 'Mala', email: 'mala@evil.com', password: 'senha-segura-123' },
    origin: 'https://evil.example',
  });
  assert.equal(res.status, 403);
});

/* Regressão: o app rodando em um host fora de PUBLIC_ORIGIN (ex.: o
   endereço *.workers.dev, ou www vs. sem-www) recebia 403 em todo POST de
   login/cadastro e ficava impossível criar conta. */
test('mutação same-origin funciona mesmo fora de PUBLIC_ORIGIN', async () => {
  freshApp('host');
  const { res, data } = await call('host', '/api/auth/register', {
    method: 'POST',
    body: { name: 'Dona', email: 'dona@exemplo.com', password: 'senha-segura-123' },
    origin: 'https://central-amorim.workers.dev',
    base: 'https://central-amorim.workers.dev',
  });
  assert.equal(res.status, 201, 'registro não deve ser bloqueado no próprio host');
  assert.equal(data.user.email, 'dona@exemplo.com');
});

test('login funciona em host fora do domínio do cookie (sessão persiste)', async () => {
  freshApp('host2');
  const reg = await call('host2', '/api/auth/register', {
    method: 'POST',
    body: { name: 'Dona', email: 'dona2@exemplo.com', password: 'senha-segura-123' },
    base: 'https://app.workers.dev',
  });
  assert.equal(reg.res.status, 201);
  const setCookie = reg.res.headers.get('set-cookie') || '';
  assert.doesNotMatch(setCookie, /Domain=/, 'não enviar Domain fora do domínio configurado');
  const token = sessionTokenFrom(setCookie);
  const me = await call('host2', '/api/auth/me', {
    cookie: `sam_session=${encodeURIComponent(token)}`,
    base: 'https://app.workers.dev',
  });
  assert.equal(me.res.status, 200, 'sessão deve persistir no host alternativo');
  assert.equal(me.data.user.email, 'dona2@exemplo.com');
});

test('ALLOWED_ORIGINS amplia as origens aceitas', async () => {
  freshApp('extra', { ALLOWED_ORIGINS: 'https://app.amorim.app' });
  const { res } = await call('extra', '/api/auth/register', {
    method: 'POST',
    body: { name: 'Dona', email: 'dona3@exemplo.com', password: 'senha-segura-123' },
    origin: 'https://app.amorim.app',
  });
  assert.equal(res.status, 201);
});

test('admin regainido por e-mail na lista mesmo com plano antigo', async () => {
  freshApp('admin2');
  const reg = await call('admin2', '/api/auth/register', {
    method: 'POST',
    body: { name: 'Chefe', email: 'chefe@central.com', password: 'senha-segura-123' },
  });
  assert.equal(reg.res.status, 201);
  assert.equal(reg.data.user.plan, 'FREE');
  const token = sessionTokenFrom(reg.res.headers.get('set-cookie'));
  const cookie = `sam_session=${encodeURIComponent(token)}`;

  const { db } = apps[handlerName('admin2')];
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind('chefe@central.com').first();
  await db.prepare("UPDATE entitlements SET plan = 'free' WHERE user_id = ?").bind(user.id).run();

  // O dono adiciona o e-mail em ADMIN_EMAILS depois do cadastro. Em produção
  // o Worker recria o app a cada request, então o novo cfg já enxerga a lista.
  const app = createApp({ db, env: { ...makeEnv(), ADMIN_EMAILS: 'chefe@central.com' } });
  const callNew = async (path) => {
    const req = new Request(`${BASE}${path}`, { headers: { cookie } });
    const res = await app.fetch(req);
    return { res, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
  };

  const me = await callNew('/api/auth/me');
  assert.equal(me.data.user.plan, 'ADMIN', 'e-mail em ADMIN_EMAILS deve conceder admin');

  const users = await callNew('/api/admin/users');
  assert.equal(users.res.status, 200, 'painel admin deve destravar');
  assert.equal(users.data.users.length, 1);
});

test('rate limit bloqueia tentativas sucessivas de login', async () => {
  freshApp('rl', { PUBLIC_ORIGIN: 'https://central.senhoramim.com.br', RATE_LIMIT_MAX: '6' });
  let last;
  for (let i = 0; i < 6; i++) {
    last = await call('rl', '/api/auth/login', {
      method: 'POST',
      body: { email: 'rl@teste.com', password: 'senha-errada' },
    });
  }
  assert.equal(last.res.status, 401, 'ainda dentro do limite');
  const blocked = await call('rl', '/api/auth/login', {
    method: 'POST',
    body: { email: 'rl@teste.com', password: 'tambem-errada' },
  });
  assert.equal(blocked.res.status, 429);
});

test('e-mail de admin em ADMIN_EMAILS vira conta ADMIN', async () => {
  freshApp('admin', { ADMIN_EMAILS: 'boss@admin.com' });
  const { data, res } = await register('admin', {
    name: 'Boss',
    email: 'boss@admin.com',
    password: 'senha-admin-123',
  });
  assert.equal(res.status, 201);
  assert.equal(data.user.plan, 'ADMIN');
  assert.equal(data.user.planLabel, 'Acesso administrativo');
});

test('admin pode listar usuários; não-admin é negado', async () => {
  freshApp('admin2', { ADMIN_EMAILS: 'boss2@admin.com' });
  await register('admin2', { name: 'Boss2', email: 'boss2@admin.com', password: 'senha-admin-123' });
  await register('admin2', { name: 'Fulano', email: 'fulano@admin.com', password: 'senha-fulano-123' });

  const loginBoss = await call('admin2', '/api/auth/login', {
    method: 'POST',
    body: { email: 'boss2@admin.com', password: 'senha-admin-123' },
  });
  const bossCookie = `${sessionCookieName()}=${sessionTokenFrom(loginBoss.headers.get('set-cookie'))}`;
  const list = await call('admin2', '/api/admin/users', { cookie: bossCookie });
  assert.equal(list.res.status, 200);
  assert.ok(list.data.users.length >= 2);

  const loginFulano = await call('admin2', '/api/auth/login', {
    method: 'POST',
    body: { email: 'fulano@admin.com', password: 'senha-fulano-123' },
  });
  const fulanoCookie = `${sessionCookieName()}=${sessionTokenFrom(loginFulano.headers.get('set-cookie'))}`;
  const denied = await call('admin2', '/api/admin/users', { cookie: fulanoCookie });
  assert.equal(denied.res.status, 403);
});

test('catálogo de planos expõe FREE/PRO/ADMIN', async () => {
  const { data, res } = await call('main', '/api/plans');
  assert.equal(res.status, 200);
  const codes = data.plans.map((p) => p.code);
  assert.deepEqual(codes, ['FREE', 'PRO', 'ADMIN']);
  const pro = data.plans.find((p) => p.code === 'PRO');
  assert.equal(pro.available, false, 'PRO sem checkout nesta etapa');
  assert.equal(pro.billing.unique, 9.99, 'PRO pagamento único definido');
  assert.equal(pro.billing.monthly, 9.9, 'PRO mensal opcional definido');
  assert.ok(Array.isArray(pro.features) && pro.features.length > 0, 'PRO expõe lista de recursos');
  const free = data.plans.find((p) => p.code === 'FREE');
  assert.deepEqual(free.limits.freeCategories, ['Username', 'Search Engines', 'AI Tools', 'Encoding / Decoding', 'Archives']);
});

test('access/check para visitante devolve limite demo', async () => {
  const { data, res } = await call('main', '/api/access/check', {
    method: 'POST',
    body: { project: 'amorim-osint', limit: 'tools' },
  });
  assert.equal(res.status, 200);
  assert.equal(data.plan, 'VISITOR');
  assert.equal(data.demo, true);
  assert.equal(data.limit, 12);
  assert.match(data.message, /Crie uma conta gratuita/);
});

test('access/check para conta FREE devolve limites do plano', async () => {
  const { headers } = await call('main', '/api/auth/login', {
    method: 'POST',
    body: { email: 'ana@teste.com', password: 'senha-segura-123' },
  });
  const cookie = `${sessionCookieName()}=${sessionTokenFrom(headers.get('set-cookie'))}`;

  const tools = await call('main', '/api/access/check', { method: 'POST', body: { limit: 'tools' }, cookie });
  assert.equal(tools.data.plan, 'FREE');
  assert.equal(tools.data.demo, false);
  assert.equal(tools.data.limit, 156);

  const cats = await call('main', '/api/access/check', { method: 'POST', body: { limit: 'categories' }, cookie });
  assert.equal(cats.data.limit, 5);

  const exp = await call('main', '/api/access/check', { method: 'POST', body: { limit: 'export' }, cookie });
  assert.equal(exp.data.limit, false);
  assert.equal(exp.data.allowed, false, 'FREE não pode exportar');
});

test('access/check para PRO devolve limites ampliados e export', async () => {
  freshApp('pro', {});
  const reg = await register('pro', { name: 'Pro User', email: 'pro@teste.com', password: 'senha-pro-123' });
  const proId = reg.data.user.id;
  const { db } = apps[handlerName('pro')];
  db._exec(`UPDATE entitlements SET plan = 'pro' WHERE user_id = '${proId}'`);

  const { headers } = await call('pro', '/api/auth/login', {
    method: 'POST',
    body: { email: 'pro@teste.com', password: 'senha-pro-123' },
  });
  const cookie = `${sessionCookieName()}=${sessionTokenFrom(headers.get('set-cookie'))}`;
  const check = await call('pro', '/api/access/check', { method: 'POST', body: { limit: 'tools' }, cookie });
  assert.equal(check.data.plan, 'PRO');
  assert.equal(check.data.limit, 1168);
  assert.equal(check.data.message, 'Acesso liberado.');

  const exp = await call('pro', '/api/access/check', { method: 'POST', body: { limit: 'export' }, cookie });
  assert.equal(exp.data.limit, true);
  assert.equal(exp.data.allowed, true);
});

test('redefinição de senha: forgot → token → reset → novo login', async () => {
  freshApp('reset', {});
  await register('reset', { name: 'Reset', email: 'reset@teste.com', password: 'senha-antiga-123' });

  const forgot = await call('reset', '/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'reset@teste.com' },
  });
  assert.equal(forgot.res.status, 200);
  assert.equal(forgot.data.ok, true);
  assert.match(forgot.data.message, /Se o e-mail existir/);

  const { db } = apps[handlerName('reset')];
  const row = (await db.prepare('SELECT token FROM password_resets WHERE used_at IS NULL ORDER BY created_at DESC').all())[0];
  assert.ok(row, 'token de reset deve existir no banco');

  const bad = await call('reset', '/api/auth/reset-password', { method: 'POST', body: { token: 'token-invalido', password: 'nova-senha-123' } });
  assert.equal(bad.res.status, 400);

  const reset = await call('reset', '/api/auth/reset-password', { method: 'POST', body: { token: row.token, password: 'nova-senha-123' } });
  assert.equal(reset.res.status, 200);
  assert.equal(reset.data.ok, true);

  const oldLogin = await call('reset', '/api/auth/login', { method: 'POST', body: { email: 'reset@teste.com', password: 'senha-antiga-123' } });
  assert.equal(oldLogin.res.status, 401, 'senha antiga não deve funcionar');

  const newLogin = await call('reset', '/api/auth/login', { method: 'POST', body: { email: 'reset@teste.com', password: 'nova-senha-123' } });
  assert.equal(newLogin.res.status, 200, 'nova senha deve funcionar');
});

test('forgot-password responde igual para e-mail inexistente (anti-enumeração)', async () => {
  freshApp('anti', {});
  const { data, res } = await call('anti', '/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'nao-existe@teste.com' },
  });
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.match(data.message, /Se o e-mail existir/);
});

test('cookies são SameSite=Lax, Secure, HttpOnly e com domínio ao configurar', async () => {
  const { res, headers } = await register('main', {
    name: 'Cookie Test',
    email: 'cookie@teste.com',
    password: 'senha-cookie-123',
  });
  assert.equal(res.status, 201);
  const setCookie = headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Domain=\.senhoramim\.com\.br/);
  assert.match(setCookie, /Max-Age=/);
});

test('probe-google reflete configuração sem expor segredos', async () => {
  freshApp('gp-off', {});
  const off = await call('gp-off', '/api/auth/probe-google', { method: 'POST', body: {} });
  assert.equal(off.data.enabled, false);
  assert.ok(!JSON.stringify(off.data).includes('secret'));

  freshApp('gp-on', { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' });
  const on = await call('gp-on', '/api/auth/probe-google', { method: 'POST', body: {} });
  assert.equal(on.data.enabled, true);
});

test('google/start redireciona quando configurado e 501 quando não', async () => {
  freshApp('go-off', {});
  const off = await call('go-off', '/api/auth/google/start');
  assert.equal(off.res.status, 501);

  freshApp('go-on', { GOOGLE_CLIENT_ID: 'client-x', GOOGLE_CLIENT_SECRET: 'secret-y' });
  const on = await call('go-on', '/api/auth/google/start');
  assert.equal(on.res.status, 302);
  assert.match(on.headers.get('location'), /^https:\/\/accounts\.google\.com/);
  assert.ok(on.headers.get('set-cookie').includes('sam_oauth_state='));
});

test('rotas da API desconhecidas devolvem 404 JSON', async () => {
  const { res } = await call('main', '/api/nao-existe');
  assert.equal(res.status, 404);
});

test('me() nunca expõe password_hash ou segredos do usuário', async () => {
  const { headers } = await call('main', '/api/auth/login', {
    method: 'POST',
    body: { email: 'ana@teste.com', password: 'senha-segura-123' },
  });
  const cookie = `${sessionCookieName()}=${sessionTokenFrom(headers.get('set-cookie'))}`;
  const { data, res } = await call('main', '/api/auth/me', { cookie });
  assert.equal(res.status, 200);
  assert.equal(data.user.email, 'ana@teste.com', 'o dono vê o próprio e-mail');
  const json = JSON.stringify(data);
  assert.ok(!/(password|_hash|secret|token)/i.test(json), 'me() não deve vazar credenciais/sessão');
});

test('access/check decide no servidor e ignora plano enviado pelo cliente', async () => {
  const { headers } = await call('main', '/api/auth/login', {
    method: 'POST',
    body: { email: 'ana@teste.com', password: 'senha-segura-123' },
  });
  const cookie = `${sessionCookieName()}=${sessionTokenFrom(headers.get('set-cookie'))}`;

  // Tenta escalar para PRO enviando plan no body — o servidor continua FREE.
  const attempt = await call('main', '/api/access/check', {
    method: 'POST',
    body: { project: 'amorim-osint', limit: 'tools', plan: 'pro' },
    cookie,
  });
  assert.equal(attempt.data.plan, 'FREE');

  // Visitante também não escala por body.
  const guest = await call('main', '/api/access/check', {
    method: 'POST',
    body: { project: 'amorim-osint', limit: 'tools', plan: 'admin', role: 'admin' },
  });
  assert.equal(guest.data.plan, 'VISITOR');
  assert.equal(guest.data.allowed, true);
  assert.equal(guest.data.limit, 12);
  assert.equal(guest.data.demo, true);
});

test('não existe rota pública para alterar plano/entitlement', async () => {
  const list = [
    ['POST', '/api/admin/plans'],
    ['POST', '/api/auth/upgrade'],
    ['POST', '/api/auth/plan'],
    ['PUT', '/api/auth/me/plan'],
    ['POST', '/api/entitlements'],
  ];
  for (const [method, path] of list) {
    const { res } = await call('main', path, { method, body: { plan: 'pro' } });
    assert.equal(res.status, 404, `${method} ${path} deve ser 404`);
  }
});

test('cookie de OAuth state respeita Secure e é HttpOnly/SameSite=Lax', async () => {
  freshApp('oauth-secure', { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's' });
  const on = await call('oauth-secure', '/api/auth/google/start');
  const sc = on.headers.get('set-cookie');
  assert.match(sc, /sam_oauth_state=[0-9a-f]+/);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  assert.match(sc, /Secure/);
  assert.match(sc, /Max-Age=600/);

  freshApp('oauth-insecure', { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', COOKIE_SECURE: 'false' });
  const off = await call('oauth-insecure', '/api/auth/google/start');
  assert.ok(!off.headers.get('set-cookie').includes('Secure'));
});
/* ---------- Diagnóstico do ambiente (admin) ---------- */

test('diagnóstico exige admin e nunca expõe o valor de um segredo', async () => {
  freshApp('diag', { ADMIN_EMAILS: 'boss@diag.com' });

  const anon = await call('diag', '/api/admin/diagnostics');
  assert.equal(anon.res.status, 401, 'visitante não pode ver');

  const reg = await register('diag', { name: 'Boss', email: 'boss@diag.com', password: 'senha-admin-123' });
  const token = sessionTokenFrom(reg.res.headers.get('set-cookie'));

  // Usuário comum, logado: existe, mas não é admin.
  freshApp('diagUser', { ADMIN_EMAILS: 'outro@diag.com' });
  const userReg = await register('diagUser', { name: 'Comum', email: 'comum@diag.com', password: 'senha-comum-123' });
  const userToken = sessionTokenFrom(userReg.res.headers.get('set-cookie'));
  const nonAdmin = await call('diagUser', '/api/admin/diagnostics', { cookie: `sam_session=${encodeURIComponent(userToken)}` });
  assert.equal(nonAdmin.res.status, 403, 'usuário comum não pode ver o diagnóstico');

  const ok = await call('diag', '/api/admin/diagnostics', { cookie: `sam_session=${encodeURIComponent(token)}` });
  assert.equal(ok.res.status, 200);
  assert.equal(ok.data.secrets.APIFY_API_TOKEN, false, 'sem token deve reportar false');
  assert.equal(ok.data.config.pixConfigured, false);
  assert.equal(ok.data.database.users, 1);
  assert.equal(ok.data.config.adminEmails, 1);

  // O segredo configurado precisa aparecer como true, e o valor jamais pode vazar.
  const withToken = createApp({ db: apps[handlerName('diag')].db, env: { ...makeEnv(), ADMIN_EMAILS: 'boss@diag.com', APIFY_API_TOKEN: 'apify_api_segredo' } });
  const res = await withToken.fetch(new Request(`${BASE}/api/admin/diagnostics`, { headers: { cookie: `sam_session=${encodeURIComponent(token)}` } }));
  const body = await res.json();
  assert.equal(body.secrets.APIFY_API_TOKEN, true, 'token configurado deve reportar true');
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('apify_api_segredo'), 'o valor do segredo não pode aparecer na resposta');
  assert.ok(!/"APIFY_API_TOKEN":\s*"[^"]+"/.test(raw), 'segredo deve sair como booleano');
});

test('diagnóstico lista como pendente o que falta, e a dica fica no response', async () => {
  freshApp('diag3', { ADMIN_EMAILS: 'boss@diag3.com' });
  const reg = await register('diag3', { name: 'Boss', email: 'boss@diag3.com', password: 'senha-admin-123' });
  const token = sessionTokenFrom(reg.res.headers.get('set-cookie'));
  const { data } = await call('diag3', '/api/admin/diagnostics', { cookie: `sam_session=${encodeURIComponent(token)}` });

  // Nada configurado: as duas chaves de OSINT e o e-mail precisam aparecer.
  assert.ok(data.pending.includes('APIFY_API_TOKEN'), 'token do Apify ausente deve ser pendente');
  assert.ok(data.pending.includes('RAPIDAPI_WHATSAPP_KEY'), 'chave do WhatsApp ausente deve ser pendente');
  assert.ok(data.pending.includes('RESEND_API_KEY'), 'e-mail ausente deve ser pendente');
  // Google é opcional: nunca entra na lista de pendências.
  assert.ok(!data.pending.includes('GOOGLE_CLIENT_ID'), 'Google é opcional');
  assert.match(data.hint.onde, /central-amorim/);
  assert.match(data.hint.nome, /APIFY_API_TOKEN/);
});
