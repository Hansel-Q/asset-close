import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  createDefaultData,
  validateData,
  exportBackup,
  parseBackup,
  summarizeData,
  loadData,
  saveData,
  createStore
} from '../js/store.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    _map: map
  };
}

function validSnapshot(date = '2026-10-19') {
  return {
    date,
    balances: { 'acct-alipay': 123_456 },
    note: '',
    createdAt: '2026-10-19T10:00:00.000Z',
    updatedAt: '2026-10-19T10:00:00.000Z'
  };
}

test('默认数据通过校验', () => {
  const data = createDefaultData();
  assert.equal(data.schemaVersion, SCHEMA_VERSION);
  const result = validateData(data);
  assert.equal(result.ok, true, result.errors.join('；'));
});

test('导出再解析，数据完整', () => {
  const data = createDefaultData();
  data.snapshots.push(validSnapshot());
  data.incomeRecords.push({
    id: 'inc-1',
    date: '2026-10-19',
    categoryId: 'salary',
    amountCents: 500_000,
    countsAsAsset: true,
    note: '',
    createdAt: 'x',
    updatedAt: 'x'
  });

  const text = exportBackup(data);
  const result = parseBackup(text);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.snapshots.length, 1);
  assert.equal(result.data.incomeRecords.length, 1);
  assert.equal(result.summary.snapshots, 1);
  assert.equal(result.summary.firstDate, '2026-10-19');
});

test('也接受没有信封的根数据', () => {
  const data = createDefaultData();
  const result = parseBackup(JSON.stringify(data));
  assert.equal(result.ok, true);
});

test('坏文件被拒绝，现有数据不受影响', () => {
  assert.equal(parseBackup('not json').ok, false);
  assert.equal(parseBackup('{"foo":1}').ok, false);

  const data = createDefaultData();
  data.schemaVersion = 999;
  assert.equal(parseBackup(JSON.stringify(data)).ok, false);
});

test('校验能发现重复日期、坏金额、不存在的分类', () => {
  const data = createDefaultData();
  data.snapshots = [validSnapshot('2026-10-19'), validSnapshot('2026-10-19')];
  data.snapshots[0].balances['acct-alipay'] = 12.34;
  data.incomeRecords.push({
    id: 'x',
    date: '2026-10-19',
    categoryId: 'not-exist',
    amountCents: -1,
    countsAsAsset: true,
    createdAt: 'x',
    updatedAt: 'x'
  });

  const result = validateData(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('同一天')));
  assert.ok(result.errors.some((error) => error.includes('整数分')));
  assert.ok(result.errors.some((error) => error.includes('分类不存在')));
  assert.ok(result.errors.some((error) => error.includes('非负整数')));
});

test('loadData 首次生成默认数据并保存', () => {
  const storage = fakeStorage();
  const result = loadData(storage);
  assert.equal(result.ok, true);
  assert.equal(result.isNew, true);
  assert.ok(storage.getItem(STORAGE_KEY));

  const second = loadData(storage);
  assert.equal(second.ok, true);
  assert.equal(second.isNew, false);
});

test('loadData 解析失败时保留原始字符串', () => {
  const storage = fakeStorage();
  storage.setItem(STORAGE_KEY, '{broken');
  const result = loadData(storage);
  assert.equal(result.ok, false);
  assert.equal(result.raw, '{broken');
  assert.equal(storage.getItem(STORAGE_KEY), '{broken');
});

test('saveData / loadData 往返', () => {
  const storage = fakeStorage();
  const data = createDefaultData();
  data.snapshots.push(validSnapshot());
  const saved = saveData(data, storage);
  assert.equal(saved.ok, true);

  const loaded = loadData(storage);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.data.snapshots.length, 1);
});

test('createStore 的 set 会写入存储并通知订阅者', () => {
  const storage = fakeStorage();
  const store = createStore(storage);
  const load = store.load();
  assert.equal(load.ok, true);

  let notified = 0;
  store.subscribe(() => { notified += 1; });

  const data = store.get();
  data.snapshots.push(validSnapshot());
  const result = store.set(data);
  assert.equal(result.ok, true);
  assert.equal(notified, 1);

  const reloaded = loadData(storage);
  assert.equal(reloaded.data.snapshots.length, 1);
});

test('校验拒绝非法 ID、假日期、非法分类类型和非布尔 countsAsAsset', () => {
  const data = createDefaultData();
  data.accounts[0].id = 'bad"id';
  data.snapshots.push({ ...validSnapshot('2026-02-30'), balances: {} });
  data.incomeCategories[0].kind = 'weird';
  data.incomeRecords.push({
    id: 'inc-1',
    date: '2026-10-19',
    categoryId: 'salary',
    amountCents: 100,
    countsAsAsset: 'yes',
    createdAt: 'x',
    updatedAt: 'x'
  });

  const result = validateData(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('非法字符')));
  assert.ok(result.errors.some((error) => error.includes('日期格式')));
  assert.ok(result.errors.some((error) => error.includes('分类类型')));
  assert.ok(result.errors.some((error) => error.includes('布尔值')));
});

test('summarizeData 统计正确', () => {
  const data = createDefaultData();
  data.snapshots = [validSnapshot('2026-10-19'), validSnapshot('2026-10-18')];
  const summary = summarizeData(data);
  assert.equal(summary.snapshots, 2);
  assert.equal(summary.firstDate, '2026-10-18');
  assert.equal(summary.lastDate, '2026-10-19');
  assert.equal(summary.activeAccounts, data.accounts.length);
});
