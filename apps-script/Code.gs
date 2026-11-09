var CRM_SESSION_TTL_SECONDS = 21600;
var CRM_LOGIN_LIMIT = 5;
var CRM_LOCK_SECONDS = 900;

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  template.systemName = CRM_CONFIG.systemName;
  return template.evaluate().setTitle(CRM_CONFIG.systemName).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupProject() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('CRM_BOOTSTRAPPED') === 'true') throw new Error('A base já está inicializada.');
  // A URL /dev de teste não é uma implantação pública; bloqueie somente a URL /exec.
  var deployedUrl = ScriptApp.getService().getUrl();
  if (deployedUrl && /\/exec(?:[?#]|$)/.test(deployedUrl)) {
    throw new Error('Inicialize a base antes de publicar o aplicativo.');
  }
  var adminEmail = CrmDomain.normalizeEmail(Session.getEffectiveUser().getEmail());
  if (!adminEmail) throw new Error('O Google não identificou a conta executora. Execute a inicialização a partir da conta proprietária do projeto.');
  var adminName = adminEmail === CrmDomain.normalizeEmail(CRM_CONFIG.ownerEmail) ? 'Administrador da conta proprietária' : 'Administrador de implantação';
  var password = newTemporaryPassword_();
  var salt = newSalt_();
  var iterations = CrmCrypto.DEFAULT_ITERATIONS;
  var hash = hashPassword_(password, salt, iterations);
  var now = timestamp_();
  var result = CrmRepo.setup({ salt: salt, hash: hash, iterations: iterations, now: now, adminEmail: adminEmail, adminName: adminName });
  var credentials = { initialAdminEmail: adminEmail, temporaryPassword: password, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + result.spreadsheetId + '/edit' };
  console.log('CREDENCIAIS INICIAIS — copie e guarde em local seguro; a senha não poderá ser recuperada depois: ' + JSON.stringify(credentials));
  return credentials;
}

function apiBootstrapInfo() {
  var initialized = PropertiesService.getScriptProperties().getProperty('CRM_BOOTSTRAPPED') === 'true';
  return { initialized: initialized, systemName: CRM_CONFIG.systemName };
}

function apiLogin(email, password) {
  try {
    if (PropertiesService.getScriptProperties().getProperty('CRM_BOOTSTRAPPED') !== 'true') return { ok: false, message: 'O sistema ainda não foi inicializado.' };
    email = CrmDomain.normalizeEmail(email);
    password = String(password || '');
    if (!email || password.length > 128) return { ok: false, message: 'E-mail ou senha inválidos.' };
    var cache = CacheService.getScriptCache();
    var limitKey = loginLimitKey_(email);
    if (Number(cache.get(limitKey) || 0) >= CRM_LOGIN_LIMIT) return { ok: false, message: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' };
    var user = CrmRepo.getUserByEmail(email);
    var salt = user && user.passwordSalt ? String(user.passwordSalt) : 'a4a7d91b211058d2bcce91c8e642a0a3';
    var iterations = user && user.iterations ? Number(user.iterations) : CrmCrypto.DEFAULT_ITERATIONS;
    var candidate = hashPassword_(password, salt, iterations);
    var expected = user && user.passwordHash ? String(user.passwordHash) : '0'.repeat(64);
    var valid = CrmCrypto.constantTimeEqual(candidate, expected);
    if (!valid || !user || user.active !== true) {
      cache.put(limitKey, String(Number(cache.get(limitKey) || 0) + 1), CRM_LOCK_SECONDS);
      return { ok: false, message: 'E-mail ou senha inválidos.' };
    }
    cache.remove(limitKey);
    var token = newSessionToken_();
    var session = { userId: user.id, sessionVersion: Number(user.sessionVersion || 0), createdAt: timestamp_() };
    cache.put(sessionKey_(token), JSON.stringify(session), CRM_SESSION_TTL_SECONDS);
    return { ok: true, token: token, user: publicUser_(user) };
  } catch (error) {
    console.error('Falha de login: ' + String(error && error.message || error));
    return { ok: false, message: 'Não foi possível entrar agora. Tente novamente.' };
  }
}

function apiLogout(token) {
  if (token) CacheService.getScriptCache().remove(sessionKey_(String(token)));
  return { ok: true };
}

function apiChangePassword(token, currentPassword, newPassword) {
  var actor = actorForToken_(token, true);
  currentPassword = String(currentPassword || '');
  newPassword = String(newPassword || '');
  if (newPassword.length < 12 || newPassword.length > 128) return { ok: false, message: 'A nova senha deve ter de 12 a 128 caracteres.' };
  var currentHash = hashPassword_(currentPassword, actor.passwordSalt, Number(actor.iterations));
  if (!CrmCrypto.constantTimeEqual(currentHash, String(actor.passwordHash || ''))) return { ok: false, message: 'Senha atual incorreta.' };
  var salt = newSalt_();
  var iterations = CrmCrypto.DEFAULT_ITERATIONS;
  actor.passwordSalt = salt;
  actor.passwordHash = hashPassword_(newPassword, salt, iterations);
  actor.iterations = iterations;
  actor.mustChangePassword = false;
  actor.sessionVersion = Number(actor.sessionVersion || 0) + 1;
  actor.updatedAt = timestamp_();
  CrmRepo.saveUser(actor, false);
  CacheService.getScriptCache().remove(sessionKey_(String(token)));
  return { ok: true, message: 'Senha alterada. Entre novamente com a nova senha.' };
}

function apiGetReferenceData(token) {
  var actor = actorForToken_(token, true);
  var users = CrmRepo.getUsers();
  return {
    systemName: CRM_CONFIG.systemName,
    user: publicUser_(actor),
    statuses: CRM_CONFIG.statuses,
    developments: CrmRepo.getDevelopments().filter(function (item) { return item.active === true; }),
    brokers: (CrmDomain.isAdmin(actor) || actor.role === 'SDR') ? users.filter(function (item) { return item.role === 'Corretor'; }).map(publicUser_) : [],
    sharedTemporaryPasswordAvailable: CrmDomain.isAdmin(actor) && PropertiesService.getScriptProperties().getProperty('CRM_SHARED_TEAM_PASSWORD_APPLIED') !== 'true'
  };
}

function apiGetDashboard(token, filters) {
  var actor = actorForToken_(token);
  var users = CrmRepo.getUsers();
  var config = { actor: actor, today: timestamp_(), staleBusinessDays: getStaleDays_() };
  var dashboard = CrmDomain.buildDashboard(CrmRepo.getLeads(), users, filters, config);
  if (actor.role === 'Corretor') dashboard.ranking = dashboard.ranking.filter(function (row) { return row.id === actor.id; });
  return dashboard;
}

function apiListLeads(token, filters, page, pageSize) {
  var actor = actorForToken_(token);
  var options = { today: timestamp_(), staleBusinessDays: getStaleDays_() };
  var found = CrmDomain.filterLeads(CrmRepo.getLeads(), actor, filters, options);
  found.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
  var users = CrmRepo.getUsers();
  var developments = CrmRepo.getDevelopments();
  found = found.map(function (lead) {
    var broker = users.filter(function (user) { return String(user.id) === String(lead.brokerId); })[0];
    var development = developments.filter(function (item) { return String(item.id) === String(lead.developmentId); })[0];
    var info = CrmDomain.staleInfo(lead, options.today, options.staleBusinessDays);
    return Object.assign({}, lead, {
      brokerName: broker ? broker.name : String(lead.brokerName || 'Corretor inativo'),
      developmentName: development ? development.name : String(lead.developmentName || ''),
      staleBusinessDays: info.businessDays,
      isStale: info.stale
    });
  });
  return CrmDomain.paginate(found, page, pageSize);
}

function apiGetSdrHistory(token, leadId) {
  var actor = actorForToken_(token);
  var lead = CrmRepo.getLeadById(String(leadId || ''));
  if (!lead || !CrmDomain.canReadLead(actor, lead)) throw new Error('Cliente não encontrado ou sem permissão.');
  return CrmRepo.getSdrHistory(lead.id).map(function (entry) {
    return {
      id: String(entry.id || ''),
      at: String(entry.at || ''),
      userName: String(entry.userName || 'Responsável não identificado'),
      status: String(entry.status || ''),
      feedback: String(entry.feedback || ''),
      source: String(entry.source || '')
    };
  });
}

function apiSaveLead(token, leadId, payload) {
  var actor = actorForToken_(token);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: 'Outro atendimento está sendo salvo. Tente novamente.' };
  try {
    var isCreate = !leadId;
    var existing = isCreate ? null : CrmRepo.getLeadById(leadId);
    var check = CrmDomain.validateLeadInput(actor, payload, existing, { isCreate: isCreate });
    if (!check.ok) return { ok: false, message: check.error };
    var values = check.value;
    var developments = CrmRepo.getDevelopments();
    if (values.developmentId) {
      var selectedDevelopment = developments.filter(function (item) { return item.id === values.developmentId && item.active === true; })[0];
      if (!selectedDevelopment) return { ok: false, message: 'Empreendimento inválido ou inativo.' };
    }
    var users = CrmRepo.getUsers();
    var targetBrokerId = values.brokerId || (existing && existing.brokerId) || actor.id;
    var targetBroker = users.filter(function (user) { return user.id === targetBrokerId && user.role === 'Corretor'; })[0];
    var keepsInactiveAssignment = existing && String(existing.brokerId) === String(targetBrokerId);
    if (!targetBroker || (targetBroker.active !== true && !keepsInactiveAssignment)) return { ok: false, message: 'Corretor inválido ou inativo.' };
    if (actor.role === 'Corretor' && targetBrokerId !== actor.id) return { ok: false, message: 'Você só pode cadastrar clientes em sua própria carteira.' };
    var now = timestamp_();
    var changedFields = Object.keys(values).filter(function (key) {
      return !existing || String(existing[key] === undefined || existing[key] === null ? '' : existing[key]) !== String(values[key] === undefined || values[key] === null ? '' : values[key]);
    });
    var isSdrContact = !isCreate && actor.role === 'SDR';
    if (!isCreate && !changedFields.length && !isSdrContact) return { ok: true, leadId: existing.id, message: 'Nenhuma alteração detectada.' };
    if (isSdrContact) CrmRepo.initializeSdrHistory();
    var record = existing ? Object.assign({}, existing) : {
      id: Utilities.getUuid(), createdAt: now, createdBy: actor.id,
      notes: '', sdrFeedback: '', status: 'Em contato', sdrUpdatedAt: '', sdrUpdatedBy: ''
    };
    Object.keys(values).forEach(function (key) { record[key] = values[key]; });
    record.developmentName = (developments.filter(function (item) { return item.id === record.developmentId; })[0] || {}).name || '';
    record.brokerId = targetBroker.id;
    record.brokerName = targetBroker.name;
    record.updatedAt = now;
    record.updatedBy = actor.id;
    if (isSdrContact) {
      record.sdrUpdatedAt = now;
      record.sdrUpdatedBy = actor.id;
    }
    CrmRepo.saveLead(record, isCreate);
    if (isSdrContact) {
      CrmRepo.addSdrHistory({
        id: Utilities.getUuid(),
        leadId: record.id,
        at: now,
        userId: actor.id,
        userName: actor.name,
        status: record.status,
        feedback: record.sdrFeedback || '',
        source: 'Atualização registrada pelo SDR'
      });
    }
    CrmRepo.addAudit({
      id: Utilities.getUuid(), at: now, userId: actor.id, email: actor.email,
      action: isCreate ? 'lead.create' : (isSdrContact ? 'lead.sdr_contact' : 'lead.update'), entityType: 'lead', entityId: record.id,
      changedFields: changedFields.join(',')
    });
    return { ok: true, leadId: record.id, message: isCreate ? 'Cliente cadastrado.' : (isSdrContact ? 'Contato registrado no histórico.' : 'Cliente atualizado.') };
  } finally {
    lock.releaseLock();
  }
}

function apiListUsers(token) {
  var actor = actorForToken_(token);
  requireAdmin_(actor);
  return CrmRepo.getUsers().map(function (user) { return publicUser_(user); }).sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); });
}

