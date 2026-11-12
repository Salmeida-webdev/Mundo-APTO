const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { default: handler } = require('../netlify/functions/crm.mjs');
const crmConfig = require('../config/seed-data.json');

const userIdSdr = '10000000-0000-4000-8000-000000000004';
const userIdBrokerA = '10000000-0000-4000-8000-000000000005';
const userIdBrokerB = '10000000-0000-4000-8000-000000000006';
const userIdManager = '10000000-0000-4000-8000-000000000007';
const userIdOtherAdmin = '10000000-0000-4000-8000-000000000008';
const rows = {
  crm_users: [
    { id: userIdSdr, name: 'SDR de teste', email: 'sdr@example.test', role: 'SDR', active: true, must_change_password: false, session_version: 0 },
    { id: userIdBrokerA, name: 'Corretor A', email: 'a@example.test', role: 'Corretor', active: true, must_change_password: false, session_version: 0 },
    { id: userIdBrokerB, name: 'Corretor B', email: 'b@example.test', role: 'Corretor', active: true, must_change_password: false, session_version: 0 },
    { id: userIdManager, name: 'Gestor de teste', email: 'gestao@example.test', role: 'Gerente', operations_access: 'viewer', active: true, must_change_password: false, session_version: 0 },
    { id: userIdOtherAdmin, name: 'Administrativo de teste', email: 'admin2@example.test', role: 'Coordenador', operations_access: 'manager', active: true, must_change_password: false, session_version: 0 }
  ],
  crm_developments: [{ id: 'E001', name: 'Empreendimento teste', active: true }],
  crm_leads: [
    { id: 'lead-a', name: 'Cliente da carteira A', phone: '11999990001', development_id: 'E001', notes: 'Nota A', sdr_feedback: '', status: 'Em contato', broker_id: userIdBrokerA, created_at: '2026-11-08T10:00:00Z', created_by: userIdBrokerA, updated_at: '2026-11-08T10:00:00Z', updated_by: userIdBrokerA, sdr_updated_at: null, sdr_updated_by: null },
    { id: 'lead-b', name: 'Cliente da carteira B', phone: '11999990002', development_id: 'E001', notes: 'Nota B', sdr_feedback: '', status: 'Em contato', broker_id: userIdBrokerB, created_at: '2026-11-08T10:00:00Z', created_by: userIdBrokerB, updated_at: '2026-11-08T10:00:00Z', updated_by: userIdBrokerB, sdr_updated_at: null, sdr_updated_by: null }
  ],
  crm_sdr_history: [],
  crm_lead_events: [],
  crm_audit: [],
  crm_lead_attempts: [],
  crm_broker_profiles: [],
  crm_sales: [],
  crm_sales_receipts: [],
  crm_contracts: [],
  crm_contract_documents: [],
  crm_production_entries: [],
  crm_production_goals: [],
  crm_attendance_records: [],
  crm_sessions: [],
  crm_settings: [],
  crm_sync_signal: [{ id: 1, changed_at: '2026-11-12T00:00:00.000Z' }]
};

const jwtFor = (role, userId, email, sessionVersion = 0) => `e30.${Buffer.from(JSON.stringify({ sub: userId, app_metadata: { role, crm_session_version: sessionVersion } })).toString('base64url')}.signature`;

