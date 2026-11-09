const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const scriptsDir = path.join(root, 'apps-script');

test('todos os arquivos de servidor têm sintaxe JavaScript válida', () => {
  for (const file of fs.readdirSync(scriptsDir).filter((name) => name.endsWith('.gs'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(scriptsDir, file), 'utf8'), { filename:file }), file);
  }
});

test('interface não acessa a planilha diretamente nem contém token/ID de implantação fixo', () => {
  const client = fs.readFileSync(path.join(scriptsDir, 'Client.html'), 'utf8');
  const index = fs.readFileSync(path.join(scriptsDir, 'Index.html'), 'utf8');
  assert.doesNotMatch(client, /SpreadsheetApp|CRM_SPREADSHEET_ID|ScriptApp|getOAuthToken/);
  assert.doesNotMatch(index + client, /AIza[0-9A-Za-z_-]{30,}|1[A-Za-z0-9_-]{30,}/);
  assert.match(client, /sessionStorage\.setItem\('crm-session-token'/);
  assert.match(client, /textContent/);
});

test('endpoints que leem ou alteram dados validam sessão no servidor', () => {
  const source = fs.readFileSync(path.join(scriptsDir, 'Code.gs'), 'utf8');
  const guarded = [
    ['apiChangePassword', 'actorForToken_'], ['apiGetReferenceData', 'actorForToken_'], ['apiGetDashboard', 'actorForToken_'],
    ['apiListLeads', 'actorForToken_'], ['apiGetSdrHistory', 'canReadLead'], ['apiSaveLead', 'actorForToken_'], ['apiListUsers', 'requireAdmin_'],
    ['apiSaveUser', 'requireAdmin_'], ['apiResetUserPassword', 'requireAdmin_'], ['apiApplySharedTemporaryPassword', 'actorForToken_']
  ];
  for (const [name, guard] of guarded) {
    const start = source.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, `${name} deve existir`);
    const next = source.indexOf('\nfunction ', start + 1);
    const body = source.slice(start, next < 0 ? source.length : next);
    assert.ok(body.includes(guard), `${name} deve aplicar ${guard}`);
  }
});

test('manifesto solicita e-mail para identificar o executor e evita escopo de interface desnecessário', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(scriptsDir, 'appsscript.json'), 'utf8'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/userinfo.email'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.storage'));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.scriptapp'));
  assert.ok(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.container.ui'));
});

test('usuário de implantação recebe ID calculado sem colisão fixa no cadastro inicial', () => {
  const repository = fs.readFileSync(path.join(scriptsDir, 'Repository.gs'), 'utf8');
  assert.match(repository, /nextUserId_\(initialUsers\)/);
  assert.doesNotMatch(repository, /id\s*:\s*['"]U021['"]/);
});

test('senha inicial compartilhada exige gestão, exclui a sessão executora e só armazena hashes', () => {
  const source = fs.readFileSync(path.join(scriptsDir, 'Code.gs'), 'utf8');
  const start = source.indexOf('function apiApplySharedTemporaryPassword(');
  const next = source.indexOf('\nfunction ', start + 1);
  const body = source.slice(start, next < 0 ? source.length : next);
  assert.match(body, /requireAdmin_\(actor\)/);
  assert.match(body, /String\(user\.id\) !== String\(actor\.id\)/);
  assert.match(body, /hashPassword_\(password, salt, iterations\)/);
  assert.match(body, /user\.mustChangePassword = true/);
  assert.doesNotMatch(body, /console\.(?:log|error).*password/i);
});
