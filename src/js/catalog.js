/* ---------- Catálogo de ferramentas (fonte de verdade: servidor) ---------- *
 * Quem manda em "publicado / gratuito / pago / bloqueado" é a Central, via
 * GET /api/tools. Antes o controle vivia só no array local de data.js: o site
 * mostrava todo mundo como publicado e o botão abria igual para visitante e
 * para cliente pago — a UI e a API discordavam.
 *
 * Regra de ouro: o cadeado é UX, nunca segurança. Se esta chamada falhar, o
 * site continua mostrando tudo como estava (fallback), para uma falha de rede
 * não deixar o site inteiro cadeado. Quem barra de verdade é a API.          */
import { projects as fallbackProjects } from './data.js';

/* Plano mínimo de cada projeto, usado só como fallback offline. Espelha
   DEFAULT_TOOLS em src/backend/tools.js — o servidor é quem manda. */
const FALLBACK_MIN_PLAN = {
  'shandon-elite': 'pro',
  'amorim-osint': 'free',
  'amorim-follow': 'guest',
  'ig-radar': 'guest',
  sonda: 'guest',
  panorama: 'guest',
  sentinela: 'guest',
};

const NEEDS_LOGIN = 'login_required';
const NEEDS_UPGRADE = 'upgrade_required';

let catalog = null;      // Map id -> { access, status, minPlan }
let authed = false;
let isAdmin = false;

async function loadCatalog() {
  try {
    const res = await fetch('/api/tools', {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.tools)) return null;
    catalog = new Map(data.tools.map((t) => [t.id, t]));
    authed = Boolean(data.authenticated);
    isAdmin = Boolean(data.isAdmin);
    return catalog;
  } catch {
    return null;
  }
}

function stateFor(project) {
  if (!catalog) {
    return { status: project.status || 'published', visible: true, locked: false, minPlan: FALLBACK_MIN_PLAN[project.id] || 'guest' };
  }
  const entry = catalog.get(project.id);
  if (!entry) {
    // Ferramenta que o servidor não conhece: não some do site (não removemos
    // ferramenta existente), mas fica marcada como não disponível.
    return { status: 'published', visible: true, locked: false, minPlan: FALLBACK_MIN_PLAN[project.id] || 'guest' };
  }
  const minPlan = entry.minPlan || 'free';
  return {
    status: entry.status,
    visible: entry.visible !== false,
    locked: !entry.access || entry.access.allowed !== true,
    reason: entry.access ? entry.access.reason : null,
    minPlan,
  };
}

const STATUS_LABEL = {
  published: 'Publicado',
  draft: 'Rascunho',
  blocked: 'Indisponível',
};

const UPGRADE_NOTE = {
  pro: 'Disponível no plano PRO',
  free: 'Crie uma conta gratuita para usar',
  guest: 'Acesso livre',
};

function lockBadge(state) {
  if (state.status === 'blocked') return '<span class="project-lock project-lock--blocked">Indisponível</span>';
  if (state.status === 'draft' && isAdmin) return '<span class="project-lock project-lock--draft">Rascunho</span>';
  if (state.status !== 'published') return '';
  if (!state.locked) return '';
  if (state.reason === NEEDS_LOGIN) {
    return '<span class="project-lock" title="Crie uma conta gratuita para liberar">🔒 Cadastro necessário</span>';
  }
  if (state.reason === NEEDS_UPGRADE) {
    return '<span class="project-lock" title="Disponível no plano PRO">🔒 Plano PRO</span>';
  }
  return '<span class="project-lock">🔒 Bloqueado</span>';
}

function actionFor(project, state) {
  const label = project.urlLabel || 'Abrir';
  if (!state.locked) {
    return `<a href="${project.url}" class="btn btn-${project.buttonStyle}" data-tool-link="${project.id}">${label}</a>`;
  }
  const isPro = state.reason === NEEDS_UPGRADE;
  const href = '/entrar?next=' + encodeURIComponent(project.url);
  const cta = isPro ? 'Ver planos' : 'Entrar para liberar';
  return `<a href="${href}" class="btn btn-locked" data-tool-locked="${project.id}" data-reason="${state.reason || ''}">🔒 ${cta}</a>
          <span class="project-lock-note">${UPGRADE_NOTE[state.minPlan] || ''}</span>`;
}

/** Card de projeto, idêntico ao anterior quando a ferramenta está liberada. */
export function projectCard(project) {
  const state = stateFor(project);
  if (!state.visible) return '';
  const status = state.status === 'published' ? 'published' : state.status;
  const statusLabel = STATUS_LABEL[status] || project.statusLabel;
  return `
    <article class="project-card${project.featured ? ' project-card--featured' : ''}${state.locked ? ' project-card--locked' : ''}" data-project="${project.id}">
      <div class="project-card-top">
        <div class="project-icon" aria-hidden="true">${project.icon}</div>
        <span class="project-status status-${status}">${statusLabel}</span>
      </div>
      ${project.featured ? '<span class="project-pin">Principal</span>' : ''}
      <h3 class="project-name">${project.name}</h3>
      <span class="project-category">${project.category}</span>
      <p class="project-summary">${project.summary || ''}</p>
      <p class="project-description">${project.description}</p>
      ${lockBadge(state)}
      ${actionFor(project, state)}
    </article>`;
}

/**
 * Carrega o catálogo e chama `render()` com a lista de projetos.
 * `projects` continua vindo de data.js (apresentação: ícone, texto, ordem).
 */
export async function mountCatalog(render, projects = fallbackProjects) {
  await loadCatalog();
  render(projects);
}

/** Estado atual, para páginas que precisam reagir (ex.: minha-conta). */
export function catalogState() {
  return { loaded: Boolean(catalog), authed, isAdmin };
}
