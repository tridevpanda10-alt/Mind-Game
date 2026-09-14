// Service worker: caches the static app shell for offline load. Data and API
// calls are NEVER cached (match/score/diamond endpoints stay network-only).
// Bump the version whenever precached files change, or users keep the old UI.
const CACHE = 'mindgame-shell-v2';
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/render.js',
  '/js/theme.js',
  '/js/ads.js',
  '/js/ads/mock.js',
  '/js/ads/google-h5.js',
  '/js/screens/home.js',
  '/js/screens/game.js',
  '/js/screens/results.js',
  '/js/screens/training.js',
  '/js/screens/leaderboard.js',
  '/js/screens/profile.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network-only for all API and dynamic data paths.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/match') || url.pathname.startsWith('/tournament')) return;
  // Cache-first for the app shell (static assets only).
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)),
  );
});
