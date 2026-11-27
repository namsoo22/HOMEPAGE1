/* 꽃순이 오피스 · 서비스 워커
   정적 리소스: 네트워크 우선 + 폴백 캐시
   Firebase / 외부 API: 그대로 통과 (캐시하지 않음) */
const CACHE = 'ggc-office-v3';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './icon-512.png',
  './icon.svg',
  './apple-touch-icon.png',
  './office-scene.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // 같은 출처의 정적 리소스만 다룬다. Firebase·gstatic 등 외부 요청은 브라우저에 그대로 맡긴다.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/__/')) return;   // Firebase Realtime Database REST 경로

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
