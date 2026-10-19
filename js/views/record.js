import {
  activeAccounts,
  previousSnapshot,
  snapshotAt,
  snapshotBreakdown
} from '../calc.js';
import { nowIso } from '../store.js';
import {
  centsToInput,
  confirmDialog,
  escapeHtml,
  firstChar,
  formatDateFull,
  formatMoney,
  isRealDate,
  kindColor,
  parseYuanToCents,
  toast,
  todayStr,
  weekdayCN
} from '../utils.js';

let mode = null;
let draft = null;
let dirty = false;

export function resetDraft() {
  mode = null;
  draft = null;
  dirty = false;
}

function accountsOf(data) {
  return activeAccounts(data);
}

function computeTotals(data, balances) {
  let assets = 0;
  let liabilities = 0;
  for (const account of accountsOf(data)) {
    const cents = balances[account.id];
    if (cents == null) continue;
    if (account.type === 'liability') liabilities += Math.abs(cents);
    else assets += cents;
  }
  return { assets, liabilities, net: assets - liabilities };
}

function initDraft(data, date) {
  const existing = snapshotAt(data, date);
  const previous = previousSnapshot(data, date);
  const balances = {};
  const deltas = {};

  for (const account of accountsOf(data)) {
    let cents = null;
    if (existing && Object.prototype.hasOwnProperty.call(existing.balances || {}, account.id)) {
      cents = existing.balances[account.id];
    } else if (previous && Object.prototype.hasOwnProperty.call(previous.balances || {}, account.id)) {
      cents = previous.balances[account.id];
    }
    balances[account.id] = cents;

    const baseline = previous?.balances?.[account.id];
    if (baseline != null && cents != null) {
      const change = cents - baseline;
      deltas[account.id] = change === 0 ? '' : centsToInput(change);
    } else {
      deltas[account.id] = '';
    }
  }

  return { date, balances, deltas, note: existing?.note || '' };
}

function accountRow(data, account, previous, draftState) {
  const baseline = previous?.balances?.[account.id] ?? null;
  const cents = draftState.balances[account.id];
  const isLiability = account.type === 'liability';
  const useDelta = mode === 'delta' && baseline != null;
  const allowSign = useDelta || account.type === 'asset';
  const idAttr = escapeHtml(account.id);

  let hint;
  if (isLiability) {
    hint = baseline != null ? `欠款填正数 · 上期 ${formatMoney(baseline)}` : '欠款填正数';
  } else {
    hint = baseline != null ? `上期 ${formatMoney(baseline)}` : '首次记录';
  }

  let inputHtml;
  if (useDelta) {
    const rawDelta = draftState.deltas[account.id] ?? '';
    inputHtml = `
      <div class="amount-field has-sign">
        <span class="amount-prefix">¥</span>
        <input class="input" type="text" inputmode="decimal" autocomplete="off"
          data-role="delta" data-account="${idAttr}"
          value="${escapeHtml(rawDelta)}" placeholder="0"
          aria-label="${escapeHtml(account.name)}今日变化">
        <button type="button" class="sign-toggle" data-sign="${idAttr}" aria-label="切换正负号">±</button>
      </div>
      <div class="delta-meta">
        <span>${isLiability ? '欠款' : '余额'} ${formatMoney(baseline)} → <strong data-new-balance="${idAttr}">${cents == null ? '—' : formatMoney(cents)}</strong></span>
        <span>${isLiability ? '欠款增加填正数，减少填负数' : '增加填正数，减少填负数'}</span>
      </div>`;
  } else {
    const value = centsToInput(cents);
    inputHtml = `
      <div class="amount-field ${allowSign ? 'has-sign' : ''}">
        <span class="amount-prefix">¥</span>
        <input class="input" type="text" inputmode="decimal" autocomplete="off"
          data-role="balance" data-account="${idAttr}"
          value="${escapeHtml(value)}" placeholder="0.00"
          aria-label="${escapeHtml(account.name)}${mode === 'delta' ? '首次余额' : '余额'}">
        ${allowSign ? `<button type="button" class="sign-toggle" data-sign="${idAttr}" aria-label="切换正负号">±</button>` : ''}
      </div>
      <div class="account-row__hint">${mode === 'delta' ? '首次余额，请直接填写' : hint}</div>`;
  }

  return `
    <div class="account-row" data-account-row="${idAttr}">
      <div class="account-row__head">
        <div class="account-row__name">
          <span class="acct-dot" style="background:${kindColor(account.kind)}">${escapeHtml(firstChar(account.name))}</span>
          <span>${escapeHtml(account.name)}</span>
          ${isLiability ? '<span class="badge badge--liability">负债</span>' : ''}
        </div>
      </div>
      ${inputHtml}
    </div>`;
}

