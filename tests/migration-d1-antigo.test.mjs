/**
 * A migração que roda sozinha no primeiro request é o ponto mais perigoso do
 * deploy: se ela errar, o site inteiro cai com 500 — e o banco real não pode
 * ser restaurado, porque o teste local usa memória.
 *
 * Este arquivo monta o D1 no formato ANTERIOR (users sem `role`, sem `status`,
 * sem `tools`, sem `admin_audit`) e exige que a aplicação suba em cima dele.
 * Foi assim que apareceu o bug real: `CREATE INDEX idx_users_role ON users(role)`
 * rodava antes do `ALTER TABLE`, então o índice falhava e TODAS as rotas
 * respondiam 500 no primeiro request depois do deploy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/backend/app.js';

const ORIGIN = 'https://senhoramorim.com.br';

/* O D1 real é criado antes de qualquer código rodar, no formato antigo. Aqui
  criamos um arquivo SQLite nesse formato e só depois embrulhamos no shim — que é
   o que o teste usa para falar com o banco. */
function oldSchemaDb() {
  const dir = mkdtempSync(join(tmpdir(), 'central-d1-'));
  const file = join(dir, 'antigo.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE entitlements (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      started_at INTEGER NOT NULL,
      expires_at INTEGER,
      provider TEXT NOT NULL DEFAULT 'central'
    );
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      cpf TEXT,
      plan TEXT NOT NULL DEFAULT 'pro',
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      paid_at INTEGER,
      activated_at INTEGER
    );
    INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
      VALUES ('u-antigo', 'Conta Antiga', 'antiga@central.com', 'x', 1, 1);
    INSERT INTO entitlements (user_id, plan, status, started_at, provider)
      VALUES ('u-antigo', 'admin', 'active', 1, 'central');
  `);
  db.close();
  return wrapOld(file);
}

/* Mesma interface do D1 (prepare().bind()), sobre o arquivo antigo. */
function wrapOld(file) {
  const conn = new DatabaseSync(file);
  const runP = (sql, params) => {
    const info = conn.prepare(sql).run(...params);
    return { success: true, meta: { changes: Number(info.changes || 0), last_row_id: Number(info.lastInsertRowid || 0) } };
  };
  const allP = (sql, params) => conn.prepare(sql).all(...params).map((r) => Object.fromEntries(Object.entries(r)));
  return {
    prepare: (sql) => {
      const r = (...p) => ({
        run: () => runP(sql, p),
        all: () => allP(sql, p),
        first: () => allP(sql, p)[0] || null,
      });
      return { run: (...p) => runP(sql, p), all: (...p) => allP(sql, p), first: (...p) => allP(sql, p)[0] || null, bind: r };
    },
    exec: (sql) => conn.exec(sql),
    _raw: conn,
    _exec: (sql) => conn.exec(sql),
  };
}

function oldApp(overrides = {}) {
  return createApp({
    db: oldSchemaDb(),
    env: {
      PUBLIC_ORIGIN: ORIGIN,
      ADMIN_EMAILS: 'dono@central.com',
      RATE_LIMIT_MAX: '9999',
      ...overrides,
    },
  });
}

const get = (app, path, init) => app.fetch(new Request(ORIGIN + path, init));

test('D1 antigo: o catálogo responde, sem 500', async () => {
  const res = await get(oldApp(), '/api/tools');
  assert.equal(res.status, 200, 'o primeiro request depois do deploy é o que paga a migration');
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.tools) && data.tools.length > 0);
});

test('D1 antigo: as colunas novas entram sem perder a conta que já existia', async () => {
  const db = oldSchemaDb();
  const app = createApp({ db, env: { PUBLIC_ORIGIN: ORIGIN, ADMIN_EMAILS: 'dono@central.com', RATE_LIMIT_MAX: '9999' } });
  await get(app, '/api/tools');

  const cols = db._raw.prepare('PRAGMA table_info(users)').all().map((r) => r.name);
  assert.ok(cols.includes('role'), 'users.role tem de existir depois da migration');
  assert.ok(cols.includes('status'), 'users.status tem de existir depois da migration');

  const user = db._raw.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get('u-antigo');
  assert.equal(user.name, 'Conta Antiga', 'a conta antiga continua com o mesmo nome');
  assert.equal(user.email, 'antiga@central.com');
  assert.equal(user.role, 'user', 'conta que existia antes entra como user, não como admin');
  assert.equal(user.status, 'active');
});

test('D1 antigo: as tabelas novas são criadas', async () => {
  const db = oldSchemaDb();
  const app = createApp({ db, env: { PUBLIC_ORIGIN: ORIGIN, RATE_LIMIT_MAX: '9999' } });
  await get(app, '/api/tools');

  const tables = db._raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['tools', 'admin_audit', 'paid_quota', 'password_resets', 'rate_limits']) {
    assert.ok(tables.includes(t), `falta a tabela ${t}`);
  }
  const idx = db._raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_role'").all();
  assert.equal(idx.length, 1, 'o índice da role tem de ser criado, mas só depois da coluna existir');
});

test('D1 antigo: o plano legado "admin" da conta antiga vira pro, sem apagar nada', async () => {
  const db = oldSchemaDb();
  const app = createApp({ db, env: { PUBLIC_ORIGIN: ORIGIN, ADMIN_EMAILS: 'dono@central.com', RATE_LIMIT_MAX: '9999' } });
  await get(app, '/api/tools');

  const ent = db._raw.prepare('SELECT plan FROM entitlements WHERE user_id = ?').get('u-antigo');
  assert.equal(ent.plan, 'pro', 'plan=admin era o que mantinha a conta antiga como administradora');
  const still = db._raw.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get('u-antigo');
  assert.equal(still.n, 1, 'normalizar o plano não pode apagar a conta');
});

test('D1 antigo: rodar a migration duas vezes não muda nada (idempotente)', async () => {
  const db = oldSchemaDb();
  const app = createApp({ db, env: { PUBLIC_ORIGIN: ORIGIN, RATE_LIMIT_MAX: '9999' } });

  const first = await get(app, '/api/tools');
  assert.equal(first.status, 200);
  const planAfterFirst = db._raw.prepare('SELECT plan FROM entitlements WHERE user_id = ?').get('u-antigo').plan;

  // Novo isolate = nova chamada de ensureSchema sobre o MESMO banco.
  const app2 = createApp({ db, env: { PUBLIC_ORIGIN: ORIGIN, RATE_LIMIT_MAX: '9999' } });
  const second = await get(app2, '/api/tools');
  assert.equal(second.status, 200, 'o segundo isolate não pode reprocessar e quebrar');
  assert.equal(db._raw.prepare('SELECT plan FROM entitlements WHERE user_id = ?').get('u-antigo').plan, planAfterFirst);
});

test('D1 antigo: conta do ADMIN_EMAILS ganha role de admin na hora do acesso', async () => {
  const db = oldSchemaDb();
  const app = createApp({ db, env: { PUBLIC_ORIGIN: ORIGIN, ADMIN_EMAILS: 'dono@central.com', RATE_LIMIT_MAX: '9999' } });
  const reg = await app.fetch(new Request(ORIGIN + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Dono', email: 'dono@central.com', password: 'SenhaForte123' }),
  }));
  assert.equal(reg.status, 201);
  const data = await reg.json();
  assert.equal(data.user.role, 'admin');
  assert.equal(data.user.isAdmin, true);
  assert.equal(data.user.plan, 'FREE', 'admin não compra plano; o acesso vem da role');
});
