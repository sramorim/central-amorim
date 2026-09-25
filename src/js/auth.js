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
export async function renderAuthSlot() {
  const desktop = document.querySelector('[data-auth]');
  const mobile = document.querySelector('[data-auth-mobile]');
  if (!desktop && !mobile) return;

  const { ok, data } = await apiGet('/api/auth/me');
  const authed = ok && data && data.authenticated;

  const desktopHtml = authed
    ? `<a href="/minha-conta" class="auth-chip auth-chip--user" data-kind="account"><span class="auth-chip-dot"></span>Minha conta</a>`
    : `<a href="/entrar" class="auth-chip" data-kind="login">Entrar</a><a href="/criar-conta" class="auth-chip auth-chip--primary" data-kind="register">Criar conta</a>`;

  const mobileHtml = authed
    ? `<a class="nav-mobile-link" href="/minha-conta" style="min-height:0">Minha conta</a>`
    : `<a class="nav-mobile-link" href="/entrar" style="min-height:0">Entrar</a>
       <a class="nav-mobile-link" href="/criar-conta" style="min-height:0">Criar conta</a>`;

  if (desktop) desktop.innerHTML = desktopHtml;
  if (mobile) mobile.innerHTML = mobileHtml;

  if (authed && data.user) {
    document.body.setAttribute('data-plan', data.user.plan);
    document.body.setAttribute('data-authenticated', 'true');
  }
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