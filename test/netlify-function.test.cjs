const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const { default: handler } = require('../netlify/functions/crm.mjs');
const crmConfig = require('../config/seed-data.json');

const userIdSdr = '10000000-0000-4000-8000-000000000004';
const userIdBrokerA = '10000000-0000-4000-8000-000000000005';
const userIdBrokerB = '10000000-0000-4000-8000-000000000006';
const userIdManager = '10000000-0000-4000-8000-000000000007';
const userIdOtherAdmin = '10000000-0000-4000-8000-000000000008';
const userIdAssistant = '10000000-0000-4000-8000-000000000009';
const mockFetchByToken = new Map();
let mockCommissionDocumentCounter = 1;
const rows = {
  crm_users: [
    { id: userIdSdr, name: 'SDR de teste', email: 'sdr@example.test', role: 'SDR', active: true, must_change_password: false, session_version: 0 },
    { id: userIdBrokerA, name: 'Corretor A', email: 'a@example.test', role: 'Corretor', active: true, must_change_password: false, session_version: 0 },
    { id: userIdBrokerB, name: 'Corretor B', email: 'b@example.test', role: 'Corretor', active: true, must_change_password: false, session_version: 0 },
    { id: userIdManager, name: 'Gestor de teste', email: 'gestao@example.test', role: 'Gerente', operations_access: 'viewer', active: true, must_change_password: false, session_version: 0 },
    { id: userIdOtherAdmin, name: 'Administrativo de teste', email: 'admin2@example.test', role: 'Coordenador', operations_access: 'manager', active: true, must_change_password: false, session_version: 0 },
    { id: userIdAssistant, name: 'Assistente de teste', email: 'assistente@example.test', role: 'Assistente', active: true, must_change_password: false, session_version: 0 }
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
  crm_user_contract_profiles: [],
  crm_sales: [],
  crm_sales_receipts: [],
  crm_contracts: [],
  crm_contract_documents: [],
  crm_commission_documents: [],
  crm_commission_document_sales: [],
  crm_production_entries: [],
  crm_production_goals: [],
  crm_attendance_records: [],
  crm_appointments: [],
  crm_in_app_notifications: [],
  crm_manager_locations: [],
  crm_complaints: [],
  crm_sessions: [],
  crm_settings: [],
  crm_sync_signal: [{ id: 1, changed_at: '2026-11-12T00:00:00.000Z' }]
};

const jwtFor = (role, userId, email, sessionVersion = 0) => `e30.${Buffer.from(JSON.stringify({ sub: userId, app_metadata: { role, crm_session_version: sessionVersion } })).toString('base64url')}.signature`;

function mockEnvironmentAndFetch(t, { role = 'Corretor', userId = userIdBrokerA, email = 'a@example.test', sessionVersion = 0, operationsManagerIds = [], sharedPasswordOperatorId = '', appointmentConstraintConflict = false, financeUploadSignUnavailable = false } = {}) {
  const savedEnv = { ...process.env };
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
  process.env.SUPABASE_SECRET_KEY = 'service-test-key';
  process.env.CRM_BOOTSTRAP_SECRET = '';
  const token = jwtFor(role, userId, email, sessionVersion);
  const calls = [];
  const authMetadata = new Map();
  const authAccounts = new Map();
  const usersByToken = new Map([[token, { id:userId, email, app_metadata:{ role, crm_session_version:sessionVersion } }]]);
  let leadCounter = 1;
  let contractCounter = 1;
  let productionCounter = rows.crm_production_entries.length + 1;
  let goalCounter = 1;
  let attendanceCounter = 1;
  let appointmentCounter = 1;
  let managerLocationCounter = 1;
  let complaintCounter = 1;
  let authUserCounter = 1;
  const fakeUser = { id: userId, email, app_metadata: { role, crm_session_version: sessionVersion } };
  const oldFetch = global.fetch;
  const mockFetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method || 'GET';
    let requestBody=null;
    if(options.body){if(Buffer.isBuffer(options.body))requestBody=options.body.toString('latin1');else{try{requestBody=JSON.parse(options.body);}catch{requestBody=String(options.body);}}}
    calls.push({ path: url.pathname, method, query: Object.fromEntries(url.searchParams), headers: options.headers || {}, body: requestBody });
    if (url.pathname === '/auth/v1/user') {
      const bearer = String(options.headers && options.headers.Authorization || '').replace(/^Bearer\s+/i,'');
      return Response.json(usersByToken.get(bearer) || fakeUser);
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const credentials=JSON.parse(options.body||'{}');const account=authAccounts.get(String(credentials.email||'').toLowerCase());
      if(account){
        if(account.password!==credentials.password)return Response.json({message:'invalid_credentials'},{status:400});
        const profile=rows.crm_users.find((item)=>String(item.id)===String(account.id));
        const accessToken=jwtFor(profile.role,profile.id,profile.email,Number((authMetadata.get(profile.id)||account.app_metadata||{}).crm_session_version||0));
        const user={id:profile.id,email:profile.email,app_metadata:authMetadata.get(profile.id)||account.app_metadata||{crm_session_version:0}};usersByToken.set(accessToken,user);
        return Response.json({access_token:accessToken,refresh_token:'refresh-'+profile.id,expires_in:3600,user});
      }
      return Response.json({ access_token: token, refresh_token: 'refresh-token-for-test', expires_in: 3600, user: fakeUser });
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
      const body=JSON.parse(options.body);const id='10000000-0000-4000-8000-'+String(800+authUserCounter++).padStart(12,'0');
      const account={id,email:String(body.email).toLowerCase(),password:body.password,app_metadata:body.app_metadata||{},user_metadata:body.user_metadata||{}};authAccounts.set(account.email,account);authMetadata.set(id,account.app_metadata);
      return Response.json({user:{id,email:account.email,app_metadata:account.app_metadata,user_metadata:account.user_metadata}});
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      const targetId = decodeURIComponent(url.pathname.split('/').pop());
      const profile = rows.crm_users.find((item) => String(item.id) === targetId);
      if (method === 'GET') return profile ? Response.json({ id: targetId, app_metadata: authMetadata.get(targetId) || { crm_session_version: Number(profile.session_version || 0) }, user_metadata: { name: profile.name } }) : Response.json({ message:'user not found' }, { status:404 });
      if (method === 'PUT') {
        const update = JSON.parse(options.body);
        if (update.app_metadata) authMetadata.set(targetId, update.app_metadata);
        const account=[...authAccounts.values()].find((item)=>String(item.id)===targetId);if(account){if(Object.hasOwn(update,'password'))account.password=update.password;if(update.app_metadata)account.app_metadata=update.app_metadata;}
        return Response.json({ id: targetId, ...update });
      }
      if (method === 'DELETE') { for(const [key,item] of authAccounts)if(String(item.id)===targetId)authAccounts.delete(key);return Response.json({}); }
    }
    if(url.pathname.startsWith('/storage/v1/')){
      if(url.pathname.includes('/object/sign/crm-finance-documents/'))return Response.json({signedURL:'/object/sign/crm-finance-documents/test-document?token=signed'});
      if(url.pathname.includes('/object/upload/sign/crm-finance-documents/')&&financeUploadSignUnavailable)return Response.json({});
      if(url.pathname.includes('/object/upload/sign/crm-finance-documents/'))return Response.json({signedURL:'/object/upload/sign/crm-finance-documents/test-upload',token:'finance-upload-token'});
      if(url.pathname.includes('/object/info/crm-finance-documents/'))return Response.json({name:'uploaded-finance-document'});
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
    if (url.pathname === '/rest/v1/rpc/crm_add_sale_receipt_full') {
      const payload=JSON.parse(options.body);const sale=rows.crm_sales.find((item)=>item.id===payload.p_sale_id&&!item.deleted_at);
      if(!sale)return Response.json({message:'sale_not_found'},{status:400});
      if(rows.crm_sales_receipts.some((item)=>item.sale_id===sale.id&&!item.voided_at))return Response.json({message:'active_receipt_exists'},{status:400});
      const amount=Number(sale.broker_commission===undefined||sale.broker_commission===null?sale.expected_repass:sale.broker_commission||0);
      if(amount<=0)return Response.json({message:'broker_commission_not_configured'},{status:400});
      const previous=sale.repass_status;const receipt={id:'receipt-'+(rows.crm_sales_receipts.length+1),sale_id:sale.id,amount,received_at:payload.p_received_at,notes:payload.p_notes||'',created_by:payload.p_actor_id,created_at:new Date().toISOString(),previous_repass_status:previous,status_set_by_receipt:true};
      rows.crm_sales_receipts.push(receipt);sale.repass_status='COMISSÃO PAGA';sale.updated_by=payload.p_actor_id;
      return Response.json([{receipt_id:receipt.id,amount,received_total:amount,balance:0,repass_status:sale.repass_status,previous_status:previous}]);
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
      let phaseRestored=false;if(receipt.status_set_by_receipt&&sale.repass_status==='COMISSÃO PAGA'&&receipt.previous_repass_status){sale.repass_status=receipt.previous_repass_status;phaseRestored=true;}
      return Response.json([{ sale_id:sale.id,receipt_id:receipt.id,amount:Number(receipt.amount),received_at:receipt.received_at,notes:receipt.notes||'',previous_received_total:previous,received_total:total,balance:Math.round((Number(sale.broker_commission===undefined||sale.broker_commission===null?sale.expected_repass:sale.broker_commission)-total)*100)/100,repass_status:sale.repass_status,phase_restored:phaseRestored }]);
    }
    if (url.pathname === '/rest/v1/rpc/crm_save_operation_goal') {
      const payload=JSON.parse(options.body);
      const previous=rows.crm_production_goals.find((item)=>item.broker_id===payload.p_broker_id&&item.metric===payload.p_metric&&item.cycle===payload.p_cycle&&item.starts_on===payload.p_starts_on&&item.ends_on===payload.p_ends_on&&item.is_current);
      const revision=previous?Number(previous.revision)+1:1;
      if(previous)previous.is_current=false;
      const saved={id:'10000000-0000-4000-8000-'+String(500+goalCounter++).padStart(12,'0'),broker_id:payload.p_broker_id,metric:payload.p_metric,cycle:payload.p_cycle,starts_on:payload.p_starts_on,ends_on:payload.p_ends_on,target_count:payload.p_target_count,revision,supersedes_id:previous?previous.id:null,is_current:true,created_at:new Date().toISOString(),created_by:payload.p_actor_id};
      rows.crm_production_goals.push(saved);return Response.json([saved]);
    }
    if (url.pathname === '/rest/v1/rpc/crm_save_operation_goals_batch') {
      const payload=JSON.parse(options.body);const saved=[];
      for(const goal of payload.p_goals){
        const previous=rows.crm_production_goals.find((item)=>item.broker_id===goal.broker_id&&item.metric===goal.metric&&item.cycle===goal.cycle&&item.starts_on===goal.starts_on&&item.ends_on===goal.ends_on&&item.is_current);
        const revision=previous?Number(previous.revision)+1:1;if(previous)previous.is_current=false;
        const row={id:'10000000-0000-4000-8000-'+String(500+goalCounter++).padStart(12,'0'),...goal,revision,supersedes_id:previous?previous.id:null,is_current:true,created_at:new Date().toISOString(),created_by:payload.p_actor_id};rows.crm_production_goals.push(row);saved.push({id:row.id,brokerId:row.broker_id,metric:row.metric,target:row.target_count,revision});
      }
      return Response.json({count:saved.length,results:saved});
    }
    if (url.pathname === '/rest/v1/rpc/crm_set_attendance') {
      const payload=JSON.parse(options.body);
      let record=rows.crm_attendance_records.find((item)=>item.broker_id===payload.p_broker_id&&item.attendance_date===payload.p_attendance_date&&item.shift===payload.p_shift&&!item.deleted_at);
      if(payload.p_present&&!record){record={id:'10000000-0000-4000-8000-'+String(600+attendanceCounter++).padStart(12,'0'),broker_id:payload.p_broker_id,attendance_date:payload.p_attendance_date,shift:payload.p_shift,created_at:new Date().toISOString(),created_by:payload.p_actor_id,updated_at:new Date().toISOString(),updated_by:payload.p_actor_id};rows.crm_attendance_records.push(record);}
      else if(!payload.p_present&&record){record.deleted_at=new Date().toISOString();record.deleted_by=payload.p_actor_id;record.updated_at=record.deleted_at;record.updated_by=payload.p_actor_id;}
      return Response.json(record?[record]:[]);
    }
    if (url.pathname === '/rest/v1/rpc/crm_import_operations') {
      const payload=JSON.parse(options.body);let createdCount=0;let updatedCount=0;let skippedCount=0;
      for(const value of payload.p_rows||[]){
        const stamp=new Date().toISOString();
        if(payload.p_section==='production'){
          const existing=value.id?rows.crm_production_entries.find((item)=>item.id===value.id&&!item.deleted_at):null;
          const saved=existing||{id:'10000000-0000-4000-8000-'+String(700+productionCounter++).padStart(12,'0'),broker_id:value.brokerId,work_date:value.workDate,created_at:stamp,created_by:payload.p_actor_id};
          Object.assign(saved,{broker_id:value.brokerId,work_date:value.workDate,prospecting_count:value.prospections,interaction_count:value.interactions,appointment_count:value.appointments,visit_count:value.visits,sale_count:value.sales,folder_count:value.folders,notes:value.notes||'',updated_at:stamp,updated_by:payload.p_actor_id});
          if(!existing)rows.crm_production_entries.push(saved);
          const before=existing?{brokerId:existing.broker_id,workDate:existing.work_date}:{};const after={brokerId:saved.broker_id,workDate:saved.work_date,folders:saved.folder_count};
          rows.crm_audit.push({user_id:payload.p_actor_id,email:payload.p_actor_email,actor_name:payload.p_actor_name,actor_role:payload.p_actor_role,action:existing?'operations.production.update':'operations.production.create',entity_type:'operation_production',entity_id:saved.id,changed_fields:'brokerId,workDate,folders',module:'operations',before_values:before,after_values:after});
          if(existing)updatedCount++;else createdCount++;
        }else{
          const existing=rows.crm_attendance_records.find((item)=>item.broker_id===value.brokerId&&item.attendance_date===value.attendanceDate&&item.shift===value.shift&&!item.deleted_at);
          if(existing){skippedCount++;continue;}
          const saved={id:'10000000-0000-4000-8000-'+String(600+attendanceCounter++).padStart(12,'0'),broker_id:value.brokerId,attendance_date:value.attendanceDate,shift:value.shift,created_at:stamp,created_by:payload.p_actor_id,updated_at:stamp,updated_by:payload.p_actor_id};rows.crm_attendance_records.push(saved);
          rows.crm_audit.push({user_id:payload.p_actor_id,email:payload.p_actor_email,actor_name:payload.p_actor_name,actor_role:payload.p_actor_role,action:'operations.attendance.create',entity_type:'operation_attendance',entity_id:saved.id,changed_fields:'brokerId,attendanceDate,shift,present',module:'operations',before_values:{},after_values:{brokerId:saved.broker_id,attendanceDate:saved.attendance_date,shift:saved.shift,present:true}});createdCount++;
        }
      }
      return Response.json({ok:true,createdCount,updatedCount,skippedCount});
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
        const recipientFilter = url.searchParams.get('recipient_id');
        const readFilter = url.searchParams.get('read_at');
        const deletedFilter = url.searchParams.get('deleted_at');
        const entityFilter = url.searchParams.get('entity_type');
        const brokerFilter = url.searchParams.get('broker_id');
        const saleFilter = url.searchParams.get('sale_id');
        const commissionDocumentFilter = url.searchParams.get('commission_document_id');
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
        const roleFilter = url.searchParams.get('role');
        const archivedFilter = url.searchParams.get('archived_at');
        const signatureFilter = url.searchParams.get('signature_status');
        const paymentFilter = url.searchParams.get('payment_status');
        if (idFilter && idFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.id) === idFilter.slice(3));
        if (leadFilter && leadFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.lead_id) === leadFilter.slice(3));
        if (keyFilter && keyFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.key) === keyFilter.slice(3));
        if (userFilter && userFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.user_id) === userFilter.slice(3));
        if (recipientFilter && recipientFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.recipient_id) === recipientFilter.slice(3));
        if (readFilter === 'is.null') filtered = filtered.filter((row) => !row.read_at);
        if (entityFilter && entityFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.entity_type) === entityFilter.slice(3));
        if (brokerFilter && brokerFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.broker_id) === brokerFilter.slice(3));
        const sessionVersionFilter=url.searchParams.get('session_version');if(sessionVersionFilter&&sessionVersionFilter.startsWith('eq.'))filtered=filtered.filter((row)=>String(row.session_version||0)===sessionVersionFilter.slice(3));
        if (saleFilter && saleFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.sale_id) === saleFilter.slice(3));
        if (saleFilter && saleFilter.startsWith('in.(')) { const saleIds = new Set(saleFilter.slice(4, -1).split(',').map((value) => value.replace(/^"|"$/g, ''))); filtered = filtered.filter((row) => saleIds.has(String(row.sale_id))); }
        if (commissionDocumentFilter && commissionDocumentFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.commission_document_id) === commissionDocumentFilter.slice(3));
        if (commissionDocumentFilter && commissionDocumentFilter.startsWith('neq.')) filtered = filtered.filter((row) => String(row.commission_document_id) !== commissionDocumentFilter.slice(4));
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
        if (roleFilter && roleFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.role) === roleFilter.slice(3));
        if (deletedFilter === 'is.null') filtered = filtered.filter((row) => !row.deleted_at);
        if (deletedFilter === 'not.is.null') filtered = filtered.filter((row) => Boolean(row.deleted_at));
        if (archivedFilter === 'is.null') filtered = filtered.filter((row) => !row.archived_at);
        if (archivedFilter === 'not.is.null') filtered = filtered.filter((row) => Boolean(row.archived_at));
        if (signatureFilter && signatureFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.signature_status) === signatureFilter.slice(3));
        if (paymentFilter && paymentFilter.startsWith('eq.')) filtered = filtered.filter((row) => String(row.payment_status) === paymentFilter.slice(3));
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
        const commissionDocumentFilter = url.searchParams.get('commission_document_id') || '';
        const associationArchiveFilter = url.searchParams.get('archived_at') || '';
        if (table === 'crm_commission_document_sales' && commissionDocumentFilter.startsWith('eq.')) {
          const entries=list.filter((item)=>String(item.commission_document_id)===commissionDocumentFilter.slice(3)
            && (associationArchiveFilter==='is.null'?!item.archived_at:associationArchiveFilter==='not.is.null'?Boolean(item.archived_at):true));
          for(const entry of entries)Object.assign(entry,JSON.parse(options.body));
          return Response.json(entries);
        }
        const idFilter = url.searchParams.get('id') || '';
        const id = idFilter.slice(3);
        const userFilter = url.searchParams.get('user_id') || '';
        const userId = userFilter.slice(3);
        const recipientFilter = url.searchParams.get('recipient_id') || '';
        const recipientId = recipientFilter.slice(3);
        const row = list.find((item) => idFilter.startsWith('eq.')
          ? String(item.id) === id && (!recipientFilter.startsWith('eq.') || String(item.recipient_id) === recipientId)
          : userFilter.startsWith('eq.') ? String(item.user_id) === userId
            : recipientFilter.startsWith('eq.') ? String(item.recipient_id) === recipientId : false);
        const deletedFilter = url.searchParams.get('deleted_at');
        const versionFilter=url.searchParams.get('session_version');const activeFilter=url.searchParams.get('active');
        const archivedFilter=url.searchParams.get('archived_at');const signatureFilter=url.searchParams.get('signature_status');const paymentFilter=url.searchParams.get('payment_status');const readFilter=url.searchParams.get('read_at');
        if(readFilter==='is.null'&&row&&row.read_at)return Response.json([], {status:200});
        if (!row || (deletedFilter === 'is.null' && row.deleted_at) || (deletedFilter === 'not.is.null' && !row.deleted_at)
          || (archivedFilter === 'is.null' && row.archived_at) || (archivedFilter === 'not.is.null' && !row.archived_at)
          || (signatureFilter&&signatureFilter.startsWith('eq.')&&String(row.signature_status)!==signatureFilter.slice(3))
          || (paymentFilter&&paymentFilter.startsWith('eq.')&&String(row.payment_status)!==paymentFilter.slice(3))
          || (versionFilter&&versionFilter.startsWith('eq.')&&String(row.session_version||0)!==versionFilter.slice(3))
          || (activeFilter==='eq.true'&&row.active!==true)) return Response.json([], { status: 200 });
        Object.assign(row, JSON.parse(options.body));
        return Response.json([row]);
      }
      if (method === 'POST') {
        const value = JSON.parse(options.body);
        if (table === 'crm_appointments' && appointmentConstraintConflict) return Response.json({ code:'23P01', message:'exclusion constraint violation' }, { status:409 });
        if (table === 'crm_in_app_notifications') {
          const entries=(Array.isArray(value)?value:[value]).map((item)=>({...item,id:item.id||`10000000-0000-4000-8000-${String(950+list.length+1).padStart(12,'0')}`}));
          for(const entry of entries)if(!list.some((item)=>item.dedupe_key===entry.dedupe_key))list.push(entry);
          return Response.json(entries);
        }
        if (table === 'crm_commission_documents') {
          const entries=(Array.isArray(value)?value:[value]).map((item)=>({...item,id:item.id||`10000000-0000-4000-8000-${String(900+mockCommissionDocumentCounter++).padStart(12,'0')}`}));
          list.push(...entries);
          return Response.json(entries);
        }
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
        if (table === 'crm_appointments' || table === 'crm_manager_locations' || table === 'crm_complaints') {
          let counter;
          if (table === 'crm_appointments') counter = 1000 + appointmentCounter++;
          else if (table === 'crm_manager_locations') counter = 2000 + managerLocationCounter++;
          else counter = 3000 + complaintCounter++;
          const entries=(Array.isArray(value)?value:[value]).map((item)=>({...item,id:item.id||'10000000-0000-4000-8000-'+String(counter++).padStart(12,'0')}));
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
  mockFetchByToken.set(token, mockFetch);
  global.fetch = mockFetch;
  t.after(() => { global.fetch = oldFetch; for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });
  return { token, calls, authMetadata, authAccounts, usersByToken, mockFetch };
}

async function invoke(method, args, token) {
  const sessionToken = args && args[0];
  if (mockFetchByToken.has(sessionToken)) global.fetch = mockFetchByToken.get(sessionToken);
  const request = new Request('https://mundoapto.test/.netlify/functions/crm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args: args || [] })
  });
  const response = await handler(request);
  return { response, body: await response.json() };
}

