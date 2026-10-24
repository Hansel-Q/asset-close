/**
 * Service Worker：离线缓存 + 新版本提示。
 * 所有 URL 都用相对路径，保证部署在 GitHub Pages 子目录下也能工作。
 */

const CACHE_NAME = 'asset-close-v1.1.0';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/calc.js',
  './js/utils.js',
  './js/chart.js',
  './js/backup.js',
  './js/views/home.js',
  './js/views/record.js',
  './js/views/history.js',
  './js/views/settings.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.svg'
];

const INDEX_URL = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(INDEX_URL, response.clone());
        }
        return response;
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(request)) ||
          (await cache.match(INDEX_URL)) ||
          new Response('离线状态，且没有缓存页面。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
          });
      }
    })());
    return;
  }

  // 图标等图片缓存优先；其余静态资源优先拿最新版本，离线时回退缓存。
  if (request.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        return new Response('离线状态，图片不可用。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      return new Response('离线状态，资源不可用。', {
        status: 503,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }
      });
    }
  })());
});
