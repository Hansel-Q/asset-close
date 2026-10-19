import {
  categoryOf,
  categoryName,
  incomeMonthlyGroups,
  monthlyIncomeSummary,
  recordCounts
} from '../calc.js';
import { nowIso } from '../store.js';
import {
  addMonths,
  centsToInput,
  confirmDialog,
  currentMonth,
  escapeHtml,
  formatDateCN,
  formatMoney,
  formatMonthCN,
  formatSignedMoney,
  isRealDate,
  monthOf,
  openModal,
  parseYuanToCents,
  toast,
  todayStr,
  uid,
  weekdayCN
} from '../utils.js';

let month = null;

export function resetIncomeView() {
  month = null;
}

function ensureMonth() {
  if (!month) month = currentMonth();
}

function summaryNote(summary) {
  const parts = [];
  if (summary.externalIn) parts.push(`外部转入 ${formatMoney(summary.externalIn)}`);
  if (summary.externalOut) parts.push(`外部转出 ${formatMoney(summary.externalOut)}`);
  if (summary.ignored) parts.push(`未计入资产 ${formatMoney(summary.ignored)}`);
  return parts.length ? parts.join(' · ') : '本月只有收入，没有外部转入/转出';
}

function openIncomeDialog(ctx, record = null, presetCategoryId = null) {
  const data = ctx.data;
  const categories = data.incomeCategories.filter((category) => (
    !category.archived || category.id === record?.categoryId
  ));
  const incomeCategories = categories.filter((category) => category.kind === 'income');
  const externalCategories = categories.filter((category) => category.kind === 'external');

  const selectedCategoryId = record?.categoryId || presetCategoryId || 'salary';
  const selectedCategory = categoryOf(data, selectedCategoryId) ||
    categories[0] ||
    null;

  const option = (category) => `
    <option value="${escapeHtml(category.id)}" ${category.id === selectedCategoryId ? 'selected' : ''}>
      ${escapeHtml(category.name)}${category.archived ? '（已停用）' : ''}
    </option>`;

  const groupedOptions = [
    incomeCategories.length
      ? `<optgroup label="收入">${incomeCategories.map(option).join('')}</optgroup>`
      : '',
    externalCategories.length
      ? `<optgroup label="外部资金">${externalCategories.map(option).join('')}</optgroup>`
      : ''
  ].join('');

  const isEdit = Boolean(record);
  const countsAsAsset = record ? record.countsAsAsset !== false : true;
  const defaultDate = record?.date ||
    (month === monthOf(todayStr()) ? todayStr() : `${month}-01`);

  const body = `
    <form class="form" id="income-form">
      <label class="field">
        <span class="label">日期</span>
        <input class="input" type="date" name="date" max="${todayStr()}"
          value="${defaultDate}" required>
      </label>

      <label class="field">
        <span class="label">分类</span>
        <select class="select" name="category">${groupedOptions}</select>
      </label>

      <label class="field">
        <span class="label">金额（元）</span>
        <input class="input" type="text" inputmode="decimal" autocomplete="off"
          name="amount" placeholder="0.00" value="${record ? centsToInput(record.amountCents) : ''}" required>
      </label>

      <label class="field">
        <span class="label">备注（可选）</span>
        <input class="input" type="text" name="note" maxlength="80"
          value="${escapeHtml(record?.note || '')}" placeholder="例如：10 月工资">
      </label>

      <label class="check-row" data-counts-row>
        <input type="checkbox" name="counts" ${countsAsAsset ? 'checked' : ''}>
        <span>
          <strong>这笔钱已经计入资产账户</strong><br>
          <span class="help">勾选后，计算“剔除口径”收益时会把工资等收入减掉。如果这笔钱没有进入你记录的账户（比如现金直接花掉），请取消勾选。</span>
        </span>
      </label>

      <div class="banner banner--info" data-external-help hidden>
        <div class="banner__body">
          外部转入/转出只影响收益计算，不会修改账户余额。账户之间互转不用记。
        </div>
      </div>

      <div class="modal__actions">
        ${isEdit ? '<button type="button" class="btn btn--danger-ghost" data-delete>删除</button>' : ''}
        <button type="button" class="btn btn--ghost" data-close>取消</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>`;

  const { dialog, close } = openModal({
    title: isEdit ? '编辑收入' : '记一笔收入',
    body,
    onMount(dialogEl) {
      const form = dialogEl.querySelector('#income-form');
      const categorySelect = form.querySelector('[name="category"]');
      const countsRow = form.querySelector('[data-counts-row]');
      const countsCheckbox = form.querySelector('[name="counts"]');
      const externalHelp = form.querySelector('[data-external-help]');

      const syncCategory = () => {
        const category = categoryOf(data, categorySelect.value);
        const isExternal = category?.kind === 'external';
        countsRow.hidden = isExternal;
        externalHelp.hidden = !isExternal;
        if (isExternal) countsCheckbox.checked = true;
      };

      categorySelect.addEventListener('change', syncCategory);
      syncCategory();

      form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const formData = new FormData(form);
        const date = String(formData.get('date') || '');
        const categoryId = String(formData.get('category') || '');
        const amountCents = parseYuanToCents(formData.get('amount'));
        const note = String(formData.get('note') || '').trim();
        const category = categoryOf(data, categoryId);

        if (!isRealDate(date) || date > todayStr()) {
          toast('请选择今天或过去的有效日期', 'error');
          return;
        }
        if (!category) {
          toast('请选择收入分类', 'error');
          return;
        }
        if (amountCents == null || amountCents <= 0) {
          toast('请输入大于 0 的金额', 'error');
          return;
        }

        const finalCounts = category.kind === 'external' ? true : countsCheckbox.checked;

        if (!isEdit) {
          const duplicate = data.incomeRecords.find((item) => (
            item.date === date &&
            item.categoryId === categoryId &&
            item.amountCents === amountCents
          ));
          if (duplicate) {
            const proceed = await confirmDialog({
              title: '可能是重复记录',
              message: '同一天、同分类、同金额已经有一笔记录。仍然要保存吗？',
              confirmText: '仍然保存'
            });
            if (!proceed) return;
          }
        }

        const nextRecord = {
          id: record?.id || uid(),
          date,
          categoryId,
          amountCents,
          countsAsAsset: finalCounts,
          note,
          createdAt: record?.createdAt || nowIso(),
          updatedAt: nowIso()
        };

        if (isEdit) {
          const index = data.incomeRecords.findIndex((item) => item.id === record.id);
          if (index >= 0) data.incomeRecords[index] = nextRecord;
          else data.incomeRecords.push(nextRecord);
        } else {
          data.incomeRecords.push(nextRecord);
        }

        const result = ctx.store.set(data);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }

        month = monthOf(date);
        close();
        toast('已保存收入记录', 'success');
        ctx.rerender();
      });

      form.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const proceed = await confirmDialog({
          title: '删除这笔收入？',
          message: '删除后，剔除口径的收益会重新计算。',
          confirmText: '删除',
          danger: true
        });
        if (!proceed) return;

        data.incomeRecords = data.incomeRecords.filter((item) => item.id !== record.id);
        const result = ctx.store.set(data);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }

        close();
        toast('已删除', 'success');
        ctx.rerender();
      });
    }
  });

  return { dialog, close, selectedCategory };
}

