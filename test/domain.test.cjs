const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps-script/Domain.gs'), 'utf8');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(source, sandbox, { filename: 'Domain.gs' });
const domain = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const users = [
  { id: 'U1', name: 'Corretora Um', role: 'Corretor', active: true },
  { id: 'U2', name: 'Corretor Dois', role: 'Corretor', active: true },
  { id: 'U3', name: 'Analista SDR', role: 'SDR', active: true },
  { id: 'U4', name: 'Gerente', role: 'Gerente', active: true },
  { id: 'U5', name: 'Assistente', role: 'Assistente', active: true },
  { id: 'U6', name: 'Desativado', role: 'Corretor', active: false }
];
const leads = [
  { id: 'L1', name: 'Cliente Alpha', phone: '11999990000', developmentId: 'E1', developmentName: 'Residencial Alfa', brokerId: 'U1', brokerName: 'Corretora Um', status: 'Em atendimento', createdAt: '2026-11-02T10:00:00-03:00', sdrUpdatedAt: '2026-11-02T10:00:00-03:00' },
  { id: 'L2', name: 'Cliente Beta', phone: '21999990000', developmentId: 'E2', developmentName: 'Residencial Beta', brokerId: 'U2', brokerName: 'Corretor Dois', status: 'Atendimento agendado', createdAt: '2026-11-03T10:00:00-03:00', sdrUpdatedAt: '2026-11-06T10:00:00-03:00' },
  { id: 'L3', name: 'Cliente Gama', phone: '31999990000', developmentId: 'E1', developmentName: 'Residencial Alfa', brokerId: 'U1', brokerName: 'Corretora Um', status: 'Aprovado pela Caixa', createdAt: '2026-11-04T10:00:00-03:00', sdrUpdatedAt: '' }
];

test('normaliza e-mail e expõe as 10 etapas exatas', () => {
  assert.equal(domain.normalizeEmail('  Pessoa@EXAMPLE.test  '), 'pessoa@example.test');
  assert.deepEqual(plain(domain.STATUS_NAMES), [
    'Em atendimento', 'Atendimento agendado', 'Desistência', 'Atendimento realizado', 'Já comprou',
    'Em contato', 'Enviando documentação', 'Em análise documental', 'Aprovado pela Caixa', 'Reprovado pela Caixa'
  ]);
});

test('cada corretor só consulta a própria carteira; SDR e gestão consultam todas', () => {
  assert.equal(domain.canReadLead(users[0], leads[0]), true);
  assert.equal(domain.canReadLead(users[0], leads[1]), false);
  assert.equal(domain.canReadLead(users[2], leads[1]), true);
  assert.equal(domain.canReadLead(users[3], leads[0]), true);
  assert.equal(domain.canReadLead(users[5], leads[0]), false);
  assert.deepEqual(domain.filterLeads(leads, users[0], {}, {today:'2026-11-09T12:00:00-03:00'}).map((lead) => lead.id), ['L1', 'L3']);
});

test('perfis recebem somente os campos editáveis previstos', () => {
  assert.deepEqual(plain(domain.editableFields(users[0], leads[0], false)), ['name', 'phone', 'developmentId', 'notes']);
  assert.deepEqual(plain(domain.editableFields(users[2], leads[0], false)), ['sdrFeedback', 'status']);
  assert.deepEqual(plain(domain.editableFields(users[2], null, true)), ['name', 'phone', 'developmentId', 'notes', 'brokerId']);
  assert.deepEqual(plain(domain.editableFields(users[3], leads[0], false)), ['name', 'phone', 'developmentId', 'notes', 'sdrFeedback', 'status', 'brokerId']);
});

test('validação rejeita tentativa de alterar campo reservado a outro perfil', () => {
  const brokerChange = domain.validateLeadInput(users[0], { status: 'Já comprou' }, leads[0], {isCreate:false});
  assert.equal(brokerChange.ok, false);
  assert.match(brokerChange.error, /não permitidos/);
  const sdrChange = domain.validateLeadInput(users[2], { name: 'Cliente trocado' }, leads[0], {isCreate:false});
  assert.equal(sdrChange.ok, false);
  const otherWallet = domain.validateLeadInput(users[0], { brokerId:'U2', name:'Novo', phone:'11999990000', developmentId:'E1' }, null, {isCreate:true});
  assert.equal(otherWallet.ok, false);
});

test('corretor cria cliente com sua própria atribuição e status inicial controlado', () => {
  const result = domain.validateLeadInput(users[0], {name:'  Cliente Novo ',phone:'(11) 99999-0000',developmentId:'E1',notes:'Primeiro contato'}, null, {isCreate:true});
  assert.equal(result.ok, true);
  assert.equal(result.value.name, 'Cliente Novo');
  assert.equal(result.value.brokerId, 'U1');
  assert.equal(result.value.status, 'Em contato');
  assert.equal(result.value.sdrFeedback, '');
});

test('SDR pode cadastrar cliente e atribuir corretor sem receber papel administrativo', () => {
  const result = domain.validateLeadInput(users[2], {name:'Cliente do SDR',phone:'11999990009',developmentId:'E1',notes:'Origem SDR',brokerId:'U2'}, null, {isCreate:true});
  assert.equal(result.ok, true);
  assert.equal(result.value.brokerId, 'U2');
  assert.equal(result.value.status, 'Em contato');
  assert.equal(result.value.sdrFeedback, '');
  assert.equal(users[2].role, 'SDR');
  assert.deepEqual(plain(domain.editableFields(users[2], leads[0], false)), ['sdrFeedback', 'status']);
  assert.equal(domain.validateLeadInput(users[2], {name:'Cliente sem corretor',phone:'11999990010',developmentId:'E1'}, null, {isCreate:true}).ok, false);
});