function updateTotals(container, ctx) {
  const data = ctx.data;
  const totals = computeTotals(data, draft.balances);
  const totalEl = container.querySelector('#record-total');
  if (totalEl) totalEl.textContent = formatMoney(totals.net);

  const breakdownEl = container.querySelector('#record-breakdown');
  if (breakdownEl) {
    breakdownEl.textContent = `资产 ${formatMoney(totals.assets)} · 负债 ${formatMoney(totals.liabilities)}`;
  }

  container.querySelectorAll('[data-new-balance]').forEach((el) => {
    const accountId = el.dataset.newBalance;
    const cents = draft.balances[accountId];
    el.textContent = cents == null ? '—' : formatMoney(cents);
  });

  container.querySelectorAll('.sign-toggle').forEach((button) => {
    const row = button.closest('.account-row');
    const input = row?.querySelector('input');
    button.classList.toggle('is-negative', Boolean(input?.value.trim().startsWith('-')));
  });
}

function renderNoAccounts(container, ctx) {
  container.innerHTML = `
    <div class="page">
      <section class="card empty">
        <div class="empty__mark">¥</div>
        <p>还没有可记录的账户。</p>
        <button type="button" class="btn btn--primary" data-go-settings>去设置添加账户</button>
      </section>
    </div>`;
  container.querySelector('[data-go-settings]')?.addEventListener('click', () => ctx.navigate('#/settings'));
}