async function invokeAs(mock, method, args) {
  global.fetch = mock.mockFetch;
  return invoke(method, [mock.token, ...(args || [])], mock.token);
}

function operationToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function operationShiftDate(value, amount) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

test('lista operacional atualiza corretores ativos sem expor a equipe a outros corretores', async (t) => {
  const originalUsers=structuredClone(rows.crm_users);
  t.after(()=>rows.crm_users.splice(0,rows.crm_users.length,...originalUsers));
  const newBrokerId='10000000-0000-4000-8000-000000000096';
  const archivedBrokerId='10000000-0000-4000-8000-000000000097';
  const inactiveBrokerId='10000000-0000-4000-8000-000000000098';
  rows.crm_users.push(
    {id:newBrokerId,name:'Corretora recém-cadastrada',email:'nova@example.test',role:'Corretor',active:true,must_change_password:false,session_version:0},
    {id:inactiveBrokerId,name:'Corretor inativo',email:'inativo@example.test',role:'Corretor',active:false,must_change_password:false,session_version:0},
    {id:archivedBrokerId,name:'Corretor excluído',email:'excluido@example.test',role:'Corretor',active:false,deleted_at:'2026-11-12T10:00:00Z',must_change_password:false,session_version:0}
  );
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test',operationsManagerIds:[userIdManager]});
  const team=await invoke('apiListOperationBrokers',[manager.token],manager.token);
  assert.deepEqual(team.body.map((item)=>item.id).sort(),[userIdBrokerA,userIdBrokerB,newBrokerId,inactiveBrokerId].sort());
  assert.ok(team.body.every((item)=>Object.keys(item).sort().join(',')==='active,id,name'));
  assert.ok(team.body.find((item)=>item.id===newBrokerId).active);
  assert.equal(team.body.some((item)=>item.id===archivedBrokerId),false);

  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const own=await invoke('apiListOperationBrokers',[broker.token],broker.token);
  assert.deepEqual(own.body,[{id:userIdBrokerA,name:'Corretor A',active:true}]);

  const restrictedId='10000000-0000-4000-8000-000000000099';
  rows.crm_users.push({id:restrictedId,name:'Administrativo sem módulo',email:'restrito@example.test',role:'Coordenador',operations_access:'none',active:true,must_change_password:false,session_version:0});
  const restricted=mockEnvironmentAndFetch(t,{role:'Coordenador',userId:restrictedId,email:'restrito@example.test'});
  assert.equal((await invoke('apiListOperationBrokers',[restricted.token],restricted.token)).response.status,403);
});

test('corretor pode lançar produção em qualquer data do mês vigente sem limite diário; gestão pode corrigir histórico e tudo fica auditado', async (t) => {
  const originals={entries:rows.crm_production_entries.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_production_entries.splice(0,rows.crm_production_entries.length,...originals.entries);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const brokerA=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const today=operationToday();const monthStart=today.slice(0,7)+'-01';const oldDate=today>monthStart?operationShiftDate(today,-1):today;const priorMonthDate=operationShiftDate(monthStart,-1);const futureDate=operationShiftDate(today,1);
  const historicAttempt=await invoke('apiSaveProduction',[brokerA.token,{workDate:oldDate,prospections:4,interactions:0,appointments:0,visits:0,sales:0}],brokerA.token);
  const priorMonthAttempt=await invoke('apiSaveProduction',[brokerA.token,{workDate:priorMonthDate,prospections:4,interactions:0,appointments:0,visits:0,sales:0}],brokerA.token);
  const futureAttempt=await invoke('apiSaveProduction',[brokerA.token,{workDate:futureDate,prospections:4}],brokerA.token);
  assert.equal(historicAttempt.body.ok,true,JSON.stringify(historicAttempt.body));
  assert.equal(priorMonthAttempt.body.ok,false);assert.match(priorMonthAttempt.body.message,/dentro do mês vigente/i);
  assert.equal(futureAttempt.body.ok,false);assert.match(futureAttempt.body.message,/data válida/i);
  const payload={workDate:today,prospections:4,interactions:3,appointments:2,visits:1,sales:0,notes:'Primeiro lançamento do dia'};
  const first=await invoke('apiSaveProduction',[brokerA.token,payload],brokerA.token);
  const second=await invoke('apiSaveProduction',[brokerA.token,{...payload,prospections:2,notes:'Segundo lançamento no mesmo dia'}],brokerA.token);
  assert.equal(first.body.ok,true,JSON.stringify(first.body));
  assert.equal(second.body.ok,true,JSON.stringify(second.body));
  assert.equal(rows.crm_production_entries.length,3,'o corretor pode criar lançamentos em datas diferentes do mês vigente');
  const edited=await invoke('apiSaveProduction',[brokerA.token,{...payload,id:first.body.id,prospections:5,notes:'Correção feita depois'}],brokerA.token);
  assert.equal(edited.body.ok,true,JSON.stringify(edited.body));
  assert.equal(rows.crm_audit.at(-1).action,'operations.production.update');
  assert.equal(rows.crm_audit.at(-1).before_values.prospections,4);
  assert.equal(rows.crm_audit.at(-1).after_values.prospections,5);
  const dashboard=await invoke('apiGetOperationsDashboard',[brokerA.token,{period:'day'}],brokerA.token);
  assert.ok(dashboard.body.recentOwnEntries.some((item)=>item.workDate===today));
  assert.ok(dashboard.body.recentOwnEntries.some((item)=>item.workDate===oldDate));
  const cancelled=await invoke('apiArchiveProduction',[brokerA.token,second.body.id],brokerA.token);
  assert.equal(cancelled.body.ok,true,JSON.stringify(cancelled.body));
  assert.ok(rows.crm_production_entries.find((row)=>row.id===second.body.id).deleted_at);
  assert.equal(rows.crm_audit.at(-1).action,'operations.production.cancel');
  const brokerB=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerB,email:'b@example.test'});
  const forbiddenEdit=await invoke('apiSaveProduction',[brokerB.token,{...payload,id:first.body.id,prospections:99}],brokerB.token);
  const forbiddenCancel=await invoke('apiArchiveProduction',[brokerB.token,first.body.id],brokerB.token);
  const brokerBRows=await invoke('apiListProduction',[brokerB.token,{dateFrom:today,dateTo:today}],brokerB.token);
  assert.equal(forbiddenEdit.response.status,403);
  assert.equal(forbiddenCancel.response.status,403);
  assert.equal(brokerBRows.body.length,0);
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test',operationsManagerIds:[userIdManager]});
  const historicEntry=await invoke('apiSaveProduction',[manager.token,{brokerId:userIdBrokerA,workDate:oldDate,prospections:8,interactions:5,appointments:1,visits:2,sales:0,folders:1}],manager.token);
  assert.equal(historicEntry.body.ok,true,JSON.stringify(historicEntry.body));
  const historicalEdit=await invoke('apiSaveProduction',[manager.token,{id:historicEntry.body.id,brokerId:userIdBrokerA,workDate:oldDate,prospections:9,interactions:5,appointments:1,visits:2,sales:0,folders:1}],manager.token);
  assert.equal(historicalEdit.body.ok,true,JSON.stringify(historicalEdit.body));
  const historicalAudit=rows.crm_audit.slice().reverse().find((entry)=>entry.action==='operations.production.update'&&entry.entity_id===historicEntry.body.id);
  assert.ok(historicalAudit,'a correção histórica deve deixar uma entrada de auditoria ligada ao lançamento');
  assert.equal(historicalAudit.before_values.prospections,8);
  assert.equal(historicalAudit.after_values.prospections,9);
});

test('somente as contas allowlistadas corrigem a equipe e frequência; SDR não acessa o módulo operacional e corretor vê a própria', async (t) => {
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
  assert.equal(teamAttendance.response.status,403);
  const sdrDashboard=await invoke('apiGetOperationsDashboard',[sdr.token,{period:'week'}],sdr.token);
  assert.equal(sdrDashboard.response.status,403);
});

