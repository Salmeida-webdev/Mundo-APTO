import { createRequire } from 'node:module';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const require = createRequire(import.meta.url);
const CrmDomain = require('../../apps-script/Domain.gs');
const CRM_CONFIG = require('../../config/seed-data.json');
const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_METHODS = new Set([
  'apiBootstrapInfo', 'apiBootstrapAdmin', 'apiLogin', 'apiRefresh', 'apiLogout',
  'apiChangePassword', 'apiGetReferenceData', 'apiGetDashboard', 'apiListLeads',
  'apiGetSdrHistory', 'apiSaveLead', 'apiListUsers', 'apiSaveUser',
  'apiGetSdrWorklist', 'apiListLeadAttempts', 'apiAddLeadAttempt', 'apiFlagPhoneIncorrect',
  'apiListAudit', 'apiListSales', 'apiSaveSale', 'apiArchiveSale', 'apiRestoreSale', 'apiAddSaleReceipt', 'apiVoidSaleReceipt', 'apiListBrokerProfiles', 'apiSaveBrokerProfile',
  'apiListContracts', 'apiListContractLeads', 'apiSaveContract', 'apiGenerateContract', 'apiGetContractTemplate', 'apiSaveContractTemplate',
  'apiCreateContractUpload', 'apiConfirmContractSigned', 'apiGetContractDocument',
  'apiArchiveContract', 'apiRestoreContract',
  'apiListCommissionDocuments', 'apiCreateCommissionReceipt', 'apiCreateCommissionDocument',
  'apiPrepareCommissionDocumentUpload', 'apiConfirmCommissionDocumentUpload', 'apiConfirmCommissionReceiptUpload', 'apiConfirmCommissionReceiptSigned',
  'apiUpdateCommissionPayment', 'apiArchiveCommissionDocument', 'apiRestoreCommissionDocument', 'apiGetCommissionDocument',
  'apiListArchivedLeads', 'apiArchiveLead', 'apiRestoreLead',
  'apiListArchivedUsers', 'apiArchiveUser', 'apiRestoreUser',
  'apiResetUserPassword', 'apiApplySharedTemporaryPassword', 'apiListDevelopments',
  'apiSaveDevelopment', 'apiPreviewLeadImport', 'apiImportLeads', 'apiExportLeads', 'apiExportReport', 'apiSaveFollowupDays',
  'apiGetOperationsDashboard', 'apiListOperationBrokers', 'apiListProduction', 'apiSaveProduction', 'apiArchiveProduction',
  'apiListOperationGoals', 'apiSaveOperationGoal', 'apiSaveOperationGoalsBatch', 'apiDeleteOperationGoal', 'apiListAttendance', 'apiSetAttendance',
  'apiExportOperationsReport', 'apiPreviewOperationsImport', 'apiImportOperations',
  'apiListAppointments', 'apiSaveAppointment', 'apiArchiveAppointment', 'apiListManagerLocations', 'apiSaveManagerLocation', 'apiArchiveManagerLocation',
  'apiListNotifications', 'apiMarkNotificationRead',
  'apiListComplaints', 'apiCreateComplaint', 'apiUpdateComplaint', 'apiGetSalesHealthDashboard'
]);
const MUTATING_METHODS = new Set([
  'apiChangePassword', 'apiSaveFollowupDays', 'apiSaveLead', 'apiArchiveLead', 'apiRestoreLead',
  'apiAddLeadAttempt', 'apiFlagPhoneIncorrect', 'apiSaveSale', 'apiAddSaleReceipt', 'apiVoidSaleReceipt',
  'apiSaveBrokerProfile', 'apiSaveContract', 'apiGenerateContract', 'apiCreateContractUpload',
  'apiConfirmContractSigned', 'apiSaveContractTemplate', 'apiSaveDevelopment', 'apiImportLeads',
  'apiArchiveContract', 'apiRestoreContract', 'apiCreateCommissionReceipt', 'apiCreateCommissionDocument',
  'apiPrepareCommissionDocumentUpload', 'apiConfirmCommissionDocumentUpload', 'apiConfirmCommissionReceiptUpload', 'apiConfirmCommissionReceiptSigned',
  'apiUpdateCommissionPayment', 'apiArchiveCommissionDocument', 'apiRestoreCommissionDocument',
  'apiSaveUser', 'apiArchiveUser', 'apiRestoreUser', 'apiResetUserPassword', 'apiApplySharedTemporaryPassword',
  'apiSaveProduction', 'apiArchiveProduction', 'apiSaveOperationGoal', 'apiSaveOperationGoalsBatch', 'apiDeleteOperationGoal', 'apiSetAttendance', 'apiArchiveSale', 'apiRestoreSale', 'apiImportOperations',
  'apiSaveAppointment', 'apiArchiveAppointment', 'apiSaveManagerLocation', 'apiArchiveManagerLocation', 'apiCreateComplaint', 'apiUpdateComplaint',
  'apiMarkNotificationRead'
]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function env() {
  const config = {
    url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
    secretKey: process.env.SUPABASE_SECRET_KEY || '',
    bootstrapSecret: process.env.CRM_BOOTSTRAP_SECRET || ''
  };
  if (!config.url || !config.publishableKey || !config.secretKey) {
    throw new HttpError(503, 'O CRM ainda não está conectado ao banco de dados.');
  }
  return config;
}

let operationsSecurityPolicy = { managerIds: new Set(), sharedPasswordOperatorId: '' };

async function loadOperationsSecurityPolicy() {
  let value = {};
  try {
    const rows = await dbRequest('crm_settings', { query: { select: 'value', key: 'eq.operations_access_policy', limit: 1 } });
    value = Array.isArray(rows) && rows[0] && rows[0].value && typeof rows[0].value === 'object' ? rows[0].value : {};
  } catch (_) {
    // Keep CRM authentication available, but fail closed for the separately
    // controlled operations-manager and shared-password privileges.
  }
  const ids = Array.isArray(value.operations_manager_ids) ? value.operations_manager_ids : [];
  operationsSecurityPolicy = {
    managerIds: new Set(ids.map((id) => String(id).trim().toLowerCase()).filter(isUuid)),
    sharedPasswordOperatorId: isUuid(value.shared_password_operator_id) ? String(value.shared_password_operator_id).toLowerCase() : ''
  };
  return operationsSecurityPolicy;
}

function isConfiguredOperationsManager(user) {
  return Boolean(user && user.active !== false && isUuid(user.id)
    && operationsSecurityPolicy.managerIds.has(String(user.id).toLowerCase())
    && ['Administrador','Gerente','Coordenador','Assistente'].includes(String(user.role || '')));
}

function isSharedTemporaryPasswordOperator(user) {
  const configuredId = operationsSecurityPolicy.sharedPasswordOperatorId;
  return Boolean(user && user.active !== false && isUuid(configuredId) && String(user.id).toLowerCase() === configuredId && isAdmin(user));
}

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function safeMessage(response, fallback) {
  return response && response.status >= 500 ? fallback : fallback;
}
function cleanErrorMessage(value) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').slice(0, 220);
}

async function readJson(response, fallback) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new HttpError(response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : response.status === 429 ? 429 : response.status >= 500 ? 502 : 400, fallback || cleanErrorMessage(body && (body.msg || body.message || body.error_description || body.error)) || 'Não foi possível concluir a operação.');
  return body;
}

async function authRequest(path, { method = 'GET', body, token, admin = false } = {}) {
  const cfg = env();
  const key = admin ? cfg.secretKey : cfg.publishableKey;
  const headers = { apikey: key, Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${cfg.url}/auth/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  return readJson(response, response.status === 401 ? 'E-mail ou senha inválidos.' : 'Não foi possível validar a conta de acesso.');
}

async function dbRequest(table, { method = 'GET', query = {}, body, prefer, range, returnCount = false } = {}) {
  const cfg = env();
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => params.set(key, String(value)));
  const url = `${cfg.url}/rest/v1/${table}${params.size ? `?${params}` : ''}`;
  const headers = { apikey: cfg.secretKey, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer || returnCount) headers.Prefer = [prefer, returnCount ? 'count=exact' : ''].filter(Boolean).join(',');
  if (range) { headers.Range = range; headers['Range-Unit'] = 'items'; }
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    let databaseCode = '';
    try { databaseCode = JSON.parse(responseText).code || ''; } catch (_) {}
    if (databaseCode === '23P01') throw new HttpError(409, table === 'crm_manager_locations' ? 'Esse período acabou de ser reservado na agenda do gerente. Atualize e escolha outro horário.' : 'Esse horário acabou de ser reservado para o corretor ou stand. Atualize a agenda e escolha outro horário.');
    if (response.status === 409) throw new HttpError(409, 'O registro foi alterado por outra operação. Atualize a tela e tente novamente.');
    throw new HttpError(response.status === 404 ? 404 : response.status >= 500 ? 502 : 400, 'Não foi possível acessar os dados do CRM.');
  }
  if (response.status === 204) return returnCount ? { data: null, total: 0 } : null;
  const data = await response.json().catch(() => null);
  if (!returnCount) return data;
  const totalPart = (response.headers.get('content-range') || '').split('/').pop();
  const total = totalPart && totalPart !== '*' ? Number(totalPart) : Array.isArray(data) ? data.length : 0;
  return { data, total: Number.isFinite(total) ? total : 0 };
}

async function emitSyncSignal() {
  // Polling remains as a fallback if Realtime is disconnected or temporarily unavailable.
  try {
    await dbRequest('crm_sync_signal', {
      method: 'PATCH', query: { id: 'eq.1' }, prefer: 'return=minimal', body: { changed_at: now() }
    });
  } catch (_) {}
}

async function storageRequest(path, { method = 'GET', body, contentType, headers: extraHeaders = {} } = {}) {
  const cfg = env();
  const headers = { apikey: cfg.secretKey, ...extraHeaders };
  // Legacy service-role keys are JWTs; new Supabase secret keys are opaque and
  // must be sent only as apikey, not as an Authorization Bearer token.
  if (cfg.secretKey.startsWith('eyJ') && !extraHeaders.Authorization) {
    headers.Authorization = `Bearer ${cfg.secretKey}`;
  }
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(`${cfg.url}/storage/v1/${path}`, { method, headers, body, cache: 'no-store' });
  if (!response.ok) {
    await response.text().catch(() => '');
    throw new HttpError(response.status >= 500 ? 502 : 400, 'Não foi possível processar o documento no armazenamento privado.');
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function storageObjectPath(path) {
  return String(path || '').split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function signedContractDownload(path, downloadName) {
  const result = await storageRequest(`object/sign/crm-contracts/${storageObjectPath(path)}`, {
    method: 'POST', contentType: 'application/json', body: JSON.stringify({ expiresIn: 90 })
  });
  const signed = result && (result.signedURL || result.signedUrl);
  if (!signed) throw new HttpError(502, 'Não foi possível gerar o link temporário do documento.');
  const cfg = env();
  const url = new URL(/^https?:\/\//i.test(signed) ? signed : `${cfg.url}/storage/v1${signed}`);
  url.searchParams.set('download', downloadName || '');
  return url.toString();
}

async function signedFinanceDownload(path, downloadName) {
  const result = await storageRequest(`object/sign/crm-finance-documents/${storageObjectPath(path)}`, {
    method: 'POST', contentType: 'application/json', body: JSON.stringify({ expiresIn: 90 })
  });
  const signed = result && (result.signedURL || result.signedUrl);
  if (!signed) throw new HttpError(502, 'Não foi possível gerar o link temporário do documento financeiro.');
  const cfg = env();
  const url = new URL(/^https?:\/\//i.test(signed) ? signed : `${cfg.url}/storage/v1${signed}`);
  url.searchParams.set('download', downloadName || '');
  return url.toString();
}

async function listAll(table, query = {}) {
  const result = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const rows = await dbRequest(table, { query: { ...query, limit: pageSize, offset }, range: `${offset}-${offset + pageSize - 1}` });
    if (!Array.isArray(rows)) throw new HttpError(502, 'Resposta inválida recebida do banco de dados.');
    result.push(...rows);
    if (rows.length < pageSize) break;
  }
  return result;
}

function mapUser(row) {
  if (!row) return null;
  const defaultOperationsAccess = row.role === 'Corretor' ? 'broker' : row.role === 'SDR' ? 'sdr' : CrmDomain.isAdmin({ role: row.role, active: row.active }) ? 'viewer' : 'none';
  const requestedAccess = row.operations_access || defaultOperationsAccess;
  const configuredManager = isConfiguredOperationsManager(row);
  const operationsAccess = configuredManager ? 'manager' : requestedAccess === 'manager'
    ? (CrmDomain.isAdmin({ role: row.role, active: row.active }) ? 'viewer' : defaultOperationsAccess)
    : requestedAccess;
  return { id: row.id, name: row.name, email: row.email, role: row.role, operationsAccess, active: row.active === true, mustChangePassword: row.must_change_password === true, sessionVersion: Number(row.session_version || 0), createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at || '', deletedBy: row.deleted_by || '', deletedPreviousActive: row.deleted_previous_active === true };
}
function publicUser(row) {
  const user = mapUser(row);
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, operationsAccess: user.operationsAccess, active: user.active, mustChangePassword: user.mustChangePassword, canManageOperations: isConfiguredOperationsManager(user), canApplySharedTemporaryPassword: isSharedTemporaryPasswordOperator(user) };
}
function normalizeTeamContractProfile(payload = {}) {
  return {
    cpf: String(payload.contractCpf || '').trim().slice(0, 30),
    cnpj: String(payload.contractCnpj || '').trim().slice(0, 30),
    creci: String(payload.contractCreci || '').trim().slice(0, 60),
    address: String(payload.contractAddress || '').trim().slice(0, 500)
  };
}
function teamContractProfileForUser(userId, profiles = []) {
  const profile = profiles.find((item) => String(item.user_id) === String(userId)) || {};
  return { contractCpf: profile.cpf || '', contractCnpj: profile.cnpj || '', contractCreci: profile.creci || '', contractAddress: profile.address || '' };
}
function redactedTeamContractProfile(profile = {}) {
  return Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, value ? '[preenchido]' : '']));
}
async function saveTeamContractProfile(actor, userId, profile) {
  const currentRows = await dbRequest('crm_user_contract_profiles', { query: { select: '*', user_id: `eq.${userId}`, limit: 1 } });
  const current = Array.isArray(currentRows) ? currentRows[0] || null : null;
  const before = current ? { cpf: current.cpf || '', cnpj: current.cnpj || '', creci: current.creci || '', address: current.address || '' } : { cpf: '', cnpj: '', creci: '', address: '' };
  const changedFields = auditChangedFields(before, profile);
  if (!changedFields.length) return { profile: current, changedFields: [] };
  if (!current && !Object.values(profile).some(Boolean)) return { profile: null, changedFields: [] };
  const values = { ...profile, updated_at: now(), updated_by: actor.id };
  const savedRows = current
    ? await dbRequest('crm_user_contract_profiles', { method: 'PATCH', query: { user_id: `eq.${userId}` }, prefer: 'return=representation', body: values })
    : await dbRequest('crm_user_contract_profiles', { method: 'POST', prefer: 'return=representation', body: { user_id: userId, ...values } });
  const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;
  if (!saved) throw new HttpError(502, 'O usuário foi salvo, mas os dados para documentos não foram confirmados. Abra o cadastro novamente e tente salvar os dados contratuais.');
  await audit(actor, current ? 'user.contract_profile.update' : 'user.contract_profile.create', 'user_contract_profile', userId, changedFields,
    redactedTeamContractProfile(before), redactedTeamContractProfile(profile));
  return { profile: saved, changedFields };
}
function mapLead(row, users, developments) {
  const broker = users.find((item) => String(item.id) === String(row.broker_id));
  const development = developments.find((item) => String(item.id) === String(row.development_id));
  return {
    id: row.id, name: row.name, phone: row.phone, developmentId: row.development_id,
    developmentName: development ? development.name : '', notes: row.notes || '', sdrFeedback: row.sdr_feedback || '',
    status: row.status, brokerId: row.broker_id, brokerName: broker ? broker.name : 'Corretor inativo',
    createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at,
    updatedBy: row.updated_by, sdrUpdatedAt: row.sdr_updated_at || '', sdrUpdatedBy: row.sdr_updated_by || '',
    sdrStatusUpdatedAt: row.sdr_status_updated_at || '',
    deletedAt: row.deleted_at || '', deletedBy: row.deleted_by || '',
    phoneCorrectionRequired: row.phone_correction_required === true,
    phoneCorrectionRequestedAt: row.phone_correction_requested_at || '',
    phoneCorrectionRequestedBy: row.phone_correction_requested_by || '',
    phoneCorrectionNotes: row.phone_correction_notes || '',
    phoneCorrectedAt: row.phone_corrected_at || ''
  };
}
function leadToDb(values) {
  const out = {};
  const fields = { name: 'name', phone: 'phone', developmentId: 'development_id', notes: 'notes', sdrFeedback: 'sdr_feedback', status: 'status', brokerId: 'broker_id' };
  Object.keys(fields).forEach((key) => { if (Object.prototype.hasOwnProperty.call(values, key)) out[fields[key]] = values[key]; });
  return out;
}
function now() { return new Date().toISOString(); }
function isAdmin(user) { return CrmDomain.isAdmin(user); }
function requireAdmin(user) { if (!isAdmin(user)) throw new HttpError(403, 'Acesso restrito à gestão.'); }
function isFinanceManager(user) { return Boolean(user && ['Gerente','Assistente'].includes(user.role)); }
function requireFinanceManager(user) { if (!isFinanceManager(user)) throw new HttpError(403, 'Acesso financeiro restrito à gerente e à assistente.'); }
function newTemporaryPassword() { return `${randomBytes(20).toString('base64url')}aA9!`; }
function hashRefreshToken(token) { return createHash('sha256').update(String(token)).digest('hex'); }
function refreshExpiry() { return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); }
function decodeClaims(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); }
  catch (_) { throw new HttpError(401, 'Sessão inválida. Entre novamente.'); }
}

