/**
 * 极简 SVG 折线图。不引入任何第三方库，离线也能用。
 * points: [{ date: 'YYYY-MM-DD', value: 整数分 }]
 */

import { formatCompactMoney, formatDateCN, formatMoney } from './utils.js';

let chartSequence = 0;

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
    container.innerHTML = `
      <div class="chart-empty">
        <strong>${formatMoney(points[0].value)}</strong>
        <span>${formatDateCN(points[0].date)} · ${emptyText}</span>
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

  const first = points[0];
  const last = points[points.length - 1];
  const lastX = xAt(points.length - 1);
  const lastY = yAt(last.value);
  const gradientId = `chart-grad-${++chartSequence}`;

  const accessible = `${ariaLabel}，从 ${formatDateCN(first.date)} 的 ${formatMoney(first.value)} 到 ${formatDateCN(last.date)} 的 ${formatMoney(last.value)}`;

  container.innerHTML = `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${accessible}">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.20"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${areaPath}" fill="url(#${gradientId})"/>
      <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"/>
      <text class="chart-label" x="${padL}" y="${height - 6}">${formatDateCN(first.date)}</text>
      <text class="chart-label" x="${width - padR}" y="${height - 6}" text-anchor="end">${formatDateCN(last.date)}</text>
    </svg>`;
}
