/**
 * 可点选的 SVG 折线图。不引入任何第三方库，离线也能用。
 * points: [{ date, value, delta, rate, days, hasPrevious, previousDate }]
 * value/delta 都是整数分。
 */

import {
  formatCompactMoney,
  formatDateCN,
  formatDateFull,
  formatMoney,
  formatRate,
  formatSignedMoney,
  moneyClass,
  weekdayCN
} from './utils.js';

let chartSequence = 0;

function detailHtml(point) {
  const dateLabel = `${formatDateFull(point.date)} ${weekdayCN(point.date)}`;
  if (!point.hasPrevious) {
    return `
      <div class="chart-detail__date">${dateLabel}</div>
      <div class="chart-detail__row"><span>总资产</span><strong>${formatMoney(point.value)}</strong></div>
      <div class="chart-detail__meta">基准记录 · 暂无收益</div>`;
  }

  const deltaClass = moneyClass(point.delta);
  const rateText = point.rate == null ? '—' : formatRate(point.rate);
  const days = point.days || 1;
  const label = days > 1 ? `区间收益（${days} 天）` : '日收益';
  const daily = days > 1
    ? ` · 日均约 ${formatSignedMoney(Math.round(point.delta / days))}`
    : '';
  const rateNote = point.rate == null ? '<div class="chart-detail__meta">上期总资产≤0，无法计算收益率</div>' : '';

  return `
    <div class="chart-detail__date">${dateLabel}</div>
    <div class="chart-detail__row"><span>总资产</span><strong>${formatMoney(point.value)}</strong></div>
    <div class="chart-detail__row">
      <span>${label}</span>
      <strong class="${deltaClass}">${formatSignedMoney(point.delta)}</strong>
    </div>
    <div class="chart-detail__row">
      <span>收益率</span>
      <strong class="${deltaClass}">${rateText}</strong>
    </div>
    <div class="chart-detail__meta">较 ${formatDateFull(point.previousDate)} 的记录（${days} 天）${daily}</div>
    ${rateNote}`;
}

export function renderLineChart(container, points, {
  height = 150,
  emptyText = '再记录一天就能看到趋势',
  ariaLabel = '总资产趋势图'
} = {}) {
  if (!container) return;
  container.innerHTML = '';

  if (!points || points.length === 0) {
    container.innerHTML = `<div class="chart-empty">${emptyText}</div>`;
    return;
  }

  if (points.length === 1) {
    const point = points[0];
    container.innerHTML = `
      <div class="chart-empty">
        <strong>${formatMoney(point.value)}</strong>
        <span>${formatDateCN(point.date)} · ${emptyText}</span>
      </div>`;
    return;
  }

  const width = 340;
  const padL = 8;
  const padR = 8;
  const padT = 18;
  const padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const values = points.map((point) => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.01, 100);
    min -= pad;
    max += pad;
  } else {
    const padding = (max - min) * 0.12;
    min -= padding;
    max += padding;
  }

  const xAt = (index) => padL + (index / (points.length - 1)) * innerW;
  const yAt = (value) => padT + (1 - (value - min) / (max - min)) * innerH;

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)},${yAt(point.value).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${xAt(points.length - 1).toFixed(1)},${(height - padB).toFixed(1)} L${xAt(0).toFixed(1)},${(height - padB).toFixed(1)} Z`;

  const gridLines = [0, 0.5, 1].map((ratio) => {
    const y = padT + ratio * innerH;
    const value = max - ratio * (max - min);
    return `
      <line class="chart-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}"/>
      <text class="chart-label" x="${padL}" y="${(y - 4).toFixed(1)}">${formatCompactMoney(value)}</text>`;
  }).join('');

  const showDots = points.length <= 60;
  const dots = showDots
    ? points.map((point, index) => `
      <circle class="chart-point" cx="${xAt(index).toFixed(1)}" cy="${yAt(point.value).toFixed(1)}" r="2.2"/>
    `).join('')
    : '';

  const first = points[0];
  const last = points[points.length - 1];
  const gradientId = `chart-grad-${++chartSequence}`;
  const accessible = `${ariaLabel}，共 ${points.length} 条记录。点击曲线或按左右方向键查看某天的收益。`;

  container.innerHTML = `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="group" tabindex="0" aria-label="${accessible}">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.20"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${areaPath}" fill="url(#${gradientId})"/>
      <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      <line class="chart-guide" x1="0" y1="${padT}" x2="0" y2="${height - padB}"/>
      <circle class="chart-point chart-point--selected" cx="0" cy="0" r="4.5"/>
      <text class="chart-label" x="${padL}" y="${height - 6}">${formatDateCN(first.date)}</text>
      <text class="chart-label" x="${width - padR}" y="${height - 6}" text-anchor="end">${formatDateCN(last.date)}</text>
      <rect class="chart-hit" x="0" y="0" width="${width}" height="${height}" fill="transparent"/>
    </svg>
    <div class="chart-hint">点击曲线上的点，查看当天收益</div>
    <div class="chart-detail" role="status" aria-live="polite"></div>`;

  const svg = container.querySelector('svg.chart');
  const guide = container.querySelector('.chart-guide');
  const selectedDot = container.querySelector('.chart-point--selected');
  const detail = container.querySelector('.chart-detail');

  if (!svg || !guide || !selectedDot || !detail) return;

  let selectedIndex = points.length - 1;

  function select(index) {
    const next = Math.max(0, Math.min(points.length - 1, index));
    selectedIndex = next;
    const point = points[next];
    const x = xAt(next);
    const y = yAt(point.value);
    guide.setAttribute('x1', x.toFixed(1));
    guide.setAttribute('x2', x.toFixed(1));
    selectedDot.setAttribute('cx', x.toFixed(1));
    selectedDot.setAttribute('cy', y.toFixed(1));
    detail.innerHTML = detailHtml(point);
  }

  function nearestIndex(clientX) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return selectedIndex;
    const xView = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const distance = Math.abs(xAt(i) - xView);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  svg.addEventListener('click', (event) => {
    select(nearestIndex(event.clientX));
  });

  svg.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      select(selectedIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      select(selectedIndex + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      select(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      select(points.length - 1);
    }
  });

  select(selectedIndex);
}
