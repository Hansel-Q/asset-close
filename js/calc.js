/**
 * 纯计算层：不依赖 DOM，方便用 Node 做单元测试。
 *
 * v1.1 起只有一种收益口径：
 *   收益 = 本次总资产 - 上次总资产
 *   收益率 = 收益 / 上次总资产（上次总资产 > 0 时才计算）
 */

import { daysBetween, monthOf, todayStr } from './utils.js';

export function accountMap(accounts) {
  return Object.fromEntries(accounts.map((account) => [account.id, account]));
}

export function sortBySortOrder(items) {
  return [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function activeAccounts(data) {
  return sortBySortOrder(data.accounts.filter((account) => !account.archived));
}

export function sortedSnapshots(data, ascending = true) {
  const list = [...data.snapshots].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return 0;
  });
  return ascending ? list : list.reverse();
}

export function snapshotAt(data, date) {
  return data.snapshots.find((snapshot) => snapshot.date === date) || null;
}

export function latestSnapshot(data) {
  const list = sortedSnapshots(data, true);
  return list.length ? list[list.length - 1] : null;
}

export function previousSnapshot(data, date) {
  let previous = null;
  for (const snapshot of sortedSnapshots(data, true)) {
    if (snapshot.date < date) previous = snapshot;
    else break;
  }
  return previous;
}

/** 账户净值：资产为正，负债为负（负债余额存欠款正数）。 */
export function accountNet(account, cents) {
  if (!account) return 0;
  return account.type === 'liability' ? -Math.abs(cents) : cents;
}

export function snapshotNet(snapshot, accounts) {
  if (!snapshot) return 0;
  const map = Array.isArray(accounts) ? accountMap(accounts) : accounts;
  let net = 0;
  for (const [accountId, cents] of Object.entries(snapshot.balances || {})) {
    net += accountNet(map[accountId], cents);
  }
  return net;
}

export function snapshotBreakdown(snapshot, accounts) {
  if (!snapshot) return { assets: 0, liabilities: 0, net: 0 };
  const map = Array.isArray(accounts) ? accountMap(accounts) : accounts;
  let assets = 0;
  let liabilities = 0;
  for (const [accountId, cents] of Object.entries(snapshot.balances || {})) {
    const account = map[accountId];
    if (!account) continue;
    if (account.type === 'liability') liabilities += Math.abs(cents);
    else assets += cents;
  }
  return { assets, liabilities, net: assets - liabilities };
}

/** 某条快照里实际有余额的账户（包括后来归档的），用于详情展示。 */
export function accountsInSnapshot(snapshot, data) {
  if (!snapshot) return [];
  const map = accountMap(data.accounts);
  return Object.entries(snapshot.balances || {})
    .map(([accountId, cents]) => {
      const account = map[accountId];
      if (!account) return null;
      return { account, cents };
    })
    .filter(Boolean)
    .sort((a, b) => (a.account.sortOrder ?? 0) - (b.account.sortOrder ?? 0));
}

export function rateOf(deltaCents, baseCents) {
  if (!Number.isFinite(baseCents) || baseCents <= 0) return null;
  return deltaCents / baseCents;
}

/**
 * 计算某条快照对应的区间收益。
 * 没有上一条记录时，收益相关字段为 null。
 */
export function calculatePeriod(data, snapshot) {
  if (!snapshot) return null;

  const current = snapshotBreakdown(snapshot, data.accounts);
  const previous = previousSnapshot(data, snapshot.date);

  if (!previous) {
    return {
      snapshot,
      previous: null,
      current,
      previousBreakdown: null,
      hasPrevious: false,
      days: 0,
      rawDelta: null,
      rawRate: null,
      dailyAvgRaw: null
    };
  }

  const previousBreakdown = snapshotBreakdown(previous, data.accounts);
  const rawDelta = current.net - previousBreakdown.net;
  const days = Math.max(1, daysBetween(previous.date, snapshot.date));

  return {
    snapshot,
    previous,
    current,
    previousBreakdown,
    hasPrevious: true,
    days,
    rawDelta,
    rawRate: rateOf(rawDelta, previousBreakdown.net),
    dailyAvgRaw: rawDelta / days
  };
}

export function currentView(data) {
  const latest = latestSnapshot(data);
  const period = latest ? calculatePeriod(data, latest) : null;
  const today = todayStr();
  return {
    latest,
    period,
    today,
    isTodayRecorded: latest?.date === today,
    daysSinceLatest: latest ? daysBetween(latest.date, today) : null
  };
}

/** 历史页用：按日期倒序返回每条快照及其区间计算。 */
export function historyRows(data) {
  return sortedSnapshots(data, false).map((snapshot) => ({
    snapshot,
    period: calculatePeriod(data, snapshot)
  }));
}

export function snapshotMonthlyGroups(data) {
  const groups = new Map();
  for (const snapshot of sortedSnapshots(data, false)) {
    const month = monthOf(snapshot.date);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(snapshot);
  }
  return [...groups.entries()].map(([month, snapshots]) => ({ month, snapshots }));
}

/**
 * 构造趋势图数据。每个点都带真实的上一条记录收益，
 * 即使上一条在图表时间范围之外。
 */
export function buildChartPoints(data, snapshots) {
  return snapshots.map((snapshot) => {
    const period = calculatePeriod(data, snapshot);
    return {
      date: snapshot.date,
      value: period.current.net,
      delta: period.rawDelta,
      rate: period.rawRate,
      days: period.days,
      hasPrevious: period.hasPrevious,
      previousDate: period.previous?.date || null
    };
  });
}

export function countSnapshotsUsingAccount(data, accountId) {
  return data.snapshots.reduce((count, snapshot) => (
    Object.prototype.hasOwnProperty.call(snapshot.balances || {}, accountId) ? count + 1 : count
  ), 0);
}

/** 某账户最近一次出现在快照里的余额（用于归档提示）。 */
export function latestBalanceOfAccount(data, accountId) {
  for (const snapshot of sortedSnapshots(data, false)) {
    if (Object.prototype.hasOwnProperty.call(snapshot.balances || {}, accountId)) {
      return { date: snapshot.date, cents: snapshot.balances[accountId] };
    }
  }
  return null;
}
