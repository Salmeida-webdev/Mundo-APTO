const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { default: handler } = require('../netlify/functions/crm.mjs');

const userIdSdr = '10000000-0000-4000-8000-000000000004';
const userIdBrokerA = '10000000-0000-4000-8000-000000000005';
const userIdBrokerB = '10000000-0000-4000-8000-000000000006';
const userIdManager = '10000000-0000-4000-8000-000000000007';
const rows = {
  crm_users: [
    { id: userIdSdr, name: 'SDR de teste', email: 'sdr@example.test', role: 'SDR', active: true, must_change_password: false, session_version: 0 },
    { id: userIdBrokerA, name: 'Corretor A', email: 'a@example.test', role: 'Corretor', active: true, must_change_password: false, session_version: 0 },
    { id: userIdBrokerB, name: 'Corretor B', email: 'b@example.test', role: 'Corretor', active: true, must_change_password: false, session_version: 0 },
    { id: userIdManager, name: 'Gestor de teste', email: 'gestao@example.test', role: 'Gerente', active: true, must_change_password: false, session_version: 0 }
  ],
  crm_developments: [{ id: 'E001', name: 'Empreendimento teste', active: true }],
  crm_leads: [
    { id: 'lead-a', name: 'Cliente da carteira A', phone: '11999990001', development_id: 'E001', notes: 'Nota A', sdr_feedback: '', status: 'Em contato', broker_id: userIdBrokerA, created_at: '2026-11-08T10:00:00Z', created_by: userIdBrokerA, updated_at: '2026-11-08T10:00:00Z', updated_by: userIdBrokerA, sdr_updated_at: null, sdr_updated_by: null },
    { id: 'lead-b', name: 'Cliente da carteira B', phone: '11999990002', development_id: 'E001', notes: 'Nota B', sdr_feedback: '', status: 'Em contato', broker_id: userIdBrokerB, created_at: '2026-11-08T10:00:00Z', created_by: userIdBrokerB, updated_at: '2026-11-08T10:00:00Z', updated_by: userIdBrokerB, sdr_updated_at: null, sdr_updated_by: null }
  ],
  crm_sdr_history: [],
  crm_lead_events: [],
  crm_audit: [],
  crm_sessions: [],
  crm_settings: []
};

const jwtFor = (role, userId, email, sessionVersion = 0) => `e30.${Buffer.from(JSON.stringify({ sub: userId, app_metadata: { role, crm_session_version: sessionVersion } })).toString('base64url')}.signature`;

