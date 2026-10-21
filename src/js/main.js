/**
 * CENTRAL AMORIM — JS mínimo.
 * A página é estática; isto só serve métricas de clique (invisíveis)
 * e garante que links com âncora façam scroll suave.
 */

document.addEventListener('DOMContentLoaded', () => {
  initClickMetrics();
  initSmoothScroll();
});

/* ---------- Métricas de cliques (invisível: não muda o visual) ---------- */
function initClickMetrics() {
  document.addEventListener('click', (ev) => {
    const link = ev.target.closest('a[href]');
    if (!link) return;
    const target = (link.getAttribute('href') || link.getAttribute('aria-label') || 'desconhecido').slice(0, 120);
    const kind = link.classList.contains('central-portal') ? 'portal' : 'social';
    const body = JSON.stringify({ target, kind });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/metrics/click', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/metrics/click', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
      }
    } catch { /* métrica nunca pode quebrar o clique */ }
  });
}

/* ---------- Smooth Scroll para âncoras ---------- */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const id = anchor.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}