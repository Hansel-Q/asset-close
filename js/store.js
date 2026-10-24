/**
 * 数据层：本地存储、schema 迁移、校验、备份导入导出、本机自动备份。
 *
 * v1.1 起：
 * - schemaVersion = 2
 * - 删除收入相关字段（旧数据迁移时彻底丢弃）
 * - 每次保存自动保留最近 7 份本机备份
 */

import { APP_VERSION, isRealDate } from './utils.js';

export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = 'assetTracker.data';
export const AUTO_BACKUP_KEY = 'assetTracker.autoBackups';
export const AUTO_BACKUP_LIMIT = 7;

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
    createdAt: now,
    updatedAt: now
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: now,
    settings: {
      theme: 'system',
      autoShareAfterSave: true,
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
    snapshots: []
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashString(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 用于自动备份去重：只比较账户和每日记录，忽略设置与时间戳。 */
export function dataSignature(data) {
  const accounts = Array.isArray(data.accounts)
    ? data.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      kind: account.kind,
      sortOrder: account.sortOrder ?? 0,
      archived: Boolean(account.archived)
    })).sort((a, b) => compareText(String(a.id), String(b.id)))
    : data.accounts;

  const snapshots = Array.isArray(data.snapshots)
    ? data.snapshots.map((snapshot) => ({
      date: snapshot.date,
      note: snapshot.note || '',
      balances: snapshot.balances && typeof snapshot.balances === 'object' && !Array.isArray(snapshot.balances)
        ? Object.fromEntries(Object.entries(snapshot.balances).sort(([a], [b]) => compareText(a, b)))
        : snapshot.balances
    })).sort((a, b) => compareText(String(a.date), String(b.date)))
    : data.snapshots;

  return hashString(JSON.stringify({ accounts, snapshots }));
}

function sanitizeAccount(account) {
  if (!account || typeof account !== 'object') return account;
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    kind: account.kind,
    sortOrder: account.sortOrder,
    archived: Boolean(account.archived),
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return {
    date: snapshot.date,
    balances: snapshot.balances && typeof snapshot.balances === 'object' && !Array.isArray(snapshot.balances)
      ? { ...snapshot.balances }
      : snapshot.balances,
    note: snapshot.note || '',
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt
  };
}

function sanitizeSettings(settings) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  return {
    theme: ['system', 'light', 'dark'].includes(source.theme) ? source.theme : 'system',
    autoShareAfterSave: source.autoShareAfterSave !== false,
    lastExportAt: typeof source.lastExportAt === 'string' ? source.lastExportAt : null,
    backupReminderDismissedAt: typeof source.backupReminderDismissedAt === 'string'
      ? source.backupReminderDismissedAt
      : null,
    onboardingDone: source.onboardingDone === true
  };
}

/**
 * 把 v1 或“自称 v2 但残留旧字段”的数据白名单化成 v2。
 * 收入数据在这里被彻底丢弃，不写入任何隐藏键。
 */
export function migrateData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '数据不是一个有效的对象' };
  }

  const fromVersion = raw.schemaVersion;
  if (fromVersion !== 1 && fromVersion !== 2) {
    return {
      ok: false,
      error: `数据版本不支持（当前 ${SCHEMA_VERSION}，文件 ${fromVersion ?? '未知'}）`,
      fromVersion
    };
  }

  const discardedIncome = Boolean(
    raw.incomeRecords ||
    raw.incomeCategories ||
    raw.settings?.returnMode ||
    raw.settings?.defaultEntryMode ||
    (Array.isArray(raw.accounts) && raw.accounts.some((account) => (
      account && Object.prototype.hasOwnProperty.call(account, 'openingHandled')
    )))
  );

  const data = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    settings: sanitizeSettings(raw.settings),
    accounts: Array.isArray(raw.accounts) ? raw.accounts.map(sanitizeAccount) : raw.accounts,
    snapshots: Array.isArray(raw.snapshots) ? raw.snapshots.map(sanitizeSnapshot) : raw.snapshots
  };

  return {
    ok: true,
    data,
    migrated: fromVersion === 1,
    changed: JSON.stringify(raw) !== JSON.stringify(data),
    discardedIncome,
    fromVersion
  };
}

