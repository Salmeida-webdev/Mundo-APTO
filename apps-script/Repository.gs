var CrmRepo = (function () {
  'use strict';

  var SHEETS = {
    users: { name: 'CRM_Usuarios', headers: ['id', 'name', 'email', 'role', 'active', 'passwordSalt', 'passwordHash', 'iterations', 'mustChangePassword', 'sessionVersion', 'createdAt', 'updatedAt'] },
    developments: { name: 'CRM_Empreendimentos', headers: ['id', 'name', 'active'] },
    leads: { name: 'CRM_Clientes', headers: ['id', 'name', 'phone', 'developmentId', 'developmentName', 'notes', 'sdrFeedback', 'status', 'brokerId', 'brokerName', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'sdrUpdatedAt', 'sdrUpdatedBy'] },
    sdrHistory: { name: 'CRM_HistoricoSDR', headers: ['id', 'leadId', 'at', 'userId', 'userName', 'status', 'feedback', 'source'] },
    audit: { name: 'CRM_Auditoria', headers: ['id', 'at', 'userId', 'email', 'action', 'entityType', 'entityId', 'changedFields'] },
    settings: { name: 'CRM_Config', headers: ['key', 'value'] }
  };

  function scriptProperties_() { return PropertiesService.getScriptProperties(); }

  function spreadsheet_() {
    var id = scriptProperties_().getProperty('CRM_SPREADSHEET_ID');
    if (!id) throw new Error('Base ainda não foi inicializada.');
    return SpreadsheetApp.openById(id);
  }

  function sheet_(key) {
    var definition = SHEETS[key];
    if (!definition) throw new Error('Aba não reconhecida.');
    var sheet = spreadsheet_().getSheetByName(definition.name);
    if (!sheet) throw new Error('Aba interna ausente: ' + definition.name);
    return sheet;
  }

  function safeCell_(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    var text = String(value);
    return /^[=+\-@]/.test(text) ? "'" + text : text;
  }

  function objectRows_(key) {
    var def = SHEETS[key];
    var sheet = sheet_(key);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var values = sheet.getRange(2, 1, lastRow - 1, def.headers.length).getValues();
    return values.filter(function (row) { return row.some(function (cell) { return cell !== '' && cell !== null; }); }).map(function (row) {
      var record = {};
      def.headers.forEach(function (header, index) {
        var value = row[index];
        if (value instanceof Date) value = value.toISOString();
        record[header] = value;
      });
      ['active', 'mustChangePassword'].forEach(function (keyName) {
        if (Object.prototype.hasOwnProperty.call(record, keyName)) record[keyName] = record[keyName] === true || String(record[keyName]).toLowerCase() === 'true';
      });
      record.sessionVersion = Number(record.sessionVersion || 0);
      record.iterations = Number(record.iterations || 0);
      return record;
    });
  }

  function rowForId_(key, id) {
    var sheet = sheet_(key);
    if (sheet.getLastRow() < 2) return 0;
    var idColumn = SHEETS[key].headers.indexOf('id') + 1;
    var values = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getDisplayValues();
    for (var i = 0; i < values.length; i += 1) if (String(values[i][0]) === String(id)) return i + 2;
    return 0;
  }

  function writeObject_(key, record, insertOnly) {
    var def = SHEETS[key];
    var sheet = sheet_(key);
    var values = def.headers.map(function (header) { return safeCell_(record[header]); });
    var row = record.id ? rowForId_(key, record.id) : 0;
    if (!row && insertOnly) throw new Error('Registro não encontrado.');
    if (!row) row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, values.length).setNumberFormat('@').setValues([values]);
    return record;
  }

  function append_(key, record) {
    var def = SHEETS[key];
    var sheet = sheet_(key);
    var values = def.headers.map(function (header) { return safeCell_(record[header]); });
    var row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, values.length).setNumberFormat('@').setValues([values]);
    return record;
  }

  function ensureSheet_(ss, key) {
    var def = SHEETS[key];
    var sheet = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    sheet.setFrozenRows(1);
    var headerColor = CRM_CONFIG.identity && CRM_CONFIG.identity.primary ? CRM_CONFIG.identity.primary : '#C2410C';
    sheet.getRange(1, 1, 1, def.headers.length).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(headerColor);
    sheet.autoResizeColumns(1, def.headers.length);
    return sheet;
  }

  function protect_(sheet) {
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    protections.forEach(function (protection) { protection.remove(); });
    var protection = sheet.protect().setDescription('Estrutura interna do CRM Comercial — acesso somente à conta proprietária.');
    protection.setWarningOnly(false);
  }

  function setup(passwordData) {
    var ss;
    var props = scriptProperties_();
    if (props.getProperty('CRM_BOOTSTRAPPED') === 'true') throw new Error('Esta base já foi inicializada.');
    ss = SpreadsheetApp.create(CRM_CONFIG.systemName + ' — Base privada');
    props.setProperty('CRM_SPREADSHEET_ID', ss.getId());
    ss.setSpreadsheetTimeZone(CRM_CONFIG.timezone);
    var sheets = {};
    Object.keys(SHEETS).forEach(function (key) { sheets[key] = ensureSheet_(ss, key); });
    ss.getSheets().forEach(function (sheet) {
      var isManaged = Object.keys(SHEETS).some(function (key) { return SHEETS[key].name === sheet.getName(); });
      if (!isManaged && ss.getSheets().length > 1) ss.deleteSheet(sheet);
    });

    if (objectRows_('users').length === 0) {
      var now = passwordData.now;
      var ownerEmail = CrmDomain.normalizeEmail(CRM_CONFIG.ownerEmail);
      var executingEmail = CrmDomain.normalizeEmail(passwordData.adminEmail);
      var initialUsers = [{ id:'U000', name:'Administrador da conta proprietária', email:ownerEmail, role:'Administrador', active:true }];
      initialUsers = initialUsers.concat(CRM_CONFIG.users);
      if (executingEmail && executingEmail !== ownerEmail && !initialUsers.some(function (user) { return CrmDomain.normalizeEmail(user.email) === executingEmail; })) {
        initialUsers.push({ id: nextUserId_(initialUsers), name:'Administrador de implantação', email:executingEmail, role:'Administrador', active:true });
      }
      initialUsers.forEach(function (user) {
        var isFirstAdmin = CrmDomain.normalizeEmail(user.email) === executingEmail;
        append_('users', {
          id: user.id, name: user.name, email: user.email, role: user.role, active: user.active,
          passwordSalt: isFirstAdmin ? passwordData.salt : '',
          passwordHash: isFirstAdmin ? passwordData.hash : '',
          iterations: isFirstAdmin ? passwordData.iterations : '',
          mustChangePassword: isFirstAdmin || !user.passwordHash, sessionVersion: 0, createdAt: now, updatedAt: now
        });
      });
    }
    if (objectRows_('developments').length === 0) {
      CRM_CONFIG.developments.forEach(function (development) {
        append_('developments', { id: development.id, name: development.name, active: development.active });
      });
    }
    var settings = [
      { key: 'systemName', value: CRM_CONFIG.systemName },
      { key: 'ownerEmail', value: CRM_CONFIG.ownerEmail },
      { key: 'timezone', value: CRM_CONFIG.timezone },
      { key: 'staleBusinessDays', value: CRM_CONFIG.staleBusinessDays },
      { key: 'initializedAt', value: now }
    ];
    if (objectRows_('settings').length === 0) settings.forEach(function (row) { append_('settings', row); });
    var leadsSheet = sheets.leads;
    var statusColumn = SHEETS.leads.headers.indexOf('status') + 1;
    var validation = SpreadsheetApp.newDataValidation().requireValueInList(CrmDomain.STATUS_NAMES, true).setAllowInvalid(false).build();
    leadsSheet.getRange(2, statusColumn, Math.max(1, leadsSheet.getMaxRows() - 1), 1).setDataValidation(validation);
    var rules = CRM_CONFIG.statuses.map(function (status) {
      return SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$H2="' + String(status.name).replace(/"/g, '""') + '"')
        .setBackground(status.color).setRanges([leadsSheet.getRange('A2:P')]).build();
    });
    leadsSheet.setConditionalFormatRules(rules);
    Object.keys(sheets).forEach(function (key) { protect_(sheets[key]); });
    props.setProperty('CRM_BOOTSTRAPPED', 'true');
    props.setProperty('CRM_SDR_HISTORY_MIGRATED', 'true');
    return { spreadsheetId: ss.getId(), sheets: Object.keys(sheets).map(function (key) { return SHEETS[key].name; }) };
  }

  function ensureSdrHistorySheet_() {
    var ss = spreadsheet_();
    var definition = SHEETS.sdrHistory;
    var sheet = ss.getSheetByName(definition.name);
    if (!sheet) {
      sheet = ensureSheet_(ss, 'sdrHistory');
      protect_(sheet);
    } else if (sheet.getLastRow() === 0) {
      sheet = ensureSheet_(ss, 'sdrHistory');
      protect_(sheet);
    }
    return sheet;
  }

  function initializeSdrHistory() {
    var sheet = ensureSdrHistorySheet_();
    var props = scriptProperties_();
    if (props.getProperty('CRM_SDR_HISTORY_MIGRATED') === 'true') return;
    var knownLeadIds = {};
    var headers = SHEETS.sdrHistory.headers;
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var historyRows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      historyRows.forEach(function (row) { if (row[1]) knownLeadIds[String(row[1])] = true; });
    }
    var usersById = {};
    getUsers().forEach(function (user) { usersById[String(user.id)] = user; });
    getLeads().forEach(function (lead) {
      var leadId = String(lead.id || '');
      if (!leadId || knownLeadIds[leadId] || (!lead.sdrUpdatedAt && !lead.sdrFeedback)) return;
      var author = usersById[String(lead.sdrUpdatedBy || '')];
      append_('sdrHistory', {
        id: Utilities.getUuid(),
        leadId: leadId,
        at: lead.sdrUpdatedAt || lead.updatedAt || lead.createdAt || '',
        userId: lead.sdrUpdatedBy || '',
        userName: author ? author.name : 'Responsável não identificado',
        status: lead.status || '',
        feedback: lead.sdrFeedback || '',
        source: 'Estado atual migrado; histórico anterior não disponível'
      });
      knownLeadIds[leadId] = true;
    });
    props.setProperty('CRM_SDR_HISTORY_MIGRATED', 'true');
  }

  function getSdrHistory(leadId) {
    initializeSdrHistory();
    var sheet = ensureSdrHistorySheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var rows = sheet.getRange(2, 1, lastRow - 1, SHEETS.sdrHistory.headers.length).getValues();
    return rows.filter(function (row) { return String(row[1]) === String(leadId); }).map(function (row) {
      var result = {};
      SHEETS.sdrHistory.headers.forEach(function (header, index) {
        var value = row[index];
        result[header] = value instanceof Date ? value.toISOString() : value;
      });
      return result;
    }).sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }

  function getUsers() { return objectRows_('users'); }
  function getDevelopments() { return objectRows_('developments'); }
  function getLeads() { return objectRows_('leads'); }
  function getUserByEmail(email) {
    var normalized = CrmDomain.normalizeEmail(email);
    return getUsers().filter(function (user) { return CrmDomain.normalizeEmail(user.email) === normalized; })[0] || null;
  }
  function getUserById(id) { return getUsers().filter(function (user) { return String(user.id) === String(id); })[0] || null; }
  function getLeadById(id) { return getLeads().filter(function (lead) { return String(lead.id) === String(id); })[0] || null; }
  function saveLead(record, isCreate) { return writeObject_('leads', record, !isCreate); }
  function saveUser(record, isCreate) { return writeObject_('users', record, !isCreate); }
  function addAudit(record) { return append_('audit', record); }
  function addSdrHistory(record) { ensureSdrHistorySheet_(); return append_('sdrHistory', record); }

  return {
    setup: setup,
    getUsers: getUsers,
    getUserByEmail: getUserByEmail,
    getUserById: getUserById,
    getDevelopments: getDevelopments,
    getLeads: getLeads,
    getLeadById: getLeadById,
    saveLead: saveLead,
    saveUser: saveUser,
    addAudit: addAudit,
    initializeSdrHistory: initializeSdrHistory,
    getSdrHistory: getSdrHistory,
    addSdrHistory: addSdrHistory
  };
}());