function mockEnvironmentAndFetch(t, { role = 'Corretor', userId = userIdBrokerA, email = 'a@example.test', sessionVersion = 0 } = {}) {
  const savedEnv = { ...process.env };
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  process.env.SUPABASE_SECRET_KEY = 'service-test-key';
  process.env.CRM_BOOTSTRAP_SECRET = '';
  const token = jwtFor(role, userId, email, sessionVersion);
  const calls = [];
  const authMetadata = new Map();
  let leadCounter = 1;
  const fakeUser = { id: userId, email, app_metadata: { role, crm_session_version: sessionVersion } };
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method || 'GET';
    calls.push({ path: url.pathname, method, query: Object.fromEntries(url.searchParams), headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : null });
    if (url.pathname === '/auth/v1/user') return Response.json(fakeUser);
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      const targetId = decodeURIComponent(url.pathname.split('/').pop());
      const profile = rows.crm_users.find((item) => String(item.id) === targetId);
      if (method === 'GET') return profile ? Response.json({ id: targetId, app_metadata: authMetadata.get(targetId) || { crm_session_version: Number(profile.session_version || 0) }, user_metadata: { name: profile.name } }) : Response.json({ message:'user not found' }, { status:404 });
      if (method === 'PUT') {
        const update = JSON.parse(options.body);
        if (update.app_metadata) authMetadata.set(targetId, update.app_metadata);
        return Response.json({ id: targetId, ...update });
      }
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop();
      const list = rows[table] || [];
      if (method === 'GET') {
        let filtered = list;
        const idFilter = url.searchParams.get('id');
        const leadFilter = url.searchParams.get('lead_id');
        const keyFilter = url.searchParams.get('key');
        const userFilter = url.searchParams.get('user_id');
        const deletedFilter = url.searchParams.get('deleted_at');
        if (idFilter && idFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.id) === idFilter.slice(3));
        if (leadFilter && leadFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.lead_id) === leadFilter.slice(3));
        if (keyFilter && keyFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.key) === keyFilter.slice(3));
        if (userFilter && userFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.user_id) === userFilter.slice(3));
        if (deletedFilter === 'is.null') filtered = filtered.filter((row) => !row.deleted_at);
        if (deletedFilter === 'not.is.null') filtered = filtered.filter((row) => Boolean(row.deleted_at));
        if (url.searchParams.get('active') === 'eq.true') filtered = filtered.filter((row) => row.active === true);
        return Response.json(filtered);
      }
      if (method === 'PATCH') {
        const idFilter = url.searchParams.get('id') || '';
        const id = idFilter.slice(3);
        const row = list.find((item) => String(item.id) === id);
        const deletedFilter = url.searchParams.get('deleted_at');
        if (!row || (deletedFilter === 'is.null' && row.deleted_at) || (deletedFilter === 'not.is.null' && !row.deleted_at)) return Response.json([], { status: 200 });
        Object.assign(row, JSON.parse(options.body));
        return Response.json([row]);
      }
      if (method === 'POST') {
        const value = JSON.parse(options.body);
        if (table === 'crm_leads') {
          const entries = (Array.isArray(value) ? value : [value]).map((item) => ({ ...item, id: item.id || `lead-new-${leadCounter++}` }));
          list.push(...entries);
          return Response.json(entries);
        }
        if (Array.isArray(value)) list.push(...value); else list.push(value);
        return Response.json(Array.isArray(value) ? value : [value]);
      }
      if (method === 'DELETE') {
        if (table === 'crm_sessions') {
          const userFilter = url.searchParams.get('user_id') || '';
          const userId = userFilter.startsWith('eq.') ? userFilter.slice(3) : '';
          rows.crm_sessions.splice(0, rows.crm_sessions.length, ...rows.crm_sessions.filter((item) => String(item.user_id) !== userId));
        }
        return new Response(null, { status: 204 });
      }
    }
    return Response.json({ message: 'mock route not found' }, { status: 404 });
  };
  t.after(() => { global.fetch = oldFetch; for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });
  return { token, calls, authMetadata };
}

async function invoke(method, args, token) {
  const request = new Request('https://mundoapto.test/.netlify/functions/crm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args: args || [] })
  });
  const response = await handler(request);
  return { response, body: await response.json() };
}

test('função rejeita verbos indevidos, métodos desconhecidos e origem externa', async () => {
  const getResponse = await handler(new Request('https://mundoapto.test/.netlify/functions/crm'));
  assert.equal(getResponse.status, 405);
  const unknown = await invoke('apiDeleteEverything', []);
  assert.equal(unknown.response.status, 404);
  const crossOrigin = await handler(new Request('https://mundoapto.test/.netlify/functions/crm', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'apiBootstrapInfo' }) }));
  assert.equal(crossOrigin.status, 403);
});

test('API do corretor retorna somente sua carteira e rejeita tentativa de acesso cruzado', async (t) => {
  const { token, calls } = mockEnvironmentAndFetch(t);
  const listed = await invoke('apiListLeads', [token, {}, 1, 100], token);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].id, 'lead-a');
  assert.equal(listed.body.items.some((lead) => lead.id === 'lead-b'), false);
  const databaseCalls = calls.filter((call) => call.path.startsWith('/rest/v1/'));
  assert.ok(databaseCalls.length > 0);
  assert.ok(databaseCalls.every((call) => call.headers.apikey === 'service-test-key'));
  assert.ok(databaseCalls.every((call) => !call.headers.Authorization));
  const forbidden = await invoke('apiSaveLead', [token, 'lead-b', { notes: 'Tentativa de cruzar carteiras' }], token);
  assert.equal(forbidden.body.ok, false);
  assert.match(forbidden.body.message, /sem permissão/);
});

