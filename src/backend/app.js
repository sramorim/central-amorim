/**
 * CENTRAL AMORIM — Auth & Access Backend
 *
 * Runtime-agnostic Workers handler. Runs identically on Cloudflare (D1 via env.DB)
 * and in tests (node:sqlite shim), so the production code path is the tested path.
 *
 * No credentials/secrets live here — everything that can differ by environment is
 * read from `env` and documented in .env.example.
 */

const JSON_MAX = 1_000_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'SHA-256';
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

import { installShandonOsint } from './shandon-osint.js';
import { installSearchOsint } from './search-osint.js';
import {
  AUDIT_TABLE_SQL,
  TOOLS_TABLE_SQL,
  getTool,
  hasToolAccess,
  listAudit,
  listTools,
  recordAudit,
  seedTools,
  updateTool,
} from './tools.js';

/* ------------------------------------------------------------------ */
/* Plans / Entitlements model                                          */
/* ------------------------------------------------------------------ */

export const PLANS = {
  free: {
    code: 'FREE',
    label: 'Plano gratuito',
    descriptor:
      'Conta gratuita com acesso de entrada ao AMORIM OSINT: categorias selecionadas para experimentar a árvore de ferramentas.',
    order: 1,
    billing: { currency: 'BRL', monthly: 0, annual: 0 },
    features: [
      'Conta gratuita — sem cartão',
      'AMORIM OSINT: 5 categorias de entrada',
      '156 ferramentas selecionadas para teste',
      'Exportação de dados: não disponível',
      'Demais categorias desbloqueáveis no PRO',
    ],
    limits: {
      'amorim-osint': {
        categories: 5,
        tools: 156,
        export: false,
        demo: false,
        freeCategories: ['Username', 'Search Engines', 'AI Tools', 'Encoding / Decoding', 'Archives'],
      },
    },
  },
  pro: {
    code: 'PRO',
    label: 'Plano PRO',
    descriptor:
      'Acesso completo ao AMORIM OSINT: toda a árvore de ferramentas, exportação liberada e novos recursos em primeiro lugar. Pagamento único, acesso vitalício à versão atual.',
    order: 2,
    billing: {
      currency: 'BRL',
      unique: 9.99,
      uniqueNote: 'pagamento único · acesso vitalício à versão atual',
      monthly: 9.9,
    },
    features: [
      'Árvore AMORIM OSINT completa: 33 categorias',
      '1.168 ferramentas de investigação',
      'Exportação de dados liberada',
      'Pagamento único de R$ 9,99 — sem mensalidade',
      'Upgrades futuros (v2, Shandon Elite) com desconto',
    ],
    limits: {
      'amorim-osint': { categories: 33, tools: 1168, export: true, demo: false, premium: true },
    },
  },
  admin: {
    code: 'ADMIN',
    label: 'Acesso administrativo',
    descriptor: 'Acesso administrativo da plataforma.',
    order: 3,
    billing: null,
    features: ['Acesso administrativo', 'Gestão da plataforma', 'Uso interno'],
    limits: {
      'amorim-osint': { categories: 33, tools: 1168, export: true, demo: false, full: true },
    },
  },
};

export const GUEST_LIMITS = {
  'amorim-osint': { categories: 5, tools: 12, export: false, demo: true },
};

function resolvePlan(ent) {
  if (!ent || ent.status !== 'active') return null;
  return PLANS[ent.plan] || null;
}

function publicMe(user, ent) {
  const plan = resolvePlan(ent);
  const role = String((user && user.role) || 'user');
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar || null,
    createdAt: user.created_at,
    role,
    isAdmin: role === 'admin',
    accountStatus: (user && user.status) || 'active',
    plan: plan ? plan.code : 'FREE',
    planLabel: plan ? plan.label : 'Plano gratuito',
    status: ent ? ent.status : 'active',
    entitlement: ent
      ? { plan: ent.plan, status: ent.status, startedAt: ent.started_at, expiresAt: ent.expires_at, provider: ent.provider }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Crypto primitives                                                   */
/* ------------------------------------------------------------------ */

function randomHex(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltHex) {
  const salt = hexToBytes(padHex(saltHex));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: PBKDF2_DIGEST, salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    PBKDF2_KEYLEN * 8
  );
  return bytesToHex(new Uint8Array(bits));
}

function hexToBytes(hex) {
  const clean = padHex(String(hex));
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function padHex(hex) {
  const s = String(hex);
  return s.length % 2 === 0 ? s : `0${s}`;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function createPasswordHash(password) {
  const salt = randomHex(SALT_BYTES);
  const hash = await hashPassword(password, salt);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const [_, iterations, saltHex, hashHex] = parts;
  const computed = await hashPassword(password, saltHex);
  const a = new TextEncoder().encode(computed);
  const b = new TextEncoder().encode(hashHex);
  // Constant-time comparison (no early exit, loop over the longest) — portable (Node + Workers).
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* Schema + helpers                                                    */
/* ------------------------------------------------------------------ */

export const SCHEMA_SQL = `
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
/* Cota global de chamadas pagas (Apify). O contador antigo vivia na memoria
   do isolate, entao um restart ou um outro datacenter do Cloudflare ja zerava
   a contagem e o limite diario nunca era respeitado de verdade. Aqui o consumo
   fica no D1, compartilhado por todos os isolates, e o proprio banco impede
   que passe do teto. */
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
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE TABLE IF NOT EXISTS link_clicks (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'project',
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_day ON link_clicks(day);
CREATE INDEX IF NOT EXISTS idx_clicks_target ON link_clicks(target);
${TOOLS_TABLE_SQL}
${AUDIT_TABLE_SQL}
`;

/* Colunas adicionadas depois do primeiro deploy. `CREATE TABLE IF NOT EXISTS`
   não cria coluna em tabela que já existe, então o D1 de produção precisa destes
   ALTER TABLE. São ADITIVOS e idempotentes: quem já tem linha ganha o default,
   ninguém perde dado. (Em banco novo o SCHEMA_SQL já traz as colunas.) */
const ADDED_COLUMNS = [
  { table: 'users', column: 'role', ddl: "role TEXT NOT NULL DEFAULT 'user'" },
  { table: 'users', column: 'status', ddl: "status TEXT NOT NULL DEFAULT 'active'" },
];

async function addColumnIfMissing(db, table, column, ddl) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all();
  const names = toRows(info).map((r) => r.name);
  if (!names.length) return false; // tabela ainda não existe: o CREATE TABLE já traz a coluna
  if (names.includes(column)) return false;
  await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  console.log(`[central] migration: ${table}.${column} adicionada`);
  return true;
}

/* `ensured` como boolean global assume UM banco por processo. No Worker isso é
   verdade, mas a suite de testes monta vários bancos no mesmo processo e o
   segundo apprecebia um D1 sem tabela `tools` (404 em toda rota guardada).
   WeakSet amarra o estado ao próprio objeto de banco: mesmo isolate, um cache
   só; bancos diferentes, cada um com o seu. */
const ensuredDbs = new WeakSet();

async function ensureSchema(db) {
  if (ensuredDbs.has(db)) return;
  /* Colunas primeiro, e ANTES dos CREATE INDEX que as usam. O D1 de produção
     já tem `users` sem `role`; se o índice viesse antes do ALTER, o
     `CREATE INDEX ... ON users(role)` estouraria e TODAS as rotas cairiam em
     500 no primeiro request depois do deploy. Provado com um banco no formato
     antigo em tests/migration-d1-antigo.test.mjs. */
  for (const c of ADDED_COLUMNS) {
    await addColumnIfMissing(db, c.table, c.column, c.ddl);
  }
  // D1 runtime rejects multi-statement db.exec() ("incomplete input"), so run
  // each statement through prepare().all(). Works on D1 and the node:sqlite shim.
  const stmts = SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    await db.prepare(stmt).all();
  }
  // Catálogo de ferramentas: semeia só o que falta, nunca sobrescreve ajustes.
  await seedTools(db);
  ensuredDbs.add(db);
}

/* ------------------------------------------------------------------ */
/* Request helpers                                                     */
/* ------------------------------------------------------------------ */

/* Headers de segurança aplicados a toda resposta JSON e HTML.
   O site nao usa CDN de terceiros nem script inline com dados do usuario, entao
   uma CSP restritiva nao quebra nada e fecha XSS e clickjacking. */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; connect-src 'self' https://senhoramorim.com.br https://api.apify.com; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
};

