/* 업무 관리자 — 서비스 워커 (v13.355)
 *  - 휴대폰 · PC 에 "앱으로 설치" 할 수 있게 하는 최소 구성
 *  - 데이터는 늘 서버에서 (사내 업무 데이터라 오프라인 저장 안 함). 서버가 잠들어 있거나 끊겼을 때만 안내 화면
 *  - 알림(push) 받기 · 누르면 그 자리로 — Web Push(VAPID) 는 다음 단계에서 서버가 보냄
 */
var OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>업무 관리자</title><body style="font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f1220;color:#e5e7eb;text-align:center">' +
  '<div><div style="font-size:48px">📡</div><h2>서버에 닿지 않습니다</h2><p style="color:#9ca3af">인터넷 연결을 확인하거나, 서버가 깨어나는 중이면 잠시 뒤 다시 시도해 주세요.</p>' +
  '<button onclick="location.reload()" style="padding:10px 20px;border-radius:8px;border:0;background:#2563EB;color:#fff;font-size:15px">다시 시도</button></div>';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;   // 화면 이동만 — API · 파일은 손대지 않음
  e.respondWith(fetch(e.request).catch(function () {
    return new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  var jobs = [self.registration.showNotification(d.title || '업무 관리자', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', data: { go: d.go || '' }
  })];
  // v13.501 ⬆ 새 버전 — 홈 화면 앱 아이콘에 표시(앱을 열면 안 읽은 수로 되돌아감)
  if (d.kind === 'update' && self.navigator && self.navigator.setAppBadge) jobs.push(self.navigator.setAppBadge().catch(function () {}));
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var go = (e.notification.data && e.notification.data.go) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0) { list[i].postMessage({ wmGo: go }); return list[i].focus(); }
    }
    return self.clients.openWindow('/' + (go ? '?go=' + encodeURIComponent(go) : ''));
  }));
});
