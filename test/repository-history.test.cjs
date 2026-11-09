const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

class FakeRange {
  constructor(sheet, row, column, rows, columns) {
    Object.assign(this, { sheet, row, column, rows, columns });
  }
  getValues() {
    return Array.from({ length: this.rows }, (_, rowIndex) =>
      Array.from({ length: this.columns }, (_, columnIndex) =>
        this.sheet.data[this.row - 1 + rowIndex]?.[this.column - 1 + columnIndex] ?? ''
      )
    );
  }
  getDisplayValues() { return this.getValues().map((row) => row.map((value) => String(value ?? ''))); }
  setNumberFormat() { return this; }
  setValues(values) {
    values.forEach((row, rowIndex) => {
      const targetIndex = this.row - 1 + rowIndex;
      this.sheet.data[targetIndex] ||= [];
      row.forEach((value, columnIndex) => { this.sheet.data[targetIndex][this.column - 1 + columnIndex] = value; });
    });
    return this;
  }
  setFontWeight() { return this; }
  setFontColor() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(name, rows = []) { this.name = name; this.data = rows.map((row) => [...row]); this.isProtected = false; }
  getName() { return this.name; }
  getLastRow() {
    for (let index = this.data.length - 1; index >= 0; index -= 1) {
      if (this.data[index]?.some((value) => value !== '' && value !== null && value !== undefined)) return index + 1;
    }
    return 0;
  }
  getMaxRows() { return 1000; }
  getRange(row, column, rows = 1, columns = 1) { return new FakeRange(this, row, column, rows, columns); }
  setFrozenRows() {}
  autoResizeColumns() {}
  getProtections() { return []; }
  protect() {
    this.isProtected = true;
    return { setDescription() { return this; }, setWarningOnly() { return this; } };
  }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = new Map(sheets.map((sheet) => [sheet.getName(), sheet])); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const sheet = new FakeSheet(name); this.sheets.set(name, sheet); return sheet; }
}

function makeRepository() {
  const userHeaders = ['id','name','email','role','active','passwordSalt','passwordHash','iterations','mustChangePassword','sessionVersion','createdAt','updatedAt'];
  const leadHeaders = ['id','name','phone','developmentId','developmentName','notes','sdrFeedback','status','brokerId','brokerName','createdAt','createdBy','updatedAt','updatedBy','sdrUpdatedAt','sdrUpdatedBy'];
  const users = [
    ['U004','SDR de Teste','sdr@example.test','SDR',true,'salt','hash',1000,false,0,'2026-11-01','2026-11-01']
  ];
  const leads = [
    ['L001','Cliente Atual','11999990000','E001','Empreendimento Teste','Nota','Ligação anterior','Em atendimento','U005','Corretor','2026-11-01','U005','2026-11-08','U004','2026-11-08T10:30:00-03:00','U004'],
    ['L002','Cliente sem contato','11999990001','E001','Empreendimento Teste','','','Em contato','U005','Corretor','2026-11-08','U005','2026-11-08','U005','','']
  ];
  const spreadsheet = new FakeSpreadsheet([
    new FakeSheet('CRM_Usuarios', [userHeaders, ...users]),
    new FakeSheet('CRM_Clientes', [leadHeaders, ...leads])
  ]);
  const properties = new Map([['CRM_SPREADSHEET_ID','synthetic-spreadsheet']]);
  const context = vm.createContext({
    CRM_CONFIG: { identity: { primary: '#EE7A00' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key) || null, setProperty: (key, value) => properties.set(key, String(value)) }) },
    SpreadsheetApp: { openById: () => spreadsheet, ProtectionType: { SHEET: 'SHEET' } },
    Utilities: { getUuid: (() => { let id = 0; return () => `history-${++id}`; })() }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Repository.gs'), 'utf8'), context, { filename: 'Repository.gs' });
  return { repo: context.CrmRepo, spreadsheet, properties };
}

test('migração preserva o estado SDR atual, marca sua origem e é idempotente', () => {
  const { repo, spreadsheet, properties } = makeRepository();
  repo.initializeSdrHistory();
  const sheet = spreadsheet.getSheetByName('CRM_HistoricoSDR');
  assert.ok(sheet);
  assert.equal(sheet.isProtected, true);
  assert.equal(sheet.data[0].join(','), 'id,leadId,at,userId,userName,status,feedback,source');
  assert.equal(sheet.getLastRow(), 2);
  const history = repo.getSdrHistory('L001');
  assert.equal(history.length, 1);
  assert.equal(history[0].userName, 'SDR de Teste');
  assert.equal(history[0].feedback, 'Ligação anterior');
  assert.match(history[0].source, /Estado atual migrado/);
  assert.equal(repo.getSdrHistory('L002').length, 0);
  assert.equal(properties.get('CRM_SDR_HISTORY_MIGRATED'), 'true');
  repo.initializeSdrHistory();
  assert.equal(sheet.getLastRow(), 2);
});

test('novas entradas são adicionadas sem sobrescrever o registro anterior', () => {
  const { repo } = makeRepository();
  repo.initializeSdrHistory();
  repo.addSdrHistory({ id: 'history-new', leadId: 'L001', at: '2026-11-09T12:00:00-03:00', userId: 'U004', userName: 'SDR de Teste', status: 'Atendimento agendado', feedback: 'Novo contato', source: 'Atualização registrada pelo SDR' });
  const history = repo.getSdrHistory('L001');
  assert.equal(history.length, 2);
  assert.equal(history[0].feedback, 'Novo contato');
  assert.equal(history[1].feedback, 'Ligação anterior');
});
