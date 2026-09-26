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
      unique: 79,
      uniqueNote: 'pagamento único · acesso vitalício à versão atual',
      monthly: 9.9,
    },
    features: [
      'Árvore AMORIM OSINT completa: 33 categorias',
      '1.168 ferramentas de investigação',
      'Exportação de dados liberada',
      'Pagamento único de R$ 79 — sem mensalidade',
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
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar || null,
    createdAt: user.created_at,
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
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
`;

let ensured = false;

async function ensureSchema(db) {
  if (ensured) return;
  await db.exec(SCHEMA_SQL);
  ensured = true;
}

/* ------------------------------------------------------------------ */
/* Request helpers                                                     */
/* ------------------------------------------------------------------ */

function json(data, status = 200, headers = {}) {
  if (typeof data === 'object' && data !== null) {
    // Keep every error response consistent (ok:false) unless a caller sets ok explicitly.
    if ('error' in data && !('ok' in data)) data.ok = false;
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function html(data, status = 200, headers = {}) {
  return new Response(data, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
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

function makeSessionCookie(token, env, now = Date.now()) {
  const parts = [
    `sam_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (env.COOKIE_SECURE !== 'false') parts.push('Secure');
  if (env.COOKIE_DOMAIN) parts.push(`Domain=${env.COOKIE_DOMAIN}`);
  parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  parts.push(`Expires=${new Date(now + SESSION_TTL_MS).toUTCString()}`);
  return parts.join('; ');
}

