/**
 * 备份文件层：
 * - 生成 JSON 文件
 * - 调用 iPhone 系统分享面板 / 下载回退
 * - 保存记录后自动分享（含失败回退）
 *
 * 重要：WebKit 的 navigator.share() 依赖 transient activation，
 * 所以在调用它之前不能有任何 await。shareBackupFile() 在第一个
 * await（.then）之前同步构造 File 并调用 share()。
 */

import { backupFilename, exportBackup } from './store.js';
import {
  downloadText,
  isIOS,
  openModal,
  toast
} from './utils.js';

export function buildBackupFile(data) {
  const filename = backupFilename();
  const text = exportBackup(data);
  let file = null;
  try {
    file = new File([text], filename, { type: 'application/json' });
  } catch (error) {
    file = null;
  }
  return { filename, text, file };
}

function canSharePayload(payload) {
  if (!payload.file) return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [payload.file] });
  } catch (error) {
    return false;
  }
}

/**
 * 尝试系统分享。调用方必须在用户点击的同步调用栈里调用本函数。
 * 返回 Promise<{status:'shared'|'cancelled'|'unsupported'|'error', ...}>。
 */
export function shareBackupFile(data) {
  const payload = buildBackupFile(data);

  if (!canSharePayload(payload)) {
    return Promise.resolve({ status: 'unsupported', ...payload });
  }

  let sharePromise;
  try {
    // 同步调用；此处绝不能先 await。
    sharePromise = navigator.share({ files: [payload.file] });
  } catch (error) {
    return Promise.resolve({ status: 'error', error, ...payload });
  }

  return sharePromise.then(
    () => ({ status: 'shared', ...payload }),
    (error) => {
      if (error?.name === 'AbortError') {
        return { status: 'cancelled', ...payload };
      }
      return { status: 'error', error, ...payload };
    }
  );
}

export function downloadBackupFile(payload) {
  downloadText(payload.filename, payload.text);
}

function markExported(data, ctx) {
  data.settings.lastExportAt = new Date().toISOString();
  const result = ctx.store.set(data);
  if (!result.ok) {
    toast(result.error, 'error');
    return false;
  }
  ctx.rerender?.({ keepScroll: true });
  return true;
}

/** 分享/系统拦截/不支持的可靠回退窗口。 */
export function showManualBackupFallback(data, ctx) {
  const payload = buildBackupFile(data);
  const shareSupported = canSharePayload(payload);

  const body = `
    <p class="modal__message">
      数据已经保存，但系统没有自动弹出分享面板。
      你可以手动备份到“文件”/iCloud Drive，或下载到浏览器下载目录。
    </p>
    <div class="modal__actions">
      <button type="button" class="btn btn--ghost" data-close>稍后</button>
      <button type="button" class="btn btn--ghost" data-download>下载备份</button>
      ${shareSupported ? '<button type="button" class="btn btn--primary" data-share>备份到文件</button>' : ''}
    </div>`;

  const { dialog, close } = openModal({
    title: '自动备份没有弹出',
    body,
    onMount(dialogEl) {
      dialogEl.querySelector('[data-download]')?.addEventListener('click', () => {
        downloadBackupFile(payload);
        markExported(data, ctx);
        close();
        toast('备份文件已下载', 'success');
      });

      dialogEl.querySelector('[data-share]')?.addEventListener('click', () => {
        // 这里是一次全新的用户点击，重新获得 transient activation。
        shareBackupFile(data).then((result) => {
          if (result.status === 'shared') {
            markExported(data, ctx);
            close();
            toast('备份已导出', 'success');
          } else if (result.status === 'cancelled') {
            toast('已取消备份', 'info');
          } else {
            toast('分享没有成功，可以改用“下载备份”', 'error');
          }
        });
      });
    }
  });

  return { dialog, close };
}

/**
 * 保存记录后自动分享。必须在保存/确认按钮的同步调用栈里调用。
 * 数据已经保存；这里的分享失败不会回滚保存。
 */
export function autoShareAfterSave(data, ctx) {
  if (data.settings.autoShareAfterSave === false) {
    return Promise.resolve({ status: 'skipped' });
  }

  // 如果用户激活已经过期（例如在确认弹窗停留很久），不要强行调用 share。
  if (navigator.userActivation && navigator.userActivation.isActive === false) {
    showManualBackupFallback(data, ctx);
    return Promise.resolve({ status: 'fallback' });
  }

  const promise = shareBackupFile(data);

  return promise.then((result) => {
    if (result.status === 'shared') {
      markExported(data, ctx);
      toast('备份已导出', 'success');
      return result;
    }

    if (result.status === 'cancelled') {
      toast('已保存，本次未导出备份', 'info');
      return result;
    }

    if (result.status === 'unsupported' && !isIOS()) {
      // 桌面浏览器没有分享能力：直接下载。
      downloadBackupFile(result);
      markExported(data, ctx);
      toast('备份文件已下载', 'success');
      return { ...result, status: 'downloaded' };
    }

    showManualBackupFallback(data, ctx);
    return result;
  });
}

/** 设置页的手动导出；同样在点击的同步调用栈里调用。 */
export function exportBackupInteractive(data, ctx) {
  const promise = shareBackupFile(data);

  return promise.then((result) => {
    if (result.status === 'shared') {
      markExported(data, ctx);
      toast('备份已导出', 'success');
      return result;
    }

    if (result.status === 'cancelled') {
      toast('已取消导出', 'info');
      return result;
    }

    downloadBackupFile(result);
    markExported(data, ctx);
    toast('备份文件已下载', 'success');
    return { ...result, status: 'downloaded' };
  });
}
