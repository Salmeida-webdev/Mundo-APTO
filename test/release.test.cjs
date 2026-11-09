const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('pacote de homologação é privado e produção exige conta Google', () => {
  const staging = JSON.parse(fs.readFileSync(path.join(root, 'release/staging/appsscript.json'), 'utf8'));
  const production = JSON.parse(fs.readFileSync(path.join(root, 'release/production/appsscript.json'), 'utf8'));
  assert.equal(staging.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(staging.webapp.access, 'MYSELF');
  assert.equal(production.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(production.webapp.access, 'ANYONE');
});

test('pacotes gerados contêm somente o código combinado e executam sintaticamente', () => {
  const files = ['Code.gs','Index.html','appsscript.json'];
  for (const environment of ['staging','production']) {
    const dir = path.join(root, 'release', environment);
    for (const file of files) assert.ok(fs.existsSync(path.join(dir,file)), `${environment}/${file} deve existir`);
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir,'Code.gs'),'utf8'), {filename:environment+'-Code.gs'}));
    const html = fs.readFileSync(path.join(dir,'Index.html'),'utf8');
    assert.doesNotMatch(html, /include_\('Styles'\)|include_\('Client'\)/);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length >= 1);
    for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script, {filename:environment+'-Index-script.js'}));
  }
});