function clearSessionCookie(env) {
  const parts = ['sam_session=; Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (env.COOKIE_SECURE !== 'false') parts.push('Secure');
  if (env.COOKIE_DOMAIN) parts.push(`Domain=${env.COOKIE_DOMAIN}`);
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

function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // same-site / non-browser
  const allowed = new Set([env.PUBLIC_ORIGIN].filter(Boolean));
  if (env.ALLOW_NULL_ORIGIN === '1') allowed.add('null');
  return allowed.has(origin);
}

/* ------------------------------------------------------------------ */
/* Session / access resolution                                        */
/* ------------------------------------------------------------------ */

async function getSession(db, token) {
  if (!token) return null;
  const row = await db.prepare('SELECT s.token, s.user_id, s.expires_at, u.id as uid, u.name, u.email, u.avatar, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').bind(token).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  return { token: row.token, userId: row.user_id, user: { id: row.uid, name: row.name, email: row.email, avatar: row.avatar, created_at: row.created_at } };
}

async function getEntitlement(db, userId) {
  return db.prepare('SELECT user_id, plan, status, started_at, expires_at, provider FROM entitlements WHERE user_id = ?').bind(userId).first();
}

async function ensureEntitlement(db, userId, env) {
  let ent = await getEntitlement(db, userId);
  if (!ent) {
    const now = Date.now();
    const adminEmails = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first();
    const plan = user && adminEmails.includes(user.email.toLowerCase()) ? 'admin' : 'free';
    await db.prepare('INSERT OR IGNORE INTO entitlements (user_id, plan, status, started_at, provider) VALUES (?, ?, ?, ?, ?)').bind(userId, plan, 'active', now, 'central').run();
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
  };
  const router = new Map();

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

    await ensureSchema(db);
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) return json({ error: 'Este e-mail já está cadastrado.' }, 409);

    const id = crypto.randomUUID();
    const now = Date.now();
    const passwordHash = await createPasswordHash(password);
    await db.prepare('INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, email, passwordHash, now, now).run();

    let ent = await ensureEntitlement(db, id, { ADMIN_EMAILS: cfg.ADMIN_EMAILS });
    if (!ent) ent = await getEntitlement(db, id);

    const token = randomHex(TOKEN_BYTES);
    await db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, id, now, now + SESSION_TTL_MS).run();

    const user = await db.prepare('SELECT id, name, email, avatar, created_at FROM users WHERE id = ?').bind(id).first();
    return json({ ok: true, user: publicMe(user, ent) }, 201, { 'set-cookie': makeSessionCookie(token, cfg, now) });
  });

  /* -------- login -------- */
  router.set('POST /api/auth/login', async (request, ctx) => {
    const rl = await rateLimit(`login:${ctx.ip}`, cfg.RATE_LIMIT_MAX);
    if (!rl.ok) return json({ error: `Muitas tentativas. Aguarde ${Math.ceil(rl.retryAfterMs / 1000)}s e tente novamente.` }, 429);

    const body = await readBody(request);
    if (!body || body.__tooLarge) return json({ error: 'Requisição inválida.' }, 400);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    await ensureSchema(db);
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) return json({ error: 'E-mail ou senha incorretos.' }, 401);

    const now = Date.now();
    const token = randomHex(TOKEN_BYTES);
    await db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, user.id, now, now + SESSION_TTL_MS).run();

    let ent = await getEntitlement(db, user.id);
    if (!ent) ent = await ensureEntitlement(db, user.id, { ADMIN_EMAILS: cfg.ADMIN_EMAILS });

    const pub = await db.prepare('SELECT id, name, email, avatar, created_at FROM users WHERE id = ?').bind(user.id).first();
    return json({ ok: true, user: publicMe(pub, ent) }, 200, { 'set-cookie': makeSessionCookie(token, cfg, now) });
  });

  /* -------- logout -------- */
  router.set('POST /api/auth/logout', async (request) => {
    await ensureSchema(db);
    const cookies = getCookies(request);
    const token = cookies.sam_session;
    if (token) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(cfg) });
  });

  /* -------- me -------- */
  router.set('GET /api/auth/me', async (request) => {
    await ensureSchema(db);
    const cookies = getCookies(request);
    const session = await getSession(db, cookies.sam_session);
    if (!session) return json({ ok: false, error: 'Não autenticado.', authenticated: false }, 401);
    let ent = await getEntitlement(db, session.userId);
    if (!ent) ent = await ensureEntitlement(db, session.userId, { ADMIN_EMAILS: cfg.ADMIN_EMAILS });
    return json({ ok: true, authenticated: true, user: publicMe(session.user, ent) });
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
  router.set('GET /api/plans', async () => {
    return json({
      ok: true,
      plans: Object.values(PLANS).map((p) => ({
        code: p.code,
        label: p.label,
        descriptor: p.descriptor,
        order: p.order,
        billing: p.billing,
        features: p.features || [],
        limits: p.limits ? p.limits['amorim-osint'] || null : null,
        available: p.code !== 'PRO' || false,
      })),
    });
  });

  /* -------- access check (server-side enforcement) -------- */
  router.set('POST /api/access/check', async (request) => {
    await ensureSchema(db);
    const cookies = getCookies(request);
    const session = await getSession(db, cookies.sam_session);
    const body = await readBody(request);
    const project = String((body && body.project) || '').trim() || 'amorim-osint';
    const limitKey = String((body && body.limit) || body.resource || '').trim() || 'tools';

    let plan = null;
    let planCode = 'VISITOR';
    if (session) {
      const ent = await getEntitlement(db, session.userId) || (await ensureEntitlement(db, session.userId, { ADMIN_EMAILS: cfg.ADMIN_EMAILS }));
      const resolved = resolvePlan(ent);
      if (resolved) {
        plan = resolved;
        planCode = resolved.code;
      }
    }

    const sessionLimits = plan ? plan.limits[project] : GUEST_LIMITS[project];
    const limits = sessionLimits || GUEST_LIMITS['amorim-osint'];
    const value = limits[limitKey];
    const allowed = typeof value === 'boolean' ? value : true;

    return json({
      ok: true,
      project,
      plan: planCode,
      demo: planCode === 'VISITOR',
      allowed,
      current: null,
      limit: value,
      limitKey,
      message:
        planCode === 'VISITOR'
          ? 'Crie uma conta gratuita para continuar.'
          : planCode === 'FREE'
            ? 'Recurso básico disponível.'
            : 'Acesso liberado.',
    });
  });

  /* -------- admin users -------- */
  router.set('GET /api/admin/users', async (request) => {
    await ensureSchema(db);
    const cookies = getCookies(request);
    const session = await getSession(db, cookies.sam_session);
    if (!session) return json({ ok: false, error: 'Não autenticado.' }, 401);
    const ent = await getEntitlement(db, session.userId) || (await ensureEntitlement(db, session.userId, { ADMIN_EMAILS: cfg.ADMIN_EMAILS }));
    if (ent.plan !== 'admin') return json({ ok: false, error: 'Acesso negado.' }, 403);

    const rows = await db.prepare(
      'SELECT u.id, u.name, u.email, u.avatar, u.created_at, e.plan, e.status, e.started_at, e.expires_at, e.provider FROM users u LEFT JOIN entitlements e ON e.user_id = u.id ORDER BY u.created_at DESC LIMIT 500'
    ).all();
    return json({ ok: true, users: rows });
  });

  /* -------- google oauth -------- */
  router.set('GET /api/auth/google/start', async (_, ctx) => {
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

    await ensureSchema(db);
    let user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const now = Date.now();
    if (!user) {
      const id = crypto.randomUUID();
      const derivedPassword = randomHex(32); // OAuth-only accounts have no usable password.
      const passwordHash = await createPasswordHash(derivedPassword + id);
      const name = profile.name || profile.given_name || email.split('@')[0];
      await db.prepare('INSERT INTO users (id, name, email, password_hash, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, name, email, passwordHash, profile.picture || null, now, now).run();
      user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    }

    const token = randomHex(TOKEN_BYTES);
    await db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, user.id, now, now + SESSION_TTL_MS).run();

    const headers = new Headers({ location: `${cfg.PUBLIC_ORIGIN || '/'}/minha-conta` });
    headers.append('set-cookie', makeSessionCookie(token, cfg, now));
    headers.append('set-cookie', 'sam_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
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
    async fetch(request) {
      const ctx = {};
      ctx.ip = clientIp(request, cfg);
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      if (isMutating(method) && !originAllowed(request, cfg)) {
        return json({ ok: false, error: 'Origem não permitida.' }, 403);
      }

      const handler = router.get(`${method} ${url.pathname}`);
      if (!handler) {
        if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Rota não encontrada.' }, 404);
        return new Response('Não encontrado', { status: 404 });
      }
      try {
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