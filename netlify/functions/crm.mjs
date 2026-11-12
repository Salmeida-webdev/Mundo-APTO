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
  'apiListAudit', 'apiListSales', 'apiSaveSale', 'apiAddSaleReceipt', 'apiListBrokerProfiles', 'apiSaveBrokerProfile',
  'apiListContracts', 'apiListContractLeads', 'apiSaveContract', 'apiGenerateContract', 'apiGetContractTemplate', 'apiSaveContractTemplate',
  'apiCreateContractUpload', 'apiConfirmContractSigned', 'apiGetContractDocument',
  'apiListArchivedLeads', 'apiArchiveLead', 'apiRestoreLead',
  'apiListArchivedUsers', 'apiArchiveUser', 'apiRestoreUser',
  'apiResetUserPassword', 'apiApplySharedTemporaryPassword', 'apiListDevelopments',
  'apiSaveDevelopment', 'apiPreviewLeadImport', 'apiImportLeads', 'apiExportLeads', 'apiExportReport', 'apiSaveFollowupDays'
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
    await response.text().catch(() => '');
    throw new HttpError(response.status === 404 ? 404 : response.status >= 500 ? 502 : 400, 'Não foi possível acessar os dados do CRM.');
  }
  if (response.status === 204) return returnCount ? { data: null, total: 0 } : null;
  const data = await response.json().catch(() => null);
  if (!returnCount) return data;
  const totalPart = (response.headers.get('content-range') || '').split('/').pop();
  const total = totalPart && totalPart !== '*' ? Number(totalPart) : Array.isArray(data) ? data.length : 0;
  return { data, total: Number.isFinite(total) ? total : 0 };
}

async function storageRequest(path, { method = 'GET', body, contentType, headers: extraHeaders = {} } = {}) {
  const cfg = env();
  const headers = { apikey: cfg.secretKey, Authorization: `Bearer ${cfg.secretKey}`, ...extraHeaders };
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
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active === true, mustChangePassword: row.must_change_password === true, sessionVersion: Number(row.session_version || 0), createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at || '', deletedBy: row.deleted_by || '', deletedPreviousActive: row.deleted_previous_active === true };
}
function publicUser(row) {
  const user = mapUser(row);
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, mustChangePassword: user.mustChangePassword };
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
  const profile = await getProfile(authUser && authUser.id);
  if (!profile || profile.active !== true || profile.deleted_at || normalizeEmail(profile.email) !== normalizeEmail(authUser.email)) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  const claimVersion = Number(claims.app_metadata && claims.app_metadata.crm_session_version || 0);
  if (claimVersion !== Number(profile.session_version || 0)) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  const actor = mapUser(profile);
  if (actor.mustChangePassword && !allowPasswordChange) throw new HttpError(403, 'Altere a senha temporária antes de continuar.');
  return actor;
}

