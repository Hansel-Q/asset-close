import {
  activeAccounts,
  countRecordsUsingCategory,
  countSnapshotsUsingAccount,
  latestBalanceOfAccount,
  sortBySortOrder
} from '../calc.js';
import {
  backupFilename,
  exportBackup,
  nowIso,
  parseBackup
} from '../store.js';
import {
  APP_VERSION,
  confirmDialog,
  downloadText,
  escapeHtml,
  firstChar,
  formatDateTime,
  formatMoney,
  kindColor,
  kindLabel,
  openModal,
  parseYuanToCents,
  toast,
  todayStr,
  uid
} from '../utils.js';
import { resetDraft } from './record.js';
import { resetIncomeView } from './income.js';

const KINDS = ['alipay', 'wechat', 'bank', 'broker', 'cash', 'credit', 'loan', 'other'];

function accountSortOrder(data) {
  return data.accounts.reduce((max, account) => Math.max(max, account.sortOrder ?? 0), 0) + 10;
}

function categorySortOrder(data) {
  return data.incomeCategories.reduce((max, category) => Math.max(max, category.sortOrder ?? 0), 0) + 10;
}

function moveAccount(ctx, accountId, direction) {
  const data = ctx.data;
  const list = activeAccounts(data);
  const index = list.findIndex((account) => account.id === accountId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return;

  const ids = list.map((account) => account.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  ids.forEach((id, position) => {
    const account = data.accounts.find((item) => item.id === id);
    if (account) account.sortOrder = (position + 1) * 10;
  });

  if (ctx.save()) ctx.rerender({ keepScroll: true });
}

function openAccountDialog(ctx, account = null) {
  const data = ctx.data;
  const isEdit = Boolean(account);
  const usedCount = account ? countSnapshotsUsingAccount(data, account.id) : 0;
  const canChangeType = !isEdit || usedCount === 0;
  const canDelete = isEdit && usedCount === 0;
  const showOpening = !isEdit && data.snapshots.length > 0;

  const currentType = account?.type || 'asset';
  const currentKind = account?.kind || (currentType === 'liability' ? 'credit' : 'other');

  const kindOptions = KINDS.map((kind) => (
    `<option value="${kind}" ${kind === currentKind ? 'selected' : ''}>${kindLabel(kind)}</option>`
  )).join('');

  const body = `
    <form class="form" id="account-form">
      <label class="field">
        <span class="label">账户名称</span>
        <input class="input" name="name" maxlength="20" required
          value="${escapeHtml(account?.name || '')}" placeholder="例如：招商银行、支付宝">
      </label>

      <div class="field">
        <span class="label">类型</span>
        <div class="radio-row">
          <label class="radio">
            <input type="radio" name="type" value="asset" ${currentType === 'asset' ? 'checked' : ''} ${canChangeType ? '' : 'disabled'}>
            资产（钱）
          </label>
          <label class="radio">
            <input type="radio" name="type" value="liability" ${currentType === 'liability' ? 'checked' : ''} ${canChangeType ? '' : 'disabled'}>
            负债（欠款）
          </label>
        </div>
        ${canChangeType ? '' : `<p class="help">这个账户已被 ${usedCount} 条记录使用，类型不能修改。需要改类型请归档后新建账户。</p>`}
      </div>

      <label class="field">
        <span class="label">分类图标</span>
        <select class="select" name="kind">${kindOptions}</select>
      </label>

      ${showOpening ? `
        <label class="field">
          <span class="label">当前余额（可选）</span>
          <input class="input" name="openingBalance" inputmode="decimal" autocomplete="off" placeholder="0.00">
          <span class="help">如果这个账户以前就有钱，填上当前余额，并在下面勾选期初调整，避免第一次记录时被当成“收益”。</span>
        </label>
        <label class="check-row">
          <input type="checkbox" name="openingAdjust" checked>
          <span>
            <strong>这笔钱以前就有，记为外部转入/转出</strong><br>
            <span class="help">保存后会生成一笔“期初”外部资金记录，计算收益时剔除。稍后请在“记录”页填写同样的余额。</span>
          </span>
        </label>` : ''}

      <div class="modal__actions">
        ${canDelete ? '<button type="button" class="btn btn--danger-ghost" data-delete-account>删除账户</button>' : ''}
        ${isEdit ? '<button type="button" class="btn btn--ghost" data-archive-account>归档</button>' : ''}
        <button type="button" class="btn btn--ghost" data-close>取消</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>`;

  openModal({
    title: isEdit ? '编辑账户' : '添加账户',
    body,
    onMount(dialog, close) {
      const form = dialog.querySelector('#account-form');

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const name = String(formData.get('name') || '').trim();
        const kind = String(formData.get('kind') || 'other');
        const type = canChangeType ? String(formData.get('type') || 'asset') : account.type;

        if (!name) {
          toast('请填写账户名称', 'error');
          return;
        }

        const duplicate = data.accounts.find((item) => (
          item.id !== account?.id && !item.archived && item.name === name
        ));
        if (duplicate) {
          const proceed = await confirmDialog({
            title: '账户名称重复',
            message: `已经有一个叫「${name}」的账户。仍然保存吗？`,
            confirmText: '仍然保存'
          });
          if (!proceed) return;
        }

        let openingCents = 0;
        if (showOpening) {
          const rawOpening = String(formData.get('openingBalance') || '').trim();
          if (rawOpening) {
            openingCents = parseYuanToCents(rawOpening);
            if (openingCents == null) {
              toast('当前余额格式不正确', 'error');
              return;
            }
          }
        }

        let openingAdjusted = false;

        if (isEdit) {
          account.name = name;
          account.kind = kind;
          if (canChangeType) account.type = type;
          account.updatedAt = nowIso();
        } else {
          const newAccount = {
            id: uid(),
            name,
            type,
            kind,
            sortOrder: accountSortOrder(data),
            archived: false,
            openingHandled: true,
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          data.accounts.push(newAccount);

          if (showOpening && openingCents > 0 && formData.get('openingAdjust') === 'on') {
            data.incomeRecords.push({
              id: uid(),
              date: todayStr(),
              categoryId: type === 'asset' ? 'external_in' : 'external_out',
              amountCents: openingCents,
              countsAsAsset: true,
              note: `新增账户期初：${name}`,
              sourceAccountId: newAccount.id,
              createdAt: nowIso(),
              updatedAt: nowIso()
            });
            openingAdjusted = true;
          }
        }

        const result = ctx.store.set(data);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }

        close();
        if (isEdit) {
          toast('账户已更新', 'success');
        } else if (openingAdjusted) {
          toast('账户已添加。请到“记录”页填写同样的余额，期初调整会自动剔除', 'success');
        } else {
          toast('账户已添加', 'success');
        }
        ctx.rerender();
      });

      form.querySelector('[data-archive-account]')?.addEventListener('click', async () => {
        const latest = latestBalanceOfAccount(data, account.id);
        let message = '归档后，这个账户不会出现在新的每日记录里，历史记录不受影响。';
        if (latest && Math.abs(latest.cents) > 0) {
          message += `\n它最近一次记录的${account.type === 'liability' ? '欠款' : '余额'}是 ${formatMoney(Math.abs(latest.cents))}（${latest.date}）。`;
          message += '\n如果这笔钱没有转到其他已记录账户，请先调整余额，或在收入页记一笔外部转出/转入，否则总资产会突然减少。';
        }

        const proceed = await confirmDialog({
          title: '归档这个账户？',
          message,
          confirmText: '归档',
          danger: true
        });
        if (!proceed) return;

        account.archived = true;
        account.updatedAt = nowIso();
        const result = ctx.store.set(data);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }
        close();
        toast('账户已归档', 'success');
        ctx.rerender();
      });

      form.querySelector('[data-delete-account]')?.addEventListener('click', async () => {
        const proceed = await confirmDialog({
          title: '删除这个账户？',
          message: '这个账户还没有任何历史记录，可以删除。删除后无法恢复。',
          confirmText: '删除',
          danger: true
        });
        if (!proceed) return;

        data.accounts = data.accounts.filter((item) => item.id !== account.id);
        data.incomeRecords = data.incomeRecords.filter((record) => record.sourceAccountId !== account.id);
        const result = ctx.store.set(data);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }
        close();
        toast('账户已删除', 'success');
        ctx.rerender();
      });
    }
  });
}

