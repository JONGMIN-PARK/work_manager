var CACHE_NAME = 'wm-v2';
var DATA_CACHE = 'wm-data-v1';

var SHELL_URLS = ['/', '/dashboard', '/login', '/register'];

// 오프라인 캐시 대상 API (읽기 전용 데이터)
var CACHEABLE_API = [
  '/api/projects', '/api/issues', '/api/orders',
  '/api/events', '/api/milestones', '/api/stats',
  '/api/auth/me', '/api/notifications/unread-count'
];

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
      return Promise.all(keys.filter(function(k) {
        return k !== CACHE_NAME && k !== DATA_CACHE;
      }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // API 요청: Network First + 캐시 폴백 (GET만)
  if (url.pathname.startsWith('/api/') && e.request.method === 'GET') {
    var isCacheable = CACHEABLE_API.some(function(path) {
      return url.pathname.startsWith(path);
    });

    if (isCacheable) {
      e.respondWith(
        fetch(e.request).then(function(response) {
          // 성공 응답만 캐시
          if (response.ok) {
            var clone = response.clone();
            caches.open(DATA_CACHE).then(function(cache) {
              cache.put(e.request, clone);
            });
          }
          return response;
        }).catch(function() {
          // 오프라인: 캐시에서 응답
          return caches.match(e.request).then(function(cached) {
            if (cached) return cached;
            return new Response(JSON.stringify({
              error: 'OFFLINE',
              message: '오프라인 상태입니다. 네트워크를 확인하세요.'
            }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
      );
      return;
    }

    // 캐시 불가 API: 네트워크만
    return;
  }

  // 정적 파일: Cache First + 네트워크 폴백
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/)) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML 페이지: Network First + Shell 폴백
  e.respondWith(
    fetch(e.request).catch(function() {
      return caches.match(e.request).then(function(r) {
        return r || caches.match('/');
      });
    })
  );
});

// 백그라운드 동기화 (나중에 전송할 오프라인 작업 큐)
self.addEventListener('sync', function(e) {
  if (e.tag === 'sync-pending') {
    e.waitUntil(syncPendingRequests());
  }
});

async function syncPendingRequests() {
  // 향후 오프라인 쓰기 지원용
  console.log('[SW] Syncing pending requests...');
}