function apiSaveUser(token, payload) {
  var actor = actorForToken_(token);
  requireAdmin_(actor);
  payload = payload && typeof payload === 'object' ? payload : {};
  var allowedKeys = ['id', 'name', 'email', 'role', 'active'];
  if (Object.keys(payload).some(function (key) { return allowedKeys.indexOf(key) < 0; })) return { ok: false, message: 'A solicitação contém campos não permitidos.' };
  if (Object.prototype.hasOwnProperty.call(payload, 'active') && typeof payload.active !== 'boolean') return { ok: false, message: 'Estado do usuário inválido.' };
  var name = String(payload.name || '').trim();
  var email = CrmDomain.normalizeEmail(payload.email);
  var role = String(payload.role || '').trim();
  var active = payload.active !== false;
  var userId = String(payload.id || '').trim();
  if (!name || name.length > 150) return { ok: false, message: 'Informe o nome (até 150 caracteres).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Informe um e-mail válido.' };
  if (CRM_CONFIG.roles.indexOf(role) < 0) return { ok: false, message: 'Perfil inválido.' };
  var users = CrmRepo.getUsers();
  var existing = userId ? users.filter(function (user) { return user.id === userId; })[0] : null;
  if (userId && !existing) return { ok: false, message: 'Usuário não encontrado.' };
  if (users.some(function (user) { return user.id !== userId && CrmDomain.normalizeEmail(user.email) === email; })) return { ok: false, message: 'Este e-mail já está cadastrado.' };
  var record = existing ? Object.assign({}, existing) : {
    id: nextUserId_(users), passwordSalt: '', passwordHash: '', iterations: '', mustChangePassword: true,
    sessionVersion: 0, createdAt: timestamp_()
  };
  record.name = name;
  record.email = email;
  record.role = role;
  record.active = active;
  record.updatedAt = timestamp_();
  if (existing && existing.id === actor.id && !active) return { ok: false, message: 'Você não pode desativar sua própria conta.' };
  var adminsAfter = users.filter(function (user) { return user.id !== record.id && user.active && CrmDomain.isAdmin(user); }).length + (record.active && CrmDomain.isAdmin(record) ? 1 : 0);
  if (adminsAfter < 1) return { ok: false, message: 'É necessário manter ao menos um administrador ativo.' };
  if (existing && (existing.email !== record.email || existing.role !== record.role || existing.active !== record.active)) record.sessionVersion = Number(record.sessionVersion || 0) + 1;
  CrmRepo.saveUser(record, !existing);
  CrmRepo.addAudit({ id: Utilities.getUuid(), at: timestamp_(), userId: actor.id, email: actor.email, action: existing ? 'user.update' : 'user.create', entityType: 'user', entityId: record.id, changedFields: 'name,email,role,active' });
  return { ok: true, user: publicUser_(record), message: existing ? 'Usuário atualizado.' : 'Usuário cadastrado. Gere uma senha temporária para liberar o primeiro acesso.' };
}

