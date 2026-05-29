// 스이카: 모찌&디저트 — 서비스 워커
// 캐시 버전을 올리면 사용자 기기에서 자동 갱신
const CACHE_NAME = 'suika-mochi-v2';

// 캐시할 자산 (상대 경로 — GitHub Pages 서브 경로 호환)
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './src/storage.js',
  './src/audio.js',
  './src/desserts.js',
  './src/physics.js',
  './src/render.js',
  './src/game.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './assets/Sunday_Paper.mp4',
  // 외부 자산 (CDN)
  'https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js',
  'https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=Quicksand:wght@500;700&display=swap',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 일부 자산이 실패해도 설치는 계속
      return Promise.allSettled(
        ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] 캐시 실패:', url, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// 캐시 우선, 없으면 네트워크 — 게임은 정적이라 적합
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // http(s)만 처리 — chrome-extension://, moz-extension:// 같은 스킴은 Cache API가 거부함
  if (!req.url.startsWith('http')) return;

  // 분석 비콘은 캐시 우회 — 실시간 집계 보장
  if (req.url.includes('cloudflareinsights.com')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // 동일 출처만 동적으로 캐시 추가
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // 오프라인 폴백 — 메인 페이지
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