function json(data, status = 200, headers = {}) {
  if (typeof data === 'object' && data !== null) {
    // Keep every error response consistent (ok:false) unless a caller sets ok explicitly.
    if ('error' in data && !('ok' in data)) data.ok = false;
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers },
  });
}

function html(data, status = 200, headers = {}) {
  return new Response(data, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  });
}

async function readBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  try {
    const text = await request.text();
    if (text.length > JSON_MAX) return { __tooLarge: true };
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

/* O atributo Domain só pode ser enviado quando o host da requisição realmente
   pertence ao domínio configurado. Caso contrário o navegador descarta o
   cookie e o login "funciona" mas a sessão nunca persiste (ex.: app servido em
   workers.dev com COOKIE_DOMAIN apontando para o domínio próprio). */
function cookieDomainFor(request, env) {
  const configured = String(env.COOKIE_DOMAIN || '').trim();
  if (!configured) return '';
  const bare = configured.replace(/^\./, '').toLowerCase();
  if (!bare) return '';
  let host = '';
  try {
    host = new URL(request.url).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (host === bare || host.endsWith(`.${bare}`)) return configured;
  return '';
}

function makeSessionCookie(token, env, now = Date.now(), request = null) {
  const parts = [
    `sam_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (env.COOKIE_SECURE !== 'false') parts.push('Secure');
  const domain = request ? cookieDomainFor(request, env) : String(env.COOKIE_DOMAIN || '').trim();
  if (domain) parts.push(`Domain=${domain}`);
  parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  parts.push(`Expires=${new Date(now + SESSION_TTL_MS).toUTCString()}`);
  return parts.join('; ');
}

function clearSessionCookie(env, request = null) {
  const parts = ['sam_session=; Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (env.COOKIE_SECURE !== 'false') parts.push('Secure');
  const domain = request ? cookieDomainFor(request, env) : String(env.COOKIE_DOMAIN || '').trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join('; ');
}

function clientIp(request, env) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    env.PUBLIC_ORIGIN ||
    'local'
  );
}

function isMutating(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

/* Origins aceitos para CORS/CSRF: PUBLIC_ORIGIN, SHANDON_ORIGIN e a lista
   extra ALLOWED_ORIGINS (vírgula). O próprio host da requisição é sempre
   aceito — sem isso, o app em `workers.dev` (ou em qualquer outro host)
   recebia 403 em todo POST de login/cadastro. */
function allowedOrigins(env) {
  const extra = String(env.ALLOWED_ORIGINS || '').split(',');
  return new Set([env.PUBLIC_ORIGIN, env.SHANDON_ORIGIN, ...extra].map(normalizeOrigin).filter(Boolean));
}

function isSameOrigin(request, origin) {
  try {
    return normalizeOrigin(origin) === normalizeOrigin(new URL(request.url).origin);
  } catch {
    return false;
  }
}

function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // same-site / non-browser
  if (origin === 'null') return env.ALLOW_NULL_ORIGIN === '1';
  if (isSameOrigin(request, origin)) return true;
  return allowedOrigins(env).has(normalizeOrigin(origin));
}

/* CORS para o app do SHANDON ELITE consumir as ferramentas hospedadas aqui.
   `allow-credentials` é obrigatório: a sessão mora num cookie HttpOnly com
   Domain=.senhoramorim.com.br e o navegador só o envia numa chamada com
   credenciais. Sem este header o app irmão nunca enxerga quem está logado.
   O Origin nunca é refletido cegamente — só origens da lista-configurada. */
function corsFor(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const allowed = allowedOrigins(env);
  if (origin === 'null') {
    if (env.ALLOW_NULL_ORIGIN !== '1') return {};
  } else if (!allowed.has(normalizeOrigin(origin)) && !isSameOrigin(request, origin)) {
    return {};
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization, x-api-key, x-requested-with',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

/* ------------------------------------------------------------------ */
/* Pix / orders helpers                                                */
/* ------------------------------------------------------------------ */

function pixField(id, value) {
  const v = String(value);
  const len = String(v.length).padStart(2, '0');
  return id + len + v;
}

function pixCrc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function pixPayloadFor(cfg) {
  const merchantAccount = pixField('00', 'br.gov.bcb.pix') + pixField('01', cfg.PIX_KEY);
  const amount = (Number(cfg.PIX_AMOUNT_BRL) || 9.99).toFixed(2);
  const name = String(cfg.PIX_NAME || 'SR. AMORIM').slice(0, 25);
  const city = String(cfg.PIX_CITY || 'BRASIL').slice(0, 15);
  const payload =
    pixField('00', '01') +
    pixField('26', merchantAccount) +
    pixField('52', '0000') +
    pixField('53', '986') +
    pixField('54', amount) +
    pixField('58', 'BR') +
    pixField('59', name) +
    pixField('60', city) +
    pixField('62', pixField('05', '***')) +
    '6304';
  return payload + pixCrc16(payload);
}

const ORDER_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeOrderCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = 'COD-';
  for (const b of bytes) code += ORDER_CODE_CHARS[b % ORDER_CODE_CHARS.length];
  return code;
}

function toRows(result) {
  if (Array.isArray(result)) return result;
  return (result && Array.isArray(result.results)) ? result.results : [];
}

/* ------------------------------------------------------------------ */
/* Session / access resolution                                        */
/* ------------------------------------------------------------------ */

async function getSession(db, token) {
  if (!token) return null;
  const row = await db.prepare('SELECT s.token, s.user_id, s.expires_at, u.id as uid, u.name, u.email, u.avatar, u.role, u.status, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').bind(token).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  return {
    token: row.token,
    userId: row.user_id,
    user: { id: row.uid, name: row.name, email: row.email, avatar: row.avatar, role: row.role || 'user', status: row.status || 'active', created_at: row.created_at },
  };
}

async function getEntitlement(db, userId) {
  return db.prepare('SELECT user_id, plan, status, started_at, expires_at, provider FROM entitlements WHERE user_id = ?').bind(userId).first();
}

async function hasProOrder(db, email) {
  if (!email) return null;
  return db.prepare("SELECT id FROM orders WHERE lower(email) = lower(?) AND status = 'activated' AND plan = 'pro' LIMIT 1").bind(email).first();
}

function adminEmailSet(env) {
  return new Set(String(env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/* A FONTE DA VERDADE de "isto é admin" é `users.role`.
 *
 * O plano comercial nunca concede e nunca revoga poder administrativo: foi
 * exatamente isso que criou o bug de duas contas admin — `entitlements.plan`
 * valia 'admin' como se fosse plano, e essa linha ficava gravada para sempre
 * mesmo depois de o e-mail sair da lista ADMIN_EMAILS.
 *
 * `ADMIN_EMAILS` continua valendo, mas só como CONCESSÃO de inicialização: se o
 * dono colocar um e-mail lá, a conta ganha role=admin no próximo acesso (assim
 * uma conta já criada não fica trancada fora do painel). Para REVOGAR, é o
 * painel — de propósito, senão trocar a lista de configuração reabria o acesso
 * de quem o dono tinha removido de propósito. */
function isAdminUser(user) {
  return String((user && user.role) || 'user') === 'admin';
}

/* Concessão por configuração. Só promove, nunca rebaixa (ver nota acima). */
async function ensureRoleFromConfig(db, user, cfg) {
  if (!user) return 'user';
  const email = String(user.email || '').trim().toLowerCase();
  const inList = email && adminEmailSet(cfg).has(email);
  if (inList && (user.role || 'user') !== 'admin') {
    await db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").bind(Date.now(), user.id).run();
    return 'admin';
  }
  return user.role || 'user';
}

/* Reconcilia os dados que já existem em produção, uma única vez, sem apagar
   nada:
     1. role=admin para quem está em ADMIN_EMAILS  (fonte de verdade = config)
     2. o plano 'admin' vira 'pro' para quem NÃO é admin por role
   O passo 2 é a correção da duplicidade: a conta antiga deixa de ter o plano
   'admin' (que era o que a mantinha administrativa) mas continua com acesso
   completo de ferramenta, como qualquer cliente pago. Nenhuma conta é removida.
   A role só é rebaixada se alguém usar o painel de propósito. */
const reconciledDbs = new WeakSet();
async function reconcileRoles(db, cfg) {
  if (reconciledDbs.has(db)) return;
  const now = Date.now();
  for (const email of adminEmailSet(cfg)) {
    await db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE lower(email) = ?").bind(now, email).run();
  }
  await db
    .prepare(
      "UPDATE entitlements SET plan = 'pro' WHERE plan = 'admin' AND user_id IN (SELECT id FROM users WHERE COALESCE(role, 'user') <> 'admin')"
    )
    .run();
  reconciledDbs.add(db);
}

/* Plano comercial canônico de quem está chamando. A role não entra aqui. */
function planCodeFor(ent, role) {
  if (role === 'admin') return 'pro';
  const resolved = resolvePlan(ent);
  return resolved ? resolved.code.toLowerCase() : null;
}

async function ensureEntitlement(db, userId, env) {
  let ent = await getEntitlement(db, userId);
  const user = await db.prepare('SELECT email, role FROM users WHERE id = ?').bind(userId).first();
  const proOrder = await hasProOrder(db, user ? user.email : null);
  const isAdmin = isAdminUser(user);
  if (!ent) {
    const now = Date.now();
    /* Admin NÃO ganha plano pago: admin não é cliente. O acesso total vem da
       role (ver planCodeFor/requireAuth), e o plano continua sendo o que a
       pessoa realmente comprou. Sem isto, comprar/sair da role mexeria no
       plano comercial e os dois conceitos voltariam a se misturar. */
    const plan = proOrder ? 'pro' : 'free';
    await db.prepare('INSERT OR IGNORE INTO entitlements (user_id, plan, status, started_at, provider) VALUES (?, ?, ?, ?, ?)').bind(userId, plan, 'active', now, proOrder ? 'pix' : 'central').run();
    ent = await getEntitlement(db, userId);
  } else if (ent.plan === 'admin' && !isAdmin) {
    // Bug antigo: plano 'admin' orfão. Baixa para 'pro' — a conta segue com
    // acesso de ferramenta, só perde (e nunca teve) poder administrativo.
    await db.prepare("UPDATE entitlements SET plan = 'pro' WHERE user_id = ?").bind(userId).run();
    ent = await getEntitlement(db, userId);
  } else if (proOrder && ent.plan === 'free' && !isAdmin) {
    const now = Date.now();
    await db.prepare("UPDATE entitlements SET plan = 'pro', status = 'active', started_at = ?, expires_at = NULL, provider = 'pix' WHERE user_id = ?").bind(now, userId).run();
    ent = await getEntitlement(db, userId);
  }
  return ent;
}

/* ------------------------------------------------------------------ */
/* Main app                                                            */
/* ------------------------------------------------------------------ */

export function createApp({ db, env = {} }) {
  const cfg = {
    PUBLIC_ORIGIN: env.PUBLIC_ORIGIN || '',
    COOKIE_SECURE: env.COOKIE_SECURE === undefined ? 'true' : env.COOKIE_SECURE,
    COOKIE_DOMAIN: env.COOKIE_DOMAIN || '',
    ADMIN_EMAILS: env.ADMIN_EMAILS || '',
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || '',
    RESEND_API_KEY: env.RESEND_API_KEY || '',
    MAIL_FROM: env.MAIL_FROM || '',
    APP_NAME: env.APP_NAME || 'Central Amorim',
    RATE_LIMIT_MAX: Number(env.RATE_LIMIT_MAX) || 6,
    PIX_KEY: env.PIX_KEY || '',
    PIX_NAME: env.PIX_NAME || 'SR. AMORIM',
    PIX_CITY: env.PIX_CITY || 'BRASIL',
    PIX_AMOUNT_BRL: env.PIX_AMOUNT_BRL || '9.99',
    WA_NUMBER: env.WA_NUMBER || '',
    SHANDON_ORIGIN: env.SHANDON_ORIGIN || 'https://elite.senhoramorim.com.br',
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS || '',
    ALLOW_NULL_ORIGIN: env.ALLOW_NULL_ORIGIN || '',
    /* --- Chaves/limites das ferramentas OSINT (SHANDON ELITE) --- */
    /* Secrets (RAPIDAPI_WHATSAPP_KEY, APIFY_API_TOKEN) chegam via env do Worker
       e são repassados aqui; NUNCA declarar como var no wrangler.toml. */
    RAPIDAPI_WHATSAPP_KEY: env.RAPIDAPI_WHATSAPP_KEY || '',
    RAPIDAPI_WHATSAPP_HOST: env.RAPIDAPI_WHATSAPP_HOST || '',
    APIFY_API_TOKEN: env.APIFY_API_TOKEN || '',
    APIFY_DAILY_LIMIT: Number(env.APIFY_DAILY_LIMIT) || 40,
    /* "off" desliga a consulta de WhatsApp (Apify/RapidAPI) sem apagar nada. */
    WHATSAPP_LOOKUP: String(env.WHATSAPP_LOOKUP || 'on').toLowerCase(),
  };
  const router = new Map();
  /* Rotas com parâmetro no caminho (PATCH /api/admin/.../:id). O Map exato não
     resolve isso, então ficam numa lista com regex avaliada só quando a busca
     exata falha. */
  const dynamicRoutes = [];
  const route = (method, pattern, handler) => {
    dynamicRoutes.push({ method, re: new RegExp(`^${pattern}$`), handler });
  };

  /* Schema + reconciliação de roles, sempre antes de tocar em dados. */
  async function ensureReady() {
    await ensureSchema(db);
    await reconcileRoles(db, cfg);
  }

  /* ------------------------------------------------------------------ */
  /* Auth resolvido uma vez por requisição (ctx.auth)                      */
  /* ------------------------------------------------------------------ */
  /* Antes cada rota repetia getSession/ensureEntitlement por conta própria e
     as 10 rotas de ferramentas simplesmente não checavam nada. Agora o
     dispatcher resolve UMA vez e coloca em ctx.auth; qualquer rota pode ler.
     Nenhuma rota é obrigada a lembrar de chamar nada. */

  const GUEST_AUTH = Object.freeze({ session: null, user: null, ent: null, role: 'guest', plan: null, authenticated: false, suspended: false });

  async function resolveAuth(request) {
    await ensureReady();
    const cookies = getCookies(request);
    const token = cookies.sam_session;
    if (!token) return { ...GUEST_AUTH };
    const session = await getSession(db, token);
    if (!session) return { ...GUEST_AUTH };
    const role = await ensureRoleFromConfig(db, session.user, cfg);
    session.user.role = role;
    const ent = await ensureEntitlement(db, session.userId, cfg);
    return {
      session,
      user: session.user,
      ent,
      role,
      plan: planCodeFor(ent, role),
      authenticated: true,
      suspended: String(session.user.status || 'active') !== 'active',
    };
  }

  /** 401/403 quando não há sessão válida. Devolve `null` quando pode seguir. */
  async function requireAuth(ctx, { admin = false } = {}) {
    const auth = ctx.auth;
    if (!auth || !auth.authenticated) {
      return json({ ok: false, authenticated: false, error: 'Não autenticado.' }, 401, corsFor(ctx.request, cfg));
    }
    if (auth.suspended) {
      return json({ ok: false, error: 'Esta conta está suspensa.' }, 403, corsFor(ctx.request, cfg));
    }
    if (admin && auth.role !== 'admin') {
      return json({ ok: false, error: 'Acesso negado.' }, 403, corsFor(ctx.request, cfg));
    }
    return null;
  }

  /**
   * Porteiro de ferramenta. Devolve `null` quando a pessoa pode usar, ou uma
   * resposta de erro pronta. É o que fecha o contorno pela URL direta: não
   * adianta esconder o botão no HTML, porque a API responde igual para todos.
   * Admin (role) passa em tudo.
   */
  async function toolGuard(toolId, request, ctx) {
    const auth = ctx.auth || { ...GUEST_AUTH };
    if (auth.suspended) {
      return json({ ok: false, success: false, error: 'Esta conta está suspensa.', tool: toolId, reason: 'suspended' }, 403, corsFor(request, cfg));
    }
    const tool = await getTool(db, toolId);
    const decision = hasToolAccess(tool, { authenticated: auth.authenticated, role: auth.role, plan: auth.plan });
    if (decision.allowed) return null;
    const messages = {
      login_required: 'Crie uma conta gratuita ou entre para usar esta ferramenta.',
      upgrade_required: 'Esta ferramenta faz parte do plano PRO.',
      blocked: 'Esta ferramenta está temporariamente indisponível.',
      not_published: 'Esta ferramenta ainda não foi publicada.',
      unknown_tool: 'Ferramenta indisponível.',
    };
    return json(
      {
        ok: false,
        success: false,
        error: messages[decision.reason] || messages.unknown_tool,
        tool: toolId,
        reason: decision.reason,
        loginUrl: decision.reason === 'login_required' ? '/entrar' : null,
        upgradeUrl: null,
      },
      decision.code,
      corsFor(request, cfg)
    );
  }

  /** Envelopa um handler de ferramenta com o porteiro. */
  function guard(toolId, handler) {
    return async (request, ctx) => {
      const denied = await toolGuard(toolId, request, ctx);
      if (denied) return denied;
      return handler(request, ctx);
    };
  }

  /* -------- ferramentas do Shandon no Workers (sem dormir) -------- */
  installShandonOsint({ router, json, readBody, rateLimit, db, cfg, guard, corsFor: (request) => corsFor(request, cfg) });

  /* -------- buscador de pessoa ("Localizar Pessoa") -------- */
  installSearchOsint({ router, json, readBody, rateLimit, cfg, guard, corsFor: (request) => corsFor(request, cfg) });

  /* -------- rate limit -------- */
  async function rateLimit(key, max = 6, winMs = 60_000) {
    await ensureSchema(db);
    const now = Date.now();
    const limit = max === undefined ? cfg.RATE_LIMIT_MAX : max;
    const row = await db.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first();
    if (!row) {
      await db.prepare('INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)').bind(key, now).run();
      return { ok: true };
    }
    if (now - row.window_start > winMs) {
      await db.prepare('UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?').bind(now, key).run();
      return { ok: true };
    }
    if (row.count >= max) {
      return { ok: false, retryAfterMs: winMs - (now - row.window_start) };
    }
    await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
    return { ok: true };
  }

  /* -------- register -------- */
  router.set('POST /api/auth/register', async (request, ctx) => {
    const rl = await rateLimit(`register:${ctx.ip}`, cfg.RATE_LIMIT_MAX);
    if (!rl.ok) return json({ error: 'Muitas tentativas. Aguarde e tente novamente.' }, 429);

    const body = await readBody(request);
    if (!body || body.__tooLarge) return json({ error: 'Requisição inválida.' }, 400);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (name.length < 2 || name.length > 80) return json({ error: 'Informe um nome entre 2 e 80 caracteres.' }, 400);
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'E-mail inválido.' }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: 'A senha deve ter entre 8 e 128 caracteres.' }, 400);

    await ensureReady();
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) return json({ error: 'Este e-mail já está cadastrado.' }, 409);

    const id = crypto.randomUUID();
    const now = Date.now();
    const passwordHash = await createPasswordHash(password);
    // A role nasce da configuração (fonte de verdade), nunca do plano.
    const role = adminEmailSet(cfg).has(email) ? 'admin' : 'user';
    await db.prepare('INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, name, email, passwordHash, role, 'active', now, now).run();

    let ent = await ensureEntitlement(db, id, cfg);
    if (!ent) ent = await getEntitlement(db, id);

    const token = randomHex(TOKEN_BYTES);
    await db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, id, now, now + SESSION_TTL_MS).run();

    const user = await db.prepare('SELECT id, name, email, avatar, role, status, created_at FROM users WHERE id = ?').bind(id).first();
    return json({ ok: true, user: publicMe(user, ent) }, 201, { 'set-cookie': makeSessionCookie(token, cfg, now, request) });
  });

  /* -------- login -------- */
  router.set('POST /api/auth/login', async (request, ctx) => {
    const rl = await rateLimit(`login:${ctx.ip}`, cfg.RATE_LIMIT_MAX);
    if (!rl.ok) return json({ error: `Muitas tentativas. Aguarde ${Math.ceil(rl.retryAfterMs / 1000)}s e tente novamente.` }, 429);

    const body = await readBody(request);
    if (!body || body.__tooLarge) return json({ error: 'Requisição inválida.' }, 400);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    await ensureReady();
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) return json({ error: 'E-mail ou senha incorretos.' }, 401);
    if (String(user.status || 'active') !== 'active') {
      return json({ ok: false, error: 'Esta conta está suspensa. Fale com o suporte.' }, 403);
    }

    const now = Date.now();
    const token = randomHex(TOKEN_BYTES);
    await db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, user.id, now, now + SESSION_TTL_MS).run();

    const role = await ensureRoleFromConfig(db, user, cfg);
    const ent = await ensureEntitlement(db, user.id, cfg);

    const pub = await db.prepare('SELECT id, name, email, avatar, role, status, created_at FROM users WHERE id = ?').bind(user.id).first();
    pub.role = role;
    return json({ ok: true, user: publicMe(pub, ent) }, 200, { 'set-cookie': makeSessionCookie(token, cfg, now, request) });
  });

  /* -------- logout -------- */
  router.set('POST /api/auth/logout', async (request) => {
    await ensureSchema(db);
    const cookies = getCookies(request);
    const token = cookies.sam_session;
    if (token) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(cfg, request) });
  });

  /* -------- me -------- */
  /* CORS com credenciais: a Central é a fonte de verdade da sessão e os apps
     irmãos (Elite em outro subdomínio) precisam ler o estado dela para saber
     quem está logado. Sem `allow-credentials` o navegador descarta a resposta. */
  router.set('GET /api/auth/me', async (request, ctx) => {
    await ensureSchema(db);
    await reconcileRoles(db, cfg);
    const auth = await resolveAuth(request);
    if (!auth.authenticated) {
      return json({ ok: false, error: 'Não autenticado.', authenticated: false }, 401, corsFor(request, cfg));
    }
    return json({ ok: true, authenticated: true, user: publicMe(auth.user, auth.ent) }, 200, corsFor(request, cfg));
  });

  /* -------- forgot password -------- */
  router.set('POST /api/auth/forgot-password', async (request) => {
    const body = await readBody(request);
    if (!body || body.__tooLarge) return json({ error: 'Requisição inválida.' }, 400);
    const email = String(body.email || '').trim().toLowerCase();

    await ensureSchema(db);
    const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (user) {
      const token = randomHex(TOKEN_BYTES);
      const now = Date.now();
      await db.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(user.id).run();
      await db.prepare('INSERT INTO password_resets (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, user.id, now, now + RESET_TTL_MS).run();
      await deliverResetEmail(cfg, email, token);
    }
    // Always answer the same to avoid user enumeration.
    return json({ ok: true, message: 'Se o e-mail existir, você receberá um link de recuperação.' });
  });

  /* -------- reset password -------- */
  router.set('POST /api/auth/reset-password', async (request) => {
    const body = await readBody(request);
    if (!body || body.__tooLarge) return json({ error: 'Requisição inválida.' }, 400);
    const token = String(body.token || '');
    const password = String(body.password || '');
    if (password.length < 8 || password.length > 128) return json({ error: 'A senha deve ter entre 8 e 128 caracteres.' }, 400);

    await ensureSchema(db);
    const row = await db.prepare('SELECT user_id, expires_at, used_at FROM password_resets WHERE token = ?').bind(token).first();
    if (!row || row.used_at || row.expires_at < Date.now()) return json({ error: 'Link inválido ou expirado.' }, 400);

    const now = Date.now();
    const passwordHash = await createPasswordHash(password);
    await db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(passwordHash, now, row.user_id).run();
    await db.prepare('UPDATE password_resets SET used_at = ? WHERE token = ?').bind(now, token).run();
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id).run();
    return json({ ok: true, message: 'Senha atualizada. Faça login novamente.' });
  });

  /* -------- plans -------- */
  router.set('POST /api/access/check', async (request, ctx) => {
    await ensureReady();
    const auth = ctx.auth || { ...GUEST_AUTH };
    const body = await readBody(request);
    const project = String((body && body.project) || '').trim() || 'amorim-osint';
    const limitKey = String((body && body.limit) || body.resource || '').trim() || 'tools';

    /* A role administrativa define o teto (acesso total); o plano comercial
       define o restante. A role nunca vem do plano. */
    const isAdmin = auth.role === 'admin';
    const planCode = isAdmin ? 'ADMIN' : auth.plan ? String(auth.plan).toUpperCase() : 'VISITOR';
    /* `auth.plan` é o plano EFETIVO (admin vira 'pro' para poder usar as
       ferramentas). Para dizer o que a pessoa COMPROU, é preciso ler o
       entitlement — senão todo admin aparece como cliente PRO. */
    const commercial = auth.ent && resolvePlan(auth.ent);
    const commercialPlan = commercial ? String(commercial.code).toUpperCase() : null;

    const sessionLimits = isAdmin
      ? PLANS.admin.limits[project]
      : auth.ent && resolvePlan(auth.ent)
        ? resolvePlan(auth.ent).limits[project]
        : null;
    const limits = sessionLimits || GUEST_LIMITS[project] || GUEST_LIMITS['amorim-osint'];
    const value = limits[limitKey];

    /* BUG ANTIGO: `typeof value === 'boolean' ? value : true` devolvia
       allowed=true para TODO limite numérico, em qualquer plano — inclusive
       visitante. Agora limite numérico é comparado com o que a pessoa pediu. */
    const requested = Number(body && body.current);
    let allowed;
    if (typeof value === 'boolean') {
      allowed = value;
    } else if (typeof value === 'number') {
      allowed = Number.isFinite(requested) && requested > 0 ? requested <= value : value >= 1;
    } else {
      allowed = false;
    }

    /* Autorização pela ferramenta concreta (catálogo), quando o cliente manda `tool`. */
    let tool = null;
    const toolId = String((body && body.tool) || '').trim();
    if (toolId) {
      tool = await getTool(db, toolId);
      if (tool) {
        const decision = hasToolAccess(tool, { authenticated: auth.authenticated, role: auth.role, plan: auth.plan });
        allowed = allowed && decision.allowed;
        tool = { ...tool, allowed: decision.allowed, reason: decision.allowed ? null : decision.reason };
      }
    }

    return json({
      ok: true,
      project,
      /* `plan` é o NÍVEL EFETIVO agregado, não o que a pessoa comprou: o Shandon
         Elite depende desse campo (`tierForPlan` mapeia 'ADMIN' → full) e não
         pode ser republicado agora. Quem quiser o plano comercial de verdade
         usa `commercialPlan`; a autorização acima vem de `auth.role`, nunca
         deste campo. */
      plan: planCode,
      commercialPlan,
      role: auth.role,
      isAdmin,
      authenticated: auth.authenticated,
      demo: !auth.authenticated,
      allowed,
      current: Number.isFinite(requested) ? requested : null,
      limit: value === undefined ? null : value,
      limitKey,
      tool,
      message: !auth.authenticated
        ? 'Crie uma conta gratuita para continuar.'
        : !allowed
          ? 'Este recurso não está disponível no seu plano.'
          : planCode === 'FREE'
            ? 'Recurso básico disponível.'
            : 'Acesso liberado.',
    }, 200, corsFor(request, cfg));
  });

  /* -------- pix checkout (PRO) -------- */
  router.set('POST /api/metrics/click', async (request, ctx) => {
    const rl = await rateLimit(`click:${ctx.ip}`, 60);
    if (!rl.ok) return json({ ok: false }, 429);
    const body = await readBody(request);
    const target = String((body && body.target) || '').slice(0, 120);
    const kind = String((body && body.kind) || 'project').slice(0, 20);
    if (!target) return json({ ok: false }, 400);
    await ensureReady();
    const day = new Date().toISOString().slice(0, 10);
    await db.prepare('INSERT INTO link_clicks (id, target, kind, day, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), target, kind, day, Date.now()).run();
    return json({ ok: true });
  });

  router.set('GET /api/admin/metrics', async (request, ctx) => {
    const check = await adminCheck(ctx);
    if (check.error) return check.error;
    const rows = await db.prepare("SELECT target, kind, COUNT(*) AS clicks, SUM(CASE WHEN day = date('now') THEN 1 ELSE 0 END) AS today FROM link_clicks GROUP BY target, kind ORDER BY clicks DESC LIMIT 50").all();
    return json({ ok: true, metrics: toRows(rows) });
  });

  /* -------- admin: orders -------- */
  /* A role administrativa (users.role) é a fonte da verdade. Não existe mais
     "admin" como plano: plano é só free/pro. */
  async function adminCheck(ctx) {
    await ensureReady();
    const denied = await requireAuth(ctx, { admin: true });
    if (denied) return { error: denied };
    return { session: ctx.auth.session, auth: ctx.auth };
  }

  router.set('GET /api/orders', async (request, ctx) => {
    const check = await adminCheck(ctx);
    if (check.error) return check.error;
    const rows = await db.prepare('SELECT id, code, name, email, cpf, amount, plan, status, created_at, paid_at, activated_at FROM orders ORDER BY created_at DESC LIMIT 200').all();
    return json({ ok: true, orders: toRows(rows) });
  });

  router.set('POST /api/orders/activate', async (request, ctx) => {
    const check = await adminCheck(ctx);
    if (check.error) return check.error;

    const body = await readBody(request);
    const code = String((body && body.code) || '').trim().toUpperCase();
    if (!code) return json({ error: 'Código do pedido é obrigatório.' }, 400);

    const order = await db.prepare('SELECT * FROM orders WHERE code = ?').bind(code).first();
    if (!order) return json({ error: 'Pedido não encontrado.' }, 404);
    if (order.status !== 'pending') return json({ error: `Este pedido já está ${order.status}.` }, 409);

    const now = Date.now();
    await db.prepare("UPDATE orders SET status = 'activated', paid_at = ?, activated_at = ? WHERE code = ?").bind(now, now, code).run();

    const buyer = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').bind(order.email).first();
    if (buyer) {
      await db.prepare("UPDATE entitlements SET plan = 'pro', status = 'active', started_at = ?, expires_at = NULL, provider = 'pix' WHERE user_id = ?").bind(now, buyer.id).run();
    }

    return json({ ok: true, order: { code: order.code, status: 'activated', name: order.name, email: order.email } });
  });

  /* -------- admin users -------- */
  router.set('GET /api/admin/users', async (request, ctx) => {
    const check = await adminCheck(ctx);
    if (check.error) return check.error;

    const rows = await db.prepare(
      'SELECT u.id, u.name, u.email, u.avatar, u.role, u.status AS account_status, u.created_at, e.plan, e.status, e.started_at, e.expires_at, e.provider FROM users u LEFT JOIN entitlements e ON e.user_id = u.id ORDER BY u.created_at DESC LIMIT 500'
    ).all();
    return json({ ok: true, users: toRows(rows) });
  });

  /* -------- admin: gerir conta (role / plano / status) --------
     A role é o que dá acesso ao painel; o plano é o que dá acesso às
     ferramentas. Trocar um não mexe no outro. Nada é apagado: suspension é
     `status`, e a sessão da pessoa é encerrada na hora. */
  route('PATCH', '/api/admin/users/([^/?#]+)', async (request, ctx) => {
    const check = await adminCheck(ctx);
    if (check.error) return check.error;

    const id = request.url.match(/\/api\/admin\/users\/([^/?#]+)/)?.[1];
    if (!id) return json({ error: 'ID de usuário obrigatório.' }, 400);

    const body = await readBody(request);
    if (!body || body.__tooLarge) return json({ error: 'Requisição inválida.' }, 400);

    const target = await db.prepare('SELECT id, email, role, status FROM users WHERE id = ?').bind(id).first();
    if (!target) return json({ error: 'Usuário não encontrado.' }, 404);

    const sets = [];
    const binds = [];
    const changed = {};

    if (body.role !== undefined) {
      const role = String(body.role || '').toLowerCase();
      if (!['user', 'admin'].includes(role)) return json({ error: 'Role inválida: use user ou admin.' }, 400);
      // Trava de segurança: o dono não fica sem painel por engano.
      if (role !== 'admin' && target.id === ctx.auth.user.id) {
        return json({ error: 'Você não pode remover a própria role de admin.' }, 400);
      }
      if (target.role !== role) {
        sets.push('role = ?');
        binds.push(role);
        changed.role = role;
      }
    }

    if (body.status !== undefined) {
      const status = String(body.status || '').toLowerCase();
      if (!['active', 'suspended'].includes(status)) return json({ error: 'Status inválido: use active ou suspended.' }, 400);
      if (status === 'suspended' && target.id === ctx.auth.user.id) {
        return json({ error: 'Você não pode suspender a própria conta.' }, 400);
      }
      if (target.status !== status) {
        sets.push('status = ?');
        binds.push(status);
        changed.status = status;
      }
    }

    if (sets.length) {
      binds.push(Date.now(), id);
      await db.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...binds).run();
    }

    if (body.plan !== undefined) {
      const plan = String(body.plan || '').toLowerCase();
      if (!['free', 'pro'].includes(plan)) return json({ error: 'Plano inválido: use free ou pro.' }, 400);
      await db.prepare("UPDATE entitlements SET plan = ?, status = 'active', expires_at = NULL, provider = 'central' WHERE user_id = ?").bind(plan, id).run();
      if (!changed.plan) changed.plan = plan;
    }

    // Sessões mortas ao suspender: suspensão precisa valer imediatamente.
    if (changed.status === 'suspended') {
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    }

    if (Object.keys(changed).length) {
      await recordAudit(db, ctx.auth.user.email, 'user.update', target.email, JSON.stringify(changed));
    }

    const row = await db.prepare(
      'SELECT u.id, u.name, u.email, u.role, u.status AS account_status, u.created_at, e.plan, e.status FROM users u LEFT JOIN entitlements e ON e.user_id = u.id WHERE u.id = ?'
    ).bind(id).first();
    return json({ ok: true, user: row, changed });
  });

  /* -------- admin: catálogo de ferramentas --------
     Aqui o dono publica, define o plano mínimo e bloqueia ferramentas — sem
     novo deploy, porque a configuração vive no D1. */
  router.set('GET /api/admin/tools', async (request, ctx) => {
    const check = await adminCheck(ctx);
    if (check.error) return check.error;
    const tools = await listTools(db);
    return json({ ok: true, tools });
  });

  route('PATCH', '/api/admin/tools/([^/?#]+)', async (request, ctx) => {
    const check = await adminCheck(ctx);
    if (check.error) return check.error;

    const id = request.url.match(/\/api\/admin\/tools\/([^/?#]+)/)?.[1];
    if (!id) return json({ error: 'ID de ferramenta obrigatório.' }, 400);

    const body = await readBody(request);
    if (!body || body.__tooLarge) return json({ error: 'Requisição inválida.' }, 400);

    const result = await updateTool(db, id, body, ctx.auth.user.email);
    if (result.error) return json({ error: result.error }, 400);
    return json({ ok: true, tool: result.tool });
  });

  /* -------- catálogo público --------
     O frontend lê isto para saber o que está publicado e o que a pessoa pode
     usar. `access` já vem resolvido para quem está chamando. */
  router.set('GET /api/tools', async (request, ctx) => {
    await ensureReady();
    const auth = ctx.auth || { ...GUEST_AUTH };
    const tools = await listTools(db);
    const shaped = tools.map((tool) => {
      const decision = hasToolAccess(tool, { authenticated: auth.authenticated, role: auth.role, plan: auth.plan });
      return {
        id: tool.id,
        name: tool.name,
        kind: tool.kind,
        minPlan: tool.minPlan,
        status: tool.status,
        position: tool.position,
        // O front esconde o que está bloqueado/draft; quem é admin vê tudo.
        visible: tool.status === 'published' || auth.role === 'admin',
        access: { allowed: decision.allowed, reason: decision.allowed ? null : decision.reason },
      };
    });
    return json({
      ok: true,
      authenticated: auth.authenticated,
      role: auth.role,
      plan: auth.plan ? String(auth.plan).toUpperCase() : 'VISITOR',
      isAdmin: auth.role === 'admin',
      tools: shaped,
    }, 200, corsFor(request, cfg));
  });

  router.set('GET /api/admin/audit', async (request, ctx) => {
    const check = await adminCheck(ctx);
    if (check.error) return check.error;
    return json({ ok: true, entries: await listAudit(db, 100) });
  });

  /* -------- admin: diagnóstico do ambiente -------- */
  /* Só devolve se cada segredo ESTÁ ou NÃO configurado, nunca o valor. Existe
     porque "a chave não funciona" tem quatro causas possíveis (segredo não
     salvo, salvo no Worker errado, salvo na conta errada do Cloudflare, ou
     nome com typo) e sem isso o dono precisa caçar no painel às cegas. */
  router.set('GET /api/admin/diagnostics', async (request, ctx) => {
    const check = await adminCheck(ctx);
    if (check.error) return check.error;

    const has = (v) => Boolean(String(v || '').trim());
    const secretNames = [
      'APIFY_API_TOKEN',
      'RAPIDAPI_WHATSAPP_KEY',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'RESEND_API_KEY',
    ];
    const secrets = {};
    for (const name of secretNames) secrets[name] = has(cfg[name]);

    const count = async (sql) => {
      try {
        const row = await db.prepare(sql).first();
        return row ? Object.values(row)[0] : 0;
      } catch (err) {
        return `erro: ${err.message}`;
      }
    };

    const missing = secretNames.filter((n) => !secrets[n]);
    /* Só interessa agora: as duas chaves de OSINT e o e-mail. Google é
       opcional e não deve aparecer como pendência. */
    const pending = missing.filter((n) => n !== 'GOOGLE_CLIENT_ID' && n !== 'GOOGLE_CLIENT_SECRET');
    return json({
      ok: true,
      secrets,
      pending,
      hint: {
        onde: 'Cloudflare > Workers & Pages > central-amorim > Settings > Variables and Secrets',
        tipo: 'Add do tipo **Secret** (nunca "Text"/var), e clicar em Deploy para ativar',
        nome: 'Exatamente APIFY_API_TOKEN, sem acento e sem espaço',
        conta: 'Confira se está na mesma conta do Cloudflare que hospeda o site',
        alternativa: 'Terminal: npx wrangler secret put APIFY_API_TOKEN (grava direto no Worker, sem erro de nome)',
      },
      config: {
        PUBLIC_ORIGIN: cfg.PUBLIC_ORIGIN || '(vazio)',
        COOKIE_DOMAIN: cfg.COOKIE_DOMAIN || '(vazio)',
        SHANDON_ORIGIN: cfg.SHANDON_ORIGIN || '(vazio)',
        APIFY_DAILY_LIMIT: cfg.APIFY_DAILY_LIMIT,
        PIX_AMOUNT_BRL: cfg.PIX_AMOUNT_BRL,
        pixConfigured: has(cfg.PIX_KEY),
        adminEmails: adminEmailSet(cfg).size,
      },
      database: {
        users: await count('SELECT COUNT(*) AS n FROM users'),
        sessions: await count('SELECT COUNT(*) AS n FROM sessions'),
        orders: await count('SELECT COUNT(*) AS n FROM orders'),
        tools: await count('SELECT COUNT(*) AS n FROM tools'),
        withPro: await count("SELECT COUNT(*) AS n FROM entitlements WHERE plan = 'pro'"),
        /* A role é a fonte da verdade do admin. Se der mais de 1, há conta
           sobrando com acesso administrativo — vale conferir em /admin. */
        admins: await count("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
        suspended: await count("SELECT COUNT(*) AS n FROM users WHERE status = 'suspended'"),
        /* Deve ser 0 depois da correção: plano 'admin' virou 'pro'. */
        legacyAdminPlans: await count("SELECT COUNT(*) AS n FROM entitlements WHERE plan = 'admin'"),
      },
      time: Date.now(),
    });
  });

  /* -------- google oauth -------- */
  router.set('GET /api/auth/google/start', async (request) => {
    if (!cfg.GOOGLE_CLIENT_ID) {
      return json({ ok: false, error: 'Login com Google não configurado nesta instância.' }, 501);
    }
    const state = randomHex(TOKEN_BYTES);
    const params = new URLSearchParams({
      client_id: cfg.GOOGLE_CLIENT_ID,
      redirect_uri: `${cfg.PUBLIC_ORIGIN}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      state,
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    const stateParts = ['sam_oauth_state=' + state, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=600'];
    if (cfg.COOKIE_SECURE !== 'false') stateParts.push('Secure');
    const stateDomain = cookieDomainFor(request, cfg);
    if (stateDomain) stateParts.push(`Domain=${stateDomain}`);
    const cookie = stateParts.join('; ');
    return new Response(null, { status: 302, headers: { location: url, 'set-cookie': cookie } });
  });

  router.set('GET /api/auth/google/callback', async (request) => {
    if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET) {
      return json({ ok: false, error: 'Login com Google não configurado nesta instância.' }, 501);
    }
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = getCookies(request);
    if (!code || !state || cookies.sam_oauth_state !== state) {
      return json({ ok: false, error: 'Falha na validação do OAuth.' }, 400);
    }

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.GOOGLE_CLIENT_ID,
        client_secret: cfg.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${cfg.PUBLIC_ORIGIN}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenResp.ok) return json({ ok: false, error: 'Falha ao trocar o código de autorização.' }, 502);
    const tokens = await tokenResp.json();

    const userInfo = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userInfo.ok) return json({ ok: false, error: 'Falha ao obter dados do usuário.' }, 502);
    const profile = await userInfo.json();
    const email = String(profile.email || '').toLowerCase();
    if (!email) return json({ ok: false, error: 'Conta Google sem e-mail.' }, 400);

    await ensureReady();
    let user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const now = Date.now();
    if (!user) {
      const id = crypto.randomUUID();
      const derivedPassword = randomHex(32); // OAuth-only accounts have no usable password.
      const passwordHash = await createPasswordHash(derivedPassword + id);
      const name = profile.name || profile.given_name || email.split('@')[0];
      const role = adminEmailSet(cfg).has(email) ? 'admin' : 'user';
      await db.prepare('INSERT INTO users (id, name, email, password_hash, avatar, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, name, email, passwordHash, profile.picture || null, role, 'active', now, now).run();
      user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    } else if (String(user.status || 'active') !== 'active') {
      return new Response(null, { status: 302, headers: { location: `${url.origin}/entrar?erro=suspensa` } });
    }

    const role = await ensureRoleFromConfig(db, user, cfg);
    const ent = await ensureEntitlement(db, user.id, cfg);

    const token = randomHex(TOKEN_BYTES);
    await db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, user.id, now, now + SESSION_TTL_MS).run();

    const headers = new Headers({ location: `${url.origin}/minha-conta` });
    headers.append('set-cookie', makeSessionCookie(token, cfg, now, request));
    const clearState = ['sam_oauth_state=; Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (cfg.COOKIE_SECURE !== 'false') clearState.push('Secure');
    const clearDomain = cookieDomainFor(request, cfg);
    if (clearDomain) clearState.push(`Domain=${clearDomain}`);
    headers.append('set-cookie', clearState.join('; '));
    return new Response(null, { status: 302, headers });
  });

  /* -------- health -------- */
  router.set('GET /api/health', async () => {
    await ensureSchema(db);
    return json({ ok: true, service: 'central-amorim', time: Date.now() });
  });

  /* -------- google availability probe (no secrets exposed) -------- */
  router.set('POST /api/auth/probe-google', async () => {
    return json({ ok: true, enabled: Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET) });
  });

  /* -------- dispatcher -------- */
  return {
    /**
     * Portão da PÁGINA /admin.
     *
     * O HTML do painel vive no bucket de assets, então ele é baixável por
     * qualquer um. Ele é um shell — não tem dado nem segredo — mas mesmo
     * assim o requisito é que só role=admin carregue o painel, e a checagem
     * precisa ser no servidor. A decisão sai daqui, da MESMA sessão e do MESMO
     * `requireAuth` das APIs: não existe caminho em que o navegador convença o
     * Worker a liberar a página.
     *
     * Devolve a resposta de bloqueio pronta, ou `null` quando pode seguir para
     * o asset.
     */
    async adminPageGate(request) {
      await ensureReady();
      const auth = await resolveAuth(request);
      return requireAuth({ auth, request }, { admin: true });
    },

    async fetch(request) {
      const ctx = { request, ip: clientIp(request, cfg) };
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      if (isMutating(method) && !originAllowed(request, cfg)) {
        return json({ ok: false, error: 'Origem não permitida.' }, 403);
      }

      const handler = router.get(`${method} ${url.pathname}`) || dynamicRoutes.find((r) => r.method === method && r.re.test(url.pathname))?.handler;
      if (!handler) {
        if (url.pathname.startsWith('/api/')) {
          if (method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsFor(request, cfg) || {} });
          }
          return json({ ok: false, error: 'Rota não encontrada.' }, 404, corsFor(request, cfg));
        }
        return new Response('Não encontrado', { status: 404 });
      }

      try {
        /* Resolve a sessão UMA vez, antes de qualquer handler, e coloca em
           ctx.auth. Só toca no banco se houver cookie de sessão — visitante
           anônimo não paga uma consulta extra por requisição. Rotas com
           prefixo dinâmico (PATCH /api/admin/...) não estão no Map, então
           entram pelo mesmo caminho e recebem o mesmo tratamento. */
        ctx.auth = await resolveAuth(request);
        return await handler(request, ctx);
      } catch (err) {
        console.error('[central] handler error:', err);
        return json({ ok: false, error: 'Erro interno.' }, 500);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Password reset e-mail delivery (pluggable)                          */
/* ------------------------------------------------------------------ */

async function deliverResetEmail(cfg, email, token) {
  const resetUrl = `${cfg.PUBLIC_ORIGIN}/recuperar-senha?token=${token}`;
  const subject = `${cfg.APP_NAME} — Recuperação de senha`;
  const text = `Você solicitou a recuperação de senha. Acesse o link abaixo para definir uma nova senha:\n\n${resetUrl}\n\nSe você não solicitou, ignore esta mensagem.`;

  if (cfg.RESEND_API_KEY && cfg.MAIL_FROM) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ from: cfg.MAIL_FROM, to: [email], subject, text }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
  // No e-mail provider configured: log in dev only, never leak the token in prod.
  if (cfg.RESEND_API_KEY || cfg.MAIL_FROM) {
    console.warn('[mail] RESEND_API_KEY/MAIL_FROM com configuração incompleta; e-mail não enviado.');
  }
  return true; // flows as no-op; recovery link only rendered client-side in dev route
}