test('valida telefone, status, campos obrigatórios e limite dos textos', () => {
  assert.equal(domain.validateLeadInput(users[0], {name:'A',phone:'123',developmentId:'E1'}, null, {isCreate:true}).ok, false);
  assert.equal(domain.validateLeadInput(users[2], {status:'Status inventado'}, leads[0], {isCreate:false}).ok, false);
  assert.equal(domain.validateLeadInput(users[0], {name:'A',phone:'11999990000',developmentId:'E1',notes:'x'.repeat(3001)}, null, {isCreate:true}).ok, false);
});

test('busca e filtros respeitam nome, telefone, empreendimento, status, corretor e período', () => {
  const admin = users[3];
  const byName = domain.filterLeads(leads, admin, {query:'alpha'}, {today:'2026-11-09T12:00:00-03:00'});
  assert.deepEqual(byName.map((lead) => lead.id), ['L1']);
  const byPhone = domain.filterLeads(leads, admin, {query:'2199999'}, {today:'2026-11-09T12:00:00-03:00'});
  assert.deepEqual(byPhone.map((lead) => lead.id), ['L2']);
  const combined = domain.filterLeads(leads, admin, {brokerId:'U1',developmentId:'E1',status:'Aprovado pela Caixa',dateFrom:'2026-11-04',dateTo:'2026-11-04'}, {today:'2026-11-09T12:00:00-03:00'});
  assert.deepEqual(combined.map((lead) => lead.id), ['L3']);
});

test('follow-up conta dias úteis sem contar o dia da última atualização', () => {
  assert.equal(domain.businessDaysSince('2026-11-06T16:00:00-03:00', '2026-11-11T12:00:00-03:00'), 3); // sexta a quarta
  assert.equal(domain.businessDaysSince('2026-11-06T16:00:00-03:00', '2026-11-10T12:00:00-03:00'), 2);
  assert.equal(domain.businessDaysSince('2026-11-09T16:00:00-03:00', '2026-11-09T17:00:00-03:00'), 0);
  assert.equal(domain.staleInfo({createdAt:'2026-11-06T10:00:00-03:00',sdrUpdatedAt:''}, '2026-11-11T10:00:00-03:00', 3).stale, true);
});

test('dashboard calcula indicadores, funil de 10 etapas, ranking e fila de follow-up', () => {
  const data = plain(domain.buildDashboard(leads, users, {}, {actor:users[3],today:'2026-11-11T12:00:00-03:00',staleBusinessDays:3}));
  assert.equal(data.total, 3);
  assert.equal(data.activeAttendance, 1);
  assert.equal(data.appointments, 1);
  assert.equal(data.approved, 1);
  assert.equal(data.stageCounts['Em contato'], 0);
  assert.equal(Object.keys(data.stageCounts).length, 10);
  assert.deepEqual(data.ranking[0], {id:'U1',name:'Corretora Um',active:true,total:2,statuses:{'Em atendimento':1,'Atendimento agendado':0,'Desistência':0,'Atendimento realizado':0,'Já comprou':0,'Em contato':0,'Enviando documentação':0,'Em análise documental':0,'Aprovado pela Caixa':1,'Reprovado pela Caixa':0}});
  assert.equal(data.staleCount, 3);
  assert.deepEqual(data.staleLeads.map((lead) => lead.id), ['L1','L3','L2']);
});

test('análises históricas comparam coortes, contatos SDR e conversões entre etapas', () => {
  const historicalLeads = [
    {...leads[0], id:'C1', status:'Em atendimento', createdAt:'2026-11-10T12:00:00Z', sdrUpdatedAt:'2026-11-10T14:00:00Z'},
    {...leads[1], id:'C2', status:'Em atendimento', createdAt:'2026-11-09T12:00:00Z', sdrUpdatedAt:'2026-11-09T13:00:00Z'}
  ];
  const events = [
    {leadId:'C1',at:'2026-11-10T12:00:00Z',eventType:'lead_created',newStatus:'Em contato'},
    {leadId:'C1',at:'2026-11-10T13:00:00Z',eventType:'status_change',oldStatus:'Em contato',newStatus:'Em atendimento'},
    {leadId:'C2',at:'2026-11-09T12:00:00Z',eventType:'lead_created',newStatus:'Em contato'},
    {leadId:'C2',at:'2026-11-09T13:00:00Z',eventType:'status_change',oldStatus:'Em contato',newStatus:'Em atendimento'}
  ];
  const history = [
    {leadId:'C1',at:'2026-11-10T14:00:00Z'},
    {leadId:'C2',at:'2026-11-09T13:00:00Z'}
  ];
  const result = plain(domain.buildDashboard(historicalLeads, users, {dateFrom:'2026-11-10',dateTo:'2026-11-10'}, {
    actor:users[3], today:'2026-11-11T12:00:00-03:00', staleBusinessDays:3,
    allLeads:historicalLeads, events, sdrHistory:history
  }));
  assert.equal(result.analytics.current.newLeads, 1);
  assert.equal(result.analytics.previous.newLeads, 1);
  assert.equal(result.analytics.current.sdrContacts, 1);
  assert.equal(result.analytics.current.averageFirstContactHours, 2);
  assert.deepEqual(result.analytics.current.conversions[0], {from:'Em contato',to:'Em atendimento',entered:1,converted:1,rate:100});
  assert.equal(result.analytics.conversionBasis.includes('histórico começa'), true);
});

test('paginação limita a 100 linhas e calcula total e página', () => {
  const page = plain(domain.paginate(Array.from({length:240}, (_, i) => i), 3, 500));
  assert.equal(page.page, 3);
  assert.equal(page.pageSize, 100);
  assert.equal(page.total, 240);
  assert.equal(page.items.length, 40);
});
