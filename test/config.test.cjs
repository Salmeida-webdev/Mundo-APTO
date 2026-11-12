const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config/seed-data.json'), 'utf8'));

test('configuração pública não contém nomes/e-mails de usuários nem dados de clientes', () => {
  assert.deepEqual(config.users, []);
  assert.equal(config.ownerEmail, '');
  const source = fs.readFileSync(path.join(root, 'config/seed-data.json'), 'utf8');
  assert.doesNotMatch(source, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(source, /service_role\s*[:=]\s*['"][^'"]{16,}/i);
});

test('dados comerciais detalhados não são publicados; papéis, paleta e os dez status permanecem', () => {
  assert.deepEqual(config.developments, []);
  assert.deepEqual(config.statuses.map((item) => item.name), [
    'Em atendimento','Atendimento agendado','Desistência','Atendimento realizado','Já comprou',
    'Em contato','Enviando documentação','Em análise documental','Aprovado pela Caixa','Reprovado pela Caixa'
  ]);
  assert.ok(config.statuses.every((item) => /^#[0-9A-F]{6}$/i.test(item.color)));
  assert.deepEqual(config.roles, ['Administrador','Gerente','Coordenador','Assistente','SDR','Corretor']);
  assert.equal(config.identity.primary, '#93651D');
  assert.equal(config.identity.primaryDark, '#76502A');
});
