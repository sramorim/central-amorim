/**
 * CENTRAL AMORIM — Cloudflare Worker entry.
 *
 * Serves both the static assets (dist/) and the auth/access API backed by D1.
 * The same `createApp` handler is exercised directly by the test-suite
 * (against node:sqlite), so production code is the tested code.
 */
import { createApp } from './backend/app.js';

const API_PREFIX = '/api/';

// Compat redirects for renamed tool pages.
const REDIRECTS = {
  '/facebook': '/sonda',
  '/atividade': '/panorama',
  '/whatsapp': '/sentinela',
};

/* The admin panel is served straight from the assets bucket, bypassing every API
   handler. These three spellings are the same page, so they all get gated. */
const ADMIN_PAGES = new Set(['/admin', '/admin/', '/admin.html']);

/* Blocked page. Self-contained on purpose: no stylesheet, no site assets, and
   no hint about the account that tried to get in. */
const BLOCKED_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Acesso restrito — Central Amorim</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0f;color:#e8e8ef;
       font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .card{max-width:34rem;padding:2.5rem;text-align:center}
  h1{font-size:1.35rem;margin:0 0 .75rem}
  p{margin:0 0 1.25rem;color:#a3a3b2}
  a{display:inline-block;padding:.7rem 1.4rem;border-radius:8px;background:#7c5cff;color:#fff;
    text-decoration:none;font-weight:600}
</style>
</head>
<body>
  <main class="card">
    <h1>Acesso restrito</h1>
    <p>Esta área é exclusiva de administradores. Se você acha que é um engano, entre na sua conta e tente de novo.</p>
    <a href="/entrar">Entrar</a>
  </main>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = REDIRECTS[url.pathname];
    if (target) {
      return Response.redirect(url.origin + target, 301);
    }

    // API routes are handled by the auth/access backend.
    if (url.pathname.startsWith(API_PREFIX)) {
      const app = createApp({ db: env.DB, env });
      return app.fetch(request);
    }

    /* Panel: the HTML is only served after the session clears the server-side
       check. No session -> 302 to login carrying `next` so the person lands
       back here. Logged in without role=admin -> 403, revealing nothing. */
    if (ADMIN_PAGES.has(url.pathname)) {
      const app = createApp({ db: env.DB, env });
      const denied = await app.adminPageGate(request);
      if (denied) {
        if (denied.status === 401) {
          return Response.redirect(`${url.origin}/entrar?next=${encodeURIComponent('/admin')}`, 302);
        }
        return new Response(BLOCKED_HTML, {
          status: denied.status,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'x-robots-tag': 'noindex, nofollow',
          },
        });
      }
    }

    // Static assets are served from the ASSETS binding (dist/).
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
    }

    return new Response('Não encontrado', { status: 404 });
  },
};