/**
 * CENTRAL AMORIM — Links oficiais e estrutura das páginas.
 *
 * Garante a regra de canais oficiais: sem GitHub na seção "Conecte-se",
 * Instagram e WhatsApp presentes, e que as páginas novas expõem âncoras
 * de conta/navegação esperadas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { socialLinks } from '../src/js/data.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

test('socialLinks contém apenas Instagram e WhatsApp (sem GitHub)', async () => {
  assert.equal(socialLinks.length, 2);
  const names = socialLinks.map((s) => s.name.toLowerCase()).sort();
  assert.deepEqual(names, ['instagram', 'whatsapp']);
  assert.equal(socialLinks.some((s) => /github/.test(s.name.toLowerCase())), false);
});

test('cada canal possui url, label, icon e updatedAt', () => {
  for (const link of socialLinks) {
    assert.ok(link.url, `${link.name} deve ter url`);
    assert.ok(link.label, `${link.name} deve ter label`);
    assert.ok(link.icon, `${link.name} deve ter icon`);
    assert.ok(link.updatedAt, `${link.name} deve ter updatedAt`);
    assert.match(link.url, /^https:\/\//, `${link.name} deve usar https`);
  }
});

test('contato.html não referencia GitHub e tem o cartão de conta', () => {
  const html = read('contato.html');
  assert.ok(!/github/i.test(html), 'contato.html não deve mencionar GitHub');
  assert.match(html, /instagram\.com/);
  assert.match(html, /wa\.me/);
  assert.match(html, /Minha conta/);
});

test('data.js não contém referência a GitHub', () => {
  const src = read('src/js/data.js');
  assert.ok(!/github/i.test(src), 'data.js não deve conter GitHub');
});

test('páginas novas existem e expõem o slot de autenticação', () => {
  for (const page of ['entrar', 'criar-conta', 'recuperar-senha', 'planos', 'minha-conta']) {
    const file = `${page}.html`;
    const html = read(file);
    assert.ok(html.length > 500, `${file} deve ter conteúdo real`);
    assert.match(html, /data-auth/, `${file} deve conter o slot de auth`);
    assert.match(html, /<title>/, `${file} deve ter <title>`);
  }
});

test('formulário de registro chama o endpoint de registro', () => {
  const html = read('criar-conta.html');
  assert.match(html, /\/api\/auth\/register/);
});

test('ferramentas.html existe com busca, filtro e grid', () => {
  const html = read('ferramentas.html');
  assert.ok(html.length > 500, 'página deve ter conteúdo real');
  assert.match(html, /<title>Todas as Ferramentas/, 'deve ter title do catálogo');
  assert.match(html, /tools-search/, 'deve ter campo de busca');
  assert.match(html, /tools-grid/, 'deve ter grid de ferramentas');
  assert.match(html, /ferramentas\.js/, 'deve carregar o script do catálogo');
});

test('home linka a página todas as ferramentas', () => {
  const html = read('index.html');
  assert.match(html, /\/ferramentas/, 'home deve ter link para /ferramentas');
});

test('vite.config registra a rota ferramentas', () => {
  const cfg = read('vite.config.js');
  assert.match(cfg, /ferramentas: resolve\(__dirname, 'ferramentas\.html'\)/);
});

test('entrar.html chama login e probe de Google', () => {
  const html = read('entrar.html');
  assert.match(html, /\/api\/auth\/login/);
  assert.match(html, /\/api\/auth\/probe-google/);
});

test('minha-conta.html exige autenticação', () => {
  const js = read('minha-conta.html');
  assert.match(js, /api\/auth\/logout/);
  assert.match(js, /requireAuth/);
  assert.match(js, /apiGet/);
});

test('index.html navega para /entrar e /planos', () => {
  const html = read('index.html');
  assert.match(html, /href="\/entrar"/);
  assert.match(html, /href="\/planos"/);
});

test('vite.config.js inclui todas as páginas', () => {
  const cfg = read('vite.config.js');
  for (const key of ['entrar', 'criar-conta', 'recuperar-senha', 'planos', 'minha-conta']) {
    assert.match(cfg, new RegExp(key), `vite deve ter input ${key}`);
  }
});

test('.gitignore protege .env e .wrangler', () => {
  const gi = read('.gitignore');
  assert.match(gi, /\.env/);
  assert.match(gi, /\.wrangler/);
});

test('.env.example documenta as variáveis de produção', () => {
  const env = read('.env.example');
  for (const key of ['PUBLIC_ORIGIN', 'COOKIE_DOMAIN', 'COOKIE_SECURE', 'ADMIN_EMAILS', 'GOOGLE_CLIENT_ID', 'RESEND_API_KEY']) {
    assert.match(env, new RegExp(key), `.env.example deve documentar ${key}`);
  }
});