/**
 * CENTRAL AMORIM — Pix/orders test-suite.
 *
 * Covers the PRO checkout flow end-to-end against the exact production
 * handler (createApp + node:sqlite): pix config, order creation, validation,
 * admin listing/activation and automatic PRO entitlement.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, PLANS } from '../src/backend/app.js';
import { createLocalDb } from '../scripts/local-db.js';

const BASE = 'https://central.test';
let apps = {};

function makeEnv(overrides = {}) {
  return {
    PUBLIC_ORIGIN: 'https://central.senhoramorim.com.br',
    COOKIE_DOMAIN: '.senhoramorim.com.br',
    COOKIE_SECURE: 'true',
    RATE_LIMIT_MAX: '1000',
    ...overrides,
  };
}

function freshApp(name, envOverrides = {}) {
  const db = createLocalDb(':memory:');
  const env = makeEnv(envOverrides);
  const app = createApp({ db, env });
  apps[name] = { app, db, env };
  return { app, db, env };
}

async function call(name, path, { method = 'GET', body, cookie, origin } = {}) {
  const { app } = apps[name];
  const headers = {};
  if (cookie) headers['cookie'] = cookie;
  if (origin) headers['origin'] = origin;
  const req = new Request(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (body !== undefined) req.headers.set('content-type', 'application/json');
  const res = await app.fetch(req);
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : null;
  return { res, data, headers: res.headers };
}

function sessionToken(setCookie) {
  const m = /sam_session=([^;]+)/.exec(setCookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}
function cookieFrom(res) {
  return res.headers.get('set-cookie') || null;
}

async function register(nameApp, { name, email, password }) {
  return call(nameApp, '/api/auth/register', { method: 'POST', body: { name, email, password } });
}

before(() => {
  freshApp('off'); // sem PIX configurado
  freshApp('pay', { PIX_KEY: 'central-amorim@exemplo.com', PIX_NAME: 'SENHOR AMORIM', PIX_CITY: 'BRASIL', PIX_AMOUNT_BRL: '79' });
  freshApp('admin', { PIX_KEY: 'central-amorim@exemplo.com', ADMIN_EMAILS: 'dono@central.com' });
});

test('sem chave Pix o checkout fica indisponível', async () => {
  const a = await call('off', '/api/pix/config');
  assert.equal(a.res.status, 200);
  assert.equal(a.data.enabled, false);
  assert.equal(a.data.pix, null);

  const b = await call('off', '/api/orders', { method: 'POST', body: { name: 'Ana', email: 'ana@bol.com', cpf: '12345678901' } });
  assert.equal(b.res.status, 503);
  assert.equal(b.data.ok, false);
});

test('config pública entrega copy-paste Pix válido', async () => {
  const a = await call('pay', '/api/pix/config');
  assert.equal(a.data.enabled, true);
  assert.ok(a.data.pix.copyPaste.startsWith('000201'), 'payload deve começar com 000201');
  assert.match(a.data.pix.copyPaste, /6304[0-9A-F]{4}$/, 'deve terminar em 6304 + CRC');
  assert.equal(a.data.pix.amountBRL, 79);
  assert.equal(a.data.pro.price, 79);
});

test('criação de pedido valida entrada e gera código', async () => {
  const ok = await call('pay', '/api/orders', { method: 'POST', body: { name: 'Ana Clara', email: 'ana@bol.com' } });
  assert.equal(ok.res.status, 201);
  assert.equal(ok.data.ok, true);
  assert.match(ok.data.order.code, /^COD-[A-Z2-9]{6}$/);
  assert.equal(ok.data.order.status, 'pending');
  assert.equal(ok.data.order.amount, 7900);
  assert.ok(ok.data.pix.copyPaste.startsWith('000201'));

  const badEmail = await call('pay', '/api/orders', { method: 'POST', body: { name: 'Ana', email: 'nao-e-email' } });
  assert.equal(badEmail.res.status, 400);

  const badCpf = await call('pay', '/api/orders', { method: 'POST', body: { name: 'Ana', email: 'ana2@bol.com', cpf: '123' } });
  assert.equal(badCpf.res.status, 400);
});

test('pedidos exigem admin e ativam PRO para o comprador', async () => {
  const user = await register('admin', { name: 'Dono', email: 'dono@central.com', password: 'senha-forte-123' });
  const cookie = cookieFrom(user.res);
  assert.equal(user.data.user.plan, 'ADMIN');

  const order = await call('admin', '/api/orders', { method: 'POST', body: { name: 'Cliente', email: 'cliente@bol.com' } });
  const code = order.data.order.code;

  const deny = await call('admin', '/api/orders');
  assert.equal(deny.res.status, 401, 'sem sessão não lista pedidos');

  const list = await call('admin', '/api/orders', { cookie });
  assert.equal(list.res.status, 200);
  assert.ok(list.data.orders.some((o) => o.code === code));

  const activate = await call('admin', '/api/orders/activate', { method: 'POST', body: { code }, cookie });
  assert.equal(activate.res.status, 200);
  assert.equal(activate.data.order.status, 'activated');

  const again = await call('admin', '/api/orders/activate', { method: 'POST', body: { code }, cookie });
  assert.equal(again.res.status, 409, 'segunda ativação deve falhar');
});

test('comprador existente vira PRO após ativação e na criação de conta', async () => {
  freshApp('pro', { PIX_KEY: 'central-amorim@exemplo.com', ADMIN_EMAILS: 'dono@pro.com' });

  const dono = await register('pro', { name: 'Dono', email: 'dono@pro.com', password: 'senha-forte-123' });
  assert.equal(dono.data.user.plan, 'ADMIN');
  const donoCookie = cookieFrom(dono.res);

  const jaExistia = await register('pro', { name: 'Compra Antes', email: 'compra@bol.com', password: 'senha-forte-123' });
  assert.equal(jaExistia.data.user.plan, 'FREE');
  const cookieCompra = cookieFrom(jaExistia.res);

  const order = await call('pro', '/api/orders', { method: 'POST', body: { name: 'Compra Antes', email: 'compra@bol.com' } });
  const act = await call('pro', '/api/orders/activate', { method: 'POST', body: { code: order.data.order.code }, cookie: donoCookie });
  assert.equal(act.res.status, 200);

  const me = await call('pro', '/api/auth/me', { cookie: cookieCompra });
  assert.equal(me.data.user.plan, 'PRO');

  const pre = await call('pro', '/api/orders', { method: 'POST', body: { name: 'Nascida Pro', email: 'nascer.pro@bol.com' } });
  await call('pro', '/api/orders/activate', { method: 'POST', body: { code: pre.data.order.code }, cookie: donoCookie });

  const nova = await register('pro', { name: 'Nascida Pro', email: 'nascer.pro@bol.com', password: 'senha-forte-123' });
  assert.equal(nova.data.user.plan, 'PRO');
});

test('planos marca PRO como disponível quando chave Pix existe', async () => {
  const a = await call('pay', '/api/plans');
  const pro = a.data.plans.find((p) => p.code === 'PRO');
  assert.equal(pro.available, true);
  assert.deepEqual(a.data.plans.filter((p) => p.code === 'PRO').length, 1);
});