async function getProfile(userId) {
  const rows = await dbRequest('crm_users', { query: { select: '*', id: `eq.${userId}`, limit: 1 } });
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function verifyActor(token, allowPasswordChange = false) {
  if (!token || typeof token !== 'string') throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  const claims = decodeClaims(token);
  const authUser = await authRequest('user', { token });
  const [profile] = await Promise.all([
    getProfile(authUser && authUser.id),
    loadOperationsSecurityPolicy()
  ]);
  if (!profile || profile.active !== true || profile.deleted_at || normalizeEmail(profile.email) !== normalizeEmail(authUser.email)) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  const claimVersion = Number(claims.app_metadata && claims.app_metadata.crm_session_version || 0);
  if (claimVersion !== Number(profile.session_version || 0)) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  const actor = mapUser(profile);
  if (actor.mustChangePassword && !allowPasswordChange) throw new HttpError(403, 'Altere a senha temporária antes de continuar.');
  return actor;
}

async function audit(actor, action, entityType, entityId, changedFields, beforeValues = {}, afterValues = {}, module = 'crm') {
  await dbRequest('crm_audit', { method: 'POST', prefer: 'return=minimal', body: {
    user_id: actor.id, email: actor.email, actor_name: actor.name, actor_role: actor.role,
    action, entity_type: entityType, entity_id: String(entityId),
    changed_fields: Array.isArray(changedFields) ? changedFields.join(',') : String(changedFields || ''),
    module: module === 'operations' ? 'operations' : 'crm',
    before_values: beforeValues && typeof beforeValues === 'object' ? beforeValues : {},
    after_values: afterValues && typeof afterValues === 'object' ? afterValues : {}
  } });
}
function auditChangedFields(beforeValues, afterValues) {
  const before = beforeValues && typeof beforeValues === 'object' ? beforeValues : {};
  const after = afterValues && typeof afterValues === 'object' ? afterValues : {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
async function authSignOut(token) {
  if (!token) return;
  await authRequest('logout?scope=local', { method: 'POST', token }).catch(() => null);
}
async function authPasswordGrant(email, password) {
  return authRequest('token?grant_type=password', { method: 'POST', body: { email, password } });
}
async function signInResult(session, persist = true) {
  const authUser = session && session.user;
  const profile = authUser && await getProfile(authUser.id);
  if (!profile || profile.active !== true || profile.deleted_at || normalizeEmail(profile.email) !== normalizeEmail(authUser.email)) {
    await authSignOut(session && session.access_token);
    return { ok: false, message: 'E-mail ou senha inválidos.' };
  }
  const claims = decodeClaims(session.access_token);
  if (Number(claims.app_metadata && claims.app_metadata.crm_session_version || 0) !== Number(profile.session_version || 0)) {
    await authSignOut(session.access_token);
    return { ok: false, message: 'E-mail ou senha inválidos.' };
  }
  // `publicUser` exposes the operations permissions in the first login
  // response. Load the private allowlist before mapping that profile.
  await loadOperationsSecurityPolicy();
  if (persist && session.refresh_token) {
    await dbRequest('crm_sessions', { method: 'DELETE', query: { expires_at: `lt.${now()}` } }).catch(() => null);
    await dbRequest('crm_sessions', { method: 'POST', prefer: 'return=minimal', body: { user_id: profile.id, refresh_token_hash: hashRefreshToken(session.refresh_token), session_version: Number(profile.session_version || 0), expires_at: refreshExpiry() } });
  }
  return { ok: true, token: session.access_token, refreshToken: session.refresh_token, expiresIn: Number(session.expires_in || 3600), user: publicUser(profile) };
}
async function setAuthPassword(userId, password, sessionVersion) {
  const current = await authRequest(`admin/users/${encodeURIComponent(userId)}`, { admin: true });
  return authRequest(`admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT', admin: true,
    body: { password, app_metadata: { ...(current.app_metadata || {}), crm_session_version: Number(sessionVersion || 0) } }
  });
}

async function updateAuthProfile(userId, { email, name, sessionVersion }) {
  const current = await authRequest(`admin/users/${encodeURIComponent(userId)}`, { admin: true });
  return authRequest(`admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT', admin: true,
    body: {
      ...(email ? { email, email_confirm: true } : {}),
      app_metadata: { ...(current.app_metadata || {}), crm_session_version: Number(sessionVersion || 0) },
      user_metadata: { ...(current.user_metadata || {}), ...(name ? { name } : {}) }
    }
  });
}

async function apiBootstrapInfo() {
  const cfg = env();
  const rows = await dbRequest('crm_users', { query: { select: 'id', limit: 1 } });
  return { initialized: Array.isArray(rows) && rows.length > 0, setupAvailable: Boolean(cfg.bootstrapSecret && Array.isArray(rows) && rows.length === 0), systemName: CRM_CONFIG.systemName };
}

async function apiBootstrapAdmin(secret, name, email, password) {
  const cfg = env();
  const supplied = String(secret || '');
  const expected = String(cfg.bootstrapSecret || '');
  const secretOkay = supplied.length === expected.length && expected.length > 0 && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  const normalizedEmail = normalizeEmail(email);
  name = String(name || '').trim(); password = String(password || '');
  if (!secretOkay) throw new HttpError(403, 'Chave de configuração inválida.');
  if (!normalizedEmail || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new HttpError(400, 'Informe um e-mail válido para o administrador.');
  if (!name || name.length > 150 || password.length < 12 || password.length > 128) throw new HttpError(400, 'Informe o nome e uma senha de 12 a 128 caracteres.');
  const existingProfiles = await dbRequest('crm_users', { query: { select: 'id', limit: 1 } });
  if (!Array.isArray(existingProfiles) || existingProfiles.length) throw new HttpError(409, 'A configuração inicial já foi concluída.');
  const configuredDevelopments = await dbRequest('crm_developments', { query: { select: 'id', active: 'eq.true', limit: 1 } });
  if (!Array.isArray(configuredDevelopments) || !configuredDevelopments.length) throw new HttpError(503, 'A lista privada de empreendimentos ainda não foi carregada no banco.');
  let created;
  try {
    created = await authRequest('admin/users', { method: 'POST', admin: true, body: { email: normalizedEmail, password, email_confirm: true, app_metadata: { crm_session_version: 0 }, user_metadata: { name } } });
    const authUser = created && (created.user || created);
    if (!authUser || !authUser.id) throw new HttpError(502, 'Não foi possível criar a conta inicial.');
    await dbRequest('crm_users', { method: 'POST', prefer: 'return=minimal', body: { id: authUser.id, name, email: normalizedEmail, role: 'Administrador', active: true, must_change_password: false, session_version: 0 } });
  } catch (error) {
    const authUser = created && (created.user || created);
    if (authUser && authUser.id) await authRequest(`admin/users/${encodeURIComponent(authUser.id)}`, { method: 'DELETE', admin: true }).catch(() => null);
    throw error;
  }
  await dbRequest('crm_settings', { method: 'POST', query: { on_conflict: 'key' }, prefer: 'resolution=merge-duplicates,return=minimal', body: { key: 'initialized', value: { at: now() } } });
  const session = await authPasswordGrant(normalizedEmail, password);
  return signInResult(session);
}

async function apiLogin(email, password) {
  email = normalizeEmail(email); password = String(password || '');
  if (!email || password.length > 128) return { ok: false, message: 'E-mail ou senha inválidos.' };
  try { return await signInResult(await authPasswordGrant(email, password)); }
  catch (error) {
    if ([400, 401].includes(error.status)) return { ok: false, message: 'E-mail ou senha inválidos.' };
    throw error;
  }
}

async function apiRefresh(refreshToken) {
  if (!refreshToken) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  const oldHash = hashRefreshToken(refreshToken);
  const sessions = await dbRequest('crm_sessions', { query: { select: '*', refresh_token_hash: `eq.${oldHash}`, limit: 1 } });
  const currentSession = Array.isArray(sessions) ? sessions[0] : null;
  if (!currentSession || new Date(currentSession.expires_at).getTime() <= Date.now()) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  const profile = await getProfile(currentSession.user_id);
  if (!profile || profile.active !== true || profile.deleted_at || Number(profile.session_version || 0) !== Number(currentSession.session_version || 0)) {
    await dbRequest('crm_sessions', { method: 'DELETE', query: { refresh_token_hash: `eq.${oldHash}` } }).catch(() => null);
    throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  }
  let newSession;
  try { newSession = await authRequest('token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: String(refreshToken) } }); }
  catch (_) {
    await dbRequest('crm_sessions', { method: 'DELETE', query: { refresh_token_hash: `eq.${oldHash}` } }).catch(() => null);
    throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  }
  const result = await signInResult(newSession, false);
  if (!result.ok || String(newSession.user.id) !== String(currentSession.user_id)) {
    await authSignOut(newSession.access_token);
    await dbRequest('crm_sessions', { method: 'DELETE', query: { refresh_token_hash: `eq.${oldHash}` } }).catch(() => null);
    throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  }
  const rotated = await dbRequest('crm_sessions', {
    method: 'PATCH', query: { refresh_token_hash: `eq.${oldHash}`, session_version: `eq.${currentSession.session_version}` },
    prefer: 'return=representation', body: { refresh_token_hash: hashRefreshToken(newSession.refresh_token), expires_at: refreshExpiry(), last_seen_at: now() }
  });
  if (!Array.isArray(rotated) || !rotated.length) {
    await authSignOut(newSession.access_token);
    throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  }
  return result;
}
async function apiLogout(token, refreshToken) {
  if (refreshToken) await dbRequest('crm_sessions', { method: 'DELETE', query: { refresh_token_hash: `eq.${hashRefreshToken(refreshToken)}` } }).catch(() => null);
  await authSignOut(token); return { ok: true };
}

async function apiChangePassword(token, currentPassword, newPassword) {
  const actor = await verifyActor(token, true);
  currentPassword = String(currentPassword || ''); newPassword = String(newPassword || '');
  if (newPassword.length < 12 || newPassword.length > 128) return { ok: false, message: 'A nova senha deve ter de 12 a 128 caracteres.' };
  try { const verified = await authPasswordGrant(actor.email, currentPassword); await authSignOut(verified.access_token); }
  catch (error) {
    if ([400, 401].includes(error.status)) return { ok: false, message: 'Senha atual incorreta.' };
    throw new HttpError(error.status === 429 ? 429 : 502, 'Não foi possível validar a senha atual. Tente novamente.');
  }
  const nextVersion = actor.sessionVersion + 1;
  const locked = await dbRequest('crm_users', {
    method: 'PATCH', query: { id: `eq.${actor.id}`, session_version: `eq.${actor.sessionVersion}`, active: 'eq.true', deleted_at: 'is.null' },
    prefer: 'return=representation', body: { must_change_password: true, session_version: nextVersion, updated_at: now() }
  });
  if (!Array.isArray(locked) || !locked.length) return { ok: false, message: 'A conta foi alterada durante a operação. Entre novamente e tente trocar a senha.' };
  await dbRequest('crm_sessions', { method: 'DELETE', query: { user_id: `eq.${actor.id}` } }).catch(() => null);
  try {
    await setAuthPassword(actor.id, newPassword, nextVersion);
    const completed = await dbRequest('crm_users', {
      method: 'PATCH', query: { id: `eq.${actor.id}`, session_version: `eq.${nextVersion}`, active: 'eq.true', deleted_at: 'is.null' },
      prefer: 'return=representation', body: { must_change_password: false, updated_at: now() }
    });
    if (!Array.isArray(completed) || !completed.length) throw new HttpError(409, 'A senha foi atualizada, mas a conta precisa de nova validação. Entre novamente.');
  } catch (error) {
    await audit(actor, 'user.password_change_blocked', 'user', actor.id, ['mustChangePassword','sessionVersion'], { mustChangePassword: actor.mustChangePassword, sessionVersion: actor.sessionVersion }, { mustChangePassword: true, sessionVersion: nextVersion, authenticationSync: 'pending' }).catch(() => null);
    if (error instanceof HttpError && error.status === 409) throw error;
    throw new HttpError(502, 'A sessão anterior foi bloqueada preventivamente, mas não foi possível concluir a troca. Use a nova senha se ela já tiver sido salva ou solicite uma redefinição à gestão.');
  }
  await audit(actor, 'user.password_change', 'user', actor.id, ['password','sessionVersion','mustChangePassword'], { password: '[redigida]', mustChangePassword: actor.mustChangePassword, sessionVersion: actor.sessionVersion }, { password: '[redigida]', mustChangePassword: false, sessionVersion: nextVersion });
  return { ok: true, message: 'Senha alterada. Entre novamente com a nova senha.' };
}

async function apiGetReferenceData(token) {
  const actor = await verifyActor(token, true);
  const [developments, users] = await Promise.all([
    dbRequest('crm_developments', { query: { select: 'id,name,active', active: 'eq.true', order: 'name.asc' } }),
    isAdmin(actor) || actor.role === 'SDR' || isConfiguredOperationsManager(actor) ? listAll('crm_users', { select: '*' }) : Promise.resolve([])
  ]);
  return {
    systemName: CRM_CONFIG.systemName, user: publicUser(await getProfile(actor.id)), statuses: CRM_CONFIG.statuses,
    realtime: { url: env().url, publishableKey: env().publishableKey },
    repassStatuses: CRM_CONFIG.repassStatuses,
    developments: (developments || []).map((item) => ({ id: item.id, name: item.name, active: item.active })),
    brokers: (users || []).map(mapUser).filter((item) => item.role === 'Corretor' && !item.deletedAt).map((item) => ({ id: item.id, name: item.name, email: item.email, role: item.role, active: item.active })),
    sdrs: (users || []).map(mapUser).filter((item) => item.role === 'SDR' && item.active && !item.deletedAt).map((item) => ({ id: item.id, name: item.name })),
    managers: (users || []).map(mapUser).filter((item) => ['Gerente','Administrador'].includes(item.role) && item.active && !item.deletedAt).map((item) => ({ id: item.id, name: item.name, role: item.role })),
    sharedTemporaryPasswordAvailable: isAdmin(actor) && !((await dbRequest('crm_settings', { query: { select: 'key', key: 'eq.shared_temporary_password_applied', limit: 1 } })) || []).length
  };
}

async function getFollowupBusinessDays() {
  const rows = await dbRequest('crm_settings', { query: { select: 'value', key: 'eq.followup_business_days', limit: 1 } });
  const stored = Array.isArray(rows) && rows[0] ? rows[0].value : null;
  const value = stored && typeof stored === 'object' ? stored.days : stored;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 30 ? days : Number(CRM_CONFIG.staleBusinessDays || 3);
}

async function apiSaveFollowupDays(token, value) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 30) return { ok: false, message: 'O prazo deve ser um número inteiro entre 1 e 30 dias úteis.' };
  const previousDays = await getFollowupBusinessDays();
  const stamp = now();
  await dbRequest('crm_settings', {
    method: 'POST', query: { on_conflict: 'key' }, prefer: 'resolution=merge-duplicates,return=minimal',
    body: { key: 'followup_business_days', value: { days }, updated_at: stamp }
  });
  await audit(actor, 'settings.followup_days.update', 'setting', 'followup_business_days', ['days'], { days: previousDays }, { days });
  return { ok: true, days, message: `Prazo de follow-up atualizado para ${days} dia(s) útil(eis).` };
}

async function loadLeadContext(options = {}) {
  const leadQuery = options.archivedOnly
    ? { deleted_at: 'not.is.null' }
    : options.includeArchived
      ? {}
      : { deleted_at: 'is.null' };
  const [userRows, developmentRows, leadRows] = await Promise.all([
    listAll('crm_users', { select: '*' }), listAll('crm_developments', { select: '*' }), listAll('crm_leads', { select: '*', ...leadQuery })
  ]);
  return { users: userRows.map(mapUser), developments: developmentRows, leads: leadRows.map((row) => mapLead(row, userRows.map(mapUser), developmentRows)) };
}

async function apiGetDashboard(token, filters) {
  const actor = await verifyActor(token);
  if (actor.role === 'SDR') throw new HttpError(403, 'O perfil SDR não tem acesso à visão geral gerencial.');
  const [context, eventRows, historyRows, staleBusinessDays] = await Promise.all([
    loadLeadContext(), listAll('crm_lead_events', { select: '*' }), listAll('crm_sdr_history', { select: 'lead_id,at,status,feedback,source' }),
    getFollowupBusinessDays()
  ]);
  const events = (eventRows || []).map((item) => ({ id: item.id, leadId: item.lead_id, at: item.at, eventType: item.event_type, oldStatus: item.old_status || '', newStatus: item.new_status || '', brokerId: item.broker_id, developmentId: item.development_id }));
  const sdrHistory = (historyRows || []).map((item) => ({ leadId: item.lead_id, at: item.at, status: item.status, feedback: item.feedback, source: item.source }));
  const dashboard = CrmDomain.buildDashboard(context.leads, context.users, filters, {
    actor, today: now(), staleBusinessDays,
    allLeads: context.leads, events, sdrHistory
  });
  if (actor.role === 'Corretor') dashboard.ranking = dashboard.ranking.filter((item) => item.id === actor.id);
  return dashboard;
}

const OPERATIONS_ACCESS = new Set(['none','broker','sdr','viewer','manager']);
const OPERATIONS_METRICS = [
  { id: 'prospections', label: 'Prospecções', column: 'prospecting_count' },
  { id: 'interactions', label: 'Interações', column: 'interaction_count' },
  { id: 'appointments', label: 'Agendamentos', column: 'appointment_count' },
  { id: 'visits', label: 'Visitas', column: 'visit_count' },
  { id: 'sales', label: 'Vendas', column: 'sale_count' },
  { id: 'folders', label: 'Pastas encaminhadas', column: 'folder_count' }
];
const OPERATIONS_SHIFTS = [
  { id: 'morning', label: 'Manhã' }, { id: 'afternoon', label: 'Tarde' }, { id: 'night', label: 'Noite' }
];

function operationsAccessOf(user) {
  if (!user) return 'none';
  if (OPERATIONS_ACCESS.has(user.operationsAccess)) return user.operationsAccess;
  if (user.role === 'Corretor') return 'broker';
  if (user.role === 'SDR') return 'sdr';
  return isAdmin(user) ? 'viewer' : 'none';
}
function requireOperationsAccess(user, allowed = ['broker','sdr','viewer','manager']) {
  if (user && user.role === 'SDR') throw new HttpError(403, 'O perfil SDR não tem acesso às áreas de produção e frequência.');
  if (!allowed.includes(operationsAccessOf(user))) throw new HttpError(403, 'Seu perfil não tem acesso a este módulo operacional.');
}
function isOperationsManager(user) { return operationsAccessOf(user) === 'manager'; }
function operationDateString(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function addDateOnly(dateValue, offset) {
  const [year, month, day] = String(dateValue).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}
function daysBetweenDateOnly(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}
function monthEndDateOnly(dateValue) {
  const [year, month] = String(dateValue).split('-').map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}
function operationsDateRange(filters = {}) {
  const today = operationDateString(now());
  const requestedPeriod = String(filters && filters.period || 'week');
  const period = ['day','week','month','quarter','semester','year'].includes(requestedPeriod) ? requestedPeriod : 'week';
  let start; let end; let goalCycle = null; let goalStart = null; let goalEnd = null; let label;
  const customFrom = String(filters && filters.dateFrom || '').trim();
  const customTo = String(filters && filters.dateTo || '').trim();
  if (customFrom || customTo) {
    start = customFrom || customTo; end = customTo || today;
    if (!isValidDateOnly(start) || !isValidDateOnly(end) || start > end || end > today) throw new HttpError(400, 'Informe um período válido, sem datas futuras.');
    label = `${displayDateOnly(start)} a ${displayDateOnly(end)}`;
    if (daysBetweenDateOnly(start, end) > 366) throw new HttpError(400, 'O período de consulta deve ter no máximo 366 dias.');
    if (['month','quarter','semester','year'].includes(period)) {
      goalCycle = 'monthly'; goalStart = `${today.slice(0,7)}-01`; goalEnd = monthEndDateOnly(today);
    } else {
      const weekDay = new Date(`${today}T00:00:00Z`).getUTCDay();
      goalStart = addDateOnly(today, -((weekDay + 6) % 7)); goalEnd = addDateOnly(goalStart, 6); goalCycle = 'weekly';
    }
  } else if (period === 'month') {
    start = `${today.slice(0,7)}-01`; end = today;
    goalCycle = 'monthly'; goalStart = start; goalEnd = monthEndDateOnly(today);
    label = 'Mês atual até hoje';
  } else if (['quarter','semester','year'].includes(period)) {
    const year=Number(today.slice(0,4));const month=Number(today.slice(5,7));
    const firstMonth=period==='quarter'?Math.floor((month-1)/3)*3+1:period==='semester'?(month<=6?1:7):1;
    start=`${year}-${String(firstMonth).padStart(2,'0')}-01`;end=today;
    goalCycle='monthly';goalStart=`${today.slice(0,7)}-01`;goalEnd=monthEndDateOnly(today);
    label=period==='quarter'?'Trimestre atual até hoje':period==='semester'?'Semestre atual até hoje':'Ano atual até hoje';
  } else if (period === 'day') {
    start = today; end = today;
    const weekDay = new Date(`${today}T00:00:00Z`).getUTCDay();
    goalStart = addDateOnly(today, -((weekDay + 6) % 7)); goalEnd = addDateOnly(goalStart, 6); goalCycle = 'weekly';
    label = `Hoje (${displayDateOnly(today)})`;
  } else {
    const weekDay = new Date(`${today}T00:00:00Z`).getUTCDay();
    const daysFromMonday = (weekDay + 6) % 7;
    start = addDateOnly(today, -daysFromMonday); end = today;
    goalCycle = 'weekly'; goalStart = start; goalEnd = addDateOnly(start, 6);
    label = 'Semana atual até hoje';
  }
  const duration = daysBetweenDateOnly(start, end);
  let previousEnd = addDateOnly(start, -1);
  let previousStart = addDateOnly(previousEnd, -(duration - 1));
  if (!customFrom && !customTo && period === 'month') {
    previousStart = previousEnd.slice(0,7) + '-01';
    const comparableDay = Math.min(Number(today.slice(8,10)), Number(monthEndDateOnly(previousStart).slice(8,10)));
    previousEnd = previousStart.slice(0,7) + '-' + String(comparableDay).padStart(2,'0');
  }
  return { start, end, label, period, goalCycle, goalStart, goalEnd, previousStart, previousEnd };
}
function rangeQuery(dateColumn, start, end) {
  return { select: '*', deleted_at: 'is.null', and: `(${dateColumn}.gte.${start},${dateColumn}.lte.${end})`, order: `${dateColumn}.desc` };
}
function operationsUserSummary(user, users) {
  const found = users.find((item) => String(item.id) === String(user));
  return found ? { id: found.id, name: found.name, role: found.role, active: found.active, operationsAccess: found.operationsAccess } : { id: user, name: 'Corretor inativo', role: 'Corretor', active: false, operationsAccess: 'none' };
}
function blankOperationTotals() { return { prospections: 0, interactions: 0, appointments: 0, visits: 0, sales: 0, folders: 0, attendance: 0, morning: 0, afternoon: 0, night: 0 }; }
function summarizeOperations(entries, attendanceRows, users, start, end, scopedBrokerId = '') {
  const brokerRows = users.filter((user) => user.role === 'Corretor' && (!user.deletedAt || user.active));
  const byBroker = new Map();
  brokerRows.forEach((user) => { if (!scopedBrokerId || String(user.id) === String(scopedBrokerId)) byBroker.set(String(user.id), { ...operationsUserSummary(user.id, users), ...blankOperationTotals() }); });
  const daily = new Map();
  for (let day = start; day <= end; day = addDateOnly(day, 1)) daily.set(day, { date: day, ...blankOperationTotals(), manualAppointmentsByBroker: {} });
  const totals = blankOperationTotals();
  let latestUpdatedAt = '';
  for (const row of entries) {
    if (scopedBrokerId && String(row.broker_id) !== String(scopedBrokerId)) continue;
    if (!byBroker.has(String(row.broker_id))) byBroker.set(String(row.broker_id), { ...operationsUserSummary(row.broker_id, users), ...blankOperationTotals() });
    const broker = byBroker.get(String(row.broker_id));
    const day = daily.get(String(row.work_date));
    for (const metric of OPERATIONS_METRICS) {
      const value = Number(row[metric.column] || 0);
      const key = metric.id;
      totals[key] += value; broker[key] += value;
      if (day) { day[key] += value; if (key === 'appointments') day.manualAppointmentsByBroker[String(row.broker_id)] = (day.manualAppointmentsByBroker[String(row.broker_id)] || 0) + value; }
    }
    if (String(row.updated_at || '') > latestUpdatedAt) latestUpdatedAt = String(row.updated_at || '');
  }
  for (const row of attendanceRows) {
    if (scopedBrokerId && String(row.broker_id) !== String(scopedBrokerId)) continue;
    if (!byBroker.has(String(row.broker_id))) byBroker.set(String(row.broker_id), { ...operationsUserSummary(row.broker_id, users), ...blankOperationTotals() });
    const broker = byBroker.get(String(row.broker_id));
    const shift = String(row.shift || '');
    if (!['morning','afternoon','night'].includes(shift)) continue;
    totals.attendance += 1; totals[shift] += 1;
    broker.attendance += 1; broker[shift] += 1;
    const day = daily.get(String(row.attendance_date));
    if (day) { day.attendance += 1; day[shift] += 1; }
    if (String(row.updated_at || '') > latestUpdatedAt) latestUpdatedAt = String(row.updated_at || '');
  }
  const ranked = [...byBroker.values()].map((broker) => ({
    ...broker,
    weightedScore: broker.sales * 5 + broker.attendance * 4 + broker.folders * 4 + broker.visits * 3 + broker.appointments * 2 + broker.prospections + broker.interactions
  })).sort((a,b) => b.weightedScore - a.weightedScore || a.name.localeCompare(b.name, 'pt-BR'));
  ranked.forEach((broker, index) => { broker.rank = index + 1; });
  return { totals, byBroker: ranked, daily: [...daily.values()], latestUpdatedAt };
}
function applyWeightedRanking(summary, goals = []) {
  const weights={sales:5,attendance:4,folders:4,visits:3,appointments:2,prospections:1,interactions:1};
  const maxByMetric=Object.fromEntries(Object.keys(weights).map((metric)=>[metric,Math.max(0,...summary.byBroker.map((row)=>Number(row[metric]||0)))]));
  const targetByBroker=new Map();for(const goal of goals){const key=String(goal.broker_id);const targets=targetByBroker.get(key)||{};targets[goal.metric]=Number(goal.target_count||0);targetByBroker.set(key,targets);}
  const ranked=summary.byBroker.map((row)=>{const targets=targetByBroker.get(String(row.id))||{};let score=0;for(const [metric,weight] of Object.entries(weights)){const target=Number(targets[metric]||0);const denominator=target||maxByMetric[metric];score+=denominator>0?Number(row[metric]||0)/denominator*weight:0;}return{...row,weightedScore:Math.round(score*100)/100};})
    .sort((a,b)=>b.weightedScore-a.weightedScore||a.name.localeCompare(b.name,'pt-BR'));
  ranked.forEach((row,index)=>{row.rank=index+1;});summary.byBroker=ranked;return summary;
}
function metricValuesFromRow(row) {
  return { prospections: Number(row.prospecting_count || 0), interactions: Number(row.interaction_count || 0), appointments: Number(row.appointment_count || 0), visits: Number(row.visit_count || 0), sales: Number(row.sale_count || 0), folders: Number(row.folder_count || 0) };
}
function comparisonValues(current, previous) {
  return Object.fromEntries([...OPERATIONS_METRICS.map((item) => item.id), 'attendance'].map((key) => {
    const before = Number(previous[key] || 0); const after = Number(current[key] || 0);
    return [key, { current: after, previous: before, difference: after - before, changePct: before ? Math.round(((after - before) / before) * 1000) / 10 : null }];
  }));
}
function displayDateOnly(value) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value || '');
}

function brazilDateStartIso(value) { return new Date(`${value}T00:00:00-03:00`).toISOString(); }
function brazilDateEndIso(value) { return new Date(`${value}T23:59:59.999-03:00`).toISOString(); }

async function loadOperationsSnapshot(actor, filters = {}) {
  requireOperationsAccess(actor);
  const access = operationsAccessOf(actor);
  const range = operationsDateRange(filters);
  const brokerFilter = access === 'broker' ? actor.id : (isUuid(filters && filters.brokerId) ? String(filters.brokerId) : '');
  const attendanceBrokerFilter = access === 'broker' ? actor.id : brokerFilter;
  const [userRows, entryRows, attendanceRows, goalRows, previousEntryRows, previousAttendanceRows] = await Promise.all([
    listAll('crm_users', { select: '*' }),
    listAll('crm_production_entries', rangeQuery('work_date', range.start, range.end)),
    listAll('crm_attendance_records', rangeQuery('attendance_date', range.start, range.end)),
    range.goalCycle ? listAll('crm_production_goals', { select: '*', is_current: 'eq.true', cycle: `eq.${range.goalCycle}`, starts_on: `eq.${range.goalStart}`, ends_on: `eq.${range.goalEnd}` }) : Promise.resolve([]),
    listAll('crm_production_entries', rangeQuery('work_date', range.previousStart, range.previousEnd)),
    listAll('crm_attendance_records', rangeQuery('attendance_date', range.previousStart, range.previousEnd))
  ]);
  const goalActualEnd = range.goalEnd && range.goalEnd < operationDateString(now()) ? range.goalEnd : operationDateString(now());
  const goalActualRows = range.goalCycle && range.goalStart <= goalActualEnd
    ? await listAll('crm_production_entries', rangeQuery('work_date', range.goalStart, goalActualEnd))
    : [];
  const uniqueEntryRows = [...new Map([...(entryRows || []), ...(previousEntryRows || []), ...(goalActualRows || [])].map((row) => [String(row.id), row])).values()];
  const adjustedEntryRows = await applyCancelledSalesToProduction(uniqueEntryRows);
  const adjustedByEntryId = new Map(adjustedEntryRows.map((row) => [String(row.id), row]));
  const currentEntryRows = (entryRows || []).map((row) => adjustedByEntryId.get(String(row.id)) || row);
  const previousAdjustedEntryRows = (previousEntryRows || []).map((row) => adjustedByEntryId.get(String(row.id)) || row);
  const goalActualAdjustedRows = (goalActualRows || []).map((row) => adjustedByEntryId.get(String(row.id)) || row);
  const users = userRows.map(mapUser);
  const scopeEntries = currentEntryRows.filter((row) => !brokerFilter || String(row.broker_id) === String(brokerFilter));
  const scopeAttendance = (attendanceRows || []).filter((row) => !attendanceBrokerFilter || String(row.broker_id) === String(attendanceBrokerFilter));
  const previousEntries = previousAdjustedEntryRows.filter((row) => !brokerFilter || String(row.broker_id) === String(brokerFilter));
  const previousAttendance = (previousAttendanceRows || []).filter((row) => !attendanceBrokerFilter || String(row.broker_id) === String(attendanceBrokerFilter));
  const current = summarizeOperations(scopeEntries, scopeAttendance, users, range.start, range.end, brokerFilter);
  const previous = summarizeOperations(previousEntries, previousAttendance, users, range.previousStart, range.previousEnd, brokerFilter);
  const visibleGoals = (goalRows || []).filter((goal) => !brokerFilter || String(goal.broker_id) === String(brokerFilter));
  const exactGoalCycle=['week','month'].includes(range.period)&&!filters.dateFrom&&!filters.dateTo;
  const rankGoals=exactGoalCycle?(goalRows||[]):[];
  const teamCurrent=summarizeOperations(currentEntryRows,attendanceRows,users,range.start,range.end);
  applyWeightedRanking(teamCurrent,rankGoals);
  const teamRankById=new Map(teamCurrent.byBroker.map((row)=>[String(row.id),row]));
  current.byBroker=current.byBroker.map((row)=>{const rank=teamRankById.get(String(row.id));return rank?{...row,rank:rank.rank,weightedScore:rank.weightedScore}:row;});
  const publicRanking=teamCurrent.byBroker.filter((row)=>access!=='broker'||String(row.id)===String(actor.id)).map((row)=>access==='broker'
    ? {id:row.id,name:row.name,rank:row.rank}
    : {id:row.id,name:row.name,rank:row.rank,weightedScore:row.weightedScore});
  const goalActualByBroker = new Map();
  goalActualAdjustedRows.forEach((row) => {
    const id = String(row.broker_id);
    const totals = goalActualByBroker.get(id) || { prospections: 0, visits: 0, sales: 0 };
    totals.prospections += Number(row.prospecting_count || 0);
    totals.visits += Number(row.visit_count || 0);
    totals.sales += Number(row.sale_count || 0);
    goalActualByBroker.set(id, totals);
  });
  const goals = current.byBroker.map((broker) => {
    const metricGoals = {};
    for (const metricId of ['prospections','visits','sales']) {
      const goal = visibleGoals.find((item) => String(item.broker_id) === String(broker.id) && item.metric === metricId);
      const target = goal ? Number(goal.target_count) : null;
      const actual = Number((goalActualByBroker.get(String(broker.id)) || {})[metricId] || 0);
      const remaining=target===null?null:Math.max(0,target-actual);const referenceDate=range.goalStart>operationDateString(now())?range.goalStart:operationDateString(now());const remainingDays=range.goalEnd&&referenceDate<=range.goalEnd?daysBetweenDateOnly(referenceDate,range.goalEnd):0;const requiredPerDay=remaining===null||remainingDays===0?null:Math.round(remaining/remainingDays*10)/10;
      metricGoals[metricId] = { target, actual, remaining, exceeded: target === null ? 0 : Math.max(0, actual - target), percent: target ? Math.round(actual / target * 1000) / 10 : null, remainingDays, requiredPerDay, requiredPerWeek:requiredPerDay===null?null:Math.round(requiredPerDay*7*10)/10, revision: goal ? Number(goal.revision) : null };
    }
    return { brokerId: broker.id, brokerName: broker.name, metrics: metricGoals };
  });
  const publicAttendanceByBroker = current.byBroker.map((broker) => ({ brokerId: broker.id, brokerName: broker.name, total: broker.attendance, morning: broker.morning, afternoon: broker.afternoon, night: broker.night }));
  const safeAttendanceByBroker = publicAttendanceByBroker;
  let recentOwnEntries = [];
  if (access === 'broker') {
    const recentRows = await dbRequest('crm_production_entries', { query: { select: '*', broker_id: `eq.${actor.id}`, deleted_at: 'is.null', order: 'work_date.desc,updated_at.desc', limit: 5 }, range: '0-4' });
    const recentAdjustedRows = await applyCancelledSalesToProduction(Array.isArray(recentRows) ? recentRows : []);
    recentOwnEntries = recentAdjustedRows.map((row) => ({
      id: row.id, workDate: row.work_date, ...metricValuesFromRow(row), reportedSales: Number(row.reported_sale_count || 0),
      linkedCancelledSales: Number(row.linked_cancelled_sales || 0), notes: row.notes || '', updatedAt: row.updated_at
    }));
  }
  return {
    period: { start: range.start, end: range.end, label: range.label, periodType: range.period, previousStart: range.previousStart, previousEnd: range.previousEnd, goalCycle: range.goalCycle, goalStart: range.goalStart, goalEnd: range.goalEnd },
    totals: current.totals,
    byBroker: current.byBroker,
    ranking: publicRanking,
    daily: current.daily,
    comparison: comparisonValues(current.totals, previous.totals),
    goals,
    attendanceByShift: { morning: current.totals.morning, afternoon: current.totals.afternoon, night: current.totals.night, total: current.totals.attendance },
    attendanceByBroker: safeAttendanceByBroker,
    latestUpdatedAt: current.latestUpdatedAt,
    recentOwnEntries,
    canManage: isOperationsManager(actor),
    canExport: ['manager','viewer'].includes(access),
    access
  };
}

async function apiGetOperationsDashboard(token, filters = {}) {
  const actor = await verifyActor(token);
  return loadOperationsSnapshot(actor, filters && typeof filters === 'object' ? filters : {});
}

function requireScheduleAccess(actor) {
  if (!actor || !(actor.role === 'Corretor' || actor.role === 'Administrador' || isFinanceManager(actor))) {
    throw new HttpError(403, 'A agenda está disponível para corretores, gerente e assistente.');
  }
}
function managerCanSeeAllSchedules(actor) { return Boolean(actor && (actor.role === 'Administrador' || isFinanceManager(actor))); }
function timestamp(value, label) {
  const source = String(value || '').trim();
  const parsed = Date.parse(source);
  if (!source || !Number.isFinite(parsed) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(source)) throw new HttpError(400, `${label} inválido. Selecione data e horário no fuso local.`);
  return new Date(parsed).toISOString();
}
function appointmentDto(row, users, developments, actor) {
  const broker = users.find((user) => String(user.id) === String(row.broker_id));
  const own = String(row.broker_id) === String(actor.id);
  if (!managerCanSeeAllSchedules(actor) && !own) {
    return { id: row.id, startsAt: row.starts_at, endsAt: row.ends_at, occupied: true, clientName: 'Ocupado' };
  }
  const development = developments.find((item) => String(item.id) === String(row.development_id));
  return {
    id: row.id, leadId: row.lead_id || '', clientName: row.client_name, developmentId: row.development_id || '',
    developmentName: development ? development.name : '', stand: row.stand || '', brokerId: row.broker_id,
    brokerName: broker ? broker.name : row.broker_id ? 'Corretor inativo' : '', startsAt: row.starts_at, endsAt: row.ends_at,
    status: row.status, notes: own || managerCanSeeAllSchedules(actor) ? (row.notes || '') : '', occupied: false,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}
async function apiListAppointments(token, filters = {}) {
  const actor = await verifyActor(token); requireScheduleAccess(actor);
  const today = operationDateString(now());
  const startDate = String(filters.dateFrom || addDateOnly(today, -14));
  const endDate = String(filters.dateTo || addDateOnly(today, 45));
  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate) || startDate > endDate || daysBetweenDateOnly(startDate, endDate) > 180) {
    throw new HttpError(400, 'Selecione um período válido de até 180 dias.');
  }
  const startAt = brazilDateStartIso(startDate);
  const endAt = brazilDateEndIso(endDate);
  const query = { select: '*', deleted_at: 'is.null', and: `(starts_at.gte.${startAt},starts_at.lte.${endAt})`, order: 'starts_at.asc' };
  if (!managerCanSeeAllSchedules(actor)) query.or = `(broker_id.eq.${actor.id},status.neq.Cancelado)`;
  const [appointmentRows, locationRows, userRows, developmentRows] = await Promise.all([
    listAll('crm_appointments', query),
    listAll('crm_manager_locations', { select: '*', deleted_at: 'is.null', and: `(starts_at.gte.${startAt},starts_at.lte.${endAt})`, order: 'starts_at.asc' }),
    listAll('crm_users', { select: 'id,name,role,active,deleted_at' }),
    listAll('crm_developments', { select: 'id,name,active' })
  ]);
  const users = userRows.map(mapUser);
  const appointments = (appointmentRows || []).filter((row) => row.status !== 'Cancelado' || String(row.broker_id) === String(actor.id) || managerCanSeeAllSchedules(actor))
    .map((row) => appointmentDto(row, users, developmentRows || [], actor));
  const locations = (locationRows || []).map((row) => ({
    id: row.id, managerName: users.find((item) => String(item.id) === String(row.manager_id))?.name || 'Gerente',
    location: row.location, startsAt: row.starts_at, endsAt: row.ends_at, notes: managerCanSeeAllSchedules(actor) ? row.notes || '' : ''
  }));
  return { appointments, managerLocations: locations, dateFrom: startDate, dateTo: endDate, canManageAll: managerCanSeeAllSchedules(actor), actorId: actor.id };
}
function appointmentNotificationText(eventType, appointment) {
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(appointment.starts_at));
  const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(appointment.starts_at));
  const client = String(appointment.client_name || 'Atendimento').trim();
  const labels = {
    appointment_created: ['Novo agendamento', `${client} foi agendado para ${date} às ${time}.`],
    appointment_updated: ['Agendamento alterado', `O atendimento de ${client} foi atualizado. Novo horário: ${date} às ${time}.`],
    appointment_cancelled: ['Agendamento cancelado', `O atendimento de ${client} em ${date} às ${time} foi cancelado.`]
  };
  return labels[eventType] || ['Atualização da agenda', `${client} · ${date} às ${time}.`];
}
async function notifyAppointmentRecipients(appointment, eventType) {
  const users = await listAll('crm_users', { select: 'id,name,role,active,deleted_at' });
  const activeUsers = (users || []).filter((user) => user.active === true && !user.deleted_at);
  const recipients = new Map(activeUsers.filter((user) => ['Gerente','Assistente'].includes(user.role)).map((user) => [String(user.id), user]));
  const creator = activeUsers.find((user) => String(user.id) === String(appointment.created_by) && user.role === 'Corretor');
  if (creator) recipients.set(String(creator.id), creator);
  const [title, message] = appointmentNotificationText(eventType, appointment);
  const startAt = String(appointment.starts_at || '');
  try {
    for (const recipient of recipients.values()) {
      const key = `appointment:${appointment.id}:${appointment.updated_at || startAt}:${eventType}:${recipient.id}`;
      await dbRequest('crm_in_app_notifications', {
        method: 'POST', query: { on_conflict: 'dedupe_key' }, prefer: 'resolution=ignore-duplicates,return=minimal',
        body: { recipient_id: recipient.id, appointment_id: appointment.id, appointment_start_at: startAt || null,
          event_type: eventType, title, message, dedupe_key: key, created_at: now() }
      });
    }
    return true;
  } catch (_) {
    return false;
  }
}
async function notifyCommissionReceiptParticipants(document, eventType) {
  const userRows = await listAll('crm_users', { select: 'id,name,role,active,deleted_at' });
  const active = (userRows || []).filter((user) => user.active === true && !user.deleted_at);
  const recipientIds = eventType === 'commission_receipt_signature_requested'
    ? [document.recipient_id || (document.recipient_role === 'SDR' ? document.sdr_id : document.broker_id)].filter(Boolean)
    : active.filter((user) => isFinanceManager(user)).map((user) => user.id);
  const recipients = [...new Map(recipientIds.map((id) => {
    const user = active.find((item) => String(item.id) === String(id));
    return user ? [String(user.id), user] : null;
  }).filter(Boolean)).values()];
  if (!recipients.length) return true;
  const title = eventType === 'commission_receipt_signature_requested' ? 'Recibo aguardando assinatura' : 'Recibo assinado enviado para conferência';
  const message = eventType === 'commission_receipt_signature_requested'
    ? 'Seu recibo de comissão foi gerado. Baixe, assine fora do CRM e envie o PDF assinado.'
    : 'Um PDF assinado foi enviado para um recibo. Confira as assinaturas antes de confirmar no CRM.';
  try {
    for (const recipient of recipients) {
      const version = String(document.generated_storage_path || document.signed_uploaded_at || document.updated_at || now());
      const dedupeKey = `commission:${document.id}:${eventType}:${version}:${recipient.id}`;
      await dbRequest('crm_in_app_notifications', {
        method: 'POST', query: { on_conflict: 'dedupe_key' }, prefer: 'resolution=ignore-duplicates,return=minimal',
        body: { recipient_id: recipient.id, commission_document_id: document.id, event_type: eventType,
          title, message, dedupe_key: dedupeKey, created_at: now() }
      });
    }
    return true;
  } catch (_) { return false; }
}
async function apiListNotifications(token) {
  const actor = await verifyActor(token);
  if (actor.role === 'SDR') throw new HttpError(403, 'Use a área Alertas SDR para consultar os alertas do seu perfil.');
  const rows = await dbRequest('crm_in_app_notifications', { query: {
    select: '*', recipient_id: `eq.${actor.id}`, order: 'created_at.desc', limit: 60
  } });
  const notifications = Array.isArray(rows) ? rows : [];
  const reminderRows = notifications.filter((item) => String(item.event_type || '').startsWith('appointment_reminder_') && item.appointment_id);
  let appointments = [];
  if (reminderRows.length) {
    const ids = [...new Set(reminderRows.map((item) => String(item.appointment_id)).filter(isUuid))];
    if (ids.length) appointments = await listAll('crm_appointments', { select: 'id,starts_at,status,deleted_at', id: `in.(${ids.join(',')})` });
  }
  const appointmentsById = new Map((appointments || []).map((item) => [String(item.id), item]));
  const visible = notifications.filter((item) => {
    if (!String(item.event_type || '').startsWith('appointment_reminder_')) return true;
    const current = appointmentsById.get(String(item.appointment_id));
    return Boolean(current && !current.deleted_at && current.status === 'Agendado'
      && String(current.starts_at) === String(item.appointment_start_at));
  });
  const visibleUnreadIds = new Set(visible.filter((item) => !item.read_at).map((item) => String(item.id)));
  const unreadCount = Math.min(999, visibleUnreadIds.size);
  return { items: visible.map((item) => ({ id: item.id, appointmentId: item.appointment_id || '', commissionDocumentId: item.commission_document_id || '', eventType: item.event_type,
    title: item.title, message: item.message, readAt: item.read_at || '', createdAt: item.created_at || '' })), unreadCount };
}
async function apiMarkNotificationRead(token, notificationId) {
  const actor = await verifyActor(token);
  if (actor.role === 'SDR') throw new HttpError(403, 'Use a área Alertas SDR para consultar os alertas do seu perfil.');
  if (!isUuid(notificationId)) return { ok: false, message: 'Notificação inválida.' };
  const stamp = now();
  const rows = await dbRequest('crm_in_app_notifications', { method: 'PATCH', query: {
    id: `eq.${notificationId}`, recipient_id: `eq.${actor.id}`, read_at: 'is.null'
  }, prefer: 'return=representation', body: { read_at: stamp } });
  if (!Array.isArray(rows) || !rows.length) return { ok: false, message: 'Notificação não encontrada ou já marcada como lida.' };
  return { ok: true, message: 'Notificação marcada como lida.' };
}
async function apiSaveAppointment(token, payload = {}) {
  const actor = await verifyActor(token); requireScheduleAccess(actor);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some((key)=>!['id','clientName','leadId','developmentId','stand','brokerId','startsAt','endsAt','status','notes'].includes(key))) return { ok: false, message: 'Dados do agendamento inválidos.' };
  const id = String(payload.id || '').trim();
  const startAt = timestamp(payload.startsAt, 'Data e horário inicial');
  const endAt = timestamp(payload.endsAt, 'Data e horário final');
  if (Date.parse(endAt) <= Date.parse(startAt) || Date.parse(endAt) - Date.parse(startAt) > 8 * 60 * 60 * 1000) return { ok: false, message: 'O atendimento deve ter duração entre 1 minuto e 8 horas.' };
  const clientName = String(payload.clientName || '').trim().slice(0, 150);
  const stand = String(payload.stand || '').trim().slice(0, 120);
  const notes = String(payload.notes || '').trim().slice(0, 1500);
  const status = ['Agendado','Realizado','Cancelado','Não compareceu'].includes(String(payload.status || 'Agendado')) ? String(payload.status || 'Agendado') : '';
  let brokerId = managerCanSeeAllSchedules(actor) ? String(payload.brokerId || '').trim() : String(actor.id);
  const developmentId = String(payload.developmentId || '').trim();
  const leadId = String(payload.leadId || '').trim();
  if (!clientName || !status) return { ok: false, message: 'Informe o compromisso e uma situação válida.' };
  if (id && !isUuid(id)) return { ok: false, message: 'Agendamento inválido.' };
  if (brokerId && !isUuid(brokerId)) return { ok: false, message: 'Corretor inválido.' };
  if (developmentId && !isUuid(developmentId)) return { ok: false, message: 'Empreendimento inválido.' };
  let lead = null;
  if (leadId) {
    if (!isUuid(leadId)) return { ok: false, message: 'Cliente vinculado inválido.' };
    const leadRows = await dbRequest('crm_leads', { query: { select: 'id,broker_id,deleted_at', id: `eq.${leadId}`, limit: 1 } });
    lead = Array.isArray(leadRows) ? leadRows[0] || null : null;
    if (!lead || lead.deleted_at) return { ok: false, message: 'O cliente vinculado não está ativo no CRM.' };
    if (!brokerId && managerCanSeeAllSchedules(actor)) brokerId = String(lead.broker_id || '');
    if (String(lead.broker_id) !== brokerId) return { ok: false, message: 'O cliente deve estar ativo na carteira do corretor selecionado.' };
  }
  let broker = null;
  if (brokerId) {
    const brokerRows = await dbRequest('crm_users', { query: { select: 'id,name,role,active,deleted_at', id: `eq.${brokerId}`, limit: 1 } });
    broker = Array.isArray(brokerRows) ? brokerRows[0] : null;
    if (!broker || broker.role !== 'Corretor' || broker.active !== true || broker.deleted_at) return { ok: false, message: 'Selecione um corretor ativo.' };
  }
  if (developmentId) {
    const developmentRows = await dbRequest('crm_developments', { query: { select: 'id,active', id: `eq.${developmentId}`, limit: 1 } });
    if (!Array.isArray(developmentRows) || !developmentRows[0] || developmentRows[0].active !== true) return { ok: false, message: 'Selecione um empreendimento ativo.' };
  }
  let existing = null;
  if (id) {
    const rows = await dbRequest('crm_appointments', { query: { select: '*', id: `eq.${id}`, deleted_at: 'is.null', limit: 1 } });
    existing = Array.isArray(rows) ? rows[0] || null : null;
    if (!existing) return { ok: false, message: 'Agendamento não encontrado ou já cancelado administrativamente.' };
    if (!managerCanSeeAllSchedules(actor) && String(existing.broker_id) !== String(actor.id)) throw new HttpError(403, 'Você só pode alterar seus próprios atendimentos.');
  }
  const localStartDate=operationDateString(Date.parse(startAt));
  const dayStart = brazilDateStartIso(addDateOnly(localStartDate,-1));
  const dayEnd = brazilDateEndIso(addDateOnly(localStartDate,1));
  const collisionRows = await listAll('crm_appointments', { select: '*', deleted_at: 'is.null', and: `(starts_at.gte.${dayStart},starts_at.lte.${dayEnd})` });
  const standKey = (value) => String(value || '').trim().toLocaleLowerCase('pt-BR');
  const collision = status === 'Agendado' ? collisionRows.find((row) => String(row.id) !== id && row.status === 'Agendado'
    && Date.parse(row.starts_at) < Date.parse(endAt) && Date.parse(row.ends_at) > Date.parse(startAt)
    && ((brokerId && String(row.broker_id) === brokerId) || (stand && developmentId && String(row.development_id) === developmentId && standKey(row.stand) === standKey(stand)))) : null;
  if (collision) return { ok: false, message: 'Esse horário está ocupado para o corretor ou stand escolhido. Selecione outro horário.' };
  const stamp = now();
  const values = { lead_id: leadId || null, client_name: clientName, development_id: developmentId || null, stand,
    broker_id: brokerId || null, starts_at: startAt, ends_at: endAt, status, notes, updated_at: stamp, updated_by: actor.id };
  const before = existing ? { clientName: existing.client_name, developmentId: existing.development_id, stand: existing.stand, brokerId: existing.broker_id, startsAt: existing.starts_at, endsAt: existing.ends_at, status: existing.status, notes: existing.notes } : {};
  const savedRows = existing
    ? await dbRequest('crm_appointments', { method: 'PATCH', query: { id: `eq.${id}`, deleted_at: 'is.null' }, prefer: 'return=representation', body: values })
    : await dbRequest('crm_appointments', { method: 'POST', prefer: 'return=representation', body: { ...values, created_by: actor.id, created_at: stamp } });
  const saved = Array.isArray(savedRows) ? savedRows[0] : null;
  if (!saved) throw new HttpError(502, 'Não foi possível confirmar o agendamento. Atualize a tela antes de tentar novamente.');
  const after = { clientName, developmentId, stand, brokerId, startsAt: startAt, endsAt: endAt, status, notes };
  await audit(actor, existing ? 'appointment.update' : 'appointment.create', 'appointment', saved.id, auditChangedFields(before, after), before, after, 'operations');
  const notificationSaved = await notifyAppointmentRecipients(saved, existing ? (status === 'Cancelado' ? 'appointment_cancelled' : 'appointment_updated') : 'appointment_created');
  const linkedLeadStatus=status==='Agendado'?'Atendimento agendado':status==='Realizado'?'Atendimento realizado':'';
  if(saved.lead_id&&linkedLeadStatus){
    const leadRows=await dbRequest('crm_leads',{query:{select:'id,name,status,broker_id,development_id,deleted_at',id:`eq.${saved.lead_id}`,limit:1}});const linkedLead=Array.isArray(leadRows)?leadRows[0]:null;
    if(linkedLead&&!linkedLead.deleted_at&&String(linkedLead.broker_id)===String(brokerId||'')&&linkedLead.status!==linkedLeadStatus){
      await dbRequest('crm_leads',{method:'PATCH',query:{id:`eq.${linkedLead.id}`,deleted_at:'is.null'},prefer:'return=minimal',body:{status:linkedLeadStatus,updated_at:stamp,updated_by:actor.id}});
      await dbRequest('crm_lead_events',{method:'POST',prefer:'return=minimal',body:{lead_id:linkedLead.id,at:stamp,actor_id:actor.id,actor_name:actor.name,actor_role:actor.role,event_type:'status_change',old_status:linkedLead.status,new_status:linkedLeadStatus,broker_id:linkedLead.broker_id,development_id:linkedLead.development_id}});
      await audit(actor,'lead.status_from_appointment','lead',linkedLead.id,['status'],{status:linkedLead.status},{status:linkedLeadStatus,appointmentId:saved.id});
    }
  }
  return { ok: true, appointmentId: saved.id, message: (existing ? 'Agendamento atualizado.' : 'Agendamento criado. Os números de produção continuam sendo lançados manualmente pelo corretor.') + (notificationSaved ? '' : ' O agendamento foi salvo; a notificação interna será sincronizada na próxima atualização.') };
}
async function apiArchiveAppointment(token, appointmentId) {
  const actor = await verifyActor(token); requireScheduleAccess(actor);
  if (!isUuid(appointmentId)) return { ok: false, message: 'Agendamento inválido.' };
  const rows = await dbRequest('crm_appointments', { query: { select: '*', id: `eq.${appointmentId}`, deleted_at: 'is.null', limit: 1 } });
  const current = Array.isArray(rows) ? rows[0] : null;
  if (!current) return { ok: false, message: 'Agendamento não encontrado.' };
  if (!managerCanSeeAllSchedules(actor) && String(current.broker_id) !== String(actor.id)) throw new HttpError(403, 'Você só pode cancelar seus próprios atendimentos.');
  const stamp = now();
  const updatedRows = await dbRequest('crm_appointments', { method: 'PATCH', query: { id: `eq.${appointmentId}`, deleted_at: 'is.null' }, prefer: 'return=representation', body: { status: 'Cancelado', updated_at: stamp, updated_by: actor.id } });
  if (!Array.isArray(updatedRows) || !updatedRows.length) return { ok: false, message: 'O atendimento foi alterado por outra pessoa. Atualize a agenda.' };
  const notificationSaved = await notifyAppointmentRecipients(updatedRows[0], 'appointment_cancelled');
  await audit(actor, 'appointment.cancel', 'appointment', appointmentId, ['status'], { status: current.status }, { status: 'Cancelado' }, 'operations');
  return { ok: true, message: 'Agendamento cancelado. O horário foi liberado.' + (notificationSaved ? '' : ' A notificação interna será sincronizada na próxima atualização.') };
}
async function apiListManagerLocations(token, filters = {}) {
  const actor = await verifyActor(token);
  const today = operationDateString(now());
  const from = String(filters.dateFrom || addDateOnly(today, -7));
  const to = String(filters.dateTo || addDateOnly(today, 60));
  if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to || daysBetweenDateOnly(from, to) > 180) throw new HttpError(400, 'Selecione um período válido de até 180 dias.');
  const start = brazilDateStartIso(from); const end = brazilDateEndIso(to);
  const [locations, users] = await Promise.all([
    listAll('crm_manager_locations', { select: '*', deleted_at: 'is.null', and: `(starts_at.gte.${start},starts_at.lte.${end})`, order: 'starts_at.asc' }),
    listAll('crm_users', { select: 'id,name,role' })
  ]);
  return (locations || []).map((row) => ({ id: row.id, managerId: row.manager_id, managerName: users.find((user) => user.id === row.manager_id)?.name || 'Gerente', location: row.location, startsAt: row.starts_at, endsAt: row.ends_at, notes: managerCanSeeAllSchedules(actor) ? row.notes || '' : '' }));
}
async function apiSaveManagerLocation(token, payload = {}) {
  const actor = await verifyActor(token);
  if (!(actor.role === 'Administrador' || isFinanceManager(actor))) throw new HttpError(403, 'Apenas gerente e assistente podem atualizar a agenda de localização do gerente.');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some((key)=>!['id','location','startsAt','endsAt','notes'].includes(key))) return {ok:false,message:'Dados de localização inválidos.'};
  const id = String(payload.id || '').trim(); const location = String(payload.location || '').trim().slice(0,180);
  const startsAt = timestamp(payload.startsAt, 'Data e horário inicial'); const endsAt = timestamp(payload.endsAt, 'Data e horário final');
  const notes = String(payload.notes || '').trim().slice(0,800);
  if (!location || Date.parse(endsAt) <= Date.parse(startsAt) || Date.parse(endsAt) - Date.parse(startsAt) > 24*60*60*1000) return { ok:false,message:'Informe local e período válido de até 24 horas.' };
  if (id && !isUuid(id)) return { ok:false,message:'Registro de localização inválido.' };
  const existingRows = id ? await dbRequest('crm_manager_locations',{query:{select:'*',id:`eq.${id}`,deleted_at:'is.null',limit:1}}) : [];
  const existing = Array.isArray(existingRows) ? existingRows[0] || null : null;
  if (id && !existing) return {ok:false,message:'Registro de localização não encontrado.'};
  if(existing&&actor.role==='Gerente'&&String(existing.manager_id)!==String(actor.id))throw new HttpError(403,'Você só pode alterar a própria agenda de localização.');
  const managerRows=actor.role==='Gerente'?[]:await listAll('crm_users',{select:'id,name,role,active,deleted_at',role:'eq.Gerente',active:'eq.true',deleted_at:'is.null'});
  const managerId=existing?existing.manager_id:actor.role==='Gerente'?actor.id:(managerRows||[])[0]?.id;
  if(!managerId)return{ok:false,message:'Cadastre ou ative o perfil da gerente antes de publicar a localização.'};
  const localStartDate=operationDateString(Date.parse(startsAt));const dayStart=brazilDateStartIso(addDateOnly(localStartDate,-1));const dayEnd=brazilDateEndIso(addDateOnly(localStartDate,1));
  const activeLocations=await listAll('crm_manager_locations',{select:'id,manager_id,starts_at,ends_at,deleted_at',deleted_at:'is.null',and:`(starts_at.gte.${dayStart},starts_at.lte.${dayEnd})`});
  const collision=(activeLocations||[]).find((row)=>String(row.id)!==id&&String(row.manager_id)===String(managerId)&&Date.parse(row.starts_at)<Date.parse(endsAt)&&Date.parse(row.ends_at)>Date.parse(startsAt));
  if(collision)return{ok:false,message:'Este período já está ocupado na agenda do gerente. Escolha outro horário.'};
  const stamp=now();const values={manager_id:managerId,location,starts_at:startsAt,ends_at:endsAt,notes,updated_at:stamp,updated_by:actor.id};
  const response=existing?await dbRequest('crm_manager_locations',{method:'PATCH',query:{id:`eq.${id}`,deleted_at:'is.null'},prefer:'return=representation',body:values}):await dbRequest('crm_manager_locations',{method:'POST',prefer:'return=representation',body:{...values,created_by:actor.id,created_at:stamp}});
  const saved=Array.isArray(response)?response[0]:null;if(!saved)throw new HttpError(502,'Não foi possível salvar a agenda do gerente.');
  const before=existing?{location:existing.location,startsAt:existing.starts_at,endsAt:existing.ends_at,notes:existing.notes}:{};const after={location,startsAt,endsAt,notes};
  await audit(actor,existing?'manager_location.update':'manager_location.create','manager_location',saved.id,auditChangedFields(before,after),before,after,'operations');
  return{ok:true,message:existing?'Agenda do gerente atualizada.':'Localização do gerente cadastrada.'};
}

async function apiArchiveManagerLocation(token, locationId) {
  const actor=await verifyActor(token);
  if(!(actor.role==='Administrador'||isFinanceManager(actor)))throw new HttpError(403,'Apenas gerente e assistente podem remover uma localização do gerente.');
  if(!isUuid(locationId))return{ok:false,message:'Registro de localização inválido.'};
  const rows=await dbRequest('crm_manager_locations',{query:{select:'*',id:`eq.${locationId}`,deleted_at:'is.null',limit:1}});const current=Array.isArray(rows)?rows[0]:null;
  if(!current)return{ok:false,message:'Localização não encontrada.'};
  if(actor.role==='Gerente'&&String(current.manager_id)!==String(actor.id))throw new HttpError(403,'Você só pode remover a própria agenda de localização.');
  const stamp=now();const updated=await dbRequest('crm_manager_locations',{method:'PATCH',query:{id:`eq.${locationId}`,deleted_at:'is.null'},prefer:'return=representation',body:{deleted_at:stamp,deleted_by:actor.id,updated_at:stamp,updated_by:actor.id}});
  if(!Array.isArray(updated)||!updated.length)return{ok:false,message:'A localização foi alterada por outra pessoa. Atualize a tela.'};
  await audit(actor,'manager_location.archive','manager_location',locationId,['deletedAt'],{deletedAt:null},{deletedAt:stamp,location:current.location},'operations');
  return{ok:true,message:'Localização removida da agenda; o registro permanece no histórico.'};
}

