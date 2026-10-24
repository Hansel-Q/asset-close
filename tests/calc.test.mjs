import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultData } from '../js/store.js';
import {
  snapshotBreakdown,
  snapshotNet,
  calculatePeriod,
  previousSnapshot,
  latestSnapshot,
  historyRows,
  buildChartPoints,
  latestBalanceOfAccount
} from '../js/calc.js';

function makeData() {
  const data = createDefaultData();
  data.accounts = [
    { id: 'a', name: '支付宝', type: 'asset', kind: 'alipay', sortOrder: 10, archived: false },
    { id: 'b', name: '银行卡', type: 'asset', kind: 'bank', sortOrder: 20, archived: false },
    { id: 'c', name: '信用卡', type: 'liability', kind: 'credit', sortOrder: 30, archived: false }
  ];
  data.snapshots = [];
  return data;
}

function snap(date, balances) {
  return { date, balances, note: '', createdAt: 'x', updatedAt: 'x' };
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

test('第一条记录没有上期，收益为空', () => {
  const data = makeData();
  data.snapshots = [snap('2026-10-19', { a: 1_000_000, b: 0, c: 0 })];
  const period = calculatePeriod(data, data.snapshots[0]);
  assert.equal(period.hasPrevious, false);
  assert.equal(period.rawDelta, null);
  assert.equal(period.rawRate, null);
  assert.equal(period.dailyAvgRaw, null);
  assert.equal(period.days, 0);
});

test('收益 = 总资产变化，不剔除任何收入', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 800_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 850_000, b: 0, c: 0 })
  ];
  const period = calculatePeriod(data, data.snapshots[1]);
  assert.equal(period.rawDelta, 50_000);
  assert.equal(period.rawRate, 50_000 / 800_000);
  assert.equal(period.days, 1);
  assert.equal(period.dailyAvgRaw, 50_000);
  assert.equal('adjustedDelta' in period, false);
  assert.equal('flows' in period, false);
});

test('工资到账导致余额增加时也原样计入收益', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 800_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 1_800_000, b: 0, c: 0 })
  ];
  const period = calculatePeriod(data, data.snapshots[1]);
  assert.equal(period.rawDelta, 1_000_000);
});

test('跨多天：区间收益和日均', () => {
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

test('历史按日期倒序返回收益', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-18', { a: 800_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 850_000, b: 0, c: 0 })
  ];
  const rows = historyRows(data);
  assert.equal(rows[0].snapshot.date, '2026-10-19');
  assert.equal(rows[0].period.rawDelta, 50_000);
  assert.equal(rows[1].snapshot.date, '2026-10-18');
});

test('图表 points 的窗口首点仍能引用窗口外的上期', () => {
  const data = makeData();
  data.snapshots = [
    snap('2026-10-16', { a: 700_000, b: 0, c: 0 }),
    snap('2026-10-18', { a: 800_000, b: 0, c: 0 }),
    snap('2026-10-19', { a: 850_000, b: 0, c: 0 })
  ];
  const points = buildChartPoints(data, [data.snapshots[1], data.snapshots[2]]);
  assert.equal(points.length, 2);
  assert.equal(points[0].date, '2026-10-18');
  assert.equal(points[0].value, 800_000);
  assert.equal(points[0].delta, 100_000);
  assert.equal(points[0].previousDate, '2026-10-16');
  assert.equal(points[1].delta, 50_000);
  assert.equal(points[1].rate, 50_000 / 800_000);
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