function mockEnvironmentAndFetch(t, { role = 'Corretor', userId = userIdBrokerA, email = 'a@example.test', sessionVersion = 0, operationsManagerIds = [], sharedPasswordOperatorId = '' } = {}) {
  const savedEnv = { ...process.env };
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  process.env.SUPABASE_SECRET_KEY = 'service-test-key';
  process.env.CRM_BOOTSTRAP_SECRET = '';
  const token = jwtFor(role, userId, email, sessionVersion);
  const calls = [];
  const authMetadata = new Map();
  let leadCounter = 1;
  let contractCounter = 1;
  let productionCounter = 1;
  let goalCounter = 1;
  let attendanceCounter = 1;
  const fakeUser = { id: userId, email, app_metadata: { role, crm_session_version: sessionVersion } };
  const oldFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method || 'GET';
    let requestBody=null;
    if(options.body){if(Buffer.isBuffer(options.body))requestBody=options.body.toString('utf8');else{try{requestBody=JSON.parse(options.body);}catch{requestBody=String(options.body);}}}
    calls.push({ path: url.pathname, method, query: Object.fromEntries(url.searchParams), headers: options.headers || {}, body: requestBody });
    if (url.pathname === '/auth/v1/user') return Response.json(fakeUser);
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') return Response.json({ access_token: token, refresh_token: 'refresh-token-for-test', expires_in: 3600, user: fakeUser });
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
    if(url.pathname.startsWith('/storage/v1/')){
      if(url.pathname.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/crm-contracts/test-document?token=signed'});
      if(url.pathname.includes('/object/upload/sign/'))return Response.json({signedURL:'/object/upload/sign/crm-contracts/test-upload',token:'upload-token'});
      if(url.pathname.includes('/object/info/'))return Response.json({name:'uploaded-document'});
      return Response.json({});
    }
    if (url.pathname === '/rest/v1/rpc/crm_add_contact_attempt') {
      const payload = JSON.parse(options.body);
      const lead = rows.crm_leads.find((item) => item.id === payload.p_lead_id && !item.deleted_at);
      if (!lead) return Response.json({ message:'lead_not_found' }, { status:400 });
      const attemptNumber = rows.crm_lead_attempts.filter((item) => item.lead_id === lead.id).length + 1;
      if (attemptNumber > 7) return Response.json({ message:'attempt_limit_reached' }, { status:400 });
      const at = new Date().toISOString();
      const attempt = { id:`attempt-${attemptNumber}`, lead_id:lead.id, attempt_number:attemptNumber, at, actor_id:payload.p_actor_id, actor_name:payload.p_actor_name, status_at_attempt:lead.status, notes:payload.p_notes || '' };
      rows.crm_lead_attempts.push(attempt);
      Object.assign(lead, { sdr_updated_at:at, sdr_updated_by:payload.p_actor_id, updated_at:at, updated_by:payload.p_actor_id });
      rows.crm_sdr_history.push({ id:`history-attempt-${attemptNumber}`, lead_id:lead.id, at, user_id:payload.p_actor_id, user_name:payload.p_actor_name, status:lead.status, feedback:payload.p_notes || 'Tentativa registrada sem observação adicional.', source:`Tentativa ${attemptNumber} de contato registrada` });
      return Response.json([attempt]);
    }
    if (url.pathname === '/rest/v1/rpc/crm_add_sale_receipt') {
      const payload = JSON.parse(options.body);
      const sale = rows.crm_sales.find((item) => item.id === payload.p_sale_id && !item.deleted_at);
      if (!sale) return Response.json({ message:'sale_not_found' }, { status:400 });
      const prior = rows.crm_sales_receipts.filter((item) => item.sale_id === sale.id && !item.voided_at).reduce((sum,item)=>sum+Number(item.amount),0);
      const total = Math.round((prior + Number(payload.p_amount))*100)/100;
      const previousStatus = sale.repass_status;
      const status = sale.repass_status;
      const receipt = { id:`receipt-${rows.crm_sales_receipts.length+1}`, sale_id:sale.id, amount:Number(payload.p_amount), received_at:payload.p_received_at, notes:payload.p_notes || '', created_by:payload.p_actor_id, created_at:new Date().toISOString() };
      rows.crm_sales_receipts.push(receipt); sale.updated_by=payload.p_actor_id;
      return Response.json([{ receipt_id:receipt.id, received_total:total, balance:Math.round((Number(sale.expected_repass)-total)*100)/100, repass_status:status, previous_status:previousStatus }]);
    }
    if (url.pathname === '/rest/v1/rpc/crm_void_sale_receipt') {
      const payload = JSON.parse(options.body);
      const receipt = rows.crm_sales_receipts.find((item) => item.id === payload.p_receipt_id);
      if (!receipt) return Response.json({ message:'receipt_not_found' }, { status:400 });
      if (receipt.voided_at) return Response.json({ message:'receipt_already_voided' }, { status:400 });
      const sale = rows.crm_sales.find((item) => item.id === receipt.sale_id);
      if (!sale) return Response.json({ message:'sale_not_found' }, { status:400 });
      const active = rows.crm_sales_receipts.filter((item) => item.sale_id === sale.id && !item.voided_at);
      const previous = Math.round(active.reduce((sum,item)=>sum+Number(item.amount),0)*100)/100;
      receipt.voided_at = new Date().toISOString(); receipt.voided_by = payload.p_actor_id; receipt.void_reason = payload.p_reason;
      const total = Math.round(rows.crm_sales_receipts.filter((item)=>item.sale_id===sale.id&&!item.voided_at).reduce((sum,item)=>sum+Number(item.amount),0)*100)/100;
      sale.updated_by=payload.p_actor_id; sale.updated_at=receipt.voided_at;
      return Response.json([{ sale_id:sale.id,receipt_id:receipt.id,amount:Number(receipt.amount),received_at:receipt.received_at,notes:receipt.notes||'',previous_received_total:previous,received_total:total,balance:Math.round((Number(sale.expected_repass)-total)*100)/100,repass_status:sale.repass_status }]);
    }
    if (url.pathname === '/rest/v1/rpc/crm_save_operation_goal') {
      const payload=JSON.parse(options.body);
      const previous=rows.crm_production_goals.find((item)=>item.broker_id===payload.p_broker_id&&item.metric===payload.p_metric&&item.cycle===payload.p_cycle&&item.starts_on===payload.p_starts_on&&item.ends_on===payload.p_ends_on&&item.is_current);
      const revision=previous?Number(previous.revision)+1:1;
      if(previous)previous.is_current=false;
      const saved={id:'10000000-0000-4000-8000-'+String(500+goalCounter++).padStart(12,'0'),broker_id:payload.p_broker_id,metric:payload.p_metric,cycle:payload.p_cycle,starts_on:payload.p_starts_on,ends_on:payload.p_ends_on,target_count:payload.p_target_count,revision,supersedes_id:previous?previous.id:null,is_current:true,created_at:new Date().toISOString(),created_by:payload.p_actor_id};
      rows.crm_production_goals.push(saved);return Response.json([saved]);
    }
    if (url.pathname === '/rest/v1/rpc/crm_set_attendance') {
      const payload=JSON.parse(options.body);
      let record=rows.crm_attendance_records.find((item)=>item.broker_id===payload.p_broker_id&&item.attendance_date===payload.p_attendance_date&&item.shift===payload.p_shift&&!item.deleted_at);
      if(payload.p_present&&!record){record={id:'10000000-0000-4000-8000-'+String(600+attendanceCounter++).padStart(12,'0'),broker_id:payload.p_broker_id,attendance_date:payload.p_attendance_date,shift:payload.p_shift,created_at:new Date().toISOString(),created_by:payload.p_actor_id,updated_at:new Date().toISOString(),updated_by:payload.p_actor_id};rows.crm_attendance_records.push(record);}
      else if(!payload.p_present&&record){record.deleted_at=new Date().toISOString();record.deleted_by=payload.p_actor_id;record.updated_at=record.deleted_at;record.updated_by=payload.p_actor_id;}
      return Response.json(record?[record]:[]);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop();
      const list = rows[table] || [];
      if (method === 'GET') {
        if (table === 'crm_settings' && url.searchParams.get('key') === 'eq.operations_access_policy') {
          return Response.json([{ key: 'operations_access_policy', value: { operations_manager_ids: operationsManagerIds, shared_password_operator_id: sharedPasswordOperatorId } }]);
        }
        let filtered = list;
        const idFilter = url.searchParams.get('id');
        const leadFilter = url.searchParams.get('lead_id');
        const keyFilter = url.searchParams.get('key');
        const userFilter = url.searchParams.get('user_id');
        const deletedFilter = url.searchParams.get('deleted_at');
        const entityFilter = url.searchParams.get('entity_type');
        const brokerFilter = url.searchParams.get('broker_id');
        const saleFilter = url.searchParams.get('sale_id');
        const contractFilter = url.searchParams.get('contract_id');
        const documentTypeFilter = url.searchParams.get('document_type');
        const cycleFilter = url.searchParams.get('cycle');
        const metricFilter = url.searchParams.get('metric');
        const currentFilter = url.searchParams.get('is_current');
        const startsFilter = url.searchParams.get('starts_on');
        const endsFilter = url.searchParams.get('ends_on');
        const workDateFilter = url.searchParams.get('work_date');
        const attendanceDateFilter = url.searchParams.get('attendance_date');
        const shiftFilter = url.searchParams.get('shift');
        if (idFilter && idFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.id) === idFilter.slice(3));
        if (leadFilter && leadFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.lead_id) === leadFilter.slice(3));
        if (keyFilter && keyFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.key) === keyFilter.slice(3));
        if (userFilter && userFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.user_id) === userFilter.slice(3));
        if (entityFilter && entityFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.entity_type) === entityFilter.slice(3));
        if (brokerFilter && brokerFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.broker_id) === brokerFilter.slice(3));
        if (saleFilter && saleFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.sale_id) === saleFilter.slice(3));
        if (contractFilter && contractFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.contract_id) === contractFilter.slice(3));
        if (documentTypeFilter && documentTypeFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.document_type) === documentTypeFilter.slice(3));
        if (cycleFilter && cycleFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.cycle) === cycleFilter.slice(3));
        if (metricFilter && metricFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.metric) === metricFilter.slice(3));
        if (currentFilter && currentFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.is_current) === currentFilter.slice(3));
        if (startsFilter && startsFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.starts_on) === startsFilter.slice(3));
        if (endsFilter && endsFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.ends_on) === endsFilter.slice(3));
        if (workDateFilter && workDateFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.work_date) === workDateFilter.slice(3));
        if (attendanceDateFilter && attendanceDateFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.attendance_date) === attendanceDateFilter.slice(3));
        if (shiftFilter && shiftFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.shift) === shiftFilter.slice(3));
        if (deletedFilter === 'is.null') filtered = filtered.filter((row) => !row.deleted_at);
        if (deletedFilter === 'not.is.null') filtered = filtered.filter((row) => Boolean(row.deleted_at));
        const andFilter=url.searchParams.get('and')||'';
        for(const match of andFilter.matchAll(/([a-z_]+)\.(gte|lte)\.([^,)]+)/g)){
          const [,field,operator,value]=match;
          filtered=filtered.filter((row)=>row[field]&& (operator==='gte'?String(row[field])>=value:String(row[field])<=value));
        }
        if (url.searchParams.get('active') === 'eq.true') filtered = filtered.filter((row) => row.active === true);
        const order = url.searchParams.get('order');
        if (order) { const specs=order.split(',').map((value)=>value.split('.')); filtered = filtered.slice().sort((a,b)=>{for(const [field,direction] of specs){const compare=String(a[field]||'').localeCompare(String(b[field]||''))*(direction==='desc'?-1:1);if(compare)return compare;}return 0;}); }
        const total = filtered.length; const rangeMatch = String(options.headers.Range || '').match(/^(\d+)-(\d+)$/); const offset = Number(url.searchParams.get('offset') || (rangeMatch ? rangeMatch[1] : 0)); const limit = Number(url.searchParams.get('limit') || (rangeMatch ? Number(rangeMatch[2])-Number(rangeMatch[1])+1 : total || 1000));
        filtered = filtered.slice(offset, offset + limit);
        const headers = options.headers && String(options.headers.Prefer || '').includes('count=exact') ? { 'content-range': `${offset}-${Math.max(offset,offset+filtered.length-1)}/${total}` } : undefined;
        return Response.json(filtered, { headers });
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
        if (table === 'crm_sales') {
          const entries = (Array.isArray(value) ? value : [value]).map((item) => ({ ...item, id: item.id || '10000000-0000-4000-8000-000000000041' }));
          list.push(...entries);
          return Response.json(entries);
        }
        if (table === 'crm_contracts') {
          const entries = (Array.isArray(value) ? value : [value]).map((item) => {
            const grossCommission=Number(item.gross_commission||0);const grossPrize=Number(item.gross_prize||0);
            return { ...item, id: item.id || `10000000-0000-4000-8000-${String(100 + contractCounter++).padStart(12,'0')}`,
              broker_commission:Math.floor(grossCommission*50)/100,sdr_commission:grossCommission-Math.floor(grossCommission*50)/100,
              broker_prize:Math.floor(grossPrize*50)/100,sdr_prize:grossPrize-Math.floor(grossPrize*50)/100 };
          });
          list.push(...entries);
          return Response.json(entries);
        }
        if (table === 'crm_contract_documents') {
          const entries=(Array.isArray(value)?value:[value]).map((item)=>({...item,id:item.id||`10000000-0000-4000-8000-${String(300+list.length+1).padStart(12,'0')}`}));
          list.push(...entries);
          return Response.json(entries);
        }
        if (table === 'crm_production_entries') {
          const entries=(Array.isArray(value)?value:[value]).map((item)=>({...item,id:item.id||'10000000-0000-4000-8000-'+String(700+productionCounter++).padStart(12,'0')}));
          list.push(...entries);return Response.json(entries);
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

function operationToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function operationShiftDate(value, amount) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

test('produção aceita lançamentos repetidos e históricos, mantém auditoria e bloqueia carteiras cruzadas', async (t) => {
  const originals={entries:rows.crm_production_entries.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_production_entries.splice(0,rows.crm_production_entries.length,...originals.entries);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const brokerA=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const oldDate=operationShiftDate(operationToday(),-3);
  const payload={workDate:oldDate,prospections:4,interactions:3,appointments:2,visits:1,sales:0,notes:'Primeiro lançamento histórico'};
  const first=await invoke('apiSaveProduction',[brokerA.token,payload],brokerA.token);
  const second=await invoke('apiSaveProduction',[brokerA.token,{...payload,prospections:2,notes:'Segundo lançamento no mesmo dia'}],brokerA.token);
  assert.equal(first.body.ok,true,JSON.stringify(first.body));
  assert.equal(second.body.ok,true,JSON.stringify(second.body));
  assert.equal(rows.crm_production_entries.length,2);
  const edited=await invoke('apiSaveProduction',[brokerA.token,{...payload,id:first.body.id,prospections:5,notes:'Correção feita depois'}],brokerA.token);
  assert.equal(edited.body.ok,true,JSON.stringify(edited.body));
  assert.equal(rows.crm_audit.at(-1).action,'operations.production.update');
  assert.equal(rows.crm_audit.at(-1).before_values.prospections,4);
  assert.equal(rows.crm_audit.at(-1).after_values.prospections,5);
  const dashboard=await invoke('apiGetOperationsDashboard',[brokerA.token,{period:'day'}],brokerA.token);
  assert.equal(dashboard.body.recentOwnEntries.length,2);
  assert.ok(dashboard.body.recentOwnEntries.every((item)=>item.workDate===oldDate));
  const cancelled=await invoke('apiArchiveProduction',[brokerA.token,second.body.id],brokerA.token);
  assert.equal(cancelled.body.ok,true,JSON.stringify(cancelled.body));
  assert.ok(rows.crm_production_entries.find((row)=>row.id===second.body.id).deleted_at);
  assert.equal(rows.crm_audit.at(-1).action,'operations.production.cancel');
  const brokerB=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerB,email:'b@example.test'});
  const forbiddenEdit=await invoke('apiSaveProduction',[brokerB.token,{...payload,id:first.body.id,prospections:99}],brokerB.token);
  const forbiddenCancel=await invoke('apiArchiveProduction',[brokerB.token,first.body.id],brokerB.token);
  const brokerBRows=await invoke('apiListProduction',[brokerB.token,{dateFrom:oldDate,dateTo:oldDate}],brokerB.token);
  assert.equal(forbiddenEdit.response.status,403);
  assert.equal(forbiddenCancel.response.status,403);
  assert.equal(brokerBRows.body.length,0);
});