export function render(container, ctx) {
  ensureMonth();
  const data = ctx.data;
  const summary = monthlyIncomeSummary(data, month);
  const groups = incomeMonthlyGroups(data);
  const monthGroup = groups.find((group) => group.month === month);
  const records = monthGroup?.records || [];
  const nowMonth = currentMonth();

  const recordsByDate = new Map();
  for (const record of records) {
    if (!recordsByDate.has(record.date)) recordsByDate.set(record.date, []);
    recordsByDate.get(record.date).push(record);
  }

  const listHtml = [...recordsByDate.entries()].map(([date, dayRecords]) => {
    const rows = dayRecords.map((record) => {
      const category = categoryOf(data, record.categoryId);
      const isOut = category?.direction === 'out';
      const counted = recordCounts(record, category);
      const signed = isOut ? -record.amountCents : record.amountCents;
      return `
        <button type="button" class="list-row" data-edit-record="${escapeHtml(record.id)}">
          <span class="list-row__main">
            <span class="list-row__title">
              ${escapeHtml(categoryName(data, record.categoryId))}
              ${!counted ? '<span class="badge">未计入资产</span>' : ''}
            </span>
            <span class="list-row__meta">${escapeHtml(record.note || (isOut ? '外部转出' : '收入'))}</span>
          </span>
          <span class="list-row__value">
            <strong class="${signed >= 0 ? 'money-up' : 'money-down'}">${formatSignedMoney(signed)}</strong>
          </span>
        </button>`;
    }).join('');

    return `
      <div class="month-head"><span>${formatDateCN(date)} ${weekdayCN(date)}</span></div>
      ${rows}`;
  }).join('');

  const ignoredNote = summary.ignored
    ? `<p class="tiny" style="margin-top:8px">其中 ${formatMoney(summary.ignored)} 标注为“未计入资产”，不会影响收益计算。</p>`
    : '';

  container.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">收入</h1>
          <p class="page-sub">工资、打工收入，以及外部转入/转出</p>
        </div>
        <button type="button" class="btn btn--primary btn--small" data-add>记一笔</button>
      </div>

      <section class="card card--tight">
        <div class="month-nav">
          <button type="button" class="icon-btn" data-prev aria-label="上个月">‹</button>
          <span class="month-nav__label">${formatMonthCN(month)}</span>
          <button type="button" class="icon-btn" data-next aria-label="下个月" ${month >= nowMonth ? 'disabled' : ''}>›</button>
        </div>
      </section>

      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-card__label">本月收入</div>
          <div class="summary-card__value">${formatMoney(summary.incomeTotal)}</div>
          <div class="summary-card__sub">其中计入资产 ${formatMoney(summary.incomeIn)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-card__label">计入资产的净流入</div>
          <div class="summary-card__value ${summary.netExternal > 0 ? 'money-up' : summary.netExternal < 0 ? 'money-down' : ''}">
            ${formatSignedMoney(summary.netExternal)}
          </div>
          <div class="summary-card__sub">${summaryNote(summary)}</div>
        </div>
      </div>

      <div class="stack">
        <button type="button" class="btn btn--primary btn--block" data-add>记一笔收入</button>
        <button type="button" class="btn btn--ghost btn--block" data-add-external>记外部转入/转出</button>
      </div>

      <section class="card">
        <div class="section-head">
          <h2 class="section-title">${formatMonthCN(month)}记录</h2>
          <span class="tiny">${records.length} 笔</span>
        </div>
        ${listHtml || `
          <div class="empty">
            <div class="empty__mark">¥</div>
            <p>这个月还没有收入记录。</p>
            <p class="tiny">工资、打工收入都可以记在这里。</p>
          </div>`}
        ${ignoredNote}
      </section>

      <section class="card">
        <h2 class="section-title">“计入资产”是什么意思？</h2>
        <p class="tiny" style="margin:8px 0 0">
          工资、打工收入如果已经进了你上面记录的支付宝/银行卡等账户，就保持勾选。
          计算“剔除外部收入”口径时，这部分钱会被减掉，收益率只反映资产本身的涨跌。
          如果钱没有进入你记录的账户，取消勾选即可。
        </p>
      </section>
    </div>`;

  container.querySelector('[data-prev]')?.addEventListener('click', () => {
    month = addMonths(month, -1);
    ctx.rerender();
  });

  container.querySelector('[data-next]')?.addEventListener('click', () => {
    if (month >= currentMonth()) return;
    month = addMonths(month, 1);
    ctx.rerender();
  });

  container.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => openIncomeDialog(ctx));
  });
  container.querySelector('[data-add-external]')?.addEventListener('click', () => {
    openIncomeDialog(ctx, null, 'external_in');
  });

  container.querySelectorAll('[data-edit-record]').forEach((button) => {
    button.addEventListener('click', () => {
      const record = data.incomeRecords.find((item) => item.id === button.dataset.editRecord);
      if (record) openIncomeDialog(ctx, record);
    });
  });
}