function apiResetUserPassword(token, userId) {
  var actor = actorForToken_(token);
  requireAdmin_(actor);
  var user = CrmRepo.getUserById(String(userId || ''));
  if (!user || user.active !== true) return { ok: false, message: 'Usuário ativo não encontrado.' };
  var temporary = newTemporaryPassword_();
  var salt = newSalt_();
  var iterations = CrmCrypto.DEFAULT_ITERATIONS;
  user.passwordSalt = salt;
  user.passwordHash = hashPassword_(temporary, salt, iterations);
  user.iterations = iterations;
  user.mustChangePassword = true;
  user.sessionVersion = Number(user.sessionVersion || 0) + 1;
  user.updatedAt = timestamp_();
  CrmRepo.saveUser(user, false);
  CrmRepo.addAudit({ id: Utilities.getUuid(), at: timestamp_(), userId: actor.id, email: actor.email, action: 'user.password_reset', entityType: 'user', entityId: user.id, changedFields: 'password' });
  return { ok: true, temporaryPassword: temporary, message: 'Compartilhe a senha temporária com o usuário por um canal privado. Ela deverá ser alterada no primeiro acesso.' };
}

function apiApplySharedTemporaryPassword(token, password) {
  var actor = actorForToken_(token);
  requireAdmin_(actor);
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('CRM_SHARED_TEAM_PASSWORD_APPLIED') === 'true') return { ok: false, message: 'A senha inicial da equipe já foi aplicada neste projeto.' };
  password = String(password || '');
  if (password.length < 12 || password.length > 128) return { ok: false, message: 'A senha inicial deve ter de 12 a 128 caracteres.' };
  var actorHash = hashPassword_(password, actor.passwordSalt, Number(actor.iterations));
  if (CrmCrypto.constantTimeEqual(actorHash, String(actor.passwordHash || ''))) return { ok: false, message: 'Escolha uma senha inicial diferente da senha atual do administrador.' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, message: 'Outro processo está atualizando as contas. Tente novamente.' };
  try {
    if (props.getProperty('CRM_SHARED_TEAM_PASSWORD_APPLIED') === 'true') return { ok: false, message: 'A senha inicial da equipe já foi aplicada neste projeto.' };
    var targets = CrmRepo.getUsers().filter(function (user) { return user.active === true && String(user.id) !== String(actor.id); });
    if (!targets.length) return { ok: false, message: 'Não há outras contas ativas para atualizar.' };
    var iterations = CrmCrypto.DEFAULT_ITERATIONS;
    var updated = 0;
    try {
      targets.forEach(function (user) {
        var salt = newSalt_();
        user.passwordSalt = salt;
        user.passwordHash = hashPassword_(password, salt, iterations);
        user.iterations = iterations;
        user.mustChangePassword = true;
        user.sessionVersion = Number(user.sessionVersion || 0) + 1;
        user.updatedAt = timestamp_();
        CrmRepo.saveUser(user, false);
        CrmRepo.addAudit({ id: Utilities.getUuid(), at: timestamp_(), userId: actor.id, email: actor.email, action: 'user.shared_temporary_password', entityType: 'user', entityId: user.id, changedFields: 'password' });
        updated += 1;
      });
    } catch (error) {
      console.error('Aplicação da senha inicial da equipe interrompida após ' + updated + ' contas.');
      return { ok: false, message: 'A atualização foi interrompida após ' + updated + ' contas. A senha não foi registrada no projeto; revise as contas e tente novamente antes de liberar os acessos.' };
    }
    props.setProperty('CRM_SHARED_TEAM_PASSWORD_APPLIED', 'true');
    return { ok: true, updatedCount: updated, message: 'Senha temporária aplicada. Cada pessoa deverá criar uma senha própria no primeiro acesso; sua conta atual foi preservada.' };
  } finally {
    lock.releaseLock();
  }
}