test('somente as contas allowlistadas corrigem a equipe e a frequência; SDR consulta, corretores veem a própria', async (t) => {
  const originals={entries:rows.crm_production_entries.slice(),attendance:rows.crm_attendance_records.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_production_entries.splice(0,rows.crm_production_entries.length,...originals.entries);rows.crm_attendance_records.splice(0,rows.crm_attendance_records.length,...originals.attendance);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test',operationsManagerIds:[userIdManager]});
  const day=operationShiftDate(operationToday(),-1);
  const markA=await invoke('apiSetAttendance',[manager.token,{brokerId:userIdBrokerA,attendanceDate:day,shift:'morning',present:true}],manager.token);
  const markA2=await invoke('apiSetAttendance',[manager.token,{brokerId:userIdBrokerA,attendanceDate:day,shift:'afternoon',present:true}],manager.token);
  const markB=await invoke('apiSetAttendance',[manager.token,{brokerId:userIdBrokerB,attendanceDate:day,shift:'night',present:true}],manager.token);
  assert.equal(markA.body.ok,true,JSON.stringify(markA.body));
  assert.equal(markA2.body.ok,true,JSON.stringify(markA2.body));
  assert.equal(markB.body.ok,true,JSON.stringify(markB.body));
  const duplicate=await invoke('apiSetAttendance',[manager.token,{brokerId:userIdBrokerA,attendanceDate:day,shift:'morning',present:true}],manager.token);
  assert.equal(duplicate.body.unchanged,true);
  const future=await invoke('apiSetAttendance',[manager.token,{brokerId:userIdBrokerA,attendanceDate:operationShiftDate(operationToday(),1),shift:'afternoon',present:true}],manager.token);
  assert.equal(future.body.ok,false);
  const managerEntry=await invoke('apiSaveProduction',[manager.token,{brokerId:userIdBrokerB,workDate:day,prospections:1,interactions:1,appointments:0,visits:0,sales:0}],manager.token);
  assert.equal(managerEntry.body.ok,true,JSON.stringify(managerEntry.body));
  const cancelled=await invoke('apiSetAttendance',[manager.token,{brokerId:userIdBrokerA,attendanceDate:day,shift:'morning',present:false}],manager.token);
  assert.equal(cancelled.body.ok,true,JSON.stringify(cancelled.body));
  assert.equal(rows.crm_audit.at(-1).action,'operations.attendance.cancel');
  const unauthorized=mockEnvironmentAndFetch(t,{role:'Coordenador',userId:userIdOtherAdmin,email:'admin2@example.test'});
  const deniedAttendance=await invoke('apiSetAttendance',[unauthorized.token,{brokerId:userIdBrokerA,attendanceDate:day,shift:'afternoon',present:true}],unauthorized.token);
  const deniedProduction=await invoke('apiSaveProduction',[unauthorized.token,{brokerId:userIdBrokerB,workDate:day,prospections:9}],unauthorized.token);
  assert.equal(deniedAttendance.response.status,403);
  assert.equal(deniedProduction.response.status,403);
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const ownAttendance=await invoke('apiListAttendance',[broker.token,{dateFrom:day,dateTo:day}],broker.token);
  assert.equal(ownAttendance.body.length,1,JSON.stringify({day,attendance:rows.crm_attendance_records,body:ownAttendance.body}));
  assert.equal(ownAttendance.body[0].brokerId,userIdBrokerA);
  const sdr=mockEnvironmentAndFetch(t,{role:'SDR',userId:userIdSdr,email:'sdr@example.test'});
  const teamAttendance=await invoke('apiListAttendance',[sdr.token,{dateFrom:day,dateTo:day}],sdr.token);
  assert.equal(teamAttendance.body.length,2);
});

test('metas semanais e mensais preservam revisões e o painel diário calcula progresso do ciclo atual', async (t) => {
  const originals={entries:rows.crm_production_entries.slice(),goals:rows.crm_production_goals.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_production_entries.splice(0,rows.crm_production_entries.length,...originals.entries);rows.crm_production_goals.splice(0,rows.crm_production_goals.length,...originals.goals);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test',operationsManagerIds:[userIdManager]});
  const today=operationToday();const weekday=new Date(today+'T00:00:00Z').getUTCDay();const monday=operationShiftDate(today,-((weekday+6)%7));
  rows.crm_production_entries.push(
    {id:'10000000-0000-4000-8000-000000000711',broker_id:userIdBrokerA,work_date:monday,prospecting_count:4,interaction_count:0,appointment_count:0,visit_count:2,sale_count:1,notes:'',created_at:new Date().toISOString(),created_by:userIdBrokerA,updated_at:new Date().toISOString(),updated_by:userIdBrokerA},
    {id:'10000000-0000-4000-8000-000000000712',broker_id:userIdBrokerA,work_date:today,prospecting_count:3,interaction_count:1,appointment_count:0,visit_count:1,sale_count:0,notes:'',created_at:new Date().toISOString(),created_by:userIdBrokerA,updated_at:new Date().toISOString(),updated_by:userIdBrokerA}
  );
  const weekly1=await invoke('apiSaveOperationGoal',[manager.token,{brokerId:userIdBrokerA,metric:'prospections',cycle:'weekly',referenceDate:today,target:10}],manager.token);
  const weekly2=await invoke('apiSaveOperationGoal',[manager.token,{brokerId:userIdBrokerA,metric:'prospections',cycle:'weekly',referenceDate:today,target:12}],manager.token);
  const monthly=await invoke('apiSaveOperationGoal',[manager.token,{brokerId:userIdBrokerA,metric:'visits',cycle:'monthly',referenceDate:today,target:20}],manager.token);
  assert.equal(weekly1.body.revision,1);
  assert.equal(weekly2.body.revision,2);
  assert.equal(monthly.body.revision,1);
  const daily=await invoke('apiGetOperationsDashboard',[manager.token,{period:'day'}],manager.token);
  assert.equal(daily.body.period.periodType,'day');
  assert.equal(daily.body.totals.prospections,today===monday?7:3);
  const weeklyProgress=daily.body.goals.find((item)=>item.brokerId===userIdBrokerA).metrics.prospections;
  assert.equal(weeklyProgress.target,12);
  assert.equal(weeklyProgress.actual,7);
  assert.equal(weeklyProgress.remaining,5);
  const history=await invoke('apiListOperationGoals',[manager.token,{brokerId:userIdBrokerA}],manager.token);
  assert.equal(history.body.filter((item)=>item.metric==='prospections').length,2);
  assert.equal(history.body.find((item)=>item.revision===1).isCurrent,false);
  assert.equal(history.body.find((item)=>item.revision===2).isCurrent,true);
  assert.ok(daily.body.latestUpdatedAt);
});

test('senha inicial compartilhada é bloqueada para qualquer conta fora do operador técnico configurado', async (t) => {
  const actor=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test',operationsManagerIds:[userIdManager],sharedPasswordOperatorId:userIdOtherAdmin});
  const denied=await invoke('apiApplySharedTemporaryPassword',[actor.token,'SenhaTemporariaDeTeste#2026'],actor.token);
  assert.equal(denied.response.status,403);
  assert.match(denied.body.message,/operador técnico configurado/i);
  assert.equal(actor.calls.some((call)=>call.path==='/auth/v1/admin/users'),false);
});

test('login carrega a política privada antes de devolver permissões de operação', async (t) => {
  const originals = rows.crm_sessions.slice();
  t.after(() => rows.crm_sessions.splice(0, rows.crm_sessions.length, ...originals));
  const manager = mockEnvironmentAndFetch(t, { role: 'Gerente', userId: userIdManager, email: 'gestao@example.test', operationsManagerIds: [userIdManager] });
  const response = await invoke('apiLogin', ['gestao@example.test', 'senha-de-teste'], manager.token);
  assert.equal(response.body.ok, true, JSON.stringify(response.body));
  assert.equal(response.body.user.canManageOperations, true);
  assert.equal(response.body.user.operationsAccess, 'manager');
  assert.ok(manager.calls.findIndex((call) => call.path === '/rest/v1/crm_settings' && call.query.key === 'eq.operations_access_policy') < manager.calls.findIndex((call) => call.path === '/rest/v1/crm_sessions' && call.method === 'POST'));
});

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
  const originalUsers = structuredClone(rows.crm_users);
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

test('SDR separa clientes novos e registra a 7ª tentativa sem mudar o status automaticamente', async (t) => {
  const originals = { leads:rows.crm_leads.slice(), attempts:rows.crm_lead_attempts.slice(), history:rows.crm_sdr_history.slice(), audit:rows.crm_audit.slice() };
  t.after(() => { rows.crm_leads.splice(0,rows.crm_leads.length,...originals.leads); rows.crm_lead_attempts.splice(0,rows.crm_lead_attempts.length,...originals.attempts); rows.crm_sdr_history.splice(0,rows.crm_sdr_history.length,...originals.history); rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit); });
  const id = '10000000-0000-4000-8000-000000000031';
  rows.crm_leads.push({ id, name:'Lead sem primeiro contato', phone:'11999990031', development_id:'E001', notes:'', sdr_feedback:'', status:'Em contato', broker_id:userIdBrokerA, created_at:'2026-11-08T10:00:00Z', created_by:userIdBrokerA, updated_at:'2026-11-08T10:00:00Z', updated_by:userIdBrokerA, sdr_updated_at:null, sdr_updated_by:null });
  for (let attempt=1;attempt<=6;attempt++) rows.crm_lead_attempts.push({ id:`attempt-${attempt}`, lead_id:id, attempt_number:attempt, at:`2026-11-0${attempt+1}T10:00:00Z`, actor_id:userIdSdr, actor_name:'SDR de teste', status_at_attempt:'Em contato', notes:'' });
  const { token } = mockEnvironmentAndFetch(t,{role:'SDR',userId:userIdSdr,email:'sdr@example.test'});
  const newQueue = await invoke('apiListLeads',[token,{},1,100,'new'],token);
  assert.equal(newQueue.response.status,200,JSON.stringify(newQueue.body));
  assert.ok(newQueue.body.items.some((lead)=>lead.id===id));
  const before = rows.crm_leads.find((lead)=>lead.id===id);
  const priorStatus = before.status;
  const saved = await invoke('apiAddLeadAttempt',[token,id,'Sem retorno na ligação'],token);
  assert.equal(saved.body.ok,true);
  assert.equal(saved.body.number,7);
  assert.equal(saved.body.reminder,true);
  assert.equal(before.status,priorStatus);
  assert.ok(before.sdr_updated_at);
  assert.equal(rows.crm_sdr_history.at(-1).source,'Tentativa 7 de contato registrada');
  assert.equal(rows.crm_sdr_history.at(-1).feedback,'Sem retorno na ligação');
  const worklist = await invoke('apiGetSdrWorklist',[token],token);
  assert.equal(worklist.body.newLeads.some((lead)=>lead.id===id),false);
  assert.equal(worklist.body.followupAlerts.some((lead)=>lead.id===id),false);
  assert.equal(worklist.body.sevenAttemptAlerts.some((lead)=>lead.id===id),true);
  const attemptHistory = await invoke('apiListLeadAttempts',[token,id],token);
  assert.equal(attemptHistory.body.length,7);
  assert.equal(attemptHistory.body.at(-1).statusAtAttempt,'Em contato');
});

test('telefone incorreto vira pendência para a carteira; só o corretor responsável corrige o próprio número', async (t) => {
  const originals = { leads:rows.crm_leads.slice(), audit:rows.crm_audit.slice(), history:rows.crm_sdr_history.slice() };
  t.after(() => { rows.crm_leads.splice(0,rows.crm_leads.length,...originals.leads); rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit); rows.crm_sdr_history.splice(0,rows.crm_sdr_history.length,...originals.history); });
  const id='10000000-0000-4000-8000-000000000032';
  rows.crm_leads.push({ id, name:'Telefone pendente', phone:'11999990032', development_id:'E001', notes:'', sdr_feedback:'', status:'Em contato', broker_id:userIdBrokerA, created_at:'2026-11-08T10:00:00Z', created_by:userIdBrokerA, updated_at:'2026-11-08T10:00:00Z', updated_by:userIdBrokerA, sdr_updated_at:null, sdr_updated_by:null, phone_correction_required:false });
  const sdr=mockEnvironmentAndFetch(t,{role:'SDR',userId:userIdSdr,email:'sdr@example.test'});
  const flagged=await invoke('apiFlagPhoneIncorrect',[sdr.token,id,'Número não completa a chamada'],sdr.token);
  assert.equal(flagged.body.ok,true,JSON.stringify(flagged.body));
  const lead=rows.crm_leads.find((item)=>item.id===id);
  assert.equal(lead.phone_correction_required,true);
  assert.equal(lead.sdr_updated_by,userIdSdr);
  assert.ok(Date.now()-new Date(lead.sdr_updated_at).getTime()<5000);
  assert.equal(rows.crm_sdr_history.at(-1).source,'Telefone incorreto: correção solicitada ao corretor');
  assert.equal(rows.crm_sdr_history.at(-1).feedback,'Número não completa a chamada');
  const worklist=await invoke('apiGetSdrWorklist',[sdr.token],sdr.token);
  assert.equal(worklist.body.newLeads.some((item)=>item.id===id),false);
  assert.equal(worklist.body.followupAlerts.some((item)=>item.id===id),false);
  assert.equal(worklist.body.phoneCorrections.some((item)=>item.id===id),true);
});