export function validateData(data) {
  const errors = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['数据不是一个有效的对象'] };
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`数据版本不支持（当前 ${SCHEMA_VERSION}，文件 ${data.schemaVersion ?? '未知'}）`);
  }
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    errors.push('缺少设置');
  }
  if (!Array.isArray(data.accounts)) errors.push('账户列表格式错误');
  if (!Array.isArray(data.snapshots)) errors.push('每日记录格式错误');

  if (errors.length) return { ok: false, errors };

  if (data.settings.autoShareAfterSave != null && typeof data.settings.autoShareAfterSave !== 'boolean') {
    errors.push('“保存后自动分享”设置必须是布尔值');
  }

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

  return { ok: errors.length === 0, errors };
}

/**
 * 读取本地数据。v1 会在内存中迁移成 v2；写回失败时仍可继续使用，
 * 原始数据保持不动，下次启动会重试。
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

  const migration = migrateData(parsed);
  if (!migration.ok) {
    return {
      ok: false,
      error: `本地数据格式不正确：${migration.error}`,
      raw,
      data: parsed
    };
  }

  const validation = validateData(migration.data);
  if (!validation.ok) {
    return {
      ok: false,
      error: `本地数据格式不正确：${validation.errors.slice(0, 3).join('；')}`,
      raw,
      data: migration.data
    };
  }

  let migrationWarning = null;
  if (migration.migrated || migration.changed) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(migration.data));
    } catch (error) {
      migrationWarning = `数据已升级，但写回失败：${error.message}`;
    }
  }

  if (migration.migrated && !migrationWarning) {
    captureAutoBackup(migration.data, storage, { reason: 'migration', force: true });
  }

  return {
    ok: true,
    data: migration.data,
    isNew: false,
    migrated: migration.migrated,
    changed: migration.changed,
    discardedIncome: migration.discardedIncome,
    migrationWarning
  };
}

export function saveData(data, storage = globalThis.localStorage) {
  data.updatedAt = nowIso();
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (error) {
    const quota = error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014;
    return {
      ok: false,
      quota,
      error: `保存失败：${error.message}。请立即导出备份。`
    };
  }
}

/* =========================================================
   本机自动备份
   ========================================================= */