function actorForToken_(token, allowPasswordChange) {
  if (PropertiesService.getScriptProperties().getProperty('CRM_BOOTSTRAPPED') !== 'true') throw new Error('Sistema não inicializado.');
  token = String(token || '');
  if (!token || token.length < 40) throw new Error('Sessão inválida. Entre novamente.');
  var sessionKey = sessionKey_(token);
  var cache = CacheService.getScriptCache();
  var sessionValue = cache.get(sessionKey);
  if (!sessionValue) throw new Error('Sessão expirada. Entre novamente.');
  var session = JSON.parse(sessionValue);
  var user = CrmRepo.getUserById(session.userId);
  if (!user || user.active !== true || Number(user.sessionVersion || 0) !== Number(session.sessionVersion || 0)) {
    cache.remove(sessionKey);
    throw new Error('Sessão inválida. Entre novamente.');
  }
  if (user.mustChangePassword && !allowPasswordChange) throw new Error('Altere a senha temporária antes de continuar.');
  return user;
}

function requireAdmin_(actor) {
  if (!CrmDomain.isAdmin(actor)) throw new Error('Acesso restrito à gestão.');
}

function publicUser_(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active === true, mustChangePassword: user.mustChangePassword === true };
}

function hashPassword_(password, salt, iterations) {
  return CrmCrypto.pbkdf2(password, salt, iterations, function (valueBytes, keyBytes) {
    return Utilities.computeHmacSha256Signature(valueBytes, keyBytes);
  });
}