test('bootstrap usa segredo temporário e e-mail informado na tela, sem variável de e-mail', async (t) => {
  const originalUsers = rows.crm_users.slice();
  rows.crm_users.splice(0, rows.crm_users.length);
  t.after(() => rows.crm_users.splice(0, rows.crm_users.length, ...originalUsers));
  mockEnvironmentAndFetch(t);
  process.env.CRM_BOOTSTRAP_SECRET = 'segredo-temporario-de-teste';
  delete process.env.CRM_BOOTSTRAP_EMAIL;
  const info = await invoke('apiBootstrapInfo', []);
  assert.equal(info.response.status, 200);
  assert.equal(info.body.setupAvailable, true);
  const denied = await invoke('apiBootstrapAdmin', ['segredo-incorreto', 'Admin', 'admin@example.test', 'senha-super-segura-123']);
  assert.equal(denied.response.status, 403);
  const invalidEmail = await invoke('apiBootstrapAdmin', ['segredo-temporario-de-teste', 'Admin', 'email-invalido', 'senha-super-segura-123']);
  assert.equal(invalidEmail.response.status, 400);
});

test('SDR não altera campos do corretor e registra histórico ao atualizar feedback/status', async (t) => {
  const { token, calls } = mockEnvironmentAndFetch(t, { role: 'SDR', userId: userIdSdr, email: 'sdr@example.test' });
  const denied = await invoke('apiSaveLead', [token, 'lead-a', { name: 'Alteração indevida' }], token);
  assert.equal(denied.body.ok, false);
  assert.equal(calls.some((call) => call.path === '/rest/v1/crm_leads' && call.method === 'PATCH'), false);
  const saved = await invoke('apiSaveLead', [token, 'lead-a', { sdrFeedback: 'Contato realizado', status: 'Atendimento agendado' }], token);
  assert.equal(saved.body.ok, true);
  assert.equal(rows.crm_leads[0].sdr_feedback, 'Contato realizado');
  assert.equal(rows.crm_leads[0].status, 'Atendimento agendado');
  assert.ok(rows.crm_leads[0].sdr_updated_at);
  assert.equal(rows.crm_sdr_history.at(-1).lead_id, 'lead-a');
  assert.equal(rows.crm_sdr_history.at(-1).user_id, userIdSdr);
  assert.equal(rows.crm_sdr_history.at(-1).feedback, 'Contato realizado');
});

test('SDR cadastra cliente e atribui corretor sem obter acesso administrativo', async (t) => {
  const originalLeads = rows.crm_leads.slice();
  t.after(() => rows.crm_leads.splice(0, rows.crm_leads.length, ...originalLeads));
  const { token, calls } = mockEnvironmentAndFetch(t, { role: 'SDR', userId: userIdSdr, email: 'sdr@example.test' });
  const result = await invoke('apiSaveLead', [token, '', { name:'Novo pelo SDR', phone:'11999990003', developmentId:'E001', notes:'Atribuição feita no cadastro', brokerId:userIdBrokerB }], token);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.match(result.body.message, /atribuído ao corretor selecionado/);
  const created = rows.crm_leads.find((lead) => lead.name === 'Novo pelo SDR');
  assert.equal(created.broker_id, userIdBrokerB);
  assert.equal(created.created_by, userIdSdr);
  assert.equal(created.status, 'Em contato');
  assert.ok(calls.some((call) => call.path === '/rest/v1/crm_leads' && call.method === 'POST'));
  const forbidden = await invoke('apiSaveLead', [token, created.id, { name:'Tentativa de edição' }], token);
  assert.equal(forbidden.body.ok, false);
  assert.match(forbidden.body.message, /não permitidos/);
});