async function apiCreateComplaint(token, payload = {}) {
  const actor=await verifyActor(token);if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some((key)=>!['category','message','anonymous'].includes(key)))return{ok:false,message:'Dados da manifestação inválidos.'};const category=String(payload.category||'');const message=String(payload.message||'').trim();if(payload.anonymous!==undefined&&typeof payload.anonymous!=='boolean')return{ok:false,message:'A opção de anonimato precisa ser válida.'};const anonymous=payload.anonymous===true;
  if(!['Reclamação','Sugestão','Dúvida','Solicitação de treinamento'].includes(category))return{ok:false,message:'Selecione uma categoria válida.'};
  if(message.length<10||message.length>5000)return{ok:false,message:'A manifestação deve ter entre 10 e 5.000 caracteres.'};
  const stamp=now();const response=await dbRequest('crm_complaints',{method:'POST',prefer:'return=representation',body:{category,message,anonymous,author_id:anonymous?null:actor.id,status:'Nova',management_response:'',created_at:stamp,updated_at:stamp,updated_by:null}});
  const saved=Array.isArray(response)?response[0]:null;if(!saved)throw new HttpError(502,'Não foi possível enviar sua manifestação.');
  if(!anonymous)await audit(actor,'complaint.create','complaint',saved.id,['category','message','anonymous'],{}, {category,message,anonymous},'crm');
  return{ok:true,anonymous,message:anonymous?'Manifestação anônima enviada. Nenhum nome ou e-mail foi vinculado ao registro.':'Manifestação enviada. Você poderá acompanhar a resposta na Ouvidoria.'};
}
async function apiListComplaints(token) {
  const actor=await verifyActor(token);const management=actor.role==='Administrador'||isFinanceManager(actor);
  const query={select:'*',order:'created_at.desc',limit:500};
  if(!management){query.anonymous='eq.false';query.author_id=`eq.${actor.id}`;}
  const rows=await listAll('crm_complaints',query);const users=management?await listAll('crm_users',{select:'id,name,role'}):[];
  return(rows||[]).filter((row)=>management||(!row.anonymous&&String(row.author_id)===String(actor.id))).map((row)=>({id:row.id,category:row.category,message:row.message,anonymous:row.anonymous===true,authorName:row.anonymous?'Manifestação anônima':users.find((user)=>user.id===row.author_id)?.name||'Você',status:row.status,managementResponse:row.management_response||'',createdAt:row.created_at,updatedAt:row.updated_at}));
}
async function apiUpdateComplaint(token, complaintId, payload = {}) {
  const actor=await verifyActor(token);if(!(actor.role==='Administrador'||isFinanceManager(actor)))throw new HttpError(403,'A ouvidoria só pode ser administrada pela gerente e pela assistente.');
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some((key)=>!['status','managementResponse'].includes(key)))return{ok:false,message:'Dados de atualização inválidos.'};
  if(!isUuid(complaintId))return{ok:false,message:'Manifestação inválida.'};const status=String(payload.status||'');const responseText=String(payload.managementResponse||'').trim().slice(0,3000);
  if(!['Nova','Em análise','Respondida','Arquivada'].includes(status))return{ok:false,message:'Selecione uma situação válida.'};
  if(status==='Respondida'&&!responseText)return{ok:false,message:'Informe a resposta da gestão antes de marcar como respondida.'};
  const rows=await dbRequest('crm_complaints',{query:{select:'*',id:`eq.${complaintId}`,limit:1}});const current=Array.isArray(rows)?rows[0]:null;if(!current)return{ok:false,message:'Manifestação não encontrada.'};
  const stamp=now();await dbRequest('crm_complaints',{method:'PATCH',query:{id:`eq.${complaintId}`},prefer:'return=minimal',body:{status,management_response:responseText,updated_at:stamp,updated_by:actor.id}});
  const before={status:current.status,managementResponse:current.management_response||''};const after={status,managementResponse:responseText};await audit(actor,'complaint.update','complaint',complaintId,auditChangedFields(before,after),before,after,'crm');
  return{ok:true,message:'Manifestação atualizada.'};
}

function vgvPeriodRange(filters={}) {
  const today=operationDateString(now());const selectedMonth=String(filters.month||'').trim();const period=String(filters.period||'month');let start='',end=today;
  if(selectedMonth){
    if(!/^\d{4}-\d{2}$/.test(selectedMonth))throw new HttpError(400,'Selecione um mês válido para consultar o VGV.');
    const [year,month]=selectedMonth.split('-').map(Number);if(month<1||month>12)throw new HttpError(400,'Selecione um mês válido para consultar o VGV.');
    start=`${selectedMonth}-01`;if(start>today)throw new HttpError(400,'Não é possível consultar meses futuros.');end=monthEndDateOnly(start);if(end>today)end=today;
    return{period:'month',month:selectedMonth,start,end,yearStart:`${year}-01-01`,yearEnd:`${year}-12-31`};
  }
  const customFrom=String(filters.dateFrom||'').trim();const customTo=String(filters.dateTo||'').trim();
  if(customFrom||customTo){start=customFrom||customTo;end=customTo||today;if(!isValidDateOnly(start)||!isValidDateOnly(end)||start>end||end>today||daysBetweenDateOnly(start,end)>366)throw new HttpError(400,'Informe um intervalo válido de até 366 dias, sem datas futuras.');}
  else {const [year,month]=today.split('-').map(Number);if(period==='quarter'){const firstMonth=Math.floor((month-1)/3)*3+1;start=`${year}-${String(firstMonth).padStart(2,'0')}-01`;}else if(period==='semester'){const firstMonth=month<=6?1:7;start=`${year}-${String(firstMonth).padStart(2,'0')}-01`;}else if(period==='year'){start=`${year}-01-01`;}else{start=`${today.slice(0,7)}-01`;}}
  const selectedYear=start.slice(0,4);return{period,start,end,month:start.slice(0,7),yearStart:`${selectedYear}-01-01`,yearEnd:`${selectedYear}-12-31`};
}
function salesIsCancelled(row) { if (row && (row.deleted_at || row.deletedAt)) return true; const normalize=(value)=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();const phase=normalize(row.repass_status);const saleStatus=normalize(row.sale_status);return saleStatus.includes('CANCEL')||saleStatus.includes('DISTRATO')||phase==='CANCELADO'||phase.includes('DISTRATO'); }
async function applyCancelledSalesToProduction(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  const entryIds = [...new Set(rows.map((row) => String(row && row.id || '')).filter(isUuid))];
  if (!entryIds.length) return rows.map((row) => ({ ...row, reported_sale_count: Number(row.sale_count || 0), linked_cancelled_sales: 0 }));
  const links = await listAll('crm_production_sale_links', {
    select: 'production_entry_id,sale_id', unlinked_at: 'is.null', production_entry_id: `in.(${entryIds.join(',')})`
  });
  const activeLinks = Array.isArray(links) ? links : [];
  const saleIds = [...new Set(activeLinks.map((link) => String(link.sale_id || '')).filter(isUuid))];
  if (!saleIds.length) return rows.map((row) => ({ ...row, reported_sale_count: Number(row.sale_count || 0), linked_cancelled_sales: 0 }));
  const sales = await listAll('crm_sales', { select: 'id,sale_status,repass_status,deleted_at', id: `in.(${saleIds.join(',')})` });
  const cancelledSaleIds = new Set((sales || []).filter(salesIsCancelled).map((sale) => String(sale.id)));
  const cancelledByEntry = new Map();
  activeLinks.forEach((link) => {
    if (!cancelledSaleIds.has(String(link.sale_id))) return;
    const entryId = String(link.production_entry_id);
    cancelledByEntry.set(entryId, (cancelledByEntry.get(entryId) || 0) + 1);
  });
  return rows.map((row) => {
    const reported = Number(row.sale_count || 0);
    const linkedCancelled = Math.min(reported, cancelledByEntry.get(String(row.id)) || 0);
    return { ...row, reported_sale_count: reported, linked_cancelled_sales: linkedCancelled, sale_count: Math.max(0, reported - linkedCancelled) };
  });
}
function normalizeProductionSaleDays(days) {
  const unique = new Map();
  (Array.isArray(days) ? days : []).forEach((item) => {
    const brokerId = String(item && item.brokerId || '').trim();
    const workDate = String(item && item.workDate || '').trim();
    if (!isUuid(brokerId) || !isValidDateOnly(workDate)) return;
    unique.set(`${brokerId}|${workDate}`, { brokerId, workDate });
  });
  return [...unique.values()];
}
async function syncProductionSales(days, actor) {
  const normalizedDays = normalizeProductionSaleDays(days);
  if (!normalizedDays.length) return [];
  const response = await dbRequest('rpc/crm_sync_production_sales_batch', {
    method: 'POST', body: { p_days: normalizedDays, p_actor_id: actor.id }
  });
  const result = Array.isArray(response) ? response[0] : response;
  if (!result || result.ok !== true) throw new HttpError(502, 'Não foi possível relacionar as vendas aos lançamentos de produção.');
  const links = Array.isArray(result.links) ? result.links : [];
  for (const link of links) {
    await audit(actor, 'sale.production.link', 'sale', link.saleId, ['productionEntryId'],
      { productionEntryId: null }, { productionEntryId: link.productionEntryId, linkedAt: link.createdAt || now() }, 'operations');
  }
  return links;
}
async function getActiveProductionSaleLink(saleId) {
  const rows = await dbRequest('crm_production_sale_links', { query: {
    select: 'id,sale_id,production_entry_id,created_at', sale_id: `eq.${saleId}`, unlinked_at: 'is.null', limit: 1
  } });
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function unlinkProductionSale(saleId, actor) {
  const existing = await getActiveProductionSaleLink(saleId);
  if (!existing) return null;
  const stamp = now();
  const updated = await dbRequest('crm_production_sale_links', { method: 'PATCH',
    query: { id: `eq.${existing.id}`, unlinked_at: 'is.null' }, prefer: 'return=representation',
    body: { unlinked_at: stamp, unlinked_by: actor.id }
  });
  const saved = Array.isArray(updated) ? updated[0] || null : null;
  if (!saved) return null;
  await audit(actor, 'sale.production.unlink', 'sale', saleId, ['productionEntryId','unlinkedAt'],
    { productionEntryId: existing.production_entry_id, unlinkedAt: null },
    { productionEntryId: existing.production_entry_id, unlinkedAt: stamp }, 'operations');
  return existing;
}
async function reconcileSaleProduction(sale, previous, actor) {
  const moved = previous && (String(previous.broker_id) !== String(sale.broker_id) || String(previous.sold_at) !== String(sale.sold_at));
  let oldLink = null;
  if (moved) oldLink = await unlinkProductionSale(sale.id, actor);
  const days = [];
  if (moved && oldLink) days.push({ brokerId: previous.broker_id, workDate: previous.sold_at });
  days.push({ brokerId: sale.broker_id, workDate: sale.sold_at });
  await syncProductionSales(days, actor);
  return getActiveProductionSaleLink(sale.id);
}
function saleProductionAdjustmentNotice(sale, previous, link, syncFailed = false) {
  const isCancelled = salesIsCancelled(sale);
  const wasCancelled = previous ? salesIsCancelled(previous) : false;
  if (syncFailed) return ' A venda foi salva, mas o vínculo com a produção não pôde ser atualizado; revise a produção antes de concluir.';
  if (isCancelled && !link) return ' Não encontrei lançamento manual de produção correspondente para este corretor e esta data; confira a contagem para garantir o abatimento.';
  if (isCancelled && !wasCancelled && link) return ' O cancelamento, distrato ou arquivamento foi vinculado e já será descontado das vendas válidas, metas e ranking; o valor manual original permanece preservado.';
  if (!isCancelled && wasCancelled && link) return ' A venda voltou a ser válida e retornará aos totais, metas e ranking do lançamento vinculado.';
  return '';
}
function healthBand(days) { return days<=30?{id:'green',label:'Verde · saudável'}:days<=50?{id:'yellow',label:'Amarela · atenção'}:days<=70?{id:'orange',label:'Laranja · perigo'}:{id:'red',label:'Vermelha · crítico'}; }
function calculateSalesHealth(asOf, brokers, validSales) {
  const rows=brokers.filter((user)=>String(user.created_at||'').slice(0,10)<=asOf).map((user)=>{
    const latest=validSales.filter((sale)=>String(sale.broker_id)===String(user.id)&&String(sale.sold_at)<=asOf).sort((a,b)=>String(b.sold_at).localeCompare(String(a.sold_at)))[0];
    const baseline=latest?String(latest.sold_at):String(user.created_at||'').slice(0,10);const days=baseline?Math.max(0,daysBetweenDateOnly(baseline,asOf)-1):0;return{id:user.id,name:user.name,lastSaleDate:latest?latest.sold_at:'',joinedOn:String(user.created_at||'').slice(0,10),daysWithoutSale:days,band:healthBand(days)};
  });
  const average=rows.length?Math.round(rows.reduce((sum,row)=>sum+row.daysWithoutSale,0)/rows.length*10)/10:0;
  const distribution={green:0,yellow:0,orange:0,red:0};rows.forEach((row)=>distribution[row.band.id]++);
  return{rows:rows.sort((a,b)=>b.daysWithoutSale-a.daysWithoutSale||a.name.localeCompare(b.name,'pt-BR')),average,band:healthBand(average),distribution,total:rows.length};
}
async function apiGetSalesHealthDashboard(token, filters = {}) {
  const actor=await verifyActor(token);if(!isFinanceManager(actor))throw new HttpError(403,'O painel financeiro e de dias sem venda é exclusivo da gerente e da assistente.');
  const range=vgvPeriodRange(filters);const brokerId=String(filters.brokerId||'').trim();const developmentId=String(filters.developmentId||'').trim();
  if(brokerId&&!isUuid(brokerId))throw new HttpError(400,'Corretor inválido.');
  const [sales,users,developments]=await Promise.all([listAll('crm_sales',{select:'*',deleted_at:'is.null'}),listAll('crm_users',{select:'id,name,role,active,deleted_at,created_at'}),listAll('crm_developments',{select:'id,name'})]);
  const validSales=(sales||[]).filter((sale)=>!salesIsCancelled(sale));const matchingFilters=validSales.filter((sale)=>(!brokerId||String(sale.broker_id)===brokerId)&&(!developmentId||String(sale.development_id)===developmentId));const filtered=matchingFilters.filter((sale)=>sale.sold_at>=range.start&&sale.sold_at<=range.end);const yearSales=matchingFilters.filter((sale)=>sale.sold_at>=range.yearStart&&sale.sold_at<=range.yearEnd);
  const userById=new Map((users||[]).map((user)=>[String(user.id),user]));const developmentById=new Map((developments||[]).map((item)=>[String(item.id),item.name]));
  const byBroker=new Map();const byDevelopment=new Map();const byMonth=new Map();let vgv=0;let annualVgv=0;
  for(const sale of filtered){const value=Number(sale.unit_value||0);vgv+=value;const user=userById.get(String(sale.broker_id));const broker=byBroker.get(String(sale.broker_id))||{brokerId:sale.broker_id,name:user?user.name:'Corretor inativo',sales:0,vgv:0};broker.sales++;broker.vgv+=value;byBroker.set(String(sale.broker_id),broker);const name=developmentById.get(String(sale.development_id))||'Empreendimento não informado';const dev=byDevelopment.get(name)||{name,sales:0,vgv:0};dev.sales++;dev.vgv+=value;byDevelopment.set(name,dev);}
  for(const sale of yearSales){const value=Number(sale.unit_value||0);annualVgv+=value;const month=String(sale.sold_at).slice(0,7);byMonth.set(month,(byMonth.get(month)||0)+value);}
  const currentDate=operationDateString(now());const activeBrokers=(users||[]).filter((user)=>user.role==='Corretor'&&user.active===true&&!user.deleted_at);const health=calculateSalesHealth(currentDate,activeBrokers,validSales);const previousHealth=calculateSalesHealth(addDateOnly(currentDate,-7),activeBrokers,validSales);
  const trend=[];let weekStart=addDateOnly(currentDate,-77);const dayOfWeek=new Date(`${weekStart}T00:00:00Z`).getUTCDay();weekStart=addDateOnly(weekStart,-((dayOfWeek+6)%7));
  for(let week=0;week<12;week++){const monday=addDateOnly(weekStart,week*7);const sunday=addDateOnly(monday,6);const asOf=sunday>currentDate?currentDate:sunday;const snapshot=calculateSalesHealth(asOf,activeBrokers,validSales);trend.push({weekStart:monday,asOf,average:snapshot.average,band:snapshot.band.id});}
  const sorted=[...byBroker.values()].map((item)=>({...item,vgv:Math.round(item.vgv*100)/100})).sort((a,b)=>b.vgv-a.vgv);
  const healthRows=health.rows.map((row)=>({...row,alert:row.daysWithoutSale>=31}));
  const messages=healthRows.filter((row)=>row.alert).map((row)=>({brokerId:row.id,name:row.name,daysWithoutSale:row.daysWithoutSale,band:row.band,message:`${row.name}: ${row.daysWithoutSale} dia(s) corrido(s) sem venda · ${row.band.label}.`}));
  const trendDirection=health.average<previousHealth.average?'melhorando':health.average>previousHealth.average?'piorando':'estável';
  return{period:range,totals:{vgv:Math.round(vgv*100)/100,annualVgv:Math.round(annualVgv*100)/100,sales:filtered.length},byBroker:sorted.map((item)=>({...item,vgv:Math.round(item.vgv*100)/100})),byDevelopment:[...byDevelopment.values()].map((item)=>({...item,vgv:Math.round(item.vgv*100)/100})).sort((a,b)=>b.vgv-a.vgv),monthly:[...byMonth.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([month,value])=>({month,vgv:Math.round(value*100)/100})),health:{...health,rows:healthRows,previousAverage:previousHealth.average,improved:trendDirection==='melhorando',trendDirection,trend,alerts:messages}};
}

async function apiListOperationBrokers(token) {
  const actor = await verifyActor(token);
  requireOperationsAccess(actor);
  const query = { select: 'id,name,role,active,deleted_at', role: 'eq.Corretor', deleted_at: 'is.null', order: 'name.asc' };
  if (operationsAccessOf(actor) === 'broker') query.id = `eq.${actor.id}`;
  const rows = await listAll('crm_users', query);
  return (rows || []).map((row) => ({ id: row.id, name: row.name, active: row.active === true }));
}

async function apiListProduction(token, filters = {}) {
  const actor = await verifyActor(token); requireOperationsAccess(actor);
  const range = operationsDateRange(filters || {});
  const access = operationsAccessOf(actor);
  const brokerId = access === 'broker' ? actor.id : (isUuid(filters && filters.brokerId) ? String(filters.brokerId) : '');
  const query = rangeQuery('work_date', range.start, range.end);
  if (brokerId) query.broker_id = `eq.${brokerId}`;
  const [rows, users] = await Promise.all([listAll('crm_production_entries', query), listAll('crm_users', { select: '*' })]);
  const mappedUsers = users.map(mapUser);
  const adjustedRows = await applyCancelledSalesToProduction(rows || []);
  return adjustedRows.map((row) => ({
    id: row.id, brokerId: row.broker_id, brokerName: operationsUserSummary(row.broker_id, mappedUsers).name,
    workDate: row.work_date, ...metricValuesFromRow(row), reportedSales: Number(row.reported_sale_count || 0),
    linkedCancelledSales: Number(row.linked_cancelled_sales || 0), notes: row.notes || '', createdAt: row.created_at,
    createdBy: row.created_by, updatedAt: row.updated_at, updatedBy: row.updated_by,
    deletedAt: row.deleted_at || ''
  })).sort((a,b) => String(b.workDate).localeCompare(String(a.workDate)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function parseOperationCount(value, label) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 1000000) throw new HttpError(400, `${label} deve ser um número inteiro entre 0 e 1.000.000.`);
  return count;
}
async function getActiveBroker(brokerId) {
  if (!isUuid(brokerId)) throw new HttpError(400, 'Selecione um corretor válido.');
  const broker = await getProfile(String(brokerId));
  if (!broker || broker.active !== true || broker.deleted_at || broker.role !== 'Corretor') throw new HttpError(400, 'O corretor selecionado não está ativo.');
  return mapUser(broker);
}
function productionValues(payload) {
  return {
    prospecting_count: parseOperationCount(payload.prospections, 'Prospecções'),
    interaction_count: parseOperationCount(payload.interactions, 'Interações'),
    appointment_count: parseOperationCount(payload.appointments, 'Agendamentos'),
    visit_count: parseOperationCount(payload.visits, 'Visitas'),
    sale_count: parseOperationCount(payload.sales, 'Vendas'),
    folder_count: parseOperationCount(payload.folders === undefined || payload.folders === null || payload.folders === '' ? 0 : payload.folders, 'Pastas encaminhadas'),
    notes: String(payload.notes || '').trim().slice(0, 1500)
  };
}
function productionAuditValues(row) {
  return row ? { brokerId: row.broker_id, workDate: row.work_date, ...metricValuesFromRow(row), notes: row.notes || '' } : {};
}

async function apiSaveProduction(token, payload = {}) {
  const actor = await verifyActor(token); requireOperationsAccess(actor, ['broker','manager']);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const access = operationsAccessOf(actor);
  const id = String(payload.id || '').trim();
  const brokerId = access === 'broker' ? actor.id : String(payload.brokerId || '').trim();
  const broker = await getActiveBroker(brokerId);
  const workDate = String(payload.workDate || '').trim();
  const today = operationDateString(now());
  if (!isValidDateOnly(workDate) || workDate > today) return { ok: false, message: 'Informe uma data válida, até o dia de hoje.' };
  const monthStart = today.slice(0, 7) + '-01';
  if (access === 'broker' && workDate < monthStart) return { ok: false, message: 'Corretores podem registrar ou corrigir lançamentos somente dentro do mês vigente.' };
  const values = productionValues(payload);
  const stamp = now();
  let beforeRow = null; let saved;
  if (id) {
    if (!isUuid(id)) return { ok: false, message: 'Lançamento inválido.' };
    const oldRows = await dbRequest('crm_production_entries', { query: { select: '*', id: `eq.${id}`, deleted_at: 'is.null', limit: 1 } });
    beforeRow = Array.isArray(oldRows) ? oldRows[0] || null : null;
    if (!beforeRow) return { ok: false, message: 'Lançamento não encontrado ou já cancelado.' };
    if (access !== 'manager' && String(beforeRow.broker_id) !== String(actor.id)) throw new HttpError(403, 'Você só pode editar os próprios lançamentos.');
    if (access === 'broker' && String(brokerId) !== String(actor.id)) throw new HttpError(403, 'Você só pode lançar em seu próprio nome.');
    if (access === 'manager' && String(brokerId) !== String(beforeRow.broker_id)) return { ok: false, message: 'Não é possível transferir um lançamento para outro corretor. Edite os dados mantendo o responsável original.' };
    const after = { broker_id: beforeRow.broker_id, work_date: workDate, ...values, updated_at: stamp, updated_by: actor.id };
    const result = await dbRequest('crm_production_entries', { method: 'PATCH', query: { id: `eq.${id}`, deleted_at: 'is.null' }, prefer: 'return=representation', body: after });
    saved = Array.isArray(result) ? result[0] : null;
    if (!saved) return { ok: false, message: 'O lançamento mudou enquanto era editado. Atualize a lista e tente novamente.' };
  } else {
    const result = await dbRequest('crm_production_entries', { method: 'POST', prefer: 'return=representation', body: { broker_id: broker.id, work_date: workDate, ...values, created_at: stamp, created_by: actor.id, updated_at: stamp, updated_by: actor.id } });
    saved = Array.isArray(result) ? result[0] : null;
  }
  const beforeValues = productionAuditValues(beforeRow); const afterValues = productionAuditValues(saved);
  await audit(actor, id ? 'operations.production.update' : 'operations.production.create', 'operation_production', saved && saved.id || id || 'unknown', auditChangedFields(beforeValues, afterValues), beforeValues, afterValues, 'operations');
  let syncWarning = '';
  try {
    const syncDays = [{ brokerId: saved.broker_id, workDate: saved.work_date }];
    if (beforeRow && String(beforeRow.work_date) !== String(saved.work_date)) {
      const existingLinks = await listAll('crm_production_sale_links', {
        select: 'sale_id', production_entry_id: `eq.${saved.id}`, unlinked_at: 'is.null'
      });
      for (const link of existingLinks || []) await unlinkProductionSale(String(link.sale_id), actor);
      syncDays.push({ brokerId: beforeRow.broker_id, workDate: beforeRow.work_date });
    }
    await syncProductionSales(syncDays, actor);
  }
  catch (_) { syncWarning = ' A venda informada foi salva, mas os vínculos de vendas para cancelamentos ainda não puderam ser atualizados.'; }
  return { ok: true, id: saved && saved.id, message: (id ? 'Lançamento atualizado; a alteração ficou registrada no histórico.' : 'Lançamento de produção registrado.') + syncWarning };
}

async function apiArchiveProduction(token, entryId) {
  const actor = await verifyActor(token); requireOperationsAccess(actor, ['broker','manager']);
  if (!isUuid(entryId)) return { ok: false, message: 'Lançamento inválido.' };
  const rows = await dbRequest('crm_production_entries', { query: { select: '*', id: `eq.${entryId}`, deleted_at: 'is.null', limit: 1 } });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ok: false, message: 'Lançamento não encontrado ou já cancelado.' };
  if (!isOperationsManager(actor) && String(row.broker_id) !== String(actor.id)) throw new HttpError(403, 'Você só pode cancelar os próprios lançamentos.');
  const stamp = now();
  const updated = await dbRequest('crm_production_entries', { method: 'PATCH', query: { id: `eq.${entryId}`, deleted_at: 'is.null' }, prefer: 'return=representation', body: { deleted_at: stamp, deleted_by: actor.id, updated_at: stamp, updated_by: actor.id } });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'O lançamento já foi alterado. Atualize a lista e tente novamente.' };
  const beforeValues = productionAuditValues(row); const afterValues = { ...beforeValues, deletedAt: stamp };
  await audit(actor, 'operations.production.cancel', 'operation_production', entryId, ['deletedAt'], beforeValues, afterValues, 'operations');
  let syncWarning = '';
  try {
    const links = await listAll('crm_production_sale_links', { select: 'sale_id', production_entry_id: `eq.${entryId}`, unlinked_at: 'is.null' });
    for (const link of links || []) await unlinkProductionSale(String(link.sale_id), actor);
    await syncProductionSales([{ brokerId: row.broker_id, workDate: row.work_date }], actor);
  } catch (_) { syncWarning = ' Os vínculos de vendas também devem ser conferidos ao revisar a produção.'; }
  return { ok: true, message: 'Lançamento cancelado e preservado no histórico.' + syncWarning };
}

async function apiListOperationGoals(token, filters = {}) {
  const actor = await verifyActor(token); requireOperationsAccess(actor);
  const access = operationsAccessOf(actor);
  const query = { select: '*', order: 'starts_on.desc,revision.desc' };
  if (access === 'broker') query.broker_id = `eq.${actor.id}`;
  else if (filters && isUuid(filters.brokerId)) query.broker_id = `eq.${filters.brokerId}`;
  if (filters && ['weekly','monthly'].includes(filters.cycle)) query.cycle = `eq.${filters.cycle}`;
  const [rows, users] = await Promise.all([listAll('crm_production_goals', query), listAll('crm_users', { select: '*' })]);
  const mappedUsers = users.map(mapUser);
  return (rows || []).map((row) => ({ id: row.id, brokerId: row.broker_id, brokerName: operationsUserSummary(row.broker_id, mappedUsers).name, metric: row.metric, cycle: row.cycle, startsOn: row.starts_on, endsOn: row.ends_on, target: Number(row.target_count), revision: Number(row.revision), supersedesId: row.supersedes_id || '', isCurrent: row.is_current === true, createdAt: row.created_at, createdBy: row.created_by }));
}

async function apiSaveOperationGoal(token, payload = {}) {
  const actor = await verifyActor(token); requireOperationsAccess(actor, ['manager']);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const broker = await getActiveBroker(String(payload.brokerId || ''));
  const metric = String(payload.metric || ''); const cycle = String(payload.cycle || '');
  const referenceDate = String(payload.referenceDate || '').trim();
  const target = parseOperationCount(payload.target, 'Meta');
  if (target < 1) return { ok: false, message: 'A meta precisa ser maior que zero.' };
  if (!['prospections','visits','sales'].includes(metric)) return { ok: false, message: 'Indicador de meta inválido.' };
  if (!['weekly','monthly'].includes(cycle)) return { ok: false, message: 'Selecione o ciclo semanal ou mensal.' };
  if (!isValidDateOnly(referenceDate)) return { ok: false, message: 'Informe uma data de referência válida.' };
  let startsOn; let endsOn;
  if (cycle === 'weekly') {
    const weekday = new Date(`${referenceDate}T00:00:00Z`).getUTCDay();
    startsOn = addDateOnly(referenceDate, -((weekday + 6) % 7)); endsOn = addDateOnly(startsOn, 6);
  } else {
    startsOn = `${referenceDate.slice(0,7)}-01`; endsOn = monthEndDateOnly(referenceDate);
  }
  const previousRows = await dbRequest('crm_production_goals', { query: { select: '*', broker_id: `eq.${broker.id}`, metric: `eq.${metric}`, cycle: `eq.${cycle}`, starts_on: `eq.${startsOn}`, ends_on: `eq.${endsOn}`, is_current: 'eq.true', limit: 1 } });
  const previous = Array.isArray(previousRows) ? previousRows[0] || null : null;
  const result = await dbRequest('rpc/crm_save_operation_goal', { method: 'POST', body: { p_broker_id: broker.id, p_metric: metric, p_cycle: cycle, p_starts_on: startsOn, p_ends_on: endsOn, p_target_count: target, p_actor_id: actor.id } });
  const saved = Array.isArray(result) ? result[0] : result;
  if (!saved || !saved.id) throw new HttpError(502, 'Não foi possível salvar a revisão da meta.');
  const beforeValues = previous ? { target: previous.target_count, revision: previous.revision, isCurrent: previous.is_current } : {};
  const afterValues = { brokerId: broker.id, metric, cycle, startsOn, endsOn, target, revision: Number(saved.revision), isCurrent: true };
  await audit(actor, 'operations.goal.revise', 'operation_goal', saved.id, auditChangedFields(beforeValues, afterValues), beforeValues, afterValues, 'operations');
  return { ok: true, goalId: saved.id, revision: Number(saved.revision), message: `Meta salva para ${broker.name}; versão ${saved.revision} preservada no histórico.` };
}

async function apiSaveOperationGoalsBatch(token, payload = {}) {
  const actor = await verifyActor(token); requireOperationsAccess(actor, ['manager']);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const cycle = String(payload.cycle || ''); const referenceDate = String(payload.referenceDate || '');
  if (!['weekly','monthly'].includes(cycle) || !isValidDateOnly(referenceDate)) return { ok: false, message: 'Selecione um ciclo e uma data de referência válidos.' };
  let startsOn; let endsOn;
  if (cycle === 'weekly') {
    const weekday = new Date(`${referenceDate}T00:00:00Z`).getUTCDay();
    startsOn = addDateOnly(referenceDate, -((weekday + 6) % 7)); endsOn = addDateOnly(startsOn, 6);
  } else { startsOn = `${referenceDate.slice(0,7)}-01`; endsOn = monthEndDateOnly(referenceDate); }
  const users = await listAll('crm_users', { select: 'id,name,role,active,deleted_at' });
  const brokers = users.filter((row) => row.role === 'Corretor' && row.active === true && !row.deleted_at);
  if (!brokers.length) return { ok: false, message: 'Não há corretores ativos para configurar metas.' };
  const entries = Array.isArray(payload.goals) ? payload.goals : [];
  if (entries.length !== brokers.length) return { ok: false, message: 'A matriz precisa conter exatamente todos os corretores ativos. Atualize a tela e tente novamente.' };
  const byId = new Map(entries.map((entry) => [String(entry && entry.brokerId || ''), entry]));
  if (byId.size !== brokers.length || brokers.some((broker) => !byId.has(String(broker.id)))) return { ok: false, message: 'Cada corretor ativo deve aparecer uma única vez na matriz.' };
  const goals = [];
  for (const broker of brokers) {
    const entry = byId.get(String(broker.id));
    const metrics = entry && entry.targets && typeof entry.targets === 'object' ? entry.targets : {};
    for (const [metric, key] of [['prospections','prospections'],['visits','visits'],['sales','sales']]) {
      const target = parseOperationCount(metrics[key], `Meta de ${key}`);
      if (target < 1) return { ok: false, message: `A meta de ${key} para ${broker.name} deve ser maior que zero.` };
      goals.push({ broker_id: broker.id, metric, cycle, starts_on: startsOn, ends_on: endsOn, target_count: target });
    }
  }
  const previousRows = await listAll('crm_production_goals', { select: 'broker_id,metric,target_count,revision,is_current', cycle: `eq.${cycle}`, starts_on: `eq.${startsOn}`, ends_on: `eq.${endsOn}`, is_current: 'eq.true' });
  const response = await dbRequest('rpc/crm_save_operation_goals_batch', { method: 'POST', body: { p_goals: goals, p_actor_id: actor.id } });
  const result = Array.isArray(response) ? response[0] : response;
  if (!result || !result.results) throw new HttpError(502, 'Não foi possível salvar a matriz de metas. Nenhuma meta deve ser considerada atualizada.');
  const previous = (previousRows || []).map((item) => ({ brokerId: item.broker_id, metric: item.metric, target: Number(item.target_count), revision: Number(item.revision) }));
  const after = goals.map((item) => ({ brokerId: item.broker_id, metric: item.metric, target: Number(item.target_count), cycle, startsOn, endsOn }));
  await audit(actor, 'operations.goal.batch_revise', 'operation_goal_batch', `${cycle}:${startsOn}`, ['targets'], { targets: previous }, { targets: after, revisions: result.results });
  return { ok: true, count: goals.length, message: `Metas de ${brokers.length} corretor(es) atualizadas em uma única operação. As versões anteriores foram preservadas.` };
}

async function apiDeleteOperationGoal(token, goalId) {
  const actor = await verifyActor(token); requireOperationsAccess(actor, ['manager']);
  if (!isUuid(goalId)) return { ok: false, message: 'Meta inválida.' };
  const rows = await dbRequest('crm_production_goals', { query: { select: 'id,broker_id,metric,cycle,starts_on,ends_on', id: `eq.${goalId}`, limit: 1 } });
  const goal = Array.isArray(rows) ? rows[0] || null : null;
  if (!goal) return { ok: false, message: 'Meta não encontrada.' };
  const result = await dbRequest('rpc/crm_delete_operation_goal', { method: 'POST', body: {
    p_broker_id: goal.broker_id, p_metric: goal.metric, p_cycle: goal.cycle, p_starts_on: goal.starts_on, p_ends_on: goal.ends_on
  } });
  const deleted = Array.isArray(result) ? result[0] : result;
  if (!deleted || deleted.ok !== true) return { ok: false, message: 'Não foi possível excluir esta meta. Atualize a tela e tente novamente.' };
  return { ok: true, message: 'Meta e suas revisões excluídas, conforme solicitado.' };
}

async function apiListAttendance(token, filters = {}) {
  const actor = await verifyActor(token); requireOperationsAccess(actor);
  const safeFilters = { ...(filters && typeof filters === 'object' ? filters : {}) };
  const today = operationDateString(now());
  const requestedFrom = String(safeFilters.dateFrom || '').trim();
  const requestedTo = String(safeFilters.dateTo || '').trim();
  if (requestedFrom && !isValidDateOnly(requestedFrom) || requestedTo && !isValidDateOnly(requestedTo)) throw new HttpError(400, 'Informe datas válidas para consultar as frequências.');
  if (requestedFrom && requestedFrom > today) return [];
  if (requestedTo && requestedTo > today) safeFilters.dateTo = today;
  const range = operationsDateRange(safeFilters); const access = operationsAccessOf(actor);
  const brokerId = access === 'broker' ? actor.id : (isUuid(safeFilters.brokerId) ? String(safeFilters.brokerId) : '');
  const query = rangeQuery('attendance_date', range.start, range.end);
  if (brokerId) query.broker_id = `eq.${brokerId}`;
  const [rows, users] = await Promise.all([listAll('crm_attendance_records', query), listAll('crm_users', { select: '*' })]);
  const mappedUsers = users.map(mapUser);
  return (rows || []).map((row) => ({ id: row.id, brokerId: row.broker_id, brokerName: operationsUserSummary(row.broker_id, mappedUsers).name, attendanceDate: row.attendance_date, shift: row.shift, createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at, updatedBy: row.updated_by }));
}

async function apiSetAttendance(token, payload = {}) {
  const actor = await verifyActor(token); requireOperationsAccess(actor, ['manager']);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const broker = await getActiveBroker(String(payload.brokerId || ''));
  const attendanceDate = String(payload.attendanceDate || '').trim();
  const shift = String(payload.shift || ''); const present = payload.present === true;
  if (!isValidDateOnly(attendanceDate) || attendanceDate > operationDateString(now())) return { ok: false, message: 'Informe uma data válida, até o dia de hoje.' };
  if (!['morning','afternoon','night'].includes(shift)) return { ok: false, message: 'Selecione manhã, tarde ou noite.' };
  const priorRows = await dbRequest('crm_attendance_records', { query: { select: '*', broker_id: `eq.${broker.id}`, attendance_date: `eq.${attendanceDate}`, shift: `eq.${shift}`, deleted_at: 'is.null', limit: 1 } });
  const previous = Array.isArray(priorRows) ? priorRows[0] || null : null;
  if ((present && previous) || (!present && !previous)) return { ok: true, unchanged: true, message: present ? 'A presença já estava registrada.' : 'Não havia presença ativa para cancelar.' };
  const result = await dbRequest('rpc/crm_set_attendance', { method: 'POST', body: { p_broker_id: broker.id, p_attendance_date: attendanceDate, p_shift: shift, p_present: present, p_actor_id: actor.id } });
  const saved = Array.isArray(result) ? result[0] : result;
  const beforeValues = previous ? { brokerId: broker.id, attendanceDate, shift, present: true } : {};
  const afterValues = present ? { brokerId: broker.id, attendanceDate, shift, present: true } : { brokerId: broker.id, attendanceDate, shift, present: false, deletedAt: saved && saved.deleted_at || now() };
  await audit(actor, present ? 'operations.attendance.create' : 'operations.attendance.cancel', 'operation_attendance', saved && saved.id || previous.id, auditChangedFields(beforeValues, afterValues), beforeValues, afterValues, 'operations');
  return { ok: true, message: present ? `Presença de ${broker.name} registrada no período ${shift === 'morning' ? 'da manhã' : shift === 'afternoon' ? 'da tarde' : 'da noite'}.` : 'Presença cancelada e preservada no histórico.' };
}

