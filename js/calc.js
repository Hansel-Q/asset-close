/**
 * 纯计算层：不依赖 DOM，方便用 Node 做单元测试。
 *
 * 口径说明：
 * - 原始变动 rawDelta = 本次净值 - 上次净值
 * - 外部净流入 extNet = 区间内（收入 - 外部转出），只算“已计入资产”的记录
 * - 剔除后变动 adjustedDelta = rawDelta - extNet
 * - 区间固定为 (上次记录日期, 本次记录日期]，每笔钱只扣一次
 */

import { daysBetween, monthOf, todayStr } from './utils.js';

export function accountMap(accounts) {
  return Object.fromEntries(accounts.map((account) => [account.id, account]));
}

export function categoryMap(categories) {
  return Object.fromEntries(categories.map((category) => [category.id, category]));
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

/** 区间 (afterDate, throughDate] 内的收入记录。字符串比较对 YYYY-MM-DD 安全。 */
export function incomeRecordsInRange(data, afterDate, throughDate) {
  return data.incomeRecords.filter((record) => record.date > afterDate && record.date <= throughDate);
}

export function recordCounts(record, category) {
  if (!category) return false;
  // 外部转入/转出永远计入；普通收入看用户勾选（默认计入）。
  if (category.kind === 'external') return true;
  return record.countsAsAsset !== false;
}

/**
 * 计算某区间的外部资金流水。
 * 返回的金额都是整数分；outflow/externalOut 是正数，extNet 才带符号。
 */
export function calculateExternalFlows(data, afterDate, throughDate) {
  const categories = categoryMap(data.incomeCategories);
  const records = incomeRecordsInRange(data, afterDate, throughDate);

  let incomeIn = 0;
  let externalIn = 0;
  let externalOut = 0;
  let ignored = 0;

  for (const record of records) {
    const category = categories[record.categoryId];
    if (!category) continue;
    const counted = recordCounts(record, category);

    if (category.direction === 'out') {
      if (counted) externalOut += record.amountCents;
      else ignored += record.amountCents;
      continue;
    }

    if (!counted) {
      ignored += record.amountCents;
      continue;
    }
    if (category.kind === 'external') externalIn += record.amountCents;
    else incomeIn += record.amountCents;
  }

  const inflow = incomeIn + externalIn;
  const outflow = externalOut;
  const extNet = inflow - outflow;

  return {
    records,
    incomeIn,
    externalIn,
    externalOut,
    inflow,
    outflow,
    extNet,
    ignored
  };
}

export function rateOf(deltaCents, baseCents) {
  if (!Number.isFinite(baseCents) || baseCents <= 0) return null;
  return deltaCents / baseCents;
}

/**
 * 计算某条快照对应的区间收益。
 * 没有上一条记录时，收益相关字段为 null（首页显示“—”）。
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
      adjustedDelta: null,
      rawRate: null,
      adjustedRate: null,
      dailyAvgRaw: null,
      dailyAvgAdjusted: null,
      flows: null
    };
  }

  const previousBreakdown = snapshotBreakdown(previous, data.accounts);
  const rawDelta = current.net - previousBreakdown.net;
  const flows = calculateExternalFlows(data, previous.date, snapshot.date);
  const adjustedDelta = rawDelta - flows.extNet;
  const days = Math.max(1, daysBetween(previous.date, snapshot.date));

  return {
    snapshot,
    previous,
    current,
    previousBreakdown,
    hasPrevious: true,
    days,
    rawDelta,
    adjustedDelta,
    rawRate: rateOf(rawDelta, previousBreakdown.net),
    adjustedRate: rateOf(adjustedDelta, previousBreakdown.net),
    dailyAvgRaw: rawDelta / days,
    dailyAvgAdjusted: adjustedDelta / days,
    flows
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

export function selectedDelta(period, mode) {
  if (!period?.hasPrevious) return null;
  return mode === 'adjusted' ? period.adjustedDelta : period.rawDelta;
}

export function selectedRate(period, mode) {
  if (!period?.hasPrevious) return null;
  return mode === 'adjusted' ? period.adjustedRate : period.rawRate;
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

export function incomeMonthlyGroups(data) {
  const groups = new Map();
  const records = [...data.incomeRecords].sort((a, b) => {
    if (a.date < b.date) return 1;
    if (a.date > b.date) return -1;
    return 0;
  });
  for (const record of records) {
    const month = monthOf(record.date);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(record);
  }
  return [...groups.entries()].map(([month, records]) => ({ month, records }));
}

export function categoryName(data, categoryId) {
  return data.incomeCategories.find((category) => category.id === categoryId)?.name || '未分类';
}

export function categoryOf(data, categoryId) {
  return data.incomeCategories.find((category) => category.id === categoryId) || null;
}

export function incomeRecordsForMonth(data, month) {
  return data.incomeRecords.filter((record) => monthOf(record.date) === month);
}

/** 收入页顶部摘要。 */
export function monthlyIncomeSummary(data, month) {
  const categories = categoryMap(data.incomeCategories);
  const records = incomeRecordsForMonth(data, month);
  let incomeIn = 0;
  let incomeTotal = 0;
  let externalIn = 0;
  let externalOut = 0;
  let ignored = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const record of records) {
    const category = categories[record.categoryId];
    if (!category) continue;
    const counted = recordCounts(record, category);

    if (category.direction === 'out') {
      totalOut += record.amountCents;
      if (counted) externalOut += record.amountCents;
      else ignored += record.amountCents;
      continue;
    }

    totalIn += record.amountCents;
    if (category.kind === 'income') incomeTotal += record.amountCents;
    if (!counted) {
      ignored += record.amountCents;
      continue;
    }
    if (category.kind === 'external') externalIn += record.amountCents;
    else incomeIn += record.amountCents;
  }

  return {
    records,
    incomeIn,
    incomeTotal,
    externalIn,
    externalOut,
    ignored,
    totalIn,
    totalOut,
    netExternal: incomeIn + externalIn - externalOut
  };
}

export function countSnapshotsUsingAccount(data, accountId) {
  return data.snapshots.reduce((count, snapshot) => (
    Object.prototype.hasOwnProperty.call(snapshot.balances || {}, accountId) ? count + 1 : count
  ), 0);
}

export function countRecordsUsingCategory(data, categoryId) {
  return data.incomeRecords.reduce((count, record) => (
    record.categoryId === categoryId ? count + 1 : count
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
