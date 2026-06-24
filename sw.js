const CACHE_NAME = 'gastos-ia-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/gemini.js',
  './js/sheets.js',
  './js/storage.js',
  './manifest.json',
  './icons/icon.svg'
];

/* ── Install: cache static assets ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: network-first for API, cache-first for assets ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Network-only for API calls (Gemini, Apps Script)
  if (
    request.url.includes('generativelanguage.googleapis.com') ||
    request.url.includes('script.google.com')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Cache new static resources
        if (response.ok && request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
