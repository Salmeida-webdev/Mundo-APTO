const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config/seed-data.json'), 'utf8'));
const testDevelopments = [
  { id: 'E001', name: 'Empreendimento de teste A', active: true },
  { id: 'E002', name: 'Empreendimento de teste B', active: true }
];
const asBytes = (values) => Buffer.from(Array.from(values || [], (value) => (Number(value) + 256) % 256));
const salt = '00112233445566778899aabbccddeeff';
const iterations = 1000;
const starterPassword = 'PrimeiraSenhaSegura123!';

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function hashed(password) { return crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex'); }
function makeUser(id, name, email, role, password) {
  return { id, name, email, role, active: true, passwordSalt: salt, passwordHash: hashed(password), iterations, mustChangePassword: false, sessionVersion: 0, createdAt:'2026-11-01T12:00:00-03:00', updatedAt:'2026-11-01T12:00:00-03:00' };
}

function setupServer() {
  const props = new Map([['CRM_BOOTSTRAPPED', 'true']]);
  const cacheData = new Map();
  const audits = [];
  const history = [];
  const leads = [
    { id:'L-A',name:'Pessoa da carteira A',phone:'11999990001',developmentId:'E001',developmentName:testDevelopments[0].name,notes:'nota A',sdrFeedback:'',status:'Em contato',brokerId:'U005',brokerName:'Gabriel',createdAt:'2026-11-08T10:00:00-03:00',createdBy:'U005',updatedAt:'2026-11-08T10:00:00-03:00',updatedBy:'U005',sdrUpdatedAt:'',sdrUpdatedBy:'' },
    { id:'L-B',name:'Pessoa da carteira B',phone:'11999990002',developmentId:'E002',developmentName:testDevelopments[1].name,notes:'nota B',sdrFeedback:'',status:'Atendimento agendado',brokerId:'U006',brokerName:'Adriana',createdAt:'2026-11-07T10:00:00-03:00',createdBy:'U006',updatedAt:'2026-11-07T10:00:00-03:00',updatedBy:'U006',sdrUpdatedAt:'2026-11-07T10:00:00-03:00',sdrUpdatedBy:'U004' }
  ];
  const users = [
    makeUser('U000','Administrador de Implantação','admin@example.test','Administrador',starterPassword),
    makeUser('U001','Gestor Comercial','gerente@example.test','Gerente',starterPassword),
    makeUser('U004','Luis SDR','sdr@example.test','SDR',starterPassword),
    makeUser('U005','Gabriel Corretor','gabriel@example.test','Corretor',starterPassword),
    makeUser('U006','Adriana Corretora','adriana@example.test','Corretor',starterPassword)
  ];
  let uuidCounter = 1;
  const cache = {
    get(key) { return cacheData.has(key) ? cacheData.get(key) : null; },
    put(key, value) { cacheData.set(key, String(value)); },
    remove(key) { cacheData.delete(key); }
  };
  const repo = {
    getUsers: () => copy(users),
    getUserByEmail: (email) => copy(users.find((user) => user.email.toLowerCase() === email.toLowerCase()) || null),
    getUserById: (id) => copy(users.find((user) => user.id === id) || null),
    getDevelopments: () => copy(testDevelopments),
    getLeads: () => copy(leads),
    getLeadById: (id) => copy(leads.find((lead) => lead.id === id) || null),
    initializeSdrHistory() {},
    getSdrHistory: (leadId) => copy(history.filter((entry) => String(entry.leadId) === String(leadId)).sort((a, b) => String(b.at).localeCompare(String(a.at)))),
    addSdrHistory(record) { history.push(copy(record)); return record; },
    saveLead(record, isCreate) {
      const index = leads.findIndex((lead) => lead.id === record.id);
      if (isCreate) leads.push(copy(record)); else if (index >= 0) leads[index] = copy(record); else throw new Error('Registro inexistente.');
      return record;
    },
    saveUser(record, isCreate) {
      const index = users.findIndex((user) => user.id === record.id);
      if (isCreate) users.push(copy(record)); else if (index >= 0) users[index] = copy(record); else throw new Error('Usuário inexistente.');
      return record;
    },
    addAudit(record) { audits.push(copy(record)); return record; }
  };
  const Utilities = {
    DigestAlgorithm: { SHA_256:'sha256' },
    newBlob(value) { return { getBytes: () => Array.from(Buffer.from(String(value), 'utf8')) }; },
    computeHmacSha256Signature(value, key) { return Array.from(crypto.createHmac('sha256', asBytes(key)).update(asBytes(value)).digest()); },
    computeDigest(algorithm, value) { return Array.from(crypto.createHash('sha256').update(asBytes(value)).digest()); },
    getUuid() { const current = String(uuidCounter++).padStart(12,'0'); return '10000000-0000-4000-8000-' + current; },
    formatDate(date, timezone, format) { return format === 'Z' ? '-0300' : new Date(date).toISOString().slice(0,19); }
  };
  const context = vm.createContext({
    CRM_CONFIG: config,
    CrmRepo: repo,
    Utilities,
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty:(key) => props.get(key) || null, setProperty:(key,value) => props.set(key,String(value)) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    console: { log() {}, error() {} }
  });
  for (const file of ['Domain.gs','Crypto.gs','Code.gs']) vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', file), 'utf8'), context, { filename:file });
  return { context, users, leads, audits, history, cacheData };
}

test('login cria sessão e resposta não revela hash/salt; corretor recebe somente a própria carteira', () => {
  const { context } = setupServer();
  const result = context.apiLogin(' GABRIEL@example.test ', starterPassword);
  assert.equal(result.ok, true);
  assert.equal(result.user.role, 'Corretor');
  assert.equal(Object.hasOwn(result.user, 'passwordHash'), false);
  const rows = context.apiListLeads(result.token, {}, 1, 100);
  assert.equal(rows.total, 1);
  assert.equal(rows.items[0].id, 'L-A');
  const dashboard = context.apiGetDashboard(result.token, {});
  assert.equal(dashboard.total, 1);
  assert.equal(dashboard.ranking.length, 1);
  assert.equal(dashboard.ranking[0].id, 'U005');
});

test('SDR altera feedback/status e recebe timestamp automático, mas não altera dados do corretor', () => {
  const { context, leads, history } = setupServer();
  const login = context.apiLogin('sdr@example.test', starterPassword);
  assert.equal(login.ok, true);
  const denied = context.apiSaveLead(login.token, 'L-A', {name:'Tentativa indevida'});
  assert.equal(denied.ok, false);
  assert.match(denied.message, /não permitidos/);
  const saved = context.apiSaveLead(login.token, 'L-A', {sdrFeedback:'Ligação feita',status:'Atendimento agendado'});
  assert.equal(saved.ok, true);
  const lead = leads.find((row) => row.id === 'L-A');
  assert.equal(lead.sdrFeedback, 'Ligação feita');
  assert.equal(lead.status, 'Atendimento agendado');
  assert.ok(lead.sdrUpdatedAt);
  assert.equal(lead.sdrUpdatedBy, 'U004');
  assert.equal(history.length, 1);
  assert.equal(history[0].leadId, 'L-A');
  assert.equal(history[0].userName, 'Luis SDR');
  assert.equal(history[0].status, 'Atendimento agendado');
  assert.equal(history[0].feedback, 'Ligação feita');
});

test('registrar novo contato do SDR preserva entrada mesmo quando status e feedback se repetem', () => {
  const { context, leads, history } = setupServer();
  const login = context.apiLogin('sdr@example.test', starterPassword);
  const before = leads.find((row) => row.id === 'L-B').sdrUpdatedAt;
  const saved = context.apiSaveLead(login.token, 'L-B', {sdrFeedback:'',status:'Atendimento agendado'});
  assert.equal(saved.ok, true);
  assert.match(saved.message, /Contato registrado/);
  assert.notEqual(leads.find((row) => row.id === 'L-B').sdrUpdatedAt, before);
  assert.equal(history.length, 1);
  assert.equal(history[0].leadId, 'L-B');
  assert.equal(history[0].feedback, '');
  assert.equal(history[0].status, 'Atendimento agendado');
});

test('histórico é visível à gestão e SDR; corretor só consulta a própria carteira', () => {
  const { context } = setupServer();
  const sdr = context.apiLogin('sdr@example.test', starterPassword);
  context.apiSaveLead(sdr.token, 'L-A', {sdrFeedback:'Contato A',status:'Em atendimento'});
  context.apiSaveLead(sdr.token, 'L-B', {sdrFeedback:'Contato B',status:'Atendimento agendado'});
  const manager = context.apiLogin('gerente@example.test', starterPassword);
  const managerHistory = context.apiGetSdrHistory(manager.token, 'L-B');
  assert.equal(managerHistory.length, 1);
  assert.equal(managerHistory[0].feedback, 'Contato B');
  const broker = context.apiLogin('gabriel@example.test', starterPassword);
  assert.equal(context.apiGetSdrHistory(broker.token, 'L-A').length, 1);
  assert.throws(() => context.apiGetSdrHistory(broker.token, 'L-B'), /não encontrado ou sem permissão/);
  assert.equal(context.apiGetSdrHistory(sdr.token, 'L-B').length, 1);
});

test('corretor não muda status e não consegue consultar cliente de outra carteira', () => {
  const { context } = setupServer();
  const login = context.apiLogin('gabriel@example.test', starterPassword);
  assert.equal(context.apiListLeads(login.token, {query:'Pessoa da carteira B'}, 1, 100).total, 0);
  const attempt = context.apiSaveLead(login.token, 'L-A', {status:'Já comprou'});
  assert.equal(attempt.ok, false);
  const crossWallet = context.apiSaveLead(login.token, 'L-B', {notes:'Acesso cruzado'});
  assert.equal(crossWallet.ok, false);
  assert.match(crossWallet.message, /sem permissão/);
});

test('gestão não pode atribuir cliente a corretor inativo, mas pode manter cliente já atribuído', () => {
  const { context, users, leads } = setupServer();
  users.find((user) => user.id === 'U006').active = false;
  const manager = context.apiLogin('gerente@example.test', starterPassword);
  const reassigned = context.apiSaveLead(manager.token, 'L-A', {brokerId:'U006'});
  assert.equal(reassigned.ok, false);
  assert.match(reassigned.message, /inativo/);
  const updated = context.apiSaveLead(manager.token, 'L-B', {status:'Atendimento realizado'});
  assert.equal(updated.ok, true);
  assert.equal(leads.find((row) => row.id === 'L-B').brokerId, 'U006');
});

test('gestão rejeita campos de usuário extras e estado ativo que não seja booleano', () => {
  const { context } = setupServer();
  const manager = context.apiLogin('gerente@example.test', starterPassword);
  const extra = context.apiSaveUser(manager.token, {name:'Teste',email:'teste@example.test',role:'Corretor',unexpected:'admin'});
  assert.equal(extra.ok, false);
  assert.match(extra.message, /campos não permitidos/);
  const invalidActive = context.apiSaveUser(manager.token, {id:'U005',name:'Gabriel Corretor',email:'gabriel@example.test',role:'Corretor',active:'false'});
  assert.equal(invalidActive.ok, false);
  assert.match(invalidActive.message, /Estado do usuário/);
});

test('gestão acessa todas as carteiras e perfis restritos não abrem gestão de usuários', () => {
  const { context } = setupServer();
  const manager = context.apiLogin('gerente@example.test', starterPassword);
  assert.equal(context.apiListLeads(manager.token, {}, 1, 100).total, 2);
  assert.equal(context.apiListUsers(manager.token).length, 5);
  const sdr = context.apiLogin('sdr@example.test', starterPassword);
  assert.throws(() => context.apiListUsers(sdr.token), /gestão/);
});

test('senha inicial da equipe exclui o gestor executor e exige troca individual para as demais contas', () => {
  const { context, users } = setupServer();
  const manager = context.apiLogin('gerente@example.test', starterPassword);
  const sdr = context.apiLogin('sdr@example.test', starterPassword);
  assert.equal(context.apiGetReferenceData(manager.token).sharedTemporaryPasswordAvailable, true);
  assert.throws(() => context.apiApplySharedTemporaryPassword(sdr.token, 'OutraSenhaTemporariaSegura#2026'), /Acesso restrito à gestão/);
  assert.equal(context.apiApplySharedTemporaryPassword(manager.token, starterPassword).ok, false);
  const originalManager = users.find((user) => user.id === 'U001');
  const originalHash = originalManager.passwordHash;
  const originalSalt = originalManager.passwordSalt;
  const result = context.apiApplySharedTemporaryPassword(manager.token, 'OutraSenhaTemporariaSegura#2026');
  assert.equal(result.ok, true);
  assert.equal(result.updatedCount, users.length - 1);
  assert.equal(originalManager.passwordHash, originalHash);
  assert.equal(originalManager.passwordSalt, originalSalt);
  assert.equal(originalManager.mustChangePassword, false);
  assert.equal(context.apiGetReferenceData(manager.token).sharedTemporaryPasswordAvailable, false);
  assert.equal(context.apiGetDashboard(manager.token, {}).total, 2);
  assert.throws(() => context.apiGetDashboard(sdr.token, {}), /Sessão inválida/);
  const adminLogin = context.apiLogin('admin@example.test', 'OutraSenhaTemporariaSegura#2026');
  assert.equal(adminLogin.ok, true);
  assert.equal(adminLogin.user.mustChangePassword, true);
  const managerLogin = context.apiLogin('gerente@example.test', 'OutraSenhaTemporariaSegura#2026');
  assert.equal(managerLogin.ok, false);
  assert.equal(context.apiApplySharedTemporaryPassword(manager.token, 'OutraSenhaTemporariaSegura#2026').ok, false);
});

test('senha temporária expira sessões anteriores e exige troca antes do acesso aos dados', () => {
  const { context } = setupServer();
  const manager = context.apiLogin('gerente@example.test', starterPassword);
  const reset = context.apiResetUserPassword(manager.token, 'U005');
  assert.equal(reset.ok, true);
  assert.throws(() => context.apiListLeads(context.apiLogin('gabriel@example.test', reset.temporaryPassword).token, {}, 1, 100), /Altere a senha temporária/);
  const brokerLogin = context.apiLogin('gabriel@example.test', reset.temporaryPassword);
  assert.equal(brokerLogin.ok, true);
  assert.equal(brokerLogin.user.mustChangePassword, true);
  assert.equal(context.apiChangePassword(brokerLogin.token, reset.temporaryPassword, 'UmaSenhaNovaMuitoSegura#2026').ok, true);
  assert.throws(() => context.apiGetDashboard(brokerLogin.token, {}), /Sessão expirada/);
  const fresh = context.apiLogin('gabriel@example.test', 'UmaSenhaNovaMuitoSegura#2026');
  assert.equal(fresh.ok, true);
  assert.equal(fresh.user.mustChangePassword, false);
});

test('login inválido não revela se o e-mail está cadastrado e bloqueia tentativas repetidas', () => {
  const { context } = setupServer();
  const known = context.apiLogin('gabriel@example.test', 'senha incorreta');
  const unknown = context.apiLogin('naoexiste@example.test', 'senha incorreta');
  assert.equal(known.message, 'E-mail ou senha inválidos.');
  assert.equal(unknown.message, 'E-mail ou senha inválidos.');
  for (let i=0;i<4;i++) context.apiLogin('gabriel@example.test', 'errada');
  const blocked = context.apiLogin('gabriel@example.test', starterPassword);
  assert.match(blocked.message, /Muitas tentativas/);
});

test('endpoints protegidos rejeitam token ausente ou expirado', () => {
  const { context } = setupServer();
  assert.throws(() => context.apiListLeads('', {}, 1, 100), /Sessão inválida/);
  assert.throws(() => context.apiGetDashboard('token-expirado', {}), /Sessão inválida/);
});
