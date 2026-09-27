-- 0002_roles_tools.sql — role, status, catálogo de ferramentas, pedidos e cota
-- Idempotente. Apply com:  wrangler d1 migrations apply central-amorim-db
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE AS DUAS COLUNAS NÃO ESTÃO NESTE ARQUIVO
--
-- users.role e users.status são adicionadas pelo Worker, em
-- src/backend/app.js (addColumnIfMissing), e NÃO aqui. O motivo é concreto:
-- o SQLite não tem `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (verificado),
-- então escrever o ALTER aqui quebraria no banco onde a coluna já existe — e
-- ela sempre vai existir em produção, porque o próprio Worker a cria no
-- primeiro request depois do deploy. Uma migration que dá erro no meio
-- derruba o `migrations apply` e trava a sequência.
--
-- O Worker faz isso de forma idempotente e na ordem certa: PRAGMA table_info
-- para ver se falta, ALTER se faltar, e só DEPOIS o CREATE INDEX que depende
-- da coluna. Cubro o banco no formato antigo em
-- tests/migration-d1-antigo.test.mjs, porque a ordem errada aqui derrubaria
-- o site inteiro com 500 no primeiro request.
--
-- Consequência prática: se você rodar `migrations apply` num banco virgem,
-- as colunas só nascem quando o site receber o primeiro request (ou rode
-- `npx wrangler d1 execute` chamando o endpoint /api/tools). Para um banco
-- já em produção, nada é preciso: o deploy aplica sozinho.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O que ESTE arquivo traz é só o que o SQLite sabe fazer sem ajuda: criar
-- tabela e índice com IF NOT EXISTS. Nenhuma tabela é alterada, nenhuma linha
-- é apagada.

-- Cota global de chamadas pagas (Apify). Substitui o contador que vivia na
-- memória do isolate, onde restart ou troca de datacenter zerava o dia.
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

-- Catálogo de ferramentas: publicação, plano mínimo e bloqueio. Vive no banco
-- (e não no código) para o dono mudar pelo painel e valer no request seguinte.
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

-- Trilha append-only de quem mudou o quê.
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_tools_project ON tools(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- LIMPEZA DO PLANO LEGADO 'admin' (feito pelo Worker, não aqui)
--
-- O bug original: entitlements.plan = 'admin' mantinha uma conta como
-- administradora mesmo depois de ela sair de ADMIN_EMAILS, porque o plano era
-- usado como se fosse role. A correção converte plan='admin' → 'pro' para
-- quem não tem users.role = 'admin', e a role vira a fonte da verdade.
--
-- Isso é UPDATE, não DELETE, e por isso também fica no runtime: precisa
-- considerar a role atual linha a linha. Nenhuma conta é apagada.
-- ─────────────────────────────────────────────────────────────────────────────
