import {
  accountsInSnapshot,
  buildChartPoints,
  calculatePeriod,
  historyRows,
  snapshotBreakdown,
  snapshotMonthlyGroups,
  sortedSnapshots
} from '../calc.js';
import { renderLineChart } from '../chart.js';
import {
  addDays,
  confirmDialog,
  escapeHtml,
  firstChar,
  formatDateCN,
  formatDateFull,
  formatMoney,
  formatRate,
  formatSignedMoney,
  kindColor,
  kindLabel,
  moneyClass,
  openModal,
  toast,
  todayStr,
  weekdayCN
} from '../utils.js';
import { resetDraft } from './record.js';

let range = 30;

function rangeLabel() {
  return range === 'all' ? '全部记录' : `最近 ${range} 天`;
}

function openDetail(ctx, date) {
  const data = ctx.data;
  const snapshot = data.snapshots.find((item) => item.date === date);
  if (!snapshot) return;

  const period = calculatePeriod(data, snapshot);
  const breakdown = snapshotBreakdown(snapshot, data.accounts);
  const balances = accountsInSnapshot(snapshot, data);

  const balanceRows = balances.map(({ account, cents }) => {
    const isLiability = account.type === 'liability';
    const signed = isLiability ? -Math.abs(cents) : cents;
    const kindText = kindLabel(account.kind) === account.name ? '' : kindLabel(account.kind);
    const metaText = [kindText, account.archived ? '已归档' : ''].filter(Boolean).join(' · ');
    return `
      <div class="list-row list-row--static">
        <span class="list-row__main">
          <span class="list-row__title">
            <span class="acct-dot" style="background:${kindColor(account.kind)}">${escapeHtml(firstChar(account.name))}</span>
            ${escapeHtml(account.name)}
            ${isLiability ? '<span class="badge badge--liability">负债</span>' : ''}
          </span>
          ${metaText ? `<span class="list-row__meta">${metaText}</span>` : ''}
        </span>
        <span class="list-row__value">
          <strong class="${signed < 0 ? 'money-debt' : ''}">${formatMoney(signed)}</strong>
        </span>
      </div>`;
  }).join('');

  let periodHtml;
  if (!period?.hasPrevious) {
    periodHtml = `
      <div class="banner banner--info">
        <div class="banner__body">这是第一条基准记录，收益从下一条记录开始计算。</div>
      </div>`;
  } else {
    const { rawDelta, rawRate, days, dailyAvgRaw, previous, previousBreakdown } = period;
    const deltaClass = moneyClass(rawDelta);
    const rateNote = previousBreakdown.net <= 0
      ? '<p class="tiny">上期总资产小于等于 0，无法计算收益率。</p>'
      : '';
    const dailyNote = days > 1
      ? `<p class="tiny">日均约 ${formatSignedMoney(dailyAvgRaw)} / 天，简单平均，不是复利。</p>`
      : '';

    periodHtml = `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-card__label">收益</div>
          <div class="summary-card__value ${deltaClass}">${formatSignedMoney(rawDelta)}</div>
          <div class="summary-card__sub ${deltaClass}">${formatRate(rawRate)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-card__label">区间</div>
          <div class="summary-card__value" style="font-size:16px">${days} 天</div>
          <div class="summary-card__sub">较 ${formatDateFull(previous.date)}</div>
        </div>
      </div>
      ${rateNote}
      ${dailyNote}`;
  }

  const noteHtml = snapshot.note
    ? `<div class="card card--tight"><span class="tiny">备注</span><p style="margin:4px 0 0;white-space:pre-wrap">${escapeHtml(snapshot.note)}</p></div>`
    : '';

  const body = `
    <div class="stack">
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-card__label">总资产</div>
          <div class="summary-card__value">${formatMoney(breakdown.net)}</div>
          <div class="summary-card__sub">资产 ${formatMoney(breakdown.assets)} · 负债 ${formatMoney(breakdown.liabilities)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-card__label">记录日期</div>
          <div class="summary-card__value" style="font-size:16px">${formatDateCN(snapshot.date)}</div>
          <div class="summary-card__sub">${weekdayCN(snapshot.date)}</div>
        </div>
      </div>

      ${periodHtml}

      <div class="section">
        <h3 class="section-title">账户余额</h3>
        <div class="list">${balanceRows || '<div class="empty">没有账户数据</div>'}</div>
      </div>

      ${noteHtml}

      <div class="modal__actions">
        <button type="button" class="btn btn--danger-ghost" data-delete>删除记录</button>
        <button type="button" class="btn btn--ghost" data-close>关闭</button>
        <button type="button" class="btn btn--primary" data-edit>编辑这天</button>
      </div>
    </div>`;

  openModal({
    title: `${formatDateFull(snapshot.date)} ${weekdayCN(snapshot.date)}`,
    body,
    onMount(dialog, close) {
      dialog.querySelector('[data-edit]')?.addEventListener('click', () => {
        close();
        ctx.navigate(`#/record/${snapshot.date}`);
      });

      dialog.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const proceed = await confirmDialog({
          title: '删除这一天的记录？',
          message: '只删除这一天的余额记录。删除后收益会按剩下的记录重新计算。',
          confirmText: '删除',
          danger: true
        });
        if (!proceed) return;

        data.snapshots = data.snapshots.filter((item) => item.date !== snapshot.date);
        const result = ctx.store.set(data);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }

        resetDraft();
        close();
        toast('已删除这一天的记录', 'success');
        ctx.rerender();
      });
    }
  });
}

