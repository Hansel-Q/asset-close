import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultData } from '../js/store.js';
import {
  snapshotBreakdown,
  snapshotNet,
  calculatePeriod,
  calculateExternalFlows,
  previousSnapshot,
  latestSnapshot,
  selectedDelta,
  selectedRate,
  monthlyIncomeSummary,
  latestBalanceOfAccount
} from '../js/calc.js';

function makeData() {
  const data = createDefaultData();
  data.accounts = [
    { id: 'a', name: '支付宝', type: 'asset', kind: 'alipay', sortOrder: 10, archived: false },
    { id: 'b', name: '银行卡', type: 'asset', kind: 'bank', sortOrder: 20, archived: false },
    { id: 'c', name: '信用卡', type: 'liability', kind: 'credit', sortOrder: 30, archived: false }
  ];
  data.incomeCategories = [
    { id: 'salary', name: '工资', kind: 'income', direction: 'in', builtin: true, archived: false, sortOrder: 10 },
    { id: 'external_in', name: '外部转入', kind: 'external', direction: 'in', builtin: true, archived: false, sortOrder: 20 },
    { id: 'external_out', name: '外部转出', kind: 'external', direction: 'out', builtin: true, archived: false, sortOrder: 30 }
  ];
  data.snapshots = [];
  data.incomeRecords = [];
  return data;
}

function snap(date, balances) {
  return { date, balances, note: '', createdAt: 'x', updatedAt: 'x' };
}

function income(id, date, categoryId, amountCents, countsAsAsset = true) {
  return {
    id,
    date,
    categoryId,
    amountCents,
    countsAsAsset,
    note: '',
    createdAt: 'x',
    updatedAt: 'x'
  };
}

test('总资产 = 资产 - 负债', () => {
  const data = makeData();
  const snapshot = snap('2026-10-19', { a: 1_000_000, b: 500_000, c: 200_000 });
  assert.deepEqual(snapshotBreakdown(snapshot, data.accounts), {
    assets: 1_500_000,
    liabilities: 200_000,
    net: 1_300_000
  });
  assert.equal(snapshotNet(snapshot, data.accounts), 1_300_000);
});

test('第一条记录没有上期，收益显示为空', () => {
  const data = makeData();
  data.snapshots = [snap('2026-10-19', { a: 1_000_000, b: 0, c: 0 })];
  const period = calculatePeriod(data, data.snapshots[0]);
  assert.equal(period.hasPrevious, false);
  assert.equal(period.rawDelta, null);
  assert.equal(period.adjustedDelta, null);
  assert.equal(period.rawRate, null);
  assert.equal(period.adjustedRate, null);
});

test('工资收入同时算两种口径：不剔除 +500，剔除后 -500', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 800_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 850_000, b: 0, c: 0 })
  ];
  data.incomeRecords = [income('i1', '2026-10-19', 'salary', 100_000)];

  const period = calculatePeriod(data, data.snapshots[1]);
  assert.equal(period.rawDelta, 50_000);
  assert.equal(period.flows.incomeIn, 100_000);
  assert.equal(period.flows.extNet, 100_000);
  assert.equal(period.adjustedDelta, -50_000);
  assert.equal(period.days, 1);
  assert.equal(period.rawRate, 50_000 / 800_000);
  assert.equal(period.adjustedRate, -50_000 / 800_000);
  assert.equal(selectedDelta(period, 'raw'), 50_000);
  assert.equal(selectedDelta(period, 'adjusted'), -50_000);
  assert.equal(selectedRate(period, 'adjusted'), -50_000 / 800_000);
});

test('收入落在上次记录当天时，不计入本区间（避免重复扣）', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 800_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 900_000, b: 0, c: 0 })
  ];
  data.incomeRecords = [income('i1', '2026-10-18', 'salary', 100_000)];

  const period = calculatePeriod(data, data.snapshots[1]);
  assert.equal(period.flows.extNet, 0);
  assert.equal(period.adjustedDelta, 100_000);
});

test('外部转出会让剔除后收益增加', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 800_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 750_000, b: 0, c: 0 })
  ];
  data.incomeRecords = [income('i1', '2026-10-19', 'external_out', 50_000)];

  const period = calculatePeriod(data, data.snapshots[1]);
  assert.equal(period.rawDelta, -50_000);
  assert.equal(period.flows.externalOut, 50_000);
  assert.equal(period.flows.extNet, -50_000);
  assert.equal(period.adjustedDelta, 0);
});

