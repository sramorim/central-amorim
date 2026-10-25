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
import { socialLinks, projects, categories, platformLabels } from '../src/js/data.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

test('socialLinks contém os 5 canais oficiais da referência (sem GitHub)', async () => {
  assert.equal(socialLinks.length, 5);
  const names = socialLinks.map((s) => s.name.toLowerCase()).sort();
  assert.deepEqual(names, ['facebook', 'instagram', 'telegram', 'whatsapp', 'x']);
  assert.equal(socialLinks.some((s) => /github/.test(s.name.toLowerCase())), false);
});

test('cada canal possui url, label e icon https válidos', () => {
  for (const link of socialLinks) {
    assert.ok(link.url, `${link.name} deve ter url`);
    assert.ok(link.label, `${link.name} deve ter label`);
    assert.ok(link.icon, `${link.name} deve ter icon`);
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

test('home é a vitrine oficial: logo, a frase e UM botão para o Portal', () => {
  const html = read('index.html');
  assert.match(html, /central-vitrine\.jpg/, 'home deve exibir a arte oficial da vitrine');
  assert.match(html, /ECOSSISTEMA SR\.AMORIM/, 'home deve ter a linha do ecossistema');
  assert.match(html, /<em>construindo\.<\/em>/, 'a frase da referência, com "construindo." em destaque');
  const portal = html.match(/href="https:\/\/portal\.senhoramorim\.com\.br"/g) ?? [];
  assert.equal(portal.length, 1, 'home deve ter exatamente um botão para o Portal');
  assert.match(html, /Daniel Amorim/, 'home deve ter a assinatura');
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

test('index.html é a vitrine (páginas de conta seguem existindo)', () => {
  const html = read('index.html');
  assert.match(html, /central-portal/, 'vitrine deve ter o botão do Portal');
  for (const page of ['entrar.html', 'planos.html']) {
    assert.ok(read(page).length > 500, `${page} deve continuar existindo`);
  }
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
/* ---------- Catálogo: taxonomia e clareza dos cards ---------- */

test('todo projeto pertence a um grupo da taxonomia', () => {
  const ids = categories.map((c) => c.id);
  assert.ok(ids.length > 0, 'a taxonomia não pode estar vazia');
  assert.equal(new Set(ids).size, ids.length, 'ids de categoria duplicados');
  for (const p of projects) {
    assert.ok(p.group, `${p.name} precisa declarar group`);
    assert.ok(ids.includes(p.group), `${p.name} tem group "${p.group}" fora da taxonomia`);
    assert.equal(typeof p.category, 'string', `${p.name} precisa do rótulo visível`);
  }
});

test('todo projeto tem resumo curto e descrição', () => {
  for (const p of projects) {
    assert.ok(p.summary, `${p.name} precisa de summary`);
    assert.ok(p.description, `${p.name} precisa de description`);
    assert.ok(p.summary.length <= 90, `${p.name}: summary deve ser curto (1 linha)`);
    assert.ok(p.summary.length < p.description.length, `${p.name}: summary deve ser menor que a descrição`);
  }
});

test('nenhum projeto aparece em dois grupos (filtros não duplicam)', () => {
  for (const c of categories) {
    const list = projects.filter((p) => p.group === c.id);
    assert.equal(new Set(list.map((p) => p.id)).size, list.length, `duplicado em ${c.label}`);
  }
  // Toda ferramenta cai em exatamente um grupo e nenhum grupo some do catálogo.
  const total = categories.reduce((n, c) => n + projects.filter((p) => p.group === c.id).length, 0);
  assert.equal(total, projects.length, 'toda ferramenta deve estar em um grupo');
});

test('plataformas declaradas são rótulos conhecidos', () => {
  for (const p of projects) {
    assert.ok(Array.isArray(p.platforms) && p.platforms.length, `${p.name} precisa de platforms`);
    for (const id of p.platforms) {
      assert.ok(platformLabels[id], `plataforma "${id}" de ${p.name} não tem rótulo`);
    }
  }
});

test('ids e nomes de projeto são únicos', () => {
  assert.equal(new Set(projects.map((p) => p.id)).size, projects.length, 'ids duplicados');
  assert.equal(new Set(projects.map((p) => p.name)).size, projects.length, 'nomes duplicados');
});

test('nenhuma ferramenta éplaceholder de link vazio', () => {
  for (const p of projects) {
    assert.ok(p.url && p.url !== '#', `${p.name} sem url`);
    assert.ok(p.urlLabel, `${p.name} sem urlLabel`);
  }
  for (const s of socialLinks) {
    assert.doesNotMatch(s.url, /wa\.me\/$/, `${s.name} aponta para link sem número`);
  }
});
