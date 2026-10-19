/**
 * 数据层：本地存储、初始数据、校验、备份导入导出。
 *
 * 设计原则：
 * - 只用一个 localStorage 键，整体读写，避免多键不一致。
 * - 所有金额用整数“分”，绝不存小数。
 * - 日期用本地 YYYY-MM-DD；创建/更新时间用 ISO 字符串。
 */

import { isRealDate } from './utils.js';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'assetTracker.data';
export const THEME_KEY = 'assetTracker.theme';

export function nowIso() {
  return new Date().toISOString();
}

export function createDefaultData() {
  const now = nowIso();
  const account = (id, name, kind, sortOrder) => ({
    id,
    name,
    type: 'asset',
    kind,
    sortOrder,
    archived: false,
    openingHandled: true,
    createdAt: now,
    updatedAt: now
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: now,
    settings: {
      theme: 'system',
      defaultEntryMode: 'balance',
      returnMode: 'adjusted',
      lastExportAt: null,
      backupReminderDismissedAt: null,
      onboardingDone: false
    },
    accounts: [
      account('acct-alipay', '支付宝', 'alipay', 10),
      account('acct-wechat', '微信', 'wechat', 20),
      account('acct-bank', '银行卡', 'bank', 30),
      account('acct-broker', '同花顺证券', 'broker', 40),
      account('acct-cash', '现金', 'cash', 50)
    ],
    incomeCategories: [
      { id: 'salary', name: '工资', kind: 'income', direction: 'in', builtin: true, archived: false, sortOrder: 10 },
      { id: 'parttime', name: '打工/兼职', kind: 'income', direction: 'in', builtin: true, archived: false, sortOrder: 20 },
      { id: 'bonus', name: '奖金', kind: 'income', direction: 'in', builtin: true, archived: false, sortOrder: 30 },
      { id: 'other_income', name: '其他收入', kind: 'income', direction: 'in', builtin: true, archived: false, sortOrder: 40 },
      { id: 'external_in', name: '外部转入', kind: 'external', direction: 'in', builtin: true, archived: false, sortOrder: 50 },
      { id: 'external_out', name: '外部转出', kind: 'external', direction: 'out', builtin: true, archived: false, sortOrder: 60 }
    ],
    snapshots: [],
    incomeRecords: []
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export function validateData(data) {
  const errors = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['数据不是一个有效的对象'] };
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`数据版本不支持（当前 ${SCHEMA_VERSION}，文件 ${data.schemaVersion ?? '未知'}）`);
  }
  if (!data.settings || typeof data.settings !== 'object') errors.push('缺少设置');
  if (!Array.isArray(data.accounts)) errors.push('账户列表格式错误');
  if (!Array.isArray(data.incomeCategories)) errors.push('收入分类格式错误');
  if (!Array.isArray(data.snapshots)) errors.push('每日记录格式错误');
  if (!Array.isArray(data.incomeRecords)) errors.push('收入记录格式错误');

  if (errors.length) return { ok: false, errors };

  const accountIds = new Set();
  for (const account of data.accounts) {
    if (!account || typeof account !== 'object') {
      errors.push('存在无效账户');
      continue;
    }
    if (!account.id || !account.name) errors.push('账户缺少 ID 或名称');
    if (account.id && !ID_RE.test(account.id)) errors.push(`账户 ID 含非法字符：${account.id}`);
    if (!['asset', 'liability'].includes(account.type)) {
      errors.push(`账户类型错误：${account.name || account.id}`);
    }
    if (account.id) {
      if (accountIds.has(account.id)) errors.push(`账户 ID 重复：${account.id}`);
      accountIds.add(account.id);
    }
  }

  const seenDates = new Set();
  for (const snapshot of data.snapshots) {
    if (!snapshot || typeof snapshot !== 'object') {
      errors.push('存在无效的每日记录');
      continue;
    }
    if (!DATE_RE.test(snapshot.date || '') || !isRealDate(snapshot.date)) {
      errors.push(`每日记录日期格式错误：${snapshot.date}`);
    }
    if (seenDates.has(snapshot.date)) {
      errors.push(`同一天有多条记录：${snapshot.date}`);
    }
    seenDates.add(snapshot.date);

    if (!snapshot.balances || typeof snapshot.balances !== 'object' || Array.isArray(snapshot.balances)) {
      errors.push(`每日记录余额格式错误：${snapshot.date}`);
      continue;
    }
    for (const [accountId, cents] of Object.entries(snapshot.balances)) {
      if (!ID_RE.test(accountId) || !accountIds.has(accountId)) {
        errors.push(`每日记录引用了不存在的账户：${snapshot.date} / ${accountId}`);
      }
      if (!Number.isSafeInteger(cents)) {
        errors.push(`金额必须是整数分：${snapshot.date} / ${accountId}`);
      }
    }
  }

  const categoryIds = new Set();
  for (const category of data.incomeCategories) {
    if (!category || typeof category !== 'object') {
      errors.push('存在无效的收入分类');
      continue;
    }
    if (!category.id || !category.name) errors.push('收入分类缺少 ID 或名称');
    if (category.id && !ID_RE.test(category.id)) {
      errors.push(`收入分类 ID 含非法字符：${category.id}`);
    }
    if (!['in', 'out'].includes(category.direction)) {
      errors.push(`收入分类方向错误：${category.name || category.id}`);
    }
    if (!['income', 'external'].includes(category.kind)) {
      errors.push(`收入分类类型错误：${category.name || category.id}`);
    }
    if (category.id) {
      if (categoryIds.has(category.id)) errors.push(`收入分类 ID 重复：${category.id}`);
      categoryIds.add(category.id);
    }
  }

  const recordIds = new Set();
  for (const record of data.incomeRecords) {
    if (!record || typeof record !== 'object') {
      errors.push('存在无效的收入记录');
      continue;
    }
    if (!record.id) errors.push('收入记录缺少 ID');
    if (record.id && !ID_RE.test(record.id)) errors.push(`收入记录 ID 含非法字符：${record.id}`);
    if (record.id) {
      if (recordIds.has(record.id)) errors.push(`收入记录 ID 重复：${record.id}`);
      recordIds.add(record.id);
    }
    if (!DATE_RE.test(record.date || '') || !isRealDate(record.date)) {
      errors.push(`收入日期格式错误：${record.date}`);
    }
    if (!categoryIds.has(record.categoryId)) errors.push(`收入分类不存在：${record.categoryId}`);
    if (!Number.isSafeInteger(record.amountCents) || record.amountCents < 0) {
      errors.push('收入金额必须是非负整数分');
    }
    if (record.countsAsAsset != null && typeof record.countsAsAsset !== 'boolean') {
      errors.push('“是否计入资产”必须是布尔值');
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 读取本地数据。解析失败时不覆盖原始数据，把 raw 一并返回，
 * 让界面可以提示用户先导出原始内容。
 */
export function loadData(storage = globalThis.localStorage) {
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    return { ok: false, error: `无法读取本地存储：${error.message}`, raw: null };
  }

  if (!raw) {
    const data = createDefaultData();
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      return { ok: false, error: `无法写入本地存储：${error.message}`, raw: null };
    }
    return { ok: true, data, isNew: true };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: '本地数据不是有效的 JSON。为防止覆盖，应用已停止读写。请先导出原始数据。',
      raw
    };
  }

  const validation = validateData(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      error: `本地数据格式不正确：${validation.errors.slice(0, 3).join('；')}`,
      raw,
      data: parsed
    };
  }

  return { ok: true, data: parsed, isNew: false };
}

