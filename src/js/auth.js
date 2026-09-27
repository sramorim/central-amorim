/* ---------- Central Amorim — auth.js ---------- *
 * Shared session/account helpers for all pages.   *
 * Session is a HttpOnly cookie set by the Worker; *
 * these helpers only render UI from /api/auth/me. */

const API_JSON = { accept: 'application/json', 'content-type': 'application/json' };

export async function apiPost(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: API_JSON,
      credentials: 'same-origin',
      body: typeof body === 'string' ? body : JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'Falha de conexão.' }, err };
  }
}

export async function apiGet(path) {
  try {
    const res = await fetch(path, { headers: API_JSON, credentials: 'same-origin' });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'Falha de conexão.' }, err };
  }
}

/* ---------- Header session UI ---------- */
/* Estado da sessão é sempre o que o servidor diz (/api/auth/me). Nada é
   guardado em localStorage: o cookie é HttpOnly e o navegador é a única fonte
   de verdade, então cache local só serviria para mostrar login em página
   deslogada. */

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function initialOf(user) {
  const name = String((user && user.name) || '').trim();
  return name ? name.charAt(0).toUpperCase() : '?';
}

export async function logout({ next = '/' } = {}) {
  await apiPost('/api/auth/logout', {});
  location.assign(next);
}

/* Desenha o estado no header e no menu mobile. Devolve o usuario para quem
   precisar reagir a isso (o catálogo de ferramentas usa). */
export async function renderAuthSlot() {
  const desktop = document.querySelector('[data-auth]');
  const mobile = document.querySelector('[data-auth-mobile]');
  if (!desktop && !mobile) return null;

  const { ok, data } = await apiGet('/api/auth/me');
  const authed = ok && data && data.authenticated;
  const user = authed ? data.user : null;
  const name = user ? String(user.name || '').trim() : '';
  const label = name.length > 16 ? `${name.slice(0, 15)}…` : name || 'Minha conta';

  const avatar = user
    ? (user.avatar
        ? `<img class="auth-chip-avatar" src="${escapeHtml(user.avatar)}" alt="" referrerpolicy="no-referrer">`
        : `<span class="auth-chip-avatar auth-chip-avatar--initial" aria-hidden="true">${escapeHtml(initialOf(user))}</span>`)
    : '';

  const planTag = user && !user.isAdmin
    ? `<span class="auth-chip-plan" data-plan-tag>${escapeHtml(user.planLabel || '')}</span>`
    : user && user.isAdmin
      ? '<span class="auth-chip-plan auth-chip-plan--admin" data-plan-tag>Admin</span>'
      : '';

  if (desktop) {
    desktop.innerHTML = authed
      ? `<span class="auth-chip auth-chip--user" data-kind="account">${avatar}<span class="auth-chip-name">${escapeHtml(label)}</span>${planTag}</span>
         <a href="/minha-conta" class="auth-chip" data-kind="account-link">Minha conta</a>
         <button type="button" class="auth-chip auth-chip--ghost" data-kind="logout">Sair</button>`
      : `<a href="/entrar" class="auth-chip" data-kind="login">Entrar</a><a href="/criar-conta" class="auth-chip auth-chip--primary" data-kind="register">Criar conta</a>`;
    const logoutBtn = desktop.querySelector('[data-kind="logout"]');
    if (logoutBtn) logoutBtn.addEventListener('click', () => logout());
  }

  if (mobile) {
    mobile.innerHTML = authed
      ? `<a class="nav-mobile-link" href="/minha-conta" style="min-height:0">${escapeHtml(label)}</a>
         <button type="button" class="nav-mobile-link nav-mobile-link--button" data-kind="logout" style="min-height:0">Sair</button>`
      : `<a class="nav-mobile-link" href="/entrar" style="min-height:0">Entrar</a>
         <a class="nav-mobile-link" href="/criar-conta" style="min-height:0">Criar conta</a>`;
    const logoutBtn = mobile.querySelector('[data-kind="logout"]');
    if (logoutBtn) logoutBtn.addEventListener('click', () => logout());
  }

  if (authed && user) {
    document.body.setAttribute('data-plan', user.plan);
    document.body.setAttribute('data-role', user.role || 'user');
    document.body.setAttribute('data-authenticated', 'true');
  } else {
    document.body.setAttribute('data-plan', 'VISITOR');
    document.body.setAttribute('data-role', 'guest');
    document.body.setAttribute('data-authenticated', 'false');
  }

  return user;
}

/* ---------- Protection ---------- */
export function redirectIfAuthed() {
  return apiGet('/api/auth/me').then(({ ok, data }) => {
    if (ok && data && data.authenticated) {
      const next = new URLSearchParams(location.search).get('next') || '/minha-conta';
      location.assign(next);
      return true;
    }
    return false;
  });
}

export async function requireAuth(next = '/minha-conta') {
  const { ok, data } = await apiGet('/api/auth/me');
  if (!ok || !data.authenticated) {
    const target = next && next !== '/' && !next.startsWith('/entrar') ? `/entrar?next=${encodeURIComponent(next)}` : '/entrar';
    location.assign(target);
    return { ok: false };
  }
  return { ok: true, data };
}

/* ---------- Form helpers ---------- */
export function showAlert(el, message, type = 'error') {
  if (!el) return;
  el.textContent = message || '';
  el.className = `form-alert form-alert--${type}`;
}

export function clearAlert(el) {
  if (el) el.className = 'form-alert';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(v) {
  const email = String(v || '').trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

export function validatePassword(v) {
  const p = String(v || '');
  return p.length >= 8 && p.length <= 128 ? p : null;
}

export function validateName(v) {
  const n = String(v || '').trim();
  return n.length >= 2 && n.length <= 80 ? n : null;
}

/* ---------- Redirect helper for login/register pages ---------- */
export function afterAuthDestination() {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') ? next : '/minha-conta';
}