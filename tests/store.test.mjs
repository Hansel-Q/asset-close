import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  AUTO_BACKUP_KEY,
  AUTO_BACKUP_LIMIT,
  createDefaultData,
  migrateData,
  validateData,
  exportBackup,
  parseBackup,
  summarizeData,
  loadData,
  saveData,
  createStore,
  captureAutoBackup,
  readAutoBackups,
  clearAutoBackups,
  dropOldestAutoBackup,
  dataSignature
} from '../js/store.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    _map: map
  };
}

function snapshot(date = '2026-10-19', balances = { 'acct-alipay': 1_000_000 }) {
  return {
    date,
    balances,
    note: '',
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`
  };
}

function v1Data() {
  return {
    schemaVersion: 1,
    updatedAt: '2026-10-19T10:00:00.000Z',
    settings: {
      theme: 'dark',
      returnMode: 'adjusted',
      defaultEntryMode: 'delta',
      lastExportAt: '2026-10-18T10:00:00.000Z',
      backupReminderDismissedAt: null,
      onboardingDone: true
    },
    accounts: [
      {
        id: 'acct-alipay',
        name: '支付宝',
        type: 'asset',
        kind: 'alipay',
        sortOrder: 10,
        archived: false,
        openingHandled: true,
        createdAt: 'x',
        updatedAt: 'x'
      },
      {
        id: 'acct-bank',
        name: '银行卡',
        type: 'asset',
        kind: 'bank',
        sortOrder: 20,
        archived: false,
        openingHandled: true,
        createdAt: 'x',
        updatedAt: 'x'
      }
    ],
    incomeCategories: [
      { id: 'salary', name: '工资', kind: 'income', direction: 'in', builtin: true, archived: false, sortOrder: 10 }
    ],
    incomeRecords: [
      {
        id: 'inc-1',
        date: '2026-10-19',
        categoryId: 'salary',
        amountCents: 100_000,
        countsAsAsset: true,
        note: '工资',
        createdAt: 'x',
        updatedAt: 'x'
      }
    ],
    snapshots: [
      snapshot('2026-10-18', { 'acct-alipay': 800_000, 'acct-bank': 200_000 }),
      snapshot('2026-10-19', { 'acct-alipay': 1_000_000, 'acct-bank': 200_000 })
    ]
  };
}

test('默认数据是 v2，且不含收入字段', () => {
  const data = createDefaultData();
  assert.equal(data.schemaVersion, SCHEMA_VERSION);
  assert.equal(validateData(data).ok, true);
  assert.equal('incomeRecords' in data, false);
  assert.equal('incomeCategories' in data, false);
  assert.equal('returnMode' in data.settings, false);
  assert.equal('defaultEntryMode' in data.settings, false);
  assert.equal(data.settings.autoShareAfterSave, true);
});

test('v1 迁移到 v2：账户/快照保留，收入与旧设置彻底删除', () => {
  const result = migrateData(v1Data());
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 1);
  assert.equal(result.discardedIncome, true);
  assert.equal(result.data.schemaVersion, 2);
  assert.equal('incomeRecords' in result.data, false);
  assert.equal('incomeCategories' in result.data, false);
  assert.equal('returnMode' in result.data.settings, false);
  assert.equal('defaultEntryMode' in result.data.settings, false);
  assert.equal('openingHandled' in result.data.accounts[0], false);
  assert.equal(result.data.accounts.length, 2);
  assert.equal(result.data.snapshots.length, 2);
  assert.equal(result.data.settings.theme, 'dark');
  assert.equal(result.data.settings.autoShareAfterSave, true);
  assert.equal(validateData(result.data).ok, true);
});

test('自称 v2 但残留收入字段的数据也会被清洗', () => {
  const raw = v1Data();
  raw.schemaVersion = 2;
  const result = migrateData(raw);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, false);
  assert.equal(result.changed, true);
  assert.equal(result.discardedIncome, true);
  assert.equal('incomeRecords' in result.data, false);
  assert.equal('incomeCategories' in result.data, false);
  assert.equal('returnMode' in result.data.settings, false);
});

test('不支持的 schema 版本被拒绝', () => {
  const raw = v1Data();
  raw.schemaVersion = 99;
  const result = migrateData(raw);
  assert.equal(result.ok, false);
  assert.match(result.error, /版本/);
});

test('导出再解析，数据完整且为 v2', () => {
  const data = createDefaultData();
  data.snapshots.push(snapshot());

  const text = exportBackup(data);
  const result = parseBackup(text);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.schemaVersion, 2);
  assert.equal(result.data.snapshots.length, 1);
  assert.equal(result.summary.snapshots, 1);
  assert.equal(result.summary.firstDate, '2026-10-19');
  assert.equal('incomes' in result.summary, false);
});

test('v1 备份导入时丢弃收入部分', () => {
  const text = JSON.stringify({
    format: 'asset-close-backup',
    formatVersion: 1,
    appVersion: '1.0.0',
    exportedAt: 'x',
    data: v1Data()
  });
  const result = parseBackup(text);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.migratedFrom, 1);
  assert.equal(result.discardedIncome, true);
  assert.equal('incomeRecords' in result.data, false);
  assert.equal(result.data.snapshots.length, 2);
});

test('也接受没有信封的根数据', () => {
  const data = createDefaultData();
  assert.equal(parseBackup(JSON.stringify(data)).ok, true);
});

test('坏文件被拒绝', () => {
  assert.equal(parseBackup('not json').ok, false);
  assert.equal(parseBackup('{"foo":1}').ok, false);
});

test('校验能发现重复日期、坏金额和非法 ID', () => {
  const data = createDefaultData();
  data.accounts[0].id = 'bad"id';
  data.snapshots = [snapshot('2026-10-19'), snapshot('2026-10-19')];
  data.snapshots[0].balances['acct-alipay'] = 12.34;

  const result = validateData(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('非法字符')));
  assert.ok(result.errors.some((error) => error.includes('同一天')));
  assert.ok(result.errors.some((error) => error.includes('整数分')));
});

test('校验拒绝不存在的账户引用和假日期', () => {
  const data = createDefaultData();
  data.snapshots = [{
    date: '2026-02-30',
    balances: { 'no-such-account': 100 },
    note: '',
    createdAt: 'x',
    updatedAt: 'x'
  }];
  const result = validateData(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('日期格式')));
  assert.ok(result.errors.some((error) => error.includes('不存在')));
});

test('loadData 首次生成 v2 默认数据', () => {
  const storage = fakeStorage();
  const result = loadData(storage);
  assert.equal(result.ok, true);
  assert.equal(result.isNew, true);
  const saved = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(saved.schemaVersion, 2);
});

test('loadData 把 v1 数据迁移并写回，同时生成 v2 自动备份', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify(v1Data()) });
  const result = loadData(storage);
  assert.equal(result.ok, true);
  assert.equal(result.migrated, true);
  assert.equal(result.discardedIncome, true);
  const saved = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(saved.schemaVersion, 2);
  assert.equal('incomeRecords' in saved, false);
  assert.equal(storage.getItem(AUTO_BACKUP_KEY).includes('incomeRecords'), false);
  assert.equal(readAutoBackups(storage).length, 1);
});

test('loadData 解析失败时保留原始字符串', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: '{broken' });
  const result = loadData(storage);
  assert.equal(result.ok, false);
  assert.equal(result.raw, '{broken');
  assert.equal(storage.getItem(STORAGE_KEY), '{broken');
});

test('loadData 迁移写回失败时仍可用，但提示 warning', () => {
  const base = fakeStorage({ [STORAGE_KEY]: JSON.stringify(v1Data()) });
  const storage = {
    getItem: (key) => base.getItem(key),
    removeItem: (key) => base.removeItem(key),
    setItem: (key) => {
      throw new Error('write blocked');
    }
  };
  const result = loadData(storage);
  assert.equal(result.ok, true);
  assert.equal(result.data.schemaVersion, 2);
  assert.match(result.migrationWarning, /写回失败/);
  assert.equal(JSON.parse(base.getItem(STORAGE_KEY)).schemaVersion, 1);
});

test('saveData 能识别配额错误', () => {
  const data = createDefaultData();
  const storage = {
    setItem: () => {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
  };
  const result = saveData(data, storage);
  assert.equal(result.ok, false);
  assert.equal(result.quota, true);
});

test('dataSignature 忽略设置和时间戳，但对余额变化敏感', () => {
  const a = createDefaultData();
  a.snapshots = [snapshot()];
  const b = JSON.parse(JSON.stringify(a));
  b.settings.theme = 'dark';
  b.settings.autoShareAfterSave = false;
  b.snapshots[0].updatedAt = 'different';
  b.accounts[0].updatedAt = 'different';
  assert.equal(dataSignature(a), dataSignature(b));

  const c = JSON.parse(JSON.stringify(a));
  c.snapshots[0].balances['acct-alipay'] = 999;
  assert.notEqual(dataSignature(a), dataSignature(c));
});

test('captureAutoBackup：仅设置变化不新增，force 可新增', () => {
  const storage = fakeStorage();
  const data = createDefaultData();
  data.snapshots = [snapshot()];

  const first = captureAutoBackup(data, storage, { reason: 'save' });
  assert.ok(first);
  assert.equal(readAutoBackups(storage).length, 1);

  const changedSettings = JSON.parse(JSON.stringify(data));
  changedSettings.settings.theme = 'light';
  assert.equal(captureAutoBackup(changedSettings, storage, { reason: 'save' }), null);
  assert.equal(readAutoBackups(storage).length, 1);

  const forced = captureAutoBackup(changedSettings, storage, { reason: 'before-reset', force: true });
  assert.ok(forced);
  assert.equal(readAutoBackups(storage).length, 2);
});

test('自动备份最多保留 7 份，最新在前', () => {
  const storage = fakeStorage();
  for (let i = 0; i < 9; i += 1) {
    const data = createDefaultData();
    data.snapshots = [snapshot('2026-10-19', { 'acct-alipay': 1000 + i })];
    captureAutoBackup(data, storage, { reason: 'save', force: true });
  }
  const backups = readAutoBackups(storage);
  assert.equal(backups.length, AUTO_BACKUP_LIMIT);
  assert.equal(backups[0].data.snapshots[0].balances['acct-alipay'], 1008);
  assert.equal(backups[6].data.snapshots[0].balances['acct-alipay'], 1002);
});

test('清空自动备份和删除最旧备份', () => {
  const storage = fakeStorage();
  for (let i = 1; i <= 3; i += 1) {
    const data = createDefaultData();
    data.snapshots = [snapshot('2026-10-19', { 'acct-alipay': i })];
    captureAutoBackup(data, storage, { reason: 'save', force: true });
  }
  assert.equal(readAutoBackups(storage).length, 3);
  assert.equal(dropOldestAutoBackup(storage), true);
  assert.equal(readAutoBackups(storage).length, 2);
  clearAutoBackups(storage);
  assert.equal(readAutoBackups(storage).length, 0);
});

test('readAutoBackups 跳过坏条目', () => {
  const storage = fakeStorage({
    [AUTO_BACKUP_KEY]: JSON.stringify({
      version: 1,
      entries: [
        { at: 'x', signature: 'a', data: { schemaVersion: 2, settings: {}, accounts: [], snapshots: [] } },
        { at: 'y', signature: 'b', data: { foo: 1 } }
      ]
    })
  });
  const backups = readAutoBackups(storage);
  assert.equal(backups.length, 1);
});

test('createStore.set 写主数据并自动备份；仅改设置不新增', () => {
  const storage = fakeStorage();
  const store = createStore(storage);
  assert.equal(store.load().ok, true);

  const data = store.get();
  data.snapshots.push(snapshot());
  assert.equal(store.set(data).ok, true);
  assert.equal(readAutoBackups(storage).length, 1);

  data.settings.theme = 'dark';
  assert.equal(store.set(data).ok, true);
  assert.equal(readAutoBackups(storage).length, 1);
});

test('createStore.replace 在导入/恢复前备份当前状态', () => {
  const storage = fakeStorage();
  const store = createStore(storage);
  store.load();

  const current = store.get();
  current.snapshots.push(snapshot('2026-10-19', { 'acct-alipay': 1000 }));
  store.set(current);

  const imported = createDefaultData();
  imported.snapshots.push(snapshot('2026-10-20', { 'acct-alipay': 2000 }));
  const result = store.replace(imported, { reason: 'before-import' });
  assert.equal(result.ok, true);
  assert.equal(store.get().snapshots[0].balances['acct-alipay'], 2000);
  const backups = readAutoBackups(storage);
  assert.equal(backups.length, 2);
  assert.equal(backups[0].reason, 'before-import');
  assert.equal(backups[0].data.snapshots[0].balances['acct-alipay'], 1000);
});

test('createStore.reset 备份清空前状态并写入默认数据', () => {
  const storage = fakeStorage();
  const store = createStore(storage);
  store.load();

  const data = store.get();
  data.snapshots.push(snapshot('2026-10-19', { 'acct-alipay': 5000 }));
  store.set(data);

  const result = store.reset();
  assert.equal(result.ok, true);
  assert.equal(store.get().snapshots.length, 0);
  const backups = readAutoBackups(storage);
  assert.ok(backups.some((entry) => entry.reason === 'before-reset' && entry.data.snapshots.length === 1));
});

test('createStore.set 遇到配额错误时删除最旧备份并重试', () => {
  const base = fakeStorage();
  let failMainOnce = false;
  const storage = {
    getItem: (key) => base.getItem(key),
    removeItem: (key) => base.removeItem(key),
    setItem: (key, value) => {
      if (key === STORAGE_KEY && failMainOnce) {
        failMainOnce = false;
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      base.setItem(key, value);
    }
  };

  const store = createStore(storage);
  store.load();
  const data = store.get();
  data.snapshots.push(snapshot());
  store.set(data);

  failMainOnce = true;
  data.snapshots[0].balances['acct-alipay'] = 123;
  const result = store.set(data);
  assert.equal(result.ok, true);
});

test('summarizeData 不再包含收入统计', () => {
  const data = createDefaultData();
  data.snapshots = [snapshot('2026-10-19'), snapshot('2026-10-18')];
  const summary = summarizeData(data);
  assert.equal(summary.snapshots, 2);
  assert.equal(summary.firstDate, '2026-10-18');
  assert.equal(summary.lastDate, '2026-10-19');
  assert.equal(summary.activeAccounts, data.accounts.length);
  assert.equal('incomes' in summary, false);
});