test('gestão administra empreendimentos com desativação sem apagar registro', async (t) => {
  const original = rows.crm_developments.slice();
  t.after(() => rows.crm_developments.splice(0, rows.crm_developments.length, ...original));
  const { token } = mockEnvironmentAndFetch(t, { role:'Gerente', userId:userIdManager, email:'gestao@example.test' });
  const created = await invoke('apiSaveDevelopment', [token, { name:'Novo Residencial', active:true }], token);
  assert.equal(created.body.ok, true);
  const id = created.body.development.id;
  const deactivated = await invoke('apiSaveDevelopment', [token, { id, name:'Novo Residencial', active:false }], token);
  assert.equal(deactivated.body.ok, true);
  assert.equal(rows.crm_developments.find((row) => row.id === id).active, false);
  assert.equal((await invoke('apiListDevelopments', [token], token)).body.some((row) => row.id === id), true);
});

test('SDR não lista empreendimentos administrativos nem exporta cadastros', async (t) => {
  const { token } = mockEnvironmentAndFetch(t, { role:'SDR', userId:userIdSdr, email:'sdr@example.test' });
  assert.equal((await invoke('apiListDevelopments', [token], token)).response.status, 403);
  assert.equal((await invoke('apiExportLeads', [token, {}], token)).response.status, 403);
});

test('importação valida duplicidades e exportações ficam restritas à gestão', async (t) => {
  const originalLeads = rows.crm_leads.slice();
  const originalAudits = rows.crm_audit.slice();
  t.after(() => { rows.crm_leads.splice(0, rows.crm_leads.length, ...originalLeads); rows.crm_audit.splice(0, rows.crm_audit.length, ...originalAudits); });
  const { token } = mockEnvironmentAndFetch(t, { role:'Gerente', userId:userIdManager, email:'gestao@example.test' });
  const duplicate = [{ name:'Duplicado', phone:'11999990001', development:'Empreendimento teste', brokerEmail:'a@example.test' }];
  const previewDuplicate = await invoke('apiPreviewLeadImport', [token, duplicate], token);
  assert.equal(previewDuplicate.body.errorCount, 1);
  const blocked = await invoke('apiImportLeads', [token, duplicate], token);
  assert.equal(blocked.body.ok, false);
  const valid = [{ name:'Importado', phone:'11999990003', development:'Empreendimento teste', brokerEmail:'b@example.test', notes:'Teste' }];
  const imported = await invoke('apiImportLeads', [token, valid], token);
  assert.equal(imported.body.ok, true, JSON.stringify(imported.body));
  assert.equal(imported.body.importedCount, 1);
  const exported = await invoke('apiExportLeads', [token, {}], token);
  assert.equal(exported.response.status, 200);
  assert.ok(exported.body.some((row) => row.name === 'Importado'));
  const report = await invoke('apiExportReport', [token, {}], token);
  assert.equal(report.response.status, 200);
  assert.equal(report.body.rows[0][0], 'categoria');
});

test('gestão configura o prazo de follow-up e o SDR não pode alterá-lo', async (t) => {
  const settingsBefore = rows.crm_settings.slice();
  const auditsBefore = rows.crm_audit.slice();
  t.after(() => { rows.crm_settings.splice(0, rows.crm_settings.length, ...settingsBefore); rows.crm_audit.splice(0, rows.crm_audit.length, ...auditsBefore); });
  const manager = mockEnvironmentAndFetch(t, { role: 'Gerente', userId: userIdManager, email: 'gestao@example.test' });
  const saved = await invoke('apiSaveFollowupDays', [manager.token, 5], manager.token);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.ok, true);
  assert.equal(rows.crm_settings.find((item) => item.key === 'followup_business_days').value.days, 5);
  const leads = await invoke('apiListLeads', [manager.token, {}, 1, 100], manager.token);
  assert.equal(leads.body.staleBusinessDays, 5);
  const invalid = await invoke('apiSaveFollowupDays', [manager.token, 31], manager.token);
  assert.equal(invalid.body.ok, false);
  const sdr = mockEnvironmentAndFetch(t, { role: 'SDR', userId: userIdSdr, email: 'sdr@example.test' });
  const denied = await invoke('apiSaveFollowupDays', [sdr.token, 6], sdr.token);
  assert.equal(denied.response.status, 403);
});

