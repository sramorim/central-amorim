/**
 * CENTRAL AMORIM — Catálogo de ferramentas e autorização por ferramenta
 *
 * A Central é a fonte de verdade de acesso. Este módulo guarda o catálogo
 * (quais ferramentas existem, se estão publicadas, e qual plano mínimo cada
 * uma exige) e responde "esta pessoa pode usar esta ferramenta?".
 *
 * Três níveis, na ordem:
 *   guest  — visitante sem conta (ferramentas locais e gratuitas)
 *   free   — qualquer conta gratuita da Central
 *   pro    — conta com plano pago
 *   admin  — role administrativa: passa em tudo, sem exceção
 *
 * A role NUNCA vem do plano. Um plano 'pro' não dá acesso administrativo e
 * um 'admin' não é um plano: é `users.role`. Ver app.js (isAdminUser).
 *
 * O catálogo é dado, não código: o dono altera publicação/plano/bloqueio pelo
 * painel em /admin, sem novo deploy. O seed abaixo só roda para ferramentas que
 * ainda não existem na tabela (INSERT OR IGNORE), então nada é sobrescrito.
 */

/* Hierarquia de planos. Maior = mais acesso. `admin` não entra aqui: role. */
export const PLAN_RANK = { guest: 0, free: 1, pro: 2 };
export const PLAN_LABEL = { guest: 'Visitante', free: 'Gratuito', pro: 'PRO' };

export const TOOL_STATUSES = ['published', 'draft', 'blocked'];

/* Catálogo inicial. Cobre TODAS as ferramentas já publicadas em src/js/data.js
   (nenhuma removida) mais as rotas de API hospedadas aqui. `minPlan` decide o
   porteiro: 'guest' mantém aberta, 'free' exige login, 'pro' exige plano pago. */
export const DEFAULT_TOOLS = [
  /* ---- Projetos (cards do site) ---- */
  {
    id: 'shandon-elite',
    name: 'SHANDON ELITE',
    projectId: 'shandon-elite',
    kind: 'project',
    minPlan: 'pro',
    status: 'published',
    position: 10,
    note: 'Plataforma paga. Gasta crédito de terceiros (Apify/RapidAPI) por consulta.',
  },
  {
    id: 'amorim-osint',
    name: 'AMORIM OSINT',
    projectId: 'amorim-osint',
    kind: 'project',
    minPlan: 'free',
    status: 'published',
    position: 20,
    note: 'Árvore de investigação. Conta gratuita já entra com categorias limitadas.',
  },
  {
    id: 'amorim-follow',
    name: 'AMORIM FOLLOW',
    projectId: 'amorim-follow',
    kind: 'project',
    minPlan: 'guest',
    status: 'published',
    position: 30,
    note: 'Processa tudo no próprio navegador. Sem custo, continua aberta.',
  },
  {
    id: 'ig-radar',
    name: 'IG RADAR',
    projectId: 'ig-radar',
    kind: 'project',
    minPlan: 'guest',
    status: 'published',
    position: 40,
    note: 'Offline. Sem custo, continua aberta.',
  },
  {
    id: 'sonda',
    name: 'SONDA',
    projectId: 'sonda',
    kind: 'project',
    minPlan: 'guest',
    status: 'published',
    position: 50,
    note: 'Offline. Sem custo, continua aberta.',
  },
  {
    id: 'panorama',
    name: 'PANORAMA',
    projectId: 'panorama',
    kind: 'project',
    minPlan: 'guest',
    status: 'published',
    position: 60,
    note: 'Offline. Sem custo, continua aberta.',
  },
  {
    id: 'sentinela',
    name: 'SENTINELA',
    projectId: 'sentinela',
    kind: 'project',
    minPlan: 'guest',
    status: 'published',
    position: 70,
    note: 'Offline. Sem custo, continua aberta.',
  },

  /* ---- Rotas de API hospedadas na Central ---- */
  {
    id: 'whatsapp-lookup',
    name: 'WhatsApp Lookup',
    projectId: 'shandon-elite',
    kind: 'api',
    minPlan: 'pro',
    status: 'published',
    position: 110,
    note: 'Consome Apify/RapidAPI. Se quiser reabrir antes do Elite ser republicado, troque para "Visitante" no painel.',
  },
  {
    id: 'instagram',
    name: 'Instagram Profundo',
    projectId: 'shandon-elite',
    kind: 'api',
    minPlan: 'pro',
    status: 'published',
    position: 120,
    note: 'Consome Apify. Custa dinheiro por consulta.',
  },
  {
    id: 'phone-osint',
    name: 'Phone OSINT',
    projectId: 'amorim-osint',
    kind: 'api',
    minPlan: 'free',
    status: 'published',
    position: 130,
    note: 'Consulta de fontes públicas, sem crédito pago.',
  },
  {
    id: 'crypto-check',
    name: 'Crypto Check',
    projectId: 'amorim-osint',
    kind: 'api',
    minPlan: 'free',
    status: 'published',
    position: 140,
    note: 'Consulta em blockchain pública, sem crédito pago.',
  },
  {
    id: 'search',
    name: 'Busca de username / nome / e-mail / telefone',
    projectId: 'amorim-osint',
    kind: 'api',
    minPlan: 'free',
    status: 'published',
    position: 150,
    note: 'Fontes públicas, sem crédito pago.',
  },
];

