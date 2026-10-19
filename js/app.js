/**
 * 应用入口：路由、主题、底部导航、Service Worker、跨天检测。
 */

import { createStore } from './store.js';
import {
  downloadText,
  escapeHtml,
  isIOS,
  isStandalone,
  toast,
  todayStr
} from './utils.js';

import * as homeView from './views/home.js';
import * as recordView from './views/record.js';
import * as incomeView from './views/income.js';
import * as historyView from './views/history.js';
import * as settingsView from './views/settings.js';

const routes = {
  home: homeView,
  record: recordView,
  income: incomeView,
  history: historyView,
  settings: settingsView
};

const store = createStore();
const loadResult = store.load();
const app = document.getElementById('app');
const loading = document.getElementById('app-loading');
const tabbar = document.querySelector('.tabbar');

let currentDay = todayStr();

const ctx = {
  store,
  get data() {
    return store.get();
  },
  route: { name: 'home', param: null },
  navigate,
  rerender,
  applyTheme,
  save() {
    const result = store.set(store.get());
    if (!result.ok) toast(result.error, 'error');
    return result.ok;
  }
};

function isDarkTheme(theme) {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true;
}

function applyTheme(theme = 'system') {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDarkTheme(theme) ? '#0f1115' : '#f5f6f8');
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, param] = raw.split('/');
  if (Object.prototype.hasOwnProperty.call(routes, name)) {
    return { name, param: param ? decodeURIComponent(param) : null };
  }
  return { name: 'home', param: null };
}

function updateTabs(activeName) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const isActive = tab.dataset.tab === activeName;
    tab.classList.toggle('is-active', isActive);
    if (isActive) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}

function render(options = {}) {
  const data = store.get();
  if (!data) return;

  const route = parseRoute();
  ctx.route = route;
  app.innerHTML = '';

  try {
    routes[route.name].render(app, ctx);
  } catch (error) {
    console.error(error);
    app.innerHTML = `
      <div class="card error-card">
        <h1>页面出错了</h1>
        <p>${escapeHtml(error.message || '未知错误')}</p>
        <button class="btn btn--primary btn--block" data-reload>重新加载</button>
      </div>`;
    app.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
  }

  updateTabs(route.name);
  if (!options.keepScroll) window.scrollTo(0, 0);
}

function rerender(options = { keepScroll: true }) {
  render(options);
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function renderLoadError(result) {
  loading?.remove();
  if (tabbar) tabbar.hidden = true;
  app.hidden = false;

  app.innerHTML = `
    <div class="card error-card">
      <h1>数据读取失败</h1>
      <p>${escapeHtml(result.error || '未知错误')}</p>
      <div class="stack">
        ${result.raw ? '<button class="btn btn--primary btn--block" data-export>先导出原始数据</button>' : ''}
        <button class="btn btn--ghost btn--block" data-reload>重新加载</button>
      </div>
      <p class="tiny" style="margin-top:14px">不要清理浏览器数据。先导出原始内容，再处理问题。</p>
    </div>`;

  app.querySelector('[data-export]')?.addEventListener('click', () => {
    downloadText(`资产收盘-原始数据-${todayStr()}.json`, result.raw || '');
  });
  app.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
}

function addSafariBanner() {
  if (!isIOS() || isStandalone()) return;
  try {
    if (sessionStorage.getItem('assetTracker.safariBannerDismissed') === '1') return;
  } catch (_) { /* ignore */ }

  const banner = document.createElement('div');
  banner.className = 'safari-banner';
  banner.innerHTML = `
    <div class="safari-banner__inner">
      <div class="safari-banner__body">
        <strong>你现在在 Safari 里打开</strong>
        请点 Safari 的分享按钮（方框向上箭头）→「添加到主屏幕」，之后固定从主屏幕图标录入。
        Safari 和主屏幕应用的数据互不相通。
      </div>
      <button type="button" class="icon-btn" data-dismiss aria-label="关闭提示">×</button>
    </div>`;
  document.body.insertBefore(banner, app);
  banner.querySelector('[data-dismiss]').addEventListener('click', () => {
    try { sessionStorage.setItem('assetTracker.safariBannerDismissed', '1'); } catch (_) { /* ignore */ }
    banner.remove();
  });
}

function showUpdateBanner(worker) {
  if (document.querySelector('.update-banner')) return;

  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span>有新版本可用</span>
    <button type="button" data-refresh>刷新</button>
    <button type="button" data-later>稍后</button>`;
  document.body.appendChild(banner);

  banner.querySelector('[data-later]').addEventListener('click', () => banner.remove());
  banner.querySelector('[data-refresh]').addEventListener('click', () => {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    }, { once: true });
    worker.postMessage('SKIP_WAITING');
    setTimeout(() => {
      if (!reloaded) location.reload();
    }, 1500);
  });
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');

      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(worker);
          }
        });
      });
    } catch (error) {
      console.warn('Service Worker 注册失败：', error);
    }
  });
}

function checkNewDay() {
  if (document.visibilityState !== 'visible') return;
  const day = todayStr();
  if (day !== currentDay) {
    currentDay = day;
    render();
    toast('新的一天，记得记录今天的资产');
  }
}

function init() {
  if (!loadResult.ok) {
    renderLoadError(loadResult);
    return;
  }

  applyTheme(store.get().settings.theme || 'system');

  // 尽量申请持久存储；即便系统不支持，也不影响使用，备份仍然是唯一保险。
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch (_) { /* ignore */ }

  loading?.remove();
  app.hidden = false;

  addSafariBanner();
  setupServiceWorker();

  if (!location.hash) {
    history.replaceState(null, '', '#/home');
  }

  render();

  window.addEventListener('hashchange', () => render());

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      const href = tab.getAttribute('href');
      if (location.hash === href) {
        event.preventDefault();
        render();
      }
    });
  });

  globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', () => {
    const theme = store.get()?.settings.theme || 'system';
    if (theme === 'system') applyTheme('system');
  });

  document.addEventListener('visibilitychange', checkNewDay);
  window.addEventListener('focus', checkNewDay);
  setInterval(checkNewDay, 60_000);
}

init();