function openCategoryDialog(ctx, category = null) {
  const data = ctx.data;
  const isEdit = Boolean(category);

  const body = `
    <form class="form" id="category-form">
      <label class="field">
        <span class="label">分类名称</span>
        <input class="input" name="name" maxlength="12" required
          value="${escapeHtml(category?.name || '')}" placeholder="例如：稿费、房租收入">
      </label>
      <p class="help">新增的分类属于“收入”。如果这笔钱已经进入资产账户，默认会参与“剔除口径”的收益计算。</p>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" data-close>取消</button>
        <button type="submit" class="btn btn--primary">保存</button>
      </div>
    </form>`;

  openModal({
    title: isEdit ? '重命名分类' : '新增收入分类',
    body,
    onMount(dialog, close) {
      const form = dialog.querySelector('#category-form');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = String(new FormData(form).get('name') || '').trim();
        if (!name) {
          toast('请填写分类名称', 'error');
          return;
        }

        const duplicate = data.incomeCategories.find((item) => (
          item.id !== category?.id && !item.archived && item.name === name
        ));
        if (duplicate) {
          toast('已经有同名分类了', 'error');
          return;
        }

        if (isEdit) {
          category.name = name;
        } else {
          data.incomeCategories.push({
            id: `cat-${uid()}`,
            name,
            kind: 'income',
            direction: 'in',
            builtin: false,
            archived: false,
            sortOrder: categorySortOrder(data)
          });
        }

        const result = ctx.store.set(data);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }
        close();
        toast(isEdit ? '分类已改名' : '分类已添加', 'success');
        ctx.rerender();
      });
    }
  });
}