function operationImportDate(value) {
  const raw = String(value || '').trim();
  const brazilian = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}` : raw.slice(0, 10);
}

function operationImportShift(value) {
  const normalized = String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  if (['morning','manha'].includes(normalized)) return 'morning';
  if (['afternoon','tarde'].includes(normalized)) return 'afternoon';
  if (['night','noite'].includes(normalized)) return 'night';
  return '';
}

async function validateOperationsImport(actor, section, inputRows) {
  if (!['production','attendance'].includes(section)) return { ok: false, message: 'Selecione lançamentos de produção ou frequências de plantão.', rows: [] };
  if (!Array.isArray(inputRows) || !inputRows.length) return { ok: false, message: 'Selecione um CSV com cabeçalho e pelo menos uma linha.', rows: [] };
  if (inputRows.length > 500) return { ok: false, message: 'Importe no máximo 500 linhas por arquivo.', rows: [] };
  const allowed = section === 'production'
    ? new Set(['id','workDate','date','brokerId','brokerEmail','broker','prospections','interactions','appointments','visits','sales','folders','notes'])
    : new Set(['id','attendanceDate','date','brokerId','brokerEmail','broker','shift','period']);
  const users = (await listAll('crm_users', { select: '*' })).map(mapUser);
  const brokers = users.filter((user) => user.role === 'Corretor' && user.active === true && !user.deletedAt);
  const normalizedRows = inputRows.map((input, index) => {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.has(key))) {
      return { row: index + 2, valid: false, duplicate: false, skip: false, errors: ['Formato da linha inválido ou contém campos não permitidos.'], value: null };
    }
    const brokerRef = String(input.brokerId || input.brokerEmail || input.broker || '').trim().toLocaleLowerCase('pt-BR');
    const broker = brokers.find((item) => [String(item.id).toLocaleLowerCase('pt-BR'), item.email, item.name.toLocaleLowerCase('pt-BR')].includes(brokerRef));
    if (!broker) errors.push('Corretor não encontrado ou inativo; use broker_id ou broker_email do CRM.');
    const date = operationImportDate(section === 'production' ? input.workDate || input.date : input.attendanceDate || input.date);
    if (!isValidDateOnly(date)) errors.push('Data inválida; use AAAA-MM-DD ou DD/MM/AAAA.');
    else if (date > operationDateString(now())) errors.push('Datas futuras não podem ser importadas.');
    let value;
    if (section === 'production') {
      value = { id: String(input.id || '').trim(), brokerId: broker && broker.id, workDate: date, notes: String(input.notes || '').trim().slice(0, 1500) };
      for (const [field, label] of [['prospections','Prospecções'],['interactions','Interações'],['appointments','Agendamentos'],['visits','Visitas'],['sales','Vendas'],['folders','Pastas encaminhadas']]) {
        try { value[field] = parseOperationCount(input[field] === undefined || input[field] === '' ? 0 : input[field], label); }
        catch (error) { errors.push(error.message); }
      }
      if (value.id && !isUuid(value.id)) errors.push('ID de lançamento inválido.');
    } else {
      const shift = operationImportShift(input.shift || input.period);
      if (!shift) errors.push('Período inválido; use manhã, tarde ou noite.');
      value = { brokerId: broker && broker.id, attendanceDate: date, shift, present: true };
    }
    return { row: index + 2, valid: errors.length === 0, duplicate: false, skip: false, errors: [...new Set(errors)], value };
  });
  const validDates = normalizedRows.filter((item) => item.valid).map((item) => section === 'production' ? item.value.workDate : item.value.attendanceDate).sort();
  if (validDates.length && daysBetweenDateOnly(validDates[0], validDates[validDates.length - 1]) > 366) {
    return { ok: false, message: 'O intervalo do arquivo deve ter no máximo 366 dias. Divida os dados em períodos menores.', rows: normalizedRows, validCount: 0, errorCount: normalizedRows.length };
  }
  const seenIds = new Set();
  let existingEntries = [];
  let existingAttendance = [];
  if (validDates.length && section === 'production') {
    existingEntries = await listAll('crm_production_entries', rangeQuery('work_date', validDates[0], validDates[validDates.length - 1]));
  }
  if (validDates.length && section === 'attendance') {
    existingAttendance = await listAll('crm_attendance_records', rangeQuery('attendance_date', validDates[0], validDates[validDates.length - 1]));
  }
  const entriesById = new Map((existingEntries || []).map((row) => [String(row.id), row]));
  const existingAttendanceKeys = new Set((existingAttendance || []).map((row) => `${row.broker_id}|${row.attendance_date}|${row.shift}`));
  const seenAttendanceKeys = new Set();
  normalizedRows.forEach((item) => {
    if (!item.valid || !item.value) return;
    if (section === 'production' && item.value.id) {
      const key = item.value.id;
      if (seenIds.has(key)) { item.valid = false; item.errors.push('O mesmo ID aparece mais de uma vez no arquivo.'); return; }
      seenIds.add(key);
      const existing = entriesById.get(key);
      if (!existing || String(existing.broker_id) !== String(item.value.brokerId)) { item.valid = false; item.errors.push('O ID não corresponde a um lançamento ativo deste corretor.'); return; }
      item.previousWorkDate = String(existing.work_date || '');
      item.action = 'update';
    } else if (section === 'production') item.action = 'create';
    if (section === 'attendance') {
      const key = `${item.value.brokerId}|${item.value.attendanceDate}|${item.value.shift}`;
      if (existingAttendanceKeys.has(key) || seenAttendanceKeys.has(key)) { item.duplicate = true; item.skip = true; item.action = 'skip'; }
      else { item.action = 'create'; seenAttendanceKeys.add(key); }
    }
  });
  return { ok: true, rows: normalizedRows.map(({ value, previousWorkDate, ...safe }) => safe), normalizedRows, validCount: normalizedRows.filter((item) => item.valid).length, errorCount: normalizedRows.filter((item) => !item.valid).length, skipCount: normalizedRows.filter((item) => item.valid && item.skip).length };
}

async function apiPreviewOperationsImport(token, section, rows) {
  const actor = await verifyActor(token); requireOperationsAccess(actor, ['manager']);
  const result = await validateOperationsImport(actor, String(section || ''), rows);
  const { normalizedRows, ...safe } = result;
  return safe;
}

async function apiImportOperations(token, section, rows) {
  const actor = await verifyActor(token); requireOperationsAccess(actor, ['manager']);
  const preview = await validateOperationsImport(actor, String(section || ''), rows);
  if (!preview.ok || preview.errorCount) return { ok: false, message: preview.ok ? 'Corrija os erros antes de importar; nenhuma linha foi gravada.' : preview.message, preview: { rows: preview.rows, validCount: preview.validCount, errorCount: preview.errorCount, skipCount: preview.skipCount } };
  const values = preview.normalizedRows.filter((item) => !item.skip).map((item) => item.value);
  if (!values.length) return { ok: true, createdCount: 0, updatedCount: 0, skippedCount: preview.skipCount, message: `${preview.skipCount} frequência(s) já existente(s) foram ignoradas; não havia novas linhas para gravar.` };
  try {
    const response = await dbRequest('rpc/crm_import_operations', { method: 'POST', body: {
      p_section: String(section), p_rows: values, p_actor_id: actor.id,
      p_actor_email: actor.email, p_actor_name: actor.name, p_actor_role: actor.role
    } });
    const result = Array.isArray(response) ? response[0] : response;
    if (!result || result.ok !== true) throw new HttpError(502, 'O banco não confirmou a importação. Atualize a tela e confira os lançamentos antes de tentar novamente.');
    const createdCount = Number(result.createdCount || 0);
    const updatedCount = Number(result.updatedCount || 0);
    const skippedCount = preview.skipCount + Number(result.skippedCount || 0);
    let syncWarning = '';
    if (String(section) === 'production') {
      try {
        const movedEntries = preview.normalizedRows.filter((item) => item.valid && !item.skip && item.action === 'update'
          && item.previousWorkDate && String(item.previousWorkDate) !== String(item.value.workDate));
        const syncDays = values.map((item) => ({ brokerId: item.brokerId, workDate: item.workDate }));
        for (const item of movedEntries) {
          const links = await listAll('crm_production_sale_links', {
            select: 'sale_id', production_entry_id: `eq.${item.value.id}`, unlinked_at: 'is.null'
          });
          for (const link of links || []) await unlinkProductionSale(String(link.sale_id), actor);
          syncDays.push({ brokerId: item.value.brokerId, workDate: item.previousWorkDate });
        }
        await syncProductionSales(syncDays, actor);
      }
      catch (_) { syncWarning = ' Os lançamentos foram importados, mas os vínculos automáticos com vendas ainda precisam ser conferidos.'; }
    }
    return { ok: true, createdCount, updatedCount, skippedCount, message: `${createdCount} linha(s) adicionada(s), ${updatedCount} corrigida(s) e ${skippedCount} frequência(s) já existente(s) ignorada(s).${syncWarning}` };
  } catch (error) {
    if (error instanceof HttpError && error.status < 500) throw error;
    return { ok: false, createdCount: 0, updatedCount: 0, skippedCount: preview.skipCount, message: 'A importação foi cancelada integralmente; nenhuma linha deste arquivo foi gravada. Confira se os dados continuam válidos e tente novamente.' };
  }
}

async function apiExportOperationsReport(token, filters = {}) {
  const actor = await verifyActor(token); requireOperationsAccess(actor, ['viewer','manager']);
  const snapshot = await loadOperationsSnapshot(actor, filters && typeof filters === 'object' ? filters : {});
  const range = operationsDateRange(filters && typeof filters === 'object' ? filters : {});
  const brokerId = isUuid(filters && filters.brokerId) ? String(filters.brokerId) : '';
  const productionQuery = rangeQuery('work_date', range.start, range.end);
  const attendanceQuery = rangeQuery('attendance_date', range.start, range.end);
  if (brokerId) { productionQuery.broker_id = `eq.${brokerId}`; attendanceQuery.broker_id = `eq.${brokerId}`; }
  const [productionRows, attendanceRows, userRows] = await Promise.all([
    listAll('crm_production_entries', productionQuery), listAll('crm_attendance_records', attendanceQuery), listAll('crm_users', { select: '*' })
  ]);
  const adjustedProductionRows = await applyCancelledSalesToProduction(productionRows || []);
  const users = userRows.map(mapUser);
  const userById = new Map(users.map((user) => [String(user.id), user]));
  const salesByBroker = new Map();
  for (const row of adjustedProductionRows) {
    const brokerId = String(row.broker_id);
    const total = salesByBroker.get(brokerId) || { reported: 0, valid: 0, cancelled: 0 };
    total.reported += Number(row.reported_sale_count || 0);
    total.valid += Number(row.sale_count || 0);
    total.cancelled += Number(row.linked_cancelled_sales || 0);
    salesByBroker.set(brokerId, total);
  }
  const rows = snapshot.byBroker.map((broker) => ({
    corretor: broker.name, prospeccoes: broker.prospections, interacoes: broker.interactions,
    agendamentos: broker.appointments, visitas: broker.visits,
    vendas: (salesByBroker.get(String(broker.id)) || {}).reported || 0,
    vendasValidas: (salesByBroker.get(String(broker.id)) || {}).valid || 0,
    vendasCanceladasVinculadas: (salesByBroker.get(String(broker.id)) || {}).cancelled || 0,
    pastas: broker.folders,
    frequencia_total: broker.attendance, frequencia_manha: broker.morning,
    frequencia_tarde: broker.afternoon, frequencia_noite: broker.night
  }));
  const production = adjustedProductionRows.map((row) => ({
    id: row.id, date: row.work_date, broker: operationsUserSummary(row.broker_id, users).name, brokerId: row.broker_id, brokerEmail: userById.get(String(row.broker_id))?.email || '',
      prospeccoes: Number(row.prospecting_count || 0), interacoes: Number(row.interaction_count || 0),
      agendamentos: Number(row.appointment_count || 0), visitas: Number(row.visit_count || 0),
      vendas: Number(row.reported_sale_count || 0), vendasValidas: Number(row.sale_count || 0),
      vendasCanceladasVinculadas: Number(row.linked_cancelled_sales || 0), pastas: Number(row.folder_count || 0),
    observacoes: row.notes || '', updatedAt: row.updated_at
  }));
  const attendance = (attendanceRows || []).map((row) => ({
    id: row.id, date: row.attendance_date, broker: operationsUserSummary(row.broker_id, users).name, brokerId: row.broker_id, brokerEmail: userById.get(String(row.broker_id))?.email || '',
    shift: OPERATIONS_SHIFTS.find((item) => item.id === row.shift)?.label || row.shift, updatedAt: row.updated_at
  }));
  return { period: snapshot.period, totals: snapshot.totals, rows, production, attendance };
}

async function apiListLeads(token, filters, page, pageSize, segment = 'all') {
  const actor = await verifyActor(token);
  const [context, staleBusinessDays, attemptRows] = await Promise.all([loadLeadContext(), getFollowupBusinessDays(), listAll('crm_lead_attempts', { select: 'lead_id,attempt_number' })]);
  const attemptCounts = new Map();
  (attemptRows || []).forEach((row) => attemptCounts.set(String(row.lead_id), (attemptCounts.get(String(row.lead_id)) || 0) + 1));
  const options = { today: now(), staleBusinessDays };
  let found = CrmDomain.filterLeads(context.leads, actor, filters, options);
  const closedLeadStatuses = new Set(['Desistência','Já comprou']);
  found = found.filter((lead) => segment === 'closed'
    ? closedLeadStatuses.has(String(lead.status || ''))
    : !closedLeadStatuses.has(String(lead.status || '')));
  if (segment === 'new' || segment === 'followed') {
    if (!(actor.role === 'SDR' || isAdmin(actor))) throw new HttpError(403, 'Acesso restrito ao SDR e à gestão.');
    found = found.filter((lead) => segment === 'new' ? !lead.sdrStatusUpdatedAt : (attemptCounts.get(String(lead.id)) || 0) > 0);
  }
  found.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const enriched = found.map((lead) => {
    const info = CrmDomain.staleInfo(lead, options.today, options.staleBusinessDays);
    const contactAttempts = attemptCounts.get(String(lead.id)) || 0;
    return Object.assign({}, lead, { contactAttempts, staleBusinessDays: info.businessDays, isStale: info.stale, isNewForSdr: !lead.sdrStatusUpdatedAt });
  });
  return { ...CrmDomain.paginate(enriched, page, pageSize), staleBusinessDays };
}

async function apiListArchivedLeads(token, filters, page, pageSize) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const context = await loadLeadContext({ archivedOnly: true });
  const found = CrmDomain.filterLeads(context.leads, actor, filters || {}, { today: now() });
  found.sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
  return CrmDomain.paginate(found, page, pageSize);
}

async function apiArchiveLead(token, leadId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(leadId)) return { ok: false, message: 'Cliente inválido.' };
  const rows = await dbRequest('crm_leads', { query: { select: 'id,name,deleted_at', id: `eq.${String(leadId)}`, limit: 1 } });
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead) return { ok: false, message: 'Cliente não encontrado.' };
  if (lead.deleted_at) return { ok: false, message: 'Este cliente já está na lista de excluídos.' };
  const stamp = now();
  const updated = await dbRequest('crm_leads', { method: 'PATCH', query: { id: `eq.${String(leadId)}`, deleted_at: 'is.null' }, prefer: 'return=representation', body: { deleted_at: stamp, deleted_by: actor.id } });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'O cliente já foi alterado. Atualize a lista e tente novamente.' };
  await audit(actor, 'lead.archive', 'lead', lead.id, ['deleted_at','deleted_by'], { deletedAt: null }, { deletedAt: stamp, deletedBy: actor.id });
  return { ok: true, message: 'Cliente excluído da carteira. O cadastro e o histórico foram preservados e podem ser restaurados pela gestão.' };
}

async function apiRestoreLead(token, leadId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(leadId)) return { ok: false, message: 'Cliente inválido.' };
  const rows = await dbRequest('crm_leads', { query: { select: 'id,name,deleted_at', id: `eq.${String(leadId)}`, deleted_at: 'not.is.null', limit: 1 } });
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead) return { ok: false, message: 'Cliente excluído não encontrado.' };
  const updated = await dbRequest('crm_leads', { method: 'PATCH', query: { id: `eq.${String(leadId)}`, deleted_at: 'not.is.null' }, prefer: 'return=representation', body: { deleted_at: null, deleted_by: null } });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'O cliente já foi alterado. Atualize a lista e tente novamente.' };
  await audit(actor, 'lead.restore', 'lead', lead.id, ['deleted_at','deleted_by'], { deletedAt: lead.deleted_at }, { deletedAt: null, deletedBy: null });
  return { ok: true, message: 'Cliente restaurado. Os dados e o histórico foram mantidos.' };
}

async function apiGetSdrHistory(token, leadId) {
  const actor = await verifyActor(token);
  if (!isUuid(leadId)) throw new HttpError(404, 'Cliente não encontrado ou sem permissão.');
  const rows = await dbRequest('crm_leads', { query: { select: 'id,broker_id,deleted_at', id: `eq.${String(leadId)}`, limit: 1 } });
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead || (lead.deleted_at && !isAdmin(actor)) || !CrmDomain.canReadLead(actor, { id: lead.id, brokerId: lead.broker_id })) throw new HttpError(404, 'Cliente não encontrado ou sem permissão.');
  const history = await dbRequest('crm_sdr_history', { query: { select: '*', lead_id: `eq.${lead.id}`, order: 'at.desc' } });
  return (history || []).map((item) => ({ id: item.id, at: item.at, userName: item.user_name || 'Responsável não identificado', status: item.status || '', feedback: item.feedback || '', source: item.source || '' }));
}

async function apiSaveLead(token, leadId, payload) {
  const actor = await verifyActor(token);
  const isCreate = !leadId;
  const context = await loadLeadContext();
  const existing = isCreate ? null : context.leads.find((item) => String(item.id) === String(leadId)) || null;
  const check = CrmDomain.validateLeadInput(actor, payload, existing, { isCreate });
  if (!check.ok) return { ok: false, message: check.error };
  const values = check.value;
  const selected = context.developments.find((item) => item.id === values.developmentId && item.active === true);
  if (values.developmentId && !selected) return { ok: false, message: 'Empreendimento inválido ou inativo.' };
  const targetBrokerId = values.brokerId || existing && existing.brokerId || actor.id;
  const targetBroker = context.users.find((item) => item.id === targetBrokerId && item.role === 'Corretor');
  if (!targetBroker || (!targetBroker.active && (!existing || existing.brokerId !== targetBrokerId))) return { ok: false, message: 'Corretor inválido ou inativo.' };
  if (actor.role === 'Corretor' && targetBrokerId !== actor.id) return { ok: false, message: 'Você só pode cadastrar clientes em sua própria carteira.' };
  const stamp = now();
  const changedFields = Object.keys(values).filter((key) => String(existing && existing[key] !== undefined ? existing[key] : '') !== String(values[key] === undefined || values[key] === null ? '' : values[key]));
  const isSdrContact = !isCreate && actor.role === 'SDR';
  const firstSdrStatusReview = isSdrContact && Object.prototype.hasOwnProperty.call(values, 'status') && !existing.sdrStatusUpdatedAt;
  if (firstSdrStatusReview) changedFields.push('sdrStatusUpdatedAt');
  if (!isCreate && !changedFields.length && !isSdrContact) return { ok: true, leadId: existing.id, message: 'Nenhuma alteração detectada.' };
  let saved;
  const dbValues = leadToDb(values);
  if (isCreate) {
    saved = await dbRequest('crm_leads', { method: 'POST', prefer: 'return=representation', body: { ...dbValues, broker_id: targetBroker.id, status: values.status || 'Em contato', created_by: actor.id, updated_by: actor.id, created_at: stamp, updated_at: stamp } });
    saved = Array.isArray(saved) ? saved[0] : saved;
  } else {
    const update = { ...dbValues, broker_id: targetBroker.id, updated_by: actor.id, updated_at: stamp };
    if (isSdrContact) {
      update.sdr_updated_at = stamp;
      update.sdr_updated_by = actor.id;
      if (Object.prototype.hasOwnProperty.call(values, 'status')) update.sdr_status_updated_at = existing.sdrStatusUpdatedAt || stamp;
    }
    if (Object.prototype.hasOwnProperty.call(values, 'phone') && String(values.phone) !== String(existing.phone)) {
      update.phone_correction_required = false;
      update.phone_correction_requested_at = null;
      update.phone_correction_requested_by = null;
      update.phone_correction_notes = '';
      if (existing.phoneCorrectionRequired) { update.phone_corrected_at = stamp; update.phone_corrected_by = actor.id; }
    }
    saved = await dbRequest('crm_leads', { method: 'PATCH', query: { id: `eq.${existing.id}` }, prefer: 'return=representation', body: update });
    saved = Array.isArray(saved) ? saved[0] : null;
  }
  if (!saved) throw new HttpError(404, 'Cliente não encontrado ou sem permissão.');
  if (isSdrContact) await dbRequest('crm_sdr_history', { method: 'POST', prefer: 'return=minimal', body: { lead_id: saved.id, user_id: actor.id, user_name: actor.name, status: saved.status, feedback: saved.sdr_feedback || '', source: 'Atualização registrada pelo SDR', at: stamp } });
  const before = existing ? { name: existing.name, phone: existing.phone, developmentId: existing.developmentId, notes: existing.notes, sdrFeedback: existing.sdrFeedback, status: existing.status, brokerId: existing.brokerId, phoneCorrectionRequired: existing.phoneCorrectionRequired, sdrStatusUpdatedAt: existing.sdrStatusUpdatedAt || null } : {};
  const after = { name: saved.name, phone: saved.phone, developmentId: saved.development_id, notes: saved.notes, sdrFeedback: saved.sdr_feedback, status: saved.status, brokerId: saved.broker_id, phoneCorrectionRequired: saved.phone_correction_required === true, sdrStatusUpdatedAt: saved.sdr_status_updated_at || null };
  await audit(actor, isCreate ? (actor.role === 'SDR' ? 'lead.create_by_sdr' : 'lead.create') : isSdrContact ? 'lead.sdr_contact' : 'lead.update', 'lead', saved.id, changedFields, before, after);
  return { ok: true, leadId: saved.id, message: isCreate ? (actor.role === 'SDR' ? 'Cliente cadastrado e atribuído ao corretor selecionado.' : 'Cliente cadastrado.') : isSdrContact ? 'Contato registrado no histórico.' : 'Cliente atualizado.' };
}

async function apiListLeadAttempts(token, leadId) {
  const actor = await verifyActor(token);
  if (!isUuid(leadId)) throw new HttpError(404, 'Cliente não encontrado ou sem permissão.');
  const rows = await dbRequest('crm_leads', { query: { select: 'id,broker_id,deleted_at', id: `eq.${leadId}`, limit: 1 } });
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead || lead.deleted_at || !CrmDomain.canReadLead(actor, { id: lead.id, brokerId: lead.broker_id })) throw new HttpError(404, 'Cliente não encontrado ou sem permissão.');
  const attempts = await dbRequest('crm_lead_attempts', { query: { select: 'id,attempt_number,at,actor_name,status_at_attempt,notes', lead_id: `eq.${lead.id}`, order: 'attempt_number.asc' } });
  return Array.isArray(attempts) ? attempts.map((row) => ({ id: row.id, number: Number(row.attempt_number), at: row.at, actorName: row.actor_name, statusAtAttempt: row.status_at_attempt, notes: row.notes || '' })) : [];
}

async function apiAddLeadAttempt(token, leadId, notes = '') {
  const actor = await verifyActor(token);
  if (actor.role !== 'SDR' && !isAdmin(actor)) throw new HttpError(403, 'Somente o SDR e os perfis administrativos podem registrar tentativas de contato.');
  if (!isUuid(leadId)) return { ok: false, message: 'Cliente inválido.' };
  const rows = await dbRequest('crm_leads', { query: { select: 'id,broker_id,status,deleted_at', id: `eq.${leadId}`, limit: 1 } });
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead || lead.deleted_at || !CrmDomain.canReadLead(actor, { id: lead.id, brokerId: lead.broker_id })) return { ok: false, message: 'Cliente não encontrado ou sem permissão.' };
  if (['Desistência','Já comprou'].includes(String(lead.status || ''))) return { ok: false, message: 'Clientes encerrados não recebem novas tentativas de follow-up.' };
  const current = await dbRequest('crm_lead_attempts', { query: { select: 'attempt_number', lead_id: `eq.${leadId}`, order: 'attempt_number.desc', limit: 1 } });
  if (Array.isArray(current) && current.length && Number(current[0].attempt_number) >= 7) return { ok: false, message: 'As sete tentativas já foram registradas. Revise o atendimento e avalie o status do lead.' };
  const result = await dbRequest('rpc/crm_add_contact_attempt', { method: 'POST', body: { p_lead_id: leadId, p_actor_id: actor.id, p_actor_name: actor.name, p_notes: String(notes || '').slice(0, 1000) } });
  const attempt = Array.isArray(result) ? result[0] : result;
  if (!attempt) throw new HttpError(502, 'Não foi possível registrar a tentativa de contato.');
  await audit(actor, 'lead.contact_attempt', 'lead', leadId, ['tentativa'], { contactAttempts: Number(attempt.attempt_number) - 1 }, { contactAttempts: Number(attempt.attempt_number), statusAtAttempt: lead.status, notes: attempt.notes || '' });
  return { ok: true, number: Number(attempt.attempt_number), reminder: Number(attempt.attempt_number) === 7, message: Number(attempt.attempt_number) === 7 ? '7ª tentativa registrada. Se o lead não evoluir, avalie colocá-lo em Desistência.' : `${attempt.attempt_number}ª tentativa registrada.` };
}

async function apiFlagPhoneIncorrect(token, leadId, notes = '') {
  const actor = await verifyActor(token);
  if (actor.role !== 'SDR') throw new HttpError(403, 'Somente o SDR pode solicitar a correção do telefone.');
  if (!isUuid(leadId)) return { ok: false, message: 'Cliente inválido.' };
  const rows = await dbRequest('crm_leads', { query: { select: 'id,broker_id,phone,status,sdr_updated_at,phone_correction_required,deleted_at', id: `eq.${leadId}`, limit: 1 } });
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead || lead.deleted_at) return { ok: false, message: 'Cliente não encontrado.' };
  if (lead.phone_correction_required) return { ok: true, message: 'A correção do telefone já está pendente para o corretor responsável.' };
  const stamp = now();
  const note = String(notes || '').trim().slice(0, 1000);
  await dbRequest('crm_leads', { method: 'PATCH', query: { id: `eq.${leadId}` }, prefer: 'return=minimal', body: { phone_correction_required: true, phone_correction_requested_at: stamp, phone_correction_requested_by: actor.id, phone_correction_notes: note, sdr_updated_at: stamp, sdr_updated_by: actor.id, updated_at: stamp, updated_by: actor.id } });
  await dbRequest('crm_sdr_history', { method: 'POST', prefer: 'return=minimal', body: { lead_id: leadId, user_id: actor.id, user_name: actor.name, status: lead.status || 'Em contato', feedback: note || 'Telefone informado inválido; correção solicitada ao corretor responsável.', source: 'Telefone incorreto: correção solicitada ao corretor', at: stamp } });
  await audit(actor, 'lead.phone_correction_requested', 'lead', leadId, ['phoneCorrectionRequired','sdrUpdatedAt'], { phoneCorrectionRequired: false, phone: lead.phone, sdrUpdatedAt: lead.sdr_updated_at || null }, { phoneCorrectionRequired: true, phone: lead.phone, notes: note, requestedAt: stamp, requestedBy: actor.name, sdrUpdatedAt: stamp });
  return { ok: true, message: 'Correção solicitada. O cliente ficará pendente para o corretor responsável.' };
}

async function apiGetSdrWorklist(token) {
  const actor = await verifyActor(token);
  if (!(actor.role === 'SDR' || isAdmin(actor))) throw new HttpError(403, 'Acesso restrito ao SDR e à gestão.');
  const context = await loadLeadContext();
  const attempts = await listAll('crm_lead_attempts', { select: 'lead_id,attempt_number,at,status_at_attempt' });
  const byLead = new Map();
  (attempts || []).forEach((item) => {
    const key = String(item.lead_id);
    const current = byLead.get(key) || [];
    current.push(item);
    byLead.set(key, current);
  });
  const timestamp = Date.now();
  const terminal = new Set(['Desistência', 'Já comprou']);
  const rows = context.leads.filter((lead) => !terminal.has(lead.status)).map((lead) => {
    const history = byLead.get(String(lead.id)) || [];
    const latest = history.slice().sort((a, b) => Number(b.attempt_number) - Number(a.attempt_number))[0];
    const attemptAt = latest && latest.at ? latest.at : '';
    const lastContactAt = attemptAt && lead.sdrUpdatedAt
      ? (Date.parse(attemptAt) > Date.parse(lead.sdrUpdatedAt) ? attemptAt : lead.sdrUpdatedAt)
      : attemptAt || lead.sdrUpdatedAt || lead.createdAt;
    const hoursSinceContact = lastContactAt ? Math.max(0, (timestamp - new Date(lastContactAt).getTime()) / 3600000) : 0;
    const hasContactAttempt = history.length > 0;
    return { ...lead, attempts: history.length, lastContactAt, hoursSinceContact, needs24hFollowup: hasContactAttempt && hoursSinceContact >= 24, needsDesistanceReview: Boolean(latest && Number(latest.attempt_number) >= 7 && latest.status_at_attempt === lead.status), needsPhoneCorrection: lead.phoneCorrectionRequired };
  });
  return {
    newLeads: rows.filter((lead) => !lead.sdrStatusUpdatedAt).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    followupAlerts: rows.filter((lead) => lead.needs24hFollowup).sort((a, b) => b.hoursSinceContact - a.hoursSinceContact),
    sevenAttemptAlerts: rows.filter((lead) => lead.needsDesistanceReview),
    phoneCorrections: rows.filter((lead) => lead.needsPhoneCorrection)
  };
}

async function apiListAudit(token, filters = {}, requestedPage = 1, requestedPageSize = 100) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const page = Math.max(1, Number.parseInt(requestedPage, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(requestedPageSize, 10) || 100));
  const query = { select: '*', order: 'at.desc' };
  if (filters && filters.entityType) query.entity_type = `eq.${String(filters.entityType).slice(0, 50)}`;
  if (filters && ['crm','operations'].includes(filters.module)) query.module = `eq.${filters.module}`;
  if (filters && filters.actorId) query.user_id = `eq.${String(filters.actorId)}`;
  const dateTerms = [];
  if (filters && filters.dateFrom) {
    if (!isValidDateOnly(filters.dateFrom)) return { ok: false, message: 'Data inicial inválida.' };
    dateTerms.push(`at.gte.${new Date(`${filters.dateFrom}T00:00:00-03:00`).toISOString()}`);
  }
  if (filters && filters.dateTo) {
    if (!isValidDateOnly(filters.dateTo)) return { ok: false, message: 'Data final inválida.' };
    const nextDay = Date.parse(`${filters.dateTo}T00:00:00-03:00`) + 86400000;
    dateTerms.push(`at.lt.${new Date(nextDay).toISOString()}`);
  }
  if (dateTerms.length) query.and = `(${dateTerms.join(',')})`;
  const result = await dbRequest('crm_audit', { query, range: `${(page - 1) * pageSize}-${page * pageSize - 1}`, returnCount: true });
  const rows = result && Array.isArray(result.data) ? result.data : [];
  const items = rows.map((item) => ({ id: item.id, at: item.at, module: item.module || 'crm', userId: item.user_id || '', actorName: item.actor_name || item.email || 'Usuário não identificado', actorEmail: item.email || '', actorRole: item.actor_role || '', action: item.action, entityType: item.entity_type, entityId: item.entity_id, changedFields: item.changed_fields || '', beforeValues: item.before_values || {}, afterValues: item.after_values || {} }));
  return { items, total: result ? result.total : 0, page, pageSize };
}

function parseMoney(value, fieldName) {
  const invalid = () => new HttpError(400, fieldName + ' deve ser um valor monetário válido com até duas casas decimais.');
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw invalid();
    const cents = Math.round(value * 100);
    if (!Number.isSafeInteger(cents) || cents > 99999999999999 || Math.abs(value * 100 - cents) > 0.00001) throw invalid();
    return cents / 100;
  }

  let raw = String(value === undefined || value === null || value === '' ? '0' : value)
    .trim().replace(/^R\$\s*/i, '').replace(/[\s\u00a0]/g, '');
  if (!raw) raw = '0';
  if (!/^\d[\d.,]*$/.test(raw)) throw invalid();

  const commaCount = (raw.match(/,/g) || []).length;
  const dotCount = (raw.match(/\./g) || []).length;
  let wholePart = raw;
  let fractionPart = '';
  if (commaCount && dotCount) {
    const decimalSeparator = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? ',' : '.';
    const groupingSeparator = decimalSeparator === ',' ? '.' : ',';
    const decimalIndex = raw.lastIndexOf(decimalSeparator);
    fractionPart = raw.slice(decimalIndex + 1);
    wholePart = raw.slice(0, decimalIndex);
    if (!/^\d{1,2}$/.test(fractionPart) || wholePart.includes(decimalSeparator)) throw invalid();
    const groups = wholePart.split(groupingSeparator);
    if (groups.length > 1 && (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some((part) => !/^\d{3}$/.test(part)))) throw invalid();
    if (groups.some((part) => !/^\d+$/.test(part))) throw invalid();
    wholePart = groups.join('');
  } else if (commaCount || dotCount) {
    const separator = commaCount ? ',' : '.';
    const separatorCount = commaCount || dotCount;
    const pieces = raw.split(separator);
    if (separatorCount > 1) {
      if (!/^\d{1,3}$/.test(pieces[0]) || pieces.slice(1).some((part) => !/^\d{3}$/.test(part))) throw invalid();
      wholePart = pieces.join('');
    } else {
      const [integer, tail] = pieces;
      if (!integer || !tail) throw invalid();
      if (tail.length === 3 && integer.length <= 3) {
        wholePart = integer + tail;
      } else {
        if (!/^\d{1,2}$/.test(tail)) throw invalid();
        wholePart = integer;
        fractionPart = tail;
      }
    }
  }

  if (!/^\d+$/.test(wholePart)) throw invalid();
  const whole = Number(wholePart);
  const fraction = Number(fractionPart.padEnd(2, '0') || '0');
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 99999999999999) throw invalid();
  return cents / 100;
}

function splitMoneyHalf(value) {
  const cents = Math.max(0, Math.round(Number(value || 0) * 100));
  const first = Math.floor(cents / 2);
  return { first: first / 100, second: (cents - first) / 100 };
}

function parseOptionalPercent(value, fieldName) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) return null;
  const normalized = raw.replace(',', '.');
  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100 || Math.round(percent * 10000) !== percent * 10000) {
    throw new HttpError(400, `${fieldName} deve ser um percentual entre 0 e 100, com até quatro casas decimais.`);
  }
  return Math.round(percent * 10000) / 10000;
}

function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function safeFileName(value) {
  const base = String(value || 'documento').split(/[\\/]/).pop().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 120);
  return base || 'documento';
}

async function apiListSales(token, filters = {}) {
  const actor = await verifyActor(token);
  const brokerView = actor.role === 'Corretor';
  if (!isAdmin(actor) && !brokerView) throw new HttpError(403, 'Acesso às vendas restrito à gestão e ao corretor responsável.');
  // A solicitação de arquivos excluídos só vale para administradores. Para o
  // corretor, o filtro de proprietário é imposto no banco e não pode ser removido
  // por parâmetros enviados pelo navegador.
  const includeArchived = !brokerView && Boolean(filters && filters.includeArchived === true);
  const salesQuery = brokerView
    ? { select: '*', broker_id: `eq.${actor.id}`, deleted_at: 'is.null' }
    : includeArchived ? { select: '*' } : { select: '*', deleted_at: 'is.null' };
  const sales = await listAll('crm_sales', salesQuery);
  const saleIds = (sales || []).map((item) => String(item.id || '')).filter(isUuid);
  const receiptQuery = brokerView
    ? saleIds.length ? { select: '*', sale_id: `in.(${saleIds.join(',')})` } : null
    : { select: '*' };
  const [receipts, users, developments] = await Promise.all([
    receiptQuery ? listAll('crm_sales_receipts', receiptQuery) : Promise.resolve([]),
    brokerView ? Promise.resolve([]) : listAll('crm_users', { select: '*' }), listAll('crm_developments', { select: 'id,name' })
  ]);
  const receiptGroups = new Map();
  (receipts || []).forEach((item) => {
    const key = String(item.sale_id); const list = receiptGroups.get(key) || [];
    if (brokerView) {
      list.push({ amount: Number(item.amount), receivedAt: item.received_at, voidedAt: item.voided_at || '' });
      receiptGroups.set(key, list);
      return;
    }
    const createdBy = users.find((user) => String(user.id) === String(item.created_by));
    const voidedBy = users.find((user) => String(user.id) === String(item.voided_by));
    list.push({ id: item.id, amount: Number(item.amount), receivedAt: item.received_at, notes: item.notes || '', createdAt: item.created_at, createdBy: item.created_by || '', createdByName: createdBy ? createdBy.name : '', voidedAt: item.voided_at || '', voidedBy: item.voided_by || '', voidedByName: voidedBy ? voidedBy.name : '', voidReason: item.void_reason || '' });
    receiptGroups.set(key, list);
  });
  return (sales || []).map((row) => {
    const broker = users.find((item) => String(item.id) === String(row.broker_id));
    const sdr = users.find((item) => String(item.id) === String(row.sdr_id));
    const development = developments.find((item) => String(item.id) === String(row.development_id));
    const payments = receiptGroups.get(String(row.id)) || [];
    const received = Math.round(payments.filter((item) => !item.voidedAt).reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    let brokerCommission = Number(row.broker_commission === null || row.broker_commission === undefined ? row.expected_repass || 0 : row.broker_commission);
    const storedSdrCommission = Number(row.sdr_commission || 0);
    // Um vínculo antigo de SDR não gera rateio se a venda foi explicitamente
    // marcada como sem participação. Registros sem a marca antiga continuam
    // reconhecendo o vínculo explícito do SDR já selecionado.
    const hasSdrParticipation = Boolean(row.sdr_id) && row.is_sdr_sale !== false;
    let sdrCommission = hasSdrParticipation ? storedSdrCommission : 0;
    const storedGrossCommission = Number(row.gross_commission || 0);
    // Para vendas antigas sem vínculo novo, use a soma histórica apenas para
    // recuperar o valor bruto; nunca exponha essa parte como comissão do SDR.
    const legacySdrPart = row.is_sdr_sale === false ? 0 : storedSdrCommission;
    const grossCommission = storedGrossCommission > 0 ? storedGrossCommission : Math.round((brokerCommission + legacySdrPart) * 100) / 100;
    const repassStatus = String(row.repass_status || '');
    const normalizedPhase = repassStatus.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const isCommissionPaid = repassStatus === 'COMISSÃO PAGA' || payments.some((item) => !item.voidedAt);
    const isCancelledOrDistrato = row.sale_status === 'Cancelada' || normalizedPhase === 'CANCELADO' || normalizedPhase.includes('DISTRATO');
    // A participação do SDR só existe quando há um SDR selecionado na venda.
    // Registros antigos em aberto sem responsável ficam integralmente com o corretor;
    // registros já recebidos preservam o valor histórico do corretor.
    if (!hasSdrParticipation && grossCommission > 0) {
      brokerCommission = grossCommission;
      sdrCommission = 0;
    }
    if (brokerView) {
      // O corretor recebe somente a própria carteira e os dados necessários
      // para acompanhar sua comissão. SDR, gerente, notas internas e demais
      // valores financeiros não são incluídos na resposta.
      const brokerCommissionPaid = repassStatus === 'COMISSÃO PAGA' || (brokerCommission > 0 && received >= brokerCommission);
      return {
        id: row.id, internalNumber: row.internal_number, processNumber: row.process_number || '',
        buyerName: row.buyer_name, developmentName: development ? development.name : '',
        soldAt: row.sold_at, unit: row.unit || '', unitValue: Number(row.unit_value || 0),
        saleStatus: ['Contabilizado','Pendência para contabilização'].includes(row.sale_status) ? row.sale_status : (row.sale_status === 'Cancelada' ? 'Cancelada' : (row.accounted === true ? 'Contabilizado' : 'Pendência para contabilização')),
        hasPending: row.has_pending === true, isCommissionPaid: brokerCommissionPaid, isCancelledOrDistrato,
        brokerCommission, expectedRepass: brokerCommission, receivedRepass: received,
        balanceRepass: Math.round((brokerCommission - received) * 100) / 100, repassStatus,
        receipts: payments.map((item) => ({ amount: item.amount, receivedAt: item.receivedAt, voidedAt: item.voidedAt }))
      };
    }
    return { id: row.id, internalNumber: row.internal_number, processNumber: row.process_number || '', leadId: row.lead_id || '', buyerName: row.buyer_name,
      developmentId: row.development_id || '', developmentName: development ? development.name : '', brokerId: row.broker_id,
      brokerName: broker ? broker.name : 'Corretor inativo', sdrId: row.sdr_id || '', sdrName: sdr ? sdr.name : '', soldAt: row.sold_at, unit: row.unit || '', unitValue: Number(row.unit_value || 0),
      saleStatus: ['Contabilizado','Pendência para contabilização'].includes(row.sale_status) ? row.sale_status : (row.sale_status === 'Cancelada' ? 'Cancelada' : (row.accounted === true ? 'Contabilizado' : 'Pendência para contabilização')),
      legacySaleStatus: ['Contabilizado','Pendência para contabilização'].includes(row.sale_status) ? '' : row.sale_status,
      hasPending: row.has_pending === true, pendingDescription: row.pending_description || '',
      accounted: row.accounted === true, accountedAt: row.accounted_at || '', commissionRatePct: row.commission_rate_pct === null || row.commission_rate_pct === undefined ? null : Number(row.commission_rate_pct),
      isSdrSale: row.is_sdr_sale === null || row.is_sdr_sale === undefined ? null : row.is_sdr_sale === true,
      isCommissionPaid, isCancelledOrDistrato,
      grossCommission, brokerCommission, sdrCommission, managerCommissionRatePct: row.manager_commission_rate_pct === null || row.manager_commission_rate_pct === undefined ? null : Number(row.manager_commission_rate_pct),
      managerCommissionValue: Number(row.manager_commission_value || 0), hasPrize: row.has_prize === true,
      prizeRatePct: row.prize_rate_pct === null || row.prize_rate_pct === undefined ? null : Number(row.prize_rate_pct), grossPrize: Number(row.gross_prize || 0),
      brokerPrize: Number(row.broker_prize || 0), sdrPrize: Number(row.sdr_prize || 0), expectedRepass: brokerCommission,
      receivedRepass: received, balanceRepass: Math.round((brokerCommission - received) * 100) / 100,
      repassStatus, notes: row.notes || '', deletedAt: row.deleted_at || '', deletedBy: row.deleted_by || '', receipts: payments.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))) };
  }).sort((a, b) => String(b.soldAt).localeCompare(String(a.soldAt)) || String(b.internalNumber).localeCompare(String(a.internalNumber)));
}

async function apiSaveSale(token, payload = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const allowed = ['id','processNumber','leadId','buyerName','developmentId','brokerId','sdrId','soldAt','unit','unitValue','saleStatus','hasPending','pendingDescription','accounted','expectedRepass','repassStatus','notes','commissionRatePct','managerCommissionRatePct','hasPrize','prizeRatePct','isSdrSale'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some((key) => !allowed.includes(key))) return { ok: false, message: 'Campos da venda inválidos.' };
  const buyerName = String(payload.buyerName || '').trim();
  const processNumber = String(payload.processNumber || '').trim().slice(0, 100);
  const developmentId = String(payload.developmentId || '').trim();
  const brokerId = String(payload.brokerId || '').trim();
  const soldAt = String(payload.soldAt || '').slice(0, 10);
  const unit = String(payload.unit || '').trim().slice(0, 100);
  const saleStatus = String(payload.saleStatus || 'Pendência para contabilização');
  const repassStatus = String(payload.repassStatus || 'FASE DO REGISTRO');
  if (!buyerName || buyerName.length > 150) return { ok: false, message: 'Informe o nome do cliente da venda.' };
  if (!developmentId || !brokerId || !isValidDateOnly(soldAt) || !unit) return { ok: false, message: 'Empreendimento, corretor, data da venda válida e unidade são obrigatórios.' };
  const unitValue = parseMoney(payload.unitValue, 'Valor da unidade');
  const commissionRatePct = parseOptionalPercent(payload.commissionRatePct, 'Percentual de comissão');
  const managerCommissionRatePct = parseOptionalPercent(payload.managerCommissionRatePct, 'Percentual de comissão do gerente');
  const hasPrize = payload.hasPrize === true;
  const prizeRatePct = hasPrize ? parseOptionalPercent(payload.prizeRatePct, 'Percentual do prêmio') : null;
  if (hasPrize && prizeRatePct === null) return { ok: false, message: 'Informe o percentual do prêmio ou desmarque a opção de prêmio.' };
  const pendingDescription = String(payload.pendingDescription || '').trim().slice(0, 2000);
  const notes = String(payload.notes || '').trim().slice(0, 3000);
  const id = String(payload.id || '').trim();
  if (id && !isUuid(id)) return { ok: false, message: 'Venda inválida.' };
  const existingRows = id ? await dbRequest('crm_sales', { query: { select: '*', id: `eq.${id}`, deleted_at: 'is.null', limit: 1 } }) : null;
  const existing = Array.isArray(existingRows) ? existingRows[0] || null : null;
  if (id && !existing) return { ok: false, message: 'Venda não encontrada.' };
  const hasSdrOrigin = Object.prototype.hasOwnProperty.call(payload, 'isSdrSale');
  if (hasSdrOrigin && typeof payload.isSdrSale !== 'boolean') return { ok: false, message: 'Informe se a venda foi originada pelo SDR.' };
  if (!existing && !hasSdrOrigin) return { ok: false, message: 'Informe se a venda foi originada pelo SDR.' };
  const isSdrSale = hasSdrOrigin ? payload.isSdrSale : existing.is_sdr_sale === null || existing.is_sdr_sale === undefined ? null : existing.is_sdr_sale === true;
  const hasSdrSelection = Object.prototype.hasOwnProperty.call(payload, 'sdrId');
  const sdrId = hasSdrSelection ? String(payload.sdrId || '').trim() : String(existing && existing.sdr_id || '').trim();
  if (sdrId && !isUuid(sdrId)) return { ok: false, message: 'Selecione um SDR válido para esta venda.' };
  if (isSdrSale === true && !sdrId) return { ok: false, message: 'Selecione o SDR responsável pela venda para calcular a parte dele.' };
  if (isSdrSale === false && sdrId) return { ok: false, message: 'Esta venda não tem participação do SDR. Remova o SDR selecionado.' };
  if (sdrId && isSdrSale !== true) return { ok: false, message: 'Marque que a venda teve participação do SDR para selecionar um responsável.' };
  const userRows = await listAll('crm_users', { select: '*' });
  const broker = userRows.find((item) => String(item.id) === brokerId && item.role === 'Corretor' && ((item.active === true && !item.deleted_at) || (existing && String(existing.broker_id) === brokerId)));
  if (!broker) return { ok: false, message: 'Selecione um corretor ativo.' };
  const sdr = sdrId ? userRows.find((item) => String(item.id) === sdrId && item.role === 'SDR' && ((item.active === true && !item.deleted_at) || (existing && String(existing.sdr_id) === sdrId))) : null;
  if (sdrId && !sdr) return { ok: false, message: 'Selecione um SDR ativo.' };
  if (!['Contabilizado','Pendência para contabilização'].includes(saleStatus) && !(existing && saleStatus === existing.sale_status)) return { ok: false, message: 'Status da venda inválido.' };
  const legacyRepassStatuses = new Set(['AGUARDANDO PJ','LIBERADO P/ REPASSE','IR FUTURO','PENDÊNCIA PARA LIBERAÇÃO DO REPASSE','REPASSE SFH','ANÁLISE DE CRÉDITO','EMISSÃO DE FORMULÁRIOS','FGTS EM DÉBITO','FGTS EM RESSARCIMENTO','FGTS COM ERRO','FORMULÁRIOS EM ASSINATURA','FORMULÁRIOS ASSINADOS','CRITICADO E ENVIADO P/ CONFORMIDADE','PENDÊNCIA DURANTE O REPASSE','INCONFORME','REANÁLISE DA CONFORMIDADE','CONFORME','AGUARDANDO DEMANDA MÍNIMA','CONFIRMAÇÃO DE VALORES COM CLIENTE','EMISSÃO CONFISSÃO DE DÍVIDA / SOLICITAÇÃO DE CONTRATO','CONTRATO EMITIDO','CONTRATO E CONFISSÃO DE DÍVIDA EM ASSINATURA','CONTRATO EM ASSINATURA E CONFISSÃO ASSINADA','CONTRATO ASSINADO E CONFISSÃO PENDENTE','PROBLEMA NA ASSINATURA DO FINANCIAMENTO','CONTRATO E CONFISSÃO ASSINADOS','CHECK-LIST DE REPASSE APTO PARA CONFERENCIA','AGUARDANDO REPACTUAÇÃO','CHECK-LIST DE REPASSE REPROVADO','CHECK-LIST DE REPASSE APROVADO','Aguardando repasse','Em andamento','Repasse parcial','Repasse concluído','Suspenso','Cancelado']);
  const validNewRepass = CRM_CONFIG.repassStatuses.includes(repassStatus);
  const validUnchangedLegacyRepass = existing && repassStatus === existing.repass_status && legacyRepassStatuses.has(repassStatus);
  if (!validNewRepass && !validUnchangedLegacyRepass) return { ok: false, message: 'Fase do repasse inválida.' };
  if (!existing && commissionRatePct === null) return { ok: false, message: 'Informe o percentual da comissão para calcular automaticamente o valor bruto e a parte do corretor.' };
  const effectiveCommissionRate = commissionRatePct === null && existing && existing.commission_rate_pct !== null && existing.commission_rate_pct !== undefined ? Number(existing.commission_rate_pct) : commissionRatePct;
  const previousBrokerCommission = Number(existing && (existing.broker_commission === null || existing.broker_commission === undefined ? existing.expected_repass : existing.broker_commission) || 0);
  const previousSdrCommission = Number(existing && existing.sdr_commission || 0);
  const storedGrossCommission = Number(existing && existing.gross_commission || 0);
  const effectiveGrossCommission = effectiveCommissionRate === null
    ? storedGrossCommission || Math.round((previousBrokerCommission + previousSdrCommission) * 100) / 100
    : Math.round(unitValue * effectiveCommissionRate) / 100;
  const effectiveCommissionSplit = effectiveGrossCommission > 0
    ? sdrId ? splitMoneyHalf(effectiveGrossCommission) : { first: effectiveGrossCommission, second: 0 }
    : null;
  const effectiveBrokerCommission = effectiveCommissionSplit ? effectiveCommissionSplit.first : null;
  const effectiveSdrCommission = effectiveCommissionSplit ? effectiveCommissionSplit.second : 0;
  const expectedRepass = effectiveBrokerCommission === null
    ? parseMoney(payload.expectedRepass === undefined ? (existing ? existing.expected_repass : 0) : payload.expectedRepass, 'Comissão do corretor')
    : effectiveBrokerCommission;
  const effectiveManagerRate = managerCommissionRatePct === null && existing && existing.manager_commission_rate_pct !== null && existing.manager_commission_rate_pct !== undefined ? Number(existing.manager_commission_rate_pct) : managerCommissionRatePct;
  const effectiveManagerValue = effectiveManagerRate === null ? Number(existing && existing.manager_commission_value || 0) : Math.round(unitValue * effectiveManagerRate) / 100;
  const effectiveHasPrize = Object.prototype.hasOwnProperty.call(payload,'hasPrize') ? hasPrize : existing && existing.has_prize === true;
  const effectivePrizeRate = prizeRatePct === null && effectiveHasPrize && existing && existing.prize_rate_pct !== null && existing.prize_rate_pct !== undefined ? Number(existing.prize_rate_pct) : prizeRatePct;
  const effectiveGrossPrize = effectivePrizeRate === null ? Number(existing && existing.gross_prize || 0) : Math.round(unitValue * effectivePrizeRate) / 100;
  const effectivePrizeSplit = sdrId ? splitMoneyHalf(effectiveGrossPrize) : { first: effectiveGrossPrize, second: 0 };
  const effectiveBrokerPrize = effectivePrizeSplit.first;
  const effectiveSdrPrize = effectivePrizeSplit.second;
  const developmentRows = await listAll('crm_developments', { select: 'id,name,active' });
  if (!developmentRows.some((item) => item.id === developmentId && (item.active === true || (existing && existing.development_id === developmentId)))) return { ok: false, message: 'Selecione um empreendimento ativo.' };
  let lead = null;
  // A tela de controle manual não exige um cliente CRM. Se um registro já tiver
  // sido vinculado por uma integração futura, uma edição manual preserva o vínculo.
  const leadId = Object.prototype.hasOwnProperty.call(payload, 'leadId')
    ? String(payload.leadId || '').trim()
    : String(existing && existing.lead_id || '').trim();
  if (leadId && (Object.prototype.hasOwnProperty.call(payload, 'leadId') || !existing)) {
    if (!isUuid(leadId)) return { ok: false, message: 'Cliente vinculado inválido.' };
    const leadRows = await dbRequest('crm_leads', { query: { select: 'id,name,broker_id,deleted_at', id: `eq.${leadId}`, limit: 1 } });
    lead = Array.isArray(leadRows) ? leadRows[0] : null;
    if (!lead || lead.deleted_at) return { ok: false, message: 'O cliente vinculado não está disponível.' };
    if (String(lead.broker_id) !== brokerId) return { ok: false, message: 'O corretor da venda precisa ser o responsável pelo cliente vinculado.' };
  }
  const accounted = saleStatus === 'Contabilizado';
  const stamp = now();
  const values = { process_number: processNumber, lead_id: leadId || null, buyer_name: buyerName, development_id: developmentId, broker_id: brokerId, sdr_id: sdrId || null,
    sold_at: soldAt, unit, unit_value: unitValue, sale_status: saleStatus, has_pending: payload.hasPending === true,
    is_sdr_sale: isSdrSale,
    pending_description: pendingDescription, accounted, accounted_at: accounted ? (existing && existing.accounted_at || stamp) : null,
    accounted_by: accounted ? (existing && existing.accounted ? existing.accounted_by : actor.id) : null, expected_repass: expectedRepass, repass_status: repassStatus,
    commission_rate_pct: effectiveCommissionRate, gross_commission: effectiveGrossCommission, broker_commission: effectiveBrokerCommission === null ? Number(existing && existing.broker_commission === null ? existing.expected_repass : existing && existing.broker_commission || expectedRepass) : effectiveBrokerCommission,
    sdr_commission: effectiveSdrCommission, manager_commission_rate_pct: effectiveManagerRate, manager_commission_value: effectiveManagerValue,
    has_prize: Boolean(effectiveHasPrize), prize_rate_pct: effectiveHasPrize ? effectivePrizeRate : null, gross_prize: effectiveHasPrize ? effectiveGrossPrize : 0,
    broker_prize: effectiveHasPrize ? effectiveBrokerPrize : 0, sdr_prize: effectiveHasPrize ? effectiveSdrPrize : 0,
    notes, updated_at: stamp, updated_by: actor.id };
  const before = existing ? { internalNumber: existing.internal_number, processNumber: existing.process_number || '', leadId: existing.lead_id || '', buyerName: existing.buyer_name, developmentId: existing.development_id, brokerId: existing.broker_id, sdrId: existing.sdr_id || '', soldAt: existing.sold_at, unit: existing.unit, unitValue: Number(existing.unit_value), saleStatus: existing.sale_status, hasPending: existing.has_pending, isSdrSale: existing.is_sdr_sale ?? null, pendingDescription: existing.pending_description, accounted: existing.accounted, expectedRepass: Number(existing.expected_repass), commissionRatePct: existing.commission_rate_pct, grossCommission: existing.gross_commission, brokerCommission: existing.broker_commission, managerCommissionRatePct: existing.manager_commission_rate_pct, managerCommissionValue: existing.manager_commission_value, hasPrize: existing.has_prize, prizeRatePct: existing.prize_rate_pct, grossPrize: existing.gross_prize, repassStatus: existing.repass_status, notes: existing.notes } : {};
  const after = { processNumber, leadId: leadId || '', buyerName, developmentId, brokerId, sdrId, soldAt, unit, unitValue, saleStatus, hasPending: payload.hasPending === true, isSdrSale, pendingDescription, accounted, expectedRepass,
    commissionRatePct: values.commission_rate_pct, grossCommission: values.gross_commission, brokerCommission: values.broker_commission, sdrCommission: values.sdr_commission,
    managerCommissionRatePct: values.manager_commission_rate_pct, managerCommissionValue: values.manager_commission_value, hasPrize: values.has_prize, prizeRatePct: values.prize_rate_pct, grossPrize: values.gross_prize, repassStatus, notes };
  const changedFields = auditChangedFields(before, after);
  if (existing && !changedFields.length) {
    let link = null; let syncFailed = false;
    try { link = await reconcileSaleProduction(existing, existing, actor); } catch (_) { syncFailed = true; }
    return { ok: true, saleId: existing.id, internalNumber: existing.internal_number,
      message: 'Nenhuma alteração detectada.' + saleProductionAdjustmentNotice(existing, existing, link, syncFailed) };
  }
  let saved;
  if (existing) {
    const response = await dbRequest('crm_sales', { method: 'PATCH', query: { id: `eq.${id}` }, prefer: 'return=representation', body: values });
    saved = Array.isArray(response) ? response[0] : null;
  } else {
    const year = soldAt.slice(0, 4);
    const internalNumber = `MA-VENDA-${year}-${randomBytes(5).toString('hex').toUpperCase()}`;
    const response = await dbRequest('crm_sales', { method: 'POST', prefer: 'return=representation', body: { ...values, internal_number: internalNumber, created_by: actor.id, created_at: stamp } });
    saved = Array.isArray(response) ? response[0] : response;
  }
  if (!saved) throw new HttpError(502, 'Não foi possível salvar a venda.');
  after.internalNumber = saved.internal_number;
  await audit(actor, existing ? 'sale.update' : 'sale.create', 'sale', saved.id, auditChangedFields(before, after), before, after);
  let productionLink = null; let productionSyncFailed = false;
  try { productionLink = await reconcileSaleProduction(saved, existing, actor); } catch (_) { productionSyncFailed = true; }
  const baseMessage = existing ? 'Venda atualizada.' : `Venda cadastrada com o número ${saved.internal_number}.`;
  return { ok: true, saleId: saved.id, internalNumber: saved.internal_number,
    message: baseMessage + saleProductionAdjustmentNotice(saved, existing, productionLink, productionSyncFailed) };
}

async function apiArchiveSale(token, saleId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(saleId)) return { ok: false, message: 'Venda inválida.' };
  const rows = await dbRequest('crm_sales', { query: { select: '*', id: `eq.${saleId}`, deleted_at: 'is.null', limit: 1 } });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ok: false, message: 'Venda não encontrada ou já excluída.' };
  const stamp = now();
  const updated = await dbRequest('crm_sales', { method: 'PATCH', query: { id: `eq.${saleId}`, deleted_at: 'is.null' }, prefer: 'return=representation', body: { deleted_at: stamp, deleted_by: actor.id, updated_at: stamp, updated_by: actor.id } });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'A venda foi alterada por outro usuário. Atualize a tela.' };
  await audit(actor, 'sale.archive', 'sale', saleId, ['deletedAt'], { deletedAt: null, processNumber: row.process_number, buyerName: row.buyer_name }, { deletedAt: stamp, processNumber: row.process_number, buyerName: row.buyer_name, receiptsPreserved: true });
  let link = null; let syncFailed = false;
  try { link = await reconcileSaleProduction(updated[0], row, actor); } catch (_) { syncFailed = true; }
  return { ok: true, message: 'Venda excluída da visão ativa e preservada com contratos, recebimentos e histórico. Ela pode ser restaurada pela gestão.' + saleProductionAdjustmentNotice(updated[0], row, link, syncFailed) };
}

async function apiRestoreSale(token, saleId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(saleId)) return { ok: false, message: 'Venda inválida.' };
  const rows = await dbRequest('crm_sales', { query: { select: '*', id: `eq.${saleId}`, deleted_at: 'not.is.null', limit: 1 } });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ok: false, message: 'Venda excluída não encontrada.' };
  const stamp = now();
  const updated = await dbRequest('crm_sales', { method: 'PATCH', query: { id: `eq.${saleId}`, deleted_at: 'not.is.null' }, prefer: 'return=representation', body: { deleted_at: null, deleted_by: null, updated_at: stamp, updated_by: actor.id } });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'A venda foi alterada por outro usuário. Atualize a tela.' };
  await audit(actor, 'sale.restore', 'sale', saleId, ['deletedAt'], { deletedAt: row.deleted_at, processNumber: row.process_number, buyerName: row.buyer_name }, { deletedAt: null, processNumber: row.process_number, buyerName: row.buyer_name, receiptsPreserved: true });
  let syncNotice = '';
  try {
    const link = await reconcileSaleProduction(updated[0], row, actor);
    syncNotice = saleProductionAdjustmentNotice(updated[0], row, link);
  }
  catch (_) { syncNotice = ' Não foi possível confirmar o vínculo desta venda com a produção; confira os indicadores.'; }
  return { ok: true, message: 'Venda restaurada para a visão ativa. O histórico e os documentos vinculados foram preservados.' + syncNotice };
}

async function apiAddSaleReceipt(token, saleId, payload = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(saleId)) return { ok: false, message: 'Venda inválida.' };
  const receivedAt = String(payload.receivedAt || '').slice(0, 10);
  const notes = String(payload.notes || '').trim().slice(0, 1000);
  if (!isValidDateOnly(receivedAt)) return { ok: false, message: 'Informe uma data válida para o recebimento integral.' };
  const response = await dbRequest('rpc/crm_add_sale_receipt_full', { method: 'POST', body: { p_sale_id: saleId, p_actor_id: actor.id, p_received_at: receivedAt, p_notes: notes } });
  const result = Array.isArray(response) ? response[0] : response;
  if (!result) throw new HttpError(502, 'Não foi possível registrar o recebimento.');
  const amount = Number(result.amount || 0);
  const beforeValues = { receivedAmount: Math.round((Number(result.received_total) - amount) * 100) / 100, balanceRepass: Number(result.balance) + amount };
  const afterValues = { receivedAmount: Number(result.received_total), receivedAt, balanceRepass: Number(result.balance), notes };
  await audit(actor, 'sale.receipt.create', 'sale', saleId, auditChangedFields(beforeValues, afterValues), beforeValues, afterValues);
  await audit(actor, 'sale.repass.phase_auto_paid', 'sale', saleId, ['repassStatus'], { repassStatus: result.previous_status }, { repassStatus: 'COMISSÃO PAGA', receivedAt });
  return { ok: true, message: 'Recebimento integral registrado. A fase do repasse foi atualizada para COMISSÃO PAGA.', totalReceived: Number(result.received_total), balance: Number(result.balance), repassStatus: result.repass_status };
}

async function apiVoidSaleReceipt(token, receiptId, payload = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(receiptId)) return { ok: false, message: 'Recebimento inválido.' };
  const reason = String(payload.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000) return { ok: false, message: 'Informe uma justificativa entre 5 e 1.000 caracteres.' };
  const response = await dbRequest('rpc/crm_void_sale_receipt', {
    method: 'POST', body: { p_receipt_id: receiptId, p_actor_id: actor.id, p_reason: reason }
  });
  const result = Array.isArray(response) ? response[0] : response;
  if (!result) throw new HttpError(502, 'Não foi possível corrigir o recebimento.');
  const totalBefore = Number(result.previous_received_total);
  const totalAfter = Number(result.received_total);
  const amount = Number(result.amount);
  const balance = Number(result.balance);
  await audit(actor, 'sale.receipt.void', 'sale', result.sale_id,
    ['recebimento','repasse_recebido','saldo_repasse','motivo'],
    { receiptId, receivedAmount: totalBefore, balanceRepass: balance - amount },
    { receiptId, voidedAmount: amount, receivedAmount: totalAfter, balanceRepass: balance, receivedAt: result.received_at, reason });
  return { ok: true, message: result.phase_restored ? 'Recebimento anulado com justificativa. A fase anterior do repasse foi restaurada e o histórico foi preservado.' : 'Recebimento anulado com justificativa; o histórico foi preservado. A fase foi mantida porque já havia sido alterada depois do lançamento.', totalReceived: totalAfter, balance, repassStatus: result.repass_status };
}

async function apiListBrokerProfiles(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const [profiles, users] = await Promise.all([listAll('crm_user_contract_profiles', { select: '*' }), listAll('crm_users', { select: 'id,name,email,role,active,deleted_at' })]);
  const brokers = users.filter((item) => item.role === 'Corretor' && !item.deleted_at);
  return brokers.map((item) => {
    const profile = profiles.find((row) => row.user_id === item.id) || {};
    return { brokerId: item.id, name: item.name, email: item.email, cpf: profile.cpf || '', cnpj: profile.cnpj || '', creci: profile.creci || '', address: profile.address || '', updatedAt: profile.updated_at || '' };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function apiSaveBrokerProfile(token, payload = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const brokerId = String(payload.brokerId || '').trim();
  if (!isUuid(brokerId)) return { ok: false, message: 'Corretor inválido.' };
  const users = await listAll('crm_users', { select: 'id,role,deleted_at' });
  if (!users.some((item) => item.id === brokerId && item.role === 'Corretor' && !item.deleted_at)) return { ok: false, message: 'Corretor não encontrado.' };
  const fields = { cpf: String(payload.cpf || '').trim().slice(0, 30), cnpj: String(payload.cnpj || '').trim().slice(0, 30), creci: String(payload.creci || '').trim().slice(0, 60), address: String(payload.address || '').trim().slice(0, 500) };
  const saved = await saveTeamContractProfile(actor, brokerId, fields);
  return { ok: true, profile: saved.profile, message: saved.changedFields.length ? 'Dados cadastrais do corretor salvos no cadastro da equipe.' : 'Nenhuma alteração detectada.' };
}

const DEFAULT_CONTRACT_TEMPLATE_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Termo de acordo operacional e divisão de remuneração</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: Arial, sans-serif; color: #263548; font-size: 10pt; line-height: 1.35; }
    h1 { font-size: 16pt; margin: 0 0 3px; }
    .brand { font-weight: bold; color: #526276; margin-bottom: 15px; }
    .date { text-align: right; margin-top: -32px; margin-bottom: 20px; }
    h2 { background: #eaf0f5; padding: 7px 9px; font-size: 11pt; margin: 14px 0 7px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    td { width: 50%; vertical-align: top; padding: 5px 8px 7px; border-bottom: 1px solid #91a0b0; }
    .label { display: block; color: #526276; font-weight: bold; font-size: 9pt; margin-bottom: 3px; }
    .value { min-height: 16px; display: block; }
    .terms p { margin: 7px 0; text-align: justify; }
    .signatures td { height: 45px; vertical-align: bottom; }
    .footer { margin-top: 24px; color: #526276; font-size: 8pt; }
  </style>
</head>
<body>
  <h1>TERMO DE ACORDO OPERACIONAL E DIVISÃO DE REMUNERAÇÃO</h1>
  <div class="brand">PROJETO SDR SHARKS | MUNDO APTO</div>
  <div class="date"><span class="label">Data</span>{{data_geracao}}</div>
  <h2>1. IDENTIFICAÇÃO DA OPERAÇÃO</h2>
  <table><tr><td><span class="label">Cliente comprador</span><span class="value">{{cliente_nome}}</span></td><td><span class="label">CPF do cliente</span><span class="value">{{cliente_cpf}}</span></td></tr>
  <tr><td><span class="label">Empreendimento</span><span class="value">{{empreendimento}}</span></td><td><span class="label">Unidade / Torre</span><span class="value">{{unidade}}</span></td></tr>
  <tr><td><span class="label">Valor da venda (R$)</span><span class="value">{{valor_unidade}}</span></td><td><span class="label">Nº da proposta / pasta</span><span class="value">{{numero_proposta}}</span></td></tr></table>
  <h2>2. PARTICIPANTES</h2>
  <table><tr><td><span class="label">Corretor responsável</span><span class="value">{{corretor_nome}}</span></td><td><span class="label">CRECI</span><span class="value">{{corretor_creci}}</span></td></tr>
  <tr><td><span class="label">CPF do corretor</span><span class="value">{{corretor_cpf}}</span></td><td><span class="label">SDR</span><span class="value">{{sdr_nome}}</span></td></tr>
  <tr><td><span class="label">CNPJ do corretor</span><span class="value">{{corretor_cnpj}}</span></td><td><span class="label">Endereço do corretor</span><span class="value">{{corretor_endereco}}</span></td></tr>
  <tr><td><span class="label">CPF do SDR</span><span class="value">{{sdr_cpf}}</span></td><td><span class="label">Gestor</span><span class="value">{{gerente_nome}}</span></td></tr></table>
  <h2>3. COMISSÃO E PRÊMIO</h2>
  <table><tr><td><span class="label">Comissão total (percentual: {{percentual_comissao}})</span><span class="value">{{comissao_bruta}}</span></td><td><span class="label">Base de cálculo</span><span class="value">{{base_calculo_comissao}}</span></td></tr>
  <tr><td><span class="label">Corretor — 50%</span><span class="value">{{comissao_corretor}}</span></td><td><span class="label">SDR — 50%</span><span class="value">{{comissao_sdr}}</span></td></tr>
  <tr><td><span class="label">Gerente — percentual / valor</span><span class="value">{{percentual_comissao_gerente}} / {{comissao_gerente}}</span></td><td><span class="label">Divisão corretor / SDR</span><span class="value">50% para cada</span></td></tr>
  <tr><td><span class="label">Prêmio aplicável?</span><span class="value">{{premio_aplicavel}}</span></td><td><span class="label">Percentual do prêmio / Prêmio total</span><span class="value">{{percentual_premio}} / {{premio_bruto}}</span></td></tr>
  <tr><td><span class="label">Prêmio corretor — 50%</span><span class="value">{{premio_corretor}}</span></td><td><span class="label">Prêmio SDR — 50%</span><span class="value">{{premio_sdr}}</span></td></tr></table>
  <h2>4. CONDIÇÕES E ACEITE DO ACORDO</h2>
  <div class="terms">
    <p>Este termo formaliza acordo operacional específico, livremente aceito pelos signatários, relativo à operação identificada. O corretor reconhece a participação operacional do SDR e aceita a divisão de valores aqui discriminada, não lhe cabendo exigir dos demais signatários a integralidade da mesma remuneração ou quantias adicionais incompatíveis com este ajuste.</p>
    <p>A quitação será concedida em relação aos valores efetivamente pagos, mediante comprovante, sem alcançar obrigações não cumpridas ou direitos indisponíveis. A remuneração observará as exigências legais e de habilitação profissional aplicáveis.</p>
    <p>Sobre os valores sujeitos a repasse haverá desconto correspondente à alíquota tributária vigente e efetivamente incidente sobre a nota fiscal emitida pelo gerente, quando legalmente aplicável. A alíquota, a base de cálculo, o valor descontado e o valor líquido pago serão discriminados no recibo de recebimento de comissões, vedada cobrança tributária duplicada.</p>
  </div>
  <h2>5. ASSINATURAS</h2>
  <table class="signatures"><tr><td>{{corretor_nome}}<br>Corretor responsável</td><td>{{sdr_nome}}<br>SDR</td></tr><tr><td colspan="2">{{gerente_nome}}<br>Gestor</td></tr></table>
  <div class="footer">Instrumento operacional sujeito às regras legais, tributárias e profissionais aplicáveis.</div>
</body>
</html>`;