function readAutoBackupStore(storage) {
  try {
    const raw = storage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return { version: 1, entries: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { version: 1, entries: parsed };
    if (parsed && Array.isArray(parsed.entries)) return { version: 1, entries: parsed.entries };
    return { version: 1, entries: [] };
  } catch (error) {
    return { version: 1, entries: [] };
  }
}

/** 读取并过滤坏条目，最新在前。 */
export function readAutoBackups(storage = globalThis.localStorage) {
  return readAutoBackupStore(storage).entries
    .filter((entry) => (
      entry &&
      typeof entry.at === 'string' &&
      entry.data &&
      validateData(entry.data).ok
    ))
    .slice(0, AUTO_BACKUP_LIMIT);
}

function writeAutoBackupStore(entries, storage) {
  const payload = JSON.stringify({
    version: 1,
    entries: entries.slice(0, AUTO_BACKUP_LIMIT)
  });
  try {
    storage.setItem(AUTO_BACKUP_KEY, payload);
    return true;
  } catch (error) {
    try {
      storage.setItem(AUTO_BACKUP_KEY, JSON.stringify({
        version: 1,
        entries: entries.slice(0, 3)
      }));
      return true;
    } catch (retryError) {
      return false;
    }
  }
}

/**
 * 保存一份本机自动备份。只有至少一条每日记录的状态才占备份位；
 * 与最新一份签名相同（仅设置变化）时跳过。
 */
export function captureAutoBackup(data, storage = globalThis.localStorage, {
  reason = 'save',
  force = false
} = {}) {
  if (!data || !Array.isArray(data.snapshots) || data.snapshots.length === 0) return null;

  const signature = dataSignature(data);
  const current = readAutoBackups(storage);
  if (!force && current[0]?.signature === signature) return null;

  const entry = {
    id: `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: nowIso(),
    reason,
    signature,
    data: deepClone(data)
  };
  const next = [entry, ...current].slice(0, AUTO_BACKUP_LIMIT);
  if (!writeAutoBackupStore(next, storage)) return null;
  return entry;
}

export function dropOldestAutoBackup(storage = globalThis.localStorage) {
  const entries = readAutoBackups(storage);
  if (!entries.length) return false;
  entries.pop();
  return writeAutoBackupStore(entries, storage);
}

export function clearAutoBackups(storage = globalThis.localStorage) {
  try {
    storage.removeItem(AUTO_BACKUP_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

/* =========================================================
   Store
   ========================================================= */

export function createStore(storage = globalThis.localStorage) {
  let state = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(state));

  function saveWithQuotaRetry() {
    let result = saveData(state, storage);
    if (!result.ok && result.quota) {
      dropOldestAutoBackup(storage);
      result = saveData(state, storage);
    }
    return result;
  }

  return {
    load() {
      const result = loadData(storage);
      if (result.ok) state = result.data;
      return result;
    },
    get() {
      return state;
    },
    /** 普通保存：先写主数据，再自动留一份本机备份。 */
    set(next) {
      state = next;
      const result = saveWithQuotaRetry();
      if (result.ok) {
        captureAutoBackup(state, storage, { reason: 'save' });
        notify();
      }
      return result;
    },
    /**
     * 用新数据整体替换：先强制备份当前状态（导入/恢复可撤销），
     * 再写入新数据；不自动备份替换后的状态。
     */
    replace(next, { reason = 'before-replace' } = {}) {
      if (state) captureAutoBackup(state, storage, { reason, force: true });
      state = next;
      const result = saveWithQuotaRetry();
      if (result.ok) notify();
      return result;
    },
    /** 清空：先备份清空前的状态，再写入默认数据。 */
    reset() {
      if (state) captureAutoBackup(state, storage, { reason: 'before-reset', force: true });
      state = createDefaultData();
      const result = saveWithQuotaRetry();
      if (result.ok) notify();
      return { ...result, data: state };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

/* =========================================================
   备份文件
   ========================================================= */

export function exportBackup(data) {
  return JSON.stringify({
    format: 'asset-close-backup',
    formatVersion: 2,
    appVersion: APP_VERSION,
    exportedAt: nowIso(),
    data
  }, null, 2);
}

export function backupFilename(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `资产收盘备份-${date}-${time}.json`;
}

export function summarizeData(data) {
  const dates = data.snapshots.map((snapshot) => snapshot.date).sort();
  return {
    accounts: data.accounts.length,
    activeAccounts: data.accounts.filter((account) => !account.archived).length,
    snapshots: data.snapshots.length,
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null
  };
}

/**
 * 解析备份文件。兼容带信封/裸数据、v1/v2；v1 和残留收入字段会被清洗。
 */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: '文件不是有效的 JSON，无法导入。' };
  }

  let raw = parsed;
  if (parsed && parsed.format === 'asset-close-backup') {
    if (!parsed.data) return { ok: false, error: '备份文件缺少数据内容。' };
    raw = parsed.data;
  }

  const migration = migrateData(raw);
  if (!migration.ok) {
    return { ok: false, error: `备份数据格式不正确：${migration.error}` };
  }

  const validation = validateData(migration.data);
  if (!validation.ok) {
    return {
      ok: false,
      error: `备份数据格式不正确：${validation.errors.slice(0, 3).join('；')}`
    };
  }

  return {
    ok: true,
    data: migration.data,
    summary: summarizeData(migration.data),
    migratedFrom: migration.fromVersion,
    discardedIncome: migration.discardedIncome
  };
}