test('Assistente designada acessa e lança frequências; papel administrativo sozinho não concede permissão', async (t) => {
  const originals={users:structuredClone(rows.crm_users),attendance:rows.crm_attendance_records.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_users.splice(0,rows.crm_users.length,...originals.users);rows.crm_attendance_records.splice(0,rows.crm_attendance_records.length,...originals.attendance);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const assistantId='10000000-0000-4000-8000-000000000091';
  rows.crm_users.push({id:assistantId,name:'Assistente autorizada',email:'assistente@example.test',role:'Assistente',operations_access:'viewer',active:true,must_change_password:false,session_version:0});
  const assistant=mockEnvironmentAndFetch(t,{role:'Assistente',userId:assistantId,email:'assistente@example.test',operationsManagerIds:[assistantId]});
  const refs=await invoke('apiGetReferenceData',[assistant.token],assistant.token);
  assert.equal(refs.body.user.canManageOperations,true);
  assert.equal(refs.body.user.operationsAccess,'manager');
  assert.equal(refs.body.brokers.length,2,'o perfil designado precisa receber a lista necessária para preencher a matriz');
  const day=operationShiftDate(operationToday(),-1);
  const marked=await invoke('apiSetAttendance',[assistant.token,{brokerId:userIdBrokerA,attendanceDate:day,shift:'night',present:true}],assistant.token);
  assert.equal(marked.body.ok,true,JSON.stringify(marked.body));

  const unlisted=mockEnvironmentAndFetch(t,{role:'Coordenador',userId:userIdOtherAdmin,email:'admin2@example.test'});
  const noPermission=await invoke('apiSetAttendance',[unlisted.token,{brokerId:userIdBrokerA,attendanceDate:day,shift:'afternoon',present:true}],unlisted.token);
  assert.equal(noPermission.response.status,403);
});

test('importação de produção e plantões valida tudo antes e grava em lote com auditoria', async (t) => {
  const originals={entries:structuredClone(rows.crm_production_entries),attendance:structuredClone(rows.crm_attendance_records),audit:structuredClone(rows.crm_audit)};
  t.after(()=>{rows.crm_production_entries.splice(0,rows.crm_production_entries.length,...originals.entries);rows.crm_attendance_records.splice(0,rows.crm_attendance_records.length,...originals.attendance);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const date='2026-11-10';const existingId='10000000-0000-4000-8000-000000000601';
  rows.crm_production_entries.push({id:existingId,broker_id:userIdBrokerA,work_date:date,prospecting_count:1,interaction_count:1,appointment_count:0,visit_count:0,sale_count:0,folder_count:0,notes:'Anterior',created_at:date+'T12:00:00Z',created_by:userIdBrokerA,updated_at:date+'T12:00:00Z',updated_by:userIdBrokerA,deleted_at:null});
  rows.crm_attendance_records.push({id:'10000000-0000-4000-8000-000000000602',broker_id:userIdBrokerA,attendance_date:date,shift:'morning',created_at:date+'T12:00:00Z',created_by:userIdManager,updated_at:date+'T12:00:00Z',updated_by:userIdManager,deleted_at:null});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test',operationsManagerIds:[userIdManager]});
  const importedProduction=await invoke('apiImportOperations',[manager.token,'production',[
    {id:existingId,brokerId:userIdBrokerA,workDate:date,prospections:8,interactions:7,appointments:2,visits:1,sales:1,folders:4,notes:'Correção importada'},
    {brokerId:userIdBrokerB,workDate:date,prospections:3,interactions:2,appointments:1,visits:0,sales:0,folders:6,notes:'Novo lançamento'}
  ]],manager.token);
  assert.equal(importedProduction.body.ok,true,JSON.stringify(importedProduction.body));
  assert.equal(importedProduction.body.createdCount,1);assert.equal(importedProduction.body.updatedCount,1);
  assert.equal(rows.crm_production_entries.find((item)=>item.id===existingId).folder_count,4);
  assert.equal(rows.crm_production_entries.find((item)=>item.broker_id===userIdBrokerB&&item.work_date===date).folder_count,6);
  assert.equal(manager.calls.filter((call)=>call.path==='/rest/v1/rpc/crm_import_operations').length,1,'A importação deve ser um único lote transacional.');
  assert.equal(manager.calls.filter((call)=>call.path==='/rest/v1/crm_production_entries'&&['POST','PATCH'].includes(call.method)).length,0);
  assert.equal(rows.crm_audit.filter((item)=>item.module==='operations'&&item.entity_type==='operation_production').length,2);

  const importedAttendance=await invoke('apiImportOperations',[manager.token,'attendance',[
    {brokerId:userIdBrokerA,date,shift:'manha'},
    {brokerId:userIdBrokerA,date,shift:'noite'}
  ]],manager.token);
  assert.equal(importedAttendance.body.ok,true,JSON.stringify(importedAttendance.body));
  assert.equal(importedAttendance.body.createdCount,1);assert.equal(importedAttendance.body.skippedCount,1);
  assert.ok(rows.crm_attendance_records.some((item)=>item.broker_id===userIdBrokerA&&item.attendance_date===date&&item.shift==='night'&&!item.deleted_at));
  const rpcCount=manager.calls.filter((call)=>call.path==='/rest/v1/rpc/crm_import_operations').length;
  const invalid=await invoke('apiImportOperations',[manager.token,'production',[{brokerId:userIdBrokerB,workDate:date,prospections:-1}]],manager.token);
  assert.equal(invalid.body.ok,false);assert.equal(manager.calls.filter((call)=>call.path==='/rest/v1/rpc/crm_import_operations').length,rpcCount,'Uma pré-validação com erro não pode gravar nenhuma linha.');
  const coordinator=mockEnvironmentAndFetch(t,{role:'Coordenador',userId:userIdOtherAdmin,email:'admin2@example.test'});
  assert.equal((await invoke('apiImportOperations',[coordinator.token,'production',[]],coordinator.token)).response.status,403);
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

test('configuração em lote grava metas semanais e mensais de todos os corretores com histórico', async (t) => {
  const originals={goals:rows.crm_production_goals.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_production_goals.splice(0,rows.crm_production_goals.length,...originals.goals);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test',operationsManagerIds:[userIdManager]});
  const today=operationToday();
  const goals=[userIdBrokerA,userIdBrokerB].map((brokerId,index)=>({brokerId,targets:{prospections:10+index,visits:4+index,sales:1+index}}));
  const weekly=await invoke('apiSaveOperationGoalsBatch',[manager.token,{cycle:'weekly',referenceDate:today,goals}],manager.token);
  assert.equal(weekly.body.ok,true,JSON.stringify(weekly.body));
  assert.equal(weekly.body.count,6);
  assert.equal(rows.crm_production_goals.filter((item)=>item.is_current&&item.cycle==='weekly').length,6);
  const updatedGoals=goals.map((entry)=>({...entry,targets:{prospections:entry.targets.prospections+5,visits:entry.targets.visits+5,sales:entry.targets.sales+1}}));
  const monthly=await invoke('apiSaveOperationGoalsBatch',[manager.token,{cycle:'monthly',referenceDate:today,goals:updatedGoals}],manager.token);
  assert.equal(monthly.body.ok,true,JSON.stringify(monthly.body));
  assert.equal(monthly.body.count,6);
  assert.equal(rows.crm_production_goals.filter((item)=>item.is_current&&item.cycle==='monthly').length,6);
  assert.equal(rows.crm_audit.filter((item)=>item.action==='operations.goal.batch_revise').length,2);
  const incomplete=await invoke('apiSaveOperationGoalsBatch',[manager.token,{cycle:'weekly',referenceDate:today,goals:goals.slice(0,1)}],manager.token);
  assert.equal(incomplete.body.ok,false);
  assert.equal(rows.crm_production_goals.filter((item)=>item.is_current&&item.cycle==='weekly').length,6);
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

test('usuário novo entra com a senha definida pela gestão, troca no primeiro acesso e pode receber nova senha', async (t) => {
  const originals={users:structuredClone(rows.crm_users),sessions:rows.crm_sessions.slice(),audit:rows.crm_audit.slice(),profiles:structuredClone(rows.crm_user_contract_profiles)};
  t.after(()=>{rows.crm_users.splice(0,rows.crm_users.length,...originals.users);rows.crm_sessions.splice(0,rows.crm_sessions.length,...originals.sessions);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);rows.crm_user_contract_profiles.splice(0,rows.crm_user_contract_profiles.length,...originals.profiles);});
  const admin=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const initialPassword='InicialDefinidaPelaGestao#2026';
  const missingCpf=await invoke('apiSaveUser',[admin.token,{name:'Sem CPF',email:'sem.cpf@example.test',role:'Corretor',initialPassword}],admin.token);
  assert.equal(missingCpf.body.ok,false);
  assert.match(missingCpf.body.message,/CPF.*obrigatório/i);
  const incompleteManager=await invoke('apiSaveUser',[admin.token,{name:'Gerente incompleto',email:'gerente.incompleto@example.test',role:'Gerente',initialPassword,contractCpf:'111.222.333-44'}],admin.token);
  assert.equal(incompleteManager.body.ok,false);
  assert.match(incompleteManager.body.message,/Complete os dados do gerente/);
  const created=await invoke('apiSaveUser',[admin.token,{name:'Nova corretora',email:'nova.corretora@example.test',role:'Corretor',initialPassword,contractCpf:'111.222.333-44'}],admin.token);
  assert.equal(created.response.status,200,JSON.stringify(created.body));
  assert.equal(created.body.ok,true,JSON.stringify(created.body));
  const user=created.body.user;assert.equal(user.mustChangePassword,true);
  const listedUsers=await invoke('apiListUsers',[admin.token],admin.token);
  assert.equal(listedUsers.body.find((item)=>item.id===user.id).contractCpf,'111.222.333-44');
  assert.equal(listedUsers.body.find((item)=>item.id===user.id).contractCnpj,'');
  assert.equal(listedUsers.body.find((item)=>item.id===user.id).contractCreci,'');
  assert.equal(listedUsers.body.find((item)=>item.id===user.id).contractAddress,'');
  assert.equal(rows.crm_user_contract_profiles.find((item)=>item.user_id===user.id).contractCpf,undefined,'a tabela armazena apenas as colunas privadas e não duplica nomes de API');
  assert.equal(rows.crm_user_contract_profiles.find((item)=>item.user_id===user.id).cpf,'111.222.333-44');
  const updatedProfile=await invoke('apiSaveUser',[admin.token,{id:user.id,name:user.name,email:user.email,role:user.role,active:true,contractCpf:'999.888.777-66',contractCnpj:'98.765.432/0001-10',contractCreci:'CRECI 54321',contractAddress:'Rua Atualizada, 20'}],admin.token);
  assert.equal(updatedProfile.body.ok,true,JSON.stringify(updatedProfile.body));
  assert.equal((await invoke('apiListUsers',[admin.token],admin.token)).body.find((item)=>item.id===user.id).contractCpf,'999.888.777-66');
  const authCreate=admin.calls.find((call)=>call.path==='/auth/v1/admin/users'&&call.method==='POST');
  assert.equal(authCreate.body.password,initialPassword,'a senha informada pela gestão deve ser aplicada à conta Auth');
  assert.doesNotMatch(JSON.stringify(rows.crm_audit),new RegExp(initialPassword));
  assert.doesNotMatch(JSON.stringify(created.body),new RegExp(initialPassword));

  const firstLogin=await invoke('apiLogin',['nova.corretora@example.test',initialPassword]);
  assert.equal(firstLogin.response.status,200,JSON.stringify(firstLogin.body));
  assert.equal(firstLogin.body.ok,true,JSON.stringify(firstLogin.body));
  assert.equal(firstLogin.body.user.mustChangePassword,true);
  const blocked=await invoke('apiListLeads',[firstLogin.body.token,{},1,100],firstLogin.body.token);
  assert.equal(blocked.response.status,403);
  assert.match(blocked.body.message,/troque|altere/i);

  const changed=await invoke('apiChangePassword',[firstLogin.body.token,initialPassword,'SenhaPessoalSegura#2026'],firstLogin.body.token);
  assert.equal(changed.body.ok,true,JSON.stringify(changed.body));
  assert.equal(rows.crm_users.find((item)=>item.id===user.id).session_version,1);
  const oldSession=await invoke('apiListLeads',[firstLogin.body.token,{},1,100],firstLogin.body.token);
  assert.equal(oldSession.response.status,401,'a sessão de troca não deve continuar válida');
  const personalLogin=await invoke('apiLogin',['nova.corretora@example.test','SenhaPessoalSegura#2026']);
  assert.equal(personalLogin.body.ok,true,JSON.stringify(personalLogin.body));
  assert.equal(personalLogin.body.user.mustChangePassword,false);
  assert.equal((await invoke('apiListLeads',[personalLogin.body.token,{},1,100],personalLogin.body.token)).response.status,200);

  rows.crm_sessions.push({id:'reset-session',user_id:user.id,refresh_token_hash:'reset-hash',session_version:1,expires_at:'2099-01-01T00:00:00Z'});
  const resetPassword='RedefinidaPelaGestao#2026';
  const reset=await invoke('apiResetUserPassword',[admin.token,user.id,{password:resetPassword}],admin.token);
  assert.equal(reset.response.status,200,JSON.stringify(reset.body));
  assert.equal(reset.body.ok,true,JSON.stringify(reset.body));
  assert.doesNotMatch(JSON.stringify(reset.body),new RegExp(resetPassword));
  assert.equal(rows.crm_users.find((item)=>item.id===user.id).session_version,2);
  assert.equal(rows.crm_sessions.some((item)=>item.user_id===user.id),false);
  assert.equal(admin.authMetadata.get(user.id).crm_session_version,2);
  const invalidated=await invoke('apiLogin',['nova.corretora@example.test','SenhaPessoalSegura#2026']);
  assert.equal(invalidated.body.ok,false);
  assert.match(invalidated.body.message,/E-mail ou senha inválidos/);
  const resetLogin=await invoke('apiLogin',['nova.corretora@example.test',resetPassword]);
  assert.equal(resetLogin.body.ok,true,JSON.stringify(resetLogin.body));
  assert.equal(resetLogin.body.user.mustChangePassword,true);
  assert.equal((await invoke('apiListLeads',[resetLogin.body.token,{},1,100],resetLogin.body.token)).response.status,403);
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

test('SDR mantém cadastro novo até revisar status e registra a 7ª tentativa sem alterar status automaticamente', async (t) => {
  const originals = { leads:rows.crm_leads.slice(), attempts:rows.crm_lead_attempts.slice(), history:rows.crm_sdr_history.slice(), audit:rows.crm_audit.slice() };
  t.after(() => { rows.crm_leads.splice(0,rows.crm_leads.length,...originals.leads); rows.crm_lead_attempts.splice(0,rows.crm_lead_attempts.length,...originals.attempts); rows.crm_sdr_history.splice(0,rows.crm_sdr_history.length,...originals.history); rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit); });
  const id = '10000000-0000-4000-8000-000000000031';
  rows.crm_leads.push({ id, name:'Lead sem primeiro contato', phone:'11999990031', development_id:'E001', notes:'', sdr_feedback:'', status:'Em contato', broker_id:userIdBrokerA, created_at:'2026-11-08T10:00:00Z', created_by:userIdBrokerA, updated_at:'2026-11-08T10:00:00Z', updated_by:userIdBrokerA, sdr_updated_at:null, sdr_updated_by:null, sdr_status_updated_at:null });
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
  assert.equal(worklist.body.newLeads.some((lead)=>lead.id===id),true,'uma tentativa sem revisão do status mantém o cliente na fila de novos cadastros');
  assert.equal(worklist.body.followupAlerts.some((lead)=>lead.id===id),false);
  assert.equal(worklist.body.sevenAttemptAlerts.some((lead)=>lead.id===id),true);
  const attemptHistory = await invoke('apiListLeadAttempts',[token,id],token);
  assert.equal(attemptHistory.body.length,7);
  assert.equal(attemptHistory.body.at(-1).statusAtAttempt,'Em contato');
  const reviewed = await invoke('apiSaveLead',[token,id,{status:'Em contato',sdrFeedback:'Status revisado após as tentativas.'}],token);
  assert.equal(reviewed.body.ok,true,JSON.stringify(reviewed.body));
  assert.ok(before.sdr_status_updated_at);
  const reviewedWorklist=await invoke('apiGetSdrWorklist',[token],token);
  assert.equal(reviewedWorklist.body.newLeads.some((lead)=>lead.id===id),false,'salvar o status revisado encerra a fila de novos cadastros');
});

test('fila de follow-up omite somente desistência e já comprou', async (t) => {
  const originals={leads:rows.crm_leads.slice(),attempts:rows.crm_lead_attempts.slice()};
  t.after(()=>{rows.crm_leads.splice(0,rows.crm_leads.length,...originals.leads);rows.crm_lead_attempts.splice(0,rows.crm_lead_attempts.length,...originals.attempts);});
  const entries=[
    ['lead-terminal-desistencia','Desistência'],
    ['lead-terminal-comprou','Já comprou'],
    ['lead-reprovado-caixa','Reprovado pela Caixa'],
    ['lead-atendimento','Atendimento realizado'],
    ['lead-sem-primeiro-contato','Em contato']
  ];
  for(const [id,status] of entries)rows.crm_leads.push({id,name:id,phone:'11999990000',development_id:'E001',notes:'',sdr_feedback:'',status,broker_id:userIdBrokerA,created_at:'2026-11-01T10:00:00Z',created_by:userIdBrokerA,updated_at:'2026-11-01T10:00:00Z',updated_by:userIdBrokerA,sdr_updated_at:id==='lead-sem-primeiro-contato'?null:'2026-11-01T10:00:00Z',sdr_updated_by:id==='lead-sem-primeiro-contato'?null:userIdSdr});
  for(const leadId of ['lead-reprovado-caixa','lead-atendimento'])rows.crm_lead_attempts.push({id:`attempt-${leadId}`,lead_id:leadId,attempt_number:1,at:'2026-11-17T10:00:00Z',actor_id:userIdSdr,actor_name:'SDR de teste',status_at_attempt:entries.find(([id])=>id===leadId)[1],notes:''});
  const sdr=mockEnvironmentAndFetch(t,{role:'SDR',userId:userIdSdr,email:'sdr@example.test'});
  const worklist=await invoke('apiGetSdrWorklist',[sdr.token],sdr.token);
  const followupIds=worklist.body.followupAlerts.map((item)=>item.id);
  assert.equal(followupIds.includes('lead-terminal-desistencia'),false);
  assert.equal(followupIds.includes('lead-terminal-comprou'),false);
  assert.equal(followupIds.includes('lead-reprovado-caixa'),true,'reprovação permanece para acompanhamento');
  assert.equal(followupIds.includes('lead-atendimento'),true,'atendimento realizado não deve ser encerrado automaticamente');
  assert.equal(followupIds.includes('lead-sem-primeiro-contato'),false,'lead sem primeira tentativa não entra em follow-up');
  assert.equal(worklist.body.newLeads.some((item)=>item.id==='lead-sem-primeiro-contato'),true,'lead sem status revisado permanece em novos cadastros');
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
  assert.equal(worklist.body.newLeads.some((item)=>item.id===id),true,'a solicitação de correção do telefone não equivale à revisão do status');
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
  const originals={users:rows.crm_users.slice(),leads:rows.crm_leads.slice(),sales:rows.crm_sales.slice(),contracts:rows.crm_contracts.slice(),documents:rows.crm_contract_documents.slice(),profiles:rows.crm_broker_profiles.slice(),teamProfiles:structuredClone(rows.crm_user_contract_profiles),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_users.splice(0,rows.crm_users.length,...originals.users);rows.crm_leads.splice(0,rows.crm_leads.length,...originals.leads);rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);rows.crm_contracts.splice(0,rows.crm_contracts.length,...originals.contracts);rows.crm_contract_documents.splice(0,rows.crm_contract_documents.length,...originals.documents);rows.crm_broker_profiles.splice(0,rows.crm_broker_profiles.length,...originals.profiles);rows.crm_user_contract_profiles.splice(0,rows.crm_user_contract_profiles.length,...originals.teamProfiles);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const coordinatorId='10000000-0000-4000-8000-000000000034';
  rows.crm_users.push({id:coordinatorId,name:'Coordenador de teste',email:'coord@example.test',role:'Coordenador',active:true,must_change_password:false,session_version:0});
  const saleId='10000000-0000-4000-8000-000000000035';
  const secondSaleId='10000000-0000-4000-8000-000000000038';
  rows.crm_sales.push(
    {id:saleId,lead_id:null,process_number:'PROC-FIFTY-15',buyer_name:'Cliente do contrato',broker_id:userIdBrokerA,sdr_id:userIdSdr,development_id:'E001',unit:'A-101',unit_value:200000,commission_rate_pct:2.5,gross_commission:5000,sold_at:'2026-11-08',sale_status:'Pendência para contabilização',repass_status:'FASE DO REGISTRO',is_sdr_sale:true,deleted_at:null},
    {id:secondSaleId,lead_id:null,process_number:'PROC-FIFTY-16',buyer_name:'Segundo cliente',broker_id:userIdBrokerA,sdr_id:null,development_id:'E001',unit:'A-102',unit_value:210000,commission_rate_pct:2.5,gross_commission:5250,sold_at:'2026-11-08',sale_status:'Pendência para contabilização',repass_status:'FASE DO REGISTRO',is_sdr_sale:true,deleted_at:null}
  );
  rows.crm_user_contract_profiles.push({user_id:userIdBrokerA,cpf:'111.222.333-44',cnpj:'',creci:'',address:''});
  rows.crm_user_contract_profiles.push({user_id:userIdSdr,cpf:'444.555.666-77',cnpj:'',creci:'',address:''});
  const secondSdrId='10000000-0000-4000-8000-000000000036';
  rows.crm_users.push({id:secondSdrId,name:'Segundo SDR',email:'sdr2@example.test',role:'SDR',active:true,must_change_password:false,session_version:0});
  rows.crm_user_contract_profiles.push({user_id:secondSdrId,cpf:'',cnpj:'',creci:'',address:''});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const refs=await invoke('apiGetReferenceData',[manager.token],manager.token);
  assert.deepEqual(refs.body.managers.map((item)=>item.id),[userIdManager]);
  assert.deepEqual(refs.body.sdrs.map((item)=>item.id).sort(),[userIdSdr,secondSdrId].sort());
  const draft=await invoke('apiSaveContract',[manager.token,{saleId,brokerId:userIdBrokerA,sdrId:userIdSdr,managerId:coordinatorId}],manager.token);
  assert.equal(draft.body.ok,false);
  assert.match(draft.body.message,/gerente/i);
  const saved=await invoke('apiSaveContract',[manager.token,{saleId,brokerId:userIdBrokerA,sdrId:userIdSdr,managerId:userIdManager,buyerCpf:'',proposalNumber:'',commissionBase:200000,commissionRatePct:2.5,grossCommission:5000,managerCommissionRatePct:0.5,managerCommissionValue:1000,hasPrize:true,prizeRatePct:1.2,grossPrize:1000}],manager.token);
  assert.equal(saved.response.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.ok,true);
  const contract=rows.crm_contracts.find((item)=>item.id===saved.body.contractId);
  assert.equal(contract.proposal_number,'');
  assert.equal(contract.sdr_cpf,'444.555.666-77');
  assert.equal(contract.sdr_cnpj,'');
  assert.equal(contract.sdr_address,'');
  assert.equal(Number(contract.commission_base),200000);
  assert.equal(Number(contract.commission_rate_pct),2.5);
  assert.equal(Number(contract.manager_commission_rate_pct),0.5);
  assert.equal(Number(contract.manager_commission_value),1000);
  assert.equal(Number(contract.prize_rate_pct),1.2);
  const secondSdrDraft=await invoke('apiSaveContract',[manager.token,{saleId:secondSaleId,brokerId:userIdBrokerA,sdrId:secondSdrId,managerId:userIdManager,proposalNumber:'PASTA-2026-16',commissionRatePct:2.5,grossCommission:5250,hasPrize:false}],manager.token);
  assert.equal(secondSdrDraft.body.ok,true,JSON.stringify(secondSdrDraft.body));
  assert.equal(rows.crm_contracts.find((item)=>item.id===secondSdrDraft.body.contractId).sdr_cpf,'');
  const template=await invoke('apiGetContractTemplate',[manager.token],manager.token);
  assert.match(template.body.template,/PROJETO SDR SHARKS \| MUNDO APTO/);
  assert.match(template.body.template,/{{numero_proposta}}/);
  assert.match(template.body.template,/{{sdr_cpf}}/);
  assert.match(template.body.template,/{{comissao_corretor}}/);
  assert.match(template.body.template,/{{corretor_cnpj}}/);
  assert.match(template.body.template,/{{corretor_endereco}}/);
  const missingProposal=await invoke('apiGenerateContract',[manager.token,saved.body.contractId],manager.token);
  assert.equal(missingProposal.body.ok,false);
  assert.match(missingProposal.body.message,/número da proposta/i);
  const savedProposal=await invoke('apiSaveContract',[manager.token,{id:saved.body.contractId,saleId,brokerId:userIdBrokerA,sdrId:userIdSdr,managerId:userIdManager,proposalNumber:'PASTA-2026-15',commissionRatePct:2.5,hasPrize:true,prizeRatePct:1.2}],manager.token);
  assert.equal(savedProposal.body.ok,true,JSON.stringify(savedProposal.body));
  const missingManagerProfile=await invoke('apiGenerateContract',[manager.token,saved.body.contractId],manager.token);
  assert.equal(missingManagerProfile.body.ok,false);
  assert.match(missingManagerProfile.body.message,/dados cadastrais do gerente/i);
  const managerProfileSave=await invoke('apiSaveUser',[manager.token,{id:userIdManager,name:'Gestor de teste',email:'gestao@example.test',role:'Gerente',active:true,contractCpf:'333.444.555-66',contractCnpj:'98.765.432/0001-10',contractCreci:'CRECI-GER-1',contractAddress:'Avenida da Gestão, 20'}],manager.token);
  assert.equal(managerProfileSave.body.ok,true,JSON.stringify(managerProfileSave.body));
  assert.equal(rows.crm_user_contract_profiles.find((item)=>item.user_id===userIdManager).cpf,'333.444.555-66','Camilla/Paulo podem salvar os dados cadastrais do gerente sem alterar permissões do módulo operacional');
  const generated=await invoke('apiGenerateContract',[manager.token,saved.body.contractId],manager.token);
  assert.equal(generated.response.status,200,JSON.stringify(generated.body));
  assert.equal(generated.body.ok,true);
  assert.match(generated.body.downloadUrl,/download=/);
  const generatedFile=manager.calls.find((call)=>call.path.includes('/storage/v1/object/crm-contracts/generated/'));
  assert.ok(generatedFile);
  assert.match(generatedFile.body,/PASTA-2026-15/);
  assert.match(generatedFile.body,/PROJETO SDR SHARKS \| MUNDO APTO/);
  assert.match(generatedFile.body,/444\.555\.666-77/);
  assert.doesNotMatch(generatedFile.body,/12\.345\.678\/0001-90|Rua de Teste, 100/,'dados vazios de corretor/SDR não impedem gerar nem são substituídos por dados inventados');
  assert.match(generatedFile.body,/0,5% \/ R\$\s?1\.000,00/);
  assert.match(generatedFile.body,/2\.500/);
  assert.match(generatedFile.body,/A quitação será concedida/);
  assert.equal(rows.crm_contracts.find((item)=>item.id===saved.body.contractId).status,'Gerado para assinatura');
  const unsignedVisible=await invoke('apiListContracts',[manager.token],manager.token);
  assert.equal(unsignedVisible.body.length,2,'um registro deve permanecer disponível para cada SDR vinculado');
  const contractRow=rows.crm_contracts.find((item)=>item.id===saved.body.contractId);
  assert.equal(contractRow.broker_commission,2500);
  assert.equal(contractRow.sdr_commission,2500);
  const listedContracts=await invoke('apiListContracts',[manager.token],manager.token);
  const listedContract=listedContracts.body.find((item)=>item.id===contractRow.id);
  assert.equal(listedContract.managerCommissionRatePct,0.5);
  assert.equal(listedContract.managerCommissionValue,1000);
  assert.equal(contractRow.broker_prize,1200);
  assert.equal(contractRow.sdr_prize,1200);
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
  const restrictedContract=await invoke('apiSaveContract',[sdr.token,{saleId,brokerId:userIdBrokerA,sdrId:userIdSdr,managerId:userIdManager}],sdr.token);
  assert.equal(restrictedContract.response.status,403);
});

test('Termo Fifty pode partir de venda manual e confissão não é gerada novamente', async (t) => {
  const originals={sales:rows.crm_sales.slice(),receipts:rows.crm_sales_receipts.slice(),contracts:rows.crm_contracts.slice(),documents:rows.crm_contract_documents.slice(),profiles:rows.crm_broker_profiles.slice(),teamProfiles:structuredClone(rows.crm_user_contract_profiles),settings:rows.crm_settings.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);rows.crm_sales_receipts.splice(0,rows.crm_sales_receipts.length,...originals.receipts);rows.crm_contracts.splice(0,rows.crm_contracts.length,...originals.contracts);rows.crm_contract_documents.splice(0,rows.crm_contract_documents.length,...originals.documents);rows.crm_broker_profiles.splice(0,rows.crm_broker_profiles.length,...originals.profiles);rows.crm_user_contract_profiles.splice(0,rows.crm_user_contract_profiles.length,...originals.teamProfiles);rows.crm_settings.splice(0,rows.crm_settings.length,...originals.settings);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const sale=await invoke('apiSaveSale',[manager.token,{processNumber:'PROC-EXT-77',buyerName:'Comprador fora do CRM',developmentId:'E001',brokerId:userIdBrokerA,sdrId:userIdSdr,soldAt:'2026-11-12',unit:'B-204',unitValue:245000,commissionRatePct:2.5,isSdrSale:true,saleStatus:'Pendência para contabilização',repassStatus:'FASE DO REGISTRO',hasPending:false,pendingDescription:'',accounted:false,notes:'Venda manual externa'}],manager.token);
  assert.equal(sale.body.ok,true,JSON.stringify(sale.body));
  assert.equal(rows.crm_sales.find((item)=>item.id===sale.body.saleId).is_sdr_sale,true);
  const profile={user_id:userIdBrokerA,cpf:'111.222.333-44',cnpj:'12.345.678/0001-90',creci:'12345',address:'Rua de Teste, 100'};rows.crm_user_contract_profiles.push(profile);
  rows.crm_user_contract_profiles.push({user_id:userIdSdr,cpf:'222.333.444-55',cnpj:'22.333.444/0001-90',creci:'',address:'Rua SDR, 50'});
  const saved=await invoke('apiSaveContract',[manager.token,{saleId:sale.body.saleId,sdrId:userIdSdr,managerId:userIdManager,buyerCpf:'',buyerAddress:'Rua Externa, 10',proposalNumber:'PASTA-EXT-77',commissionBase:245000,commissionRatePct:2.5,grossCommission:6125,hasPrize:false}],manager.token);
  assert.equal(saved.body.ok,true,JSON.stringify(saved.body));
  const contract=rows.crm_contracts.find((item)=>item.id===saved.body.contractId);
  assert.equal(contract.sale_id,sale.body.saleId);
  assert.equal(contract.lead_id,null);
  assert.equal(contract.process_number,'PROC-EXT-77');
  assert.equal(contract.buyer_name,'Comprador fora do CRM');
  assert.equal(contract.buyer_cpf,'','CPF do comprador não é obrigatório para gerar o Termo Fifty.');
  assert.equal(Number(contract.unit_value),245000);
  assert.equal(contract.sdr_cnpj,'22.333.444/0001-90');
  const confessionTemplate=await invoke('apiSaveContractTemplate',[manager.token,{kind:'debt_confession',html:'<html><body>Modelo antigo</body></html>'}],manager.token);
  assert.equal(confessionTemplate.body.ok,false,'A plataforma não deve aceitar novos modelos de confissão.');
  assert.match(confessionTemplate.body.message,/somente o modelo do Termo Fifty/i);
  const confession=await invoke('apiGenerateContract',[manager.token,contract.id,'debt_confession'],manager.token);
  assert.equal(confession.body.ok,false,'Novas confissões não devem ser geradas.');
  assert.match(confession.body.message,/somente o Termo Fifty/i);
  rows.crm_user_contract_profiles.push({user_id:userIdManager,cpf:'333.444.555-66',cnpj:'98.765.432/0001-10',creci:'CRECI-GER-1',address:'Avenida da Gestão, 20'});
  const managerAgain=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const agreement=await invoke('apiGenerateContract',[managerAgain.token,contract.id,'agreement'],managerAgain.token);
  assert.equal(agreement.body.ok,true,JSON.stringify(agreement.body));
  const generatedAgreement=managerAgain.calls.find((call)=>call.path.includes('/storage/v1/object/crm-contracts/generated/')&&call.path.includes('/agreement/'));
  assert.ok(generatedAgreement,'O Termo Fifty deve ser gerado no armazenamento privado.');
  assert.match(generatedAgreement.body,/Corretor A/);
  assert.match(generatedAgreement.body,/SDR de teste/);
  assert.match(generatedAgreement.body,/Gestor de teste/);
  const preparedAgreement=await invoke('apiCreateContractUpload',[managerAgain.token,contract.id,{documentKind:'agreement',name:'contrato-assinado.pdf',mimeType:'application/pdf',sizeBytes:1400}],managerAgain.token);
  assert.equal(preparedAgreement.body.ok,true,JSON.stringify(preparedAgreement.body));
  const agreementConfirmed=await invoke('apiConfirmContractSigned',[managerAgain.token,contract.id,preparedAgreement.body.documentId,true],managerAgain.token);
  assert.equal(agreementConfirmed.body.ok,true,JSON.stringify(agreementConfirmed.body));
  assert.equal(contract.status,'Assinado');
  const duplicateAgreementUpload=await invoke('apiCreateContractUpload',[managerAgain.token,contract.id,{documentKind:'agreement',name:'contrato-substituto.pdf',mimeType:'application/pdf',sizeBytes:1400}],managerAgain.token);
  assert.equal(duplicateAgreementUpload.body.ok,false);
  assert.match(duplicateAgreementUpload.body.message,/assinatura deste documento já foi confirmada/i);
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const visible=await invoke('apiListContracts',[broker.token],broker.token);
  assert.equal(visible.body.length,1);
  assert.deepEqual(visible.body[0].documents.map((item)=>item.kind),['agreement']);
});

test('gestão registra venda manual sem lead e confirma recebimento integral único', async (t) => {
  const originals = { sales:rows.crm_sales.slice(), receipts:rows.crm_sales_receipts.slice(), audit:rows.crm_audit.slice() };
  t.after(() => {
    rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);
    rows.crm_sales_receipts.splice(0,rows.crm_sales_receipts.length,...originals.receipts);
    rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);
  });
  const manager = mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const saved = await invoke('apiSaveSale',[manager.token,{
    buyerName:'Cliente externo ao CRM',processNumber:'PROC-2026-77',developmentId:'E001',brokerId:userIdBrokerA,sdrId:userIdSdr,
    soldAt:'2026-11-11',unit:'B-201',unitValue:'250000.00',commissionRatePct:'2',isSdrSale:true,managerCommissionRatePct:'0.5',hasPrize:true,prizeRatePct:'2',saleStatus:'Pendência para contabilização',hasPending:true,
    pendingDescription:'Aguardando conferência documental',accounted:false,
    repassStatus:'FASE DO REGISTRO',notes:'Venda inserida manualmente pela gestão'
  }],manager.token);
  assert.equal(saved.response.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.ok,true);
  const sale = rows.crm_sales.find((item)=>item.id===saved.body.saleId);
  assert.ok(sale);
  assert.equal(sale.lead_id,null);
  assert.equal(sale.process_number,'PROC-2026-77');
  assert.equal(sale.has_pending,true);
  assert.equal(Number(sale.gross_commission),5000);
  assert.equal(Number(sale.broker_commission),2500);
  assert.equal(Number(sale.sdr_commission),2500);
  assert.equal(sale.is_sdr_sale,true);
  assert.equal(Number(sale.manager_commission_value),1250);
  assert.equal(Number(sale.gross_prize),5000);
  assert.equal(Number(sale.broker_prize),2500);
  assert.equal(Number(sale.sdr_prize),2500);
  assert.equal(rows.crm_audit.at(-1).action,'sale.create');
  assert.deepEqual(rows.crm_audit.at(-1).before_values,{});

  const linkedId='10000000-0000-4000-8000-000000000042';
  rows.crm_sales.push({id:linkedId,internal_number:'MA-VENDA-2026-TESTE',process_number:'',lead_id:'lead-a',buyer_name:'Cliente vinculado',development_id:'E001',broker_id:userIdBrokerA,sold_at:'2026-11-10',unit:'A-102',unit_value:180000,sale_status:'Cadastrada',has_pending:false,pending_description:'',accounted:false,expected_repass:0,repass_status:'AGUARDANDO PJ',notes:'',created_by:userIdManager,updated_by:userIdManager});
  const editedLinked = await invoke('apiSaveSale',[manager.token,{id:linkedId,buyerName:'Cliente vinculado',processNumber:'PROC-ATUALIZADO',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-10',unit:'A-102',unitValue:'180000',expectedRepass:'0',saleStatus:'Pendência para contabilização',repassStatus:'AGUARDANDO PJ',hasPending:false,pendingDescription:'',accounted:false,notes:''}],manager.token);
  assert.equal(editedLinked.body.ok,true,JSON.stringify(editedLinked.body));
  assert.equal(rows.crm_sales.find((item)=>item.id===linkedId).lead_id,'lead-a');

  const first = await invoke('apiAddSaleReceipt',[manager.token,sale.id,{receivedAt:'2026-11-12',notes:'Recebimento integral'}],manager.token);
  assert.equal(first.response.status,200,JSON.stringify(first.body));
  assert.equal(first.body.repassStatus,'COMISSÃO PAGA');
  assert.equal(first.body.totalReceived,2500);
  assert.equal(first.body.balance,0);
  assert.equal(rows.crm_sales_receipts.filter((item)=>item.sale_id===sale.id).length,1);
  assert.equal(Number(rows.crm_sales_receipts[0].amount),2500);
  assert.equal(rows.crm_audit.filter((item)=>item.action==='sale.receipt.create').length,1);
  const duplicate = await invoke('apiAddSaleReceipt',[manager.token,sale.id,{receivedAt:'2026-11-13',notes:'Tentativa duplicada'}],manager.token);
  assert.equal(duplicate.response.status,400);

  const listed = await invoke('apiListSales',[manager.token],manager.token);
  const savedSale = listed.body.find((item)=>item.id===sale.id);
  assert.equal(listed.body.length,2);
  assert.equal(savedSale.receivedRepass,2500);
  assert.equal(savedSale.balanceRepass,0);
});

test('vendas retornam comissão bruta e divisões corretas, mantendo repasse do corretor', async (t) => {
  const originals={sales:rows.crm_sales.slice(),receipts:rows.crm_sales_receipts.slice()};
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);rows.crm_sales_receipts.splice(0,rows.crm_sales_receipts.length,...originals.receipts);});
  const currentId='10000000-0000-4000-8000-000000000095';
  const legacyId='10000000-0000-4000-8000-000000000096';
  const unselectedSdrId='10000000-0000-4000-8000-000000000097';
  rows.crm_sales.push(
    {id:currentId,internal_number:'MA-VENDA-COMISSAO',process_number:'PROC-COMISSAO',buyer_name:'Comissão atual',development_id:'E001',broker_id:userIdBrokerA,sdr_id:userIdSdr,is_sdr_sale:true,sold_at:'2026-11-12',unit:'C-301',unit_value:200000,sale_status:'Contabilizado',has_pending:false,accounted:true,gross_commission:5000,broker_commission:2500,sdr_commission:2500,expected_repass:2500,repass_status:'AGUARDANDO PJ',created_by:userIdManager,updated_by:userIdManager},
    {id:legacyId,internal_number:'MA-VENDA-LEGADA',process_number:'PROC-LEGADO',buyer_name:'Comissão legada',development_id:'E001',broker_id:userIdBrokerA,sold_at:'2026-11-11',unit:'C-302',unit_value:180000,sale_status:'Contabilizado',has_pending:false,accounted:true,gross_commission:0,broker_commission:1000,sdr_commission:1000,expected_repass:1000,repass_status:'AGUARDANDO PJ',created_by:userIdManager,updated_by:userIdManager},
    {id:unselectedSdrId,internal_number:'MA-VENDA-SEM-SDR',process_number:'PROC-SEM-SDR',buyer_name:'Sem participação do SDR',development_id:'E001',broker_id:userIdBrokerA,sdr_id:userIdSdr,is_sdr_sale:false,sold_at:'2026-11-10',unit:'C-303',unit_value:80000,sale_status:'Contabilizado',has_pending:false,accounted:true,gross_commission:2000,broker_commission:1000,sdr_commission:1000,expected_repass:1000,repass_status:'AGUARDANDO PJ',created_by:userIdManager,updated_by:userIdManager}
  );
  rows.crm_sales_receipts.push({id:'receipt-commission-test',sale_id:currentId,amount:500,received_at:'2026-11-13',created_by:userIdManager});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const listed=await invoke('apiListSales',[manager.token],manager.token);
  const current=listed.body.find((item)=>item.id===currentId);
  const legacy=listed.body.find((item)=>item.id===legacyId);
  assert.equal(current.grossCommission,5000);
  assert.equal(current.brokerCommission,2500);
  assert.equal(current.sdrCommission,2500);
  assert.equal(current.expectedRepass,2500);
  assert.equal(current.balanceRepass,2000);
  assert.equal(current.isSdrSale,true,'A venda atual com SDR selecionado permanece classificada como originada pelo SDR.');
  assert.equal(legacy.grossCommission,2000,'O total bruto legado é recuperado pela soma das partes antigas, sem atribuir uma delas ao SDR.');
  assert.equal(legacy.brokerCommission,2000,'Sem SDR selecionado, a comissão bruta fica integralmente com o corretor.');
  assert.equal(legacy.sdrCommission,0,'Valores antigos de SDR sem vínculo selecionado não contam como comissão do SDR.');
  assert.equal(legacy.expectedRepass,2000);
  const unselected=listed.body.find((item)=>item.id===unselectedSdrId);
  assert.equal(unselected.grossCommission,2000);
  assert.equal(unselected.brokerCommission,2000,'Uma venda explicitamente sem participação atribui a comissão bruta ao corretor, mesmo que tenha um vínculo antigo de SDR.');
  assert.equal(unselected.sdrCommission,0,'Uma venda explicitamente sem participação não cria comissão para o SDR.');
});

test('corretor consulta somente as próprias vendas e recebe apenas os dados do seu repasse', async (t) => {
  const originalSales = rows.crm_sales.slice(); const originalReceipts = rows.crm_sales_receipts.slice();
  t.after(() => { rows.crm_sales.splice(0, rows.crm_sales.length, ...originalSales); rows.crm_sales_receipts.splice(0, rows.crm_sales_receipts.length, ...originalReceipts); });
  const ownSaleId = '10000000-0000-4000-8000-000000000171';
  const otherSaleId = '10000000-0000-4000-8000-000000000172';
  const archivedSaleId = '10000000-0000-4000-8000-000000000173';
  rows.crm_sales.push(
    { id: ownSaleId, internal_number: 'MA-PRÓPRIA', process_number: 'PROC-PRÓPRIO', buyer_name: 'Comprador do corretor A', development_id: 'E001', broker_id: userIdBrokerA, sdr_id: userIdSdr, sold_at: '2026-11-14', unit: 'A-101', unit_value: 200000, sale_status: 'Contabilizado', repass_status: 'AGUARDANDO PJ', gross_commission: 5000, broker_commission: 2500, sdr_commission: 2500, manager_commission_rate_pct: 0.5, manager_commission_value: 1000, has_pending: false, notes: 'Nota interna confidencial', created_by: userIdManager, updated_by: userIdManager },
    { id: otherSaleId, internal_number: 'MA-ALHEIA', process_number: 'PROC-ALHEIO', buyer_name: 'Comprador do corretor B', development_id: 'E001', broker_id: userIdBrokerB, sold_at: '2026-11-13', unit: 'B-202', unit_value: 180000, sale_status: 'Contabilizado', repass_status: 'AGUARDANDO PJ', broker_commission: 900, expected_repass: 900, has_pending: false },
    { id: archivedSaleId, internal_number: 'MA-ARQUIVADA', process_number: 'PROC-ARQUIVADA', buyer_name: 'Venda excluída', development_id: 'E001', broker_id: userIdBrokerA, sold_at: '2026-11-12', unit: 'A-103', unit_value: 190000, sale_status: 'Contabilizado', repass_status: 'AGUARDANDO PJ', broker_commission: 950, expected_repass: 950, deleted_at: '2026-11-15T12:00:00Z' }
  );
  rows.crm_sales_receipts.push({ id: '10000000-0000-4000-8000-000000000174', sale_id: ownSaleId, amount: 1000, received_at: '2026-11-16', notes: 'Nota financeira interna', created_by: userIdManager });
  rows.crm_sales_receipts.push({ id: '10000000-0000-4000-8000-000000000175', sale_id: otherSaleId, amount: 900, received_at: '2026-11-16', created_by: userIdManager });

  const broker = mockEnvironmentAndFetch(t, { role: 'Corretor', userId: userIdBrokerA, email: 'a@example.test' });
  const listed = await invoke('apiListSales', [broker.token, { includeArchived: true }], broker.token);
  assert.equal(listed.response.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.length, 1, 'o corretor vê somente a venda própria ativa, mesmo pedindo arquivos excluídos');
  const sale = listed.body[0];
  assert.equal(sale.id, ownSaleId);
  assert.equal(sale.buyerName, 'Comprador do corretor A');
  assert.equal(sale.brokerCommission, 2500);
  assert.equal(sale.receivedRepass, 1000);
  assert.equal(sale.balanceRepass, 1500);
  assert.equal(sale.receipts.length, 1);
  assert.deepEqual(Object.keys(sale).sort(), ['balanceRepass','brokerCommission','buyerName','developmentName','expectedRepass','hasPending','id','internalNumber','isCancelledOrDistrato','isCommissionPaid','processNumber','receivedRepass','receipts','repassStatus','saleStatus','soldAt','unit','unitValue'].sort());
  assert.deepEqual(Object.keys(sale.receipts[0]).sort(), ['amount','receivedAt','voidedAt']);
  const salesQuery = broker.calls.find((call) => call.path === '/rest/v1/crm_sales');
  assert.equal(salesQuery.query.broker_id, `eq.${userIdBrokerA}`, 'o filtro de carteira deve ser imposto no servidor');
  assert.equal(salesQuery.query.deleted_at, 'is.null');
  assert.ok(broker.calls.some((call) => call.path === '/rest/v1/crm_sales_receipts' && call.query.sale_id === `in.(${ownSaleId})`), 'os recebimentos também são limitados às vendas próprias');
  assert.equal((await invoke('apiSaveSale', [broker.token, { buyerName: 'Não pode cadastrar' }], broker.token)).response.status, 403);
  assert.equal((await invoke('apiAddSaleReceipt', [broker.token, ownSaleId, { receivedAt: '2026-11-18' }], broker.token)).response.status, 403);
  assert.equal((await invoke('apiArchiveSale', [broker.token, ownSaleId], broker.token)).response.status, 403);

  const manager = mockEnvironmentAndFetch(t, { role: 'Gerente', userId: userIdManager, email: 'gestao@example.test' });
  const managerRows = await invoke('apiListSales', [manager.token, { includeArchived: true }], manager.token);
  assert.equal(managerRows.body.length, 3, 'a gestão mantém o acesso completo, inclusive a arquivos excluídos');
  const managerOwnSale = managerRows.body.find((item) => item.id === ownSaleId);
  assert.equal(managerOwnSale.sdrCommission, 2500);
  assert.equal(managerOwnSale.managerCommissionValue, 1000);
  assert.equal(managerOwnSale.notes, 'Nota interna confidencial');
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

  const later=await invoke('apiAddSaleReceipt',[manager.token,saleId,{receivedAt:'2026-11-12',notes:'Recebimento integral correto'}],manager.token);
  assert.equal(later.body.ok,true,JSON.stringify(later.body));
  assert.equal(later.body.totalReceived,1000);
  assert.equal(later.body.balance,0);
  const listed=await invoke('apiListSales',[manager.token],manager.token);
  const sale=listed.body.find((item)=>item.id===saleId);
  assert.equal(sale.receivedRepass,1000);
  assert.equal(sale.balanceRepass,0);
  assert.equal(sale.receipts.length,2);
  assert.ok(sale.receipts.some((item)=>item.voidedAt&&item.voidReason==='Valor lançado em duplicidade'));
});

test('anulação de recebimento é restrita aos perfis administrativos', async (t) => {
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const result=await invoke('apiVoidSaleReceipt',[broker.token,'10000000-0000-4000-8000-000000000045',{reason:'Motivo válido'}],broker.token);
  assert.equal(result.response.status,403);
});

test('exclusão de venda é reversível e preserva recebimentos e contratos', async (t) => {
  const originals={sales:rows.crm_sales.slice(),receipts:rows.crm_sales_receipts.slice(),contracts:rows.crm_contracts.slice(),audit:rows.crm_audit.slice()};
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);rows.crm_sales_receipts.splice(0,rows.crm_sales_receipts.length,...originals.receipts);rows.crm_contracts.splice(0,rows.crm_contracts.length,...originals.contracts);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const saleId='10000000-0000-4000-8000-000000000092';
  const receiptId='10000000-0000-4000-8000-000000000093';
  const contractId='10000000-0000-4000-8000-000000000094';
  rows.crm_sales.push({id:saleId,internal_number:'MA-VENDA-TESTE',process_number:'PROC-RESTORE',buyer_name:'Venda a excluir',development_id:'E001',broker_id:userIdBrokerA,sold_at:'2026-11-10',unit:'A-103',unit_value:180000,sale_status:'Contabilizado',has_pending:false,pending_description:'',accounted:true,expected_repass:900,repass_status:'COMISSÃO PAGA',gross_commission:1800,broker_commission:900,sdr_commission:900,notes:'',created_by:userIdManager,updated_by:userIdManager});
  rows.crm_sales_receipts.push({id:receiptId,sale_id:saleId,amount:900,received_at:'2026-11-11',notes:'Integral',created_by:userIdManager});
  rows.crm_contracts.push({id:contractId,sale_id:saleId,contract_number:'MA-TESTE',buyer_name:'Venda a excluir',status:'Rascunho'});
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  assert.equal((await invoke('apiArchiveSale',[broker.token,saleId],broker.token)).response.status,403);
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const archived=await invoke('apiArchiveSale',[manager.token,saleId],manager.token);
  assert.equal(archived.body.ok,true,JSON.stringify(archived.body));
  assert.ok(rows.crm_sales.find((item)=>item.id===saleId).deleted_at);
  assert.ok(rows.crm_sales_receipts.find((item)=>item.id===receiptId));
  assert.ok(rows.crm_contracts.find((item)=>item.id===contractId));
  assert.equal((await invoke('apiListSales',[manager.token],manager.token)).body.some((item)=>item.id===saleId),false);
  assert.equal((await invoke('apiListSales',[manager.token,{includeArchived:true}],manager.token)).body.some((item)=>item.id===saleId),true);
  const restored=await invoke('apiRestoreSale',[manager.token,saleId],manager.token);
  assert.equal(restored.body.ok,true,JSON.stringify(restored.body));
  assert.equal(rows.crm_sales.find((item)=>item.id===saleId).deleted_at,null);
});

test('fase do repasse mantém a lista anterior e acrescenta as 16 opções enviadas pela cliente', async (t) => {
  const originalSales=rows.crm_sales.slice();const originalAudit=rows.crm_audit.slice();
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originalSales);rows.crm_audit.splice(0,rows.crm_audit.length,...originalAudit);});
  const previous=['AGUARDANDO PJ','LIBERADO P/ REPASSE','IR FUTURO','PENDÊNCIA PARA LIBERAÇÃO DO REPASSE','REPASSE SFH','ANÁLISE DE CRÉDITO','EMISSÃO DE FORMULÁRIOS','FGTS EM DÉBITO','FGTS EM RESSARCIMENTO','FGTS COM ERRO','FORMULÁRIOS EM ASSINATURA','FORMULÁRIOS ASSINADOS','CRITICADO E ENVIADO P/ CONFORMIDADE','PENDÊNCIA DURANTE O REPASSE','INCONFORME','REANÁLISE DA CONFORMIDADE','CONFORME','AGUARDANDO DEMANDA MÍNIMA','CONFIRMAÇÃO DE VALORES COM CLIENTE','EMISSÃO CONFISSÃO DE DÍVIDA / SOLICITAÇÃO DE CONTRATO','CONTRATO EMITIDO','CONTRATO E CONFISSÃO DE DÍVIDA EM ASSINATURA','CONTRATO EM ASSINATURA E CONFISSÃO ASSINADA','CONTRATO ASSINADO E CONFISSÃO PENDENTE','PROBLEMA NA ASSINATURA DO FINANCIAMENTO','CONTRATO E CONFISSÃO ASSINADOS','CHECK-LIST DE REPASSE APTO PARA CONFERENCIA','AGUARDANDO REPACTUAÇÃO','CHECK-LIST DE REPASSE REPROVADO','CHECK-LIST DE REPASSE APROVADO'];
  const added=['FASE DO REGISTRO','CHECK-LIST DE REGISTRO REPROVADO','LIBERADO PARA REGISTRO','CHECK-LIST DE REGISTRO APROVADO','PRENOTADO','EXIGÊNCIA','ORÇAMENTO À PAGAR','EM REGISTRO','REGISTRADO / ENVIAR GARANTIA','GARANTIA ENVIADA','GARANTIA INCONFORME','RECURSO LIBERADO','SOLICITAÇÃO DE DISTRATO','DISTRATO FINALIZADO','REPASSE CONCLUIDO','COMISSÃO PAGA'];
  assert.equal(added.length,16);
  const expected=[...previous,...added,'COMISSÃO NA CABEÇA'];
  assert.deepEqual(crmConfig.repassStatuses,expected);
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const refs=await invoke('apiGetReferenceData',[manager.token],manager.token);
  assert.deepEqual(refs.body.repassStatuses,expected);
  const missingOrigin=await invoke('apiSaveSale',[manager.token,{buyerName:'Venda sem origem informada',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-12',unit:'A-00',unitValue:100000,commissionRatePct:2.5}],manager.token);
  assert.equal(missingOrigin.body.ok,false);
  assert.match(missingOrigin.body.message,/originada pelo sdr/i);
  const priorOption=await invoke('apiSaveSale',[manager.token,{buyerName:'Cliente histórico',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-12',unit:'A-0',unitValue:100000,commissionRatePct:2.5,isSdrSale:false,saleStatus:'Pendência para contabilização',repassStatus:'AGUARDANDO PJ'}],manager.token);
  assert.equal(priorOption.body.ok,true,JSON.stringify(priorOption.body));
  const invalidLegacy=await invoke('apiSaveSale',[manager.token,{buyerName:'Cliente',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-12',unit:'A-2',unitValue:100000,commissionRatePct:2.5,isSdrSale:false,saleStatus:'Pendência para contabilização',repassStatus:'Repasse parcial'}],manager.token);
  assert.equal(invalidLegacy.body.ok,false);
  assert.match(invalidLegacy.body.message,/fase do repasse inválida/i);
  const saved=await invoke('apiSaveSale',[manager.token,{buyerName:'Cliente',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-12',unit:'A-1',unitValue:100000,commissionRatePct:2.5,isSdrSale:false,saleStatus:'Pendência para contabilização'}],manager.token);
  assert.equal(saved.body.ok,true,JSON.stringify(saved.body));
  assert.equal(rows.crm_sales.at(-1).repass_status,'FASE DO REGISTRO');
});

test('recibos e comprovantes respeitam perfis, carteira, assinatura externa e pagamento integral', async (t) => {
  const originals={sales:structuredClone(rows.crm_sales),documents:structuredClone(rows.crm_commission_documents),documentSales:structuredClone(rows.crm_commission_document_sales),audit:structuredClone(rows.crm_audit),profiles:structuredClone(rows.crm_user_contract_profiles)};
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);rows.crm_commission_documents.splice(0,rows.crm_commission_documents.length,...originals.documents);rows.crm_commission_document_sales.splice(0,rows.crm_commission_document_sales.length,...originals.documentSales);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);rows.crm_user_contract_profiles.splice(0,rows.crm_user_contract_profiles.length,...originals.profiles);});
  const saleId='10000000-0000-4000-8000-000000000051';
  const nonSdrSaleId='10000000-0000-4000-8000-000000000052';
  rows.crm_sales.push({id:saleId,broker_id:userIdBrokerA,sdr_id:userIdSdr,development_id:'E001',unit_value:314609.34,process_number:'PROC-51',buyer_name:'Compradora de teste',unit:'305',sold_at:'2026-10-29',sale_status:'Contabilizado',repass_status:'FASE DO REGISTRO',is_sdr_sale:true,deleted_at:null});
  rows.crm_sales.push({id:nonSdrSaleId,broker_id:userIdBrokerA,development_id:'E001',unit_value:314609.34,process_number:'PROC-52',buyer_name:'Compradora sem SDR',unit:'306',sold_at:'2026-10-29',sale_status:'Contabilizado',repass_status:'FASE DO REGISTRO',is_sdr_sale:false,deleted_at:null});
  rows.crm_user_contract_profiles.push({user_id:userIdBrokerA,cpf:'111.222.333-44',cnpj:'12.345.678/0001-90',creci:'CRECI-1234',address:'Rua do Corretor, 10'}, {user_id:userIdSdr,cpf:'222.333.444-55'}, {user_id:userIdManager,cpf:'333.444.555-66',cnpj:'98.765.432/0001-10',creci:'CRECI-GER-1',address:'Avenida da Gestão, 20'});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const assistant=mockEnvironmentAndFetch(t,{role:'Assistente',userId:userIdAssistant,email:'assistente@example.test'});
  const coordinator=mockEnvironmentAndFetch(t,{role:'Coordenador',userId:userIdOtherAdmin,email:'admin2@example.test'});
  const created=await invoke('apiCreateCommissionReceipt',[manager.token,{saleId,brokerId:userIdBrokerA,managerId:userIdManager,sdrId:userIdSdr,withholdingRatePct:10,paymentDate:'2026-12-05',notes:'Recibo de validação'}],manager.token);
  assert.equal(created.body.ok,true,JSON.stringify(created.body));
  assert.equal(created.body.documents.length,2,'uma venda com SDR gera um recibo individual para cada participante');
  const brokerDoc=created.body.documents.find((doc)=>doc.recipientId===userIdBrokerA);
  const sdrDoc=created.body.documents.find((doc)=>doc.recipientId===userIdSdr);
  assert.ok(brokerDoc);assert.ok(sdrDoc);
  assert.equal(brokerDoc.recipientRole,'Corretor');assert.equal(sdrDoc.recipientRole,'SDR');
  assert.equal(brokerDoc.commissionBase,314609.34);
  assert.equal(brokerDoc.grossCommission,3932.61);
  assert.equal(sdrDoc.grossCommission,3932.62);
  assert.equal(brokerDoc.netCommission+sdrDoc.netCommission,7078.71);
  assert.equal(brokerDoc.signatureStatus,'pending');assert.equal(sdrDoc.signatureStatus,'pending');
  const exactBrazilianPrice=await invoke('apiSaveSale',[manager.token,{buyerName:'Teste de valor brasileiro',developmentId:'E001',brokerId:userIdBrokerA,soldAt:'2026-11-12',unit:'305',unitValue:'R$ 314.609,34',commissionRatePct:2.5,isSdrSale:false,saleStatus:'Pendência para contabilização',repassStatus:'FASE DO REGISTRO'}],manager.token);
  assert.equal(exactBrazilianPrice.body.ok,true,JSON.stringify(exactBrazilianPrice.body));
  const parsedPrice=rows.crm_sales.find((sale)=>sale.id===exactBrazilianPrice.body.saleId);
  assert.equal(Number(parsedPrice.unit_value),314609.34);
  assert.equal(Number(parsedPrice.gross_commission),7865.23);
  const generatedUploads=manager.calls.filter((call)=>call.path.includes('/object/crm-finance-documents/generated/'));
  assert.equal(generatedUploads.length,2,'dois arquivos PDF privados são criados para a venda com SDR');
  const brokerPdf=generatedUploads.find((call)=>call.path.includes(brokerDoc.id));
  const sdrPdf=generatedUploads.find((call)=>call.path.includes(sdrDoc.id));
  assert.ok(brokerPdf);assert.ok(sdrPdf);assert.match(brokerPdf.body,/^%PDF-1\.4/);assert.match(sdrPdf.body,/^%PDF-1\.4/);
  const brokerReceiptText=brokerPdf.body.replace(/\\([()\\])/g,'$1');
  const sdrReceiptText=sdrPdf.body.replace(/\\([()\\])/g,'$1');
  assert.match(brokerReceiptText,/DECLARAÇÃO DE RECEBIMENTO DE COMISSÃO/);
  assert.match(brokerReceiptText,/Comissão bruta total da venda \(2,5%\)/);
  assert.match(brokerReceiptText,/Cliente \/ comprador: Compradora de teste/,'o recibo deve identificar o comprador conforme o modelo enviado');
  assert.match(brokerReceiptText,/3\.1\. DO OBJETO/);
  assert.match(brokerReceiptText,/4\. DOS VALORES E DESCONTOS/);
  assert.match(brokerReceiptText,/5\. DA FORMA DE PAGAMENTO/);
  assert.match(brokerReceiptText,/6\. INTERMEDIAÇÃO E AUSÊNCIA DE VÍNCULO/);
  assert.match(brokerReceiptText,/7\. DISPOSIÇÕES GERAIS/);
  assert.match(brokerReceiptText,/Corretor A \| Corretor responsável/);
  assert.match(brokerReceiptText,/Gestor de teste \| Gerente/);
  assert.doesNotMatch(brokerReceiptText,/SDR de teste/,'recibo individual do corretor não deve mostrar os dados do SDR');
  assert.match(sdrReceiptText,/SDR de teste \| SDR participante/);
  assert.match(sdrReceiptText,/Gestor de teste \| Gerente/);
  assert.doesNotMatch(sdrReceiptText,/Corretor A/,'recibo individual do SDR não deve mostrar os dados do corretor');
  assert.match(brokerReceiptText,/INTERMEDIAÇÃO DE PAGAMENTO E AUSÊNCIA DE VÍNCULO EMPREGATÍCIO/);
  assert.doesNotMatch(brokerReceiptText,/Letícia da Silva Lima|Luís Fernando Lopes da Silva|Paulo Henrique de Morais Junior/,'Dados nominais do modelo de referência não podem vazar para novos recibos.');

  const duplicate=await invoke('apiCreateCommissionReceipt',[manager.token,{saleId,brokerId:userIdBrokerA,managerId:userIdManager,sdrId:'',withholdingRatePct:0,paymentDate:'2026-12-05'}],manager.token);
  assert.equal(duplicate.body.ok,false);
  assert.equal(rows.crm_commission_documents.filter((doc)=>doc.sale_id===saleId&&!doc.archived_at).length,2);
  const deniedCreate=await invoke('apiCreateCommissionReceipt',[coordinator.token,{saleId,brokerId:userIdBrokerA,managerId:userIdManager,sdrId:'',withholdingRatePct:0,paymentDate:'2026-12-05'}],coordinator.token);
  assert.equal(deniedCreate.response.status,403);
  assert.equal((await invoke('apiListCommissionDocuments',[coordinator.token],coordinator.token)).response.status,403);

  const brokerA=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const brokerB=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerB,email:'b@example.test'});
  const sdr=mockEnvironmentAndFetch(t,{role:'SDR',userId:userIdSdr,email:'sdr@example.test'});
  const docId=brokerDoc.id;const sdrDocId=sdrDoc.id;
  assert.equal((await invoke('apiListCommissionDocuments',[brokerA.token],brokerA.token)).body.length,1);
  assert.equal((await invoke('apiListCommissionDocuments',[brokerB.token],brokerB.token)).body.length,0);
  assert.equal((await invoke('apiListCommissionDocuments',[sdr.token],sdr.token)).body.length,1,'o SDR consulta somente o recibo próprio');
  assert.equal((await invoke('apiGetCommissionDocument',[brokerB.token,docId,'generated'],brokerB.token)).response.status,404);
  assert.equal((await invoke('apiPrepareCommissionDocumentUpload',[sdr.token,docId,{name:'recibo-assinado.pdf',mimeType:'application/pdf',sizeBytes:2048}],sdr.token)).response.status,404);
  assert.equal((await invoke('apiPrepareCommissionDocumentUpload',[brokerB.token,docId,{name:'recibo-assinado.pdf',mimeType:'application/pdf',sizeBytes:2048}],brokerB.token)).response.status,404);
  assert.equal((await invoke('apiPrepareCommissionDocumentUpload',[brokerA.token,sdrDocId,{name:'recibo-assinado.pdf',mimeType:'application/pdf',sizeBytes:2048}],brokerA.token)).response.status,404,'corretor não envia o recibo do SDR');
  assert.equal((await invoke('apiUpdateCommissionPayment',[manager.token,docId,{paid:true}],manager.token)).body.ok,false,'Não permite registrar pagamento antes da assinatura.');

  const upload=await invoke('apiPrepareCommissionDocumentUpload',[brokerA.token,docId,{name:'recibo-assinado.pdf',mimeType:'application/pdf',sizeBytes:2048}],brokerA.token);
  assert.equal(upload.body.ok,true,JSON.stringify(upload.body));
  assert.match(upload.body.uploadUrl,/crm-finance-documents/);
  const uploaded=await invoke('apiConfirmCommissionReceiptUpload',[brokerA.token,docId],brokerA.token);
  assert.equal(uploaded.body.ok,true,JSON.stringify(uploaded.body));
  const sdrUpload=await invoke('apiPrepareCommissionDocumentUpload',[sdr.token,sdrDocId,{name:'recibo-sdr-assinado.pdf',mimeType:'application/pdf',sizeBytes:2048}],sdr.token);
  assert.equal(sdrUpload.body.ok,true,JSON.stringify(sdrUpload.body));
  assert.equal((await invoke('apiConfirmCommissionReceiptUpload',[sdr.token,sdrDocId],sdr.token)).body.ok,true);
  const sdrConfirm=await invoke('apiConfirmCommissionReceiptSigned',[sdr.token,sdrDocId,true],sdr.token);
  assert.equal(sdrConfirm.response.status,403,'SDR consulta o recibo, mas não envia nem confirma o arquivo em nome do corretor.');
  const brokerCannotConfirm=await invoke('apiConfirmCommissionReceiptSigned',[brokerA.token,docId,{broker:true,sdr:true,manager:true}],brokerA.token);
  assert.equal(brokerCannotConfirm.response.status,403,'Somente gerente/assistente confirma após conferir os signatários externos.');
  const legacySignerPayload=await invoke('apiConfirmCommissionReceiptSigned',[manager.token,docId,{broker:true,sdr:true,manager:true}],manager.token);
  assert.equal(legacySignerPayload.body.ok,false,'O recibo não deve exigir nem aceitar confirmação de assinatura do SDR.');
  assert.match(legacySignerPayload.body.message,/confirmações individuais/i);
  const signed=await invoke('apiConfirmCommissionReceiptSigned',[manager.token,docId,{recipient:true,manager:true}],manager.token);
  assert.equal(signed.body.ok,true,JSON.stringify(signed.body));
  assert.equal(rows.crm_commission_documents.find((doc)=>doc.id===docId).signature_status,'signed');
  assert.equal(rows.crm_commission_documents.find((doc)=>doc.id===docId).sdr_signature_confirmed,false);
  const signedSdr=await invoke('apiConfirmCommissionReceiptSigned',[manager.token,sdrDocId,{recipient:true,manager:true}],manager.token);
  assert.equal(signedSdr.body.ok,true,JSON.stringify(signedSdr.body));
  assert.equal(rows.crm_commission_documents.find((doc)=>doc.id===sdrDocId).sdr_signature_confirmed,true);
  assert.equal(rows.crm_commission_documents.find((doc)=>doc.id===sdrDocId).broker_signature_confirmed,false);
  const paid=await invoke('apiUpdateCommissionPayment',[manager.token,docId,{paid:true}],manager.token);
  assert.equal(paid.body.ok,true,JSON.stringify(paid.body));
  assert.equal(rows.crm_commission_documents.find((doc)=>doc.id===docId).payment_status,'paid');
  assert.equal((await invoke('apiUpdateCommissionPayment',[manager.token,docId,{paid:true}],manager.token)).body.ok,false,'Não permite duplicar pagamento integral.');
  assert.match((await invoke('apiGetCommissionDocument',[brokerA.token,docId,'signed'],brokerA.token)).body.downloadUrl,/crm-finance-documents/);

  const archivedReceipt=await invoke('apiArchiveCommissionDocument',[manager.token,docId],manager.token);
  assert.equal(archivedReceipt.body.ok,true);
  const replacementReceipt=await invoke('apiCreateCommissionReceipt',[assistant.token,{saleId:nonSdrSaleId,brokerId:userIdBrokerA,managerId:userIdManager,sdrId:'',withholdingRatePct:10,paymentDate:'2026-12-05'}],assistant.token);
  assert.equal(replacementReceipt.body.ok,true,JSON.stringify(replacementReceipt.body));
  assert.equal(replacementReceipt.body.document.sdrId,'');
  assert.equal(replacementReceipt.body.document.brokerAmount,7078.71,'Sem SDR, o valor líquido permanece integralmente com o corretor.');
  assert.equal(replacementReceipt.body.document.sdrAmount,0);
  assert.equal((await invoke('apiRestoreCommissionDocument',[manager.token,docId],manager.token)).body.ok,true,'A venda original pode ser restaurada porque o recibo substituto pertence a outra venda.');
  assert.equal((await invoke('apiArchiveCommissionDocument',[assistant.token,replacementReceipt.body.document.id],assistant.token)).body.ok,true);
  assert.equal((await invoke('apiArchiveCommissionDocument',[manager.token,docId],manager.token)).body.ok,true);
  assert.equal((await invoke('apiRestoreCommissionDocument',[manager.token,docId],manager.token)).body.ok,true);

  const invoice=await invoke('apiCreateCommissionDocument',[manager.token,{type:'invoice',brokerId:userIdBrokerA,saleId,notes:'Nota fiscal teste'}],manager.token);
  assert.equal(invoice.body.ok,true,JSON.stringify(invoice.body));
  assert.equal((await invoke('apiCreateCommissionDocument',[coordinator.token,{type:'invoice',brokerId:userIdBrokerA,saleId}],coordinator.token)).response.status,403);
  assert.equal((await invoke('apiPrepareCommissionDocumentUpload',[brokerA.token,invoice.body.documentId,{name:'nota.pdf',mimeType:'application/pdf',sizeBytes:1000}],brokerA.token)).response.status,403);
  const attachment=await invoke('apiPrepareCommissionDocumentUpload',[manager.token,invoice.body.documentId,{name:'nota.pdf',mimeType:'application/pdf',sizeBytes:1000}],manager.token);
  assert.equal(attachment.body.ok,true,JSON.stringify(attachment.body));
  assert.equal((await invoke('apiConfirmCommissionDocumentUpload',[manager.token,invoice.body.documentId],manager.token)).body.ok,true);
  assert.equal((await invoke('apiGetCommissionDocument',[brokerB.token,invoice.body.documentId,'stored'],brokerB.token)).response.status,404);
  assert.equal((await invoke('apiArchiveCommissionDocument',[coordinator.token,invoice.body.documentId],coordinator.token)).response.status,403);
  assert.equal((await invoke('apiArchiveCommissionDocument',[manager.token,invoice.body.documentId],manager.token)).body.ok,true);
  assert.equal((await invoke('apiConfirmCommissionDocumentUpload',[manager.token,invoice.body.documentId],manager.token)).body.ok,false,'Documento arquivado não pode ser confirmado como recebido.');
  assert.equal((await invoke('apiListCommissionDocuments',[brokerA.token],brokerA.token)).body.some((doc)=>doc.id===invoice.body.documentId),false);
  assert.equal((await invoke('apiListCommissionDocuments',[manager.token,{includeArchived:true}],manager.token)).body.some((doc)=>doc.id===invoice.body.documentId),true);
  assert.equal((await invoke('apiRestoreCommissionDocument',[manager.token,invoice.body.documentId],manager.token)).body.ok,true);
  const paymentProof=await invoke('apiCreateCommissionDocument',[manager.token,{type:'payment_proof',brokerId:userIdBrokerA,saleId,notes:'Comprovante do pagamento da comissão'}],manager.token);
  assert.equal(paymentProof.body.ok,true,JSON.stringify(paymentProof.body));
  assert.equal(rows.crm_commission_documents.find((doc)=>doc.id===paymentProof.body.documentId).document_type,'payment_proof');
  assert.equal((await invoke('apiListCommissionDocuments',[brokerA.token],brokerA.token)).body.some((doc)=>doc.id===paymentProof.body.documentId),true,'O comprovante vinculado fica visível na base do corretor responsável.');
  assert.equal((await invoke('apiPrepareCommissionDocumentUpload',[brokerA.token,paymentProof.body.documentId,{name:'comprovante.pdf',mimeType:'application/pdf',sizeBytes:1024}],brokerA.token)).response.status,403,'O corretor consulta o comprovante, mas somente gerente/assistente o anexam.');
  const paymentProofUpload=await invoke('apiPrepareCommissionDocumentUpload',[manager.token,paymentProof.body.documentId,{name:'comprovante.pdf',mimeType:'application/pdf',sizeBytes:1024}],manager.token);
  assert.equal(paymentProofUpload.body.ok,true,JSON.stringify(paymentProofUpload.body));
  assert.equal((await invoke('apiConfirmCommissionDocumentUpload',[manager.token,paymentProof.body.documentId],manager.token)).body.ok,true);
  assert.ok(rows.crm_audit.some((item)=>item.action==='commission_receipt.generate'));
  assert.ok(rows.crm_audit.some((item)=>item.action==='commission_receipt.signed'));
  assert.ok(rows.crm_audit.some((item)=>item.action==='commission_receipt.payment_completed'));
});

test('recibo consolida mais de uma venda do mesmo corretor em um PDF e mantém vínculo individual por venda', async (t) => {
  const originals={sales:structuredClone(rows.crm_sales),documents:structuredClone(rows.crm_commission_documents),documentSales:structuredClone(rows.crm_commission_document_sales),audit:structuredClone(rows.crm_audit),profiles:structuredClone(rows.crm_user_contract_profiles)};
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);rows.crm_commission_documents.splice(0,rows.crm_commission_documents.length,...originals.documents);rows.crm_commission_document_sales.splice(0,rows.crm_commission_document_sales.length,...originals.documentSales);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);rows.crm_user_contract_profiles.splice(0,rows.crm_user_contract_profiles.length,...originals.profiles);});
  const saleIds=['10000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000062'];
  rows.crm_sales.push(
    {id:saleIds[0],broker_id:userIdBrokerA,sdr_id:null,development_id:'E001',unit_value:100000,process_number:'PROC-61',buyer_name:'Cliente Um',unit:'101',sold_at:'2026-11-10',sale_status:'Contabilizado',repass_status:'FASE DO REGISTRO',is_sdr_sale:false,deleted_at:null},
    {id:saleIds[1],broker_id:userIdBrokerA,sdr_id:null,development_id:'E001',unit_value:200000,process_number:'PROC-62',buyer_name:'Cliente Dois',unit:'202',sold_at:'2026-11-11',sale_status:'Contabilizado',repass_status:'FASE DO REGISTRO',is_sdr_sale:false,deleted_at:null}
  );
  rows.crm_user_contract_profiles.push({user_id:userIdManager,cpf:'333.333.333-33',cnpj:'12.345.678/0001-90',creci:'CRECI-GER-1',address:'Avenida da Gestão, 20'});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const result=await invoke('apiCreateCommissionReceipt',[manager.token,{saleIds,brokerId:userIdBrokerA,managerId:userIdManager,withholdingRatePct:0,paymentDate:'2026-12-05',notes:'Consolidado'}],manager.token);
  assert.equal(result.body.ok,true,JSON.stringify(result.body));
  assert.equal(result.body.documents.length,1,'duas vendas do mesmo beneficiário viram um recibo');
  assert.equal(result.body.documents[0].commissionBase,300000);
  assert.equal(result.body.documents[0].grossCommission,7500);
  assert.deepEqual(new Set(result.body.documents[0].sales.map((item)=>item.id)),new Set(saleIds));
  assert.equal(rows.crm_commission_document_sales.length,2);
  assert.ok(rows.crm_commission_document_sales.every((item)=>item.recipient_id===userIdBrokerA));
  const pdf=manager.calls.find((call)=>call.path.includes('/object/crm-finance-documents/generated/'));
  assert.ok(pdf,'o consolidado deve gerar um único PDF');
  const pdfText=pdf.body.replace(/\\([()\\])/g,'$1');
  assert.match(pdfText,/Cliente Um/);
  assert.match(pdfText,/Cliente Dois/);
  const duplicate=await invoke('apiCreateCommissionReceipt',[manager.token,{saleIds,brokerId:userIdBrokerA,managerId:userIdManager,withholdingRatePct:0,paymentDate:'2026-12-05'}],manager.token);
  assert.equal(duplicate.body.ok,false,'não permite duplicar recibos ativos das mesmas vendas para o mesmo beneficiário');
});

test('falha ao gerar link de upload não grava caminho inválido no histórico financeiro', async (t) => {
  const originals={documents:structuredClone(rows.crm_commission_documents),audit:structuredClone(rows.crm_audit)};
  t.after(()=>{rows.crm_commission_documents.splice(0,rows.crm_commission_documents.length,...originals.documents);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test',financeUploadSignUnavailable:true});
  const created=await invoke('apiCreateCommissionDocument',[manager.token,{type:'invoice',brokerId:userIdBrokerA,notes:'Prévia para teste de falha'}],manager.token);
  assert.equal(created.body.ok,true,JSON.stringify(created.body));
  const response=await invoke('apiPrepareCommissionDocumentUpload',[manager.token,created.body.documentId,{name:'nota.pdf',mimeType:'application/pdf',sizeBytes:1024}],manager.token);
  assert.equal(response.response.status,502);
  assert.equal(rows.crm_commission_documents.find((item)=>item.id===created.body.documentId).storage_path,undefined);
});

test('agenda de atendimentos mostra dados completos ao dono e apenas ocupado para colegas', async (t) => {
  const originals={appointments:structuredClone(rows.crm_appointments),locations:structuredClone(rows.crm_manager_locations)};
  t.after(()=>{rows.crm_appointments.splice(0,rows.crm_appointments.length,...originals.appointments);rows.crm_manager_locations.splice(0,rows.crm_manager_locations.length,...originals.locations);});
  const date=operationToday();
  rows.crm_appointments.push(
    {id:'10000000-0000-4000-8000-000000000101',broker_id:userIdBrokerA,development_id:'E001',client_name:'Cliente privado A',stand:'Stand Norte',starts_at:`${date}T10:00:00-03:00`,ends_at:`${date}T11:00:00-03:00`,status:'Agendado',notes:'Observação privada A',deleted_at:null},
    {id:'10000000-0000-4000-8000-000000000102',broker_id:userIdBrokerB,development_id:'E001',client_name:'Cliente privado B',stand:'Stand Sul',starts_at:`${date}T12:00:00-03:00`,ends_at:`${date}T13:00:00-03:00`,status:'Agendado',notes:'Observação privada B',deleted_at:null},
    {id:'10000000-0000-4000-8000-000000000103',broker_id:userIdBrokerB,development_id:'E001',client_name:'Cancelado de colega',stand:'',starts_at:`${date}T14:00:00-03:00`,ends_at:`${date}T15:00:00-03:00`,status:'Cancelado',notes:'',deleted_at:null}
  );
  rows.crm_manager_locations.push({id:'10000000-0000-4000-8000-000000000104',manager_id:userIdManager,location:'Unidade Centro',starts_at:`${date}T09:00:00-03:00`,ends_at:`${date}T10:00:00-03:00`,notes:'Observação interna',deleted_at:null});
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const ownView=await invoke('apiListAppointments',[broker.token,{dateFrom:date,dateTo:date}],broker.token);
  assert.equal(ownView.response.status,200,JSON.stringify(ownView.body));
  const own=ownView.body.appointments.find((item)=>item.clientName==='Cliente privado A');
  const coworker=ownView.body.appointments.find((item)=>item.occupied);
  assert.equal(own.notes,'Observação privada A');
  assert.equal(coworker.clientName,'Ocupado');
  assert.deepEqual(Object.keys(coworker).sort(),['clientName','endsAt','id','occupied','startsAt']);
  assert.equal(JSON.stringify(ownView.body).includes('Cliente privado B'),false);
  assert.equal(JSON.stringify(ownView.body).includes('Observação privada B'),false);
  assert.equal(JSON.stringify(ownView.body).includes('Observação interna'),false);
  assert.equal(ownView.body.appointments.some((item)=>item.id==='10000000-0000-4000-8000-000000000103'),false,'cancelamento de colega não aparece para o corretor');
  const management=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const managerView=await invoke('apiListAppointments',[management.token,{dateFrom:date,dateTo:date}],management.token);
  assert.equal(managerView.body.appointments.find((item)=>item.clientName==='Cliente privado B').notes,'Observação privada B');
  assert.equal(managerView.body.managerLocations[0].notes,'Observação interna');
  const managerLocationsForBroker=await invoke('apiListManagerLocations',[broker.token,{dateFrom:date,dateTo:date}],broker.token);
  assert.equal(managerLocationsForBroker.body[0].notes,'');
  const sdr=mockEnvironmentAndFetch(t,{role:'SDR',userId:userIdSdr,email:'sdr@example.test'});
  assert.equal((await invoke('apiListAppointments',[sdr.token,{dateFrom:date,dateTo:date}],sdr.token)).response.status,403);
});

test('agenda cria, vincula, atualiza e cancela com controle de carteira e bloqueio de conflito', async (t) => {
  const originals={appointments:structuredClone(rows.crm_appointments),leads:structuredClone(rows.crm_leads),audit:structuredClone(rows.crm_audit)};
  t.after(()=>{rows.crm_appointments.splice(0,rows.crm_appointments.length,...originals.appointments);rows.crm_leads.splice(0,rows.crm_leads.length,...originals.leads);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const date=operationToday();
  const linkedLeadId='10000000-0000-4000-8000-000000000140';
  rows.crm_leads.push({id:linkedLeadId,name:'Lead UUID de teste',phone:'11999990140',development_id:'E001',notes:'',sdr_feedback:'',status:'Em contato',broker_id:userIdBrokerA,created_at:`${date}T10:00:00Z`,created_by:userIdBrokerA,updated_at:`${date}T10:00:00Z`,updated_by:userIdBrokerA,deleted_at:null});
  rows.crm_appointments.push({id:'10000000-0000-4000-8000-000000000111',broker_id:userIdBrokerA,development_id:null,client_name:'Reserva existente',stand:'Stand Centro',starts_at:`${date}T10:00:00-03:00`,ends_at:`${date}T11:00:00-03:00`,status:'Agendado',notes:'',deleted_at:null});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const conflict=await invoke('apiSaveAppointment',[manager.token,{clientName:'Conflito de horário',brokerId:userIdBrokerA,stand:'Stand Centro',startsAt:`${date}T10:30:00-03:00`,endsAt:`${date}T11:30:00-03:00`,status:'Agendado'}],manager.token);
  assert.equal(conflict.body.ok,false);
  assert.match(conflict.body.message,/horário está ocupado/i);
  const created=await invoke('apiSaveAppointment',[manager.token,{clientName:'Cliente vinculado',leadId:linkedLeadId,brokerId:userIdBrokerA,stand:'Stand Centro',startsAt:`${date}T12:00:00-03:00`,endsAt:`${date}T13:00:00-03:00`,status:'Agendado',notes:'Visita confirmada'}],manager.token);
  assert.equal(created.body.ok,true,JSON.stringify(created.body));
  assert.match(created.body.message,/produção continuam sendo lançados manualmente/i);
  const saved=rows.crm_appointments.find((item)=>item.id===created.body.appointmentId);
  assert.equal(saved.lead_id,linkedLeadId);
  assert.equal(rows.crm_leads.find((item)=>item.id===linkedLeadId).status,'Atendimento agendado');
  assert.ok(rows.crm_audit.some((item)=>item.action==='appointment.create'&&item.entity_id===saved.id));
  const brokerB=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerB,email:'b@example.test'});
  assert.equal((await invoke('apiSaveAppointment',[brokerB.token,{id:saved.id,clientName:'Tentativa cruzada',brokerId:userIdBrokerA,startsAt:saved.starts_at,endsAt:saved.ends_at,status:'Agendado'}],brokerB.token)).response.status,403);
  const updated=await invoke('apiSaveAppointment',[manager.token,{id:saved.id,clientName:saved.client_name,leadId:saved.lead_id,developmentId:saved.development_id,brokerId:saved.broker_id,stand:saved.stand,startsAt:saved.starts_at,endsAt:saved.ends_at,status:'Realizado',notes:saved.notes}],manager.token);
  assert.equal(updated.body.ok,true,JSON.stringify(updated.body));
  assert.equal(rows.crm_leads.find((item)=>item.id===linkedLeadId).status,'Atendimento realizado');
  assert.ok(rows.crm_audit.some((item)=>item.action==='appointment.update'&&item.entity_id===saved.id));
  const cancelled=await invoke('apiArchiveAppointment',[manager.token,saved.id],manager.token);
  assert.equal(cancelled.body.ok,true,JSON.stringify(cancelled.body));
  assert.equal(saved.status,'Cancelado');
  const unexpected=await invoke('apiSaveAppointment',[manager.token,{clientName:'Campos extras',brokerId:userIdBrokerA,startsAt:`${date}T15:00:00-03:00`,endsAt:`${date}T16:00:00-03:00`,status:'Agendado',isAdmin:true}],manager.token);
  assert.equal(unexpected.body.ok,false);
});

test('notificações da agenda ficam no CRM e chegam só à gestão e ao corretor criador', async (t) => {
  const originals={notifications:structuredClone(rows.crm_in_app_notifications),appointments:structuredClone(rows.crm_appointments)};
  t.after(()=>{rows.crm_in_app_notifications.splice(0,rows.crm_in_app_notifications.length,...originals.notifications);rows.crm_appointments.splice(0,rows.crm_appointments.length,...originals.appointments);});
  const date=operationShiftDate(operationToday(),1);
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const created=await invoke('apiSaveAppointment',[broker.token,{clientName:'Atendimento para notificação',startsAt:`${date}T12:00:00-03:00`,endsAt:`${date}T13:00:00-03:00`,status:'Agendado'}],broker.token);
  assert.equal(created.body.ok,true,JSON.stringify(created.body));
  const notices=rows.crm_in_app_notifications.filter((item)=>item.appointment_id===created.body.appointmentId);
  assert.deepEqual(new Set(notices.map((item)=>item.recipient_id)),new Set([userIdBrokerA,userIdManager,userIdAssistant]));
  const own=await invoke('apiListNotifications',[broker.token],broker.token);
  const ownAppointmentNotices=own.body.items.filter((item)=>item.appointmentId===created.body.appointmentId);
  assert.equal(ownAppointmentNotices.length,1);assert.equal(Boolean(ownAppointmentNotices[0].readAt),false);
  const otherBroker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerB,email:'b@example.test'});
  assert.deepEqual((await invoke('apiListNotifications',[otherBroker.token],otherBroker.token)).body.items,[]);
  assert.equal((await invoke('apiMarkNotificationRead',[otherBroker.token,notices[0].id],otherBroker.token)).body.ok,false);
  assert.equal((await invoke('apiMarkNotificationRead',[broker.token,notices.find((item)=>item.recipient_id===userIdBrokerA).id],broker.token)).body.ok,true);
});

test('constraint do banco protege agendamentos simultâneos e devolve conflito amigável', async (t) => {
  const date=operationToday();
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test',appointmentConstraintConflict:true});
  const response=await invoke('apiSaveAppointment',[manager.token,{clientName:'Reserva concorrente',brokerId:userIdBrokerA,stand:'',startsAt:`${date}T16:00:00-03:00`,endsAt:`${date}T17:00:00-03:00`,status:'Agendado'}],manager.token);
  assert.equal(response.response.status,409);
  assert.match(response.body.message,/acabou de ser reservado/i);
});

test('localização do gerente é criada, removida com histórico e restrita a gerente/assistente', async (t) => {
  const originals={locations:structuredClone(rows.crm_manager_locations),audit:structuredClone(rows.crm_audit)};
  t.after(()=>{rows.crm_manager_locations.splice(0,rows.crm_manager_locations.length,...originals.locations);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const date=operationToday();
  const assistant=mockEnvironmentAndFetch(t,{role:'Assistente',userId:userIdAssistant,email:'assistente@example.test'});
  const saved=await invoke('apiSaveManagerLocation',[assistant.token,{location:'Stand Central',startsAt:`${date}T09:00:00-03:00`,endsAt:`${date}T11:00:00-03:00`,notes:'Reunião de equipe'}],assistant.token);
  assert.equal(saved.body.ok,true,JSON.stringify(saved.body));
  const location=rows.crm_manager_locations.find((item)=>item.location==='Stand Central');
  assert.equal(location.manager_id,userIdManager);
  const overlap=await invoke('apiSaveManagerLocation',[assistant.token,{location:'Outro compromisso',startsAt:`${date}T10:00:00-03:00`,endsAt:`${date}T12:00:00-03:00`,notes:''}],assistant.token);
  assert.equal(overlap.body.ok,false);
  assert.match(overlap.body.message,/período já está ocupado/i);
  assert.ok(rows.crm_audit.some((item)=>item.action==='manager_location.create'&&item.entity_id===location.id));
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  assert.equal((await invoke('apiSaveManagerLocation',[broker.token,{location:'Privado',startsAt:`${date}T12:00:00-03:00`,endsAt:`${date}T13:00:00-03:00`}],broker.token)).response.status,403);
  const archived=await invoke('apiArchiveManagerLocation',[assistant.token,location.id],assistant.token);
  assert.equal(archived.body.ok,true,JSON.stringify(archived.body));
  assert.ok(location.deleted_at);
  assert.ok(rows.crm_audit.some((item)=>item.action==='manager_location.archive'&&item.entity_id===location.id));
});

test('ouvidoria protege anonimato, restringe a gestão e exige resposta para concluir', async (t) => {
  const originals={complaints:structuredClone(rows.crm_complaints),audit:structuredClone(rows.crm_audit)};
  t.after(()=>{rows.crm_complaints.splice(0,rows.crm_complaints.length,...originals.complaints);rows.crm_audit.splice(0,rows.crm_audit.length,...originals.audit);});
  const brokerA=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const identified=await invoke('apiCreateComplaint',[brokerA.token,{category:'Sugestão',message:'Precisamos de um material de apoio para os plantões.',anonymous:false}],brokerA.token);
  const anonymous=await invoke('apiCreateComplaint',[brokerA.token,{category:'Reclamação',message:'O horário do plantão precisa ser reorganizado.',anonymous:true}],brokerA.token);
  assert.equal(identified.body.ok,true);assert.equal(anonymous.body.ok,true);
  const anonymousRow=rows.crm_complaints.find((item)=>item.anonymous);
  assert.equal(anonymousRow.author_id,null);
  assert.equal(rows.crm_audit.some((item)=>item.entity_id===anonymousRow.id&&item.action==='complaint.create'),false);
  assert.equal((await invoke('apiListComplaints',[brokerA.token],brokerA.token)).body.length,1);
  const brokerB=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerB,email:'b@example.test'});
  assert.equal((await invoke('apiListComplaints',[brokerB.token],brokerB.token)).body.length,0);
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const received=await invoke('apiListComplaints',[manager.token],manager.token);
  assert.equal(received.body.length,2);
  assert.equal(received.body.find((item)=>item.anonymous).authorName,'Manifestação anônima');
  assert.equal((await invoke('apiUpdateComplaint',[manager.token,anonymousRow.id,{status:'Respondida',managementResponse:''}],manager.token)).body.ok,false);
  const answered=await invoke('apiUpdateComplaint',[manager.token,anonymousRow.id,{status:'Respondida',managementResponse:'A gestão revisará o planejamento dos plantões.'}],manager.token);
  assert.equal(answered.body.ok,true);
  const brokerDenied=await invoke('apiUpdateComplaint',[brokerA.token,anonymousRow.id,{status:'Respondida',managementResponse:'Resposta indevida'}],brokerA.token);
  assert.equal(brokerDenied.response.status,403);
  assert.equal((await invoke('apiCreateComplaint',[brokerA.token,{category:'Sugestão',message:'Mensagem com campos extras válidos.',anonymous:false,managementResponse:'forjado'}],brokerA.token)).body.ok,false);
  assert.ok(rows.crm_audit.some((item)=>item.entity_id===anonymousRow.id&&item.action==='complaint.update'));
});

test('ranking operacional mantém a equipe completa para gestão e não expõe colegas ao corretor', async (t) => {
  const originals={entries:structuredClone(rows.crm_production_entries),attendance:structuredClone(rows.crm_attendance_records)};
  t.after(()=>{rows.crm_production_entries.splice(0,rows.crm_production_entries.length,...originals.entries);rows.crm_attendance_records.splice(0,rows.crm_attendance_records.length,...originals.attendance);});
  const date=operationToday();
  rows.crm_production_entries.push(
    {id:'10000000-0000-4000-8000-000000000121',broker_id:userIdBrokerA,work_date:date,prospecting_count:4,interaction_count:2,appointment_count:1,visit_count:1,sale_count:1,folder_count:1,created_at:`${date}T12:00:00Z`,updated_at:`${date}T12:00:00Z`},
    {id:'10000000-0000-4000-8000-000000000122',broker_id:userIdBrokerB,work_date:date,prospecting_count:8,interaction_count:3,appointment_count:2,visit_count:2,sale_count:0,folder_count:0,created_at:`${date}T12:00:00Z`,updated_at:`${date}T12:00:00Z`}
  );
  rows.crm_attendance_records.push({id:'10000000-0000-4000-8000-000000000123',broker_id:userIdBrokerB,attendance_date:date,shift:'morning',created_at:`${date}T12:00:00Z`,updated_at:`${date}T12:00:00Z`});
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  const privateView=await invoke('apiGetOperationsDashboard',[broker.token,{period:'week'}],broker.token);
  assert.equal(privateView.response.status,200,JSON.stringify(privateView.body));
  assert.deepEqual(privateView.body.byBroker.map((row)=>row.id),[userIdBrokerA]);
  assert.deepEqual(privateView.body.ranking.map((row)=>row.id),[userIdBrokerA]);
  assert.equal(Object.hasOwn(privateView.body.ranking[0],'weightedScore'),false);
  assert.equal(JSON.stringify(privateView.body).includes(userIdBrokerB),false);
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const filteredTeam=await invoke('apiGetOperationsDashboard',[manager.token,{period:'week',brokerId:userIdBrokerA}],manager.token);
  assert.deepEqual(filteredTeam.body.byBroker.map((row)=>row.id),[userIdBrokerA]);
  assert.deepEqual(new Set(filteredTeam.body.ranking.map((row)=>row.id)),new Set([userIdBrokerA,userIdBrokerB]));
  assert.equal(filteredTeam.body.ranking.length,2,'o filtro individual não deve recalcular o ranking da equipe');
});

test('agenda não alimenta a produção; agendamentos são lançados manualmente pelo corretor', async (t) => {
  const originals={entries:structuredClone(rows.crm_production_entries),appointments:structuredClone(rows.crm_appointments)};
  t.after(()=>{rows.crm_production_entries.splice(0,rows.crm_production_entries.length,...originals.entries);rows.crm_appointments.splice(0,rows.crm_appointments.length,...originals.appointments);});
  const date=operationToday();
  rows.crm_production_entries.push(
    {id:'10000000-0000-4000-8000-000000000141',broker_id:userIdBrokerA,work_date:date,prospecting_count:0,interaction_count:0,appointment_count:1,visit_count:0,sale_count:0,folder_count:0,created_at:`${date}T12:00:00Z`,updated_at:`${date}T12:00:00Z`},
    {id:'10000000-0000-4000-8000-000000000142',broker_id:userIdBrokerB,work_date:date,prospecting_count:0,interaction_count:0,appointment_count:4,visit_count:0,sale_count:0,folder_count:0,created_at:`${date}T12:00:00Z`,updated_at:`${date}T12:00:00Z`}
  );
  rows.crm_appointments.push(
    {id:'10000000-0000-4000-8000-000000000143',broker_id:userIdBrokerA,starts_at:`${date}T10:00:00-03:00`,ends_at:`${date}T11:00:00-03:00`,status:'Agendado',deleted_at:null},
    {id:'10000000-0000-4000-8000-000000000144',broker_id:userIdBrokerA,starts_at:`${date}T14:00:00-03:00`,ends_at:`${date}T15:00:00-03:00`,status:'Realizado',deleted_at:null},
    {id:'10000000-0000-4000-8000-000000000145',broker_id:userIdBrokerA,starts_at:`${date}T16:00:00-03:00`,ends_at:`${date}T17:00:00-03:00`,status:'Cancelado',deleted_at:null},
    {id:'10000000-0000-4000-8000-000000000146',broker_id:userIdBrokerB,starts_at:`${date}T10:00:00-03:00`,ends_at:`${date}T11:00:00-03:00`,status:'Agendado',deleted_at:null}
  );
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const report=await invoke('apiGetOperationsDashboard',[manager.token,{period:'week'}],manager.token);
  assert.equal(report.response.status,200,JSON.stringify(report.body));
  assert.equal(report.body.byBroker.find((row)=>row.id===userIdBrokerA).appointments,1,'a produção preserva somente o lançamento manual; agendamentos ativos ou cancelados da agenda não alteram o indicador');
  assert.equal(report.body.byBroker.find((row)=>row.id===userIdBrokerB).appointments,4,'a agenda não é somada aos lançamentos manuais');
  assert.equal(report.body.totals.appointments,5);
});

test('VGV e farol excluem cancelamentos, usam dias corridos e são restritos à gestão financeira', async (t) => {
  const originals={sales:structuredClone(rows.crm_sales),users:structuredClone(rows.crm_users)};
  t.after(()=>{rows.crm_sales.splice(0,rows.crm_sales.length,...originals.sales);rows.crm_users.splice(0,rows.crm_users.length,...originals.users);});
  const today=operationToday();const date=(daysAgo)=>operationShiftDate(today,-daysAgo);
  for(const id of [userIdBrokerA,userIdBrokerB])rows.crm_users.find((item)=>item.id===id).created_at=`${date(100)}T12:00:00Z`;
  rows.crm_sales.push(
    {id:'10000000-0000-4000-8000-000000000131',broker_id:userIdBrokerA,development_id:'E001',sold_at:date(1),unit_value:200000,sale_status:'Contabilizado',repass_status:'FASE DO REGISTRO',deleted_at:null},
    {id:'10000000-0000-4000-8000-000000000132',broker_id:userIdBrokerB,development_id:'E001',sold_at:date(65),unit_value:150000,sale_status:'Contabilizado',repass_status:'FASE DO REGISTRO',deleted_at:null},
    {id:'10000000-0000-4000-8000-000000000133',broker_id:userIdBrokerB,development_id:'E001',sold_at:date(1),unit_value:500000,sale_status:'Cancelada',repass_status:'DISTRATO FINALIZADO',deleted_at:null}
  );
  const manager=mockEnvironmentAndFetch(t,{role:'Assistente',userId:userIdAssistant,email:'assistente@example.test'});
  const report=await invoke('apiGetSalesHealthDashboard',[manager.token,{dateFrom:date(90),dateTo:today}],manager.token);
  assert.equal(report.response.status,200,JSON.stringify(report.body));
  assert.equal(report.body.totals.sales,2);
  assert.equal(report.body.totals.vgv,350000);
  assert.equal(report.body.byBroker.some((item)=>item.brokerId===userIdBrokerB&&item.vgv===500000),false);
  const brokerB=report.body.health.rows.find((item)=>item.id===userIdBrokerB);
  assert.equal(brokerB.lastSaleDate,date(65),'a venda cancelada não reinicia o farol');
  assert.equal(brokerB.daysWithoutSale,65);
  assert.equal(brokerB.band.id,'orange');
  assert.equal(report.body.health.alerts.some((item)=>item.brokerId===userIdBrokerB),true);
  assert.equal(typeof report.body.health.trendDirection,'string');
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  assert.equal((await invoke('apiGetSalesHealthDashboard',[broker.token,{}],broker.token)).response.status,403);
  const future=await invoke('apiGetSalesHealthDashboard',[manager.token,{dateFrom:today,dateTo:operationShiftDate(today,1)}],manager.token);
  assert.equal(future.response.status,400);
});

test('exclusão de contrato é reversível, administrativa e preserva documentos vinculados', async (t) => {
  const originalContracts=structuredClone(rows.crm_contracts);const originalDocs=structuredClone(rows.crm_contract_documents);const originalAudit=structuredClone(rows.crm_audit);
  t.after(()=>{rows.crm_contracts.splice(0,rows.crm_contracts.length,...originalContracts);rows.crm_contract_documents.splice(0,rows.crm_contract_documents.length,...originalDocs);rows.crm_audit.splice(0,rows.crm_audit.length,...originalAudit);});
  const id='10000000-0000-4000-8000-000000000052';const documentId='10000000-0000-4000-8000-000000000053';
  rows.crm_contracts.push({id,contract_number:'MA-CONTRATO-TESTE',status:'Rascunho',broker_id:userIdBrokerA,sdr_id:userIdSdr,created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z'});
  rows.crm_contract_documents.push({id:documentId,contract_id:id,document_type:'generated',document_kind:'agreement',original_name:'termo.doc',storage_path:'generated/test/termo.doc',created_at:'2026-11-01T00:00:00Z'});
  const manager=mockEnvironmentAndFetch(t,{role:'Gerente',userId:userIdManager,email:'gestao@example.test'});
  const broker=mockEnvironmentAndFetch(t,{role:'Corretor',userId:userIdBrokerA,email:'a@example.test'});
  assert.equal((await invoke('apiArchiveContract',[broker.token,id],broker.token)).response.status,403);
  assert.equal((await invoke('apiArchiveContract',[manager.token,id],manager.token)).body.ok,true);
  assert.equal((await invoke('apiListContracts',[manager.token],manager.token)).body.some((item)=>item.id===id),false);
  const archived=await invoke('apiListContracts',[manager.token,{includeArchived:true}],manager.token);
  assert.equal(archived.body.some((item)=>item.id===id),true);
  assert.equal(rows.crm_contract_documents.find((item)=>item.id===documentId).storage_path,'generated/test/termo.doc');
  assert.equal((await invoke('apiRestoreContract',[manager.token,id],manager.token)).body.ok,true);
  assert.equal((await invoke('apiListContracts',[manager.token],manager.token)).body.some((item)=>item.id===id),true);
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

test('migração comercial aplica os novos status, pagamento integral e matriz de metas sem apagar dados', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261112210000_crm_client_sales_feedback_and_goal_batch.sql'),'utf8');
  const statusSql=fs.readFileSync(path.join(root,'supabase/migrations/20261118163736_crm_client_feedback_sales_documents.sql'),'utf8');
  const newCheck=statusSql.match(/add constraint crm_sales_repass_status_check check \(repass_status in \(([\s\S]*?)\)\);/i);
  assert.ok(newCheck,'constraint da fase deve existir');
  const checkValues=[...newCheck[1].matchAll(/'([^']+)'/g)].map((match)=>match[1]);
  assert.deepEqual(checkValues.slice(0,crmConfig.repassStatuses.length),crmConfig.repassStatuses);
  assert.ok(checkValues.includes('AGUARDANDO PJ'),'status já usado deve continuar permitido para preservar históricos');
  assert.match(sql,/set default 'FASE DO REGISTRO'/i);
  assert.match(sql,/update public\.crm_sales set repass_status='COMISSÃO PAGA'/i);
  assert.match(sql,/previous_repass_status/);
  assert.match(sql,/status_set_by_receipt/);
  assert.match(sql,/revoke all on function public\.crm_add_sale_receipt_full/i);
  assert.match(sql,/grant execute on function public\.crm_add_sale_receipt_full\(uuid,uuid,date,text\) to service_role/i);
  assert.match(sql,/create or replace function public\.crm_save_operation_goals_batch/i);
  assert.match(sql,/jsonb_typeof\(p_goals\) is distinct from 'array'/i);
  assert.doesNotMatch(sql,/(^|\n)\s*(drop\s+table|truncate\s+|delete\s+from)\b/i);
});

test('migration do feedback reúne vendas, produção e documentos financeiros com privacidade e gravação atômica', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261118163736_crm_client_feedback_sales_documents.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/add column if not exists folder_count integer/i);
  assert.match(executableSql,/add column if not exists deleted_at timestamptz/i);
  assert.match(executableSql,/crm_commission_documents_one_active_receipt_per_sale_idx/i);
  assert.match(executableSql,/enable row level security[\s\S]*revoke all on public\.crm_commission_documents from anon, authenticated[\s\S]*grant all on public\.crm_commission_documents to service_role/i);
  assert.match(executableSql,/values \('crm-finance-documents', 'crm-finance-documents', false/i);
  assert.match(executableSql,/create or replace function public\.crm_import_operations/i);
  assert.match(executableSql,/on conflict \(broker_id,attendance_date,shift\) where deleted_at is null do nothing/i);
  assert.match(executableSql,/insert into public\.crm_audit[\s\S]*'operations'/i);
  assert.match(executableSql,/grant execute on function public\.crm_import_operations\(text,jsonb,uuid,text,text,text\) to service_role/i);
  assert.doesNotMatch(executableSql,/(^|\n)\s*(drop\s+table|truncate\s+|delete\s+from)\b/i);
});

test('migration de agenda e saúde comercial adiciona tabelas privadas e bloqueios contra horários sobrepostos', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261118163751_crm_appointments_feedback_sales_health.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/create table if not exists public\.crm_appointments/i);
  assert.match(executableSql,/create table if not exists public\.crm_manager_locations/i);
  assert.match(executableSql,/create table if not exists public\.crm_complaints/i);
  assert.match(executableSql,/crm_appointments_broker_slot_excl[\s\S]*exclude using gist[\s\S]*broker_id with =[\s\S]*tstzrange\(starts_at, ends_at, '\[\)'\) with &&/i);
  assert.match(executableSql,/crm_appointments_stand_slot_excl[\s\S]*development_id with =[\s\S]*stand with =/i);
  assert.match(executableSql,/crm_manager_locations_time_excl[\s\S]*manager_id with =[\s\S]*tstzrange\(starts_at, ends_at, '\[\)'\) with &&/i);
  assert.match(executableSql,/enable row level security[\s\S]*revoke all on public\.crm_appointments, public\.crm_manager_locations, public\.crm_complaints from anon, authenticated[\s\S]*grant all on public\.crm_appointments, public\.crm_manager_locations, public\.crm_complaints to service_role/i);
  assert.doesNotMatch(executableSql,/(^|\n)\s*(drop\s+table|truncate\s+|delete\s+from)\b/i);
});

test('migration de notificações agenda signatários e lembretes apenas internos ao CRM', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261118163819_crm_notifications_receipt_signatures.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/create table if not exists public\.crm_in_app_notifications/i);
  assert.match(executableSql,/u\.role in \('Gerente','Assistente'\)/i);
  assert.match(executableSql,/creator\.id = upcoming\.created_by[\s\S]*creator\.role = 'Corretor'/i);
  assert.match(executableSql,/d\.signed_uploaded_at is null/i);
  assert.match(executableSql,/mundo-apto-appointment-reminders', '\*\/5 \* \* \* \*'/i);
  assert.match(executableSql,/mundo-apto-receipt-signature-reminders', '0 9 \* \* \*'/i);
  assert.match(executableSql,/enable row level security[\s\S]*revoke all on public\.crm_in_app_notifications from public, anon, authenticated/i);
  assert.doesNotMatch(executableSql,/net\.http_post|send_email|whatsapp/i,'Os lembretes ficam apenas no CRM.');
});

test('migration separa recibos por beneficiário, preserva legados e apaga metas sem trilha de exclusão', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261119205858_crm_commission_receipts_by_recipient_and_goal_delete.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/add column if not exists recipient_id uuid/i);
  assert.match(executableSql,/set recipient_id = broker_id,[\s\S]*recipient_role = 'Corretor'[\s\S]*where recipient_id is null or recipient_role is null/i);
  assert.match(executableSql,/drop index if exists public\.crm_commission_documents_one_active_receipt_per_sale_idx/i);
  assert.match(executableSql,/create unique index if not exists crm_commission_documents_one_active_receipt_per_sale_recipient_idx[\s\S]*on public\.crm_commission_documents \(sale_id, recipient_id\)/i);
  const deleteGoal=executableSql.split('create or replace function public.crm_delete_operation_goal')[1].split('$$;')[1]||'';
  assert.match(executableSql,/create or replace function public\.crm_delete_operation_goal/i);
  assert.match(executableSql,/delete from public\.crm_production_goals/i);
  assert.doesNotMatch(deleteGoal,/crm_audit/i,'a solicitação pediu para excluir metas sem salvar histórico de exclusão');
  assert.match(executableSql,/d\.recipient_id,[\s\S]*d\.signature_status = 'pending'/i,'lembretes de recibo vão ao beneficiário do recibo individual');
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

test('migração centraliza dados contratuais sem expô-los nem apagar os snapshots anteriores', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261113174030_crm_user_contract_profiles_20261113142000.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/create table if not exists public\.crm_user_contract_profiles/i);
  assert.match(executableSql,/references public\.crm_users\(id\) on delete restrict/i);
  assert.match(executableSql,/enable row level security/i);
  assert.match(executableSql,/revoke all on public\.crm_user_contract_profiles from public, anon, authenticated/i);
  assert.match(executableSql,/grant all on public\.crm_user_contract_profiles to service_role/i);
  assert.match(executableSql,/add column if not exists broker_cpf/i);
  assert.match(executableSql,/add column if not exists sdr_address/i);
  assert.match(executableSql,/insert into public\.crm_user_contract_profiles[\s\S]*from public\.crm_broker_profiles/i);
  assert.match(executableSql,/update public\.crm_contracts[\s\S]*where sdr_profile\.user_id = contract\.sdr_id/i);
  assert.doesNotMatch(executableSql,/(^|\n)\s*(drop\s+table|truncate\s+|delete\s+from)\b/i);
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

test('migration de origem SDR só acrescenta campo nullable e preserva vendas antigas sem classificação inventada', () => {
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261113182548_crm_sales_sdr_origin.sql'),'utf8');
  const executableSql=sql.replace(/--[^\n]*/g,'');
  assert.match(executableSql,/alter table public\.crm_sales\s+add column if not exists is_sdr_sale boolean/i);
  assert.doesNotMatch(executableSql,/default\s+(true|false)/i);
  assert.doesNotMatch(executableSql,/(^|\n)\s*(update|delete from|drop table|truncate)\b/i);
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
  const client = fs.readFileSync(path.join(root, 'public/client.js'), 'utf8');
  const netlify = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.doesNotMatch(html, /google\.script|<\?!=|<\?=|__MUNDO_APTO_LOGO_DATA_URI__/);
  assert.match(html, /<script src="\/client\.js" defer><\/script>/);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(client, /<\/?script\b/i);
  assert.doesNotThrow(() => new vm.Script(client, { filename: 'public/client.js' }));
  const csp = netlify.split('\n').find((line) => line.includes('Content-Security-Policy')) || '';
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js\@2\.119\.0\/dist\/umd\/supabase\.js/);
  assert.match(csp, /wss:\/\/ecxkijhflxudevtlppai\.supabase\.co/);
  const application = html + client;
  assert.match(application, /Ativar acesso administrador/);
  assert.match(application, /Exportar documentos CSV/);
  assert.match(application, /Valor da unidade \(R\$\)/);
  assert.match(application, /Percentual da comissão total/);
  assert.match(application, /Nº da proposta \/ pasta/);
  assert.match(html, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(html, /SUPABASE_SECRET_KEY|CRM_BOOTSTRAP_SECRET|DEFAULT_TEMP_PASSWORD_SENTINEL/);
  assert.doesNotMatch(client, /SUPABASE_SECRET_KEY|CRM_BOOTSTRAP_SECRET|DEFAULT_TEMP_PASSWORD_SENTINEL/);
});