export function saveData(data, storage = globalThis.localStorage) {
  data.updatedAt = nowIso();
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `保存失败：${error.message}。请立即导出备份。` };
  }
}

export function createStore(storage = globalThis.localStorage) {
  let state = null;
  const listeners = new Set();

  return {
    load() {
      const result = loadData(storage);
      if (result.ok) state = result.data;
      return result;
    },
    get() {
      return state;
    },
    set(next) {
      state = next;
      const result = saveData(state, storage);
      if (result.ok) listeners.forEach((fn) => fn(state));
      return result;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reset() {
      state = createDefaultData();
      const result = saveData(state, storage);
      if (result.ok) listeners.forEach((fn) => fn(state));
      return { ...result, data: state };
    }
  };
}

/** 导出的备份带一层信封，方便以后识别与升级。 */
export function exportBackup(data) {
  return JSON.stringify({
    format: 'asset-close-backup',
    formatVersion: 1,
    appVersion: '1.0.0',
    exportedAt: nowIso(),
    data
  }, null, 2);
}

export function backupFilename(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `资产收盘备份-${date}-${time}.json`;
}

export function summarizeData(data) {
  const dates = data.snapshots.map((snapshot) => snapshot.date).sort();
  return {
    accounts: data.accounts.length,
    activeAccounts: data.accounts.filter((account) => !account.archived).length,
    snapshots: data.snapshots.length,
    incomes: data.incomeRecords.length,
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null
  };
}

/**
 * 解析备份文件。兼容两种格式：
 * 1. 带 format/exportedAt 信封的备份；
 * 2. 直接是根数据对象。
 */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: '文件不是有效的 JSON，无法导入。' };
  }

  let data = parsed;
  if (parsed && parsed.format === 'asset-close-backup') {
    if (!parsed.data) return { ok: false, error: '备份文件缺少数据内容。' };
    data = parsed.data;
  }

  const validation = validateData(data);
  if (!validation.ok) {
    return {
      ok: false,
      error: `备份数据格式不正确：${validation.errors.slice(0, 3).join('；')}`
    };
  }

  return { ok: true, data, summary: summarizeData(data) };
}