test('configuração Realtime só entrega chave pública a usuário autenticado', async (t) => {
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const refs=await invoke('apiGetReferenceData',[manager.token],manager.token);
  assert.equal(refs.response.status,200);
  assert.deepEqual(refs.body.realtime,{url:'https://supabase.example.test',publishableKey:'public-test-key'});
  assert.equal(JSON.stringify(refs.body).includes('service-test-key'),false);
});

test('corretor remove a pendência ao atualizar o telefone da própria carteira', async (t) => {
  const originals = { leads:rows.crm_leads.slice(), audit:rows.crm_audit.slice() };
  t.after(() => { rows.crm_leads.splice(0,rows.crm_leads.length,...originals.leads); rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit); });
  const id='10000000-0000-4000-8000-000000000033';
  rows.crm_leads.push({ id, name:'Corrigir contato', phone:'11999990033', development_id:'E001', notes:'', sdr_feedback:'', status:'Em contato', broker_id:userIdBrokerA, created_at:'2026-11-08T10:00:00Z', created_by:userIdBrokerA, updated_at:'2026-11-08T10:00:00Z', updated_by:userIdBrokerA, sdr_updated_at:null, sdr_updated_by:null, phone_correction_required:true, phone_correction_requested_at:'2026-11-08T11:00:00Z', phone_correction_requested_by:userIdSdr, phone_correction_notes:'Número inválido' });
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const saved=await invoke('apiSaveLead',[broker.token,id,{name:'Corrigir contato',phone:'11988880033',developmentId:'E001',notes:''}],broker.token);
  assert.equal(saved.body.ok,true,JSON.stringify(saved.body));
  const lead=rows.crm_leads.find((item)=>item.id===id);
  assert.equal(lead.phone,'11988880033');
  assert.equal(lead.phone_correction_required,false);
  assert.equal(lead.phone_corrected_by,userIdBrokerA);
});

