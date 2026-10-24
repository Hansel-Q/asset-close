import {
  activeAccounts,
  countSnapshotsUsingAccount,
  latestBalanceOfAccount,
  sortBySortOrder
} from '../calc.js';
import {
  AUTO_BACKUP_LIMIT,
  clearAutoBackups,
  nowIso,
  parseBackup,
  readAutoBackups,
  summarizeData
} from '../store.js';
import { exportBackupInteractive } from '../backup.js';
import {
  APP_VERSION,
  confirmDialog,
  escapeHtml,
  firstChar,
  formatDateCN,
  formatDateTime,
  formatMoney,
  kindColor,
  kindLabel,
  openModal,
  toast,
  uid
} from '../utils.js';
import { resetDraft } from './record.js';

const KINDS = ['alipay', 'wechat', 'bank', 'broker', 'cash', 'credit', 'loan', 'other'];

const REASON_LABELS = {
  save: '自动保存',
  migration: '版本升级',
  'before-import': '导入前',
  'before-reset': '清空前',
  'before-restore': '恢复前',
  'before-replace': '替换前'
};

function accountSortOrder(data) {
  return data.accounts.reduce((max, account) => Math.max(max, account.sortOrder ?? 0), 0) + 10;
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

      ${isEdit ? '' : '<p class="help">新增账户后第一次记录余额时，这笔钱会算作当天的总资产变化（收益）。</p>'}

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

        if (isEdit) {
          account.name = name;
          account.kind = kind;
          if (canChangeType) account.type = type;
          account.updatedAt = nowIso();
        } else {
          data.accounts.push({
            id: uid(),
            name,
            type,
            kind,
            sortOrder: accountSortOrder(data),
            archived: false,
            createdAt: nowIso(),
            updatedAt: nowIso()
          });
        }

        const result = ctx.store.set(data);
        if (!result.ok) {
          toast(result.error, 'error');
          return;
        }

        close();
        toast(isEdit ? '账户已更新' : '账户已添加', 'success');
        ctx.rerender();
      });

      form.querySelector('[data-archive-account]')?.addEventListener('click', async () => {
        const latest = latestBalanceOfAccount(data, account.id);
        let message = '归档后，这个账户不会出现在新的每日记录里，历史记录不受影响。';
        if (latest && Math.abs(latest.cents) > 0) {
          message += `\n它最近一次记录的${account.type === 'liability' ? '欠款' : '余额'}是 ${formatMoney(Math.abs(latest.cents))}（${latest.date}）。`;
          message += '\n归档后新记录不再包含它，总资产会减少。如果这笔钱还在别处，请先在“记录”页把它转到其他账户或调整余额。';
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
  const oldNotice = (parsed.migratedFrom === 1 || parsed.discardedIncome)
    ? '\n\n这是旧版本备份，旧的收入数据会被丢弃。'
    : '';

  const proceed = await confirmDialog({
    title: '覆盖导入备份？',
    message: `文件包含 ${summary.accounts} 个账户、${summary.snapshots} 条每日记录（${dateRange}）。${oldNotice}\n\n导入会覆盖当前全部数据；导入前会自动备份当前状态。`,
    confirmText: '覆盖导入',
    danger: true
  });
  if (!proceed) return;

  // replace 会先强制备份当前数据，导入后仍可恢复。
  const result = ctx.store.replace(parsed.data, { reason: 'before-import' });
  if (!result.ok) {
    toast(result.error, 'error');
    return;
  }

  ctx.applyTheme(parsed.data.settings?.theme || 'system');
  resetDraft();
  ctx.navigate('#/home');
  toast('导入成功', 'success');
}

async function clearAllData(ctx) {
  const first = await confirmDialog({
    title: '清空全部数据？',
    message: '所有账户和每日记录都会被删除，无法撤销。清空前会自动保留一份本机备份，自动备份也会保留，可在设置里恢复。',
    confirmText: '继续',
    danger: true
  });
  if (!first) return;

  const second = await confirmDialog({
    title: '最后确认',
    message: '真的要清空吗？账户和每日记录会全部删除。自动备份会保留。',
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
  ctx.navigate('#/home');
  toast('已清空全部数据', 'success');
}

function restoreAutoBackup(ctx, entry) {
  const summary = summarizeData(entry.data);
  confirmDialog({
    title: '恢复这份自动备份？',
    message: `这份备份来自 ${formatDateTime(entry.at)}，包含 ${summary.snapshots} 条每日记录（${summary.lastDate || '无'}）。\n\n当前数据会被覆盖；恢复前会自动备份当前状态。`,
    confirmText: '恢复',
    danger: true
  }).then((proceed) => {
    if (!proceed) return;

    const current = ctx.data;
    const restored = entry.data;
    const next = {
      ...restored,
      settings: {
        ...restored.settings,
        theme: current.settings.theme,
        autoShareAfterSave: current.settings.autoShareAfterSave,
        lastExportAt: current.settings.lastExportAt,
        backupReminderDismissedAt: current.settings.backupReminderDismissedAt
      }
    };

    const result = ctx.store.replace(next, { reason: 'before-restore' });
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }

    ctx.applyTheme(next.settings.theme || 'system');
    resetDraft();
    ctx.navigate('#/home');
    toast('已恢复自动备份', 'success');
  });
}

async function clearAutoBackupList(ctx) {
  const proceed = await confirmDialog({
    title: '清空自动备份？',
    message: '只会删除本机的自动备份副本，不会影响当前的账户和每日记录。清空后无法再靠这些副本恢复。',
    confirmText: '清空自动备份',
    danger: true
  });
  if (!proceed) return;

  clearAutoBackups();
  toast('自动备份已清空', 'success');
  ctx.rerender({ keepScroll: true });
}

export function render(container, ctx) {
  const data = ctx.data;
  const settings = data.settings;
  const accounts = activeAccounts(data);
  const archivedAccounts = sortBySortOrder(data.accounts.filter((account) => account.archived));
  const backups = readAutoBackups();
  const autoShare = settings.autoShareAfterSave !== false;

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

  const backupRows = backups.map((entry, index) => {
    const summary = summarizeData(entry.data);
    const reason = REASON_LABELS[entry.reason] || '自动保存';
    return `
      <div class="list-row list-row--static">
        <span class="list-row__main">
          <span class="list-row__title">${formatDateTime(entry.at)} <span class="badge">${escapeHtml(reason)}</span></span>
          <span class="list-row__meta">${summary.snapshots} 条记录${summary.lastDate ? ` · 最新 ${formatDateCN(summary.lastDate)}` : ''}</span>
        </span>
        <button type="button" class="btn btn--ghost btn--small" data-restore-backup="${index}">恢复</button>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">设置</h1>
          <p class="page-sub">账户、显示和自动备份</p>
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

      <section class="card stack">
        <h2 class="section-title">显示</h2>
        <div class="field">
          <span class="label">主题</span>
          <div class="segmented" role="group" aria-label="主题">
            <button type="button" data-theme-option="system" class="${(settings.theme || 'system') === 'system' ? 'is-active' : ''}">跟随系统</button>
            <button type="button" data-theme-option="light" class="${settings.theme === 'light' ? 'is-active' : ''}">浅色</button>
            <button type="button" data-theme-option="dark" class="${settings.theme === 'dark' ? 'is-active' : ''}">深色</button>
          </div>
        </div>
      </section>

      <section class="card stack">
        <h2 class="section-title">数据与备份</h2>
        <p class="help">
          数据只保存在这台设备的浏览器里，不会上传到任何服务器。每次保存会自动在本机保留最近 ${AUTO_BACKUP_LIMIT} 份副本；删除主屏幕图标或清理网站数据会一起丢失，所以还需要定期导出到“文件”/iCloud Drive。
        </p>

        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-card__label">每日记录</div>
            <div class="summary-card__value">${data.snapshots.length}</div>
          </div>
          <div class="summary-card">
            <div class="summary-card__label">自动备份</div>
            <div class="summary-card__value">${backups.length}</div>
          </div>
        </div>

        <p class="tiny">上次导出：${settings.lastExportAt ? formatDateTime(settings.lastExportAt) : '还没有导出过'}</p>

        <label class="check-row">
          <input type="checkbox" id="auto-share-toggle" ${autoShare ? 'checked' : ''}>
          <span>
            <strong>保存记录后自动弹出备份分享</strong><br>
            <span class="help">保存后会打开 iPhone 系统分享面板，选“存储到文件”即可存到 iCloud Drive。关闭后仍会保留本机自动备份。</span>
          </span>
        </label>

        <button type="button" class="btn btn--primary btn--block" data-export>导出备份</button>
        <button type="button" class="btn btn--ghost btn--block" data-import>导入备份</button>
        <input type="file" id="import-file" accept=".json,application/json" hidden>
        <p class="help">导入会覆盖当前数据；导入前会自动备份当前状态。旧版本备份中的收入数据会被丢弃。</p>
      </section>

      <section class="card stack">
        <div class="section-head">
          <h2 class="section-title">本机自动备份</h2>
          <span class="tiny">最近 ${AUTO_BACKUP_LIMIT} 份</span>
        </div>
        <p class="help">每次保存数据变化后自动保留一份副本。只在本机，不防删除主屏幕图标或清理网站数据；要防丢请用“保存后自动分享”或手动导出到“文件”/iCloud Drive。</p>
        <div class="list">
          ${backupRows || '<div class="empty">还没有自动备份。保存一次记录后会自动生成。</div>'}
        </div>
        ${backups.length ? '<button type="button" class="btn btn--ghost btn--block btn--small" data-clear-backups>清空自动备份</button>' : ''}
      </section>

      <section class="card stack danger-zone">
        <h2 class="section-title">清空全部数据</h2>
        <p class="help">删除所有账户和每日记录。这个操作无法撤销；清空前会自动保留一份本机备份，自动备份列表也会保留，可在上面恢复。</p>
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
        <p class="help">没有账号、没有服务器、没有统计或广告代码。所有数据只存在这台设备的 localStorage 里；保存后的分享面板由你自己选择保存位置。</p>
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

  container.querySelectorAll('[data-theme-option]').forEach((button) => {
    button.addEventListener('click', () => {
      const theme = button.dataset.themeOption;
      data.settings.theme = theme;
      ctx.applyTheme(theme);
      if (ctx.save()) ctx.rerender({ keepScroll: true });
    });
  });

  const autoShareToggle = container.querySelector('#auto-share-toggle');
  autoShareToggle?.addEventListener('change', () => {
    data.settings.autoShareAfterSave = autoShareToggle.checked;
    if (ctx.save()) {
      toast(autoShareToggle.checked ? '已开启保存后自动分享' : '已关闭保存后自动分享', 'success');
      ctx.rerender({ keepScroll: true });
    }
  });

  container.querySelector('[data-export]')?.addEventListener('click', () => {
    exportBackupInteractive(ctx.data, ctx);
  });

  container.querySelector('[data-import]')?.addEventListener('click', () => {
    container.querySelector('#import-file')?.click();
  });
  container.querySelector('#import-file')?.addEventListener('change', async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file) await importFile(ctx, file);
  });

  container.querySelectorAll('[data-restore-backup]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = backups[Number(button.dataset.restoreBackup)];
      if (entry) restoreAutoBackup(ctx, entry);
    });
  });

  container.querySelector('[data-clear-backups]')?.addEventListener('click', () => clearAutoBackupList(ctx));
  container.querySelector('[data-clear]')?.addEventListener('click', () => clearAllData(ctx));
}
