/**
 * Portão da PÁGINA /admin — a parte que a auditoria de API não cobre.
 *
 * As APIs já são verificadas em auditoria-superficie.test.mjs. Aqui o alvo é
 * outro: o HTML do painel sai do bucket de assets, sem passar por handler
 * nenhum. Um `display:none` ou uma checagem no JS do painel não valem nada,
 * então o Worker precisa decidir antes de entregar o arquivo.
 *
 * O Worker é exercitado como módulo real (import de src/worker.js), não
 * através de createApp, porque é no entrypoint que a página é servida.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker.js';
import { createLocalDb } from '../scripts/local-db.js';

const ORIGIN = 'https://senhoramorim.com.br';
const ADMIN_EMAIL = 'portao@central.com';
const ADMIN_PAGES = ['/admin', '/admin/', '/admin.html'];

let db;
let env;
let adminCookie = '';
let comumCookie = '';

/* Finge ser o bucket: conta que foi baixado de verdade e devolve o arquivo. */
function fakeAssets() {
  return {
    async fetch(request) {
      const p = new URL(request.url).pathname;
      if (p === '/admin' || p === '/admin/' || p === '/admin.html') {
        return new Response('<!doctype html><title>PAINEL ADMIN REAL</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('nao encontrado', { status: 404 });
    },
  };
}

const asWorker = { DB: null, ASSETS: fakeAssets(), PUBLIC_ORIGIN: ORIGIN, ADMIN_EMAILS: ADMIN_EMAIL, RATE_LIMIT_MAX: '9999', COOKIE_SECURE: 'false' };

function hit(path, cookie) {
  return worker.fetch(
    new Request(ORIGIN + path, {
      headers: { accept: 'text/html', ...(cookie ? { cookie } : {}) },
      redirect: 'manual',
    }),
    env,
  );
}

before(async () => {
  db = createLocalDb(':memory:');
  env = { ...asWorker, DB: db };

  const mk = async (email, name) => {
    const res = await worker.fetch(
      new Request(ORIGIN + '/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password: 'SenhaForte123' }),
      }),
      env,
    );
    const cookies = res.headers.getSetCookie();
    return cookies.length ? cookies[0].split(';')[0] : '';
  };
  adminCookie = await mk(ADMIN_EMAIL, 'Administrador Central');
  comumCookie = await mk('comum@central.com', 'Pessoa Comum');
  assert.ok(adminCookie, 'cadastro do admin não devolveu cookie');
  assert.ok(comumCookie, 'cadastro da conta comum não devolveu cookie');
});

/* --------- A) visitante sem login --------- */

for (const page of ADMIN_PAGES) {
  test(`A) sem sessão, ${page} não entrega o painel`, async () => {
    const res = await hit(page, '');
    assert.equal(res.status, 302, 'sem sessão o certo é mandar para o login');
    const to = res.headers.get('location');
    assert.match(to, /\/entrar/, ` redirecionou para ${to}`);
    assert.match(to, /next=/, 'o login precisa saber para onde voltar');
    assert.equal(res.headers.get('content-type'), null, 'o HTML do painel não pode vazar no 302');
  });
}

/* --------- B) usuário normal --------- */

for (const page of ADMIN_PAGES) {
  test(`B) conta comum, ${page} recebe 403 e nada do painel`, async () => {
    const res = await hit(page, comumCookie);
    assert.equal(res.status, 403);
    const body = await res.text();
    assert.ok(!body.includes('PAINEL ADMIN REAL'), 'o HTML do painel foi entregue para não-admin');
    assert.ok(!body.includes('admin/users'), 'a página vazou rota de API');
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store', '403 de admin não pode ficar em cache');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  });
}

/* --------- C) administrador --------- */

for (const page of ADMIN_PAGES) {
  test(`C) admin, ${page} carrega o painel normalmente`, async () => {
    const res = await hit(page, adminCookie);
    assert.equal(res.status, 200, `admin foi bloqueado: ${res.status}`);
    assert.ok((await res.text()).includes('PAINEL ADMIN REAL'), 'admin não recebeu o painel');
  });
}

/* --------- D) o portão não vaza nada sobre a conta --------- */

test('D) o 403 é idêntico para conta comum e para usuário inexistente', async () => {
  const comum = await hit('/admin', comumCookie);
  /* Cookie forjado: assinatura inválida => tratado como visitante. */
  const forjado = await hit('/admin', 'sam_session=cookie-forjado-invalido');
  assert.equal(forjado.status, 302, 'cookie inválido não pode ser tratado como sessão');
  assert.equal(comum.status, 403);
});

test('D) suspended admin perde o painel mesmo com sessão válida', async () => {
  const { randomUUID } = await import('node:crypto');
  const id = randomUUID();
  const now = Date.now();
  db._exec(`INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
            VALUES ('${id}', 'Admin Suspenso', 'suspenso@central.com', 'x', 'admin', 'suspended', ${now}, ${now})`);
  db._exec(`INSERT INTO sessions (token, user_id, created_at, expires_at)
            VALUES ('token-suspenso', '${id}', ${now}, ${now + 86400000})`);
  const res = await hit('/admin', 'sam_session=token-suspenso');
  assert.notEqual(res.status, 200, 'conta suspensa não pode carregar o painel');
});

/* --------- E) o portão não quebrou o resto do site --------- */

test('E) páginas públicas seguem abertas', async () => {
  for (const page of ['/', '/entrar', '/minha-conta', '/ferramentas', '/planos']) {
    const res = await hit(page, comumCookie);
    assert.notEqual(res.status, 302, `${page} foi manda para o login sem motivo`);
    assert.notEqual(res.status, 403, `${page} foi bloqueada como se fosse admin`);
  }
});

test('E) a lista de páginas do painel é exata: /administrator não é painel', async () => {
  const res = await hit('/administrator', comumCookie);
  assert.equal(res.status, 404, 'apenas /admin, /admin/ e /admin.html são o painel');
});

/* --------- F) a configuração que faz o portão existir --------- */

test('F) wrangler.toml manda /admin pelo Worker antes do bucket', async () => {
  /* Este teste existe porque o portão estava testado e mesmo assim não
     rodava em produção. Motivo: sem `run_worker_first`, o Cloudflare serve o
     arquivo estático direto do bucket e o Worker não é invocado — o painel
     saía para qualquer um. O teste com ASSETS falso não podia enxergar isso,
     porque ele sempre chamava o Worker. Aqui a gente trava a CONFIGURAÇÃO,
     que é a parte que realmente quebrou. */
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const bloco = toml.split('[assets]')[1] || '';
  const linha = bloco.split('\n').find((l) => l.trim().startsWith('run_worker_first'));
  assert.ok(linha, 'wrangler.toml não tem run_worker_first: o portão de /admin não roda');

  const valor = linha.slice(linha.indexOf('=') + 1).trim();
  const cobertura = valor.startsWith('[')
    ? [...valor.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    : [valor];
  for (const pagina of ['/admin', '/admin.html', '/admin/']) {
    const pegada = cobertura.some((p) => p === pagina || (p.endsWith('/*') && pagina.startsWith(p.slice(0, -1))));
    assert.ok(pegada, `run_worker_first não cobre ${pagina} (tem ${cobertura.join(', ')})`);
  }
});
