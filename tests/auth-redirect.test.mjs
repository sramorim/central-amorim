/**
 * afterAuthDestination() — para onde a pessoa vai depois de entrar.
 *
 * A função existe há um tempo e validava com startsWith('/'). Isso não segura
 * '//evil.com' nem '/\evil.com': os dois passam no teste e o location.assign
 * manda o navegador para fora do domínio logo DEPOIS de autenticar, o que é a
 *receita clássica de phishing ("entra com segurança e cai numa tela falsa").
 * O portão de /admin passou a gerar esse ?next=, então a validação passou a
 * ter consequência real e ganhou teste.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ORIGIN = 'https://senhoramorim.com.br';

/* O módulo de auth é de navegador: importa com window em volta. */
let afterAuthDestination;
let originalLocation;

before(async () => {
  originalLocation = globalThis.location;
  globalThis.location = { search: '', href: ORIGIN, origin: ORIGIN };
  ({ afterAuthDestination } = await import('../src/js/auth.js'));
});

after(() => {
  globalThis.location = originalLocation;
});

function comSearch(search) {
  globalThis.location.search = search;
  return afterAuthDestination();
}

test('sem next, vai para a conta', () => {
  assert.equal(comSearch(''), '/minha-conta');
  assert.equal(comSearch('?email=a@b.com'), '/minha-conta');
});

test('next interno é respeitado (é o que faz voltar ao /admin)', () => {
  assert.equal(comSearch('?next=%2Fadmin'), '/admin');
  assert.equal(comSearch('?next=%2Fadmin%3Faba%3Dcontas'), '/admin?aba=contas');
});

test('next apontando para fora do domínio é recusado', () => {
  const ataques = [
    '?next=//evil.com',
    '?next=//evil.com/painel',
    '?next=/\\evil.com',
    '?next=https://evil.com',
    '?next=http://evil.com',
    '?next=javascript:alert(1)',
    '?next=data:text/html,<script>alert(1)</script>',
    '?next=admin',
    '?next=',
  ];
  for (const search of ataques) {
    const destino = comSearch(search);
    assert.equal(destino, '/minha-conta', `${search} passou como ${destino}`);
    assert.ok(!/^[a-z]+:/i.test(destino), `${search} virou um esquema externo`);
  }
});

test('o destino final nunca sai do domínio, venha o que vier', () => {
  for (const search of ['?next=//evil.com', '?next=/\\evil.com', '?next=https://evil.com', '?next=/admin']) {
    const destino = comSearch(search);
    const resolvido = new URL(destino, ORIGIN);
    assert.equal(resolvido.origin, ORIGIN, `${search} escapou para ${resolvido.origin}`);
  }
});