export function render(container, ctx) {
  const data = ctx.data;
  const rows = historyRows(data);
  const periodByDate = new Map(rows.map((row) => [row.snapshot.date, row.period]));

  if (!data.snapshots.length) {
    container.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div>
            <h1 class="page-title">历史</h1>
            <p class="page-sub">所有收盘记录和收益趋势</p>
          </div>
        </div>
        <section class="card empty">
          <div class="empty__mark">¥</div>
          <p>还没有历史记录。</p>
          <p class="tiny">先记录今天的余额，明天开始就能看到趋势。</p>
          <button type="button" class="btn btn--primary" data-go-record>去记录今天</button>
        </section>
      </div>`;
    container.querySelector('[data-go-record]')?.addEventListener('click', () => ctx.navigate('#/record'));
    return;
  }

  const cutoff = range === 'all' ? null : addDays(todayStr(), -Number(range));
  const chartSnapshots = sortedSnapshots(data, true).filter((snapshot) => (
    cutoff ? snapshot.date >= cutoff : true
  ));
  const chartPoints = buildChartPoints(data, chartSnapshots);

  const monthlyGroups = snapshotMonthlyGroups(data);
  const groupsHtml = monthlyGroups.map((group) => {
    const groupRows = group.snapshots.map((snapshot) => {
      const period = periodByDate.get(snapshot.date);
      const breakdown = snapshotBreakdown(snapshot, data.accounts);
      const delta = period?.hasPrevious ? period.rawDelta : null;
      const rate = period?.hasPrevious ? period.rawRate : null;
      const deltaClass = delta == null ? 'money-flat' : moneyClass(delta);
      const rateClass = rate == null ? 'money-flat' : moneyClass(delta);
      return `
        <button type="button" class="list-row" data-open-date="${snapshot.date}">
          <span class="list-row__main">
            <span class="list-row__title">
              ${formatDateCN(snapshot.date)}
              <span class="badge">${weekdayCN(snapshot.date)}</span>
            </span>
            <span class="list-row__meta">总资产 ${formatMoney(breakdown.net)}</span>
          </span>
          <span class="list-row__value">
            <strong class="${deltaClass}">
              ${delta == null ? '基准记录' : formatSignedMoney(delta)}
            </strong>
            <span class="${rateClass}">${rate == null ? (delta == null ? '—' : '收益率 —') : formatRate(rate)}</span>
          </span>
        </button>`;
    }).join('');

    return `
      <div class="month-head">
        <span>${group.month.slice(0, 4)}年${Number(group.month.slice(5, 7))}月</span>
        <span>${group.snapshots.length} 条</span>
      </div>
      ${groupRows}`;
  }).join('');

  container.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">历史</h1>
          <p class="page-sub">所有收盘记录和收益趋势</p>
        </div>
      </div>

      <div class="segmented" role="group" aria-label="时间范围">
        <button type="button" data-range="30" class="${range === 30 ? 'is-active' : ''}">30 天</button>
        <button type="button" data-range="90" class="${range === 90 ? 'is-active' : ''}">90 天</button>
        <button type="button" data-range="all" class="${range === 'all' ? 'is-active' : ''}">全部</button>
      </div>

      <section class="card chart-card">
        <div class="chart-head">
          <span class="chart-title">总资产趋势</span>
          <span class="tiny">${rangeLabel()} · ${chartSnapshots.length} 次记录</span>
        </div>
        <div id="history-chart"></div>
      </section>

      <section class="card">
        <div class="section-head">
          <h2 class="section-title">每日记录</h2>
          <span class="tiny">点击查看详情</span>
        </div>
        ${groupsHtml}
      </section>
    </div>`;

  renderLineChart(container.querySelector('#history-chart'), chartPoints, {
    emptyText: range === 'all' ? '记录更多天数后就能看到趋势' : `最近 ${range} 天还没有足够的数据`,
    ariaLabel: '历史总资产趋势'
  });

  container.querySelectorAll('[data-range]').forEach((button) => {
    button.addEventListener('click', () => {
      range = button.dataset.range === 'all' ? 'all' : Number(button.dataset.range);
      ctx.rerender({ keepScroll: true });
    });
  });

  container.querySelectorAll('[data-open-date]').forEach((button) => {
    button.addEventListener('click', () => openDetail(ctx, button.dataset.openDate));
  });
}