test('auditoria pagina todo o histórico e permanece restrita à gestão', async (t) => {
  const originals=rows.crm_audit.slice();
  t.after(()=>rows.crm_audit.splice(0,rows.crm_audit.length,...originals));
  rows.crm_audit.push(
    { id:'audit-ext-1',at:'2026-11-10T10:00:00Z',user_id:userIdManager,email:'gestao@example.test',actor_name:'Gestor de teste',actor_role:'Gerente',action:'test.update',entity_type:'test_only',entity_id:'cliente-1',changed_fields:'status',before_values:{status:'Em contato'},after_values:{status:'Atendimento agendado'} },
    { id:'audit-ext-2',at:'2026-11-11T10:00:00Z',user_id:userIdManager,email:'gestao@example.test',actor_name:'Gestor de teste',actor_role:'Gerente',action:'test.create',entity_type:'test_only',entity_id:'venda-1',changed_fields:'buyerName',before_values:{},after_values:{buyerName:'Cliente'} }
  );
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const filters={entityType:'test_only'};
  const first=await invoke('apiListAudit',[manager.token,filters,1,1],manager.token);
  const second=await invoke('apiListAudit',[manager.token,filters,2,1],manager.token);
  assert.equal(first.body.total,2);
  assert.equal(first.body.items.length,1);
  assert.equal(second.body.items.length,1);
  assert.equal(first.body.items[0].id,'audit-ext-2');
  assert.equal(second.body.items[0].beforeValues.status,'Em contato');
  const sdr=mockEnvironmentAndFetch(t,{role:'SDR',userId:userIdSdr,email:'sdr@example.test'});
  assert.equal((await invoke('apiListAudit',[sdr.token,{},1,100],sdr.token)).response.status,403);
});

