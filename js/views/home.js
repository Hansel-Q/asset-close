import {
  calculatePeriod,
  currentView,
  snapshotBreakdown,
  sortedSnapshots
} from '../calc.js';
import {
  dayLabel,
  formatDateTime,
  formatDateFull,
  formatMoney,
  formatRate,
  formatSignedMoney,
  weekdayCN
} from '../utils.js';
import { renderLineChart } from '../chart.js';

const TWO_WEEKS = 14 * 86400000;
const REMIND_LATER = 3 * 86400000;

function moneyClass(value) {
  if (value > 0) return 'money-up';
  if (value < 0) return 'money-down';
  return 'money-flat';
}

function shouldShowBackupBanner(data) {
  if (!data.snapshots.length) return false;
  const last = data.settings.lastExportAt ? new Date(data.settings.lastExportAt).getTime() : 0;
  const overdue = !last || (Date.now() - last > TWO_WEEKS);
  const dismissed = data.settings.backupReminderDismissedAt
    ? new Date(data.settings.backupReminderDismissedAt).getTime()
    : 0;
  const recentlyDismissed = dismissed && (Date.now() - dismissed < REMIND_LATER);
  return overdue && !recentlyDismissed;
}

function backupText(data) {
  if (!data.settings.lastExportAt) return '还没有导出过备份。';
  return `上次导出：${formatDateTime(data.settings.lastExportAt)}。`;
}

function renderWelcome(container, ctx) {
  const data = ctx.data;
  const active = data.accounts.filter((account) => !account.archived);

  container.innerHTML = `
    <div class="page">
      <section class="card welcome">
        <div class="welcome__mark">¥</div>
        <h1>资产收盘</h1>
        <p>每天记一次各账户余额，自动算总资产、日收益和收益率。</p>
        <ol class="steps">
          <li>确认账户（支付宝、微信、银行卡、同花顺证券、现金）</li>
          <li>填入今天的余额，建立第一条基准记录</li>
          <li>明天再记一次，开始看收益和收益率</li>
        </ol>
        <div class="welcome__actions">
          ${
            active.length
              ? '<button type="button" class="btn btn--primary btn--block" data-go-record>开始记录今天</button>'
              : '<button type="button" class="btn btn--primary btn--block" data-go-settings>先去添加账户</button>'
          }
          <button type="button" class="btn btn--ghost btn--block" data-go-settings>管理账户</button>
        </div>
        <p class="tiny" style="margin-top:16px">数据只保存在这台设备上，不会上传到任何服务器。<br>建议每周导出一次备份。</p>
      </section>
    </div>`;

  container.querySelector('[data-go-record]')?.addEventListener('click', () => ctx.navigate('#/record'));
  container.querySelectorAll('[data-go-settings]').forEach((button) => {
    button.addEventListener('click', () => ctx.navigate('#/settings'));
  });
}