async function removeCategory(ctx, category) {
  const data = ctx.data;
  const used = countRecordsUsingCategory(data, category.id);

  if (used > 0) {
    const proceed = await confirmDialog({
      title: '停用这个分类？',
      message: `已有 ${used} 笔记录使用它。停用后不能在新记录里选择，历史记录和收益计算不受影响。`,
      confirmText: '停用'
    });
    if (!proceed) return;
    category.archived = true;
  } else {
    const proceed = await confirmDialog({
      title: '删除这个分类？',
      message: '这个分类还没有被任何记录使用，可以删除。',
      confirmText: '删除',
      danger: true
    });
    if (!proceed) return;
    data.incomeCategories = data.incomeCategories.filter((item) => item.id !== category.id);
  }

  const result = ctx.store.set(data);
  if (!result.ok) {
    toast(result.error, 'error');
    return;
  }
  toast('分类已更新', 'success');
  ctx.rerender({ keepScroll: true });
}

async function exportData(ctx) {
  const data = ctx.data;
  const filename = backupFilename();
  const text = exportBackup(data);
  let done = false;

  try {
    const file = new File([text], filename, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file] });
        done = true;
      } catch (error) {
        if (error?.name === 'AbortError') return;
        downloadText(filename, text);
        done = true;
      }
    } else {
      downloadText(filename, text);
      done = true;
    }
  } catch (error) {
    downloadText(filename, text);
    done = true;
  }

  if (!done) return;

  data.settings.lastExportAt = nowIso();
  ctx.save();
  toast('已导出备份', 'success');
  ctx.rerender({ keepScroll: true });
}

async function importFile(ctx, file) {
  let text;
  try {
    text = await file.text();
  } catch (error) {
    toast('无法读取文件', 'error');
    return;
  }

  const parsed = parseBackup(text);
  if (!parsed.ok) {
    openModal({
      title: '导入失败',
      body: `
        <p class="modal__message">${escapeHtml(parsed.error)}</p>
        <div class="modal__actions">
          <button type="button" class="btn btn--primary" data-close>知道了</button>
        </div>`
    });
    return;
  }

  const summary = parsed.summary;
  const dateRange = summary.firstDate
    ? `${summary.firstDate} 到 ${summary.lastDate}`
    : '没有每日记录';

  const proceed = await confirmDialog({
    title: '覆盖导入备份？',
    message: `文件包含 ${summary.accounts} 个账户、${summary.snapshots} 条每日记录（${dateRange}）、${summary.incomes} 笔收入。\n\n导入会覆盖当前全部数据。建议先“导出备份”保存当前数据。`,
    confirmText: '覆盖导入',
    danger: true
  });
  if (!proceed) return;

  const result = ctx.store.set(parsed.data);
  if (!result.ok) {
    toast(result.error, 'error');
    return;
  }

  ctx.applyTheme(parsed.data.settings?.theme || 'system');
  resetDraft();
  resetIncomeView();
  ctx.navigate('#/home');
  toast('导入成功', 'success');
}

