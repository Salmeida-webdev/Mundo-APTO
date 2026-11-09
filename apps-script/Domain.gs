var CrmDomain = (function () {
  'use strict';

  var STATUS_NAMES = [
    'Em atendimento',
    'Atendimento agendado',
    'Desistência',
    'Atendimento realizado',
    'Já comprou',
    'Em contato',
    'Enviando documentação',
    'Em análise documental',
    'Aprovado pela Caixa',
    'Reprovado pela Caixa'
  ];
  var ADMIN_ROLES = ['Administrador', 'Gerente', 'Coordenador', 'Assistente'];
  var LEAD_FIELDS = ['name', 'phone', 'developmentId', 'notes', 'sdrFeedback', 'status', 'brokerId'];
  var BROKER_FIELDS = ['name', 'phone', 'developmentId', 'notes'];
  var SDR_FIELDS = ['sdrFeedback', 'status'];
  var ADMIN_FIELDS = LEAD_FIELDS.slice();

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isAdmin(user) {
    return Boolean(user && ADMIN_ROLES.indexOf(user.role) >= 0);
  }

  function canReadLead(user, lead) {
    if (!user || !lead || user.active === false) return false;
    if (isAdmin(user) || user.role === 'SDR') return true;
    return user.role === 'Corretor' && String(user.id) === String(lead.brokerId);
  }

  function editableFields(user, lead, isCreate) {
    if (!user || user.active === false) return [];
    if (isAdmin(user)) return ADMIN_FIELDS.slice();
    if (user.role === 'SDR' && !isCreate && lead) return SDR_FIELDS.slice();
    if (user.role === 'Corretor' && (isCreate || canReadLead(user, lead))) return BROKER_FIELDS.slice();
    return [];
  }

  function validateLeadInput(user, payload, existingLead, options) {
    var isCreate = Boolean(options && options.isCreate);
    if (!user || user.active === false) return { ok: false, error: 'Sessão sem permissão ativa.' };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Dados do cliente inválidos.' };
    if (!isCreate && !canReadLead(user, existingLead)) return { ok: false, error: 'Cliente não encontrado ou sem permissão.' };

    var allowed = editableFields(user, existingLead, isCreate);
    if (!allowed.length) return { ok: false, error: 'Este perfil não pode alterar o cliente.' };
    var supplied = Object.keys(payload);
    var forbidden = supplied.filter(function (key) { return allowed.indexOf(key) < 0; });
    if (forbidden.length) return { ok: false, error: 'A solicitação contém campos não permitidos.' };

    var result = {};
    supplied.forEach(function (key) { result[key] = payload[key]; });
    if (allowed.indexOf('name') >= 0 && supplied.indexOf('name') >= 0) {
      var name = String(payload.name || '').trim();
      if (!name || name.length > 150) return { ok: false, error: 'Informe o nome do cliente (até 150 caracteres).' };
      result.name = name;
    }
    if (allowed.indexOf('phone') >= 0 && supplied.indexOf('phone') >= 0) {
      var phone = String(payload.phone || '').trim();
      var digits = phone.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 13) return { ok: false, error: 'Informe um telefone válido com DDD.' };
      if (phone.length > 30) return { ok: false, error: 'Telefone muito longo.' };
      result.phone = phone;
    }
    if (allowed.indexOf('developmentId') >= 0 && supplied.indexOf('developmentId') >= 0) {
      result.developmentId = String(payload.developmentId || '').trim();
      if (!result.developmentId) return { ok: false, error: 'Selecione o empreendimento.' };
    }
    ['notes', 'sdrFeedback'].forEach(function (key) {
      if (allowed.indexOf(key) >= 0 && supplied.indexOf(key) >= 0) {
        var value = String(payload[key] || '').trim();
        if (value.length > 3000) return;
        result[key] = value;
      }
    });
    if (['notes', 'sdrFeedback'].some(function (key) { return supplied.indexOf(key) >= 0 && String(payload[key] || '').length > 3000; })) {
      return { ok: false, error: 'Observações e feedback devem ter até 3.000 caracteres.' };
    }
    if (allowed.indexOf('status') >= 0 && supplied.indexOf('status') >= 0) {
      result.status = String(payload.status || '').trim();
      if (STATUS_NAMES.indexOf(result.status) < 0) return { ok: false, error: 'Status de atendimento inválido.' };
    }
    if (allowed.indexOf('brokerId') >= 0 && supplied.indexOf('brokerId') >= 0) {
      result.brokerId = String(payload.brokerId || '').trim();
      if (!result.brokerId) return { ok: false, error: 'Selecione o corretor responsável.' };
    }
    if (isCreate) {
      if (user.role === 'Corretor') result.brokerId = user.id;
      if (user.role === 'Corretor') result.status = 'Em contato';
      if (user.role === 'Corretor') result.sdrFeedback = '';
      if (!result.name || !result.phone || !result.developmentId) return { ok: false, error: 'Nome, telefone e empreendimento são obrigatórios.' };
    }
    if (!isCreate && !supplied.length) return { ok: false, error: 'Nenhum campo foi enviado para atualização.' };
    return { ok: true, value: result };
  }

  function normalizeFilters(filters) {
    filters = filters && typeof filters === 'object' ? filters : {};
    return {
      query: String(filters.query || '').trim().toLocaleLowerCase('pt-BR').slice(0, 120),
      brokerId: String(filters.brokerId || '').trim(),
      developmentId: String(filters.developmentId || '').trim(),
      status: String(filters.status || '').trim(),
      dateFrom: String(filters.dateFrom || '').slice(0, 10),
      dateTo: String(filters.dateTo || '').slice(0, 10),
      staleOnly: filters.staleOnly === true
    };
  }

  function businessDate(value) {
    if (!value) return '';
    var text = value instanceof Date ? value.toISOString() : String(value);
    var match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }

  function businessDaysSince(value, today) {
    var from = businessDate(value);
    var to = businessDate(today || new Date().toISOString());
    if (!from || !to || from >= to) return 0;
    var cursor = new Date(from + 'T00:00:00Z');
    var end = new Date(to + 'T00:00:00Z');
    var count = 0;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    while (cursor <= end) {
      var weekday = cursor.getUTCDay();
      if (weekday !== 0 && weekday !== 6) count += 1;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
  }

  function staleInfo(lead, today, threshold) {
    var reference = lead.sdrUpdatedAt || lead.createdAt || '';
    var days = businessDaysSince(reference, today);
    return { stale: Boolean(reference) && days >= Number(threshold || 3), businessDays: days, referenceAt: reference };
  }

  function filterLeads(leads, user, filters, options) {
    var f = normalizeFilters(filters);
    var settings = options || {};
    var today = settings.today || new Date().toISOString();
    var threshold = settings.staleBusinessDays || 3;
    return (leads || []).filter(function (lead) {
      if (!canReadLead(user, lead)) return false;
      if (f.brokerId && String(lead.brokerId) !== f.brokerId) return false;
      if (f.developmentId && String(lead.developmentId) !== f.developmentId) return false;
      if (f.status && lead.status !== f.status) return false;
      var created = businessDate(lead.createdAt);
      if (f.dateFrom && (!created || created < f.dateFrom)) return false;
      if (f.dateTo && (!created || created > f.dateTo)) return false;
      if (f.query) {
        var haystack = (String(lead.name || '') + ' ' + String(lead.phone || '')).toLocaleLowerCase('pt-BR');
        if (haystack.indexOf(f.query) < 0) return false;
      }
      if (f.staleOnly && !staleInfo(lead, today, threshold).stale) return false;
      return true;
    });
  }

  function buildDashboard(leads, users, filters, options) {
    var list = filterLeads(leads, options && options.actor, filters, options);
    var stageCounts = {};
    STATUS_NAMES.forEach(function (status) { stageCounts[status] = 0; });
    list.forEach(function (lead) { if (Object.prototype.hasOwnProperty.call(stageCounts, lead.status)) stageCounts[lead.status] += 1; });
    var brokers = (users || []).filter(function (user) { return user.role === 'Corretor'; }).map(function (user) {
      var own = list.filter(function (lead) { return String(lead.brokerId) === String(user.id); });
      var distribution = {};
      STATUS_NAMES.forEach(function (status) { distribution[status] = 0; });
      own.forEach(function (lead) { if (Object.prototype.hasOwnProperty.call(distribution, lead.status)) distribution[lead.status] += 1; });
      return { id: user.id, name: user.name, active: user.active !== false, total: own.length, statuses: distribution };
    });
    brokers.sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name, 'pt-BR'); });
    var stale = list.map(function (lead) {
      var info = staleInfo(lead, options && options.today, options && options.staleBusinessDays);
      return Object.assign({}, lead, { staleBusinessDays: info.businessDays, staleReferenceAt: info.referenceAt });
    }).filter(function (lead) { return lead.staleBusinessDays >= Number(options && options.staleBusinessDays || 3); })
      .sort(function (a, b) { return b.staleBusinessDays - a.staleBusinessDays; });
    return {
      total: list.length,
      activeAttendance: stageCounts['Em atendimento'],
      appointments: stageCounts['Atendimento agendado'],
      completed: stageCounts['Atendimento realizado'],
      approved: stageCounts['Aprovado pela Caixa'],
      rejected: stageCounts['Reprovado pela Caixa'],
      withdrawals: stageCounts['Desistência'],
      purchased: stageCounts['Já comprou'],
      stageCounts: stageCounts,
      ranking: brokers,
      staleCount: stale.length,
      staleLeads: stale.slice(0, 50)
    };
  }

  function paginate(list, page, pageSize) {
    var size = Math.max(1, Math.min(Number(pageSize) || 50, 100));
    var pageNumber = Math.max(1, Number(page) || 1);
    var start = (pageNumber - 1) * size;
    return { items: (list || []).slice(start, start + size), page: pageNumber, pageSize: size, total: (list || []).length };
  }

  return {
    STATUS_NAMES: STATUS_NAMES.slice(),
    ADMIN_ROLES: ADMIN_ROLES.slice(),
    normalizeEmail: normalizeEmail,
    isAdmin: isAdmin,
    canReadLead: canReadLead,
    editableFields: editableFields,
    validateLeadInput: validateLeadInput,
    normalizeFilters: normalizeFilters,
    businessDate: businessDate,
    businessDaysSince: businessDaysSince,
    staleInfo: staleInfo,
    filterLeads: filterLeads,
    buildDashboard: buildDashboard,
    paginate: paginate
  };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = CrmDomain;