test('contrato usa o modelo Mundo Apto, divide a remuneração e só libera o assinado aos participantes', async (t) => {
  const originals={users:rows.crm_users.slice(),leads:rows.crm_leads.slice(),contracts:rows.crm_contracts.slice(),documents:rows.crm_contract_documents.slice(),profiles:rows.crm_broker_profiles.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_users.splice(0,rows.crm_users.length,...originals.users);rows.crm_leads.splice(0,rows.crm_leads.length,...originals.leads);rows.crm_contracts.splice(0,rows.crm_contracts.length,...originals.contracts);rows.crm_contract_documents.splice(0,rows.crm_contract_documents.length,...originals.documents);rows.crm_broker_profiles.splice(0,rows.crm_broker_profiles.length,...originals.profiles);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const coordinatorId='10000000-0000-4000-8000-000000000034';
  rows.crm_users.push({id:coordinatorId,name:'Coordenador de teste',email:'coord@example.test',role:'Coordenador',active:true,must_change_password:false,session_version:0});
  const leadId='10000000-0000-4000-8000-000000000035';
  rows.crm_leads.push({id:leadId,name:'Cliente do contrato',phone:'11999990035',development_id:'E001',notes:'',sdr_feedback:'',status:'Atendimento realizado',broker_id:userIdBrokerA,created_at:'2026-11-08T10:00:00Z',created_by:userIdBrokerA,updated_at:'2026-11-08T10:00:00Z',updated_by:userIdManager,sdr_updated_at:'2026-11-09T10:00:00Z',sdr_updated_by:userIdSdr});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const refs=await invoke('apiGetReferenceData',[manager.token],manager.token);
  assert.deepEqual(refs.body.managers.map((item)=>item.id),[userIdManager]);
  const draft=await invoke('apiSaveContract',[manager.token,{leadId,brokerId:userIdBrokerA,sdrId:userIdSdr,managerId:coordinatorId,unit:'A-101',unitValue:200000,grossCommission:5000}],manager.token);
  assert.equal(draft.body.ok,false);
  assert.match(draft.body.message,/gerente/i);
  const saved=await invoke('apiSaveContract',[manager.token,{leadId,brokerId:userIdBrokerA,sdrId:userIdSdr,sdrCpf:'111.222.333-44',managerId:userIdManager,buyerName:'Cliente do contrato',buyerCpf:'222.333.444-55',proposalNumber:'PASTA-2026-15',developmentId:'E001',unit:'A-101',unitValue:200000,commissionBase:200000,commissionRatePct:2.5,grossCommission:5000,hasPrize:true,prizeRatePct:1.2,grossPrize:1000}],manager.token);
  assert.equal(saved.response.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.ok,true);
  const contract=rows.crm_contracts.find((item)=>item.id===saved.body.contractId);
  assert.equal(contract.proposal_number,'PASTA-2026-15');
  assert.equal(contract.sdr_cpf,'111.222.333-44');
  assert.equal(Number(contract.commission_base),200000);
  assert.equal(Number(contract.commission_rate_pct),2.5);
  assert.equal(Number(contract.prize_rate_pct),1.2);
  const template=await invoke('apiGetContractTemplate',[manager.token],manager.token);
  assert.match(template.body.template,/PROJETO SDR SHARKS \| MUNDO APTO/);
  assert.match(template.body.template,/{{numero_proposta}}/);
  assert.match(template.body.template,/{{sdr_cpf}}/);
  assert.match(template.body.template,/{{comissao_corretor}}/);
  assert.match(template.body.template,/{{corretor_cnpj}}/);
  assert.match(template.body.template,/{{corretor_endereco}}/);
  const brokerProfile={broker_id:userIdBrokerA,cpf:'111.222.333-44',cnpj:'',creci:'12345',address:'Rua de Teste, 100'};
  rows.crm_broker_profiles.push(brokerProfile);
  const missingCnpj=await invoke('apiGenerateContract',[manager.token,saved.body.contractId],manager.token);
  assert.equal(missingCnpj.body.ok,false);
  assert.match(missingCnpj.body.message,/CNPJ/i);
  brokerProfile.cnpj='12.345.678/0001-90';
  const generated=await invoke('apiGenerateContract',[manager.token,saved.body.contractId],manager.token);
  assert.equal(generated.response.status,200,JSON.stringify(generated.body));
  assert.equal(generated.body.ok,true);
  assert.match(generated.body.downloadUrl,/download=/);
  const generatedFile=manager.calls.find((call)=>call.path.includes('/storage/v1/object/crm-contracts/generated/'));
  assert.ok(generatedFile);
  assert.match(generatedFile.body,/PASTA-2026-15/);
  assert.match(generatedFile.body,/PROJETO SDR SHARKS \| MUNDO APTO/);
  assert.match(generatedFile.body,/12\.345\.678\/0001-90/);
  assert.match(generatedFile.body,/Rua de Teste, 100/);
  assert.match(generatedFile.body,/2\.500/);
  assert.match(generatedFile.body,/A quitação será concedida/);
  assert.equal(rows.crm_contracts.find((item)=>item.id===saved.body.contractId).status,'Gerado para assinatura');
  const unsignedVisible=await invoke('apiListContracts',[manager.token],manager.token);
  assert.equal(unsignedVisible.body.length,1);
  const contractRow=rows.crm_contracts.find((item)=>item.id===saved.body.contractId);
  assert.equal(contractRow.broker_commission,2500);
  assert.equal(contractRow.sdr_commission,2500);
  assert.equal(contractRow.broker_prize,500);
  assert.equal(contractRow.sdr_prize,500);
  const signedDocument={id:'10000000-0000-4000-8000-000000000099',contract_id:contractRow.id,document_kind:'agreement',document_type:'signed',signature_confirmed_at:new Date().toISOString(),signature_confirmed_by:userIdManager,storage_path:'signed/test-contract.pdf',original_name:'termo-assinado.pdf',mime_type:'application/pdf',size_bytes:1000,uploaded_by:userIdManager,created_at:new Date().toISOString()};
  rows.crm_contract_documents.push(signedDocument);contractRow.status='Assinado';contractRow.signed_at=new Date().toISOString();
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const brokerContracts=await invoke('apiListContracts',[broker.token],broker.token);
  assert.equal(brokerContracts.body.length,1);
  assert.deepEqual(brokerContracts.body[0].documents.map((item)=>item.type),['signed']);
  const brokerDownload=await invoke('apiGetContractDocument',[broker.token,signedDocument.id],broker.token);
  assert.equal(brokerDownload.response.status,200);
  assert.match(brokerDownload.body.downloadUrl,/download=/);
  const generatedDocument=rows.crm_contract_documents.find((item)=>item.contract_id===contractRow.id&&item.document_type==='generated');
  const generatedDownload=await invoke('apiGetContractDocument',[broker.token,generatedDocument.id],broker.token);
  assert.equal(generatedDownload.response.status,403);
  const sdr=mockEnvironmentAndFetch(t,{role:'SDR',userId:userIdSdr,email:'sdr@example.test'});
  const restricted=await invoke('apiListSales',[sdr.token],sdr.token);
  assert.equal(restricted.response.status,403,JSON.stringify(restricted.body));
  const restrictedContract=await invoke('apiSaveContract',[sdr.token,{leadId,brokerId:userIdBrokerA,sdrId:userIdSdr,managerId:userIdManager}],sdr.token);
  assert.equal(restrictedContract.response.status,403);
});

test('contrato pode partir de venda manual e controla contrato e confissão com assinaturas independentes', async (t) => {
  const originals={sales:rows.crm_sales.slice(),receipts:rows.crm_sales_receipts.slice(),contracts:rows.crm_contracts.slice(),documents:rows.crm_contract_documents.slice(),profiles:rows.crm_broker_profiles.slice(),settings:rows.crm_settings.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);rows.crm_sales_receipts.splice(0,rows.crm_sales_receipts.length,...originals.receipts);rows.crm_contracts.splice(0,rows.crm_contracts.length,...originals.contracts);rows.crm_contract_documents.splice(0,rows.crm_contract_documents.length,...originals.documents);rows.crm_broker_profiles.splice(0,rows.crm_broker_profiles.length,...originals.profiles);rows.crm_settings.splice(0,rows.crm_settings.length,...originals.settings);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const sale=await invoke('apiSaveSale',[manager.token,{processNumber:'PROC-EXT-77',buyerName:'Comprador fora do CRM',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-12',unit:'B-204',unitValue:245000,expectedRepass:5000,saleStatus:'Cadastrada',repassStatus:'AGUARDANDO PJ',hasPending:false,pendingDescription:'',accounted:false,notes:'Venda manual externa'}],manager.token);
  assert.equal(sale.body.ok,true,JSON.stringify(sale.body));
  const profile={broker_id:userIdBrokerA,cpf:'111.222.333-44',cnpj:'12.345.678/0001-90',creci:'12345',address:'Rua de Teste, 100'};rows.crm_broker_profiles.push(profile);
  const saved=await invoke('apiSaveContract',[manager.token,{saleId:sale.body.saleId,sdrId:userIdSdr,sdrCpf:'222.333.444-55',managerId:userIdManager,buyerCpf:'333.444.555-66',buyerAddress:'Rua Externa, 10',proposalNumber:'PASTA-EXT-77',commissionBase:245000,commissionRatePct:2.5,grossCommission:6125,hasPrize:false}],manager.token);
  assert.equal(saved.body.ok,true,JSON.stringify(saved.body));
  const contract=rows.crm_contracts.find((item)=>item.id===saved.body.contractId);
  assert.equal(contract.sale_id,sale.body.saleId);
  assert.equal(contract.lead_id,null);
  assert.equal(contract.process_number,'PROC-EXT-77');
  assert.equal(contract.buyer_name,'Comprador fora do CRM');
  assert.equal(Number(contract.unit_value),245000);
  const templateHtml='<!doctype html><html><body><h1>CONFISSÃO {{numero_contrato}}</h1><p>Processo {{numero_processo}}</p><p>{{cliente_nome}}</p></body></html>';
  const unsafeTemplate=await invoke('apiSaveContractTemplate',[manager.token,{kind:'debt_confession',html:'<html><body><img src="https://example.test/collect?cpf={{cliente_cpf}}"></body></html>'}],manager.token);
  assert.equal(unsafeTemplate.response.status,400);
  assert.match(unsafeTemplate.body.message,/referência externa/i);
  const protocolRelativeTemplate=await invoke('apiSaveContractTemplate',[manager.token,{kind:'debt_confession',html:'<html><body><img src="//example.test/collect"></body></html>'}],manager.token);
  assert.equal(protocolRelativeTemplate.response.status,400);
  const savedTemplate=await invoke('apiSaveContractTemplate',[manager.token,{kind:'debt_confession',html:templateHtml}],manager.token);
  assert.equal(savedTemplate.body.ok,true);
  const confession=await invoke('apiGenerateContract',[manager.token,contract.id,'debt_confession'],manager.token);
  assert.equal(confession.body.ok,true,JSON.stringify(confession.body));
  const generatedConfession=manager.calls.find((call)=>call.path.includes('/storage/v1/object/crm-contracts/generated/')&&call.path.includes('/debt_confession/'));
  assert.ok(generatedConfession);
  assert.match(generatedConfession.body,/PROC-EXT-77/);
  const preparedConfession=await invoke('apiCreateContractUpload',[manager.token,contract.id,{documentKind:'debt_confession',name:'confissao-assinada.pdf',mimeType:'application/pdf',sizeBytes:1200}],manager.token);
  assert.equal(preparedConfession.body.ok,true,JSON.stringify(preparedConfession.body));
  const unconfirmed=await invoke('apiConfirmContractSigned',[manager.token,contract.id,preparedConfession.body.documentId,false],manager.token);
  assert.equal(unconfirmed.body.ok,false);
  const confessionConfirmed=await invoke('apiConfirmContractSigned',[manager.token,contract.id,preparedConfession.body.documentId,true],manager.token);
  assert.equal(confessionConfirmed.body.ok,true,JSON.stringify(confessionConfirmed.body));
  assert.notEqual(contract.status,'Assinado','A confissão não deve assinar automaticamente o contrato principal.');
  const signedConfessionRegeneration=await invoke('apiGenerateContract',[manager.token,contract.id,'debt_confession'],manager.token);
  assert.equal(signedConfessionRegeneration.body.ok,false);
  assert.match(signedConfessionRegeneration.body.message,/assinatura deste documento já foi confirmada/i);
  const brokerBeforeAgreement=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  assert.equal((await invoke('apiListContracts',[brokerBeforeAgreement.token],brokerBeforeAgreement.token)).body.length,0,'A confissão isolada não libera o registro ao corretor.');
  const managerAgain=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const agreement=await invoke('apiGenerateContract',[managerAgain.token,contract.id,'agreement'],managerAgain.token);
  assert.equal(agreement.body.ok,true,JSON.stringify(agreement.body));
  const preparedAgreement=await invoke('apiCreateContractUpload',[managerAgain.token,contract.id,{documentKind:'agreement',name:'contrato-assinado.pdf',mimeType:'application/pdf',sizeBytes:1400}],managerAgain.token);
  assert.equal(preparedAgreement.body.ok,true,JSON.stringify(preparedAgreement.body));
  const agreementConfirmed=await invoke('apiConfirmContractSigned',[managerAgain.token,contract.id,preparedAgreement.body.documentId,true],managerAgain.token);
  assert.equal(agreementConfirmed.body.ok,true,JSON.stringify(agreementConfirmed.body));
  assert.equal(contract.status,'Assinado');
  const duplicateAgreementUpload=await invoke('apiCreateContractUpload',[managerAgain.token,contract.id,{documentKind:'agreement',name:'contrato-substituto.pdf',mimeType:'application/pdf',sizeBytes:1400}],managerAgain.token);
  assert.equal(duplicateAgreementUpload.body.ok,false);
  assert.match(duplicateAgreementUpload.body.message,/assinatura deste documento já foi confirmada/i);
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const confessionOnlyVisible=await invoke('apiListContracts',[broker.token],broker.token);
  assert.equal(confessionOnlyVisible.body.length,1,'O registro passa a ficar visível apenas depois da assinatura confirmada do contrato principal.');
  const visible=await invoke('apiListContracts',[broker.token],broker.token);
  assert.equal(visible.body.length,1);
  assert.deepEqual(visible.body[0].documents.map((item)=>item.kind).sort(),['agreement','debt_confession']);
  const confessionDocument=rows.crm_contract_documents.find((item)=>item.id===preparedConfession.body.documentId);
  assert.equal((await invoke('apiGetContractDocument',[broker.token,confessionDocument.id],broker.token)).response.status,200);
});

test('gestão registra venda manual sem lead e acompanha repasses em parcelas auditadas', async (t) => {
  const originals = { sales:rows.crm_sales.slice(), receipts:rows.crm_sales_receipts.slice(), audit:rows.crm_audit.slice() };
  t.after(() => {
    rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);
    rows.crm_sales_receipts.splice(0,rows.crm_sales_receipts.length,...originals.receipts);
    rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);
  });
  const manager = mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const saved = await invoke('apiSaveSale',[manager.token,{
    buyerName:'Cliente externo ao CRM',processNumber:'PROC-2026-77',developmentId:'E001',brokerId:userIdBrokerA,
    soldAt:'2026-11-11',unit:'B-201',unitValue:'250000.00',saleStatus:'Com pendência',hasPending:true,
    pendingDescription:'Aguardando conferência documental',accounted:false,expectedRepass:'1000.00',
    repassStatus:'AGUARDANDO PJ',notes:'Venda inserida manualmente pela gestão'
  }],manager.token);
  assert.equal(saved.response.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.ok,true);
  const sale = rows.crm_sales.find((item)=>item.id===saved.body.saleId);
  assert.ok(sale);
  assert.equal(sale.lead_id,null);
  assert.equal(sale.process_number,'PROC-2026-77');
  assert.equal(sale.has_pending,true);
  assert.equal(rows.crm_audit.at(-1).action,'sale.create');
  assert.deepEqual(rows.crm_audit.at(-1).before_values,{});

  const linkedId='10000000-0000-4000-8000-000000000042';
  rows.crm_sales.push({id:linkedId,internal_number:'MA-VENDA-2026-TESTE',process_number:'',lead_id:'lead-a',buyer_name:'Cliente vinculado',development_id:'E001',broker_id:userIdBrokerA,sold_at:'2026-11-10',unit:'A-102',unit_value:180000,sale_status:'Cadastrada',has_pending:false,pending_description:'',accounted:false,expected_repass:0,repass_status:'AGUARDANDO PJ',notes:'',created_by:userIdManager,updated_by:userIdManager});
  const editedLinked = await invoke('apiSaveSale',[manager.token,{id:linkedId,buyerName:'Cliente vinculado',processNumber:'PROC-ATUALIZADO',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-10',unit:'A-102',unitValue:'180000',expectedRepass:'0',saleStatus:'Cadastrada',repassStatus:'AGUARDANDO PJ',hasPending:false,pendingDescription:'',accounted:false,notes:''}],manager.token);
  assert.equal(editedLinked.body.ok,true,JSON.stringify(editedLinked.body));
  assert.equal(rows.crm_sales.find((item)=>item.id===linkedId).lead_id,'lead-a');

  const first = await invoke('apiAddSaleReceipt',[manager.token,sale.id,{amount:'400.00',receivedAt:'2026-11-12',notes:'Primeira parcela'}],manager.token);
  assert.equal(first.response.status,200,JSON.stringify(first.body));
  assert.equal(first.body.repassStatus,'AGUARDANDO PJ');
  assert.equal(first.body.totalReceived,400);
  assert.equal(first.body.balance,600);
  const second = await invoke('apiAddSaleReceipt',[manager.token,sale.id,{amount:'600.00',receivedAt:'2026-11-12',notes:'Saldo final'}],manager.token);
  assert.equal(second.body.repassStatus,'AGUARDANDO PJ');
  assert.equal(second.body.balance,0);
  assert.equal(rows.crm_sales_receipts.filter((item)=>item.sale_id===sale.id).length,2);
  assert.equal(rows.crm_audit.filter((item)=>item.action==='sale.receipt.create').length,2);

  const listed = await invoke('apiListSales',[manager.token],manager.token);
  const savedSale = listed.body.find((item)=>item.id===sale.id);
  assert.equal(listed.body.length,2);
  assert.equal(savedSale.receivedRepass,1000);
  assert.equal(savedSale.balanceRepass,0);
});

test('anulação de recebimento preserva auditoria e não infla lançamentos posteriores', async (t) => {
  const originals={sales:rows.crm_sales.slice(),receipts:rows.crm_sales_receipts.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);rows.crm_sales_receipts.splice(0,rows.crm_sales_receipts.length,...originals.receipts);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const saleId='10000000-0000-4000-8000-000000000043';
  const receiptId='10000000-0000-4000-8000-000000000044';
  rows.crm_sales.push({id:saleId,internal_number:'MA-TESTE-43',process_number:'',lead_id:null,buyer_name:'Cliente de teste',development_id:'E001',broker_id:userIdBrokerA,sold_at:'2026-11-10',unit:'A-103',unit_value:180000,sale_status:'Cadastrada',has_pending:false,pending_description:'',accounted:false,expected_repass:1000,repass_status:'AGUARDANDO PJ',notes:'',created_by:userIdManager,updated_by:userIdManager});
  rows.crm_sales_receipts.push({id:receiptId,sale_id:saleId,amount:400,received_at:'2026-11-11',notes:'Parcela lançada por engano',created_by:userIdManager,created_at:'2026-11-11T10:00:00Z'});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const voided=await invoke('apiVoidSaleReceipt',[manager.token,receiptId,{reason:'Valor lançado em duplicidade'}],manager.token);
  assert.equal(voided.response.status,200,JSON.stringify(voided.body));
  assert.equal(voided.body.ok,true);
  assert.equal(voided.body.totalReceived,0);
  assert.equal(voided.body.balance,1000);
  assert.equal(voided.body.repassStatus,'AGUARDANDO PJ');
  assert.ok(rows.crm_sales_receipts[0].voided_at);
  assert.equal(rows.crm_sales_receipts[0].void_reason,'Valor lançado em duplicidade');
  assert.equal(rows.crm_audit.at(-1).action,'sale.receipt.void');

  const later=await invoke('apiAddSaleReceipt',[manager.token,saleId,{amount:'300.00',receivedAt:'2026-11-12',notes:'Recebimento correto'}],manager.token);
  assert.equal(later.body.ok,true,JSON.stringify(later.body));
  assert.equal(later.body.totalReceived,300);
  assert.equal(later.body.balance,700);
  const listed=await invoke('apiListSales',[manager.token],manager.token);
  const sale=listed.body.find((item)=>item.id===saleId);
  assert.equal(sale.receivedRepass,300);
  assert.equal(sale.balanceRepass,700);
  assert.equal(sale.receipts.length,2);
  assert.ok(sale.receipts.some((item)=>item.voidedAt&&item.voidReason==='Valor lançado em duplicidade'));
});

test('anulação de recebimento é restrita aos perfis administrativos', async (t) => {
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const result=await invoke('apiVoidSaleReceipt',[broker.token,'10000000-0000-4000-8000-000000000045',{reason:'Motivo válido'}],broker.token);
  assert.equal(result.response.status,403);
});

test('fase do repasse publica exatamente os 30 status enviados pela cliente e rejeita opções antigas', async (t) => {
  const originalSales=rows.crm_sales.slice();const originalAudit=rows.crm_audit.slice();
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originalSales);rows.crm_audit.splice(0,rows.crm_audit.length,...originalAudit);});
  const expected=[
    'AGUARDANDO PJ','LIBERADO P/ REPASSE','IR FUTURO','PENDÊNCIA PARA LIBERAÇÃO DO REPASSE','REPASSE SFH',
    'ANÁLISE DE CRÉDITO','EMISSÃO DE FORMULÁRIOS','FGTS EM DÉBITO','FGTS EM RESSARCIMENTO','FGTS COM ERRO',
    'FORMULÁRIOS EM ASSINATURA','FORMULÁRIOS ASSINADOS','CRITICADO E ENVIADO P/ CONFORMIDADE',
    'PENDÊNCIA DURANTE O REPASSE','INCONFORME','REANÁLISE DA CONFORMIDADE','CONFORME','AGUARDANDO DEMANDA MÍNIMA',
    'CONFIRMAÇÃO DE VALORES COM CLIENTE','EMISSÃO CONFISSÃO DE DÍVIDA / SOLICITAÇÃO DE CONTRATO','CONTRATO EMITIDO',
    'CONTRATO E CONFISSÃO DE DÍVIDA EM ASSINATURA','CONTRATO EM ASSINATURA E CONFISSÃO ASSINADA',
    'CONTRATO ASSINADO E CONFISSÃO PENDENTE','PROBLEMA NA ASSINATURA DO FINANCIAMENTO',
    'CONTRATO E CONFISSÃO ASSINADOS','CHECK-LIST DE REPASSE APTO PARA CONFERENCIA','AGUARDANDO REPACTUAÇÃO',
    'CHECK-LIST DE REPASSE REPROVADO','CHECK-LIST DE REPASSE APROVADO'
  ];
  assert.equal(expected.length,30);
  assert.deepEqual(crmConfig.repassStatuses,expected);
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const refs=await invoke('apiGetReferenceData',[manager.token],manager.token);
  assert.deepEqual(refs.body.repassStatuses,expected);
  const invalid=await invoke('apiSaveSale',[manager.token,{buyerName:'Cliente',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-12',unit:'A-1',unitValue:100000,expectedRepass:500,saleStatus:'Cadastrada',repassStatus:'Repasse parcial'}],manager.token);
  assert.equal(invalid.body.ok,false);
  assert.match(invalid.body.message,/fase do repasse inválida/i);
  const saved=await invoke('apiSaveSale',[manager.token,{buyerName:'Cliente',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-12',unit:'A-1',unitValue:100000,expectedRepass:500,saleStatus:'Cadastrada'}],manager.token);
  assert.equal(saved.body.ok,true,JSON.stringify(saved.body));
  assert.equal(rows.crm_sales.find((item)=>item.id===saved.body.saleId).repass_status,'AGUARDANDO PJ');
});

test('migration is private by default, grants only scoped reads and contains no user roster', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261109235658_crm_core_schema.sql'), 'utf8');
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

test('migration de operações do CRM é aditiva e mantém as novas tabelas privadas', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261112031927_crm_operations_extensions.sql'), 'utf8');
  const executableSql = sql.replace(/--[^\n]*/g, '');
  assert.match(executableSql, /add column if not exists before_values jsonb/i);
  assert.match(executableSql, /create table if not exists public\.crm_lead_attempts/i);
  assert.match(executableSql, /create table if not exists public\.crm_sales_receipts/i);
  assert.match(executableSql, /create table if not exists public\.crm_contract_documents/i);
  assert.match(executableSql, /enable row level security/i);
  assert.match(executableSql, /revoke all on public\.crm_lead_attempts[\s\S]*from anon, authenticated/i);
  assert.match(executableSql, /grant all on public\.crm_lead_attempts[\s\S]*to service_role/i);
  assert.match(executableSql, /values \('crm-contracts', 'crm-contracts', false/i);
  assert.doesNotMatch(executableSql, /(^|\n)\s*(drop\s+table|truncate\s+|delete\s+from)\b/i);
});

test('migration de índices cobre os novos filtros e não altera dados', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261112032254_crm_operations_fk_indexes.sql'), 'utf8');
  const executableSql = sql.replace(/--[^\n]*/g, '');
  assert.match(executableSql, /crm_audit_user_at_idx[\s\S]*on public\.crm_audit \(user_id, at desc\)/i);
  assert.match(executableSql, /crm_sales_development_sold_at_idx[\s\S]*on public\.crm_sales \(development_id, sold_at desc\)/i);
  assert.match(executableSql, /crm_contracts_manager_idx[\s\S]*on public\.crm_contracts \(manager_id, created_at desc\)/i);
  assert.match(executableSql, /create index if not exists/i);
  assert.doesNotMatch(executableSql, /(^|\n)\s*(alter\s+table|update\s+\w+|insert\s+into|delete\s+from|drop\s+|truncate\s+)/i);
});

test('migration do modelo de contrato só acrescenta campos validados', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261112034640_crm_contract_template_fields.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/add column if not exists proposal_number/i);
  assert.match(executableSql,/add column if not exists sdr_cpf/i);
  assert.match(executableSql,/add column if not exists commission_base/i);
  assert.match(executableSql,/commission_rate_pct between 0 and 100/i);
  assert.match(executableSql,/prize_rate_pct between 0 and 100/i);
  assert.doesNotMatch(executableSql,/(^|\n)\s*(drop\s+|delete\s+from|truncate\s+|update\s+\w+)/i);
});

test('migration da fase do repasse instala só os 30 status definidos e preserva a fase ao lançar recebimentos', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261112040112_crm_repass_phase_statuses.sql'),'utf8');
  const newCheck=sql.match(/add constraint crm_sales_repass_status_check check \(repass_status in \(([\s\S]*?)\)\);/i);
  assert.ok(newCheck,'constraint da fase deve existir');
  const checkValues=[...newCheck[1].matchAll(/'([^']+)'/g)].map((match)=>match[1]);
  assert.deepEqual(checkValues,crmConfig.repassStatuses);
  assert.match(sql,/set default 'AGUARDANDO PJ'/i);
  assert.match(sql,/set updated_at = v_now, updated_by = p_actor_id/i);
  assert.doesNotMatch(sql,/set repass_status\s*=/i);
  assert.match(sql,/revoke all on function public\.crm_add_sale_receipt/i);
  assert.match(sql,/grant execute on function public\.crm_add_sale_receipt\(uuid, uuid, numeric, date, text\) to service_role/i);
});

test('migration de atualização em tempo real e anulação de recebimentos preserva dados e cálculos', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261112101204_crm_live_sync_and_receipt_void.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/create table if not exists public\.crm_sync_signal/i);
  assert.match(executableSql,/alter table public\.crm_sync_signal enable row level security/i);
  assert.match(executableSql,/create policy crm_sync_signal_read_active[\s\S]*crm_user_is_active\(\)/i);
  assert.match(executableSql,/alter publication supabase_realtime add table public\.crm_sync_signal/i);
  assert.match(executableSql,/add column if not exists voided_at timestamptz/i);
  assert.match(executableSql,/set voided_at = v_now, voided_by = p_actor_id, void_reason = v_reason/i);
  assert.match(executableSql,/where sale_id = p_sale_id and voided_at is null/i);
  assert.match(executableSql,/grant execute on function public\.crm_void_sale_receipt\(uuid, uuid, text\) to service_role/i);
  assert.doesNotMatch(executableSql,/(^|\n)\s*(drop\s+table|truncate\s+|delete\s+from)\b/i);
});

test('migration de contratos permite venda manual e separa contrato e confissão sem apagar histórico', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261112165636_crm_contract_sources_and_documents.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/alter table public\.crm_contracts[\s\S]*alter column lead_id drop not null/i);
  assert.match(executableSql,/add column if not exists sale_id uuid references public\.crm_sales/i);
  assert.match(executableSql,/add column if not exists process_number text/i);
  assert.match(executableSql,/document_kind in \('agreement', 'debt_confession'\)/i);
  assert.match(executableSql,/signature_confirmed_at timestamptz/i);
  assert.match(executableSql,/signature_confirmed_by uuid references public\.crm_users/i);
  assert.match(executableSql,/document_type = 'signed'[\s\S]*contract\.status = 'Assinado'/i);
  assert.doesNotMatch(executableSql,/(^|\n)\s*(delete\s+from|truncate\s+)/i);
});

test('migration integrada indexa as novas relações de auditoria sem remover dados', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261112165925_crm_integrated_fk_indexes.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  for (const index of [
    'crm_production_entries_created_by_idx','crm_production_entries_updated_by_idx','crm_production_entries_deleted_by_idx',
    'crm_production_goals_created_by_idx','crm_production_goals_supersedes_id_idx',
    'crm_attendance_records_created_by_idx','crm_attendance_records_updated_by_idx','crm_attendance_records_deleted_by_idx',
    'crm_contract_documents_signature_confirmed_by_idx'
  ]) assert.match(executableSql, new RegExp(`create index if not exists ${index}`, 'i'));
  assert.doesNotMatch(executableSql,/(^|\n)\s*(drop\s+table|truncate\s+|delete\s+from)\b/i);
});