function normalizeContractDocumentKind(value) {
  const kind = String(value || 'agreement').trim();
  if (!['agreement', 'debt_confession'].includes(kind)) throw new HttpError(400, 'Tipo de documento contratual inválido.');
  return kind;
}

function contractTemplateSettingKey(kind) {
  return kind === 'debt_confession' ? 'debt_confession_template_html' : 'contract_template_html';
}

const CONTRACT_PLACEHOLDERS = [
  '{{numero_contrato}}','{{numero_processo}}','{{numero_proposta}}','{{cliente_nome}}','{{cliente_cpf}}','{{cliente_endereco}}',
  '{{empreendimento}}','{{unidade}}','{{valor_unidade}}','{{corretor_nome}}','{{corretor_cpf}}','{{corretor_cnpj}}',
  '{{corretor_creci}}','{{corretor_endereco}}','{{sdr_nome}}','{{sdr_cpf}}','{{sdr_cnpj}}','{{sdr_creci}}','{{sdr_endereco}}','{{gerente_nome}}','{{percentual_comissao}}',
  '{{base_calculo_comissao}}','{{comissao_bruta}}','{{comissao_corretor}}','{{comissao_sdr}}','{{percentual_comissao_gerente}}','{{comissao_gerente}}','{{premio_aplicavel}}',
  '{{percentual_premio}}','{{premio_bruto}}','{{premio_corretor}}','{{premio_sdr}}','{{data_geracao}}'
];

async function apiGetContractTemplate(token, options = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const kind = normalizeContractDocumentKind(typeof options === 'string' ? options : options && options.kind);
  const key = contractTemplateSettingKey(kind);
  const rows = await dbRequest('crm_settings', { query: { select: 'value', key: `eq.${key}`, limit: 1 } });
  const value = Array.isArray(rows) && rows[0] ? rows[0].value : '';
  const savedTemplate = typeof value === 'string' ? value : value && value.html || '';
  const hasSavedTemplate = Boolean(String(savedTemplate || '').trim());
  const template = kind === 'agreement' && !hasSavedTemplate ? DEFAULT_CONTRACT_TEMPLATE_HTML : String(savedTemplate || '');
  return { kind, template, configured: Boolean(template.trim()), source: hasSavedTemplate ? 'saved_by_admin' : kind === 'agreement' ? 'built_in_initial' : 'not_configured', placeholders: CONTRACT_PLACEHOLDERS };
}

async function apiListContractLeads(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const context = await loadLeadContext();
  return context.leads.map((lead) => ({ id: lead.id, name: lead.name, phone: lead.phone, developmentId: lead.developmentId, brokerId: lead.brokerId, brokerName: lead.brokerName, status: lead.status }));
}

