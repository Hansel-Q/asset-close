import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseYuanToCents,
  centsToInput,
  formatMoney,
  formatSignedMoney,
  formatRate,
  formatCompactMoney,
  formatDateCN,
  formatDateFull,
  weekdayCN,
  isRealDate,
  addDays,
  daysBetween,
  monthOf,
  moneyClass
} from '../js/utils.js';

test('金额输入解析：普通、千分位、全角、负数、小数', () => {
  assert.equal(parseYuanToCents('10000'), 1_000_000);
  assert.equal(parseYuanToCents('1,234.56'), 123_456);
  assert.equal(parseYuanToCents('￥1，234．5'), 123_450);
  assert.equal(parseYuanToCents('-12.34'), -1_234);
  assert.equal(parseYuanToCents('−12.34'), -1_234);
  assert.equal(parseYuanToCents('.5'), 50);
  assert.equal(parseYuanToCents('1.'), 100);
  assert.equal(parseYuanToCents('0'), 0);
});

test('金额输入解析：非法格式返回 null', () => {
  assert.equal(parseYuanToCents('1.234'), null);
  assert.equal(parseYuanToCents('abc'), null);
  assert.equal(parseYuanToCents(''), null);
  assert.equal(parseYuanToCents('-'), null);
  assert.equal(parseYuanToCents(null), null);
});

test('金额回填输入框', () => {
  assert.equal(centsToInput(1_000_000), '10000');
  assert.equal(centsToInput(123_456), '1234.56');
  assert.equal(centsToInput(-1_234), '-12.34');
  assert.equal(centsToInput(0), '0');
  assert.equal(centsToInput(null), '');
});

test('金额显示格式', () => {
  assert.equal(formatMoney(123_456), '¥1,234.56');
  assert.equal(formatMoney(-123_456), '-¥1,234.56');
  assert.equal(formatMoney(123_456, { sign: true }), '+¥1,234.56');
  assert.equal(formatMoney(0, { sign: true }), '¥0.00');
  assert.equal(formatSignedMoney(-50), '-¥0.50');
});

test('收益率显示', () => {
  assert.equal(formatRate(0.0211), '+2.11%');
  assert.equal(formatRate(-0.001), '-0.10%');
  assert.equal(formatRate(0), '0.00%');
  assert.equal(formatRate(null), '—');
});

test('紧凑金额显示', () => {
  assert.equal(formatCompactMoney(100_000_000), '¥100.0万');
  assert.equal(formatCompactMoney(12_345), '¥123');
  assert.equal(formatCompactMoney(-100_000_000), '-¥100.0万');
});

test('真实日期校验', () => {
  assert.equal(isRealDate('2026-10-19'), true);
  assert.equal(isRealDate('2024-02-29'), true);
  assert.equal(isRealDate('2026-02-29'), false);
  assert.equal(isRealDate('2026-02-30'), false);
  assert.equal(isRealDate('2026-13-01'), false);
  assert.equal(isRealDate('2026-1-1'), false);
  assert.equal(isRealDate(''), false);
});

test('日期加减与天数', () => {
  assert.equal(addDays('2026-10-19', -1), '2026-10-18');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-10-16', '2026-10-19'), 3);
  assert.equal(monthOf('2026-10-19'), '2026-10');
});

test('中文日期显示', () => {
  assert.equal(formatDateCN('2026-10-19'), '10月19日');
  assert.equal(formatDateFull('2026-10-19'), '2026年10月19日');
  assert.equal(weekdayCN('2026-10-19'), '周一');
});

test('涨跌颜色类（红涨绿跌）', () => {
  assert.equal(moneyClass(1), 'money-up');
  assert.equal(moneyClass(-1), 'money-down');
  assert.equal(moneyClass(0), 'money-flat');
});