test('exclusão de cliente é reversível e preserva os dados e o histórico do SDR', async (t) => {
  const originalLeads = rows.crm_leads.slice();
  const originalHistory = rows.crm_sdr_history.slice();
  const originalEvents = rows.crm_lead_events.slice();
  const originalAudit = rows.crm_audit.slice();
  t.after(() => {
    rows.crm_leads.splice(0, rows.crm_leads.length, ...originalLeads);
    rows.crm_sdr_history.splice(0, rows.crm_sdr_history.length, ...originalHistory);
    rows.crm_lead_events.splice(0, rows.crm_lead_events.length, ...originalEvents);
    rows.crm_audit.splice(0, rows.crm_audit.length, ...originalAudit);
  });
  const id = '10000000-0000-4000-8000-000000000021';
  const lead = { id, name:'Cliente preservado', phone:'11999990021', development_id:'E001', notes:'Observação original', sdr_feedback:'Feedback original', status:'Atendimento agendado', broker_id:userIdBrokerA, created_at:'2026-11-07T10:00:00Z', created_by:userIdBrokerA, updated_at:'2026-11-08T10:00:00Z', updated_by:userIdSdr, sdr_updated_at:'2026-11-08T10:00:00Z', sdr_updated_by:userIdSdr };
  const originalLead = structuredClone(lead);
  rows.crm_leads.push(lead);
  rows.crm_sdr_history.push({ id:'history-kept', lead_id:id, at:'2026-11-08T10:00:00Z', user_id:userIdSdr, user_name:'SDR de teste', status:lead.status, feedback:lead.sdr_feedback, source:'Contato anterior' });
  rows.crm_lead_events.push({ id:'event-kept', lead_id:id, at:'2026-11-07T10:00:00Z', actor_id:userIdBrokerA, actor_name:'Corretor A', actor_role:'Corretor', event_type:'lead_created', old_status:null, new_status:'Em contato', broker_id:userIdBrokerA, development_id:'E001' });
  const { token, calls } = mockEnvironmentAndFetch(t, { role:'Gerente', userId:userIdManager, email:'gestao@example.test' });

  const archived = await invoke('apiArchiveLead', [token,id], token);
  assert.equal(archived.response.status, 200);
  assert.equal(archived.body.ok, true);
  const afterArchive = rows.crm_leads.find((item) => item.id === id);
  const { deleted_at, deleted_by, ...preserved } = afterArchive;
  assert.deepEqual(preserved, originalLead);
  assert.ok(deleted_at);
  assert.equal(deleted_by, userIdManager);
  assert.equal(rows.crm_sdr_history.some((item) => item.id === 'history-kept'), true);
  assert.equal(rows.crm_lead_events.some((item) => item.id === 'event-kept'), true);
  assert.equal((await invoke('apiListLeads', [token,{},1,100], token)).body.items.some((item) => item.id === id), false);
  assert.equal((await invoke('apiListArchivedLeads', [token,{},1,100], token)).body.items.some((item) => item.id === id), true);
  assert.equal((await invoke('apiGetSdrHistory', [token,id], token)).body[0].feedback, 'Feedback original');
  assert.equal(calls.some((call) => ['/rest/v1/crm_leads','/rest/v1/crm_sdr_history','/rest/v1/crm_lead_events'].includes(call.path) && call.method === 'DELETE'), false);

  const restored = await invoke('apiRestoreLead', [token,id], token);
  assert.equal(restored.body.ok, true);
  const afterRestore = rows.crm_leads.find((item) => item.id === id);
  const { deleted_at: restoredAt, deleted_by: restoredBy, ...restoredData } = afterRestore;
  assert.equal(restoredAt, null);
  assert.equal(restoredBy, null);
  assert.deepEqual(restoredData, originalLead);
  assert.equal((await invoke('apiListLeads', [token,{},1,100], token)).body.items.some((item) => item.id === id), true);
});