export function render(container, ctx) {
  const data = ctx.data;
  const view = currentView(data);

  if (!view.latest) {
    renderWelcome(container, ctx);
    return;
  }

  const { latest, period, isTodayRecorded, daysSinceLatest } = view;
  const mode = data.settings.returnMode === 'raw' ? 'raw' : 'adjusted';
  const breakdown = snapshotBreakdown(latest, data.accounts);

  const hasPrevious = Boolean(period?.hasPrevious);
  const delta = hasPrevious ? (mode === 'adjusted' ? period.adjustedDelta : period.rawDelta) : null;
  const rate = hasPrevious ? (mode === 'adjusted' ? period.adjustedRate : period.rawRate) : null;
  const isMultiDay = hasPrevious && period.days > 1;
  const deltaClass = hasPrevious ? moneyClass(delta) : 'money-flat';

  const rateText = rate == null
    ? '—'
    : `${rate > 0 ? '↑' : rate < 0 ? '↓' : '→'} ${formatRate(rate)}`;

  let profitHtml;
  if (!hasPrevious) {
    profitHtml = `
      <div class="profit-head">
        <span class="profit-label">收益</span>
      </div>
      <div class="profit-empty">
        <p class="profit-empty__title">第一条记录已保存</p>
        <p class="profit-meta">明天再记录一次，就能看到${mode === 'adjusted' ? '剔除外部收入后的' : ''}收益和收益率。</p>
      </div>`;
  } else {
    let flowHtml = '';
    if (mode === 'adjusted' && period.flows) {
      const { incomeIn, externalIn, externalOut, ignored } = period.flows;
      if (incomeIn || externalIn || externalOut) {
        const parts = [];
        if (incomeIn) parts.push(`工资等收入 ${formatMoney(incomeIn)}`);
        if (externalIn) parts.push(`外部转入 ${formatMoney(externalIn)}`);
        if (externalOut) parts.push(`外部转出 ${formatMoney(externalOut)}`);
        flowHtml = `<div class="profit-flows">剔除口径已扣掉：${parts.join('、')}${
          ignored ? `；另有 ${formatMoney(ignored)} 标注为未计入资产，不影响收益` : ''
        }</div>`;
      } else {
        flowHtml = '<div class="profit-flows">本期没有外部资金流入/流出，两种口径相同。</div>';
      }
    }

    profitHtml = `
      <div class="profit-head">
        <span class="profit-label">${isMultiDay ? `区间收益（${period.days} 天）` : '日收益'}</span>
        <span class="profit-rate ${deltaClass}">${rateText}</span>
      </div>
      <div class="profit-value ${deltaClass}">${formatSignedMoney(delta)}</div>
      <div class="profit-meta">
        较 ${formatDateFull(period.previous.date)} 的记录（${period.days} 天）
        ${rate == null && period.previousBreakdown.net <= 0
          ? '<br>上期总资产小于等于 0，无法计算收益率。'
          : ''
        }
        ${isMultiDay
          ? `<br>日均约 ${formatSignedMoney(mode === 'adjusted' ? period.dailyAvgAdjusted : period.dailyAvgRaw)} / 天（简单平均，不是复利）`
          : ''
        }
      </div>
      ${flowHtml}`;
  }

  const todayBanner = isTodayRecorded
    ? ''
    : `
      <div class="banner banner--warning">
        <div class="banner__body">
          <div class="banner__title">今天还没记录</div>
          ${
            daysSinceLatest > 0
              ? `已经 ${daysSinceLatest} 天没记录，下面的总资产还是 ${dayLabel(latest.date)}（${weekdayCN(latest.date)}）的数字。`
              : '记录今天的余额后，收益会自动更新。'
          }
          <div class="banner__actions">
            <button type="button" class="btn btn--small btn--primary" data-go-record>记录今天</button>
          </div>
        </div>
      </div>`;

  const backupBanner = shouldShowBackupBanner(data)
    ? `
      <div class="banner banner--info">
        <div class="banner__body">
          <div class="banner__title">建议导出一份备份</div>
          数据只存在这台设备。删除主屏幕图标或清理网站数据会丢失记录。${backupText(data)}
          <div class="banner__actions">
            <button type="button" class="btn btn--small btn--soft" data-go-backup>去导出</button>
            <button type="button" class="btn btn--small btn--ghost" data-dismiss-backup>3 天后再提醒</button>
          </div>
        </div>
      </div>`
    : '';

  const recent = sortedSnapshots(data, false).slice(0, 3);
  const recentHtml = recent.map((snapshot) => {
    const rowPeriod = calculatePeriod(data, snapshot);
    const rowBreakdown = snapshotBreakdown(snapshot, data.accounts);
    const rowDelta = rowPeriod?.hasPrevious
      ? (mode === 'adjusted' ? rowPeriod.adjustedDelta : rowPeriod.rawDelta)
      : null;
    const rowRate = rowPeriod?.hasPrevious
      ? (mode === 'adjusted' ? rowPeriod.adjustedRate : rowPeriod.rawRate)
      : null;
    const rowClass = rowDelta == null ? 'money-flat' : moneyClass(rowDelta);
    return `
      <button type="button" class="list-row" data-go-history>
        <span class="list-row__main">
          <span class="list-row__title">${dayLabel(snapshot.date)} <span class="badge">${weekdayCN(snapshot.date)}</span></span>
          <span class="list-row__meta">${formatMoney(rowBreakdown.net)}</span>
        </span>
        <span class="list-row__value">
          <strong class="${rowClass}">${rowDelta == null ? '—' : formatSignedMoney(rowDelta)}</strong>
          <span>${rowRate == null ? '基准记录' : formatRate(rowRate)}</span>
        </span>
      </button>`;
  }).join('');

  container.innerHTML = `
    <div class="page home-page">
      <div class="hero">
        <div class="row row--between">
          <p class="eyebrow">总资产</p>
          <span class="status ${isTodayRecorded ? 'status--ok' : 'status--warn'}">
            ${isTodayRecorded ? '今天已记录' : '今天未记录'}
          </span>
        </div>
        <h1 class="big-money">${formatMoney(breakdown.net)}</h1>
        <p class="hero-meta">
          资产 ${formatMoney(breakdown.assets)}
          <span class="dot-sep">·</span>
          负债 ${formatMoney(breakdown.liabilities)}
        </p>
      </div>

      <div class="segmented" role="group" aria-label="收益口径">
        <button type="button" data-mode="adjusted" class="${mode === 'adjusted' ? 'is-active' : ''}">剔除外部收入</button>
        <button type="button" data-mode="raw" class="${mode === 'raw' ? 'is-active' : ''}">不剔除</button>
      </div>

      <section class="card profit-card">
        ${profitHtml}
      </section>

      ${todayBanner}
      ${backupBanner}

      <section class="card chart-card">
        <div class="chart-head">
          <span class="chart-title">总资产趋势</span>
          <span class="tiny">最近 30 次记录</span>
        </div>
        <div id="home-chart"></div>
        <button type="button" class="btn btn--ghost btn--block btn--small" data-go-history>查看全部历史</button>
      </section>

      <section class="card">
        <div class="section-head">
          <h2 class="section-title">最近记录</h2>
          <button type="button" class="btn btn--ghost btn--small" data-go-history>全部</button>
        </div>
        <div class="list">${recentHtml}</div>
      </section>

      <p class="tiny" style="text-align:center">
        数据只保存在这台设备上 · 上次备份：${data.settings.lastExportAt ? formatDateTime(data.settings.lastExportAt) : '还没有'}
      </p>
    </div>`;

  const chartPoints = sortedSnapshots(data, true)
    .slice(-30)
    .map((snapshot) => ({
      date: snapshot.date,
      value: snapshotBreakdown(snapshot, data.accounts).net
    }));
  renderLineChart(container.querySelector('#home-chart'), chartPoints, {
    ariaLabel: `${mode === 'adjusted' ? '剔除外部收入口径' : '不剔除口径'}的总资产趋势`
  });

  container.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      data.settings.returnMode = button.dataset.mode;
      if (ctx.save()) ctx.rerender();
    });
  });

  container.querySelectorAll('[data-go-record]').forEach((button) => {
    button.addEventListener('click', () => ctx.navigate('#/record'));
  });
  container.querySelectorAll('[data-go-history]').forEach((button) => {
    button.addEventListener('click', () => ctx.navigate('#/history'));
  });
  container.querySelectorAll('[data-go-backup]').forEach((button) => {
    button.addEventListener('click', () => ctx.navigate('#/settings'));
  });
  container.querySelectorAll('[data-dismiss-backup]').forEach((button) => {
    button.addEventListener('click', () => {
      data.settings.backupReminderDismissedAt = new Date().toISOString();
      if (ctx.save()) ctx.rerender();
    });
  });
}
