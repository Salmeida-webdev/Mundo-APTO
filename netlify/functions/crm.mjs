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
  'apiResetUserPassword', 'apiApplySharedTemporaryPassword'
]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function env() {
  const config = {
    url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
    secretKey: process.env.SUPABASE_SECRET_KEY || '',
    bootstrapSecret: process.env.CRM_BOOTSTRAP_SECRET || '',
    bootstrapEmail: normalizeEmail(process.env.CRM_BOOTSTRAP_EMAIL || '')
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

async function dbRequest(table, { method = 'GET', query = {}, body, prefer, range } = {}) {
  const cfg = env();
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => params.set(key, String(value)));
  const url = `${cfg.url}/rest/v1/${table}${params.size ? `?${params}` : ''}`;
  const headers = { apikey: cfg.secretKey, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  if (range) { headers.Range = range; headers['Range-Unit'] = 'items'; }
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  if (!response.ok) {
    await response.text().catch(() => '');
    throw new HttpError(response.status === 404 ? 404 : response.status >= 500 ? 502 : 400, 'Não foi possível acessar os dados do CRM.');
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
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
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active === true, mustChangePassword: row.must_change_password === true, sessionVersion: Number(row.session_version || 0), createdAt: row.created_at, updatedAt: row.updated_at };
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
    updatedBy: row.updated_by, sdrUpdatedAt: row.sdr_updated_at || '', sdrUpdatedBy: row.sdr_updated_by || ''
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
  if (!profile || profile.active !== true || normalizeEmail(profile.email) !== normalizeEmail(authUser.email)) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  const claimVersion = Number(claims.app_metadata && claims.app_metadata.crm_session_version || 0);
  if (claimVersion !== Number(profile.session_version || 0)) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  const actor = mapUser(profile);
  if (actor.mustChangePassword && !allowPasswordChange) throw new HttpError(403, 'Altere a senha temporária antes de continuar.');
  return actor;
}

async function audit(actor, action, entityType, entityId, changedFields) {
  await dbRequest('crm_audit', { method: 'POST', prefer: 'return=minimal', body: { user_id: actor.id, email: actor.email, action, entity_type: entityType, entity_id: String(entityId), changed_fields: changedFields || '' } });
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
  if (!profile || profile.active !== true || normalizeEmail(profile.email) !== normalizeEmail(authUser.email)) {
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
  return { initialized: Array.isArray(rows) && rows.length > 0, setupAvailable: Boolean(cfg.bootstrapSecret && cfg.bootstrapEmail && Array.isArray(rows) && rows.length === 0), systemName: CRM_CONFIG.systemName };
}

async function apiBootstrapAdmin(secret, name, email, password) {
  const cfg = env();
  const supplied = String(secret || '');
  const expected = String(cfg.bootstrapSecret || '');
  const secretOkay = supplied.length === expected.length && expected.length > 0 && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  const normalizedEmail = normalizeEmail(email);
  name = String(name || '').trim(); password = String(password || '');
  if (!secretOkay || !cfg.bootstrapEmail || normalizedEmail !== cfg.bootstrapEmail) throw new HttpError(403, 'Chave ou e-mail de configuração inválido.');
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
  if (!profile || profile.active !== true || Number(profile.session_version || 0) !== Number(currentSession.session_version || 0)) {
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
  await audit(actor, 'user.password_change', 'user', actor.id, 'password');
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
    developments: (developments || []).map((item) => ({ id: item.id, name: item.name, active: item.active })),
    brokers: (users || []).map(mapUser).filter((item) => item.role === 'Corretor').map((item) => ({ id: item.id, name: item.name, email: item.email, role: item.role, active: item.active })),
    sharedTemporaryPasswordAvailable: isAdmin(actor) && !((await dbRequest('crm_settings', { query: { select: 'key', key: 'eq.shared_temporary_password_applied', limit: 1 } })) || []).length
  };
}

async function loadLeadContext() {
  const [userRows, developmentRows, leadRows] = await Promise.all([
    listAll('crm_users', { select: '*' }), listAll('crm_developments', { select: '*' }), listAll('crm_leads', { select: '*' })
  ]);
  return { users: userRows.map(mapUser), developments: developmentRows, leads: leadRows.map((row) => mapLead(row, userRows.map(mapUser), developmentRows)) };
}

async function apiGetDashboard(token, filters) {
  const actor = await verifyActor(token);
  const context = await loadLeadContext();
  const dashboard = CrmDomain.buildDashboard(context.leads, context.users, filters, { actor, today: now(), staleBusinessDays: CRM_CONFIG.staleBusinessDays });
  if (actor.role === 'Corretor') dashboard.ranking = dashboard.ranking.filter((item) => item.id === actor.id);
  return dashboard;
}

async function apiListLeads(token, filters, page, pageSize) {
  const actor = await verifyActor(token);
  const context = await loadLeadContext();
  const options = { today: now(), staleBusinessDays: CRM_CONFIG.staleBusinessDays };
  const found = CrmDomain.filterLeads(context.leads, actor, filters, options);
  found.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const enriched = found.map((lead) => {
    const info = CrmDomain.staleInfo(lead, options.today, options.staleBusinessDays);
    return Object.assign({}, lead, { staleBusinessDays: info.businessDays, isStale: info.stale });
  });
  return CrmDomain.paginate(enriched, page, pageSize);
}

async function apiGetSdrHistory(token, leadId) {
  const actor = await verifyActor(token);
  if (!isUuid(leadId)) throw new HttpError(404, 'Cliente não encontrado ou sem permissão.');
  const rows = await dbRequest('crm_leads', { query: { select: 'id,broker_id', id: `eq.${String(leadId)}`, limit: 1 } });
  const lead = Array.isArray(rows) ? rows[0] : null;
  if (!lead || !CrmDomain.canReadLead(actor, { id: lead.id, brokerId: lead.broker_id })) throw new HttpError(404, 'Cliente não encontrado ou sem permissão.');
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
    saved = await dbRequest('crm_leads', { method: 'PATCH', query: { id: `eq.${existing.id}` }, prefer: 'return=representation', body: update });
    saved = Array.isArray(saved) ? saved[0] : null;
  }
  if (!saved) throw new HttpError(404, 'Cliente não encontrado ou sem permissão.');
  if (isSdrContact) await dbRequest('crm_sdr_history', { method: 'POST', prefer: 'return=minimal', body: { lead_id: saved.id, user_id: actor.id, user_name: actor.name, status: saved.status, feedback: saved.sdr_feedback || '', source: 'Atualização registrada pelo SDR', at: stamp } });
  await audit(actor, isCreate ? 'lead.create' : isSdrContact ? 'lead.sdr_contact' : 'lead.update', 'lead', saved.id, changedFields.join(','));
  return { ok: true, leadId: saved.id, message: isCreate ? 'Cliente cadastrado.' : isSdrContact ? 'Contato registrado no histórico.' : 'Cliente atualizado.' };
}

async function apiListUsers(token) {
  const actor = await verifyActor(token); requireAdmin(actor);
  return (await listAll('crm_users', { select: '*' })).map((row) => publicUser(row)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
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
  if (rows.some((item) => item.id !== userId && normalizeEmail(item.email) === email)) return { ok: false, message: 'Este e-mail já está cadastrado.' };
  if (existing && existing.id === actor.id && (!active || role !== actor.role)) return { ok: false, message: 'Você não pode desativar ou rebaixar sua própria conta.' };
  const adminsAfter = rows.filter((item) => item.id !== userId && item.active && CrmDomain.isAdmin(mapUser(item))).length + (active && CrmDomain.isAdmin({ role, active }) ? 1 : 0);
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
    await audit(actor, 'user.create', 'user', user.id, 'name,email,role,active');
    return { ok: true, user: publicUser(Array.isArray(inserted) ? inserted[0] : null), message: 'Usuário cadastrado. Use “Gerar senha” para definir a senha temporária de acesso.' };
  }
  const old = mapUser(existing); const changed = old.email !== email || old.role !== role || old.active !== active;
  const sessionVersion = Number(old.sessionVersion || 0) + (changed ? 1 : 0);
  if (old.email !== email || changed || old.name !== name) await updateAuthProfile(existing.id, { email: old.email !== email ? email : undefined, name, sessionVersion });
  const updated = await dbRequest('crm_users', { method: 'PATCH', query: { id: `eq.${existing.id}` }, prefer: 'return=representation', body: { name, email, role, active, session_version: sessionVersion, updated_at: stamp } });
  await audit(actor, 'user.update', 'user', existing.id, 'name,email,role,active');
  return { ok: true, user: publicUser(Array.isArray(updated) ? updated[0] : null), message: 'Usuário atualizado.' };
}

async function apiResetUserPassword(token, userId) {
  const actor = await verifyActor(token); requireAdmin(actor);
  if (String(userId) === String(actor.id)) return { ok: false, message: 'Use a opção “Senha” para alterar sua própria senha.' };
  if (!isUuid(userId)) return { ok: false, message: 'Usuário ativo não encontrado.' };
  const row = await getProfile(String(userId || ''));
  if (!row || row.active !== true) return { ok: false, message: 'Usuário ativo não encontrado.' };
  const user = mapUser(row); const temporaryPassword = newTemporaryPassword(); const sessionVersion = user.sessionVersion + 1;
  await setAuthPassword(user.id, temporaryPassword, sessionVersion);
  await dbRequest('crm_users', { method: 'PATCH', query: { id: `eq.${user.id}` }, prefer: 'return=minimal', body: { must_change_password: true, session_version: sessionVersion, updated_at: now() } });
  await audit(actor, 'user.password_reset', 'user', user.id, 'password');
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
      await audit(actor, 'user.shared_temporary_password', 'user', user.id, 'password');
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
  apiListUsers, apiSaveUser, apiResetUserPassword, apiApplySharedTemporaryPassword
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