test('gestão pode excluir e restaurar usuários de todos os perfis sem apagar clientes', async (t) => {
  const originalUsers = rows.crm_users.slice();
  const originalLeads = rows.crm_leads.slice();
  const originalSessions = rows.crm_sessions.slice();
  const originalAudit = rows.crm_audit.slice();
  t.after(() => {
    rows.crm_users.splice(0, rows.crm_users.length, ...originalUsers);
    rows.crm_leads.splice(0, rows.crm_leads.length, ...originalLeads);
    rows.crm_sessions.splice(0, rows.crm_sessions.length, ...originalSessions);
    rows.crm_audit.splice(0, rows.crm_audit.length, ...originalAudit);
  });
  const added = [
    { id:'10000000-0000-4000-8000-000000000022', name:'Admin extra', email:'admin-extra@example.test', role:'Administrador', active:true, must_change_password:false, session_version:0 },
    { id:'10000000-0000-4000-8000-000000000023', name:'Gerente extra', email:'gerente-extra@example.test', role:'Gerente', active:true, must_change_password:false, session_version:0 },
    { id:'10000000-0000-4000-8000-000000000024', name:'Coordenador extra', email:'coord-extra@example.test', role:'Coordenador', active:true, must_change_password:false, session_version:0 },
    { id:'10000000-0000-4000-8000-000000000025', name:'Assistente inativa', email:'assistente-inativa@example.test', role:'Assistente', active:false, must_change_password:false, session_version:0 },
    { id:'10000000-0000-4000-8000-000000000026', name:'Assistente extra', email:'assistente-extra@example.test', role:'Assistente', active:true, must_change_password:false, session_version:0 }
  ];
  rows.crm_users.push(...added);
  const rolesToArchive = [
    rows.crm_users.find((item) => item.id === userIdSdr),
    rows.crm_users.find((item) => item.id === userIdBrokerA),
    ...added
  ];
  const wasActiveById = new Map(rolesToArchive.map((item) => [item.id, item.active === true]));
  const initialLeads = structuredClone(rows.crm_leads);
  const { token, calls, authMetadata } = mockEnvironmentAndFetch(t, { role:'Gerente', userId:userIdManager, email:'gestao@example.test' });
  const self = await invoke('apiArchiveUser', [token,userIdManager], token);
  assert.equal(self.body.ok, false);

  for (const target of rolesToArchive) {
    const wasActive = target.active;
    const before = structuredClone(target);
    rows.crm_sessions.push({ id:'session-'+target.id, user_id:target.id, refresh_token_hash:'hash-'+target.id, session_version:0, expires_at:'2099-01-01T00:00:00Z' });
    const archived = await invoke('apiArchiveUser', [token,target.id], token);
    assert.equal(archived.response.status, 200, target.role);
    assert.equal(archived.body.ok, true, target.role);
    assert.equal(target.active, false);
    assert.ok(target.deleted_at);
    assert.equal(target.deleted_by, userIdManager);
    assert.equal(target.deleted_previous_active, wasActive);
    assert.equal(target.name, before.name);
    assert.equal(target.email, before.email);
    assert.equal(target.role, before.role);
    assert.equal(rows.crm_sessions.some((item) => item.user_id === target.id), false);
    assert.equal(authMetadata.get(target.id).crm_session_version, 1);
  }
  const archivedUsers = await invoke('apiListArchivedUsers', [token], token);
  assert.equal(archivedUsers.body.length, rolesToArchive.length);
  assert.equal((await invoke('apiListUsers', [token], token)).body.some((item) => rolesToArchive.some((target) => target.id === item.id)), false);
  assert.deepEqual(rows.crm_leads, initialLeads);
  for (const target of rolesToArchive) {
    const restored = await invoke('apiRestoreUser', [token,target.id], token);
    assert.equal(restored.body.ok, true, target.role);
    assert.equal(target.active, wasActiveById.get(target.id));
    assert.equal(target.deleted_at, null);
    assert.equal(target.deleted_by, null);
    assert.equal(target.deleted_previous_active, null);
    assert.equal(target.session_version, 2);
    assert.equal(authMetadata.get(target.id).crm_session_version, 2);
  }
  assert.equal((await invoke('apiListArchivedUsers', [token], token)).body.length, 0);
  const { token: revokedToken } = mockEnvironmentAndFetch(t, { role:'SDR', userId:userIdSdr, email:'sdr@example.test' });
  assert.equal((await invoke('apiGetReferenceData', [revokedToken], revokedToken)).response.status, 401);
  assert.ok(calls.some((call) => call.path === '/rest/v1/crm_sessions' && call.method === 'DELETE'));

  const { token: brokerToken } = mockEnvironmentAndFetch(t, { role:'Corretor', userId:userIdBrokerB, email:'b@example.test' });
  assert.equal((await invoke('apiArchiveUser', [brokerToken,userIdBrokerA], brokerToken)).response.status, 403);
  assert.equal((await invoke('apiArchiveLead', [brokerToken,'10000000-0000-4000-8000-000000000021'], brokerToken)).response.status, 403);

  const { token: sdrToken } = mockEnvironmentAndFetch(t, { role:'SDR', userId:userIdSdr, email:'sdr@example.test', sessionVersion:rows.crm_users.find((item) => item.id === userIdSdr).session_version });
  assert.equal((await invoke('apiArchiveUser', [sdrToken,userIdBrokerA], sdrToken)).response.status, 403);
  assert.equal((await invoke('apiArchiveLead', [sdrToken,'10000000-0000-4000-8000-000000000021'], sdrToken)).response.status, 403);

  const authorizedManagers = [
    rows.crm_users.find((item) => item.id === userIdManager),
    ...added.filter((item) => item.active)
  ];
  for (const manager of authorizedManagers) {
    const { token: managerToken } = mockEnvironmentAndFetch(t, { role:manager.role, userId:manager.id, email:manager.email, sessionVersion:manager.session_version });
    const archived = await invoke('apiArchiveUser', [managerToken,userIdSdr], managerToken);
    assert.equal(archived.response.status, 200, manager.role);
    assert.equal(archived.body.ok, true, manager.role);
    const restored = await invoke('apiRestoreUser', [managerToken,userIdSdr], managerToken);
    assert.equal(restored.body.ok, true, manager.role);
  }
});

