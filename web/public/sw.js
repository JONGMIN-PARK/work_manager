var CACHE_NAME = 'wm-v1';
var SHELL_URLS = ['/', '/dashboard', '/login'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // API requests: network only
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request).catch(function() {
      return caches.match(e.request).then(function(r) {
        return r || caches.match('/');
      });
    })
  );
});
