/* pd-win.js — 📁 프로젝트 상세를 별도 창으로 (v13.464)
 *   상세 패널 머리의 ↗ 단추 → wmPdPop(id): 같은 주소에 ?pd=ID 를 붙여 새 창으로 (창 자리 · 크기 기억, 같은 프로젝트면 그 창을 앞으로)
 *   새 창(html.wm-pdwin): 평소처럼 로그인 · 데이터를 받은 뒤 그 프로젝트 상세만 창 가득 — 머리 · 탭 · 뒤 화면은 숨김
 *     · 로그인은 본 창 것을 그대로 (auth.js _wmAuthPeer — 갱신 토큰은 한 번 쓰면 바뀌어 창마다 갱신하면 서로 로그아웃)
 *     · 본 창의 '마지막 화면' 을 바꾸지 않음 · 메신저 실시간 연결 · 공지 창은 본 창만 (소리 두 번 나지 않게)
 *     · 고치면(GET 아닌 요청) BroadcastChannel 'wm-pdwin' 으로 알림 → 본 창은 프로젝트 목록 · 화면 캐시를 비우고 다시 그림
 *   머리(head)에서 바로 읽힘 — 가장 먼저 WM_PDWIN 과 html 클래스를 정해야 다른 코드가 그것을 봄. */
(function () {
  var q = null; try { q = new URLSearchParams(location.search); } catch (e) {}
  var id = q && q.get('pd');
  if (id) { window.WM_PDWIN = { id: id }; document.documentElement.classList.add('wm-pdwin'); }
})();

var WM_PDW = { bc: null, t: 0 };
function _pdwLs(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
function _pdwChan() {
  if (WM_PDW.bc || typeof BroadcastChannel !== 'function') return WM_PDW.bc;
  try {
    WM_PDW.bc = new BroadcastChannel('wm-pdwin');
    WM_PDW.bc.onmessage = function (e) {
      var d = e.data || {};
      if (window.WM_PDWIN) { if (d.t === 'focus' && d.id === window.WM_PDWIN.id) { try { window.focus(); } catch (x) {} } return; }
      if (d.t === 'changed') _pdwMainRefresh(d.id);
    };
  } catch (e) {}
  return WM_PDW.bc;
}
function _pdwName(id) { return 'wmpd_' + String(id).replace(/[^A-Za-z0-9]/g, '_'); }
/** 본 창 — 프로젝트 상세를 새 창으로 */
function wmPdPop(id) {
  if (!id) return false;
  if (window.WM_PDWIN) return false;
  var pos = null; try { pos = JSON.parse(_pdwLs('wm-pdw-pos') || 'null'); } catch (e) {}
  var sw = (window.screen && screen.availWidth) || 1920, sh = (window.screen && screen.availHeight) || 1080;
  var w = pos && pos.w ? pos.w : Math.min(1280, sw - 80), h = pos && pos.h ? pos.h : Math.min(940, sh - 60);
  var x = pos && pos.x != null ? pos.x : Math.max(0, (window.screenX || 0) + 60), y = pos && pos.y != null ? pos.y : Math.max(0, (window.screenY || 0) + 40);
  var win = null;
  try { win = window.open(location.pathname + '?pd=' + encodeURIComponent(id), _pdwName(id), 'popup=yes,width=' + Math.round(w) + ',height=' + Math.round(h) + ',left=' + Math.round(x) + ',top=' + Math.round(y)); } catch (e) {}
  if (!win) { if (typeof showToast === 'function') showToast('새 창이 막혔습니다 — 브라우저의 팝업 차단을 이 사이트에서 풀어 주세요', 'warn'); return false; }
  if (typeof pdCloseDetail === 'function') pdCloseDetail();
  try { win.focus(); } catch (e) {}
  return true;
}
/* 본 창 — 새 창에서 고친 것 반영 (목록 · 타임라인 등은 다시 받아 그림, 열어 둔 상세는 건드리지 않음 — 쓰는 중일 수 있음) */
function _pdwMainRefresh(id) {
  if (typeof _pdInvalidate === 'function') _pdInvalidate();
  if (typeof _modeRendered !== 'undefined') Object.keys(_modeRendered).forEach(function (k) { delete _modeRendered[k]; });
  clearTimeout(WM_PDW.t);
  WM_PDW.t = setTimeout(function () {
    if (typeof curPage !== 'undefined' && curPage === 'project' && !document.getElementById('projDetailPanel') && !document.querySelector('.wa-modal-overlay') && typeof refreshCurrentTab === 'function') refreshCurrentTab();
  }, 600);
}
/* 새 창 — 데이터를 받은 뒤 그 프로젝트 상세를 창 가득 (app-init.js 가 부름) */
function wmPdWinInit() {
  var id = window.WM_PDWIN && window.WM_PDWIN.id; if (!id) return;
  _pdwChan();
  // 고친 것 알림 — GET 아닌 요청이 끝나면 (마일스톤 · 체크리스트 · 이슈 · 사양 … 모두)
  if (typeof apiFetch === 'function' && !apiFetch._pdw) {
    var orig = apiFetch;
    apiFetch = function (url, opts) {
      var p = orig.apply(this, arguments);
      if (opts && opts.method && opts.method !== 'GET') p.then(function () { try { _pdwChan() && WM_PDW.bc.postMessage({ t: 'changed', id: id }); } catch (e) {} }, function () {});
      return p;
    };
    apiFetch._pdw = true;
  }
  var open = function () {
    if (typeof showProjectDetail !== 'function') return;
    Promise.resolve(showProjectDetail(id)).then(function () {
      var p = document.getElementById('projDetailPanel');
      if (!p) { _pdwEmpty('프로젝트를 열 수 없습니다 — 지워졌거나 볼 권한이 없습니다'); return; }
      p.classList.add('pd-max');
      var h = p.querySelector('h3'); document.title = '📁 ' + ((h && h.textContent) || '프로젝트') + ' — 업무 관리자';
    });
  };
  open();
  // 패널이 닫히면(삭제 · 편집 창이 다시 못 열었을 때) 빈 화면 대신 안내
  setInterval(function () {
    if (document.getElementById('projDetailPanel') || document.getElementById('projModal') || document.querySelector('.wa-modal-overlay')) { var e = document.getElementById('pdwEmpty'); if (e) e.remove(); return; }
    if (!document.getElementById('pdwEmpty')) _pdwEmpty('프로젝트 창');
  }, 1500);
  window.addEventListener('beforeunload', function () {
    try { _pdwLs('wm-pdw-pos', JSON.stringify({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight })); } catch (e) {}
  });
  window.wmPdReopen = function () { var e = document.getElementById('pdwEmpty'); if (e) e.remove(); open(); };
}
function _pdwEmpty(msg) {
  var d = document.createElement('div'); d.id = 'pdwEmpty'; d.className = 'pdw-empty';
  d.innerHTML = '<div><b>' + (typeof eH === 'function' ? eH(msg) : msg) + '</b><div class="pdw-empty-a"><button class="btn btn-g" onclick="wmPdReopen()">↻ 다시 열기</button><button class="btn btn-g" onclick="window.close()">창 닫기</button></div></div>';
  document.body.appendChild(d);
}
/** 상세 ✕ — 새 창이면 창을 닫음 */
function pdCloseBtn() { if (window.WM_PDWIN) { window.close(); return; } if (typeof pdCloseDetail === 'function') pdCloseDetail(); }
if (!window.WM_PDWIN) _pdwChan();