async function audit(actor, action, entityType, entityId, changedFields, beforeValues = {}, afterValues = {}) {
  await dbRequest('crm_audit', { method: 'POST', prefer: 'return=minimal', body: {
    user_id: actor.id, email: actor.email, actor_name: actor.name, actor_role: actor.role,
    action, entity_type: entityType, entity_id: String(entityId),
    changed_fields: Array.isArray(changedFields) ? changedFields.join(',') : String(changedFields || ''),
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
    if (error.status === 401) return { ok: false, message: 'E-mail ou senha inválidos.' };
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
  await authRequest('user', { method: 'PUT', token, body: { password: newPassword } });
  await dbRequest('crm_users', { method: 'PATCH', query: { id: `eq.${actor.id}` }, prefer: 'return=minimal', body: { must_change_password: false, updated_at: now() } });
  await audit(actor, 'user.password_change', 'user', actor.id, ['password'], { password: '[redigida]' }, { password: '[redigida]' });
  return { ok: true, message: 'Senha alterada. Entre novamente com a nova senha.' };
}

async function apiGetReferenceData(token) {
  const actor = await verifyActor(token, true);
  const [developments, users] = await Promise.all([
    dbRequest('crm_developments', { query: { select: 'id,name,active', active: 'eq.true', order: 'name.asc' } }),
    isAdmin(actor) || actor.role === 'SDR' ? listAll('crm_users', { select: '*' }) : Promise.resolve([])
  ]);
  return {
    systemName: CRM_CONFIG.systemName, user: publicUser(await getProfile(actor.id)), statuses: CRM_CONFIG.statuses,
    repassStatuses: CRM_CONFIG.repassStatuses,
    developments: (developments || []).map((item) => ({ id: item.id, name: item.name, active: item.active })),
    brokers: (users || []).map(mapUser).filter((item) => item.role === 'Corretor' && !item.deletedAt).map((item) => ({ id: item.id, name: item.name, email: item.email, role: item.role, active: item.active })),
    sdrs: (users || []).map(mapUser).filter((item) => item.role === 'SDR' && item.active && !item.deletedAt).map((item) => ({ id: item.id, name: item.name })),
    managers: (users || []).map(mapUser).filter((item) => item.role === 'Gerente' && item.active && !item.deletedAt).map((item) => ({ id: item.id, name: item.name, role: item.role })),
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

async function apiListLeads(token, filters, page, pageSize, segment = 'all') {
  const actor = await verifyActor(token);
  const [context, staleBusinessDays] = await Promise.all([loadLeadContext(), getFollowupBusinessDays()]);
  const options = { today: now(), staleBusinessDays };
  let found = CrmDomain.filterLeads(context.leads, actor, filters, options);
  if (segment === 'new' || segment === 'followed') {
    if (!(actor.role === 'SDR' || isAdmin(actor))) throw new HttpError(403, 'Acesso restrito ao SDR e à gestão.');
    found = found.filter((lead) => segment === 'new' ? !lead.sdrUpdatedAt : Boolean(lead.sdrUpdatedAt));
  }
  found.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const enriched = found.map((lead) => {
    const info = CrmDomain.staleInfo(lead, options.today, options.staleBusinessDays);
    return Object.assign({}, lead, { staleBusinessDays: info.businessDays, isStale: info.stale, isNewForSdr: !lead.sdrUpdatedAt });
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
  if (!isCreate && !changedFields.length && !isSdrContact) return { ok: true, leadId: existing.id, message: 'Nenhuma alteração detectada.' };
  let saved;
  const dbValues = leadToDb(values);
  if (isCreate) {
    saved = await dbRequest('crm_leads', { method: 'POST', prefer: 'return=representation', body: { ...dbValues, broker_id: targetBroker.id, status: values.status || 'Em contato', created_by: actor.id, updated_by: actor.id, created_at: stamp, updated_at: stamp } });
    saved = Array.isArray(saved) ? saved[0] : saved;
  } else {
    const update = { ...dbValues, broker_id: targetBroker.id, updated_by: actor.id, updated_at: stamp };
    if (isSdrContact) { update.sdr_updated_at = stamp; update.sdr_updated_by = actor.id; }
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
  const before = existing ? { name: existing.name, phone: existing.phone, developmentId: existing.developmentId, notes: existing.notes, sdrFeedback: existing.sdrFeedback, status: existing.status, brokerId: existing.brokerId, phoneCorrectionRequired: existing.phoneCorrectionRequired } : {};
  const after = { name: saved.name, phone: saved.phone, developmentId: saved.development_id, notes: saved.notes, sdrFeedback: saved.sdr_feedback, status: saved.status, brokerId: saved.broker_id, phoneCorrectionRequired: saved.phone_correction_required === true };
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
  if (actor.role !== 'SDR') throw new HttpError(403, 'Somente o SDR pode registrar tentativas de contato.');
  if (!isUuid(leadId)) return { ok: false, message: 'Cliente inválido.' };
  const rows = await dbRequest('crm_leads', { query: { select: 'id,broker_id,status,deleted_at', id: `eq.${leadId}`, limit: 1 } });
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead || lead.deleted_at) return { ok: false, message: 'Cliente não encontrado.' };
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
  const rows = await dbRequest('crm_leads', { query: { select: 'id,broker_id,phone,phone_correction_required,deleted_at', id: `eq.${leadId}`, limit: 1 } });
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead || lead.deleted_at) return { ok: false, message: 'Cliente não encontrado.' };
  if (lead.phone_correction_required) return { ok: true, message: 'A correção do telefone já está pendente para o corretor responsável.' };
  const stamp = now();
  await dbRequest('crm_leads', { method: 'PATCH', query: { id: `eq.${leadId}` }, prefer: 'return=minimal', body: { phone_correction_required: true, phone_correction_requested_at: stamp, phone_correction_requested_by: actor.id, phone_correction_notes: String(notes || '').trim().slice(0, 1000), updated_at: stamp, updated_by: actor.id } });
  const note = String(notes || '').trim().slice(0, 1000);
  await audit(actor, 'lead.phone_correction_requested', 'lead', leadId, ['phoneCorrectionRequired'], { phoneCorrectionRequired: false, phone: lead.phone }, { phoneCorrectionRequired: true, phone: lead.phone, notes: note, requestedAt: stamp, requestedBy: actor.name });
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
  const terminal = new Set(['Desistência', 'Já comprou', 'Reprovado pela Caixa']);
  const rows = context.leads.filter((lead) => !terminal.has(lead.status)).map((lead) => {
    const history = byLead.get(String(lead.id)) || [];
    const latest = history.slice().sort((a, b) => Number(b.attempt_number) - Number(a.attempt_number))[0];
    const lastContactAt = lead.sdrUpdatedAt || lead.createdAt;
    const hoursSinceContact = lastContactAt ? Math.max(0, (timestamp - new Date(lastContactAt).getTime()) / 3600000) : 0;
    return { ...lead, attempts: history.length, lastContactAt, hoursSinceContact, needs24hFollowup: hoursSinceContact >= 24, needsDesistanceReview: Boolean(latest && Number(latest.attempt_number) >= 7 && latest.status_at_attempt === lead.status), needsPhoneCorrection: lead.phoneCorrectionRequired };
  });
  return {
    newLeads: rows.filter((lead) => !lead.sdrUpdatedAt).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
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
  const items = rows.map((item) => ({ id: item.id, at: item.at, userId: item.user_id || '', actorName: item.actor_name || item.email || 'Usuário não identificado', actorRole: item.actor_role || '', action: item.action, entityType: item.entity_type, entityId: item.entity_id, changedFields: item.changed_fields || '', beforeValues: item.before_values || {}, afterValues: item.after_values || {} }));
  return { items, total: result ? result.total : 0, page, pageSize };
}

function parseMoney(value, fieldName) {
  const raw = String(value === undefined || value === null || value === '' ? '0' : value).trim();
  const normalized = raw.includes(',') && raw.includes('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999.99 || Math.round(amount * 100) !== amount * 100) throw new HttpError(400, `${fieldName} deve ser um valor monetário válido com até duas casas decimais.`);
  return Math.round(amount * 100) / 100;
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

async function apiListSales(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const [sales, receipts, users, developments] = await Promise.all([
    listAll('crm_sales', { select: '*', deleted_at: 'is.null' }), listAll('crm_sales_receipts', { select: '*' }),
    listAll('crm_users', { select: '*' }), listAll('crm_developments', { select: '*' })
  ]);
  const receiptGroups = new Map();
  (receipts || []).forEach((item) => {
    const key = String(item.sale_id); const list = receiptGroups.get(key) || [];
    list.push({ id: item.id, amount: Number(item.amount), receivedAt: item.received_at, notes: item.notes || '', createdAt: item.created_at });
    receiptGroups.set(key, list);
  });
  return (sales || []).map((row) => {
    const broker = users.find((item) => String(item.id) === String(row.broker_id));
    const development = developments.find((item) => String(item.id) === String(row.development_id));
    const payments = receiptGroups.get(String(row.id)) || [];
    const received = Math.round(payments.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    return { id: row.id, internalNumber: row.internal_number, processNumber: row.process_number || '', leadId: row.lead_id || '', buyerName: row.buyer_name,
      developmentId: row.development_id || '', developmentName: development ? development.name : '', brokerId: row.broker_id,
      brokerName: broker ? broker.name : 'Corretor inativo', soldAt: row.sold_at, unit: row.unit || '', unitValue: Number(row.unit_value || 0),
      saleStatus: row.sale_status, hasPending: row.has_pending === true, pendingDescription: row.pending_description || '',
      accounted: row.accounted === true, accountedAt: row.accounted_at || '', expectedRepass: Number(row.expected_repass || 0),
      receivedRepass: received, balanceRepass: Math.round((Number(row.expected_repass || 0) - received) * 100) / 100,
      repassStatus: row.repass_status, notes: row.notes || '', receipts: payments.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))) };
  }).sort((a, b) => String(b.soldAt).localeCompare(String(a.soldAt)) || String(b.internalNumber).localeCompare(String(a.internalNumber)));
}

async function apiSaveSale(token, payload = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const allowed = ['id','processNumber','leadId','buyerName','developmentId','brokerId','soldAt','unit','unitValue','saleStatus','hasPending','pendingDescription','accounted','expectedRepass','repassStatus','notes'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some((key) => !allowed.includes(key))) return { ok: false, message: 'Campos da venda inválidos.' };
  const buyerName = String(payload.buyerName || '').trim();
  const processNumber = String(payload.processNumber || '').trim().slice(0, 100);
  const developmentId = String(payload.developmentId || '').trim();
  const brokerId = String(payload.brokerId || '').trim();
  const soldAt = String(payload.soldAt || '').slice(0, 10);
  const unit = String(payload.unit || '').trim().slice(0, 100);
  const saleStatus = String(payload.saleStatus || 'Cadastrada');
  const repassStatus = String(payload.repassStatus || 'AGUARDANDO PJ');
  if (!buyerName || buyerName.length > 150) return { ok: false, message: 'Informe o nome do cliente da venda.' };
  if (!developmentId || !brokerId || !isValidDateOnly(soldAt) || !unit) return { ok: false, message: 'Empreendimento, corretor, data da venda válida e unidade são obrigatórios.' };
  if (!['Cadastrada','Em conferência','Com pendência','Regularizada','Cancelada'].includes(saleStatus)) return { ok: false, message: 'Status da venda inválido.' };
  if (!CRM_CONFIG.repassStatuses.includes(repassStatus)) return { ok: false, message: 'Fase do repasse inválida.' };
  const unitValue = parseMoney(payload.unitValue, 'Valor da unidade');
  const expectedRepass = parseMoney(payload.expectedRepass, 'Valor previsto do repasse');
  const pendingDescription = String(payload.pendingDescription || '').trim().slice(0, 2000);
  const notes = String(payload.notes || '').trim().slice(0, 3000);
  const id = String(payload.id || '').trim();
  if (id && !isUuid(id)) return { ok: false, message: 'Venda inválida.' };
  const existingRows = id ? await dbRequest('crm_sales', { query: { select: '*', id: `eq.${id}`, deleted_at: 'is.null', limit: 1 } }) : null;
  const existing = Array.isArray(existingRows) ? existingRows[0] || null : null;
  if (id && !existing) return { ok: false, message: 'Venda não encontrada.' };
  const userRows = await listAll('crm_users', { select: '*' });
  const broker = userRows.find((item) => String(item.id) === brokerId && item.role === 'Corretor' && ((item.active === true && !item.deleted_at) || (existing && String(existing.broker_id) === brokerId)));
  const developmentRows = await listAll('crm_developments', { select: 'id,name,active' });
  if (!broker) return { ok: false, message: 'Selecione um corretor ativo.' };
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
  const accounted = payload.accounted === true;
  const stamp = now();
  const values = { process_number: processNumber, lead_id: leadId || null, buyer_name: buyerName, development_id: developmentId, broker_id: brokerId,
    sold_at: soldAt, unit, unit_value: unitValue, sale_status: saleStatus, has_pending: payload.hasPending === true,
    pending_description: pendingDescription, accounted, accounted_at: accounted ? (existing && existing.accounted_at || stamp) : null,
    accounted_by: accounted ? (existing && existing.accounted ? existing.accounted_by : actor.id) : null, expected_repass: expectedRepass, repass_status: repassStatus, notes, updated_at: stamp, updated_by: actor.id };
  const before = existing ? { internalNumber: existing.internal_number, processNumber: existing.process_number || '', leadId: existing.lead_id || '', buyerName: existing.buyer_name, developmentId: existing.development_id, brokerId: existing.broker_id, soldAt: existing.sold_at, unit: existing.unit, unitValue: Number(existing.unit_value), saleStatus: existing.sale_status, hasPending: existing.has_pending, pendingDescription: existing.pending_description, accounted: existing.accounted, expectedRepass: Number(existing.expected_repass), repassStatus: existing.repass_status, notes: existing.notes } : {};
  const after = { processNumber, leadId: leadId || '', buyerName, developmentId, brokerId, soldAt, unit, unitValue, saleStatus, hasPending: payload.hasPending === true, pendingDescription, accounted, expectedRepass, repassStatus, notes };
  const changedFields = auditChangedFields(before, after);
  if (existing && !changedFields.length) return { ok: true, saleId: existing.id, internalNumber: existing.internal_number, message: 'Nenhuma alteração detectada.' };
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
  return { ok: true, saleId: saved.id, internalNumber: saved.internal_number, message: existing ? 'Venda atualizada.' : `Venda cadastrada com o número ${saved.internal_number}.` };
}

async function apiAddSaleReceipt(token, saleId, payload = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(saleId)) return { ok: false, message: 'Venda inválida.' };
  const amount = parseMoney(payload.amount, 'Valor recebido');
  const receivedAt = String(payload.receivedAt || '').slice(0, 10);
  const notes = String(payload.notes || '').trim().slice(0, 1000);
  if (amount <= 0 || !isValidDateOnly(receivedAt)) return { ok: false, message: 'Informe um valor maior que zero e uma data válida para o recebimento.' };
  const response = await dbRequest('rpc/crm_add_sale_receipt', { method: 'POST', body: { p_sale_id: saleId, p_actor_id: actor.id, p_amount: amount, p_received_at: receivedAt, p_notes: notes } });
  const result = Array.isArray(response) ? response[0] : response;
  if (!result) throw new HttpError(502, 'Não foi possível registrar o recebimento.');
  const beforeValues = { receivedAmount: Math.round((Number(result.received_total) - amount) * 100) / 100, balanceRepass: Number(result.balance) + amount };
  const afterValues = { receivedAmount: Number(result.received_total), receivedAt, balanceRepass: Number(result.balance), notes };
  await audit(actor, 'sale.receipt.create', 'sale', saleId, auditChangedFields(beforeValues, afterValues), beforeValues, afterValues);
  return { ok: true, message: 'Recebimento registrado; a fase selecionada pela gestão foi preservada.', totalReceived: Number(result.received_total), balance: Number(result.balance), repassStatus: result.repass_status };
}

async function apiListBrokerProfiles(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const [profiles, users] = await Promise.all([listAll('crm_broker_profiles', { select: '*' }), listAll('crm_users', { select: 'id,name,email,role,active,deleted_at' })]);
  const brokers = users.filter((item) => item.role === 'Corretor' && !item.deleted_at);
  return brokers.map((item) => {
    const profile = profiles.find((row) => row.broker_id === item.id) || {};
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
  const currentRows = await dbRequest('crm_broker_profiles', { query: { select: '*', broker_id: `eq.${brokerId}`, limit: 1 } });
  const current = Array.isArray(currentRows) ? currentRows[0] || null : null;
  const values = { cpf: fields.cpf, cnpj: fields.cnpj, creci: fields.creci, address: fields.address, updated_at: now(), updated_by: actor.id };
  const beforeValues = current ? { cpf: current.cpf || '', cnpj: current.cnpj || '', creci: current.creci || '', address: current.address || '' } : {};
  const changedFields = auditChangedFields(beforeValues, fields);
  if (current && !changedFields.length) return { ok: true, profile: current, message: 'Nenhuma alteração detectada.' };
  const savedRows = current
    ? await dbRequest('crm_broker_profiles', { method: 'PATCH', query: { broker_id: `eq.${brokerId}` }, prefer: 'return=representation', body: values })
    : await dbRequest('crm_broker_profiles', { method: 'POST', prefer: 'return=representation', body: { broker_id: brokerId, ...values } });
  const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;
  await audit(actor, current ? 'broker_profile.update' : 'broker_profile.create', 'broker_profile', brokerId, changedFields, beforeValues, fields);
  return { ok: true, profile: saved, message: 'Dados cadastrais do corretor salvos.' };
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
  <table><tr><td><span class="label">Corretor responsável</span><span class="value">{{corretor_nome}}</span></td><td><span class="label">CRECI/SP</span><span class="value">{{corretor_creci}}</span></td></tr>
  <tr><td><span class="label">CPF do corretor</span><span class="value">{{corretor_cpf}}</span></td><td><span class="label">SDR</span><span class="value">{{sdr_nome}}</span></td></tr>
  <tr><td><span class="label">CNPJ do corretor</span><span class="value">{{corretor_cnpj}}</span></td><td><span class="label">Endereço do corretor</span><span class="value">{{corretor_endereco}}</span></td></tr>
  <tr><td><span class="label">CPF do SDR</span><span class="value">{{sdr_cpf}}</span></td><td><span class="label">Gestor</span><span class="value">{{gerente_nome}}</span></td></tr></table>
  <h2>3. COMISSÃO E PRÊMIO</h2>
  <table><tr><td><span class="label">Comissão total (percentual: {{percentual_comissao}})</span><span class="value">{{comissao_bruta}}</span></td><td><span class="label">Base de cálculo</span><span class="value">{{base_calculo_comissao}}</span></td></tr>
  <tr><td><span class="label">Corretor — 50%</span><span class="value">{{comissao_corretor}}</span></td><td><span class="label">SDR — 50%</span><span class="value">{{comissao_sdr}}</span></td></tr>
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

async function apiGetContractTemplate(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const rows = await dbRequest('crm_settings', { query: { select: 'value', key: 'eq.contract_template_html', limit: 1 } });
  const value = Array.isArray(rows) && rows[0] ? rows[0].value : '';
  const savedTemplate = typeof value === 'string' ? value : value && value.html || '';
  return { template: savedTemplate.trim() ? savedTemplate : DEFAULT_CONTRACT_TEMPLATE_HTML, placeholders: ['{{numero_contrato}}','{{numero_proposta}}','{{cliente_nome}}','{{cliente_cpf}}','{{cliente_endereco}}','{{empreendimento}}','{{unidade}}','{{valor_unidade}}','{{corretor_nome}}','{{corretor_cpf}}','{{corretor_cnpj}}','{{corretor_creci}}','{{corretor_endereco}}','{{sdr_nome}}','{{sdr_cpf}}','{{gerente_nome}}','{{percentual_comissao}}','{{base_calculo_comissao}}','{{comissao_bruta}}','{{comissao_corretor}}','{{comissao_sdr}}','{{premio_aplicavel}}','{{percentual_premio}}','{{premio_bruto}}','{{premio_corretor}}','{{premio_sdr}}','{{data_geracao}}'] };
}

async function apiListContractLeads(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const context = await loadLeadContext();
  return context.leads.map((lead) => ({ id: lead.id, name: lead.name, phone: lead.phone, developmentId: lead.developmentId, brokerId: lead.brokerId, brokerName: lead.brokerName, status: lead.status }));
}

function sanitizeContractTemplate(value) {
  const template = String(value || '').trim();
  if (!template || template.length > 100000) throw new HttpError(400, 'O modelo deve ter entre 1 e 100.000 caracteres.');
  if (/<\s*(script|iframe|object|embed|form)\b|\son[a-z]+\s*=|javascript:/i.test(template)) throw new HttpError(400, 'O modelo contém marcação ativa não permitida.');
  return template;
}

async function apiSaveContractTemplate(token, html) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const template = sanitizeContractTemplate(html);
  const previous = await apiGetContractTemplate(token);
  await dbRequest('crm_settings', { method: 'POST', query: { on_conflict: 'key' }, prefer: 'resolution=merge-duplicates,return=minimal', body: { key: 'contract_template_html', value: template, updated_at: now() } });
  const templateSnapshot = (value) => ({
    sha256: createHash('sha256').update(String(value || '')).digest('hex'),
    characters: String(value || '').length,
    content: String(value || '')
  });
  await audit(actor, 'contract_template.update', 'setting', 'contract_template_html', ['template'], { template: templateSnapshot(previous.template) }, { template: templateSnapshot(template) });
  return { ok: true, message: 'Modelo salvo. O texto jurídico continua sob responsabilidade e aprovação da empresa.' };
}

async function apiSaveContract(token, payload = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  const id = String(payload.id || '').trim();
  const allowed = ['id','leadId','brokerId','sdrId','sdrCpf','managerId','buyerName','buyerCpf','buyerAddress','developmentId','unit','unitValue','proposalNumber','commissionBase','commissionRatePct','grossCommission','hasPrize','prizeRatePct','grossPrize'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some((key) => !allowed.includes(key))) return { ok: false, message: 'Campos do contrato inválidos.' };
  const leadId = String(payload.leadId || '').trim();
  if (!isUuid(leadId)) return { ok: false, message: 'Selecione o cliente vinculado ao contrato.' };
  const leads = await dbRequest('crm_leads', { query: { select: 'id,name,phone,broker_id,development_id,deleted_at', id: `eq.${leadId}`, limit: 1 } });
  const lead = Array.isArray(leads) ? leads[0] : null;
  if (!lead || lead.deleted_at) return { ok: false, message: 'Cliente não encontrado.' };
  const users = await listAll('crm_users', { select: 'id,name,role,active,deleted_at' });
  const brokerId = String(payload.brokerId || lead.broker_id);
  const broker = users.find((item) => item.id === brokerId && item.role === 'Corretor' && item.active && !item.deleted_at);
  const sdr = users.find((item) => item.id === String(payload.sdrId || '') && item.role === 'SDR' && item.active && !item.deleted_at);
  const manager = users.find((item) => item.id === String(payload.managerId || actor.id) && item.role === 'Gerente' && item.active && !item.deleted_at);
  if (!broker || broker.id !== lead.broker_id) return { ok: false, message: 'O corretor deve ser o responsável pela carteira do cliente.' };
  if (!sdr) return { ok: false, message: 'Selecione o SDR que assinará o documento.' };
  if (!manager) return { ok: false, message: 'Selecione um gerente ou administrador como signatário.' };
  const developmentId = String(payload.developmentId || lead.development_id || '').trim();
  const developments = await listAll('crm_developments', { select: 'id,name,active' });
  const development = developments.find((item) => item.id === developmentId && item.active);
  if (!development) return { ok: false, message: 'Selecione um empreendimento ativo.' };
  const unit = String(payload.unit || '').trim().slice(0, 100);
  if (!unit) return { ok: false, message: 'Informe a unidade escolhida.' };
  const values = { lead_id: leadId, broker_id: broker.id, sdr_id: sdr.id, sdr_cpf: String(payload.sdrCpf || '').trim().slice(0, 30), manager_id: manager.id,
    buyer_name: String(payload.buyerName || lead.name).trim().slice(0, 150), buyer_cpf: String(payload.buyerCpf || '').trim().slice(0, 30),
    buyer_address: String(payload.buyerAddress || '').trim().slice(0, 500), development_id: developmentId, unit,
    proposal_number: String(payload.proposalNumber || '').trim().slice(0, 100),
    unit_value: parseMoney(payload.unitValue, 'Valor da unidade'), commission_base: parseMoney(payload.commissionBase, 'Base de cálculo da comissão'),
    commission_rate_pct: parseOptionalPercent(payload.commissionRatePct, 'Percentual da comissão'), gross_commission: parseMoney(payload.grossCommission, 'Comissão bruta'),
    has_prize: payload.hasPrize === true, prize_rate_pct: payload.hasPrize === true ? parseOptionalPercent(payload.prizeRatePct, 'Percentual do prêmio') : null,
    gross_prize: payload.hasPrize === true ? parseMoney(payload.grossPrize, 'Prêmio bruto') : 0, updated_at: now(), updated_by: actor.id };
  if (!values.buyer_name) return { ok: false, message: 'Informe o nome do cliente.' };
  if (values.unit_value <= 0) return { ok: false, message: 'O valor da venda precisa ser maior que zero.' };
  if (values.gross_commission <= 0) return { ok: false, message: 'Informe a comissão bruta total da operação.' };
  if (values.has_prize && values.gross_prize <= 0) return { ok: false, message: 'Informe o valor bruto do prêmio ou desmarque a opção de prêmio.' };
  let existing = null;
  let beforeValues = {};
  if (id) {
    if (!isUuid(id)) return { ok: false, message: 'Contrato inválido.' };
    const rows = await dbRequest('crm_contracts', { query: { select: '*', id: `eq.${id}`, limit: 1 } });
    existing = Array.isArray(rows) ? rows[0] || null : null;
    if (!existing || existing.status !== 'Rascunho') return { ok: false, message: 'Somente rascunhos podem ser editados.' };
    beforeValues = { contractNumber: existing.contract_number, lead_id: existing.lead_id, broker_id: existing.broker_id, sdr_id: existing.sdr_id, manager_id: existing.manager_id,
      sdr_cpf: existing.sdr_cpf || '', buyer_name: existing.buyer_name, buyer_cpf: existing.buyer_cpf, buyer_address: existing.buyer_address, development_id: existing.development_id,
      unit: existing.unit, proposal_number: existing.proposal_number || '', unit_value: Number(existing.unit_value), commission_base: Number(existing.commission_base || 0), commission_rate_pct: existing.commission_rate_pct === null ? null : Number(existing.commission_rate_pct),
      gross_commission: Number(existing.gross_commission), has_prize: existing.has_prize, prize_rate_pct: existing.prize_rate_pct === null ? null : Number(existing.prize_rate_pct), gross_prize: Number(existing.gross_prize) };
    const result = await dbRequest('crm_contracts', { method: 'PATCH', query: { id: `eq.${id}` }, prefer: 'return=representation', body: values });
    existing = Array.isArray(result) ? result[0] : existing;
  } else {
    const contractNumber = `MA-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`;
    const result = await dbRequest('crm_contracts', { method: 'POST', prefer: 'return=representation', body: { ...values, contract_number: contractNumber, created_by: actor.id, created_at: now(), status: 'Rascunho' } });
    existing = Array.isArray(result) ? result[0] : result;
  }
  if (!existing) throw new HttpError(502, 'Não foi possível salvar o contrato.');
  const afterValues = { lead_id: values.lead_id, broker_id: values.broker_id, sdr_id: values.sdr_id, sdr_cpf: values.sdr_cpf, manager_id: values.manager_id,
    buyer_name: values.buyer_name, buyer_cpf: values.buyer_cpf, buyer_address: values.buyer_address, development_id: values.development_id,
    unit: values.unit, proposal_number: values.proposal_number, unit_value: values.unit_value, commission_base: values.commission_base, commission_rate_pct: values.commission_rate_pct,
    gross_commission: values.gross_commission, has_prize: values.has_prize, prize_rate_pct: values.prize_rate_pct, gross_prize: values.gross_prize };
  afterValues.contractNumber = existing.contract_number;
  await audit(actor, id ? 'contract.update' : 'contract.create', 'contract', existing.id, auditChangedFields(beforeValues, afterValues), beforeValues, afterValues);
  return { ok: true, contractId: existing.id, message: id ? 'Rascunho atualizado.' : 'Rascunho de contrato criado.' };
}

async function apiListContracts(token) {
  const actor = await verifyActor(token);
  if (!isAdmin(actor) && !['Corretor','SDR'].includes(actor.role)) throw new HttpError(403, 'Este perfil não pode consultar contratos.');
  const [rows, users, developments, documents] = await Promise.all([
    listAll('crm_contracts', { select: '*', order: 'created_at.desc' }), listAll('crm_users', { select: 'id,name,role' }),
    listAll('crm_developments', { select: 'id,name' }), listAll('crm_contract_documents', { select: 'id,contract_id,document_type,original_name,mime_type,size_bytes,created_at' })
  ]);
  return (rows || []).filter((row) => isAdmin(actor) || (row.status === 'Assinado' && (actor.role === 'Corretor' ? row.broker_id === actor.id : row.sdr_id === actor.id))).map((row) => ({
    id: row.id, contractNumber: row.contract_number, leadId: row.lead_id, brokerId: row.broker_id, brokerName: (users.find((item) => item.id === row.broker_id) || {}).name || '',
    sdrId: row.sdr_id, sdrName: (users.find((item) => item.id === row.sdr_id) || {}).name || '', managerId: row.manager_id, managerName: (users.find((item) => item.id === row.manager_id) || {}).name || '',
    buyerName: row.buyer_name, buyerCpf: row.buyer_cpf || '', buyerAddress: row.buyer_address || '', developmentId: row.development_id,
    developmentName: (developments.find((item) => item.id === row.development_id) || {}).name || '', unit: row.unit, unitValue: Number(row.unit_value),
    proposalNumber: row.proposal_number || '', sdrCpf: row.sdr_cpf || '', commissionBase: Number(row.commission_base || 0), commissionRatePct: row.commission_rate_pct === null ? null : Number(row.commission_rate_pct),
    grossCommission: Number(row.gross_commission), brokerCommission: Number(row.broker_commission), sdrCommission: Number(row.sdr_commission),
    hasPrize: row.has_prize === true, prizeRatePct: row.prize_rate_pct === null ? null : Number(row.prize_rate_pct), grossPrize: Number(row.gross_prize), brokerPrize: Number(row.broker_prize), sdrPrize: Number(row.sdr_prize),
    status: row.status, generatedAt: row.generated_at || '', signedAt: row.signed_at || '',
    documents: (documents || []).filter((doc) => doc.contract_id === row.id && (isAdmin(actor) || (row.status === 'Assinado' && doc.document_type === 'signed'))).map((doc) => ({ id: doc.id, type: doc.document_type, name: doc.original_name, mimeType: doc.mime_type, sizeBytes: Number(doc.size_bytes), createdAt: doc.created_at }))
  }));
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

async function apiGenerateContract(token, contractId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(contractId)) return { ok: false, message: 'Contrato inválido.' };
  const contractRows = await dbRequest('crm_contracts', { query: { select: '*', id: `eq.${contractId}`, limit: 1 } });
  const contract = Array.isArray(contractRows) ? contractRows[0] : null;
  if (!contract || contract.status === 'Cancelado' || contract.status === 'Assinado') return { ok: false, message: 'Este contrato não pode ser gerado neste estado.' };
  const templateInfo = await apiGetContractTemplate(token);
  if (!templateInfo.template) return { ok: false, message: 'Cadastre o modelo aprovado da empresa antes de gerar documentos.' };
  const [users, developments, profiles] = await Promise.all([listAll('crm_users', { select: 'id,name,email,role' }), listAll('crm_developments', { select: 'id,name' }), listAll('crm_broker_profiles', { select: '*' })]);
  const broker = users.find((item) => item.id === contract.broker_id) || {};
  const sdr = users.find((item) => item.id === contract.sdr_id) || {};
  const manager = users.find((item) => item.id === contract.manager_id) || {};
  const development = developments.find((item) => item.id === contract.development_id) || {};
  const profile = profiles.find((item) => item.broker_id === contract.broker_id) || {};
  if (!contract.buyer_cpf || !contract.sdr_cpf) return { ok: false, message: 'Preencha o CPF do comprador e do SDR no rascunho antes de gerar o termo.' };
  if (!profile.cpf || !profile.cnpj || !profile.creci || !profile.address) return { ok: false, message: 'Complete CPF, CNPJ, CRECI e endereço no cadastro do corretor antes de gerar o termo.' };
  const values = {
    numero_contrato: contract.contract_number, numero_proposta: contract.proposal_number || 'Não informado', cliente_nome: contract.buyer_name, cliente_cpf: contract.buyer_cpf,
    cliente_endereco: contract.buyer_address, empreendimento: development.name || '', unidade: contract.unit,
    valor_unidade: formatCurrency(contract.unit_value), corretor_nome: broker.name || '', corretor_cpf: profile.cpf || '',
    corretor_cnpj: profile.cnpj || '', corretor_creci: profile.creci || '', corretor_endereco: profile.address || '',
    sdr_nome: sdr.name || '', sdr_cpf: contract.sdr_cpf || '', gerente_nome: manager.name || '',
    percentual_comissao: formatPercent(contract.commission_rate_pct), base_calculo_comissao: Number(contract.commission_base || 0) > 0 ? formatCurrency(contract.commission_base) : 'Não informado',
    comissao_bruta: formatCurrency(contract.gross_commission),
    comissao_corretor: formatCurrency(contract.broker_commission), comissao_sdr: formatCurrency(contract.sdr_commission),
    premio_aplicavel: contract.has_prize ? 'Sim' : 'Não', percentual_premio: contract.has_prize ? formatPercent(contract.prize_rate_pct) : 'Não se aplica',
    premio_bruto: contract.has_prize ? formatCurrency(contract.gross_prize) : 'Não se aplica',
    premio_corretor: contract.has_prize ? formatCurrency(contract.broker_prize) : 'Não se aplica',
    premio_sdr: contract.has_prize ? formatCurrency(contract.sdr_prize) : 'Não se aplica',
    data_geracao: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date())
  };
  let html = templateInfo.template.replace(/{{([a-z_]+)}}/g, (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? htmlEscape(values[key]) : '');
  if (!/<!doctype\s+html/i.test(html) && !/<html[\s>]/i.test(html)) html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${htmlEscape(contract.contract_number)}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`;
  const path = `generated/${contract.id}/${randomBytes(5).toString('hex')}-${contract.contract_number}.doc`;
  await storageRequest(`object/crm-contracts/${storageObjectPath(path)}`, { method: 'POST', body: Buffer.from(html, 'utf8'), contentType: 'application/msword', headers: { 'x-upsert': 'false' } });
  const updated = await dbRequest('crm_contracts', { method: 'PATCH', query: { id: `eq.${contract.id}` }, prefer: 'return=representation', body: { status: 'Gerado para assinatura', generated_at: now(), generated_by: actor.id, template_snapshot: templateInfo.template, updated_at: now(), updated_by: actor.id } });
  await dbRequest('crm_contract_documents', { method: 'POST', prefer: 'return=minimal', body: { contract_id: contract.id, document_type: 'generated', storage_path: path, original_name: `${contract.contract_number}.doc`, mime_type: 'application/msword', size_bytes: Buffer.byteLength(html), uploaded_by: actor.id } });
  await audit(actor, 'contract.generate', 'contract', contract.id, ['status','documento'], { status: contract.status }, { status: 'Gerado para assinatura', contractNumber: contract.contract_number });
  const url = await signedContractDownload(path, `${contract.contract_number}.doc`);
  return { ok: true, downloadUrl: url, message: 'Documento Word compatível preparado com o modelo aprovado. Baixe, revise e encaminhe para assinatura.' };
}

async function apiCreateContractUpload(token, contractId, fileInfo = {}) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(contractId)) return { ok: false, message: 'Contrato inválido.' };
  const rows = await dbRequest('crm_contracts', { query: { select: 'id,status,contract_number', id: `eq.${contractId}`, limit: 1 } });
  const contract = Array.isArray(rows) ? rows[0] : null;
  if (!contract || contract.status === 'Cancelado' || contract.status === 'Assinado') return { ok: false, message: 'O contrato não está aguardando o arquivo assinado.' };
  const originalName = safeFileName(fileInfo.name);
  const mimeType = String(fileInfo.mimeType || '').toLowerCase();
  const sizeBytes = Number(fileInfo.sizeBytes || 0);
  const allowedTypes = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  const extAllowed = /\.(pdf|doc|docx)$/i.test(originalName);
  if (!extAllowed || !allowedTypes.includes(mimeType) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 10485760) return { ok: false, message: 'Envie um arquivo PDF, DOC ou DOCX de até 10 MB.' };
  const path = `signed/${contract.id}/${randomBytes(8).toString('hex')}-${originalName}`;
  const docRows = await dbRequest('crm_contract_documents', { method: 'POST', prefer: 'return=representation', body: { contract_id: contract.id, document_type: 'signed', storage_path: path, original_name: originalName, mime_type: mimeType, size_bytes: sizeBytes, uploaded_by: actor.id } });
  const doc = Array.isArray(docRows) ? docRows[0] : docRows;
  const cfg = env();
  const response = await storageRequest(`object/upload/sign/crm-contracts/${storageObjectPath(path)}`, { method: 'POST', contentType: 'application/json', body: JSON.stringify({}) });
  const rawUrl = response && (response.signedUrl || response.signedURL || response.url);
  if (!doc || !rawUrl) throw new HttpError(502, 'Não foi possível preparar o envio do documento assinado.');
  const uploadTarget = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `${cfg.url}/storage/v1${rawUrl}`);
  if (response.token && !uploadTarget.searchParams.has('token')) uploadTarget.searchParams.set('token', response.token);
  const uploadUrl = uploadTarget.toString();
  await audit(actor, 'contract.signed_upload_started', 'contract', contract.id, ['arquivo_assinado'], {}, { fileName: originalName, sizeBytes });
  return { ok: true, documentId: doc.id, path, uploadUrl, publishableKey: cfg.publishableKey, message: 'Envio preparado.' };
}

async function apiConfirmContractSigned(token, contractId, documentId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (!isUuid(contractId) || !isUuid(documentId)) return { ok: false, message: 'Contrato ou documento inválido.' };
  const docs = await dbRequest('crm_contract_documents', { query: { select: '*', id: `eq.${documentId}`, contract_id: `eq.${contractId}`, document_type: 'eq.signed', limit: 1 } });
  const doc = Array.isArray(docs) ? docs[0] : null;
  if (!doc) return { ok: false, message: 'Documento assinado não encontrado.' };
  const objectInfo = await storageRequest(`object/info/crm-contracts/${storageObjectPath(doc.storage_path)}`);
  if (!objectInfo) return { ok: false, message: 'O arquivo ainda não chegou ao armazenamento. Tente novamente.' };
  const contracts = await dbRequest('crm_contracts', { query: { select: '*', id: `eq.${contractId}`, limit: 1 } });
  const contract = Array.isArray(contracts) ? contracts[0] : null;
  if (!contract) return { ok: false, message: 'Contrato não encontrado.' };
  await dbRequest('crm_contracts', { method: 'PATCH', query: { id: `eq.${contractId}` }, prefer: 'return=minimal', body: { status: 'Assinado', signed_at: now(), signed_uploaded_by: actor.id, updated_at: now(), updated_by: actor.id } });
  await audit(actor, 'contract.signed', 'contract', contractId, ['status','signed_at'], { status: contract.status }, { status: 'Assinado', documentName: doc.original_name });
  return { ok: true, message: 'Documento assinado registrado. Ele agora aparece para o corretor e o SDR vinculados.' };
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
  const allowed = isAdmin(actor) || (contract.status === 'Assinado' && doc.document_type === 'signed' && ((actor.role === 'Corretor' && contract.broker_id === actor.id) || (actor.role === 'SDR' && contract.sdr_id === actor.id)));
  if (!allowed) throw new HttpError(403, 'Este documento só fica disponível aos perfis autorizados após a assinatura.');
  return { downloadUrl: await signedContractDownload(doc.storage_path, doc.original_name), expiresInSeconds: 90 };
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
  return (await listAll('crm_users', { select: '*', deleted_at: 'is.null' })).map((row) => publicUser(row)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
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
  const allowed = ['id', 'name', 'email', 'role', 'active'];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) return { ok: false, message: 'A solicitação contém campos não permitidos.' };
  if (Object.prototype.hasOwnProperty.call(payload, 'active') && typeof payload.active !== 'boolean') return { ok: false, message: 'Estado do usuário inválido.' };
  const name = String(payload.name || '').trim(); const email = normalizeEmail(payload.email); const role = String(payload.role || '').trim();
  const active = payload.active !== false; const userId = String(payload.id || '').trim();
  if (!name || name.length > 150) return { ok: false, message: 'Informe o nome (até 150 caracteres).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Informe um e-mail válido.' };
  if (!CRM_CONFIG.roles.includes(role)) return { ok: false, message: 'Perfil inválido.' };
  const rows = await listAll('crm_users', { select: '*' });
  const existing = rows.find((item) => String(item.id) === userId) || null;
  if (userId && !existing) return { ok: false, message: 'Usuário não encontrado.' };
  if (existing && existing.deleted_at) return { ok: false, message: 'Restaure o usuário antes de editar seus dados.' };
  if (rows.some((item) => item.id !== userId && normalizeEmail(item.email) === email)) return { ok: false, message: 'Este e-mail já está cadastrado.' };
  if (existing && existing.id === actor.id && (!active || role !== actor.role)) return { ok: false, message: 'Você não pode desativar ou rebaixar sua própria conta.' };
  const adminsAfter = rows.filter((item) => item.id !== userId && item.active && !item.deleted_at && CrmDomain.isAdmin(mapUser(item))).length + (active && CrmDomain.isAdmin({ role, active }) ? 1 : 0);
  if (adminsAfter < 1) return { ok: false, message: 'É necessário manter ao menos um administrador ativo.' };
  const stamp = now();
  if (!existing) {
    const password = newTemporaryPassword();
    const authUser = await authRequest('admin/users', { method: 'POST', admin: true, body: { email, password, email_confirm: true, app_metadata: { crm_session_version: 0 }, user_metadata: { name } } });
    const user = authUser && (authUser.user || authUser);
    if (!user || !user.id) throw new HttpError(502, 'Não foi possível criar o acesso do usuário.');
    let inserted;
    try {
      inserted = await dbRequest('crm_users', { method: 'POST', prefer: 'return=representation', body: { id: user.id, name, email, role, active, must_change_password: true, session_version: 0, created_at: stamp, updated_at: stamp } });
    } catch (error) {
      await authRequest(`admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', admin: true }).catch(() => null);
      throw error;
    }
    const afterValues = { name, email, role, active };
    await audit(actor, 'user.create', 'user', user.id, auditChangedFields({}, afterValues), {}, afterValues);
    return { ok: true, user: publicUser(Array.isArray(inserted) ? inserted[0] : null), message: 'Usuário cadastrado. Use “Gerar senha” para definir a senha temporária de acesso.' };
  }
  const old = mapUser(existing); const beforeValues = { name: old.name, email: old.email, role: old.role, active: old.active };
  const afterValues = { name, email, role, active };
  const changedFields = auditChangedFields(beforeValues, afterValues);
  if (!changedFields.length) return { ok: true, user: publicUser(existing), message: 'Nenhuma alteração detectada.' };
  const changed = old.email !== email || old.role !== role || old.active !== active;
  const sessionVersion = Number(old.sessionVersion || 0) + (changed ? 1 : 0);
  if (old.email !== email || changed || old.name !== name) await updateAuthProfile(existing.id, { email: old.email !== email ? email : undefined, name, sessionVersion });
  const updated = await dbRequest('crm_users', { method: 'PATCH', query: { id: `eq.${existing.id}` }, prefer: 'return=representation', body: { name, email, role, active, session_version: sessionVersion, updated_at: stamp } });
  await audit(actor, 'user.update', 'user', existing.id, changedFields, beforeValues, afterValues);
  return { ok: true, user: publicUser(Array.isArray(updated) ? updated[0] : null), message: 'Usuário atualizado.' };
}

async function apiResetUserPassword(token, userId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (String(userId) === String(actor.id)) return { ok: false, message: 'Use a opção “Senha” para alterar sua própria senha.' };
  if (!isUuid(userId)) return { ok: false, message: 'Usuário ativo não encontrado.' };
  const row = await getProfile(String(userId || ''));
  if (!row || row.active !== true || row.deleted_at) return { ok: false, message: 'Usuário ativo não encontrado.' };
  const user = mapUser(row); const temporaryPassword = newTemporaryPassword(); const sessionVersion = user.sessionVersion + 1;
  await setAuthPassword(user.id, temporaryPassword, sessionVersion);
  await dbRequest('crm_users', { method: 'PATCH', query: { id: `eq.${user.id}` }, prefer: 'return=minimal', body: { must_change_password: true, session_version: sessionVersion, updated_at: now() } });
  await audit(actor, 'user.password_reset', 'user', user.id, ['mustChangePassword','sessionVersion'], { mustChangePassword: user.mustChangePassword, sessionVersion: user.sessionVersion }, { mustChangePassword: true, sessionVersion });
  return { ok: true, temporaryPassword, message: 'Compartilhe a senha temporária por um canal privado. Ela deverá ser alterada no primeiro acesso.' };
}

async function apiApplySharedTemporaryPassword(token, password) {
  const actor = await verifyActor(token); requireAdmin(actor);
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
      await setAuthPassword(user.id, password, sessionVersion);
      await dbRequest('crm_users', { method: 'PATCH', query: { id: `eq.${user.id}` }, prefer: 'return=minimal', body: { must_change_password: true, session_version: sessionVersion, updated_at: now() } });
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
  apiListSales, apiSaveSale, apiAddSaleReceipt, apiListBrokerProfiles, apiSaveBrokerProfile,
  apiListContracts, apiListContractLeads, apiSaveContract, apiGenerateContract, apiGetContractTemplate, apiSaveContractTemplate,
  apiCreateContractUpload, apiConfirmContractSigned, apiGetContractDocument,
  apiResetUserPassword, apiApplySharedTemporaryPassword,
  apiListDevelopments, apiSaveDevelopment, apiPreviewLeadImport, apiImportLeads, apiExportLeads, apiExportReport, apiSaveFollowupDays
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
  try { return json(await api[method](...args)); }
  catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : 'Não foi possível concluir a operação. Tente novamente.';
    return json({ message }, status);
  }
};

export const __test = { normalizeEmail, isUuid, mapUser, mapLead, leadToDb, decodeClaims, signInResult, verifyActor };