test('未勾选“已计入资产”的收入只做记录，不影响剔除口径', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 800_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 850_000, b: 0, c: 0 })
  ];
  data.incomeRecords = [income('i1', '2026-10-19', 'salary', 100_000, false)];

  const period = calculatePeriod(data, data.snapshots[1]);
  assert.equal(period.flows.extNet, 0);
  assert.equal(period.flows.ignored, 100_000);
  assert.equal(period.adjustedDelta, 50_000);
});

test('外部转入 / 工资 / 外部转出的拆分正确', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 1_000_000, b: 0, c: 0 }),
    snap('2026-10-20', { a: 1_200_000, b: 0, c: 0 })
  ];
  data.incomeRecords = [
    income('i1', '2026-10-18', 'salary', 10_000),
    income('i2', '2026-10-19', 'salary', 100_000),
    income('i3', '2026-10-19', 'external_in', 50_000),
    income('i4', '2026-10-20', 'external_out', 30_000),
    income('i5', '2026-10-21', 'salary', 999_999)
  ];

  const flows = calculateExternalFlows(data, '2026-10-18', '2026-10-20');
  assert.equal(flows.incomeIn, 100_000);
  assert.equal(flows.externalIn, 50_000);
  assert.equal(flows.externalOut, 30_000);
  assert.equal(flows.extNet, 120_000);
  assert.equal(flows.records.length, 3);
});

test('跨多天：显示区间天数和日均，不把区间变化叫日收益', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-16', { a: 800_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 860_000, b: 0, c: 0 })
  ];
  const period = calculatePeriod(data, data.snapshots[1]);
  assert.equal(period.days, 3);
  assert.equal(period.rawDelta, 60_000);
  assert.equal(period.dailyAvgRaw, 20_000);
});

test('上期总资产为 0 时，收益率显示为空，金额仍正常', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 0, b: 0, c: 0 }),
    snap('2026-10-19', { a: 50_000, b: 0, c: 0 })
  ];
  const period = calculatePeriod(data, data.snapshots[1]);
  assert.equal(period.rawDelta, 50_000);
  assert.equal(period.rawRate, null);
  assert.equal(period.adjustedRate, null);
});

test('归档账户在历史快照里仍计入总资产', () => {
  const data = makeData();
  data.accounts[1].archived = true;
  data.snapshots = [
    snap('2026-10-18', { a: 800_000, b: 200_000, c: 0 }),
    snap('2026-10-19', { a: 850_000, c: 0 })
  ];
  const period = calculatePeriod(data, data.snapshots[1]);
  assert.equal(period.previousBreakdown.net, 1_000_000);
  assert.equal(period.current.net, 850_000);
  assert.equal(period.rawDelta, -150_000);
});

test('只有本次日期之前的记录才作为上期', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-17', { a: 100_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 200_000, b: 0, c: 0 }),
    snap('2026-10-21', { a: 300_000, b: 0, c: 0 })
  ];
  assert.equal(previousSnapshot(data, '2026-10-19').date, '2026-10-17');
  assert.equal(latestSnapshot(data).date, '2026-10-21');
});

test('收入页月度摘要', () => {
  const data = makeData();
  data.incomeRecords = [
    income('i1', '2026-10-01', 'salary', 1_000_000),
    income('i2', '2026-10-02', 'external_in', 200_000),
    income('i3', '2026-10-03', 'external_out', 50_000),
    income('i4', '2026-10-04', 'salary', 300_000, false),
    income('i5', '2026-09-30', 'salary', 999_999)
  ];
  const summary = monthlyIncomeSummary(data, '2026-10');
  assert.equal(summary.incomeIn, 1_000_000);
  assert.equal(summary.incomeTotal, 1_300_000);
  assert.equal(summary.externalIn, 200_000);
  assert.equal(summary.externalOut, 50_000);
  assert.equal(summary.ignored, 300_000);
  assert.equal(summary.totalIn, 1_500_000);
  assert.equal(summary.totalOut, 50_000);
  assert.equal(summary.netExternal, 1_150_000);
  assert.equal(summary.records.length, 4);
});

test('账户最近余额用于归档提示', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 800_000 }),
    snap('2026-10-19', { a: 850_000 })
  ];
  assert.deepEqual(latestBalanceOfAccount(data, 'a'), { date: '2026-10-19', cents: 850_000 });
  assert.equal(latestBalanceOfAccount(data, 'z'), null);
});