async function clearAllData(ctx) {
  const first = await confirmDialog({
    title: '清空全部数据？',
    message: '所有账户、每日记录、收入记录都会被删除，无法恢复。建议先导出一份备份。',
    confirmText: '继续',
    danger: true
  });
  if (!first) return;

  const second = await confirmDialog({
    title: '最后确认',
    message: '真的要清空吗？清空后无法恢复。',
    confirmText: '彻底清空',
    danger: true
  });
  if (!second) return;

  const result = ctx.store.reset();
  if (!result.ok) {
    toast(result.error, 'error');
    return;
  }

  ctx.applyTheme('system');
  resetDraft();
  resetIncomeView();
  ctx.navigate('#/home');
  toast('已清空全部数据', 'success');
}

export function render(container, ctx) {
  const data = ctx.data;
  const settings = data.settings;
  const accounts = activeAccounts(data);
  const archivedAccounts = sortBySortOrder(data.accounts.filter((account) => account.archived));
  const categories = sortBySortOrder(data.incomeCategories);

  const accountRows = accounts.map((account, index) => {
    const latest = latestBalanceOfAccount(data, account.id);
    const balanceText = latest
      ? `${account.type === 'liability' ? '欠款 ' : ''}${formatMoney(Math.abs(latest.cents))}`
      : '还没有余额记录';
    const kindText = kindLabel(account.kind) === account.name ? '' : kindLabel(account.kind);
    const metaText = [kindText, balanceText].filter(Boolean).join(' · ');
    const idAttr = escapeHtml(account.id);

    return `
      <div class="list-row list-row--static">
        <button type="button" class="row-link" data-edit-account="${idAttr}">
          <span class="acct-dot" style="background:${kindColor(account.kind)}">${escapeHtml(firstChar(account.name))}</span>
          <span class="list-row__main">
            <span class="list-row__title">
              ${escapeHtml(account.name)}
              ${account.type === 'liability' ? '<span class="badge badge--liability">负债</span>' : ''}
            </span>
            <span class="list-row__meta">${metaText}</span>
          </span>
        </button>
        <span class="sort-buttons">
          <button type="button" class="icon-btn" data-move-up="${idAttr}" ${index === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
          <button type="button" class="icon-btn" data-move-down="${idAttr}" ${index === accounts.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
        </span>
      </div>`;
  }).join('');

  const archivedHtml = archivedAccounts.length
    ? `
      <section class="card">
        <div class="section-head">
          <h2 class="section-title">已归档账户</h2>
          <span class="tiny">不会出现在新记录里</span>
        </div>
        <div class="list">
          ${archivedAccounts.map((account) => `
            <div class="list-row list-row--static">
              <span class="list-row__main">
                <span class="list-row__title">${escapeHtml(account.name)}</span>
                <span class="list-row__meta">${kindLabel(account.kind)}${account.type === 'liability' ? ' · 负债' : ''}</span>
              </span>
              <button type="button" class="btn btn--ghost btn--small" data-restore-account="${escapeHtml(account.id)}">恢复</button>
            </div>`).join('')}
        </div>
      </section>`
    : '';

  const categoryRows = categories.map((category) => {
    const used = countRecordsUsingCategory(data, category.id);
    const isCustom = !category.builtin;
    const idAttr = escapeHtml(category.id);
    return `
      <div class="list-row list-row--static">
        <span class="list-row__main">
          <span class="list-row__title">
            ${escapeHtml(category.name)}
            ${category.builtin ? '<span class="badge">内置</span>' : ''}
            ${category.archived ? '<span class="badge">已停用</span>' : ''}
          </span>
          <span class="list-row__meta">
            ${category.direction === 'out' ? '外部转出' : (category.kind === 'external' ? '外部转入' : '收入')}
            ${used ? ` · ${used} 笔记录` : ''}
          </span>
        </span>
        ${isCustom ? `
          <span class="row-actions">
            <button type="button" class="btn btn--ghost btn--small" data-edit-cat="${idAttr}">改名</button>
            ${category.archived
              ? `<button type="button" class="btn btn--ghost btn--small" data-restore-cat="${idAttr}">恢复</button>`
              : `<button type="button" class="btn btn--ghost btn--small" data-remove-cat="${idAttr}">${used ? '停用' : '删除'}</button>`}
          </span>` : ''}
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">设置</h1>
          <p class="page-sub">账户、分类、显示和数据备份</p>
        </div>
      </div>

      <section class="card">
        <div class="section-head">
          <h2 class="section-title">账户</h2>
          <button type="button" class="btn btn--ghost btn--small" data-add-account>添加账户</button>
        </div>
        <div class="list">${accountRows}</div>
      </section>

      ${archivedHtml}

      <section class="card">
        <div class="section-head">
          <h2 class="section-title">收入分类</h2>
          <button type="button" class="btn btn--ghost btn--small" data-add-category>新增分类</button>
        </div>
        <div class="list">${categoryRows}</div>
        <p class="help" style="margin-top:8px">内置分类不能删除；“外部转入/转出”只影响收益计算，不会修改账户余额。</p>
      </section>

      <section class="card stack">
        <h2 class="section-title">显示与录入</h2>

        <div class="field">
          <span class="label">主题</span>
          <div class="segmented" role="group" aria-label="主题">
            <button type="button" data-theme-option="system" class="${(settings.theme || 'system') === 'system' ? 'is-active' : ''}">跟随系统</button>
            <button type="button" data-theme-option="light" class="${settings.theme === 'light' ? 'is-active' : ''}">浅色</button>
            <button type="button" data-theme-option="dark" class="${settings.theme === 'dark' ? 'is-active' : ''}">深色</button>
          </div>
        </div>

        <div class="field">
          <span class="label">默认录入方式</span>
          <div class="segmented" role="group" aria-label="默认录入方式">
            <button type="button" data-entry-default="balance" class="${settings.defaultEntryMode === 'balance' ? 'is-active' : ''}">填余额</button>
            <button type="button" data-entry-default="delta" class="${settings.defaultEntryMode === 'delta' ? 'is-active' : ''}">填增减</button>
          </div>
          <span class="help">只影响打开“记录”页时默认选中的方式，随时可以在页面顶部切换。</span>
        </div>

        <div class="field">
          <span class="label">默认收益口径</span>
          <div class="segmented" role="group" aria-label="默认收益口径">
            <button type="button" data-return-default="adjusted" class="${settings.returnMode === 'adjusted' ? 'is-active' : ''}">剔除外部收入</button>
            <button type="button" data-return-default="raw" class="${settings.returnMode === 'raw' ? 'is-active' : ''}">不剔除</button>
          </div>
        </div>
      </section>

      <section class="card stack">
        <h2 class="section-title">数据与备份</h2>
        <p class="help">
          数据只保存在这台设备的浏览器里，不会上传到任何服务器。删除主屏幕图标、清理网站数据或系统存储压力都可能丢失记录，定期导出是唯一可靠的备份方式。
        </p>

        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-card__label">每日记录</div>
            <div class="summary-card__value">${data.snapshots.length}</div>
          </div>
          <div class="summary-card">
            <div class="summary-card__label">收入记录</div>
            <div class="summary-card__value">${data.incomeRecords.length}</div>
          </div>
        </div>

        <p class="tiny">上次备份：${settings.lastExportAt ? formatDateTime(settings.lastExportAt) : '还没有导出过'}</p>

        <button type="button" class="btn btn--primary btn--block" data-export>导出备份</button>
        <button type="button" class="btn btn--ghost btn--block" data-import>导入备份</button>
        <input type="file" id="import-file" accept=".json,application/json" hidden>
        <p class="help">导入会覆盖当前全部数据。建议先导出一份当前备份。</p>
      </section>

      <section class="card stack danger-zone">
        <h2 class="section-title">清空全部数据</h2>
        <p class="help">删除所有账户、每日记录和收入记录。这个操作无法撤销。</p>
        <button type="button" class="btn btn--danger-ghost btn--block" data-clear>清空全部数据</button>
      </section>

      <section class="card stack">
        <h2 class="section-title">安装到主屏幕</h2>
        <ol class="steps">
          <li>用 iPhone 的 Safari 打开这个网页</li>
          <li>点 Safari 的分享按钮（方框向上箭头）</li>
          <li>选择“添加到主屏幕”</li>
          <li>以后固定从主屏幕图标打开并录入</li>
        </ol>
        <p class="help">Safari 和主屏幕应用的数据互不相通。只在主屏幕应用里录入；删除主屏幕图标会删除数据，删除前请先导出备份。</p>
      </section>

      <section class="card stack">
        <h2 class="section-title">隐私</h2>
        <p class="help">没有账号、没有服务器、没有统计或广告代码。所有数据只存在这台设备的 localStorage 里。</p>
        <p class="tiny">资产收盘 v${APP_VERSION}</p>
      </section>
    </div>`;

  container.querySelector('[data-add-account]')?.addEventListener('click', () => openAccountDialog(ctx));
  container.querySelectorAll('[data-edit-account]').forEach((button) => {
    button.addEventListener('click', () => {
      const account = data.accounts.find((item) => item.id === button.dataset.editAccount);
      if (account) openAccountDialog(ctx, account);
    });
  });
  container.querySelectorAll('[data-move-up]').forEach((button) => {
    button.addEventListener('click', () => moveAccount(ctx, button.dataset.moveUp, -1));
  });
  container.querySelectorAll('[data-move-down]').forEach((button) => {
    button.addEventListener('click', () => moveAccount(ctx, button.dataset.moveDown, 1));
  });
  container.querySelectorAll('[data-restore-account]').forEach((button) => {
    button.addEventListener('click', () => {
      const account = data.accounts.find((item) => item.id === button.dataset.restoreAccount);
      if (!account) return;
      account.archived = false;
      account.updatedAt = nowIso();
      if (ctx.save()) {
        toast('账户已恢复', 'success');
        ctx.rerender({ keepScroll: true });
      }
    });
  });

  container.querySelector('[data-add-category]')?.addEventListener('click', () => openCategoryDialog(ctx));
  container.querySelectorAll('[data-edit-cat]').forEach((button) => {
    button.addEventListener('click', () => {
      const category = data.incomeCategories.find((item) => item.id === button.dataset.editCat);
      if (category) openCategoryDialog(ctx, category);
    });
  });
  container.querySelectorAll('[data-remove-cat]').forEach((button) => {
    button.addEventListener('click', () => {
      const category = data.incomeCategories.find((item) => item.id === button.dataset.removeCat);
      if (category) removeCategory(ctx, category);
    });
  });
  container.querySelectorAll('[data-restore-cat]').forEach((button) => {
    button.addEventListener('click', () => {
      const category = data.incomeCategories.find((item) => item.id === button.dataset.restoreCat);
      if (!category) return;
      category.archived = false;
      if (ctx.save()) {
        toast('分类已恢复', 'success');
        ctx.rerender({ keepScroll: true });
      }
    });
  });

  container.querySelectorAll('[data-theme-option]').forEach((button) => {
    button.addEventListener('click', () => {
      const theme = button.dataset.themeOption;
      data.settings.theme = theme;
      ctx.applyTheme(theme);
      if (ctx.save()) ctx.rerender({ keepScroll: true });
    });
  });

  container.querySelectorAll('[data-entry-default]').forEach((button) => {
    button.addEventListener('click', () => {
      data.settings.defaultEntryMode = button.dataset.entryDefault;
      resetDraft();
      if (ctx.save()) ctx.rerender({ keepScroll: true });
    });
  });

  container.querySelectorAll('[data-return-default]').forEach((button) => {
    button.addEventListener('click', () => {
      data.settings.returnMode = button.dataset.returnDefault;
      if (ctx.save()) ctx.rerender({ keepScroll: true });
    });
  });

  container.querySelector('[data-export]')?.addEventListener('click', () => exportData(ctx));
  container.querySelector('[data-import]')?.addEventListener('click', () => {
    container.querySelector('#import-file')?.click();
  });
  container.querySelector('#import-file')?.addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file) await importFile(ctx, file);
  });
  container.querySelector('[data-clear]')?.addEventListener('click', () => clearAllData(ctx));
}
