const CACHE_NAME = 'arrow-by-arrow-pwa-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './src/ui/styles.css',
  './src/ui/app.js',
  './src/renderer/canvasView.js',
  './src/audio/soundAndHaptics.js',
  './src/engine/patterns.js',
  './src/engine/generator.js',
  './src/engine/solver.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
