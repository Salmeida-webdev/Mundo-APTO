const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const styles = fs.readFileSync(path.join(root, 'apps-script/Styles.html'), 'utf8');
const index = fs.readFileSync(path.join(root, 'apps-script/Index.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'apps-script/Client.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'netlify/functions/crm.mjs'), 'utf8');

test('identidade visual está presente na entrada, na navegação e no cabeçalho móvel', () => {
  assert.equal((index.match(/class="brand-logo brand-logo-login"/g) || []).length, 2);
  assert.equal((index.match(/class="brand-logo brand-logo-sidebar"/g) || []).length, 1);
  assert.equal((index.match(/class="brand-logo brand-logo-header"/g) || []).length, 1);
  assert.match(styles, /--orange:#93651D/);
  assert.match(styles, /--orange-dark:#76502A/);
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

test('lista de clientes mostra prévia da observação do SDR sem alterar o escopo de acesso', () => {
  assert.match(client, /'Observação do SDR'/);
  assert.match(client, /const feedback = String\(lead\.sdrFeedback \|\| ''\)\.trim\(\)/);
  assert.match(client, /feedback\.slice\(0, 177\)\.trimEnd\(\) \+ '…'/);
  assert.match(client, /feedbackText\.title = feedback/);
  assert.match(client, /feedbackCell\.appendChild\(el\('span', 'muted', 'Sem observação'\)\)/);
  assert.match(styles, /\.sdr-feedback-cell\{min-width:190px;max-width:320px;white-space:normal/);
  assert.match(styles, /\.sdr-feedback-preview\{display:-webkit-box;.*-webkit-line-clamp:3/);
});

test('alertas do SDR ficam em uma área própria e sem envio externo', () => {
  assert.match(index,/data-page="sdrAlerts" id="sdr-alerts-nav"/);
  assert.match(client,/async function renderSdrAlertsPage\(\)/);
  assert.match(client,/byId\('sdr-alerts-nav'\)\.classList\.toggle\('hidden', state\.user\.role !== 'SDR'\)/);
  assert.match(client,/async function updateSdrNavigation\(\)/);
  assert.match(client,/sdr-alert-callout-urgent/);
  assert.match(client,/As filas e os avisos ficam disponíveis nesta área do CRM/);
  assert.match(client,/não são enviados por e-mail ou WhatsApp/);
  assert.match(client,/A regra de 24 horas inclui fins de semana/);
  assert.match(styles,/\.sdr-alert-callout-urgent\{background:linear-gradient\(110deg,#FFF1F2,#FFF7ED\);border-color:#FCA5A5/);
  assert.match(styles,/\.sdr-worklist-panel\{margin:0 0 18px;border:2px solid #D6AD62/);
});

test('SDR não tem aba financeira própria e consulta apenas recibos vinculados a partir de Contratos', () => {
  assert.match(client,/finance-documents-nav'\)\.classList\.toggle\('hidden', !canSeeFinanceDocuments\(\) \|\| isSdr\)/);
  assert.match(client,/Meus recibos vinculados/);
  assert.match(client,/Voltar a contratos/);
  assert.match(client,/SDR_ALLOWED_PAGES = new Set\(\[[^\]]*'financeDocuments'[^\]]*\]\)/);
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

test('corretor tem área própria de vendas somente para consulta', () => {
  assert.match(client, /byId\('sales-nav'\)\.classList\.toggle\('hidden', !\(isAdmin\(\) \|\| state\.user\.role === 'Corretor'\)\)/);
  assert.match(client, /async function renderBrokerSales\(\)/);
  assert.match(client, /Minhas vendas e repasses/);
  assert.match(client, /Consulte somente as vendas vinculadas ao seu usuário/);
  assert.match(client, /Ver pagamentos/);
  assert.match(client, /if \(state\.user && state\.user\.role === 'Corretor'\) return renderBrokerSales\(\)/);
  assert.match(styles, /\.sales-broker-kpis/);
});

test('módulo Sharks está integrado ao mesmo CRM, com filtros de período e frequência diária por corretor', () => {
  assert.match(client,/value: 'day'/);
  assert.match(client,/value: 'week'/);
  assert.match(client,/value: 'month'/);
  assert.match(client,/Frequências por corretor no período selecionado/);
  assert.match(client,/Lançar frequência do dia/);
  assert.match(client,/Todos os corretores ativos aparecem para marcar manhã, tarde e noite/);
  assert.match(client,/apiSetAttendance/);
  assert.match(client,/dateFrom:selectedDay,dateTo:selectedDay/);
  assert.match(client,/includeBrokerFilter:false/);
  assert.match(client,/filters\.brokerId=''/);
  assert.match(styles,/\.ops-attendance-toggle/);
  assert.match(styles,/\.ops-freshness/);
});

test('módulos operacionais atualizam o cadastro de corretores e oferecem exportação separada autorizada', () => {
  assert.match(client,/async function refreshOperationBrokers\(\)/);
  assert.match(client,/callApi\('apiListOperationBrokers', state\.token\)/);
  assert.match(client,/await refreshOperationBrokers\(\)/);
  assert.match(client,/state\.operationsBrokersUpdatedAt = 0/);
  assert.match(client,/Exportar lançamentos CSV/);
  assert.match(client,/exportOperationSection\('production',filters\)/);
  assert.match(client,/Exportar plantões CSV/);
  assert.match(client,/exportOperationSection\('attendance',filters\)/);
  assert.match(client,/if \(!canExportOperations\(\) \|\| !\['production','attendance'\]\.includes\(section\)\) return/);
  assert.match(client,/apiExportOperationsReport/);
  assert.match(client,/downloadCsv\('lancamentos-producao-/);
  assert.match(client,/downloadCsv\('frequencias-plantoes-/);
});

test('vendas exibem comissão bruta e as duas partes de 50% com resumo responsivo', () => {
  assert.match(client,/Comissão bruta total/);
  assert.match(client,/Sem SDR selecionado, valor integral para o corretor/);
  assert.match(client,/parte \(50%\)/);
  assert.match(client,/grossCommissionTotal=visibleRows\.reduce/);
  assert.match(client,/brokerCommissionTotal=visibleRows\.reduce/);
  assert.match(client,/sdrCommissionTotal=visibleRows\.filter\(\(item\)=>item\.isSdrSale!==false&&Boolean\(item\.sdrId\)\)\.reduce/);
  assert.match(client,/managerCommissionReceivable=visibleRows\.filter\(\(item\)=>!item\.isCommissionPaid&&!item\.isCancelledOrDistrato\)\.reduce/);
  assert.match(client,/Comissão do gerente a receber/);
  assert.match(client,/brl\(sale\.grossCommission\)/);
  assert.match(client,/brl\(sale\.brokerCommission\)/);
  assert.match(client,/brl\(sale\.sdrCommission\)/);
  assert.match(client,/A venda foi originada pelo SDR\?/);
  assert.match(client,/Sim · SDR/);
  assert.match(client,/Não · outra origem/);
  assert.match(client,/venda_originada_pelo_sdr/);
  assert.match(client,/isSdrSale:sdrOrigin\.value==='true'/);
  assert.match(styles,/\.sales-commission-kpis\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}/);
  assert.match(styles,/@media\(max-width:760px\)\{\.sales-commission-kpis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
});

test('corretor tem acesso rápido aos próprios lançamentos e pode cancelar com trilha preservada', () => {
  assert.match(client,/Meus lançamentos recentes/);
  assert.match(client,/recentOwnEntries/);
  assert.match(client,/Cancelar/);
  assert.match(client,/apiArchiveProduction/);
  assert.match(client,/preservado no histórico administrativo/);
});

test('auditoria informa e-mail do autor e tela administrativa de senha respeita operador autorizado', () => {
  assert.match(client,/Autor: '\+\(item\.actorEmail/);
  assert.match(client,/state\.user\.canApplySharedTemporaryPassword/);
  assert.match(client,/user\.canManageOperations/);
});

test('cadastro da equipe centraliza dados contratuais de corretores e SDRs e o rascunho seleciona o SDR', () => {
  assert.match(client,/Os dados para documentos ficam vinculados ao cadastro e podem ser preenchidos para corretores e SDRs/);
  assert.match(client,/contractCpf:contractCpf\.value,contractCnpj:contractCnpj\.value,contractCreci:contractCreci\.value,contractAddress:contractAddress\.value/);
  assert.match(client,/callApi\('apiListUsers',state\.token\)\]\);/);
  assert.match(client,/item\.role==='SDR'&&item\.active/);
  assert.match(client,/O SDR escolhido será vinculado à venda/);
  assert.match(client,/O CPF do comprador é opcional/);
  assert.match(client,/CPF.*CNPJ, CRECI e endereço do corretor\/SDR são opcionais|CNPJ, CRECI e endereço do corretor\/SDR podem ficar vazios/);
  assert.match(client,/contractCpf\.required=true/);
  assert.match(client,/número da proposta é obrigatório somente ao gerar o Termo Fifty/i);
  assert.match(client,/const updateContractProfileRequirements=[\s\S]*role\.value==='Gerente'/);
  assert.match(client,/O gerente selecionado como signatário precisa ter CPF, CNPJ, CRECI e endereço completos/);
  assert.doesNotMatch(client,/CPF do SDR \(necessário para gerar\)/);
  assert.match(styles,/\.contract-party-preview\{grid-column:1\/-1/);
});

test('agenda, documentos e painéis novos têm filtros por período e histórico consultável', () => {
  assert.match(client,/Data inicial da agenda/);
  assert.match(client,/Data final da agenda/);
  assert.match(client,/state\.appointmentsDateFrom/);
  assert.match(client,/agendamentos da agenda não são somados automaticamente à produção/i);
  assert.match(client,/apiArchiveManagerLocation/);
  assert.match(client,/Cadastrado de/);
  assert.match(client,/Cadastrado até/);
  assert.match(client,/formatDate\(doc\.createdAt\)/);
  assert.match(client,/createdFrom\.value&&createdDate<createdFrom\.value/);
  assert.match(client,/createdTo\.value&&createdDate>createdTo\.value/);
  assert.match(client,/Manifestações recebidas/);
  assert.match(client,/trendDirection/);
  assert.match(styles,/\.appointment-location-list/);
  assert.match(styles,/\.complaint-card/);
  assert.match(styles,/\.vgv-month-bars/);
});

test('ranking individual não lista colegas e preserva privacidade dos indicadores operacionais', () => {
  assert.match(client,/Sua posição é exibida sem listar outros corretores/);
  assert.match(client,/ranking\.map\(\(row\)=>\[String\(row\.rank\|\|'—'\)\+'º',row\.name\]\)/);
  assert.match(client,/Sua posição é exibida sem listar outros corretores nem revelar os números de produção ou frequência da equipe/);
});

test('plantões exibem totais por corretor no período e grade diária de presença para a equipe', () => {
  assert.match(client,/Frequências por corretor no período selecionado/);
  assert.match(client,/TOTAL DA EQUIPE/);
  assert.match(client,/TOTAL DO CORRETOR/);
  assert.match(client,/Lançar frequência do dia/);
  assert.match(client,/Data para consultar ou lançar frequência/);
  assert.match(client,/const dailyScope=teamVisible\?/);
  assert.match(client,/\{ id: 'morning', label: 'Manhã' \}/);
  assert.match(client,/\{ id: 'afternoon', label: 'Tarde' \}/);
  assert.match(client,/\{ id: 'night', label: 'Noite' \}/);
  assert.match(client,/dateFrom:selectedDay,dateTo:selectedDay/);
  assert.match(client,/filters\.brokerId=''/);
  assert.doesNotMatch(client,/Frequências semanais por corretor/);
});

test('agenda tem campos obrigatórios mínimos, compromissos agrupados por dia e cancelados em aba própria', () => {
  const appointment = client.slice(client.indexOf('async function renderAppointments()'), client.indexOf('function openAppointmentDialog('));
  const dialog = client.slice(client.indexOf('function openAppointmentDialog('), client.indexOf('function dataCanManageAgenda('));
  assert.match(dialog,/addField\(grid,'Compromisso',clientName\)/);
  assert.match(dialog,/clientName\.required=true/);
  assert.match(dialog,/date\.required=true/);
  assert.match(dialog,/start\.required=true/);
  assert.doesNotMatch(dialog,/lead\.required\s*=\s*true|dev\.required\s*=\s*true|stand\.required\s*=\s*true|broker\.required\s*=\s*true|notes\.required\s*=\s*true/);
  assert.match(appointment,/const groups = new Map\(\)/);
  assert.match(appointment,/appointment-day-group/);
  assert.match(appointment,/Cancelados/);
  assert.match(appointment,/state\.appointmentsTab/);
});

test('lançamentos do corretor permitem qualquer dia do mês vigente sem bloquear vários registros no dia', () => {
  assert.match(client,/Você pode registrar mais de um lançamento no mesmo dia, sem limite diário de quantidade, em qualquer data do mês vigente até hoje/);
  assert.match(client,/date\.min=todayBrazil\(\)\.slice\(0,7\)\+'-01'/);
  assert.match(client,/Novo lançamento/);
  assert.match(backend,/if \(access === 'broker' && workDate < monthStart\)/);
  assert.doesNotMatch(backend,/somente na data de hoje/);
});

test('recibos permitem selecionar várias vendas mantendo validação do corretor e limite seguro', () => {
  assert.match(client,/saleIds/);
  assert.match(client,/Todas as vendas devem pertencer ao corretor selecionado/);
  assert.match(client,/Selecione pelo menos uma venda/);
  assert.match(client,/Selecione um corretor e uma ou mais vendas dele/);
  assert.match(client,/Selecionar disponíveis/);
  assert.match(client,/limite por recibo é de 50 vendas/);
});

test('agenda abre mês por padrão e monta formulários antes das consultas secundárias', () => {
  assert.match(client,/appointmentsView: 'month'/);
  assert.match(client,/Visão mensal/);
  const appointment=client.slice(client.indexOf('function openAppointmentDialog('),client.indexOf('function dataCanManageAgenda('));
  assert.ok(appointment.indexOf('showAdminDialog(dialog,content,box)')<appointment.indexOf("callApi('apiListLeads'"),'o modal deve abrir sem esperar a busca opcional de clientes');
  const contract=client.slice(client.indexOf('async function openContractDialog('),client.indexOf('async function openContractTemplateDialog('));
  assert.ok(contract.indexOf('showAdminDialog(dialog,content,loading)')<contract.indexOf("callApi('apiListSales'"),'o formulário do Termo Fifty deve indicar carregamento em vez de deixar o clique sem resposta');
});
