/**
 * Contrato entre a Central e o Shandon Elite.
 *
 * O Elite roda em outro repositório, tem deploy travado por falta de secrets do
 * Cloudflare e NÃO pode ser republicado agora. O único endpoint da Central que
 * ele consome em runtime é POST /api/access/check, chamado server-side pelo
 * Worker dele com o cookie `sam_session` repassado. A resposta é traduzida por
 * `tierForPlan(plan, demo)` em amorim-osint/src/tree-access.js:
 *
 *   'PRO' | 'ADMIN'  -> full
 *   'FREE'           -> free
 *   qualquer outro   -> demo
 *
 * Ou seja: se a Central parar de responder 'ADMIN' para conta administrativa, o
 * dono do Elite perde acesso no próprio produto sem nenhum erro visível — só
 * a árvore volta truncada. Este arquivo existe para essa troca de contrato
 * quebrar aqui primeiro, e não em produção.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/backend/app.js';
import { createLocalDb } from '../scripts/local-db.js';

const ORIGIN = 'https://senhoramorim.com.br';
const ADMIN_EMAIL = 'elite@central.com';

/* Cópia fiel de tierForPlan em amorim-osint/src/tree-access.js. Se mudar lá,
   tem que mudar aqui — é de propósito, para o contrato ser explícito. */
const TIER_FULL = 'full';
const TIER_FREE = 'free';
const TIER_DEMO = 'demo';
function tierForPlan(planCode, demo) {
  if (planCode === 'PRO' || planCode === 'ADMIN') return TIER_FULL;
  if (planCode === 'FREE' && !demo) return TIER_FREE;
  return TIER_DEMO;
}

let app;
const jars = new Map();

function makeJar(name) {
  const jar = new Map();
  jar.absorb = (res) => {
    for (const line of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
  jars.set(name, jar);
  return jar;
}

const header = (jar) => Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ');

/* Reproduz exatamente a chamada que o Worker do Elite faz. */
async function eliteAccessCheck(jar, { project = 'amorim-osint', limit = 'tools', current } = {}) {
  const res = jar.absorb(await app.fetch(new Request(ORIGIN + '/api/access/check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(jar.size ? { cookie: header(jar) } : {}),
    },
    body: JSON.stringify({ project, limit, ...(current != null ? { current } : {}) }),
  })));
  return { status: res.status, data: await res.json() };
}

async function signup(jar, email, name) {
  const res = jar.absorb(await app.fetch(new Request(ORIGIN + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'SenhaForte123' }),
  })));
  assert.equal(res.status, 201, `cadastro de ${email} falhou`);
  return res.json();
}

let admin;
let adminSession;

before(async () => {
  app = createApp({
    db: createLocalDb(':memory:'),
    env: { PUBLIC_ORIGIN: ORIGIN, ADMIN_EMAILS: ADMIN_EMAIL, RATE_LIMIT_MAX: '9999' },
  });
  /* A conta de ADMIN_EMAILS é criada já no before: é ela que o resto da suite
     usa para promover gente, igual ao dono no painel. */
  admin = await signup(adminSession = makeJar('admin'), ADMIN_EMAIL, 'Dono');
  assert.equal(admin.user.role, 'admin');
});

test('Elite: visitante cai no tier demo, e o Worker degrada sozinho', async () => {
  const res = await eliteAccessCheck(makeJar('anon'));
  assert.equal(res.status, 200, 'o Elite faz fail-closed se der != 200, então precisa ser 200');
  assert.equal(res.data.plan, 'VISITOR');
  assert.equal(tierForPlan(res.data.plan, res.data.demo), TIER_DEMO);
});

test('Elite: conta FREE recebe tier free, e não demo', async () => {
  const jar = makeJar('free');
  await signup(jar, 'comum@central.com', 'Comum');
  const res = await eliteAccessCheck(jar);
  assert.equal(res.data.plan, 'FREE');
  assert.equal(res.data.demo, false, 'com sessão não é demo, senão o Elite esconde a árvore à toa');
  assert.equal(tierForPlan(res.data.plan, res.data.demo), TIER_FREE);
});

test('Elite: conta PRO recebe tier full', async () => {
  const jar = makeJar('pro');
  const reg = await signup(jar, 'pago@central.com', 'Pago');

  const promote = await app.fetch(new Request(ORIGIN + `/api/admin/users/${reg.user.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: header(adminSession) },
    body: JSON.stringify({ plan: 'pro' }),
  }));
  assert.equal(promote.status, 200, 'sem isto o resto do teste passa por acidente, com o plano errado');

  const res = await eliteAccessCheck(jar);
  assert.equal(res.data.plan, 'PRO');
  assert.equal(res.data.commercialPlan, 'PRO');
  assert.equal(tierForPlan(res.data.plan, res.data.demo), TIER_FULL);
});

test('Elite: conta admin recebe tier full pelo campo plan (compatibilidade)', async () => {
  const res = await eliteAccessCheck(adminSession);

  /* O ponto deste teste. O Elite compara a string 'ADMIN'. Se a Central passar
     a devolver 'FREE' aqui (porque admin não tem plano pago), o dono perde a
     árvore completa sem erro nenhum. */
  assert.equal(res.data.plan, 'ADMIN', 'o Elite depende literalmente desta string');
  assert.equal(tierForPlan(res.data.plan, res.data.demo), TIER_FULL);

  assert.equal(res.data.role, 'admin', 'a autorização continua vindo da role');
  assert.equal(res.data.isAdmin, true);
  assert.equal(res.data.commercialPlan, 'FREE', 'e o plano comercial segue separado e honesto');
});

test('Elite: limite numérico é comparado, não liberado em qualquer plano', async () => {
  const free = makeJar('free2');
  await signup(free, 'comum2@central.com', 'Comum2');

  const base = await eliteAccessCheck(free);
  assert.equal(base.data.plan, 'FREE');
  const limite = base.data.limit;
  assert.equal(typeof limite, 'number', 'o plano FREE precisa declarar um teto numérico');

  const dentro = await eliteAccessCheck(free, { current: limite });
  assert.equal(dentro.data.allowed, true, `${limite} ferramentas cabem no plano gratuito`);

  const fora = await eliteAccessCheck(free, { current: limite + 1 });
  assert.equal(fora.data.allowed, false, 'o bug antigo devolvia true para qualquer número');
  assert.equal(fora.data.current, limite + 1);
  assert.equal(fora.data.limit, limite);
});

test('Elite: a resposta continua com os campos que o Worker consome', async () => {
  const res = await eliteAccessCheck(makeJar('anon'));
  for (const field of ['ok', 'plan', 'demo', 'tier', 'project']) {
    if (field === 'tier') continue; // tier é calculado pelo Elite, não vem pronto
    assert.ok(field in res.data, `o Worker do Elite quebra sem "${field}"`);
  }
  assert.equal(res.data.project, 'amorim-osint');
  assert.equal(typeof res.data.ok, 'boolean');
});

test('Elite: a Central aceita a chamada server-side sem CORS nem header especial', async () => {
  /* O Worker chama sem Origin: um CORS estrito demais aqui derrubaria o Elite
     inteiro, porque o navegador nem participa. */
  const res = await app.fetch(new Request(ORIGIN + '/api/access/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: 'amorim-osint', limit: 'tools' }),
  }));
  assert.equal(res.status, 200, 'sem Origin tem que responder normal');
});

