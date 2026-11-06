// 離線快取：改版時更新 VERSION，使用者下次開啟就會自動換成新版
const VERSION = 'obs-2.0.0-alpha-7';
const FILES = [
  './', './index.html', './app.css', './manifest.webmanifest',
  './js/app.js', './js/model.js', './js/output.js', './js/store.js',
  './vendor/xlsx.full.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './guide.html',
  './guide/img/01-home.webp', './guide/img/02-utc-setup.webp', './guide/img/03-utc-record.webp',
  './guide/img/04-atc-record.webp', './guide/img/05-dtc-typing.webp', './guide/img/06-dtc-desktop.webp',
  './guide/img/08-result-timeline.webp', './guide/img/09-result-stats.webp', './guide/img/10-export.webp',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' 繞過瀏覽器的 HTTP 快取，確保存進來的是剛發布的新檔案
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 先用快取（離線也能開），同時在背景更新
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
