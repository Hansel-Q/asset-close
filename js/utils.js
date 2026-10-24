/**
 * 通用工具：日期、金额、格式化、弹窗、提示。
 * 这里不依赖任何第三方库，全部用浏览器自带能力。
 */

export const APP_VERSION = '1.1.0';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 生成唯一 ID；浏览器不支持 randomUUID 时退回时间戳 + 随机数。 */
export function uid() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) { /* ignore */ }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 本地日期 YYYY-MM-DD，绝不使用 toISOString（会因 UTC 跨天错一天）。 */
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 把 YYYY-MM-DD 解析成本地中午，避免夏令时/时区边界。 */
export function parseDateLocal(str) {
  const [y, m, d] = String(str || '').split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function daysBetween(a, b) {
  const ms = parseDateLocal(b).getTime() - parseDateLocal(a).getTime();
  return Math.round(ms / 86400000);
}

/** 检查 YYYY-MM-DD 是否是真实存在的日期（排除 2026-02-31 这类）。 */
export function isRealDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(str || ''))) return false;
  const [year, month, day] = String(str).split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
}

export function addDays(dateStr, n) {
  const d = parseDateLocal(dateStr);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

export function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

export function formatDateCN(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-');
  if (!y || !m || !d) return dateStr || '';
  return `${Number(m)}月${Number(d)}日`;
}

export function formatDateFull(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-');
  if (!y || !m || !d) return dateStr || '';
  return `${y}年${Number(m)}月${Number(d)}日`;
}

export function weekdayCN(dateStr) {
  return WEEKDAYS[parseDateLocal(dateStr).getDay()] || '';
}

export function dayLabel(dateStr) {
  const today = todayStr();
  if (dateStr === today) return '今天';
  if (dateStr === addDays(today, -1)) return '昨天';
  return formatDateCN(dateStr);
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 把用户输入的“元”转成整数“分”。
 * 兼容 ¥、千分位逗号、中文逗号、全角句号、全角减号。
 * 返回 null 表示格式不合法。
 */
export function parseYuanToCents(input) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s
    .replace(/[¥￥\s]/g, '')
    .replace(/[，,]/g, '')
    .replace(/[．。]/g, '.')
    .replace(/[−–—]/g, '-')
    .replace(/＋/g, '+');

  if (s === '' || s === '-' || s === '+') return null;
  if (!/^[+-]?(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;

  const negative = s.startsWith('-');
  if (s.startsWith('-') || s.startsWith('+')) s = s.slice(1);

  let [intPart, frac = ''] = s.split('.');
  intPart = intPart || '0';
  frac = (frac + '00').slice(0, 2);

  const yuan = Number(intPart);
  const cents = Number(frac);
  if (!Number.isSafeInteger(yuan) || !Number.isSafeInteger(cents)) return null;

  const total = yuan * 100 + cents;
  if (!Number.isSafeInteger(total)) return null;
  return negative ? -total : total;
}

/** 把整数“分”转成输入框里的文本（不带 ¥ 和千分位）。 */
export function centsToInput(cents) {
  if (cents == null || cents === '') return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  const yuan = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${yuan}${frac ? `.${pad2(frac)}` : ''}`;
}

function groupThousands(intStr) {
  return String(intStr).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 显示金额，默认 ¥1,234.56；sign=true 时正数显示 +。 */
export function formatMoney(cents, { sign = false, decimals = 2, symbol = true } = {}) {
  const n = Number(cents) || 0;
  const abs = Math.abs(Math.round(n));
  const yuan = Math.floor(abs / 100);
  let str;
  if (decimals === 0) {
    str = groupThousands(yuan);
  } else {
    str = `${groupThousands(yuan)}.${pad2(abs % 100)}`;
  }
  const prefix = n < 0 ? '-' : (sign && n > 0 ? '+' : '');
  return `${prefix}${symbol ? '¥' : ''}${str}`;
}

export function formatSignedMoney(cents) {
  return formatMoney(cents, { sign: true });
}

/** 收益/收益率的颜色类：A 股习惯红涨绿跌。 */
export function moneyClass(value) {
  if (value > 0) return 'money-up';
  if (value < 0) return 'money-down';
  return 'money-flat';
}

/** 图表坐标轴用的紧凑金额：¥1.2万、¥3.4亿。 */
export function formatCompactMoney(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n) / 100;
  if (abs >= 1e8) return `${sign}¥${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}¥${(abs / 1e4).toFixed(1)}万`;
  return `${sign}¥${Math.round(abs).toLocaleString('zh-CN')}`;
}

/** 收益率直接传小数（0.0123 表示 1.23%）。 */
export function formatRate(rate) {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const pct = rate * 100;
  const sign = pct > 0 ? '+' : (pct < 0 ? '-' : '');
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function formatPercentFromCents(deltaCents, baseCents) {
  if (!baseCents || baseCents <= 0) return null;
  return deltaCents / baseCents;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

export function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function debounce(fn, ms = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** 触发浏览器下载；iOS 上会进入“文件”App 或分享面板。 */
export function downloadText(filename, text, mime = 'application/json;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

let toastTimer = null;

export function toast(message, type = 'info') {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  const safeType = ['info', 'success', 'error', 'warning'].includes(type) ? type : 'info';
  root.innerHTML = `<div class="toast toast--${safeType}" role="status" aria-live="polite">${escapeHtml(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, 3000);
}

/**
 * 通用弹窗。body 是已经拼好的 HTML（调用方负责转义用户输入）。
 * onMount 里绑定按钮事件。
 */
export function openModal({ title = '', body = '', className = '', onMount } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = `modal ${className}`.trim();
  dialog.innerHTML = `
    <div class="modal__card">
      <div class="modal__head">
        <h2 class="modal__title">${escapeHtml(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal__body">${body}</div>
    </div>`;
  document.body.appendChild(dialog);

  const close = () => {
    if (dialog.open) dialog.close();
    else dialog.remove();
  };

  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
    if (event.target.closest?.('[data-close]')) dialog.close();
  });

  dialog.showModal();
  onMount?.(dialog, close);
  return { dialog, close };
}

export function confirmDialog({
  title = '确认',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm = null
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.innerHTML = `
      <div class="modal__card">
        <h2 class="modal__title">${escapeHtml(title)}</h2>
        <p class="modal__message">${escapeHtml(message)}</p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" data-action="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);

    dialog.addEventListener('close', () => {
      dialog.remove();
      done(false);
    });
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      done(true);
      dialog.close();
      // 关键：onConfirm 在用户点击的同一个同步调用栈里执行，
      // 让随后的 navigator.share() 仍持有 transient activation。
      onConfirm?.();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    dialog.showModal();
  });
}

export function kindColor(kind) {
  const map = {
    alipay: '#1677ff',
    wechat: '#07c160',
    bank: '#f59e0b',
    broker: '#ef4444',
    cash: '#10b981',
    credit: '#8b5cf6',
    loan: '#f97316',
    other: '#64748b'
  };
  return map[kind] || map.other;
}

export function kindLabel(kind) {
  const map = {
    alipay: '支付宝',
    wechat: '微信',
    bank: '银行卡',
    broker: '证券账户',
    cash: '现金',
    credit: '信用卡/花呗',
    loan: '借款',
    other: '其他'
  };
  return map[kind] || map.other;
}

export function firstChar(name) {
  return Array.from(String(name || '?'))[0] || '?';
}

/** 判断是否从主屏幕图标启动（iOS 与其他浏览器的兼容写法）。 */
export function isStandalone() {
  return Boolean(globalThis.navigator?.standalone) ||
    globalThis.matchMedia?.('(display-mode: standalone)')?.matches === true;
}

export function isIOS() {
  const nav = globalThis.navigator;
  if (!nav) return false;
  const ua = nav.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ 默认伪装成 Mac，用触摸点数量辅助判断。
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1;
}