function sanitizeContractTemplate(value) {
  const template = String(value || '').trim();
  if (!template || template.length > 100000) throw new HttpError(400, 'O modelo deve ter entre 1 e 100.000 caracteres.');
  if (/<\s*(script|iframe|object|embed|form|svg|video|audio|link)\b|\son[a-z]+\s*=|javascript:|(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\/|url\s*\(|@import|<meta\b[^>]*http-equiv/i.test(template)) throw new HttpError(400, 'O modelo contém conteúdo ativo ou referência externa não permitida. Use conteúdo e estilos incorporados no próprio documento.');
  return template;
}

async function apiSaveContractTemplate(token, payload) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const options = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { html: payload };
  const kind = normalizeContractDocumentKind(options.kind || 'agreement');
  if (kind !== 'agreement') return { ok: false, message: 'A plataforma permite configurar somente o modelo do Termo Fifty para novas gerações.' };
  const template = sanitizeContractTemplate(options.html);
  const key = contractTemplateSettingKey(kind);
  const previous = await apiGetContractTemplate(token, { kind });
  await dbRequest('crm_settings', { method: 'POST', query: { on_conflict: 'key' }, prefer: 'resolution=merge-duplicates,return=minimal', body: { key, value: template, updated_at: now() } });
  const templateSnapshot = (value) => ({
    sha256: createHash('sha256').update(String(value || '')).digest('hex'),
    characters: String(value || '').length,
    content: String(value || '')
  });
  await audit(actor, 'contract_template.update', 'setting', key, ['template'], { kind, template: templateSnapshot(previous.template) }, { kind, template: templateSnapshot(template) });
  return { ok: true, kind, message: `${kind === 'agreement' ? 'Modelo de contrato/termo' : 'Modelo de confissão de dívida'} salvo. O texto deve ser aprovado pela empresa antes de ser usado.` };
}

async function apiSaveContract(token, payload = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const id = String(payload.id || '').trim();
  const allowed = ['id','leadId','brokerId','sdrId','sdrCpf','managerId','buyerName','buyerCpf','buyerAddress','developmentId','unit','unitValue','proposalNumber','commissionBase','commissionRatePct','grossCommission','managerCommissionRatePct','managerCommissionValue','hasPrize','prizeRatePct','grossPrize'];
  allowed.push('saleId','processNumber');
  if (Object.keys(payload).some((key) => !allowed.includes(key))) return { ok: false, message: 'Campos do contrato inválidos.' };
  const saleId = String(payload.saleId || '').trim();
  if (saleId && !isUuid(saleId)) return { ok: false, message: 'Venda vinculada inválida.' };
  let sale = null;
  if (saleId) {
    const saleRows = await dbRequest('crm_sales', { query: { select: '*', id: `eq.${saleId}`, deleted_at: 'is.null', limit: 1 } });
    sale = Array.isArray(saleRows) ? saleRows[0] || null : null;
    if (!sale || salesIsCancelled(sale)) return { ok: false, message: 'A venda vinculada não está disponível para gerar documentos.' };
  }
  if (!sale) return { ok: false, message: 'O Termo Fifty precisa estar vinculado a uma venda registrada.' };
  if (sale.is_sdr_sale !== true) return { ok: false, message: 'O Termo Fifty só pode ser gerado quando a venda estiver marcada com participação do SDR.' };
  let lead = null;
  let leadId = sale ? String(sale.lead_id || '').trim() : String(payload.leadId || '').trim();
  if (sale && payload.leadId && String(payload.leadId) !== leadId) return { ok: false, message: 'O cliente vinculado precisa corresponder à venda selecionada.' };
  if (!sale && leadId) {
    if (!isUuid(leadId)) return { ok: false, message: 'Cliente vinculado inválido.' };
    const leads = await dbRequest('crm_leads', { query: { select: 'id,name,phone,broker_id,development_id,deleted_at', id: `eq.${leadId}`, limit: 1 } });
    lead = Array.isArray(leads) ? leads[0] : null;
    if (!lead || lead.deleted_at) return { ok: false, message: 'Cliente não encontrado.' };
  }
  const users = await listAll('crm_users', { select: 'id,name,role,active,deleted_at' });
  const brokerId = String(sale ? sale.broker_id : payload.brokerId || lead && lead.broker_id || '').trim();
  if (sale && payload.brokerId && String(payload.brokerId) !== brokerId) return { ok: false, message: 'O corretor do contrato precisa corresponder ao corretor responsável pela venda.' };
  const requestedSdrId = String(payload.sdrId || '').trim();
  const savedSdrId = String(sale.sdr_id || '').trim();
  const broker = users.find((item) => item.id === brokerId && item.role === 'Corretor' && !item.deleted_at && (item.active || sale && String(sale.broker_id) === brokerId));
  const sdr = users.find((item) => item.id === requestedSdrId && item.role === 'SDR' && item.active && !item.deleted_at);
  const manager = users.find((item) => item.id === String(payload.managerId || actor.id) && ['Gerente','Administrador'].includes(item.role) && item.active && !item.deleted_at);
  if (!broker || lead && broker.id !== lead.broker_id) return { ok: false, message: 'Selecione o corretor responsável pela venda ou pela carteira do cliente.' };
  if (!sdr) return { ok: false, message: 'Selecione o SDR que assinará o documento.' };
  if (!manager) return { ok: false, message: 'Selecione um gerente ou administrador como signatário.' };
  const needsSdrAssignment = Boolean(sale && savedSdrId !== sdr.id);
  let existingDraft = null;
  if (id) {
    if (!isUuid(id)) return { ok: false, message: 'Contrato inválido.' };
    const draftRows = await dbRequest('crm_contracts', { query: { select: '*', id: `eq.${id}`, limit: 1 } });
    existingDraft = Array.isArray(draftRows) ? draftRows[0] || null : null;
    if (!existingDraft || existingDraft.status !== 'Rascunho') return { ok: false, message: 'Somente rascunhos podem ser editados.' };
  }
  const partyProfiles = await listAll('crm_user_contract_profiles', { select: '*' });
  const brokerProfile = (partyProfiles || []).find((item) => item.user_id === broker.id) || {};
  const sdrProfile = (partyProfiles || []).find((item) => item.user_id === sdr.id) || {};
  const developmentId = String(sale ? sale.development_id : payload.developmentId || lead && lead.development_id || '').trim();
  if (sale && payload.developmentId && String(payload.developmentId) !== developmentId) return { ok: false, message: 'O empreendimento do contrato precisa corresponder à venda selecionada.' };
  const developments = await listAll('crm_developments', { select: 'id,name,active' });
  const development = developments.find((item) => item.id === developmentId && (item.active || sale && item.id === developmentId));
  if (!development) return { ok: false, message: 'Selecione um empreendimento válido.' };
  const unit = String(sale ? sale.unit : payload.unit || '').trim().slice(0, 100);
  if (sale && payload.unit && String(payload.unit).trim() !== unit) return { ok: false, message: 'A unidade do contrato precisa corresponder à venda selecionada.' };
  if (!unit) return { ok: false, message: 'Informe a unidade escolhida.' };
  const saleBuyerName = sale ? sale.buyer_name : lead && lead.name;
  const saleUnitValue = sale ? Number(sale.unit_value || 0) : null;
  const contractUnitValue = sale ? parseMoney(sale.unit_value, 'Valor da unidade') : parseMoney(payload.unitValue, 'Valor da unidade');
  const inputCommissionRate = parseOptionalPercent(payload.commissionRatePct, 'Percentual da comissão');
  const commissionRate = sale && sale.commission_rate_pct !== null && sale.commission_rate_pct !== undefined ? Number(sale.commission_rate_pct) : inputCommissionRate;
  const storedSaleGross = sale && sale.gross_commission !== null && sale.gross_commission !== undefined ? Number(sale.gross_commission) : null;
  const grossCommission = storedSaleGross !== null && storedSaleGross > 0 ? storedSaleGross
    : commissionRate !== null ? Math.round(contractUnitValue * commissionRate) / 100 : parseMoney(payload.grossCommission, 'Comissão bruta');
  const inputPrizeRate = payload.hasPrize === true ? parseOptionalPercent(payload.prizeRatePct, 'Percentual do prêmio') : null;
  const prizeRate = sale && sale.prize_rate_pct !== null && sale.prize_rate_pct !== undefined ? Number(sale.prize_rate_pct) : inputPrizeRate;
  const grossPrize = payload.hasPrize === true ? (sale && Number(sale.gross_prize || 0) > 0 ? Number(sale.gross_prize) : prizeRate !== null ? Math.round(contractUnitValue * prizeRate) / 100 : parseMoney(payload.grossPrize, 'Prêmio bruto')) : 0;
  const inputManagerRate = parseOptionalPercent(payload.managerCommissionRatePct, 'Percentual da comissão do gerente');
  const hasManagerRateInput = Object.prototype.hasOwnProperty.call(payload, 'managerCommissionRatePct');
  const draftManagerRate = existingDraft && existingDraft.manager_commission_rate_pct !== null && existingDraft.manager_commission_rate_pct !== undefined
    ? Number(existingDraft.manager_commission_rate_pct) : null;
  const managerRate = sale && sale.manager_commission_rate_pct !== null && sale.manager_commission_rate_pct !== undefined
    ? Number(sale.manager_commission_rate_pct)
    : hasManagerRateInput ? inputManagerRate : draftManagerRate;
  const hasManagerValueInput = Object.prototype.hasOwnProperty.call(payload, 'managerCommissionValue');
  const managerValue = sale && Number(sale.manager_commission_value || 0) > 0
    ? Number(sale.manager_commission_value)
    : managerRate !== null ? Math.round(contractUnitValue * managerRate) / 100
      : hasManagerValueInput ? parseMoney(payload.managerCommissionValue, 'Comissão do gerente')
        : Number(existingDraft && existingDraft.manager_commission_value || 0);
  const values = { sale_id: saleId || null, lead_id: leadId || null, process_number: String(sale ? sale.process_number || '' : payload.processNumber || '').trim().slice(0, 100),
    broker_id: broker.id, sdr_id: sdr.id, manager_id: manager.id,
    broker_cpf: brokerProfile.cpf || existingDraft && existingDraft.broker_cpf || '', broker_cnpj: brokerProfile.cnpj || existingDraft && existingDraft.broker_cnpj || '',
    broker_creci: brokerProfile.creci || existingDraft && existingDraft.broker_creci || '', broker_address: brokerProfile.address || existingDraft && existingDraft.broker_address || '',
    sdr_cpf: sdrProfile.cpf || String(payload.sdrCpf || '').trim().slice(0, 30) || existingDraft && existingDraft.sdr_cpf || '',
    sdr_cnpj: sdrProfile.cnpj || existingDraft && existingDraft.sdr_cnpj || '', sdr_creci: sdrProfile.creci || existingDraft && existingDraft.sdr_creci || '',
    sdr_address: sdrProfile.address || existingDraft && existingDraft.sdr_address || '',
    buyer_name: String(sale ? saleBuyerName : payload.buyerName || saleBuyerName || '').trim().slice(0, 150), buyer_cpf: String(payload.buyerCpf || '').trim().slice(0, 30),
    buyer_address: String(payload.buyerAddress || '').trim().slice(0, 500), development_id: developmentId, unit,
    proposal_number: String(payload.proposalNumber || '').trim().slice(0, 100),
    unit_value: contractUnitValue, commission_base: contractUnitValue,
    commission_rate_pct: commissionRate, gross_commission: grossCommission,
    manager_commission_rate_pct: managerRate, manager_commission_value: managerValue,
    has_prize: payload.hasPrize === true, prize_rate_pct: payload.hasPrize === true ? prizeRate : null,
    gross_prize: grossPrize, updated_at: now(), updated_by: actor.id };
  if (!values.buyer_name) return { ok: false, message: 'Informe o nome do cliente.' };
  if (values.unit_value <= 0) return { ok: false, message: 'O valor da venda precisa ser maior que zero.' };
  if (values.gross_commission <= 0) return { ok: false, message: 'Informe a comissão bruta total da operação.' };
  if (values.has_prize && values.gross_prize <= 0) return { ok: false, message: 'Informe o percentual do prêmio ou desmarque a opção de prêmio.' };
  if (needsSdrAssignment) {
    const [existingReceipts, existingContracts] = await Promise.all([
      dbRequest('crm_commission_documents', { query: { select: 'id', sale_id: `eq.${sale.id}`, document_type: 'eq.commission_receipt', limit: 1 } }),
      dbRequest('crm_contracts', { query: { select: 'id,sdr_id,status', sale_id: `eq.${sale.id}`, deleted_at: 'is.null' } })
    ]);
    if (Array.isArray(existingReceipts) && existingReceipts.length) return { ok: false, message: 'Esta venda já tem recibos vinculados. Para preservar os documentos financeiros, corrija o SDR na venda antes de gerar o Termo Fifty.' };
    const conflictingContract = (existingContracts || []).find((item) => String(item.id) !== id && item.status !== 'Cancelado' && String(item.sdr_id || '') !== sdr.id);
    if (conflictingContract) return { ok: false, message: 'Já existe outro Termo Fifty ativo para esta venda com um SDR diferente. Edite ou exclua o rascunho existente antes de trocar o participante.' };
    const saleQuery = { id: 'eq.' + sale.id, is_sdr_sale: 'eq.true', deleted_at: 'is.null', sdr_id: savedSdrId ? `eq.${savedSdrId}` : 'is.null' };
    const updatedSale = await dbRequest('crm_sales', { method: 'PATCH', query: saleQuery, prefer: 'return=representation', body: { sdr_id: sdr.id, updated_at: now(), updated_by: actor.id } });
    if (!Array.isArray(updatedSale) || !updatedSale.length) return { ok: false, message: 'Não foi possível registrar o SDR selecionado na venda. Atualize a tela e tente novamente.' };
    sale.sdr_id = sdr.id;
    await audit(actor, 'sale.sdr.assign_for_fifty_term', 'sale', sale.id, ['sdrId'], { sdrId: savedSdrId }, { sdrId: sdr.id, isSdrSale: true });
  }
  let existing = null;
  let beforeValues = {};
  if (id) {
    existing = existingDraft;
    beforeValues = { contractNumber: existing.contract_number, sale_id: existing.sale_id || null, lead_id: existing.lead_id || null, process_number: existing.process_number || '', broker_id: existing.broker_id, sdr_id: existing.sdr_id, manager_id: existing.manager_id,
      broker_cpf: existing.broker_cpf || '', broker_cnpj: existing.broker_cnpj || '', broker_creci: existing.broker_creci || '', broker_address: existing.broker_address || '',
      sdr_cpf: existing.sdr_cpf || '', sdr_cnpj: existing.sdr_cnpj || '', sdr_creci: existing.sdr_creci || '', sdr_address: existing.sdr_address || '', buyer_name: existing.buyer_name, buyer_cpf: existing.buyer_cpf, buyer_address: existing.buyer_address, development_id: existing.development_id,
      unit: existing.unit, proposal_number: existing.proposal_number || '', unit_value: Number(existing.unit_value), commission_base: Number(existing.commission_base || 0), commission_rate_pct: existing.commission_rate_pct === null ? null : Number(existing.commission_rate_pct),
      gross_commission: Number(existing.gross_commission), manager_commission_rate_pct: existing.manager_commission_rate_pct === null ? null : Number(existing.manager_commission_rate_pct), manager_commission_value: Number(existing.manager_commission_value || 0),
      has_prize: existing.has_prize, prize_rate_pct: existing.prize_rate_pct === null ? null : Number(existing.prize_rate_pct), gross_prize: Number(existing.gross_prize) };
    const result = await dbRequest('crm_contracts', { method: 'PATCH', query: { id: `eq.${id}` }, prefer: 'return=representation', body: values });
    existing = Array.isArray(result) ? result[0] : existing;
  } else {
    const contractNumber = `MA-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`;
    const result = await dbRequest('crm_contracts', { method: 'POST', prefer: 'return=representation', body: { ...values, contract_number: contractNumber, created_by: actor.id, created_at: now(), status: 'Rascunho' } });
    existing = Array.isArray(result) ? result[0] : result;
  }
  if (!existing) throw new HttpError(502, 'Não foi possível salvar o contrato.');
  const afterValues = { sale_id: values.sale_id, lead_id: values.lead_id, process_number: values.process_number, broker_id: values.broker_id, sdr_id: values.sdr_id, manager_id: values.manager_id,
    broker_cpf: values.broker_cpf, broker_cnpj: values.broker_cnpj, broker_creci: values.broker_creci, broker_address: values.broker_address,
    sdr_cpf: values.sdr_cpf, sdr_cnpj: values.sdr_cnpj, sdr_creci: values.sdr_creci, sdr_address: values.sdr_address,
    buyer_name: values.buyer_name, buyer_cpf: values.buyer_cpf, buyer_address: values.buyer_address, development_id: values.development_id,
    unit: values.unit, proposal_number: values.proposal_number, unit_value: values.unit_value, commission_base: values.commission_base, commission_rate_pct: values.commission_rate_pct,
    gross_commission: values.gross_commission, manager_commission_rate_pct: values.manager_commission_rate_pct, manager_commission_value: values.manager_commission_value,
    has_prize: values.has_prize, prize_rate_pct: values.prize_rate_pct, gross_prize: values.gross_prize };
  afterValues.contractNumber = existing.contract_number;
  await audit(actor, id ? 'contract.update' : 'contract.create', 'contract', existing.id, auditChangedFields(beforeValues, afterValues), beforeValues, afterValues);
  return { ok: true, contractId: existing.id, message: id ? 'Rascunho atualizado.' : 'Rascunho de contrato criado.' };
}

async function apiListContracts(token, options = {}) {
  const actor = await verifyActor(token);
  if (!isAdmin(actor) && !['Corretor','SDR'].includes(actor.role)) throw new HttpError(403, 'Este perfil não pode consultar contratos.');
  const includeArchived = isAdmin(actor) && options && options.includeArchived === true;
  const [rows, users, developments, documents, sales] = await Promise.all([
    listAll('crm_contracts', { select: '*', order: 'created_at.desc' }), listAll('crm_users', { select: 'id,name,role' }),
    listAll('crm_developments', { select: 'id,name' }), listAll('crm_contract_documents', { select: 'id,contract_id,document_type,document_kind,signature_confirmed_at,signature_confirmed_by,original_name,mime_type,size_bytes,created_at' }),
    listAll('crm_sales', { select: 'id,internal_number,process_number', deleted_at: 'is.null' })
  ]);
  return (rows || []).filter((row) => (includeArchived ? Boolean(row.deleted_at) : !row.deleted_at)
    && (isAdmin(actor) || (row.status === 'Assinado' && (actor.role === 'Corretor' ? row.broker_id === actor.id : row.sdr_id === actor.id)))).map((row) => ({
    id: row.id, contractNumber: row.contract_number, saleId: row.sale_id || '', saleInternalNumber: (sales.find((item) => item.id === row.sale_id) || {}).internal_number || '',
    leadId: row.lead_id || '', processNumber: row.process_number || (sales.find((item) => item.id === row.sale_id) || {}).process_number || '',
    brokerId: row.broker_id, brokerName: (users.find((item) => item.id === row.broker_id) || {}).name || '',
    sdrId: row.sdr_id, sdrName: (users.find((item) => item.id === row.sdr_id) || {}).name || '', managerId: row.manager_id, managerName: (users.find((item) => item.id === row.manager_id) || {}).name || '',
    buyerName: row.buyer_name, buyerCpf: row.buyer_cpf || '', buyerAddress: row.buyer_address || '', developmentId: row.development_id,
    developmentName: (developments.find((item) => item.id === row.development_id) || {}).name || '', unit: row.unit, unitValue: Number(row.unit_value),
    proposalNumber: row.proposal_number || '', sdrCpf: row.sdr_cpf || '', commissionBase: Number(row.commission_base || 0), commissionRatePct: row.commission_rate_pct === null ? null : Number(row.commission_rate_pct),
    grossCommission: Number(row.gross_commission), brokerCommission: Number(row.broker_commission), sdrCommission: Number(row.sdr_commission),
    managerCommissionRatePct: row.manager_commission_rate_pct === null || row.manager_commission_rate_pct === undefined ? null : Number(row.manager_commission_rate_pct), managerCommissionValue: Number(row.manager_commission_value || 0),
    hasPrize: row.has_prize === true, prizeRatePct: row.prize_rate_pct === null ? null : Number(row.prize_rate_pct), grossPrize: Number(row.gross_prize), brokerPrize: Number(row.broker_prize), sdrPrize: Number(row.sdr_prize),
    status: row.status, generatedAt: row.generated_at || '', signedAt: row.signed_at || '', deletedAt: row.deleted_at || '', deletedBy: row.deleted_by || '',
    agreementTemplateConfigured: Boolean(row.template_snapshot), debtConfessionTemplateConfigured: Boolean(row.debt_confession_template_snapshot),
    documents: (documents || []).filter((doc) => doc.contract_id === row.id && (isAdmin(actor) || (row.status === 'Assinado' && doc.document_type === 'signed' && Boolean(doc.signature_confirmed_at)))).map((doc) => ({
      id: doc.id, type: doc.document_type, kind: doc.document_kind || 'agreement', signatureConfirmedAt: doc.signature_confirmed_at || '',
      name: doc.original_name, mimeType: doc.mime_type, sizeBytes: Number(doc.size_bytes), createdAt: doc.created_at
    }))
  }));
}

async function apiArchiveContract(token, contractId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(contractId)) return { ok: false, message: 'Contrato inválido.' };
  const rows = await dbRequest('crm_contracts', { query: { select: '*', id: `eq.${contractId}`, deleted_at: 'is.null', limit: 1 } });
  const contract = Array.isArray(rows) ? rows[0] : null;
  if (!contract) return { ok: false, message: 'Contrato não encontrado na lista ativa.' };
  const stamp = now();
  const updated = await dbRequest('crm_contracts', { method: 'PATCH', query: { id: `eq.${contractId}`, deleted_at: 'is.null' }, prefer: 'return=representation', body: { deleted_at: stamp, deleted_by: actor.id, updated_at: stamp, updated_by: actor.id } });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'O contrato foi alterado por outra pessoa. Atualize a tela.' };
  await audit(actor, 'contract.archive', 'contract', contractId, ['deleted_at','deleted_by'], { deletedAt: null, contractNumber: contract.contract_number, status: contract.status }, { deletedAt: stamp, documentsPreserved: true });
  return { ok: true, message: 'Contrato removido da lista ativa e preservado com seus arquivos. A gestão poderá restaurá-lo.' };
}

async function apiRestoreContract(token, contractId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(contractId)) return { ok: false, message: 'Contrato inválido.' };
  const rows = await dbRequest('crm_contracts', { query: { select: '*', id: `eq.${contractId}`, deleted_at: 'not.is.null', limit: 1 } });
  const contract = Array.isArray(rows) ? rows[0] : null;
  if (!contract) return { ok: false, message: 'Contrato excluído não encontrado.' };
  const stamp = now();
  const updated = await dbRequest('crm_contracts', { method: 'PATCH', query: { id: `eq.${contractId}`, deleted_at: 'not.is.null' }, prefer: 'return=representation', body: { deleted_at: null, deleted_by: null, updated_at: stamp, updated_by: actor.id } });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'O contrato foi alterado por outra pessoa. Atualize a tela.' };
  await audit(actor, 'contract.restore', 'contract', contractId, ['deleted_at','deleted_by'], { deletedAt: contract.deleted_at, contractNumber: contract.contract_number }, { deletedAt: null, documentsPreserved: true });
  return { ok: true, message: 'Contrato restaurado com todos os documentos e histórico.' };
}