test('migration is private by default, grants only scoped reads and contains no user roster', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/202611090001_crm_schema.sql'), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.crm_users[\s\S]*from anon, authenticated/i);
  assert.match(sql, /create policy crm_leads_read_by_role[\s\S]*broker_id = auth\.uid\(\)/i);
  assert.match(sql, /create policy crm_sdr_history_read_by_lead/i);
  const analyticsMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261110190050_crm_management_analytics.sql'), 'utf8');
  assert.match(analyticsMigration, /enable row level security/i);
  assert.match(analyticsMigration, /create policy crm_lead_events_read_by_lead/i);
  assert.match(analyticsMigration, /after insert or update of status/i);
  assert.doesNotMatch(sql, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});

test('migration de exclusões só adiciona colunas e índices sem alterar os registros existentes', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261111152136_crm_reversible_deletions.sql'), 'utf8');
  const executableSql = sql.replace(/--[^\n]*/g, '');
  assert.match(executableSql, /alter table public\.crm_leads[\s\S]*add column if not exists deleted_at timestamptz/i);
  assert.match(executableSql, /alter table public\.crm_users[\s\S]*add column if not exists deleted_previous_active boolean/i);
  assert.match(executableSql, /create index if not exists crm_leads_deleted_at_idx/i);
  assert.doesNotMatch(executableSql, /(^|\n)\s*(insert\s+into|update\s+\w+|delete\s+from|truncate\s+)/i);
  const ui = fs.readFileSync(path.join(root, 'apps-script/Client.html'), 'utf8');
  assert.match(ui, /apiArchiveLead/);
  assert.match(ui, /apiArchiveUser/);
  assert.match(ui, /apiRestoreLead/);
  assert.match(ui, /apiRestoreUser/);
});

test('build estático não deixa marcações Apps Script nem credenciais no HTML publicado', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.doesNotMatch(html, /google\.script|<\?!=|<\?=|__MUNDO_APTO_LOGO_DATA_URI__/);
  assert.match(html, /Ativar acesso administrador/);
  assert.match(html, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(html, /SUPABASE_SECRET_KEY|Sharks@12345/);
});
