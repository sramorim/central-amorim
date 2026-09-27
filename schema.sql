-- CENTRAL AMORIM — D1 schema
-- Apply with the official migrations flow:
--   wrangler d1 migrations apply central-amorim-db
-- (migrations/ mirrors these statements; the Worker also applies the same DDL
--  idempotently on first request — src/backend/app.js SCHEMA_SQL.)
--
-- ESTE ARQUIVO É O ESTADO FINAL. Para evoluir um banco que já existe, crie
-- uma migration nova em migrations/ — nunca edite este arquivo. Um banco já
-- aplicado não é reaplicado, então editar aqui não muda nada em produção.
--
-- users.role e a fonte da verdade do acesso administrativo. users.status
-- permite suspender a conta sem apagar nada. Nenhum dos dois substitui o
-- plano comercial de entitlements.plan: role dá painel, plano dá ferramentas.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL,
  expires_at INTEGER,
  provider TEXT NOT NULL DEFAULT 'central'
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Consumo global de chamadas pagas (Apify). Fica no D1, e não na memória do
-- isolate: um restart ou outro datacenter zeraria a contagem e o limite diário
-- nunca seria respeitado de verdade.
CREATE TABLE IF NOT EXISTS paid_quota (
  day TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
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

-- Catálogo de ferramentas. Publicação, plano mínimo e bloqueio vivem aqui, e
-- não no código: o dono muda pelo painel e vale no request seguinte.
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'project',
  min_plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'published',
  position INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at INTEGER NOT NULL
);

-- Trilha de quem mudou o quê. append-only.
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_tools_project ON tools(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit(created_at);

-- Bootstrap de admin: NÃO use o plano para isso.
--   UPDATE users SET role = 'admin' WHERE email = 'seu-email@exemplo.com';
-- O plano 'admin' foi o que mantinha contas antigas como administradoras
-- depois que saíram de ADMIN_EMAILS — por isso existe users.role, e por isso o
-- runtime converte entitlements.plan = 'admin' de quem não tem a role.