export const TOOLS_TABLE_SQL = `
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
CREATE INDEX IF NOT EXISTS idx_tools_project ON tools(project_id);
`;

/* Trilha de auditoria: toda mudança de role/plano/bloqueio fica registrada com
   quem fez e quando. Preferimos guardar a ação a apagar o registro. */
export const AUDIT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit(created_at);
`;

function toRows(result) {
  if (Array.isArray(result)) return result;
  return result && Array.isArray(result.results) ? result.results : [];
}

/** Insere apenas as ferramentas ausentes. Nunca sobrescreve o que o dono ajustou. */
export async function seedTools(db) {
  const now = Date.now();
  for (const t of DEFAULT_TOOLS) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO tools (id, project_id, name, kind, min_plan, status, position, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(t.id, t.projectId, t.name, t.kind, t.minPlan, t.status, t.position, t.note, now)
      .run();
  }
}

function rowToTool(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    minPlan: row.min_plan,
    minPlanLabel: PLAN_LABEL[row.min_plan] || row.min_plan,
    status: row.status,
    published: row.status === 'published',
    blocked: row.status === 'blocked',
    position: row.position,
    note: row.note || '',
    updatedAt: row.updated_at,
  };
}

export async function listTools(db) {
  const rows = await db.prepare('SELECT * FROM tools ORDER BY position ASC, name ASC').all();
  return toRows(rows).map(rowToTool);
}

export async function getTool(db, id) {
  const row = await db.prepare('SELECT * FROM tools WHERE id = ?').bind(String(id || '')).first();
  return rowToTool(row);
}

/**
 * Decide o acesso de uma pessoa a uma ferramenta.
 * `auth` = { authenticated, role, plan } onde plan é o código canônico
 * ('free' | 'pro' | null). Admin passa sempre.
 */
export function hasToolAccess(tool, auth = {}) {
  if (!tool) {
    // Ferramenta desconhecida: não inventar acesso. Fechado.
    return { allowed: false, reason: 'unknown_tool', code: 404 };
  }
  if (auth.role === 'admin') {
    return { allowed: true, reason: 'admin', code: 200 };
  }
  if (tool.status === 'blocked') {
    return { allowed: false, reason: 'blocked', code: 403 };
  }
  if (tool.status !== 'published') {
    return { allowed: false, reason: 'not_published', code: 403 };
  }
  const required = tool.minPlan in PLAN_RANK ? tool.minPlan : 'free';
  if (required === 'guest') {
    return { allowed: true, reason: 'guest', code: 200 };
  }
  if (!auth.authenticated) {
    return { allowed: false, reason: 'login_required', code: 401 };
  }
  const owned = auth.plan === 'pro' ? 'pro' : 'free';
  if (PLAN_RANK[owned] < PLAN_RANK[required]) {
    return { allowed: false, reason: 'upgrade_required', code: 403 };
  }
  return { allowed: true, reason: owned, code: 200 };
}

/** Fields that an admin is allowed to change. Anything else is ignored. */
const PATCHABLE = { minPlan: 'min_plan', status: 'status', name: 'name', note: 'note', position: 'position' };

/** Fields that the admin UI may send, mapped to columns. */
export const TOOL_PATCH_FIELDS = PATCHABLE;

export async function updateTool(db, id, patch = {}, actorEmail = null) {
  const sets = [];
  const binds = [];
  for (const [key, column] of Object.entries(PATCHABLE)) {
    if (patch[key] === undefined) continue;
    let value = patch[key];
    if (column === 'min_plan') {
      value = String(value || '').toLowerCase();
      if (!(value in PLAN_RANK)) return { error: `Plano inválido: use ${Object.keys(PLAN_RANK).join(', ')}.` };
    } else if (column === 'status') {
      value = String(value || '').toLowerCase();
      if (!TOOL_STATUSES.includes(value)) return { error: `Status inválido: use ${TOOL_STATUSES.join(', ')}.` };
    } else if (column === 'position') {
      value = Number(value);
      if (!Number.isFinite(value)) return { error: 'Posição inválida.' };
    } else {
      value = String(value).slice(0, 500);
    }
    sets.push(`${column} = ?`);
    binds.push(value);
  }
  if (!sets.length) return { error: 'Nada para atualizar.' };

  const now = Date.now();
  await db.prepare(`UPDATE tools SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...binds, now, String(id)).run();
  await recordAudit(db, actorEmail, 'tool.update', String(id), JSON.stringify(patch));
  return { tool: await getTool(db, id) };
}

export async function recordAudit(db, actorEmail, action, target, detail) {
  try {
    await db
      .prepare('INSERT INTO admin_audit (id, actor_email, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), actorEmail || null, action, target || null, detail || null, Date.now())
      .run();
  } catch {
    // Auditoria é best-effort: nunca deve derrubar a ação principal.
  }
}

export async function listAudit(db, limit = 100) {
  const rows = await db.prepare('SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT ?').bind(Number(limit) || 100).all();
  return toRows(rows);
}