export function render(container, ctx) {
  const data = ctx.data;
  const today = todayStr();

  let selectedDate = ctx.route.param || today;
  if (!isRealDate(selectedDate) || selectedDate > today) {
    selectedDate = today;
  }

  const accounts = accountsOf(data);
  if (!accounts.length) {
    renderNoAccounts(container, ctx);
    return;
  }

  const existing = snapshotAt(data, selectedDate);
  const previous = previousSnapshot(data, selectedDate);

  if (!draft || draft.date !== selectedDate) {
    draft = initDraft(data, selectedDate);
    dirty = false;
    if (mode === null) {
      mode = data.settings.defaultEntryMode === 'delta' ? 'delta' : 'balance';
    }
  }
  if (!previous) mode = 'balance';
  if (mode !== 'delta') mode = 'balance';

  const assetAccounts = accounts.filter((account) => account.type === 'asset');
  const liabilityAccounts = accounts.filter((account) => account.type === 'liability');

  const assetRows = assetAccounts.map((account) => accountRow(data, account, previous, draft)).join('');
  const liabilityRows = liabilityAccounts.map((account) => accountRow(data, account, previous, draft)).join('');

  const title = existing ? '编辑记录' : (selectedDate === today ? '记录今天' : '补记记录');
  const subtitle = `${formatDateFull(selectedDate)} ${weekdayCN(selectedDate)}`;

  container.innerHTML = `
    <div class="page record-page">
      <div class="page-head">
        <div>
          <h1 class="page-title">${title}</h1>
          <p class="page-sub">${subtitle}${existing ? ' · 这一天已有记录，保存会覆盖' : ''}</p>
        </div>
      </div>

      <section class="card stack">
        <label class="field">
          <span class="label">日期</span>
          <input class="input" type="date" id="record-date" max="${today}" value="${selectedDate}">
        </label>

        <div class="segmented" role="group" aria-label="录入方式">
          <button type="button" data-entry-mode="balance" class="${mode === 'balance' ? 'is-active' : ''}">填余额</button>
          <button type="button" data-entry-mode="delta" class="${mode === 'delta' ? 'is-active' : ''}" ${previous ? '' : 'disabled'}>填增减</button>
        </div>
        ${
          previous
            ? `<p class="help">${mode === 'delta'
                ? '只填今天比上次增加或减少了多少，应用会自动算出新余额。减少请用 ± 按钮切换成负数。'
                : '已自动带入上次余额，只改有变化的数字。没有的账户填 0。'}</p>`
            : '<p class="help">第一次记录需要先填余额，作为以后计算收益的基准。“填增减”要等有上期记录后才能用。</p>'
        }
      </section>

      <section class="card">
        <div class="section-head" style="margin-bottom:4px">
          <h2 class="section-title">账户${mode === 'delta' ? '变化' : '余额'}</h2>
          <span class="tiny">${mode === 'delta' ? '正数=增加，负数=减少' : '单位：元'}</span>
        </div>
        ${assetRows}
        ${
          liabilityRows
            ? `<div class="account-section__title"><span>负债（欠款）</span><span>会从总资产中扣除</span></div>${liabilityRows}`
            : ''
        }
      </section>

      <section class="card card--tight">
        <div class="row row--between row--wrap">
          <div>
            <strong>今天有外部转入/转出？</strong>
            <p class="tiny" style="margin:4px 0 0">比如家人转入、借钱给别人。账户之间互转不用记。</p>
          </div>
          <button type="button" class="btn btn--ghost btn--small" data-go-income>去记一笔</button>
        </div>
      </section>

      <section class="card">
        <label class="field">
          <span class="label">备注（可选）</span>
          <textarea class="textarea" id="record-note" maxlength="200" placeholder="例如：发了工资、调整了信用卡">${escapeHtml(draft.note)}</textarea>
        </label>
      </section>

      ${existing ? '<button type="button" class="btn btn--danger-ghost btn--block" data-delete>删除这一天的记录</button>' : ''}
    </div>

    <div class="record-actions">
      <div class="record-actions__inner">
        <div class="record-actions__sum">
          总资产
          <strong id="record-total">${formatMoney(computeTotals(data, draft.balances).net)}</strong>
          <span id="record-breakdown"></span>
        </div>
        <button type="button" class="btn btn--primary" data-save>保存</button>
      </div>
    </div>`;

  updateTotals(container, ctx);

  container.querySelectorAll('[data-entry-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.entryMode;
      if (next === 'delta' && !previous) return;
      if (next === mode) return;

      if (next === 'delta') {
        for (const account of accounts) {
          const baseline = previous?.balances?.[account.id];
          if (baseline == null) continue;
          const cents = draft.balances[account.id];
          const change = cents == null ? null : cents - baseline;
          draft.deltas[account.id] = change == null || change === 0 ? '' : centsToInput(change);
        }
      }

      mode = next;
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-role="balance"]').forEach((input) => {
    input.addEventListener('input', () => {
      const accountId = input.dataset.account;
      draft.balances[accountId] = parseYuanToCents(input.value);
      dirty = true;
      updateTotals(container, ctx);
    });
  });

  container.querySelectorAll('[data-role="delta"]').forEach((input) => {
    input.addEventListener('input', () => {
      const accountId = input.dataset.account;
      const baseline = previous?.balances?.[accountId];
      if (baseline == null) return;
      draft.deltas[accountId] = input.value;
      const change = parseYuanToCents(input.value);
      draft.balances[accountId] = baseline + (change ?? 0);
      dirty = true;
      updateTotals(container, ctx);
    });
  });

  container.querySelectorAll('[data-sign]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('.account-row');
      const input = row?.querySelector('input');
      if (!input) return;
      let value = input.value.trim();
      if (value.startsWith('-')) value = value.slice(1);
      else if (value === '') value = '-';
      else value = `-${value}`;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  const noteInput = container.querySelector('#record-note');
  noteInput?.addEventListener('input', () => {
    draft.note = noteInput.value;
    dirty = true;
  });

  const dateInput = container.querySelector('#record-date');
  dateInput?.addEventListener('change', async () => {
    const value = dateInput.value;
    if (!value) {
      dateInput.value = selectedDate;
      return;
    }
    if (!isRealDate(value) || value > todayStr()) {
      toast('请选择今天或过去的有效日期', 'error');
      dateInput.value = selectedDate;
      return;
    }
    if (value === selectedDate) return;

    if (dirty) {
      const ok = await confirmDialog({
        title: '放弃未保存的修改？',
        message: '切换日期会丢弃当前已经输入的内容。',
        confirmText: '切换日期'
      });
      if (!ok) {
        dateInput.value = selectedDate;
        return;
      }
    }

    draft = null;
    dirty = false;
    ctx.navigate(`#/record/${value}`);
  });

  async function save() {
    const invalidDelta = accounts.find((account) => {
      if (mode !== 'delta' || previous?.balances?.[account.id] == null) return false;
      const input = container.querySelector(`[data-role="delta"][data-account="${account.id}"]`);
      const raw = input?.value.trim() || '';
      return raw !== '' && parseYuanToCents(raw) == null;
    });
    if (invalidDelta) {
      toast('有金额格式不正确，请检查后重试', 'error');
      container.querySelector(`[data-role="delta"][data-account="${invalidDelta.id}"]`)?.focus();
      return;
    }

    const missing = accounts.find((account) => draft.balances[account.id] == null);
    if (missing) {
      toast(`请填写「${missing.name}」的余额，没有就填 0`, 'error');
      container.querySelector(`input[data-account="${missing.id}"]`)?.focus();
      return;
    }

    const negativeLiability = accounts.find((account) => (
      account.type === 'liability' && draft.balances[account.id] < 0
    ));
    if (negativeLiability) {
      toast('负债余额不能是负数，请填写欠款金额（正数）', 'error');
      return;
    }

    const negativeAssets = accounts.filter((account) => (
      account.type === 'asset' && draft.balances[account.id] < 0
    ));
    if (negativeAssets.length) {
      const ok = await confirmDialog({
        title: '确认负数余额？',
        message: `${negativeAssets.map((account) => account.name).join('、')} 的余额是负数。确认保存吗？`,
        confirmText: '确认保存',
        danger: true
      });
      if (!ok) return;
    }

    if (existing) {
      const ok = await confirmDialog({
        title: '覆盖这一天的记录？',
        message: `${formatDateFull(selectedDate)} 已经有记录，保存会用当前数字覆盖原来的余额。`,
        confirmText: '覆盖保存'
      });
      if (!ok) return;
    }

    const nextBalances = { ...(existing?.balances || {}) };
    for (const account of accounts) {
      nextBalances[account.id] = draft.balances[account.id];
    }

    const snapshot = {
      date: selectedDate,
      balances: nextBalances,
      note: draft.note.trim(),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso()
    };

    const index = data.snapshots.findIndex((item) => item.date === selectedDate);
    if (index >= 0) data.snapshots[index] = snapshot;
    else data.snapshots.push(snapshot);

    data.settings.onboardingDone = true;

    const result = ctx.store.set(data);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }

    draft = null;
    dirty = false;

    const breakdown = snapshotBreakdown(snapshot, data.accounts);
    toast(`已保存 · 总资产 ${formatMoney(breakdown.net)}`, 'success');
    ctx.navigate('#/home');
  }

  container.querySelector('[data-save]')?.addEventListener('click', save);

  container.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '删除这一天的记录？',
      message: '只会删除这一天的余额记录，收入记录不会删除。删除后收益会按剩下的记录重新计算。',
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;

    data.snapshots = data.snapshots.filter((item) => item.date !== selectedDate);
    const result = ctx.store.set(data);
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }

    draft = null;
    dirty = false;
    toast('已删除这一天的记录', 'success');
    ctx.navigate('#/history');
  });

  container.querySelector('[data-go-income]')?.addEventListener('click', () => ctx.navigate('#/income'));
}