function newSalt_() { return randomHex_(1); }
function newSessionToken_() { return randomHex_(2); }
function newTemporaryPassword_() { return randomHex_(1) + 'aA9!'; }

function randomHex_(uuidCount) {
  var parts = [];
  for (var i = 0; i < uuidCount; i += 1) parts.push(Utilities.getUuid().replace(/-/g, ''));
  return parts.join('').toLowerCase();
}

function sessionKey_(token) { return 'crm-session:' + CrmCrypto.sha256Hex(token, function (valueBytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valueBytes); }); }
function loginLimitKey_(email) { return 'crm-login-limit:' + CrmCrypto.sha256Hex(email, function (valueBytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, valueBytes); }); }
function timestamp_() {
  var date = new Date();
  var local = Utilities.formatDate(date, CRM_CONFIG.timezone, "yyyy-MM-dd'T'HH:mm:ss");
  var offset = Utilities.formatDate(date, CRM_CONFIG.timezone, 'Z');
  offset = offset.slice(0, 3) + ':' + offset.slice(3);
  return local + offset;
}

function getStaleDays_() {
  return Number(CRM_CONFIG.staleBusinessDays || 3);
}

function nextUserId_(users) {
  var max = (users || []).reduce(function (current, user) {
    var number = Number(String(user.id || '').replace(/^U/i, '')) || 0;
    return Math.max(current, number);
  }, 0);
  return 'U' + String(max + 1).padStart(3, '0');
}