test('migration indexa o responsável por anulações de recebimentos', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261112170738_crm_receipt_void_fk_index.sql'),'utf8');
  assert.match(sql,/create index if not exists crm_sales_receipts_voided_by_idx[\s\S]*on public\.crm_sales_receipts\s*\(voided_by\)/i);
  assert.doesNotMatch(sql,/(^|\n)\s*(drop\s+table|truncate\s+|delete\s+from)\b/i);
});

test('migration Sharks acrescenta produção, metas, frequência e permissões sem expor tabelas operacionais', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261112165621_crm_integrated_operations.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/add column operations_access text not null default 'none'/i);
  assert.match(executableSql,/create table if not exists public\.crm_production_entries/i);
  assert.match(executableSql,/create table if not exists public\.crm_production_goals/i);
  assert.match(executableSql,/create table if not exists public\.crm_attendance_records/i);
  assert.match(executableSql,/crm_production_goals_current_unique_idx/i);
  assert.match(executableSql,/crm_attendance_active_unique_idx/i);
  assert.match(executableSql,/revoke all on public\.crm_production_entries, public\.crm_production_goals, public\.crm_attendance_records from anon, authenticated/i);
  assert.match(executableSql,/grant all on public\.crm_production_entries, public\.crm_production_goals, public\.crm_attendance_records to service_role/i);
  assert.match(executableSql,/crm_save_operation_goal/i);
  assert.match(executableSql,/crm_set_attendance/i);
  assert.doesNotMatch(executableSql,/(^|\n)\s*(drop\s+table|truncate\s+|delete\s+from)\b/i);
});

test('build estático não deixa marcações Apps Script nem credenciais no HTML publicado', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.doesNotMatch(html, /google\.script|<\?!=|<\?=|__MUNDO_APTO_LOGO_DATA_URI__/);
  assert.match(html, /Ativar acesso administrador/);
  assert.match(html, /Exportar contratos CSV/);
  assert.match(html, /Base de cálculo da comissão/);
  assert.match(html, /Nº da proposta \/ pasta/);
  assert.match(html, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(html, /SUPABASE_SECRET_KEY|CRM_BOOTSTRAP_SECRET|DEFAULT_TEMP_PASSWORD_SENTINEL/);
});
