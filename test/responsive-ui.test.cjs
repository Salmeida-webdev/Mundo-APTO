const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const styles = fs.readFileSync(path.join(root, 'apps-script/Styles.html'), 'utf8');
const index = fs.readFileSync(path.join(root, 'apps-script/Index.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'apps-script/Client.html'), 'utf8');

test('identidade visual está presente na entrada, na navegação e no cabeçalho móvel', () => {
  assert.equal((index.match(/class="brand-logo brand-logo-login"/g) || []).length, 2);
  assert.equal((index.match(/class="brand-logo brand-logo-sidebar"/g) || []).length, 1);
  assert.equal((index.match(/class="brand-logo brand-logo-header"/g) || []).length, 1);
  assert.match(styles, /--orange:#EE7A00/);
  assert.match(styles, /--orange-dark:#B85A00/);
});

test('há regras distintas para tablet, mobile e telas estreitas', () => {
  assert.match(styles, /@media\(min-width:761px\) and \(max-width:900px\)/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /@media\(max-width:480px\)/);
  assert.match(styles, /@media\(max-width:360px\)/);
});

test('navegação mobile preserva espaço para marca segura e alvos de toque', () => {
  assert.match(styles, /@media\(max-width:760px\)\{[\s\S]*?\.sidebar-brand\{display:none\}/);
  assert.match(styles, /\.sidebar\{height:calc\(63px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(styles, /\.nav-item\{min-width:0;min-height:48px/);
});

test('dashboard se reorganiza em duas colunas de indicadores e funil legível no mobile', () => {
  assert.match(styles, /\.kpi-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(styles, /\.funnel-name\{white-space:normal;overflow:visible;text-overflow:clip/);
  assert.match(styles, /\.ranking-table\{table-layout:fixed\}/);
});

test('tabelas mantêm rolagem horizontal e filtros de celular evitam zoom automático', () => {
  assert.match(styles, /\.table-scroll\{-webkit-overflow-scrolling:touch/);
  assert.match(styles, /\.filter-search\{flex:1 1 100%\}/);
  assert.match(styles, /\.filter-field input,\.filter-field select,\.field input,\.field select,\.field textarea\{font-size:16px\}/);
});

test('controles têm destaque de foco visível e respeitam movimento reduzido', () => {
  assert.match(styles, /:focus-visible\{outline:3px solid/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});

test('ficha do cliente oferece histórico de contatos e encaixa a linha do tempo no modal', () => {
  assert.match(client, /Histórico de contatos do SDR/);
  assert.match(client, /apiGetSdrHistory/);
  assert.match(client, /Registrar contato/);
  assert.match(styles, /\.sdr-history-list\{display:grid;gap:9px;max-height:330px;overflow:auto/);
});
