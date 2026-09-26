/**
 * CENTRAL AMORIM — Parser de conversas do WhatsApp exportadas (.txt).
 *
 * Extrai as funções reais (clean + parseChat) do HTML da ferramenta
 * SENTINELA e valida o comportamento nos formatos oficiais de exportação:
 * iOS, Android 24h/12h, continuação de mensagem, mídia omitida,
 * mensagens de sistema (sender null) e contatos não salvos (número cru).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'sentinela.html'), 'utf8');

const from = html.indexOf('function clean(');
const to = html.indexOf('var MEDIA_RE');
assert.ok(from > 0 && to > from, 'parseChat/clean não encontrados no sentinela.html');
const chunk = html.slice(from, to);
const factory = new Function(chunk + '; return { clean, parseChat };');
const { parseChat } = factory();

function first(text) {
  const out = parseChat(text);
  assert.ok(out.length >= 1, 'nenhuma mensagem parseada');
  return out[0];
}

test('iOS — contato salvo com nome', () => {
  const m = first('[12/02/24, 20:30:15] João Silva: bom dia 🎉');
  assert.equal(m.sender, 'João Silva');
  assert.equal(m.body, 'bom dia 🎉');
  assert.equal(m.d.getDate(), 12);
  assert.equal(m.d.getMonth(), 1);
  assert.equal(m.d.getFullYear(), 2024);
  assert.equal(m.d.getHours(), 20);
  assert.equal(m.d.getMinutes(), 30);
  assert.equal(m.d.getSeconds(), 15);
});

test('iOS — contato não salvo: número cru como remetente', () => {
  const m = first('[12/02/24, 20:31:05] +55 11 91234-5678: olá tudo bem');
  assert.equal(m.sender, '+55 11 91234-5678');
  assert.equal(m.body, 'olá tudo bem');
});

test('Android 24h — clássico com hífen', () => {
  const m = first('12/02/2024, 20:30:15 - Maria: como vai?');
  assert.equal(m.sender, 'Maria');
  assert.equal(m.body, 'como vai?');
  assert.equal(m.d.getHours(), 20);
});

test('Android 12h — PM vira 24h', () => {
  const m = first('12/02/2024, 8:00:02 PM - Pedro: boa noite');
  assert.equal(m.sender, 'Pedro');
  assert.equal(m.d.getHours(), 20);
});

test('Android 12h — meia-noite (12 AM vira 0h)', () => {
  const m = first('12/02/2024, 12:00:02 AM - Teste: meia-noite');
  assert.equal(m.d.getHours(), 0);
});

test('continuação multiline anexa ao corpo da mensagem anterior', () => {
  const out = parseChat('12/02/2024, 20:30:15 - Maria: linha um\nsegunda linha continua\n12/02/2024, 20:31:00 - Maria: nova');
  assert.equal(out.length, 2);
  assert.equal(out[0].body, 'linha um segunda linha continua');
});

test('mídia omitida vira corpo da mensagem', () => {
  const m = first('12/02/2024, 20:31:00 - Maria: <Media omitted>');
  assert.equal(m.sender, 'Maria');
  assert.equal(m.body, '<Media omitted>');
});

test('mensagem de sistema — sem remetente (sender null)', () => {
  const m = first('[12/01/24, 19:00:02] Fulano entrou no grupo');
  assert.equal(m.sender, null);
  assert.equal(m.body, 'Fulano entrou no grupo');
});

test('mensagens de sistema não viram participantes', () => {
  const out = parseChat(
    '[12/01/24, 19:00:01] Fulano criou o grupo "Teste"\n' +
      '[12/01/24, 19:00:02] Ciclano entrou no grupo\n' +
      '[12/01/24, 19:00:30] Fulano: salve galera\n'
  );
  const senders = out.filter((m) => m.sender).map((m) => m.sender);
  assert.deepEqual(senders, ['Fulano']);
});

test('iOS EN — mensagem de sistema de criptografia ignorada', () => {
  const m = first('[12/01/24, 19:00:02] Messages and calls are end-to-end encrypted.');
  assert.equal(m.sender, null);
  assert.ok(m.body.startsWith('Messages and calls'));
});