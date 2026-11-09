const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { default: handler } = require('../netlify/functions/crm.mjs');

const userIdSdr = '10000000-0000-4000-8000-000000000004';
const userIdBrokerA = '10000000-0000-4000-8000-000000000005';
const userIdBrokerB = '10000000-0000-4000-8000-000000000006';
const rows = {
  crm_users: [
    { id: userIdSdr, name: 'SDR de teste', email: 'sdr@example.test', role: 'SDR', active: true, must_change_password: false, session_version: 0 },
    { id: userIdBrokerA, name: 'Corretor A', email: 'a@example.test', role: 'Corretor', active: true, must_change_password: false, session_version: 0 },
    { id: userIdBrokerB, name: 'Corretor B', email: 'b@example.test', role: 'Corretor', active: true, must_change_password: false, session_version: 0 }
  ],
  crm_developments: [{ id: 'E001', name: 'Empreendimento teste', active: true }],
  crm_leads: [
    { id: 'lead-a', name: 'Cliente da carteira A', phone: '11999990001', development_id: 'E001', notes: 'Nota A', sdr_feedback: '', status: 'Em contato', broker_id: userIdBrokerA, created_at: '2026-11-08T10:00:00Z', created_by: userIdBrokerA, updated_at: '2026-11-08T10:00:00Z', updated_by: userIdBrokerA, sdr_updated_at: null, sdr_updated_by: null },
    { id: 'lead-b', name: 'Cliente da carteira B', phone: '11999990002', development_id: 'E001', notes: 'Nota B', sdr_feedback: '', status: 'Em contato', broker_id: userIdBrokerB, created_at: '2026-11-08T10:00:00Z', created_by: userIdBrokerB, updated_at: '2026-11-08T10:00:00Z', updated_by: userIdBrokerB, sdr_updated_at: null, sdr_updated_by: null }
  ],
  crm_sdr_history: [],
  crm_audit: [],
  crm_settings: []
};

const jwtFor = (role, userId, email) => `e30.${Buffer.from(JSON.stringify({ sub: userId, app_metadata: { role, crm_session_version: 0 } })).toString('base64url')}.signature`;

function mockEnvironmentAndFetch(t, { role = 'Corretor', userId = userIdBrokerA, email = 'a@example.test' } = {}) {
  const savedEnv = { ...process.env };
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
  process.env.CRM_BOOTSTRAP_SECRET = '';
  process.env.CRM_BOOTSTRAP_EMAIL = '';
  const token = jwtFor(role, userId, email);
  const calls = [];
  const fakeUser = { id: userId, email, app_metadata: { role, crm_session_version: 0 } };
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method || 'GET';
    calls.push({ path: url.pathname, method, query: Object.fromEntries(url.searchParams), body: options.body ? JSON.parse(options.body) : null });
    if (url.pathname === '/auth/v1/user') return Response.json(fakeUser);
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop();
      const list = rows[table] || [];
      if (method === 'GET') {
        let filtered = list;
        const idFilter = url.searchParams.get('id');
        const leadFilter = url.searchParams.get('lead_id');
        if (idFilter && idFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.id) === idFilter.slice(3));
        if (leadFilter && leadFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.lead_id) === leadFilter.slice(3));
        if (url.searchParams.get('active') === 'eq.true') filtered = filtered.filter((row) => row.active === true);
        return Response.json(filtered);
      }
      if (method === 'PATCH') {
        const idFilter = url.searchParams.get('id') || '';
        const id = idFilter.slice(3);
        const row = list.find((item) => String(item.id) === id);
        if (!row) return Response.json([], { status: 200 });
        Object.assign(row, JSON.parse(options.body));
        return Response.json([row]);
      }
      if (method === 'POST') {
        const value = JSON.parse(options.body);
        if (Array.isArray(value)) list.push(...value); else list.push(value);
        return Response.json(Array.isArray(value) ? value : [value]);
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
    }
    return Response.json({ message: 'mock route not found' }, { status: 404 });
  };
  t.after(() => { global.fetch = oldFetch; for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });
  return { token, calls };
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
  const { token } = mockEnvironmentAndFetch(t);
  const listed = await invoke('apiListLeads', [token, {}, 1, 100], token);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].id, 'lead-a');
  assert.equal(listed.body.items.some((lead) => lead.id === 'lead-b'), false);
  const forbidden = await invoke('apiSaveLead', [token, 'lead-b', { notes: 'Tentativa de cruzar carteiras' }], token);
  assert.equal(forbidden.body.ok, false);
  assert.match(forbidden.body.message, /sem permissão/);
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

test('migration is private by default, grants only scoped reads and contains no user roster', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/202611090001_crm_schema.sql'), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.crm_users[\s\S]*from anon, authenticated/i);
  assert.match(sql, /create policy crm_leads_read_by_role[\s\S]*broker_id = auth\.uid\(\)/i);
  assert.match(sql, /create policy crm_sdr_history_read_by_lead/i);
  assert.doesNotMatch(sql, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});

test('build estático não deixa marcações Apps Script nem credenciais no HTML publicado', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.doesNotMatch(html, /google\.script|<\?!=|<\?=|__MUNDO_APTO_LOGO_DATA_URI__/);
  assert.match(html, /Ativar acesso administrador/);
  assert.match(html, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|Sharks@12345/);
});
