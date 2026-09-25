/**
 * CENTRAL AMORIM — Cloudflare Worker entry.
 *
 * Serves both the static assets (dist/) and the auth/access API backed by D1.
 * The same `createApp` handler is exercised directly by the test-suite
 * (against node:sqlite), so production code is the tested code.
 */
import { createApp } from './backend/app.js';

const API_PREFIX = '/api/';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API routes are handled by the auth/access backend.
    if (url.pathname.startsWith(API_PREFIX)) {
      const app = createApp({ db: env.DB, env });
      return app.fetch(request);
    }

    // Static assets are served from the ASSETS binding (dist/).
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
    }

    return new Response('Não encontrado', { status: 404 });
  },
};