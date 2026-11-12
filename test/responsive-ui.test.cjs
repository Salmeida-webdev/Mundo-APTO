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

test('alertas do SDR aparecem no topo do dashboard com destaque e sem envio externo', () => {
  const alertPosition=client.indexOf('area.appendChild(buildSdrAlerts(sdrWorklist))');
  const kpiPosition=client.indexOf("const cards = el('section', 'kpi-grid')");
  assert.ok(alertPosition>=0&&kpiPosition>alertPosition,'a fila de alertas precisa anteceder os indicadores do dashboard');
  assert.match(client,/sdr-alert-callout-urgent/);
  assert.match(client,/A fila fica no topo do painel/);
  assert.match(client,/não são enviados por e-mail ou WhatsApp/);
  assert.match(client,/A regra de 24 horas inclui fins de semana/);
  assert.match(styles,/\.sdr-alert-callout-urgent\{background:linear-gradient\(110deg,#FFF1F2,#FFF7ED\);border-color:#FCA5A5/);
  assert.match(styles,/\.sdr-worklist-panel\{margin:0 0 18px;border:2px solid #F3B567/);
});

test('sincronização ao vivo mantém polling de segurança e informa o estado da conexão', () => {
  assert.match(client,/table: 'crm_sync_signal'/);
  assert.match(client,/status === 'SUBSCRIBED'/);
  assert.match(client,/setRealtimeStatus\('fallback'\)/);
  assert.match(client,/window\.setInterval\(\(\) =>/);
  assert.match(client,/20000/);
  assert.match(index,/id="sync-label" role="status"/);
});

test('histórico de recebimentos permite anulação justificada sem apagar o lançamento', () => {
  assert.match(client,/Anular com justificativa/);
  assert.match(client,/apiVoidSaleReceipt/);
  assert.match(client,/O recebimento ficará marcado como anulado e será preservado no histórico e na auditoria/);
  assert.match(client,/voidReason/);
});
