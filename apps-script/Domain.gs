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
  var SDR_CREATE_FIELDS = ['name', 'phone', 'developmentId', 'notes', 'brokerId'];
  var ADMIN_FIELDS = LEAD_FIELDS.slice();
  var CONVERSION_PATHS = [
    ['Em contato', 'Em atendimento'],
    ['Em atendimento', 'Atendimento agendado'],
    ['Atendimento agendado', 'Atendimento realizado'],
    ['Atendimento realizado', 'Enviando documentação'],
    ['Enviando documentação', 'Em análise documental'],
    ['Em análise documental', 'Aprovado pela Caixa'],
    ['Em análise documental', 'Reprovado pela Caixa'],
    ['Em atendimento', 'Desistência'],
    ['Aprovado pela Caixa', 'Já comprou']
  ];

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
    if (user.role === 'SDR' && isCreate) return SDR_CREATE_FIELDS.slice();
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
      if (user.role === 'Corretor' || user.role === 'SDR') result.status = 'Em contato';
      if (user.role === 'Corretor' || user.role === 'SDR') result.sdrFeedback = '';
      if ((user.role === 'Corretor' || user.role === 'SDR') && !result.brokerId) return { ok: false, error: 'Selecione o corretor responsável.' };
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
    var analytics = buildHistoricalAnalytics(options && options.allLeads || leads, options && options.events || [], options && options.sdrHistory || [], filters, options || {});
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
      staleLeads: stale.slice(0, 50),
      analytics: analytics
    };
  }

  function timestamp(value) {
    var parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function periodBounds(filters, options) {
    var current = timestamp(options && options.today) || Date.now();
    var from = String(filters && filters.dateFrom || '').slice(0, 10);
    var to = String(filters && filters.dateTo || '').slice(0, 10);
    var start = 0;
    var end = current;
    var label = String(filters && filters.periodMode || '') === 'month' ? 'Últimos 30 dias' : 'Últimos 7 dias';
    if (from) start = Date.parse(from + 'T00:00:00-03:00');
    if (to) end = Date.parse(to + 'T23:59:59.999-03:00');
    if (!start || !Number.isFinite(start)) {
      var durationDays = String(filters && filters.periodMode || '') === 'month' ? 30 : 7;
      start = current - durationDays * 24 * 60 * 60 * 1000;
    }
    if (!Number.isFinite(end) || end <= 0) end = current;
    if (end > current) end = current;
    if (start > current) start = current;
    if (from || to) label = from && to ? from + ' a ' + to : from ? 'Desde ' + from : 'Até ' + to;
    var duration = Math.max(1, end - start + 1);
    return { start: start, end: end, previousStart: start - duration, previousEnd: start - 1, label: label };
  }

  function isWithin(value, start, end) {
    var at = timestamp(value);
    return at > 0 && at >= start && at <= end;
  }

  function historicalContactAt(lead, history, asOf) {
    var entries = (history || []).filter(function (item) {
      return String(item.leadId || item.lead_id) === String(lead.id) && timestamp(item.at) > 0 && timestamp(item.at) <= asOf;
    }).sort(function (a, b) { return timestamp(a.at) - timestamp(b.at); });
    if (entries.length) return entries[entries.length - 1].at;
    var latestKnown = lead.sdrUpdatedAt || lead.sdr_updated_at || '';
    return timestamp(latestKnown) > 0 && timestamp(latestKnown) <= asOf ? latestKnown : lead.createdAt || lead.created_at || '';
  }

  function staleCountAt(leads, history, asOf, threshold, filters) {
    var f = normalizeFilters(filters);
    return (leads || []).filter(function (lead) {
      if (f.brokerId && String(lead.brokerId || lead.broker_id) !== f.brokerId) return false;
      if (f.developmentId && String(lead.developmentId || lead.development_id) !== f.developmentId) return false;
      var reference = historicalContactAt(lead, history, asOf);
      return businessDaysSince(reference, new Date(asOf).toISOString()) >= Number(threshold || 3);
    }).length;
  }

  function scopedHistoricalLeads(leads, filters, actor) {
    var f = normalizeFilters(filters);
    return (leads || []).filter(function (lead) {
      if (actor && !canReadLead(actor, lead)) return false;
      if (f.brokerId && String(lead.brokerId || lead.broker_id) !== f.brokerId) return false;
      if (f.developmentId && String(lead.developmentId || lead.development_id) !== f.developmentId) return false;
      return true;
    });
  }

  function summarizePeriod(leads, events, sdrHistory, start, end, statusHistoryAvailable) {
    var cohort = (leads || []).filter(function (lead) { return isWithin(lead.createdAt || lead.created_at, start, end); });
    var periodEvents = (events || []).filter(function (item) { return isWithin(item.at, start, end); });
    var periodContacts = (sdrHistory || []).filter(function (item) { return isWithin(item.at, start, end); });
    var firstContactDurations = [];
    cohort.forEach(function (lead) {
      var created = timestamp(lead.createdAt || lead.created_at);
      var first = (sdrHistory || []).filter(function (item) {
        return String(item.leadId || item.lead_id) === String(lead.id) && timestamp(item.at) >= created && timestamp(item.at) > 0;
      }).sort(function (a, b) { return timestamp(a.at) - timestamp(b.at); })[0];
      if (first && timestamp(first.at) >= created) firstContactDurations.push((timestamp(first.at) - created) / 3600000);
    });
    var purchased = cohort.filter(function (lead) {
      var created = timestamp(lead.createdAt || lead.created_at);
      return (events || []).some(function (item) {
        return String(item.leadId || item.lead_id) === String(lead.id) && item.newStatus === 'Já comprou' && timestamp(item.at) >= created && timestamp(item.at) <= end;
      });
    }).length;
    var paths = CONVERSION_PATHS.map(function (path) {
      var from = path[0]; var to = path[1];
      var entrants = new Map();
      (events || []).filter(function (item) {
        return item.newStatus === from && isWithin(item.at, start, end) && ['lead_created', 'status_change', 'baseline'].indexOf(item.eventType) >= 0;
      }).forEach(function (item) {
        var id = String(item.leadId || item.lead_id);
        if (!entrants.has(id) || timestamp(item.at) < timestamp(entrants.get(id))) entrants.set(id, item.at);
      });
      var converted = 0;
      entrants.forEach(function (enteredAt, leadId) {
        if ((events || []).some(function (item) {
          return String(item.leadId || item.lead_id) === leadId && item.oldStatus === from && item.newStatus === to && timestamp(item.at) >= timestamp(enteredAt);
        })) converted += 1;
      });
      return { from: from, to: to, entered: entrants.size, converted: converted, rate: entrants.size ? Math.round(converted / entrants.size * 1000) / 10 : null };
    });
    return {
      newLeads: cohort.length,
      statusChanges: periodEvents.filter(function (item) { return item.eventType === 'status_change'; }).length,
      sdrContacts: periodContacts.length,
      firstContactCount: firstContactDurations.length,
      averageFirstContactHours: firstContactDurations.length ? Math.round(firstContactDurations.reduce(function (sum, value) { return sum + value; }, 0) / firstContactDurations.length * 10) / 10 : null,
      purchased: purchased,
      overallConversion: statusHistoryAvailable && cohort.length ? Math.round(purchased / cohort.length * 1000) / 10 : null,
      conversions: paths
    };
  }

  function buildHistoricalAnalytics(leads, events, sdrHistory, filters, options) {
    var bounds = periodBounds(filters || {}, options || {});
    var all = scopedHistoricalLeads(leads, filters || {}, options && options.actor);
    var allowedIds = new Set(all.map(function (lead) { return String(lead.id); }));
    var scopedEvents = (events || []).filter(function (item) {
      var leadId = String(item.leadId || item.lead_id);
      return allowedIds.has(leadId);
    });
    var scopedHistory = (sdrHistory || []).filter(function (item) { return allowedIds.has(String(item.leadId || item.lead_id)); });
    var eventTimes = scopedEvents.map(function (item) { return timestamp(item.at); }).filter(function (value) { return value > 0; });
    var historyStartedAt = eventTimes.length ? Math.min.apply(Math, eventTimes) : 0;
    var currentHistoryAvailable = Boolean(historyStartedAt && bounds.end >= historyStartedAt);
    var previousHistoryAvailable = Boolean(historyStartedAt && bounds.previousEnd >= historyStartedAt);
    var current = summarizePeriod(all, scopedEvents, scopedHistory, bounds.start, bounds.end, currentHistoryAvailable);
    var previous = summarizePeriod(all, scopedEvents, scopedHistory, bounds.previousStart, bounds.previousEnd, previousHistoryAvailable);
    var threshold = Number(options && options.staleBusinessDays || 3);
    var staleFilters = { brokerId: filters && filters.brokerId, developmentId: filters && filters.developmentId };
    var staleNow = currentHistoryAvailable ? staleCountAt(all, scopedHistory, bounds.end, threshold, staleFilters) : null;
    var staleBefore = previousHistoryAvailable ? staleCountAt(all, scopedHistory, bounds.previousEnd, threshold, staleFilters) : null;
    var staleLeads = all.filter(function (lead) {
      return businessDaysSince(historicalContactAt(lead, scopedHistory, bounds.end), new Date(bounds.end).toISOString()) >= threshold;
    });
    var alerts = [];
    if (staleNow !== null && staleBefore !== null && staleNow > staleBefore) alerts.push({ severity: staleNow - staleBefore >= 3 ? 'high' : 'medium', title: 'Follow-ups atrasados em alta', detail: staleNow + ' clientes parados no fechamento do período, contra ' + staleBefore + ' no período anterior.' });
    current.conversions.forEach(function (item, index) {
      var prior = previous.conversions[index];
      if (item.rate !== null && prior && prior.rate !== null && item.entered >= 3 && prior.entered >= 3 && item.rate < prior.rate) {
        alerts.push({ severity: prior.rate - item.rate >= 10 ? 'high' : 'medium', title: 'Queda de conversão: ' + item.from, detail: item.rate + '% para ' + item.to + ', ante ' + prior.rate + '% no período anterior.' });
      }
    });
    var currentAvg = current.averageFirstContactHours; var previousAvg = previous.averageFirstContactHours;
    if (currentAvg !== null && previousAvg !== null && current.firstContactCount >= 2 && currentAvg > previousAvg && currentAvg - previousAvg >= Math.max(1, previousAvg * 0.1)) {
      alerts.push({ severity: 'medium', title: 'Primeiro contato mais demorado', detail: 'A média subiu de ' + previousAvg + ' h para ' + currentAvg + ' h.' });
    }
    var byBroker = {}; var byDevelopment = {};
    staleLeads.forEach(function (lead) {
      var broker = String(lead.brokerName || lead.broker_name || 'Corretor sem nome');
      var development = String(lead.developmentName || lead.development_name || 'Empreendimento sem nome');
      byBroker[broker] = (byBroker[broker] || 0) + 1;
      byDevelopment[development] = (byDevelopment[development] || 0) + 1;
    });
    function concentration(items, label) {
      Object.keys(items).map(function (name) { return { name: name, count: items[name] }; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 3).forEach(function (item) {
        if (item.count >= 2 && staleNow && item.count / staleNow >= 0.3) alerts.push({ severity: 'medium', title: 'Clientes parados concentrados', detail: item.count + ' clientes sem atualização em ' + label + ' ' + item.name + '.' });
      });
    }
    concentration(byBroker, 'no corretor'); concentration(byDevelopment, 'no empreendimento');
    return { periodLabel: bounds.label, historyStartedAt: historyStartedAt ? new Date(historyStartedAt).toISOString() : '', current: current, previous: previous, staleCurrent: staleNow, stalePrevious: staleBefore, alerts: alerts.slice(0, 8), conversionBasis: 'Coorte: clientes que entraram na etapa ou estavam nela no início do histórico e avançaram posteriormente. O histórico começa após a implantação desta análise.' };
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
    buildHistoricalAnalytics: buildHistoricalAnalytics,
    paginate: paginate
  };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = CrmDomain;
