import {
  activeAccounts,
  previousSnapshot,
  snapshotAt,
  snapshotBreakdown
} from '../calc.js';
import { nowIso } from '../store.js';
import { autoShareAfterSave } from '../backup.js';
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

let draft = null;
let dirty = false;

export function resetDraft() {
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

  for (const account of accountsOf(data)) {
    let cents = null;
    if (existing && Object.prototype.hasOwnProperty.call(existing.balances || {}, account.id)) {
      cents = existing.balances[account.id];
    } else if (previous && Object.prototype.hasOwnProperty.call(previous.balances || {}, account.id)) {
      cents = previous.balances[account.id];
    }
    balances[account.id] = cents;
  }

  return { date, balances, note: existing?.note || '' };
}

function accountRow(data, account, previous, draftState) {
  const baseline = previous?.balances?.[account.id] ?? null;
  const cents = draftState.balances[account.id];
  const isLiability = account.type === 'liability';
  const allowSign = account.type === 'asset';
  const idAttr = escapeHtml(account.id);
  const value = centsToInput(cents);

  const hint = isLiability
    ? (baseline != null ? `欠款填正数 · 上期 ${formatMoney(baseline)}` : '欠款填正数')
    : (baseline != null ? `上期 ${formatMoney(baseline)}` : '首次记录');

  return `
    <div class="account-row" data-account-row="${idAttr}">
      <div class="account-row__head">
        <div class="account-row__name">
          <span class="acct-dot" style="background:${kindColor(account.kind)}">${escapeHtml(firstChar(account.name))}</span>
          <span>${escapeHtml(account.name)}</span>
          ${isLiability ? '<span class="badge badge--liability">负债</span>' : ''}
        </div>
      </div>
      <div class="amount-field ${allowSign ? 'has-sign' : ''}">
        <span class="amount-prefix">¥</span>
        <input class="input" type="text" inputmode="decimal" autocomplete="off"
          data-role="balance" data-account="${idAttr}"
          value="${escapeHtml(value)}" placeholder="0.00"
          aria-label="${escapeHtml(account.name)}余额">
        ${allowSign ? `<button type="button" class="sign-toggle" data-sign="${idAttr}" aria-label="切换正负号">±</button>` : ''}
      </div>
      <div class="account-row__hint">${hint}</div>
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
  }

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
        <p class="help">
          已自动带入上次余额。点一下数字会自动清空，直接输入新余额；
          不点或没改就保留上次。第一次记录需要填写所有账户余额（没有就填 0）。
        </p>
      </section>

      <section class="card">
        <div class="section-head" style="margin-bottom:4px">
          <h2 class="section-title">账户余额</h2>
          <span class="tiny">点数字自动清空</span>
        </div>
        ${assetRows}
        ${
          liabilityRows
            ? `<div class="account-section__title"><span>负债（欠款）</span><span>会从总资产中扣除</span></div>${liabilityRows}`
            : ''
        }
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

  const focusState = new WeakMap();

  container.querySelectorAll('[data-role="balance"]').forEach((input) => {
    const accountId = input.dataset.account;

    input.addEventListener('focus', () => {
      const original = draft.balances[accountId];
      if (original == null) return;
      focusState.set(input, { original, edited: false });
      input.value = '';
      input.placeholder = '输入新余额';
    });

    input.addEventListener('input', () => {
      const state = focusState.get(input);
      if (state) state.edited = true;
      draft.balances[accountId] = parseYuanToCents(input.value);
      dirty = true;
      updateTotals(container, ctx);
    });

    input.addEventListener('blur', () => {
      const state = focusState.get(input);
      if (!state) return;
      if (!state.edited && input.value.trim() === '') {
        input.value = centsToInput(state.original);
      }
      input.placeholder = '0.00';
      focusState.delete(input);
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

  let committed = false;
  let saving = false;

  function commit() {
    if (committed) return;
    committed = true;
    saving = true;

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
      committed = false;
      saving = false;
      toast(result.error, 'error');
      return;
    }

    const breakdown = snapshotBreakdown(snapshot, data.accounts);
    draft = null;
    dirty = false;

    // 必须在保存/确认按钮的同步调用栈里触发分享。
    // autoShareAfterSave 会在任何 await 之前同步调用 navigator.share()。
    autoShareAfterSave(data, ctx);

    toast(`已保存 · 总资产 ${formatMoney(breakdown.net)}`, 'success');
    ctx.navigate('#/home');
  }

  function confirmOverwrite() {
    confirmDialog({
      title: '覆盖这一天的记录？',
      message: `${formatDateFull(selectedDate)} 已经有记录，保存会用当前数字覆盖原来的余额。`,
      confirmText: '覆盖保存',
      onConfirm: commit
    });
  }

  function save() {
    if (saving || committed) return;

    // 1. 输入框里有内容但格式不合法（例如多个小数点）。
    const invalidInput = accounts.find((account) => {
      const input = container.querySelector(`[data-role="balance"][data-account="${account.id}"]`);
      const raw = input?.value.trim() || '';
      return raw !== '' && parseYuanToCents(raw) == null;
    });
    if (invalidInput) {
      toast('有金额格式不正确，请检查后重试', 'error');
      container.querySelector(`[data-role="balance"][data-account="${invalidInput.id}"]`)?.focus();
      return;
    }

    // 2. 必填（未点击或者点击了没改的字段，draft 仍是上次值）。
    const missing = accounts.find((account) => draft.balances[account.id] == null);
    if (missing) {
      toast(`请填写「${missing.name}」的余额，没有就填 0`, 'error');
      container.querySelector(`input[data-account="${missing.id}"]`)?.focus();
      return;
    }

    // 3. 负债必须是欠款正数。
    const negativeLiability = accounts.find((account) => (
      account.type === 'liability' && draft.balances[account.id] < 0
    ));
    if (negativeLiability) {
      toast('负债余额不能是负数，请填写欠款金额（正数）', 'error');
      return;
    }

    // 4. 负数资产需要确认；确认按钮的 onConfirm 直接进入下一步，
    //    保持同一用户激活链，供自动分享使用。
    const negativeAssets = accounts.filter((account) => (
      account.type === 'asset' && draft.balances[account.id] < 0
    ));

    if (negativeAssets.length) {
      confirmDialog({
        title: '确认负数余额？',
        message: `${negativeAssets.map((account) => account.name).join('、')} 的余额是负数。确认保存吗？`,
        confirmText: '确认保存',
        danger: true,
        onConfirm: () => {
          if (existing) confirmOverwrite();
          else commit();
        }
      });
      return;
    }

    if (existing) {
      confirmOverwrite();
      return;
    }

    commit();
  }

  container.querySelector('[data-save]')?.addEventListener('click', save);

  container.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '删除这一天的记录？',
      message: '只会删除这一天的余额记录。删除后收益会按剩下的记录重新计算。',
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
}