function htmlEscape(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return 'Não informado';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(Number(value))}%`;
}

function partySnapshotValues(party) {
  return {
    broker_cpf: party.brokerCpf || '', broker_cnpj: party.brokerCnpj || '', broker_creci: party.brokerCreci || '', broker_address: party.brokerAddress || '',
    sdr_cpf: party.sdrCpf || '', sdr_cnpj: party.sdrCnpj || '', sdr_creci: party.sdrCreci || '', sdr_address: party.sdrAddress || ''
  };
}

async function apiGenerateContract(token, contractId, documentKind = 'agreement') {
  const actor = await verifyActor(token); requireAdmin(actor);
  const kind = normalizeContractDocumentKind(documentKind);
  if (kind !== 'agreement') return { ok: false, message: 'A plataforma permite gerar somente o Termo Fifty nesta área. Recibos de pagamento são gerados em Vendas e repasses > Recibos e comprovantes.' };
  if (!isUuid(contractId)) return { ok: false, message: 'Contrato inválido.' };
  const contractRows = await dbRequest('crm_contracts', { query: { select: '*', id: `eq.${contractId}`, limit: 1 } });
  const contract = Array.isArray(contractRows) ? contractRows[0] : null;
  if (!contract || contract.status === 'Cancelado' || (kind === 'agreement' && contract.status === 'Assinado')) return { ok: false, message: 'Este documento não pode ser gerado neste estado.' };
  if (!contract.sale_id || !contract.sdr_id) return { ok: false, message: 'O Termo Fifty exige uma venda vinculada e um SDR participante selecionado.' };
  const linkedSaleRows = await dbRequest('crm_sales', { query: { select: 'id,is_sdr_sale,sdr_id,sale_status,repass_status,deleted_at', id: `eq.${contract.sale_id}`, limit: 1 } });
  const linkedSale = Array.isArray(linkedSaleRows) ? linkedSaleRows[0] : null;
  if (!linkedSale || linkedSale.deleted_at || linkedSale.is_sdr_sale !== true || String(linkedSale.sdr_id || '') !== String(contract.sdr_id)) return { ok: false, message: 'O Termo Fifty só pode ser gerado quando a venda ativa estiver marcada com participação do SDR correto.' };
  if (!String(contract.proposal_number || '').trim()) return { ok: false, message: 'Informe o número da proposta antes de gerar o Termo Fifty.' };
  const priorDocuments = await listAll('crm_contract_documents', { select: 'document_kind,document_type,signature_confirmed_at', contract_id: `eq.${contract.id}` });
  if ((priorDocuments || []).some((doc) => (doc.document_kind || 'agreement') === kind && doc.document_type === 'signed' && doc.signature_confirmed_at)) return { ok: false, message: 'A assinatura deste documento já foi confirmada. Não é possível gerar outra versão pelo fluxo atual.' };
  const templateInfo = await apiGetContractTemplate(token, { kind });
  if (!templateInfo.template) return { ok: false, message: `Cadastre o modelo aprovado de ${kind === 'agreement' ? 'contrato/termo' : 'confissão de dívida'} antes de gerar o documento.` };
  const [users, developments, profiles] = await Promise.all([listAll('crm_users', { select: 'id,name,email,role,active,deleted_at' }), listAll('crm_developments', { select: 'id,name' }), listAll('crm_user_contract_profiles', { select: '*' })]);
  const broker = users.find((item) => item.id === contract.broker_id) || {};
  const sdr = users.find((item) => item.id === contract.sdr_id) || {};
  const manager = users.find((item) => item.id === contract.manager_id) || {};
  const development = developments.find((item) => item.id === contract.development_id) || {};
  const brokerProfile = (profiles || []).find((item) => item.user_id === contract.broker_id) || {};
  const sdrProfile = (profiles || []).find((item) => item.user_id === contract.sdr_id) || {};
  const managerProfile = (profiles || []).find((item) => item.user_id === contract.manager_id) || {};
  const managerMissing = [['CPF',managerProfile.cpf],['CNPJ',managerProfile.cnpj],['CRECI',managerProfile.creci],['endereço',managerProfile.address]].filter(([,value]) => !String(value || '').trim()).map(([label]) => label);
  if (managerMissing.length) return { ok: false, message: `Complete os dados cadastrais do gerente ${manager.name || ''} antes de gerar o Termo Fifty: ${managerMissing.join(', ')}.` };
  const participantSnapshotLocked = Boolean(contract.generated_at || contract.status !== 'Rascunho'
    || (priorDocuments || []).some((doc) => doc.document_type === 'generated'));
  const party = {
    brokerCpf: participantSnapshotLocked ? contract.broker_cpf || brokerProfile.cpf || '' : brokerProfile.cpf || contract.broker_cpf || '',
    brokerCnpj: participantSnapshotLocked ? contract.broker_cnpj || brokerProfile.cnpj || '' : brokerProfile.cnpj || contract.broker_cnpj || '',
    brokerCreci: participantSnapshotLocked ? contract.broker_creci || brokerProfile.creci || '' : brokerProfile.creci || contract.broker_creci || '',
    brokerAddress: participantSnapshotLocked ? contract.broker_address || brokerProfile.address || '' : brokerProfile.address || contract.broker_address || '',
    sdrCpf: participantSnapshotLocked ? contract.sdr_cpf || sdrProfile.cpf || '' : sdrProfile.cpf || contract.sdr_cpf || '',
    sdrCnpj: participantSnapshotLocked ? contract.sdr_cnpj || sdrProfile.cnpj || '' : sdrProfile.cnpj || contract.sdr_cnpj || '',
    sdrCreci: participantSnapshotLocked ? contract.sdr_creci || sdrProfile.creci || '' : sdrProfile.creci || contract.sdr_creci || '',
    sdrAddress: participantSnapshotLocked ? contract.sdr_address || sdrProfile.address || '' : sdrProfile.address || contract.sdr_address || ''
  };
  if (!manager.id || !manager.active || manager.deleted_at || !['Gerente','Administrador'].includes(manager.role)) return { ok: false, message: 'Selecione um gerente ou administrador ativo como terceiro signatário e salve o rascunho novamente.' };
  const values = {
    numero_contrato: contract.contract_number, numero_processo: contract.process_number || '', numero_proposta: contract.proposal_number || '', cliente_nome: contract.buyer_name || '', cliente_cpf: contract.buyer_cpf || '',
    cliente_endereco: contract.buyer_address || '', empreendimento: development.name || '', unidade: contract.unit || '',
    valor_unidade: formatCurrency(contract.unit_value), corretor_nome: broker.name || '', corretor_cpf: party.brokerCpf,
    corretor_cnpj: party.brokerCnpj, corretor_creci: party.brokerCreci, corretor_endereco: party.brokerAddress,
    sdr_nome: sdr.name || '', sdr_cpf: party.sdrCpf, sdr_cnpj: party.sdrCnpj, sdr_creci: party.sdrCreci, sdr_endereco: party.sdrAddress, gerente_nome: manager.name || '',
    percentual_comissao: contract.commission_rate_pct === null || contract.commission_rate_pct === undefined ? 'Não informado' : formatPercent(contract.commission_rate_pct), base_calculo_comissao: Number(contract.commission_base || 0) > 0 ? formatCurrency(contract.commission_base) : 'Não informado',
    comissao_bruta: formatCurrency(contract.gross_commission),
    comissao_corretor: formatCurrency(contract.broker_commission), comissao_sdr: formatCurrency(contract.sdr_commission),
    percentual_comissao_gerente: contract.manager_commission_rate_pct === null || contract.manager_commission_rate_pct === undefined ? 'Não se aplica' : formatPercent(contract.manager_commission_rate_pct),
    comissao_gerente: Number(contract.manager_commission_value || 0) > 0 ? formatCurrency(contract.manager_commission_value) : 'Não se aplica',
    premio_aplicavel: contract.has_prize ? 'Sim' : 'Não', percentual_premio: contract.has_prize ? formatPercent(contract.prize_rate_pct) : 'Não se aplica',
    premio_bruto: contract.has_prize ? formatCurrency(contract.gross_prize) : 'Não se aplica',
    premio_corretor: contract.has_prize ? formatCurrency(contract.broker_prize) : 'Não se aplica',
    premio_sdr: contract.has_prize ? formatCurrency(contract.sdr_prize) : 'Não se aplica',
    data_geracao: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date())
  };
  const usedKeys = [...new Set([...String(templateInfo.template).matchAll(/{{\s*([a-z_]+)\s*}}/g)].map((match) => match[1]))];
  const unknownKeys = usedKeys.filter((key) => !Object.prototype.hasOwnProperty.call(values, key));
  if (unknownKeys.length) return { ok: false, message: 'O modelo contém campos não reconhecidos: ' + unknownKeys.map((key) => '{{' + key + '}}').join(', ') + '. Revise o modelo antes de gerar.' };
  let html = templateInfo.template.replace(/{{\s*([a-z_]+)\s*}}/g, (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? htmlEscape(values[key]) : match);
  if (/{{\s*[^{}]+\s*}}/.test(html)) return { ok: false, message: 'O modelo contém campos sem correspondência. Revise os marcadores antes de gerar o documento.' };
  if (!/<!doctype\s+html/i.test(html) && !/<html[\s>]/i.test(html)) html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${htmlEscape(contract.contract_number)}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  const documentTitle = 'TERMO FIFTY · TERMO DE ACORDO OPERACIONAL E DIVISAO DE REMUNERACAO';
  const fileBytes = makePdfDocument([documentTitle, `Documento ${contract.contract_number}`, '', ...htmlToPdfLines(html)]);
  if (fileBytes.byteLength > 10485760) return { ok: false, message: 'O documento gerado ultrapassa o limite de 10 MB.' };
  const label = 'termo-fifty';
  const fileName = `${contract.contract_number}-${label}.pdf`;
  const path = `generated/${contract.id}/${kind}/${randomBytes(5).toString('hex')}-${fileName}`;
  await storageRequest(`object/crm-contracts/${storageObjectPath(path)}`, { method: 'POST', body: fileBytes, contentType: 'application/pdf', headers: { 'x-upsert': 'false' } });
  const contractUpdate = kind === 'agreement'
    ? { status: 'Gerado para assinatura', generated_at: now(), generated_by: actor.id, template_snapshot: templateInfo.template, ...partySnapshotValues(party), updated_at: now(), updated_by: actor.id }
    : { debt_confession_template_snapshot: templateInfo.template, ...(participantSnapshotLocked ? {} : partySnapshotValues(party)), updated_at: now(), updated_by: actor.id };
  await dbRequest('crm_contracts', { method: 'PATCH', query: { id: `eq.${contract.id}` }, prefer: 'return=minimal', body: contractUpdate });
  await dbRequest('crm_contract_documents', { method: 'POST', prefer: 'return=minimal', body: { contract_id: contract.id, document_kind: kind, document_type: 'generated', storage_path: path, original_name: fileName, mime_type: 'application/pdf', size_bytes: fileBytes.byteLength, uploaded_by: actor.id } });
  const beforeValues = kind === 'agreement' ? { status: contract.status } : { debtConfessionTemplateConfigured: Boolean(contract.debt_confession_template_snapshot) };
  const afterValues = kind === 'agreement' ? { status: 'Gerado para assinatura', documentKind: kind, fileName } : { debtConfessionTemplateConfigured: true, documentKind: kind, fileName };
  await audit(actor, kind === 'agreement' ? 'contract.generate' : 'contract.debt_confession.generate', 'contract', contract.id, ['documento','status'], beforeValues, afterValues);
  const url = await signedContractDownload(path, fileName);
  return { ok: true, kind, downloadUrl: url, message: 'Termo Fifty gerado. Baixe, confira o conteúdo e encaminhe para as assinaturas do corretor, SDR e gerente.' };
}

async function apiCreateContractUpload(token, contractId, fileInfo = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(contractId)) return { ok: false, message: 'Contrato inválido.' };
  const kind = normalizeContractDocumentKind(fileInfo.documentKind);
  const rows = await dbRequest('crm_contracts', { query: { select: 'id,status,contract_number', id: `eq.${contractId}`, limit: 1 } });
  const contract = Array.isArray(rows) ? rows[0] : null;
  if (!contract || contract.status === 'Cancelado') return { ok: false, message: 'Este documento não está aguardando o arquivo assinado.' };
  const priorDocs = await listAll('crm_contract_documents', { select: 'document_kind,document_type', contract_id: `eq.${contract.id}` });
  if (!(priorDocs || []).some((doc) => (doc.document_kind || 'agreement') === kind && doc.document_type === 'generated')) return { ok: false, message: 'Gere este documento antes de anexar a versão assinada.' };
  if ((priorDocs || []).some((doc) => (doc.document_kind || 'agreement') === kind && doc.document_type === 'signed' && doc.signature_confirmed_at)) return { ok: false, message: 'A assinatura deste documento já foi confirmada. Não é possível substituir o arquivo assinado por este fluxo.' };
  if (kind === 'agreement' && contract.status === 'Assinado') return { ok: false, message: 'O contrato principal já está assinado. Não é possível substituir o arquivo por este fluxo.' };
  const originalName = safeFileName(fileInfo.name);
  const mimeType = String(fileInfo.mimeType || '').toLowerCase();
  const sizeBytes = Number(fileInfo.sizeBytes || 0);
  const allowedTypes = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  const extAllowed = /\.(pdf|doc|docx)$/i.test(originalName);
  if (!extAllowed || !allowedTypes.includes(mimeType) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 10485760) return { ok: false, message: 'Envie um arquivo PDF, DOC ou DOCX de até 10 MB.' };
  const path = `signed/${contract.id}/${kind}/${randomBytes(8).toString('hex')}-${originalName}`;
  const docRows = await dbRequest('crm_contract_documents', { method: 'POST', prefer: 'return=representation', body: { contract_id: contract.id, document_kind: kind, document_type: 'signed', storage_path: path, original_name: originalName, mime_type: mimeType, size_bytes: sizeBytes, uploaded_by: actor.id } });
  const doc = Array.isArray(docRows) ? docRows[0] : docRows;
  const cfg = env();
  const response = await storageRequest(`object/upload/sign/crm-contracts/${storageObjectPath(path)}`, { method: 'POST', contentType: 'application/json', body: JSON.stringify({}) });
  const rawUrl = response && (response.signedUrl || response.signedURL || response.url);
  if (!doc || !rawUrl) throw new HttpError(502, 'Não foi possível preparar o envio do documento assinado.');
  const uploadTarget = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `${cfg.url}/storage/v1${rawUrl}`);
  if (response.token && !uploadTarget.searchParams.has('token')) uploadTarget.searchParams.set('token', response.token);
  const uploadUrl = uploadTarget.toString();
  await audit(actor, 'contract.signed_upload_started', 'contract', contract.id, ['arquivo_assinado'], {}, { documentKind: kind, fileName: originalName, sizeBytes });
  return { ok: true, documentId: doc.id, path, kind, uploadUrl, publishableKey: cfg.publishableKey, message: 'Envio preparado.' };
}

async function apiConfirmContractSigned(token, contractId, documentId, signersConfirmed) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(contractId) || !isUuid(documentId)) return { ok: false, message: 'Contrato ou documento inválido.' };
  if (signersConfirmed !== true) return { ok: false, message: 'Confirme que o corretor, o SDR e o gerente assinaram o documento.' };
  const docs = await dbRequest('crm_contract_documents', { query: { select: '*', id: `eq.${documentId}`, contract_id: `eq.${contractId}`, document_type: 'eq.signed', limit: 1 } });
  const doc = Array.isArray(docs) ? docs[0] : null;
  if (!doc) return { ok: false, message: 'Documento assinado não encontrado.' };
  const kind = normalizeContractDocumentKind(doc.document_kind || 'agreement');
  const objectInfo = await storageRequest(`object/info/crm-contracts/${storageObjectPath(doc.storage_path)}`);
  if (!objectInfo) return { ok: false, message: 'O arquivo ainda não chegou ao armazenamento. Tente novamente.' };
  const contracts = await dbRequest('crm_contracts', { query: { select: '*', id: `eq.${contractId}`, limit: 1 } });
  const contract = Array.isArray(contracts) ? contracts[0] : null;
  if (!contract) return { ok: false, message: 'Contrato não encontrado.' };
  if (contract.status === 'Cancelado') return { ok: false, message: 'Não é possível confirmar assinatura de um contrato cancelado.' };
  if (doc.signature_confirmed_at) return { ok: true, message: 'A assinatura deste documento já estava confirmada.' };
  const stamp = now();
  await dbRequest('crm_contract_documents', { method: 'PATCH', query: { id: `eq.${documentId}` }, prefer: 'return=minimal', body: { signature_confirmed_at: stamp, signature_confirmed_by: actor.id } });
  if (kind === 'agreement') {
    await dbRequest('crm_contracts', { method: 'PATCH', query: { id: `eq.${contractId}` }, prefer: 'return=minimal', body: { status: 'Assinado', signed_at: stamp, signed_uploaded_by: actor.id, updated_at: stamp, updated_by: actor.id } });
  }
  const action = kind === 'agreement' ? 'contract.signed' : 'contract.debt_confession.signed';
  const beforeValues = kind === 'agreement' ? { status: contract.status } : { documentSignatureConfirmed: false };
  const afterValues = kind === 'agreement' ? { status: 'Assinado', documentKind: kind, documentName: doc.original_name, allThreeSignersConfirmed: true } : { documentSignatureConfirmed: true, documentKind: kind, documentName: doc.original_name, allThreeSignersConfirmed: true };
  await audit(actor, action, 'contract', contractId, kind === 'agreement' ? ['status','signed_at','signatures'] : ['confissao_assinada','signatures'], beforeValues, afterValues);
  return { ok: true, kind, message: `${kind === 'agreement' ? 'Contrato/termo' : 'Confissão de dívida'} assinado confirmado. ${kind === 'agreement' ? 'O documento assinado fica disponível ao corretor e ao SDR vinculados.' : 'A confissão ficará disponível aos participantes depois que o contrato principal também estiver confirmado como assinado.'}` };
}

async function apiGetContractDocument(token, documentId) {
  const actor = await verifyActor(token);
  if (!isUuid(documentId)) throw new HttpError(404, 'Documento não encontrado.');
  const docs = await dbRequest('crm_contract_documents', { query: { select: '*', id: `eq.${documentId}`, limit: 1 } });
  const doc = Array.isArray(docs) ? docs[0] : null;
  if (!doc) throw new HttpError(404, 'Documento não encontrado.');
  const rows = await dbRequest('crm_contracts', { query: { select: 'id,status,broker_id,sdr_id', id: `eq.${doc.contract_id}`, limit: 1 } });
  const contract = Array.isArray(rows) ? rows[0] : null;
  if (!contract) throw new HttpError(404, 'Documento não encontrado.');
  const allowed = isAdmin(actor) || (contract.status === 'Assinado' && doc.document_type === 'signed' && Boolean(doc.signature_confirmed_at) && ((actor.role === 'Corretor' && contract.broker_id === actor.id) || (actor.role === 'SDR' && contract.sdr_id === actor.id)));
  if (!allowed) throw new HttpError(403, 'Este documento só fica disponível aos perfis autorizados após a assinatura.');
  return { downloadUrl: await signedContractDownload(doc.storage_path, doc.original_name), expiresInSeconds: 90 };
}

function canReadCommissionDocument(actor, doc) {
  if (isFinanceManager(actor)) return true;
  const recipientId = String(doc.recipient_id || doc.broker_id || '');
  if (actor.role === 'Corretor' || actor.role === 'SDR') return recipientId === String(actor.id);
  return false;
}

function mapCommissionDocument(row, users, sales, saleLinks = []) {
  const broker = users.find((user) => String(user.id) === String(row.broker_id));
  const sdr = users.find((user) => String(user.id) === String(row.sdr_id));
  const manager = users.find((user) => String(user.id) === String(row.manager_id));
  const recipientId = row.recipient_id || row.broker_id;
  const recipient = users.find((user) => String(user.id) === String(recipientId));
  const sale = sales.find((item) => String(item.id) === String(row.sale_id));
  const linkedSales = saleLinks.filter((item) => String(item.commission_document_id) === String(row.id)).map((link) => {
    const linkedSale = sales.find((item) => String(item.id) === String(link.sale_id));
    if (!linkedSale) return null;
    return {
      id: linkedSale.id, saleId: linkedSale.id, processNumber: linkedSale.process_number || '',
      internalNumber: linkedSale.internal_number || '', buyerName: linkedSale.buyer_name || '',
      developmentName: linkedSale.development_name || '', unit: linkedSale.unit || '',
      unitValue: Number(linkedSale.unit_value || 0), commissionBase: Number(link.commission_base || 0),
      saleGrossCommission: Number(link.sale_gross_commission || 0), grossCommission: Number(link.gross_commission || 0),
      withholdingRatePct: Number(link.withholding_rate_pct || 0), withholdingAmount: Number(link.withholding_amount || 0),
      netCommission: Number(link.net_commission || 0)
    };
  }).filter(Boolean);
  if (!linkedSales.length && sale) linkedSales.push({
    id: sale.id, saleId: sale.id, processNumber: sale.process_number || '', internalNumber: sale.internal_number || '',
    buyerName: sale.buyer_name || '', developmentName: sale.development_name || '', unit: sale.unit || '',
    unitValue: Number(sale.unit_value || 0), commissionBase: Number(row.commission_base || 0),
    saleGrossCommission: Math.round(Number(sale.unit_value || 0) * 2.5) / 100,
    grossCommission: Number(row.gross_commission || 0), withholdingRatePct: Number(row.withholding_rate_pct || 0),
    withholdingAmount: Number(row.withholding_amount || 0), netCommission: Number(row.net_commission || 0)
  });
  return {
    id: row.id, saleId: row.sale_id || '', processNumber: sale && sale.process_number || '', buyerName: sale && sale.buyer_name || '',
    developmentName: sale && sale.development_name || '', unit: sale && sale.unit || '', brokerId: row.broker_id,
    brokerName: broker && broker.name || 'Corretor inativo', sdrId: row.sdr_id || '', sdrName: sdr && sdr.name || '',
    recipientId, recipientRole: row.recipient_role || 'Corretor', recipientName: recipient && recipient.name || (row.recipient_role === 'SDR' ? 'SDR inativo' : 'Corretor inativo'),
    managerId: row.manager_id || '', managerName: manager && manager.name || '',
    type: row.document_type, signatureStatus: row.signature_status, paymentStatus: row.payment_status,
    commissionBase: Number(row.commission_base || 0), commissionRatePct: Number(row.commission_rate_pct || 0), grossCommission: Number(row.gross_commission || 0),
    withholdingRatePct: Number(row.withholding_rate_pct || 0), withholdingAmount: Number(row.withholding_amount || 0), netCommission: Number(row.net_commission || 0),
    brokerAmount: Number(row.broker_amount || 0), sdrAmount: Number(row.sdr_amount || 0), paymentDate: row.payment_date || '', paymentCompletedAt: row.payment_completed_at || '',
    generatedStoragePath: row.generated_storage_path || '', signedStoragePath: row.signed_storage_path || '', storagePath: row.storage_path || '',
    originalName: row.original_name || '', mimeType: row.mime_type || '', sizeBytes: Number(row.size_bytes || 0), notes: row.notes || '',
    signedUploadedAt: row.signed_uploaded_at || '', brokerSignatureConfirmed: row.broker_signature_confirmed === true,
    sales: linkedSales, saleCount: linkedSales.length,
    brokerSignatureConfirmedAt: row.broker_signature_confirmed_at || '', sdrSignatureConfirmed: row.sdr_signature_confirmed === true,
    sdrSignatureConfirmedAt: row.sdr_signature_confirmed_at || '', managerSignatureConfirmed: row.manager_signature_confirmed === true,
    managerSignatureConfirmedAt: row.manager_signature_confirmed_at || '', archivedAt: row.archived_at || '', createdAt: row.created_at || '', updatedAt: row.updated_at || ''
  };
}

function pdfText(value) {
  return String(value === undefined || value === null ? '' : value)
    .normalize('NFC')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
    .replace(/…/g, '...').replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/[\\()]/g, (char) => `\\${char}`);
}

function wrapPdfLines(lines, maxLength = 88) {
  const output = [];
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) { output.push(''); continue; }
    let current = '';
    for (const word of line.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxLength && current) { output.push(current); current = word; }
      else current = candidate;
    }
    output.push(current);
  }
  return output;
}

function makePdfDocument(lines) {
  const wrapped = wrapPdfLines(lines);
  const pages = [];
  for (let index = 0; index < wrapped.length; index += 48) pages.push(wrapped.slice(index, index + 48));
  if (!pages.length) pages.push([]);
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  pages.forEach((pageLines, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const commands = ['BT', '/F1 9 Tf', '48 792 Td', '14 TL'];
    pageLines.forEach((line, lineIndex) => {
      commands.push(`(${pdfText(line)}) Tj`);
      if (lineIndex < pageLines.length - 1) commands.push('T*');
    });
    commands.push('ET');
    const content = commands.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  });
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function htmlToPdfLines(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:h[1-6]|p|div|tr|li|section|header|footer|table)>/gi, '\n')
    .replace(/<t[dh]\b[^>]*>/gi, '  |  ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Math.min(0x10ffff, parseInt(code, 16))))
    .split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function makeCommissionReceiptPdf(document, sales, recipient, manager, profiles) {
  const saleList = Array.isArray(sales) ? sales : [sales].filter(Boolean);
  const recipientProfile = profiles.find((item) => String(item.user_id) === String(recipient.id)) || {};
  const managerProfile = profiles.find((item) => String(item.user_id) === String(manager.id)) || {};
  const recipientRole = document.recipient_role === 'SDR' ? 'SDR participante' : 'Corretor responsável';
  const paymentDate = document.payment_date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(document.payment_date + 'T12:00:00Z')) : 'A definir pela gestão';
  const issueDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date());
  const totalGross = saleList.reduce((sum, sale) => sum + Number(sale.sale_gross_commission || 0), 0);
  const saleLines = saleList.flatMap((sale, index) => [
    `${index + 1}. Processo / proposta: ${sale.process_number || sale.internal_number || 'Não informado'}`,
    'Cliente / comprador: ' + (sale.buyer_name || 'Não informado'),
    'Empreendimento / produto: ' + (sale.development_name || 'Não informado'),
    'Unidade: ' + (sale.unit || 'Não informada'),
    'Valor da venda (VGV): ' + formatCurrency(sale.unit_value),
    'Comissão bruta total da venda (2,5%): ' + formatCurrency(sale.sale_gross_commission),
    'Parcela bruta deste recibo: ' + formatCurrency(sale.gross_commission),
    'Desconto desta venda neste recibo: ' + formatCurrency(sale.withholding_amount),
    'Valor líquido desta venda neste recibo: ' + formatCurrency(sale.net_commission),
    ''
  ]);
  const lines = [
    'SHARKS FÊNIX · MUNDO APTO',
    'DECLARAÇÃO DE RECEBIMENTO DE COMISSÃO',
    'INTERMEDIAÇÃO DE PAGAMENTO E AUSÊNCIA DE VÍNCULO EMPREGATÍCIO',
    'Recibo ' + (document.document_number || document.id),
    '',
    '1. IDENTIFICAÇÃO DO BENEFICIÁRIO DA COMISSÃO',
    'Nome: ' + (recipient.name || '________________'),
    'Qualificação na venda: ' + recipientRole,
    'CNPJ: ' + (recipientProfile.cnpj || '________________') + ' | CPF: ' + (recipientProfile.cpf || '________________') + ' | CRECI: ' + (recipientProfile.creci || '________________'),
    'Endereço: ' + (recipientProfile.address || '________________________________________________'),
    '',
    '2. EMPRESA INTERMEDIADORA DO PAGAMENTO',
    'Empresa / responsável pelo pagamento: ' + (manager.name || '________________'),
    'CNPJ: ' + (managerProfile.cnpj || '________________') + ' | CPF: ' + (managerProfile.cpf || '________________'),
    'CRECI: ' + (managerProfile.creci || '________________'),
    'Endereço: ' + (managerProfile.address || '________________________________________________'),
    '',
    '3. VENDAS CONSOLIDADAS',
    'Quantidade de vendas incluídas neste recibo: ' + saleList.length,
    ...saleLines,
    'VGV consolidado: ' + formatCurrency(document.commission_base),
    'Comissão bruta total da venda (2,5%): ' + formatCurrency(totalGross),
    'Comissão bruta deste recibo: ' + formatCurrency(document.gross_commission),
    '',
    '3.1. DO OBJETO',
    'O presente instrumento tem por objeto a declaração de recebimento de comissão pelo BENEFICIÁRIO acima identificado, referente às vendas e participações imobiliárias relacionadas no item 3.',
    '',
    '4. DOS VALORES E DESCONTOS',
    'O BENEFICIÁRIO declara ciência e concordância com os seguintes valores:',
    'Valor bruto deste recibo: ' + formatCurrency(document.gross_commission),
    'Alíquota de desconto preenchida pela gestão: ' + formatPercent(document.withholding_rate_pct),
    'Valor correspondente ao desconto: ' + formatCurrency(document.withholding_amount),
    'Valor líquido destinado ao BENEFICIÁRIO: ' + formatCurrency(document.net_commission),
    'Data prevista para pagamento: ' + paymentDate,
    ...(document.notes ? ['Observações: ' + document.notes] : []),
    'Os valores acima refletem a comissão destinada individualmente ao BENEFICIÁRIO. A gestão aplica o desconto sobre a comissão bruta de cada venda; quando houver participação de corretor e SDR, o valor líquido daquela venda é dividido igualmente e cada beneficiário recebe seu próprio recibo.',
    '',
    '5. DA FORMA DE PAGAMENTO',
    'O pagamento será realizado via transferência bancária. O comprovante poderá ser anexado e armazenado no CRM.',
    '5.1. O BENEFICIÁRIO declara estar ciente de que será emitida Nota Fiscal pelo beneficiário como Pessoa Jurídica (PJ), quando aplicável, e o pagamento correspondente será realizado em conta PJ de sua titularidade.',
    'Eventuais valores complementares, ajustes ou diferenças poderão ser pagos via Pessoa Física (PF), conforme acordo entre as partes e dentro da legalidade vigente.',
    '5.2. Os pagamentos ocorrerão após o cumprimento integral das condições comerciais e administrativas da venda.',
    '',
    '6. INTERMEDIAÇÃO E AUSÊNCIA DE VÍNCULO',
    '6.1. O BENEFICIÁRIO declara expressamente que possui relação comercial ativa e vigente com a empresa MUNDO APTO, responsável direta por essa relação comercial.',
    'A empresa intermediadora identificada no item 2 atua exclusivamente como intermediadora do pagamento da comissão, não sendo parte do contrato principal de corretagem.',
    '6.2. Fica declarado que não existe vínculo empregatício, trabalhista, previdenciário ou societário entre o BENEFICIÁRIO e a empresa intermediadora, não se aplicando a CLT, nos termos do artigo 3º da Consolidação das Leis do Trabalho.',
    '6.3. O BENEFICIÁRIO atua de forma autônoma, sem exclusividade, subordinação ou controle de jornada, assumindo responsabilidade por seus encargos fiscais, previdenciários, tributários e profissionais, inclusive perante o CRECI, quando aplicável.',
    '',
    '7. DISPOSIÇÕES GERAIS',
    '7.1. O presente documento possui caráter declaratório e comprobatório, servindo como recibo e ciência das condições aqui descritas.',
    '7.2. As partes elegem o foro da Comarca de São Paulo para dirimir quaisquer dúvidas oriundas deste instrumento, renunciando a qualquer outro, por mais privilegiado que seja.',
    'E, por estarem de pleno acordo, firmam o presente instrumento em duas vias de igual teor.',
    'Local e data: São Paulo, ' + issueDate + '.',
    '',
    'ASSINATURAS (realizadas fora do CRM)',
    '________________________________________',
    'Assinatura do beneficiário',
    (recipient.name || '________________') + ' | ' + recipientRole,
    '________________________________________',
    'Assinatura da empresa intermediadora',
    (manager.name || '________________') + ' | Gerente',
    '',
    'O arquivo assinado será anexado ao CRM. A conferência administrativa não substitui a assinatura feita pelas partes nem a revisão jurídica e contábil da empresa.'
  ];
  return makePdfDocument(lines);
}

async function apiListCommissionDocuments(token, options = {}) {
  const actor = await verifyActor(token);
  if (!isFinanceManager(actor) && !['Corretor','SDR'].includes(actor.role)) throw new HttpError(403, 'Este perfil não pode consultar documentos financeiros.');
  const includeArchived = isFinanceManager(actor) && options && options.includeArchived === true;
  const [rows, users, sales, developments, saleLinks] = await Promise.all([
    listAll('crm_commission_documents', { select: '*', order: 'created_at.desc' }),
    listAll('crm_users', { select: 'id,name,role' }),
    listAll('crm_sales', { select: 'id,process_number,internal_number,buyer_name,unit,unit_value,development_id,sold_at' }),
    listAll('crm_developments', { select: 'id,name' }),
    listAll('crm_commission_document_sales', { select: '*' })
  ]);
  const saleList = (sales || []).map((sale) => ({ ...sale, development_name: (developments || []).find((item) => String(item.id) === String(sale.development_id))?.name || '' }));
  return (rows || []).filter((row) => (includeArchived ? Boolean(row.archived_at) : !row.archived_at) && canReadCommissionDocument(actor, row))
    .map((row) => mapCommissionDocument(row, users || [], saleList, saleLinks || []));
}

async function apiCreateCommissionReceipt(token, payload = {}) {
  const actor = await verifyActor(token); requireFinanceManager(actor);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  if (Object.keys(payload).some((key) => !['saleIds','saleId','brokerId','sdrId','managerId','withholdingRatePct','paymentDate','notes'].includes(key))) return { ok: false, message: 'Campos do recibo inválidos.' };
  const saleIds = Array.isArray(payload.saleIds) ? [...new Set(payload.saleIds.map((value) => String(value || '').trim()))] : [String(payload.saleId || '').trim()];
  if (!saleIds.length || saleIds.length > 50 || saleIds.some((id) => !isUuid(id))) return { ok: false, message: 'Selecione de 1 a 50 vendas válidas.' };
  const requestedBrokerId = String(payload.brokerId || '').trim();
  const managerId = String(payload.managerId || '').trim();
  if (!isUuid(requestedBrokerId)) return { ok: false, message: 'Selecione o corretor responsável pelo recibo.' };
  if (!isUuid(managerId)) return { ok: false, message: 'Selecione o gerente que assinará o recibo.' };
  if (!isValidDateOnly(payload.paymentDate)) return { ok: false, message: 'Informe uma data prevista para o pagamento.' };
  const withholdingRatePct = parseOptionalPercent(payload.withholdingRatePct, 'Alíquota de desconto');
  if (withholdingRatePct === null) return { ok: false, message: 'Informe a alíquota de desconto, mesmo que seja 0%.' };
  const saleRows = await dbRequest('crm_sales', { query: { select: '*', id: `in.(${saleIds.join(',')})`, deleted_at: 'is.null' } });
  const salesById = new Map((Array.isArray(saleRows) ? saleRows : []).map((sale) => [String(sale.id), sale]));
  if (saleIds.some((id) => !salesById.has(id))) return { ok: false, message: 'Uma ou mais vendas selecionadas não estão disponíveis.' };
  const sales = saleIds.map((id) => salesById.get(id));
  const userRows = await listAll('crm_users', { select: 'id,name,role,active,deleted_at' });
  const broker = userRows.find((user) => String(user.id) === requestedBrokerId && user.role === 'Corretor' && !user.deleted_at);
  if (!broker || sales.some((sale) => String(sale.broker_id) !== requestedBrokerId)) return { ok: false, message: 'Todas as vendas selecionadas precisam pertencer ao corretor indicado.' };
  const manager = userRows.find((user) => String(user.id) === managerId && ['Gerente','Administrador'].includes(user.role) && user.active && !user.deleted_at);
  if (!manager) return { ok: false, message: 'Selecione um gerente ativo para assinar o recibo.' };
  const requestedSdrId = String(payload.sdrId || '').trim();
  if (requestedSdrId && !isUuid(requestedSdrId)) return { ok: false, message: 'SDR selecionado inválido.' };
  if (requestedSdrId && !userRows.some((user) => String(user.id) === requestedSdrId && user.role === 'SDR' && user.active && !user.deleted_at)) return { ok: false, message: 'Selecione um SDR ativo para as vendas sem vínculo cadastrado.' };
  const salesWithSdr = [];
  for (const sale of sales) {
    const repass = String(sale.repass_status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (sale.sale_status === 'Cancelada' || repass.includes('DISTRATO') || repass === 'CANCELADO') return { ok: false, message: 'Não é possível gerar recibo para venda cancelada ou em distrato.' };
    let saleSdrId = String(sale.sdr_id || '').trim();
    if (sale.is_sdr_sale === true) {
      if (!saleSdrId) saleSdrId = requestedSdrId;
      if (!saleSdrId) return { ok: false, message: 'Selecione um SDR para cada venda marcada com participação dele e sem vínculo cadastrado.' };
      const sdr = userRows.find((user) => String(user.id) === saleSdrId && user.role === 'SDR' && user.active && !user.deleted_at);
      if (!sdr) return { ok: false, message: 'Uma venda selecionada tem um SDR inativo ou inválido.' };
      if (!String(sale.sdr_id || '').trim()) sale.needsSdrAssignment = true;
    } else if (saleSdrId) {
      return { ok: false, message: 'Uma venda está vinculada a um SDR, mas consta como sem participação. Corrija o cadastro antes de gerar os recibos.' };
    }
    salesWithSdr.push({ ...sale, assigned_sdr_id: sale.is_sdr_sale === true ? saleSdrId : '' });
  }
  const profiles = await listAll('crm_user_contract_profiles', { select: '*' });
  const managerProfile = (profiles || []).find((item) => String(item.user_id) === String(manager.id)) || {};
  const managerMissing = [['CPF',managerProfile.cpf],['CNPJ',managerProfile.cnpj],['CRECI',managerProfile.creci],['endereço',managerProfile.address]].filter(([,value]) => !String(value || '').trim()).map(([label]) => label);
  if (managerMissing.length) return { ok: false, message: 'Complete os dados cadastrais do gerente ' + manager.name + ' antes de gerar recibos: ' + managerMissing.join(', ') + '.' };
  const saleBase = new Map();
  for (const sale of salesWithSdr) {
    const commissionBase = parseMoney(sale.unit_value, 'Valor da venda');
    const baseCents = Math.round(commissionBase * 100);
    const grossCents = Math.round(baseCents * 250 / 10000);
    if (grossCents <= 0) return { ok: false, message: 'Uma venda selecionada não permite calcular uma comissão positiva.' };
    const withholdingCents = Math.round(grossCents * withholdingRatePct / 100);
    const netCents = grossCents - withholdingCents;
    const split = (cents, hasSdr) => { const first = hasSdr ? Math.floor(cents / 2) : cents; return [first, hasSdr ? cents - first : 0]; };
    const grossSplit = split(grossCents, sale.is_sdr_sale === true);
    const netSplit = split(netCents, sale.is_sdr_sale === true);
    saleBase.set(String(sale.id), { baseCents, saleGrossCents: grossCents,
      lines: [
        { user: broker, role: 'Corretor', grossCents: grossSplit[0], netCents: netSplit[0] },
        ...(sale.is_sdr_sale === true ? [{ user: userRows.find((user) => String(user.id) === sale.assigned_sdr_id), role: 'SDR', grossCents: grossSplit[1], netCents: netSplit[1] }] : [])
      ] });
  }
  const activeLinks = await dbRequest('crm_commission_document_sales', { query: { select: 'sale_id,recipient_id', sale_id: `in.(${saleIds.join(',')})`, archived_at: 'is.null' } });
  const existingLineKeys = new Set((Array.isArray(activeLinks) ? activeLinks : []).map((row) => `${row.sale_id}|${row.recipient_id}`));
  const recipientGroups = new Map();
  let skippedRecipientLines = 0;
  for (const sale of salesWithSdr) {
    const allocation = saleBase.get(String(sale.id));
    for (const part of allocation.lines) {
      if (existingLineKeys.has(`${sale.id}|${part.user.id}`)) { skippedRecipientLines++; continue; }
      const key = `${part.user.id}|${part.role}`;
      if (!recipientGroups.has(key)) recipientGroups.set(key, { user: part.user, role: part.role, lines: [] });
      recipientGroups.get(key).lines.push({ sale, allocation, ...part });
    }
  }
  if (!recipientGroups.size) return { ok: false, message: 'Os recibos para as vendas selecionadas já existem para todos os beneficiários. Consulte a área de recibos e comprovantes.' };
  for (const sale of salesWithSdr.filter((item) => item.needsSdrAssignment)) {
    const updatedSale = await dbRequest('crm_sales', { method: 'PATCH', query: { id: 'eq.' + sale.id, is_sdr_sale: 'eq.true', deleted_at: 'is.null' }, prefer: 'return=representation', body: { sdr_id: sale.assigned_sdr_id, updated_at: now(), updated_by: actor.id } });
    if (!Array.isArray(updatedSale) || !updatedSale.length) return { ok: false, message: 'Não foi possível gravar o SDR participante em uma das vendas. Atualize a tela e tente novamente.' };
    await audit(actor, 'sale.sdr.assign_for_receipt', 'sale', sale.id, ['sdrId'], { sdrId: '' }, { sdrId: sale.assigned_sdr_id, isSdrSale: true });
    sale.sdr_id = sale.assigned_sdr_id;
  }
  const notes = String(payload.notes || '').trim().slice(0, 3000);
  const stamp = now();
  const [developmentRows, allSales] = await Promise.all([
    listAll('crm_developments', { select: 'id,name' }),
    listAll('crm_sales', { select: 'id,process_number,internal_number,buyer_name,unit,unit_value,development_id,sold_at' })
  ]);
  const developmentById = new Map((developmentRows || []).map((item) => [String(item.id), item.name]));
  const saleContexts = salesWithSdr.map((sale) => ({ ...sale, development_name: developmentById.get(String(sale.development_id)) || '' }));
  const created = [];
  let notificationDelayed = false;
  try {
    for (const item of recipientGroups.values()) {
      const linesForItem = item.lines;
      const baseCents = linesForItem.reduce((sum, line) => sum + line.allocation.baseCents, 0);
      const grossCents = linesForItem.reduce((sum, line) => sum + line.grossCents, 0);
      const netCents = linesForItem.reduce((sum, line) => sum + line.netCents, 0);
      const withholdingCents = grossCents - netCents;
      const sdrIds = [...new Set(linesForItem.map((line) => line.sale.assigned_sdr_id).filter(Boolean))];
      const sdrIdForDocument = item.role === 'SDR' ? item.user.id : sdrIds.length === 1 ? sdrIds[0] : null;
      const documentRows = await dbRequest('crm_commission_documents', { method: 'POST', prefer: 'return=representation', body: {
        sale_id: linesForItem[0].sale.id, broker_id: broker.id, sdr_id: sdrIdForDocument, recipient_id: item.user.id, recipient_role: item.role,
        manager_id: manager.id, document_type: 'commission_receipt', signature_status: 'pending', payment_status: 'pending',
        commission_base: baseCents / 100, commission_rate_pct: baseCents ? Math.round(grossCents / baseCents * 100 * 10000) / 10000 : 0, gross_commission: grossCents / 100,
        withholding_rate_pct: withholdingRatePct, withholding_amount: withholdingCents / 100, net_commission: netCents / 100,
        broker_amount: item.role === 'Corretor' ? netCents / 100 : 0, sdr_amount: item.role === 'SDR' ? netCents / 100 : 0,
        payment_date: payload.paymentDate, notes, created_by: actor.id, updated_by: actor.id, created_at: stamp, updated_at: stamp
      } });
      const document = Array.isArray(documentRows) ? documentRows[0] : documentRows;
      if (!document) throw new HttpError(502, 'Não foi possível criar o registro do recibo.');
      const generated = { document, path: '', saved: document, links: [], sales: [] };
      created.push(generated);
      const linkRows = linesForItem.map((line) => ({
        commission_document_id: document.id, sale_id: line.sale.id, recipient_id: item.user.id, recipient_role: item.role,
        commission_base: line.allocation.baseCents / 100, sale_gross_commission: line.allocation.saleGrossCents / 100,
        gross_commission: line.grossCents / 100, withholding_rate_pct: withholdingRatePct,
        withholding_amount: (line.grossCents - line.netCents) / 100, net_commission: line.netCents / 100,
        archived_at: null, created_at: stamp
      }));
      const savedLinks = await dbRequest('crm_commission_document_sales', { method: 'POST', prefer: 'return=representation', body: linkRows });
      if (!Array.isArray(savedLinks) || savedLinks.length !== linkRows.length) throw new HttpError(502, 'Não foi possível vincular todas as vendas ao recibo consolidado.');
      generated.links = savedLinks;
      const saleById = new Map(saleContexts.map((sale) => [String(sale.id), sale]));
      const receiptSales = linesForItem.map((line) => ({ ...saleById.get(String(line.sale.id)),
        sale_gross_commission: line.allocation.saleGrossCents / 100, gross_commission: line.grossCents / 100,
        withholding_amount: (line.grossCents - line.netCents) / 100, net_commission: line.netCents / 100
      }));
      generated.sales = receiptSales;
      const bytes = makeCommissionReceiptPdf(document, receiptSales, item.user, manager, profiles || []);
      const firstSale = linesForItem[0].sale;
      const fileLabel = linesForItem.length > 1 ? `consolidado-${linesForItem.length}-vendas` : (firstSale.process_number || firstSale.internal_number || 'venda');
      const fileName = safeFileName(fileLabel + '-recibo-' + item.role.toLocaleLowerCase('pt-BR') + '-' + String(document.id).slice(0, 8) + '.pdf');
      const path = 'generated/' + document.id + '/' + randomBytes(6).toString('hex') + '-' + fileName;
      generated.path = path;
      await storageRequest('object/crm-finance-documents/' + storageObjectPath(path), { method: 'POST', body: bytes, contentType: 'application/pdf', headers: { 'x-upsert': 'false' } });
      const savedRows = await dbRequest('crm_commission_documents', { method: 'PATCH', query: { id: 'eq.' + document.id }, prefer: 'return=representation', body: { generated_storage_path: path, original_name: fileName, mime_type: 'application/pdf', size_bytes: bytes.byteLength, updated_at: now(), updated_by: actor.id } });
      const saved = Array.isArray(savedRows) ? savedRows[0] || document : document;
      generated.saved = saved;
    }
    for (const item of created) {
      const document = item.saved || item.document;
      await audit(actor, 'commission_receipt.generate', 'commission_document', document.id, ['recipientId','recipientRole','sales','grossCommission','withholdingRatePct','withholdingAmount','netCommission','paymentDate'], {}, {
        saleIds: item.links.map((line) => line.sale_id), recipientId: item.document.recipient_id, recipientRole: item.document.recipient_role,
        saleCount: item.links.length, grossCommission: item.document.gross_commission, withholdingRatePct,
        withholdingAmount: item.document.withholding_amount, netCommission: item.document.net_commission,
        paymentDate: payload.paymentDate, fileName: item.document.original_name
      });
    }
    for (const item of created) {
      if (!await notifyCommissionReceiptParticipants(item.saved || item.document, 'commission_receipt_signature_requested')) notificationDelayed = true;
    }
  } catch (error) {
    for (const item of created) {
      if (item.path) await storageRequest('object/crm-finance-documents/' + storageObjectPath(item.path), { method: 'DELETE' }).catch(() => null);
      await dbRequest('crm_commission_documents', { method: 'DELETE', query: { id: 'eq.' + item.document.id } }).catch(() => null);
    }
    throw error;
  }
  const mapSales = (allSales || []).map((sale) => ({ ...sale, development_name: developmentById.get(String(sale.development_id)) || '' }));
  const createdLinks = created.flatMap((item) => item.links);
  const documents = created.map((item) => mapCommissionDocument(item.saved || item.document, userRows, mapSales, createdLinks));
  const sdrDocumentCount = created.filter((item) => item.document.recipient_role === 'SDR').length;
  const skippedMessage = skippedRecipientLines ? ` ${skippedRecipientLines} vínculo(s) de beneficiário que já tinham recibo ativo foram ignorados.` : '';
  const signingMessage = sdrDocumentCount
    ? `Foram gerados ${created.length} recibos separados por beneficiário para ${saleIds.length} venda(s), incluindo ${sdrDocumentCount} recibo(s) de SDR. Cada PDF contém apenas os valores do próprio beneficiário e exige a assinatura dele e do gerente.`
    : `Foram criados ${created.length} recibo(s) consolidado(s) para ${saleIds.length} venda(s). O PDF precisa da assinatura do corretor beneficiário e do gerente.`;
  return { ok: true, documents, document: documents[0] || null,
    message: signingMessage + skippedMessage + (notificationDelayed ? ' Uma notificação aparecerá após a próxima sincronização.' : '') };
}

async function apiCreateCommissionDocument(token, payload = {}) {
  const actor = await verifyActor(token); requireFinanceManager(actor);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  if (Object.keys(payload).some((key) => !['saleId','brokerId','type','notes'].includes(key))) return { ok: false, message: 'Campos do documento inválidos.' };
  const type = String(payload.type || '');
  if (!['invoice','payment_proof','historical'].includes(type)) return { ok: false, message: 'Selecione nota fiscal, comprovante de pagamento ou documento histórico.' };
  const brokerId = String(payload.brokerId || '').trim();
  if (!isUuid(brokerId)) return { ok: false, message: 'Selecione o corretor deste documento.' };
  const users = await listAll('crm_users', { select: 'id,name,role,active,deleted_at' });
  const broker = users.find((user) => String(user.id) === brokerId && user.role === 'Corretor');
  if (!broker) return { ok: false, message: 'Corretor não encontrado.' };
  const saleId = String(payload.saleId || '').trim();
  if (saleId && !isUuid(saleId)) return { ok: false, message: 'Venda vinculada inválida.' };
  if (saleId) {
    const saleRows = await dbRequest('crm_sales', { query: { select: 'id,broker_id,deleted_at', id: `eq.${saleId}`, limit: 1 } });
    const sale = Array.isArray(saleRows) ? saleRows[0] : null;
    if (!sale || sale.deleted_at || String(sale.broker_id) !== brokerId) return { ok: false, message: 'A venda precisa pertencer ao corretor selecionado.' };
  }
  const stamp = now();
  const rows = await dbRequest('crm_commission_documents', { method: 'POST', prefer: 'return=representation', body: {
    sale_id: saleId || null, broker_id: brokerId, sdr_id: null, recipient_id: brokerId, recipient_role: 'Corretor', document_type: type,
    signature_status: 'not_required', payment_status: type === 'payment_proof' ? 'not_applicable' : 'pending',
    commission_base: 0, commission_rate_pct: 0, gross_commission: 0, withholding_rate_pct: 0, withholding_amount: 0,
    net_commission: 0, broker_amount: 0, sdr_amount: 0, notes: String(payload.notes || '').trim().slice(0, 3000),
    created_by: actor.id, updated_by: actor.id, created_at: stamp, updated_at: stamp
  } });
  const doc = Array.isArray(rows) ? rows[0] : rows;
  if (!doc) throw new HttpError(502, 'Não foi possível criar o registro do documento.');
  await audit(actor, 'commission_document.create', 'commission_document', doc.id, ['documentType','brokerId','saleId'], {}, { documentType: type, brokerId, saleId });
  return { ok: true, documentId: doc.id, message: 'Registro criado. Agora anexe o arquivo para concluir.' };
}

async function apiPrepareCommissionDocumentUpload(token, documentId, fileInfo = {}) {
  const actor = await verifyActor(token);
  if (!isUuid(documentId)) return { ok: false, message: 'Documento inválido.' };
  const rows = await dbRequest('crm_commission_documents', { query: { select: '*', id: `eq.${documentId}`, archived_at: 'is.null', limit: 1 } });
  const doc = Array.isArray(rows) ? rows[0] : null;
  if (!doc || !canReadCommissionDocument(actor, doc)) throw new HttpError(404, 'Documento não encontrado ou sem permissão.');
  const isReceipt = doc.document_type === 'commission_receipt';
  if (isReceipt && !isFinanceManager(actor) && !(['Corretor','SDR'].includes(actor.role) && String(doc.recipient_id || doc.broker_id) === String(actor.id))) {
    throw new HttpError(403, 'Somente a gestão financeira ou o beneficiário do recibo pode enviar o arquivo assinado.');
  }
  if (!isReceipt && !isFinanceManager(actor)) throw new HttpError(403, 'Somente gerente e assistente podem anexar notas fiscais, comprovantes e documentos históricos.');
  if (isReceipt && !isFinanceManager(actor) && doc.signature_status !== 'pending') throw new HttpError(403, 'Este recibo não está pendente de assinatura.');
  if (isReceipt && doc.signature_status === 'signed') return { ok: false, message: 'O recibo já foi arquivado como assinado.' };
  const originalName = safeFileName(fileInfo.name);
  const mimeType = String(fileInfo.mimeType || '').toLowerCase();
  const sizeBytes = Number(fileInfo.sizeBytes || 0);
  const allowed = isReceipt ? ['application/pdf'] : ['application/pdf','image/jpeg','image/png','image/webp'];
  const extensionAllowed = isReceipt ? /\.pdf$/i.test(originalName) : /\.(pdf|jpe?g|png|webp)$/i.test(originalName);
  if (!extensionAllowed || !allowed.includes(mimeType) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 10485760) return { ok: false, message: isReceipt ? 'Envie o recibo assinado em PDF com até 10 MB.' : 'Envie um PDF, JPG, PNG ou WebP de até 10 MB.' };
  const path = `${isReceipt ? 'signed' : 'attachments'}/${doc.id}/${randomBytes(8).toString('hex')}-${originalName}`;
  const update = isReceipt
    ? { signed_storage_path: path, original_name: originalName, mime_type: mimeType, size_bytes: sizeBytes, updated_at: now(), updated_by: actor.id }
    : { storage_path: path, original_name: originalName, mime_type: mimeType, size_bytes: sizeBytes, updated_at: now(), updated_by: actor.id };
  const cfg = env();
  const response = await storageRequest(`object/upload/sign/crm-finance-documents/${storageObjectPath(path)}`, { method: 'POST', contentType: 'application/json', body: JSON.stringify({}) });
  const rawUrl = response && (response.signedUrl || response.signedURL || response.url);
  if (!rawUrl) throw new HttpError(502, 'Não foi possível preparar o envio do documento financeiro.');
  const uploadTarget = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `${cfg.url}/storage/v1${rawUrl}`);
  if (response.token && !uploadTarget.searchParams.has('token')) uploadTarget.searchParams.set('token', response.token);
  const updateQuery = { id: `eq.${doc.id}`, archived_at: 'is.null' };
  if (isReceipt) updateQuery.signature_status = 'eq.pending';
  const savedRows = await dbRequest('crm_commission_documents', { method: 'PATCH', query: updateQuery, prefer: 'return=representation', body: update });
  if (!Array.isArray(savedRows) || !savedRows.length) throw new HttpError(409, 'O documento mudou de situação enquanto o envio era preparado. Atualize a tela e tente novamente.');
  await audit(actor, 'commission_document.upload_started', 'commission_document', doc.id, ['arquivo'], {}, { documentType: doc.document_type, fileName: originalName, sizeBytes });
  return { ok: true, documentId: doc.id, uploadKind: isReceipt ? 'signed_receipt' : 'attachment', path, uploadUrl: uploadTarget.toString(), publishableKey: cfg.publishableKey, message: 'Envio preparado.' };
}

async function getCommissionDocumentForActor(actor, documentId) {
  const rows = await dbRequest('crm_commission_documents', { query: { select: '*', id: `eq.${documentId}`, limit: 1 } });
  const doc = Array.isArray(rows) ? rows[0] : null;
  if (!doc || (doc.archived_at && !isFinanceManager(actor)) || !canReadCommissionDocument(actor, doc)) throw new HttpError(404, 'Documento não encontrado ou sem permissão.');
  return doc;
}

async function apiConfirmCommissionDocumentUpload(token, documentId) {
  const actor = await verifyActor(token); requireFinanceManager(actor);
  if (!isUuid(documentId)) return { ok: false, message: 'Documento inválido.' };
  const doc = await getCommissionDocumentForActor(actor, documentId);
  if (doc.archived_at) return { ok: false, message: 'Restaure o documento antes de confirmar ou substituir o arquivo.' };
  if (doc.document_type === 'commission_receipt' || !doc.storage_path) return { ok: false, message: 'Este arquivo não pode ser confirmado por este fluxo.' };
  const info = await storageRequest(`object/info/crm-finance-documents/${storageObjectPath(doc.storage_path)}`);
  if (!info) return { ok: false, message: 'O arquivo ainda não chegou ao armazenamento. Tente novamente.' };
  await audit(actor, 'commission_document.uploaded', 'commission_document', doc.id, ['storage_path','original_name'], {}, { fileName: doc.original_name, mimeType: doc.mime_type, sizeBytes: doc.size_bytes });
  return { ok: true, message: 'Documento anexado e arquivado com acesso restrito.' };
}

async function apiConfirmCommissionReceiptUpload(token, documentId) {
  const actor = await verifyActor(token);
  if (!isUuid(documentId)) return { ok: false, message: 'Documento inválido.' };
  const doc = await getCommissionDocumentForActor(actor, documentId);
  if (doc.document_type !== 'commission_receipt' || !doc.signed_storage_path || doc.signature_status !== 'pending' || doc.archived_at) return { ok: false, message: 'Este recibo não está aguardando o arquivo assinado.' };
  if (!isFinanceManager(actor) && !(['Corretor','SDR'].includes(actor.role) && String(doc.recipient_id || doc.broker_id) === String(actor.id))) throw new HttpError(403, 'Somente gerente, assistente ou beneficiário do recibo podem concluir o envio.');
  const info = await storageRequest(`object/info/crm-finance-documents/${storageObjectPath(doc.signed_storage_path)}`);
  if (!info) return { ok: false, message: 'O arquivo ainda não chegou ao armazenamento. Tente novamente.' };
  const stamp = now();
  if (!doc.signed_uploaded_at) await dbRequest('crm_commission_documents', { method: 'PATCH', query: { id: `eq.${doc.id}`, signature_status: 'eq.pending', archived_at: 'is.null' }, prefer: 'return=minimal', body: { signed_uploaded_at: stamp, signed_uploaded_by: actor.id, updated_at: stamp, updated_by: actor.id } });
  await audit(actor, 'commission_receipt.signed_file_uploaded', 'commission_document', doc.id, ['signed_storage_path','original_name'], {}, { fileName: doc.original_name, uploadedBy: actor.id, signatureStatus: 'pending' });
  const notified = await notifyCommissionReceiptParticipants({ ...doc, signed_uploaded_at: stamp, updated_at: stamp }, 'commission_receipt_signed_file_uploaded');
  return { ok: true, message: 'PDF enviado e mantido pendente até a gestão confirmar as assinaturas externas.' + (notified ? '' : ' A gestão verá o documento na próxima sincronização.') };
}

async function apiConfirmCommissionReceiptSigned(token, documentId, signersConfirmed = {}) {
  const actor = await verifyActor(token);
  requireFinanceManager(actor);
  if (!isUuid(documentId)) return { ok: false, message: 'Documento inválido.' };
  const doc = await getCommissionDocumentForActor(actor, documentId);
  if (doc.document_type !== 'commission_receipt' || !doc.signed_storage_path || !doc.signed_uploaded_at || doc.signature_status !== 'pending') return { ok: false, message: 'O PDF precisa ser enviado e conferido antes da confirmação.' };
  if (!signersConfirmed || typeof signersConfirmed !== 'object' || Array.isArray(signersConfirmed)
    || Object.keys(signersConfirmed).some((key) => !['recipient','broker','manager'].includes(key))) return { ok: false, message: 'Informe as confirmações individuais dos signatários do recibo.' };
  const recipientConfirmed = signersConfirmed.recipient === true || (doc.recipient_role !== 'SDR' && signersConfirmed.broker === true);
  if (!recipientConfirmed || signersConfirmed.manager !== true) return { ok: false, message: 'Confirme as assinaturas externas do beneficiário indicado no recibo e do gerente.' };
  const info = await storageRequest(`object/info/crm-finance-documents/${storageObjectPath(doc.signed_storage_path)}`);
  if (!info) return { ok: false, message: 'O arquivo ainda não chegou ao armazenamento. Tente novamente.' };
  const stamp = now();
  const recipientIsSdr = (doc.recipient_role || 'Corretor') === 'SDR';
  const updated = await dbRequest('crm_commission_documents', { method: 'PATCH', query: { id: `eq.${doc.id}`, signature_status: 'eq.pending', archived_at: 'is.null' }, prefer: 'return=representation', body: {
    signature_status: 'signed',
    broker_signature_confirmed: !recipientIsSdr, broker_signature_confirmed_at: recipientIsSdr ? null : stamp, broker_signature_confirmed_by: recipientIsSdr ? null : actor.id,
    sdr_signature_confirmed: recipientIsSdr, sdr_signature_confirmed_at: recipientIsSdr ? stamp : null, sdr_signature_confirmed_by: recipientIsSdr ? actor.id : null,
    manager_signature_confirmed: true, manager_signature_confirmed_at: stamp, manager_signature_confirmed_by: actor.id,
    updated_at: stamp, updated_by: actor.id
  } });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'O recibo foi alterado por outra pessoa. Atualize a tela.' };
  await audit(actor, 'commission_receipt.signed', 'commission_document', doc.id, ['signature_status','broker_signature_confirmed','sdr_signature_confirmed','manager_signature_confirmed'], { signatureStatus: 'pending' }, { signatureStatus: 'signed', recipientRole: doc.recipient_role || 'Corretor', recipientSigned: true, managerSigned: true, fileName: doc.original_name });
  return { ok: true, message: 'Assinaturas do beneficiário e do gerente conferidas. O recibo está pronto para acompanhamento do pagamento.' };
}

async function apiUpdateCommissionPayment(token, documentId, payload = {}) {
  const actor = await verifyActor(token); requireFinanceManager(actor);
  if (!isUuid(documentId)) return { ok: false, message: 'Documento inválido.' };
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  if (Object.keys(payload).some((key) => !['paid','notes'].includes(key)) || payload.paid !== true) return { ok: false, message: 'Ação de pagamento inválida.' };
  const doc = await getCommissionDocumentForActor(actor, documentId);
  if (doc.document_type !== 'commission_receipt' || doc.signature_status !== 'signed') return { ok: false, message: 'Somente recibos assinados podem ser marcados como pagos.' };
  if (doc.payment_status === 'paid') return { ok: false, message: 'Este recibo já está marcado como pago.' };
  const stamp = now();
  const updated = await dbRequest('crm_commission_documents', { method: 'PATCH', query: { id: `eq.${doc.id}`, payment_status: 'eq.pending', archived_at: 'is.null' }, prefer: 'return=representation', body: {
    payment_status: 'paid', payment_completed_at: stamp, updated_at: stamp, updated_by: actor.id,
    ...(payload.notes ? { notes: String(payload.notes).trim().slice(0, 3000) } : {})
  } });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'O pagamento foi atualizado por outra pessoa. Atualize a tela.' };
  await audit(actor, 'commission_receipt.payment_completed', 'commission_document', doc.id, ['payment_status','payment_completed_at'], { paymentStatus: 'pending' }, { paymentStatus: 'paid', paymentCompletedAt: stamp, brokerAmount: doc.broker_amount, sdrAmount: doc.sdr_amount });
  return { ok: true, message: 'Pagamento integral registrado no histórico do recibo.' };
}

async function apiArchiveCommissionDocument(token, documentId) {
  const actor = await verifyActor(token); requireFinanceManager(actor);
  if (!isUuid(documentId)) return { ok: false, message: 'Documento inválido.' };
  const doc = await getCommissionDocumentForActor(actor, documentId);
  if (doc.archived_at) return { ok: false, message: 'Documento já arquivado.' };
  const stamp = now();
  await dbRequest('crm_commission_documents', { method: 'PATCH', query: { id: `eq.${doc.id}`, archived_at: 'is.null' }, prefer: 'return=minimal', body: { archived_at: stamp, archived_by: actor.id, updated_at: stamp, updated_by: actor.id } });
  await audit(actor, 'commission_document.archive', 'commission_document', doc.id, ['archived_at','archived_by'], { archivedAt: null }, { archivedAt: stamp, documentType: doc.document_type, fileName: doc.original_name });
  return { ok: true, message: 'Documento arquivado. O histórico permanece preservado e pode ser restaurado pela gestão.' };
}

async function apiRestoreCommissionDocument(token, documentId) {
  const actor = await verifyActor(token); requireFinanceManager(actor);
  if (!isUuid(documentId)) return { ok: false, message: 'Documento inválido.' };
  const rows = await dbRequest('crm_commission_documents', { query: { select: '*', id: `eq.${documentId}`, archived_at: 'not.is.null', limit: 1 } });
  const doc = Array.isArray(rows) ? rows[0] : null;
  if (!doc) return { ok: false, message: 'Documento arquivado não encontrado.' };
  if (doc.document_type === 'commission_receipt') {
    const associations = await dbRequest('crm_commission_document_sales', { query: { select: 'sale_id', commission_document_id: `eq.${doc.id}` } });
    const saleIds = [...new Set((Array.isArray(associations) ? associations : []).map((item) => String(item.sale_id)).filter(isUuid))];
    if (saleIds.length) {
      const active = await dbRequest('crm_commission_document_sales', { query: {
        select: 'id', sale_id: `in.(${saleIds.join(',')})`, recipient_id: `eq.${doc.recipient_id || doc.broker_id}`, archived_at: 'is.null', limit: 1
      } });
      if (Array.isArray(active) && active.length) return { ok: false, message: 'Já existe um recibo ativo para uma ou mais vendas deste documento. Arquive os recibos ativos antes de restaurá-lo.' };
    } else if (doc.sale_id) {
      const active = await dbRequest('crm_commission_documents', { query: {
        select: 'id', sale_id: `eq.${doc.sale_id}`, recipient_id: `eq.${doc.recipient_id || doc.broker_id}`, document_type: 'eq.commission_receipt', archived_at: 'is.null', limit: 1
      } });
      if (Array.isArray(active) && active.length) return { ok: false, message: 'Já existe um recibo ativo para esta venda. Arquive-o antes de restaurar este recibo.' };
    }
  }
  const stamp = now();
  await dbRequest('crm_commission_documents', { method: 'PATCH', query: { id: `eq.${doc.id}`, archived_at: 'not.is.null' }, prefer: 'return=minimal', body: { archived_at: null, archived_by: null, updated_at: stamp, updated_by: actor.id } });
  await audit(actor, 'commission_document.restore', 'commission_document', doc.id, ['archived_at','archived_by'], { archivedAt: doc.archived_at }, { archivedAt: null });
  return { ok: true, message: 'Documento restaurado com os arquivos e histórico preservados.' };
}

async function apiGetCommissionDocument(token, documentId, fileKind = '') {
  const actor = await verifyActor(token);
  if (!isUuid(documentId)) throw new HttpError(404, 'Documento não encontrado.');
  const doc = await getCommissionDocumentForActor(actor, documentId);
  const kind = String(fileKind || '');
  const path = kind === 'generated' ? doc.generated_storage_path : kind === 'signed' ? doc.signed_storage_path : doc.storage_path || doc.signed_storage_path || doc.generated_storage_path;
  const name = kind === 'generated' ? `recibo-${doc.id}.pdf` : doc.original_name || `documento-${doc.id}`;
  if (!path) throw new HttpError(404, 'Arquivo ainda não anexado.');
  return { downloadUrl: await signedFinanceDownload(path, name), expiresInSeconds: 90 };
}

async function apiListDevelopments(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  return (await listAll('crm_developments', { select: 'id,name,active' })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function apiSaveDevelopment(token, payload) {
  const actor = await verifyActor(token); requireAdmin(actor);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const allowed = ['id', 'name', 'active'];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) return { ok: false, message: 'A solicitação contém campos não permitidos.' };
  if (Object.prototype.hasOwnProperty.call(payload, 'active') && typeof payload.active !== 'boolean') return { ok: false, message: 'Estado do empreendimento inválido.' };
  const name = String(payload.name || '').trim();
  const id = String(payload.id || '').trim();
  const active = payload.active !== false;
  if (!name || name.length > 150) return { ok: false, message: 'Informe um nome de até 150 caracteres.' };
  const rows = await listAll('crm_developments', { select: 'id,name,active' });
  const existing = id ? rows.find((row) => String(row.id) === id) : null;
  if (id && !existing) return { ok: false, message: 'Empreendimento não encontrado.' };
  if (rows.some((row) => String(row.id) !== id && row.name.trim().toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) return { ok: false, message: 'Já existe um empreendimento com esse nome.' };
  let saved;
  if (existing) {
    const result = await dbRequest('crm_developments', { method: 'PATCH', query: { id: `eq.${id}` }, prefer: 'return=representation', body: { name, active } });
    saved = Array.isArray(result) ? result[0] : null;
  } else {
    const newId = `DEV-${randomBytes(12).toString('hex')}`;
    const result = await dbRequest('crm_developments', { method: 'POST', prefer: 'return=representation', body: { id: newId, name, active } });
    saved = Array.isArray(result) ? result[0] : result;
  }
  if (!saved) throw new HttpError(502, 'Não foi possível salvar o empreendimento.');
  const beforeValues = existing ? { name: existing.name, active: existing.active } : {};
  const afterValues = { name: saved.name, active: saved.active };
  await audit(actor, existing ? 'development.update' : 'development.create', 'development', saved.id, auditChangedFields(beforeValues, afterValues), beforeValues, afterValues);
  return { ok: true, development: saved, message: existing ? 'Empreendimento atualizado.' : 'Empreendimento cadastrado.' };
}

function phoneKey(value) { return String(value || '').replace(/\D/g, ''); }
function importRowValue(row, ...keys) {
  for (const key of keys) if (row && Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  return '';
}

async function validateImportRows(actor, inputRows, context) {
  if (!Array.isArray(inputRows) || !inputRows.length) return { ok: false, message: 'Selecione uma planilha com pelo menos uma linha de cliente.', rows: [] };
  if (inputRows.length > 200) return { ok: false, message: 'Importe no máximo 200 clientes por vez.', rows: [] };
  const allowedKeys = ['name', 'phone', 'development', 'developmentId', 'broker', 'brokerEmail', 'brokerId', 'notes', 'status', 'sdrFeedback'];
  const existingPhones = new Set(context.leads.map((lead) => phoneKey(lead.phone)).filter(Boolean));
  const importedPhones = new Set();
  const results = inputRows.map((row, index) => {
    const errors = [];
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !allowedKeys.includes(key))) return { row: index + 2, valid: false, duplicate: false, errors: ['Formato de linha inválido.'], lead: null };
    const rawDevelopment = String(importRowValue(row, 'developmentId', 'development') || '').trim();
    const development = context.developments.find((item) => item.active === true && (String(item.id).toLocaleLowerCase('pt-BR') === rawDevelopment.toLocaleLowerCase('pt-BR') || item.name.trim().toLocaleLowerCase('pt-BR') === rawDevelopment.toLocaleLowerCase('pt-BR')));
    const rawBroker = String(importRowValue(row, 'brokerId', 'brokerEmail', 'broker') || '').trim().toLocaleLowerCase('pt-BR');
    const broker = context.users.find((item) => item.role === 'Corretor' && item.active === true && [String(item.id).toLocaleLowerCase('pt-BR'), String(item.email).toLocaleLowerCase('pt-BR'), String(item.name).toLocaleLowerCase('pt-BR')].includes(rawBroker));
    if (!development) errors.push('Empreendimento inexistente ou inativo.');
    if (!broker) errors.push('Corretor responsável inexistente ou inativo.');
    const payload = {
      name: importRowValue(row, 'name'), phone: importRowValue(row, 'phone'),
      developmentId: development ? development.id : rawDevelopment,
      brokerId: broker ? broker.id : rawBroker,
      notes: importRowValue(row, 'notes'), sdrFeedback: importRowValue(row, 'sdrFeedback'),
      status: importRowValue(row, 'status') || 'Em contato'
    };
    const validated = CrmDomain.validateLeadInput(actor, payload, null, { isCreate: true });
    if (!validated.ok) errors.push(validated.error);
    const phone = phoneKey(payload.phone);
    const duplicate = Boolean(phone && (existingPhones.has(phone) || importedPhones.has(phone)));
    if (phone) importedPhones.add(phone);
    if (duplicate) errors.push('Telefone duplicado em cadastro existente ou nesta planilha.');
    return { row: index + 2, valid: errors.length === 0, duplicate, errors: [...new Set(errors)], lead: errors.length ? null : validated.value };
  });
  return { ok: true, rows: results, validCount: results.filter((item) => item.valid).length, errorCount: results.filter((item) => item.errors.length).length };
}

async function apiPreviewLeadImport(token, rows) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const context = await loadLeadContext({ includeArchived: true });
  return validateImportRows(actor, rows, context);
}

async function apiImportLeads(token, rows) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const context = await loadLeadContext({ includeArchived: true });
  const preview = await validateImportRows(actor, rows, context);
  if (!preview.ok || preview.errorCount) return { ok: false, message: preview.ok ? 'Corrija os erros ou duplicidades antes de importar; nenhum cliente foi gravado.' : preview.message, preview };
  const stamp = now();
  const payload = preview.rows.map((item) => ({ ...leadToDb(item.lead), broker_id: item.lead.brokerId, status: item.lead.status || 'Em contato', created_by: actor.id, updated_by: actor.id, created_at: stamp, updated_at: stamp }));
  const saved = await dbRequest('crm_leads', { method: 'POST', prefer: 'return=representation', body: payload });
  if (!Array.isArray(saved) || saved.length !== payload.length) {
    const ids = (saved || []).map((item) => item.id).filter(Boolean);
    if (ids.length) await dbRequest('crm_leads', { method: 'DELETE', query: { id: `in.(${ids.join(',')})` } }).catch(() => null);
    throw new HttpError(502, 'A importação não foi concluída. Nenhum cliente deve ser considerado importado; atualize a lista e tente novamente.');
  }
  try {
    const importedAudit = saved.map((item, index) => ({
      user_id: actor.id, email: actor.email, actor_name: actor.name, actor_role: actor.role,
      action: 'lead.import', entity_type: 'lead', entity_id: String(item.id),
      changed_fields: 'name,phone,development_id,notes,status,broker_id', before_values: {},
      after_values: { name: item.name, phone: item.phone, developmentId: item.development_id, notes: item.notes || '', status: item.status, brokerId: item.broker_id, importBatchIndex: index + 1 }
    }));
    await dbRequest('crm_audit', { method: 'POST', prefer: 'return=minimal', body: importedAudit });
  } catch (error) {
    const ids = saved.map((item) => item.id).filter(Boolean);
    if (ids.length) await dbRequest('crm_leads', { method: 'DELETE', query: { id: `in.(${ids.join(',')})` } }).catch(() => null);
    throw error;
  }
  return { ok: true, importedCount: saved.length, message: `${saved.length} cliente(s) importado(s) e atribuído(s) aos corretores selecionados.` };
}

async function apiExportLeads(token, filters) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const [context, staleBusinessDays] = await Promise.all([loadLeadContext(), getFollowupBusinessDays()]);
  const found = CrmDomain.filterLeads(context.leads, actor, filters || {}, { today: now(), staleBusinessDays });
  if (found.length > 10000) throw new HttpError(413, 'A exportação excede 10.000 registros. Aplique filtros e exporte em partes.');
  return found.map((lead) => ({
    name: lead.name, phone: lead.phone, development: lead.developmentName, broker: lead.brokerName,
    brokerEmail: (context.users.find((user) => String(user.id) === String(lead.brokerId)) || {}).email || '',
    status: lead.status, notes: lead.notes, sdrFeedback: lead.sdrFeedback,
    createdAt: lead.createdAt, sdrUpdatedAt: lead.sdrUpdatedAt, updatedAt: lead.updatedAt
  }));
}

async function apiExportReport(token, filters) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const data = await apiGetDashboard(token, filters || {});
  const rows = [['categoria', 'indicador', 'periodo_atual', 'periodo_anterior']];
  rows.push(['Operação', 'Total de clientes na seleção', data.total, '']);
  Object.keys(data.stageCounts).forEach((status) => rows.push(['Funil atual', status, data.stageCounts[status], '']));
  data.ranking.forEach((broker) => rows.push(['Corretor', broker.name, broker.total, JSON.stringify(broker.statuses)]));
  const analytics = data.analytics;
  rows.push(['Histórico', 'Novos cadastros', analytics.current.newLeads, analytics.previous.newLeads]);
  rows.push(['Histórico', 'Contatos do SDR', analytics.current.sdrContacts, analytics.previous.sdrContacts]);
  rows.push(['Histórico', 'Conversão geral (%)', analytics.current.overallConversion === null ? '' : analytics.current.overallConversion, analytics.previous.overallConversion === null ? '' : analytics.previous.overallConversion]);
  rows.push(['Histórico', 'Tempo médio até o primeiro contato (horas)', analytics.current.averageFirstContactHours === null ? '' : analytics.current.averageFirstContactHours, analytics.previous.averageFirstContactHours === null ? '' : analytics.previous.averageFirstContactHours]);
  rows.push(['Histórico', 'Follow-ups atrasados', analytics.staleCurrent, analytics.stalePrevious]);
  analytics.current.conversions.forEach((item, index) => {
    const prior = analytics.previous.conversions[index];
    rows.push(['Conversão entre etapas', item.from + ' → ' + item.to, item.rate === null ? '' : item.rate, prior.rate === null ? '' : prior.rate]);
  });
  analytics.alerts.forEach((item) => rows.push(['Alerta', item.title, item.detail, item.severity]));
  return { rows, periodLabel: analytics.periodLabel };
}

async function apiListUsers(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const [users, profiles] = await Promise.all([
    listAll('crm_users', { select: '*', deleted_at: 'is.null' }),
    listAll('crm_user_contract_profiles', { select: '*' })
  ]);
  return (users || []).map((row) => ({ ...publicUser(row), ...teamContractProfileForUser(row.id, profiles || []) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function apiListArchivedUsers(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  return (await listAll('crm_users', { select: '*', deleted_at: 'not.is.null' }))
    .map((row) => ({ ...publicUser(row), deletedAt: row.deleted_at, wasActive: row.deleted_previous_active === true }))
    .sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
}

async function apiArchiveUser(token, userId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(userId)) return { ok: false, message: 'Usuário inválido.' };
  if (String(userId) === String(actor.id)) return { ok: false, message: 'Você não pode excluir a própria conta conectada.' };
  const target = await getProfile(String(userId));
  if (!target || target.deleted_at) return { ok: false, message: 'Usuário ativo não encontrado.' };
  const rows = await listAll('crm_users', { select: '*' });
  if (target.active && CrmDomain.isAdmin(mapUser(target))) {
    const otherAdmins = rows.filter((item) => String(item.id) !== String(target.id) && item.active === true && !item.deleted_at && CrmDomain.isAdmin(mapUser(item)));
    if (!otherAdmins.length) return { ok: false, message: 'É necessário manter ao menos um perfil administrativo ativo.' };
  }
  const stamp = now();
  const sessionVersion = Number(target.session_version || 0) + 1;
  const updated = await dbRequest('crm_users', {
    method: 'PATCH', query: { id: `eq.${String(userId)}`, deleted_at: 'is.null' }, prefer: 'return=representation',
    body: { active: false, deleted_at: stamp, deleted_by: actor.id, deleted_previous_active: target.active === true, session_version: sessionVersion, updated_at: stamp }
  });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'O usuário já foi alterado. Atualize a lista e tente novamente.' };
  await dbRequest('crm_sessions', { method: 'DELETE', query: { user_id: `eq.${String(userId)}` } });
  await updateAuthProfile(String(userId), { sessionVersion });
  await audit(actor, 'user.archive', 'user', userId, ['active','deleted_at','deleted_by','session_version'], { name: target.name, email: target.email, role: target.role, active: target.active, deletedAt: null }, { name: target.name, email: target.email, role: target.role, active: false, deletedAt: stamp, sessionVersion });
  return { ok: true, message: 'Usuário excluído do acesso. O perfil e os vínculos históricos foram preservados e podem ser restaurados pela gestão.' };
}

async function apiRestoreUser(token, userId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(userId)) return { ok: false, message: 'Usuário inválido.' };
  const target = await getProfile(String(userId));
  if (!target || !target.deleted_at) return { ok: false, message: 'Usuário excluído não encontrado.' };
  const sessionVersion = Number(target.session_version || 0) + 1;
  await updateAuthProfile(String(userId), { sessionVersion });
  const active = target.deleted_previous_active === true;
  const updated = await dbRequest('crm_users', {
    method: 'PATCH', query: { id: `eq.${String(userId)}`, deleted_at: 'not.is.null' }, prefer: 'return=representation',
    body: { active, deleted_at: null, deleted_by: null, deleted_previous_active: null, session_version: sessionVersion, updated_at: now() }
  });
  if (!Array.isArray(updated) || !updated.length) return { ok: false, message: 'O usuário já foi alterado. Atualize a lista e tente novamente.' };
  await audit(actor, 'user.restore', 'user', userId, ['active','deleted_at','deleted_by','session_version'], { name: target.name, email: target.email, role: target.role, active: false, deletedAt: target.deleted_at }, { name: target.name, email: target.email, role: target.role, active, deletedAt: null, sessionVersion });
  return { ok: true, message: active ? 'Usuário restaurado com o acesso que tinha antes da exclusão.' : 'Perfil restaurado; o acesso continua desativado, como estava antes da exclusão.' };
}

async function apiSaveUser(token, payload) {
  const actor = await verifyActor(token); requireAdmin(actor);
  payload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const profileKeys = ['contractCpf','contractCnpj','contractCreci','contractAddress'];
  const allowed = ['id', 'name', 'email', 'role', 'active', 'operationsAccess', 'initialPassword', ...profileKeys];
  const hasContractProfile = profileKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (Object.keys(payload).some((key) => !allowed.includes(key))) return { ok: false, message: 'A solicitação contém campos não permitidos.' };
  if (Object.prototype.hasOwnProperty.call(payload, 'active') && typeof payload.active !== 'boolean') return { ok: false, message: 'Estado do usuário inválido.' };
  const name = String(payload.name || '').trim(); const email = normalizeEmail(payload.email); const role = String(payload.role || '').trim();
  const active = payload.active !== false; const userId = String(payload.id || '').trim();
  const initialPassword = String(payload.initialPassword || '');
  if (!name || name.length > 150) return { ok: false, message: 'Informe o nome (até 150 caracteres).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Informe um e-mail válido.' };
  if (!CRM_CONFIG.roles.includes(role)) return { ok: false, message: 'Perfil inválido.' };
  if (!userId && (initialPassword.length < 12 || initialPassword.length > 128)) return { ok: false, message: 'Defina uma senha inicial entre 12 e 128 caracteres. Ela será trocada no primeiro acesso.' };
  if (userId && Object.prototype.hasOwnProperty.call(payload, 'initialPassword')) return { ok: false, message: 'Para trocar a senha de um usuário existente, use a ação “Definir senha”.' };
  const rows = await listAll('crm_users', { select: '*' });
  const existing = rows.find((item) => String(item.id) === userId) || null;
  if (userId && !existing) return { ok: false, message: 'Usuário não encontrado.' };
  if (existing && existing.deleted_at) return { ok: false, message: 'Restaure o usuário antes de editar seus dados.' };
  if (rows.some((item) => item.id !== userId && normalizeEmail(item.email) === email)) return { ok: false, message: 'Este e-mail já está cadastrado.' };
  if (existing && existing.id === actor.id && (!active || role !== actor.role)) return { ok: false, message: 'Você não pode desativar ou rebaixar sua própria conta.' };
  const existingContractProfileRows = existing
    ? await dbRequest('crm_user_contract_profiles', { query: { select: '*', user_id: `eq.${existing.id}`, limit: 1 } })
    : [];
  const existingContractProfile = Array.isArray(existingContractProfileRows) ? existingContractProfileRows[0] || {} : {};
  const submittedProfile = normalizeTeamContractProfile(payload);
  const profile = {
    cpf: Object.prototype.hasOwnProperty.call(payload, 'contractCpf') ? submittedProfile.cpf : String(existingContractProfile.cpf || ''),
    cnpj: Object.prototype.hasOwnProperty.call(payload, 'contractCnpj') ? submittedProfile.cnpj : String(existingContractProfile.cnpj || ''),
    creci: Object.prototype.hasOwnProperty.call(payload, 'contractCreci') ? submittedProfile.creci : String(existingContractProfile.creci || ''),
    address: Object.prototype.hasOwnProperty.call(payload, 'contractAddress') ? submittedProfile.address : String(existingContractProfile.address || '')
  };
  if (!profile.cpf) return { ok: false, message: 'Informe o CPF do usuário. Nome e CPF são obrigatórios no cadastro da equipe.' };
  if (role === 'Gerente') {
    const missingManagerFields = [['CNPJ',profile.cnpj],['CRECI',profile.creci],['endereço',profile.address]].filter(([,value]) => !String(value || '').trim()).map(([label]) => label);
    if (missingManagerFields.length) return { ok: false, message: 'Complete os dados do gerente: CPF, CNPJ, CRECI e endereço. Faltam: ' + missingManagerFields.join(', ') + '.' };
  }
  const defaultOperationsAccess = role === 'Corretor' ? 'broker' : role === 'SDR' ? 'sdr' : CrmDomain.isAdmin({ role, active }) ? 'viewer' : 'none';
  // A configuração segura do ambiente é a fonte de verdade para "manager". Em
  // registros antigos, uma permissão gravada como manager pode não estar mais
  // autorizada; ao editar dados de equipe, use o acesso efetivo já normalizado
  // (viewer nesse caso), sem bloquear a atualização do perfil contratual.
  const priorAccess = existing ? mapUser(existing).operationsAccess : '';
  let operationsAccess = String(Object.prototype.hasOwnProperty.call(payload, 'operationsAccess') ? payload.operationsAccess : priorAccess || defaultOperationsAccess);
  if (role === 'Corretor') operationsAccess = 'broker';
  else if (role === 'SDR') operationsAccess = 'sdr';
  else {
    if (['broker','sdr'].includes(operationsAccess)) operationsAccess = 'viewer';
    if (!['none','viewer','manager'].includes(operationsAccess)) return { ok: false, message: 'Acesso operacional inválido para este perfil.' };
  }
  const isConfiguredManager = isConfiguredOperationsManager({ id: userId, role, active });
  if (isConfiguredManager) operationsAccess = 'manager';
  const explicitlyGrantingOperationsManager = operationsAccess === 'manager' && !isConfiguredManager
    && (!existing || priorAccess !== 'manager' || Object.prototype.hasOwnProperty.call(payload, 'operationsAccess'));
  if (explicitlyGrantingOperationsManager) {
    return { ok: false, message: 'A gestão operacional está reservada às contas designadas pela empresa e configuradas no ambiente seguro do CRM.' };
  }
  if (actor.role !== 'Administrador' && existing && Object.prototype.hasOwnProperty.call(payload, 'operationsAccess') && operationsAccess !== priorAccess && !isConfiguredManager) return { ok: false, message: 'Somente o perfil Administrador pode alterar o acesso operacional.' };
  const adminsAfter = rows.filter((item) => item.id !== userId && item.active && !item.deleted_at && CrmDomain.isAdmin(mapUser(item))).length + (active && CrmDomain.isAdmin({ role, active }) ? 1 : 0);
  if (adminsAfter < 1) return { ok: false, message: 'É necessário manter ao menos um administrador ativo.' };
  const stamp = now();
  if (!existing) {
    const authUser = await authRequest('admin/users', { method: 'POST', admin: true, body: { email, password: initialPassword, email_confirm: true, app_metadata: { crm_session_version: 0 }, user_metadata: { name } } });
    const user = authUser && (authUser.user || authUser);
    if (!user || !user.id) throw new HttpError(502, 'Não foi possível criar o acesso do usuário.');
    let inserted;
    try {
      inserted = await dbRequest('crm_users', { method: 'POST', prefer: 'return=representation', body: { id: user.id, name, email, role, operations_access: operationsAccess, active, must_change_password: true, session_version: 0, created_at: stamp, updated_at: stamp } });
    } catch (error) {
      await authRequest(`admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', admin: true }).catch(() => null);
      throw error;
    }
    try {
      if (hasContractProfile) await saveTeamContractProfile(actor, user.id, profile);
    } catch (error) {
      await dbRequest('crm_user_contract_profiles', { method: 'DELETE', query: { user_id: `eq.${user.id}` } }).catch(() => null);
      await dbRequest('crm_users', { method: 'DELETE', query: { id: `eq.${user.id}` } }).catch(() => null);
      await authRequest(`admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', admin: true }).catch(() => null);
      throw error;
    }
    const afterValues = { name, email, role, active, operationsAccess, contractProfile: redactedTeamContractProfile(profile) };
    await audit(actor, 'user.create', 'user', user.id, auditChangedFields({}, afterValues), {}, afterValues);
    return { ok: true, user: publicUser(Array.isArray(inserted) ? inserted[0] : null), message: 'Usuário cadastrado com senha inicial. A pessoa deverá criar uma senha própria no primeiro acesso.' };
  }
  const old = mapUser(existing); const beforeValues = { name: old.name, email: old.email, role: old.role, active: old.active, operationsAccess: old.operationsAccess };
  const afterValues = { name, email, role, active, operationsAccess };
  const changedFields = auditChangedFields(beforeValues, afterValues);
  let profileResult = { changedFields: [] };
  if (hasContractProfile) profileResult = await saveTeamContractProfile(actor, existing.id, profile);
  if (!changedFields.length && !profileResult.changedFields.length) return { ok: true, user: publicUser(existing), message: 'Nenhuma alteração detectada.' };
  const changed = old.email !== email || old.role !== role || old.active !== active || old.operationsAccess !== operationsAccess;
  const sessionVersion = Number(old.sessionVersion || 0) + (changed ? 1 : 0);
  let updated = existing;
  if (changedFields.length) {
    if (old.email !== email || changed || old.name !== name) await updateAuthProfile(existing.id, { email: old.email !== email ? email : undefined, name, sessionVersion });
    const updatedRows = await dbRequest('crm_users', { method: 'PATCH', query: { id: `eq.${existing.id}` }, prefer: 'return=representation', body: { name, email, role, operations_access: operationsAccess, active, session_version: sessionVersion, updated_at: stamp } });
    updated = Array.isArray(updatedRows) ? updatedRows[0] || existing : existing;
    await audit(actor, 'user.update', 'user', existing.id, changedFields, beforeValues, afterValues);
  }
  return { ok: true, user: publicUser(updated), message: profileResult.changedFields.length && !changedFields.length ? 'Dados para documentos atualizados no cadastro da equipe.' : 'Usuário atualizado.' };
}

async function apiResetUserPassword(token, userId, payload = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (String(userId) === String(actor.id)) return { ok: false, message: 'Use a opção “Senha” para alterar sua própria senha.' };
  if (!isUuid(userId)) return { ok: false, message: 'Usuário ativo não encontrado.' };
  const row = await getProfile(String(userId || ''));
  if (!row || row.active !== true || row.deleted_at) return { ok: false, message: 'Usuário ativo não encontrado.' };
  const user = mapUser(row); const temporaryPassword = String(payload && payload.password || '');
  if (temporaryPassword.length < 12 || temporaryPassword.length > 128) return { ok: false, message: 'Defina uma nova senha entre 12 e 128 caracteres.' };
  const sessionVersion = user.sessionVersion + 1;
  const locked = await dbRequest('crm_users', {
    method: 'PATCH', query: { id: `eq.${user.id}`, session_version: `eq.${user.sessionVersion}`, active: 'eq.true', deleted_at: 'is.null' },
    prefer: 'return=representation', body: { must_change_password: true, session_version: sessionVersion, updated_at: now() }
  });
  if (!Array.isArray(locked) || !locked.length) return { ok: false, message: 'O usuário foi alterado durante a operação. Atualize a lista e tente novamente.' };
  await dbRequest('crm_sessions', { method: 'DELETE', query: { user_id: `eq.${user.id}` } }).catch(() => null);
  try {
    await setAuthPassword(user.id, temporaryPassword, sessionVersion);
  } catch (_) {
    await audit(actor, 'user.password_reset_blocked', 'user', user.id, ['mustChangePassword','sessionVersion'], { mustChangePassword: user.mustChangePassword, sessionVersion: user.sessionVersion }, { mustChangePassword: true, sessionVersion, authenticationSync: 'pending' }).catch(() => null);
    throw new HttpError(502, 'A senha anterior foi bloqueada preventivamente, mas não foi possível sincronizar a nova senha. O acesso do usuário permanece bloqueado; defina novamente uma senha para concluir.');
  }
  await audit(actor, 'user.password_reset', 'user', user.id, ['mustChangePassword','sessionVersion'], { mustChangePassword: user.mustChangePassword, sessionVersion: user.sessionVersion }, { mustChangePassword: true, sessionVersion });
  return { ok: true, message: 'Nova senha definida. Compartilhe por um canal privado; ela deverá ser trocada no próximo acesso.' };
}

async function apiApplySharedTemporaryPassword(token, password) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isSharedTemporaryPasswordOperator(actor)) throw new HttpError(403, 'Somente o operador técnico configurado pode aplicar a senha inicial compartilhada.');
  password = String(password || '');
  if (password.length < 12 || password.length > 128) return { ok: false, message: 'A senha inicial deve ter de 12 a 128 caracteres.' };
  let matchingAdminSession = null;
  try { matchingAdminSession = await authPasswordGrant(actor.email, password); }
  catch (error) { if (![400, 401].includes(error.status)) throw new HttpError(error.status === 429 ? 429 : 502, 'Não foi possível validar a senha administrativa. Tente novamente.'); }
  if (matchingAdminSession) { await authSignOut(matchingAdminSession.access_token); return { ok: false, message: 'Escolha uma senha inicial diferente da senha atual do administrador.' }; }
  const reservation = await dbRequest('crm_settings', { method: 'POST', query: { on_conflict: 'key' }, prefer: 'resolution=ignore-duplicates,return=representation', body: { key: 'shared_temporary_password_applied', value: { status: 'in_progress', started_at: now() } } });
  if (!Array.isArray(reservation) || !reservation.length) return { ok: false, message: 'A senha inicial da equipe já foi aplicada ou está sendo processada.' };
  const targets = (await listAll('crm_users', { select: '*' })).filter((item) => item.active === true && String(item.id) !== String(actor.id));
  if (!targets.length) {
    await dbRequest('crm_settings', { method: 'DELETE', query: { key: 'eq.shared_temporary_password_applied' } });
    return { ok: false, message: 'Não há outras contas ativas para atualizar.' };
  }
  let updatedCount = 0;
  try {
    for (const row of targets) {
      const user = mapUser(row); const sessionVersion = user.sessionVersion + 1;
      const locked = await dbRequest('crm_users', {
        method: 'PATCH', query: { id: `eq.${user.id}`, session_version: `eq.${user.sessionVersion}`, active: 'eq.true', deleted_at: 'is.null' },
        prefer: 'return=representation', body: { must_change_password: true, session_version: sessionVersion, updated_at: now() }
      });
      if (!Array.isArray(locked) || !locked.length) throw new HttpError(409, 'Uma conta foi alterada durante a operação. Aplique novamente após revisar os acessos.');
      await dbRequest('crm_sessions', { method: 'DELETE', query: { user_id: `eq.${user.id}` } }).catch(() => null);
      await setAuthPassword(user.id, password, sessionVersion);
      await audit(actor, 'user.shared_temporary_password', 'user', user.id, ['mustChangePassword','sessionVersion'], { mustChangePassword: user.mustChangePassword, sessionVersion: user.sessionVersion }, { mustChangePassword: true, sessionVersion });
      updatedCount += 1;
    }
    await dbRequest('crm_settings', { method: 'PATCH', query: { key: 'eq.shared_temporary_password_applied' }, prefer: 'return=minimal', body: { value: { status: 'applied', at: now(), updated_count: updatedCount }, updated_at: now() } });
  } catch (_) {
    await dbRequest('crm_settings', { method: 'DELETE', query: { key: 'eq.shared_temporary_password_applied' } }).catch(() => null);
    throw new HttpError(502, `A aplicação foi interrompida após ${updatedCount} conta(s). Revise os acessos antes de liberar a equipe e tente novamente.`);
  }
  return { ok: true, updatedCount, message: 'Senha temporária aplicada. Cada pessoa deverá criar uma senha própria no primeiro acesso; sua conta atual foi preservada.' };
}

const api = {
  apiBootstrapInfo, apiBootstrapAdmin, apiLogin, apiRefresh, apiLogout, apiChangePassword,
  apiGetReferenceData, apiGetDashboard, apiListLeads, apiGetSdrHistory, apiSaveLead,
  apiGetSdrWorklist, apiListLeadAttempts, apiAddLeadAttempt, apiFlagPhoneIncorrect, apiListAudit,
  apiListUsers, apiSaveUser, apiListArchivedUsers, apiArchiveUser, apiRestoreUser,
  apiListArchivedLeads, apiArchiveLead, apiRestoreLead,
  apiListSales, apiSaveSale, apiArchiveSale, apiRestoreSale, apiAddSaleReceipt, apiVoidSaleReceipt, apiListBrokerProfiles, apiSaveBrokerProfile,
  apiListContracts, apiListContractLeads, apiSaveContract, apiGenerateContract, apiGetContractTemplate, apiSaveContractTemplate, apiArchiveContract, apiRestoreContract,
  apiCreateContractUpload, apiConfirmContractSigned, apiGetContractDocument,
  apiListCommissionDocuments, apiCreateCommissionReceipt, apiCreateCommissionDocument, apiPrepareCommissionDocumentUpload,
  apiConfirmCommissionDocumentUpload, apiConfirmCommissionReceiptUpload, apiConfirmCommissionReceiptSigned, apiUpdateCommissionPayment,
  apiArchiveCommissionDocument, apiRestoreCommissionDocument, apiGetCommissionDocument,
  apiResetUserPassword, apiApplySharedTemporaryPassword,
  apiListDevelopments, apiSaveDevelopment, apiPreviewLeadImport, apiImportLeads, apiExportLeads, apiExportReport, apiSaveFollowupDays,
  apiGetOperationsDashboard, apiListOperationBrokers, apiListProduction, apiSaveProduction, apiArchiveProduction,
  apiListOperationGoals, apiSaveOperationGoal, apiSaveOperationGoalsBatch, apiDeleteOperationGoal, apiListAttendance, apiSetAttendance,
  apiExportOperationsReport, apiPreviewOperationsImport, apiImportOperations,
  apiListAppointments, apiSaveAppointment, apiArchiveAppointment, apiListManagerLocations, apiSaveManagerLocation, apiArchiveManagerLocation,
  apiListNotifications, apiMarkNotificationRead,
  apiListComplaints, apiCreateComplaint, apiUpdateComplaint, apiGetSalesHealthDashboard
};

export default async (request) => {
  if (request.method !== 'POST') return json({ message: 'Método não permitido.' }, 405);
  const origin = request.headers.get('origin');
  if (origin) {
    try { if (new URL(origin).origin !== new URL(request.url).origin) return json({ message: 'Origem não permitida.' }, 403); }
    catch (_) { return json({ message: 'Origem não permitida.' }, 403); }
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) return json({ message: 'Solicitação muito grande.' }, 413);
  let body;
  try { body = await request.json(); } catch (_) { return json({ message: 'Solicitação inválida.' }, 400); }
  const method = String(body && body.method || '');
  const args = body && Array.isArray(body.args) ? body.args : [];
  if (!ALLOWED_METHODS.has(method) || typeof api[method] !== 'function') return json({ message: 'Operação não reconhecida.' }, 404);
  try {
    const result = await api[method](...args);
    if (MUTATING_METHODS.has(method) && result && result.ok !== false) await emitSyncSignal();
    return json(result);
  }
  catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : 'Não foi possível concluir a operação. Tente novamente.';
    return json({ message }, status);
  }
};

export const __test = { normalizeEmail, isUuid, mapUser, mapLead, leadToDb, decodeClaims, signInResult, verifyActor };
