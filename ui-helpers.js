/* ═══ ui-helpers.js — 작은 공용 UI 헬퍼 (동기 로드, project-data.js 다음) ═══ */

/**
 * 재렌더로 새로 그려진 입력창에 포커스·캐럿을 되돌린다.
 * 검색창 디바운스 렌더 뒤 입력이 끊기지 않게 하는 용도.
 *   id    — 입력창 id
 *   caret — 캐럿 위치 (생략하면 끝). 값 길이를 넘으면 끝으로 맞춤
 * 반환: 입력 요소 (없으면 null)
 */
function wmRestoreFocus(id, caret) {
  var el = document.getElementById(id);
  if (!el) return null;
  el.focus();
  var n = (el.value || '').length;
  var pos = caret == null ? n : Math.min(caret, n);
  try { el.setSelectionRange(pos, pos); } catch (e) { /* 캐럿을 지원하지 않는 input type */ }
  return el;
}

/**
 * 터치 → 마우스 끌기 (v13.257). 마우스 전용으로 짠 끌기 코드를 손가락으로도 쓰게 한다.
 * 한 손가락으로 끌면 처음 누른 자리에 mousedown, 움직일 때 mousemove, 뗄 때 mouseup 을 보낸다.
 * 끌지 않고 톡 누르면 아무것도 안 함 — 브라우저가 보내는 원래 클릭이 그대로 간다.
 *   opt.hold    — ms. 이만큼 누르고 있어야 끌기 시작 (그 전에 움직이면 화면 스크롤). 스크롤 상자 안 막대용
 *   opt.onPinch — function(배율, 중심x, 중심y, 중심 이동x, 이동y). 두 손가락 확대·이동
 * 요소에 CSS touch-action:none 이 있어야 iOS 가 화면을 같이 밀지 않는다 (hold 쓰는 곳은 제외).
 */
function wmTouchDrag(el, opt) {
  if (!el || el._wmTouch || !('ontouchstart' in window)) return;
  el._wmTouch = true;
  opt = opt || {};
  var st = null, pin = null;
  function fire(type, target, x, y) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
  }
  function two(e) {
    var a = e.touches[0], b = e.touches[1];
    return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
  }
  el.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2 && opt.onPinch) {
      if (st && st.started) fire('mouseup', st.target, st.lx, st.ly);
      st = null;
      pin = two(e);
      return;
    }
    if (e.touches.length !== 1) { st = null; return; }
    var t = e.touches[0];
    st = { x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, target: e.target, started: false, ready: !opt.hold };
    if (opt.hold) {
      var me = st;
      me.timer = setTimeout(function () { if (st === me) { me.ready = true; if (navigator.vibrate) navigator.vibrate(10); } }, opt.hold);
    }
  }, { passive: true });
  el.addEventListener('touchmove', function (e) {
    if (pin && e.touches.length === 2) {
      e.preventDefault();
      var p = two(e);
      opt.onPinch(p.d / pin.d, p.cx, p.cy, p.cx - pin.cx, p.cy - pin.cy);
      pin = p;
      return;
    }
    if (!st || e.touches.length !== 1) return;
    var t = e.touches[0];
    if (!st.ready) { clearTimeout(st.timer); st = null; return; }   // 길게 누르기 전에 움직임 → 스크롤
    e.preventDefault();
    if (!st.started) {
      if (Math.abs(t.clientX - st.x) + Math.abs(t.clientY - st.y) < 6) return;
      st.started = true;
      fire('mousedown', st.target, st.x, st.y);
    }
    st.lx = t.clientX; st.ly = t.clientY;
    fire('mousemove', st.target, t.clientX, t.clientY);
  }, { passive: false });
  function end(e) {
    if (pin) { if (e.touches.length < 2) pin = null; return; }
    if (!st) return;
    clearTimeout(st.timer);
    if (st.started) { e.preventDefault(); fire('mouseup', st.target, st.lx, st.ly); }
    st = null;
  }
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: false });
}

/* ═══ 무거운 라이브러리는 나중에 (v13.310) ═══
 * 엑셀(xlsx 861KB) · 워드(mammoth 628KB) · PDF(jspdf · pdf.js) · 캡처(html2canvas) · 압축(jszip) 을
 * 첫 화면에서 받지 않는다 (모두 2.3MB+ — 휴대폰 첫 화면이 늦던 주원인).
 *  · 첫 화면을 그린 뒤 브라우저가 한가할 때 뒤에서 받아 둠 (wmLibsIdle) → 대부분 누를 때는 이미 있음
 *  · 그 전에 누르면 wmLibRetry 가 받고 나서 같은 함수를 다시 부름
 */
var WM_LIBS = {
  xlsx: { url: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', ok: function () { return typeof XLSX !== 'undefined'; } },
  html2canvas: { url: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', ok: function () { return typeof html2canvas !== 'undefined'; } },
  jspdf: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', ok: function () { return !!window.jspdf; } },
  // 표 그리기 — jspdf 다음에 받아야 함 (v13.344 A/S 보고서 벡터 PDF)
  jspdfAutotable: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', ok: function () { return !!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable); } },
  pdfjs: { url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', ok: function () { return typeof pdfjsLib !== 'undefined'; },
    after: function () { try { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; } catch (_) {} } },
  jszip: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', ok: function () { return typeof JSZip !== 'undefined'; } },
  mammoth: { url: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js', ok: function () { return typeof mammoth !== 'undefined'; } }
};
var _wmLibP = {};
/** 라이브러리 받기 → Promise (이미 있으면 바로) · 이름 여러 개도 됨 */
function wmLib(name) {
  if (Array.isArray(name)) return Promise.all(name.map(wmLib));
  var L = WM_LIBS[name];
  if (!L) return Promise.reject(new Error('모르는 라이브러리 ' + name));
  if (L.ok()) return Promise.resolve();
  if (_wmLibP[name]) return _wmLibP[name];
  _wmLibP[name] = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = L.url; s.async = true;
    s.onload = function () { if (L.after) L.after(); resolve(); };
    s.onerror = function () { delete _wmLibP[name]; reject(new Error(name + ' 을(를) 불러오지 못했습니다 — 인터넷 연결을 확인하세요')); };
    document.head.appendChild(s);
  });
  return _wmLibP[name];
}
/** 함수 첫머리에서: if (wmLibRetry('xlsx', fn, this, arguments)) return; — 없으면 받고 나서 fn 을 다시 부르고 true */
function wmLibRetry(name, fn, self, args) {
  var names = Array.isArray(name) ? name : [name];
  if (names.every(function (n) { return WM_LIBS[n] && WM_LIBS[n].ok(); })) return false;
  if (typeof showToast === 'function') showToast('⏳ 도구를 불러오는 중…', 'info');
  wmLib(names).then(function () { fn.apply(self, args); })
    .catch(function (e) { if (typeof showToast === 'function') showToast('❌ ' + e.message, 'error'); });
  return true;
}
/** 첫 화면 뒤 한가할 때 하나씩 받아 둠 */
function wmLibsIdle() {
  var order = ['xlsx', 'jszip', 'html2canvas', 'pdfjs', 'jspdf', 'mammoth'];
  var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1200); };
  (function next() {
    var n = order.shift(); if (!n) return;
    idle(function () { wmLib(n).catch(function () {}).then(next); }, { timeout: 4000 });
  })();
}

/** 붙여넣은 파일 목록 → 이름 붙이기 (화면 캡처는 이름이 'image.png' 라 '붙여넣기-날짜-시각.png' 로) — 문서 화면 · 프로젝트 문서 탭 공용 (v13.310) */
function wmPastedFiles(e) {
  var files = (e && e.clipboardData && e.clipboardData.files) || [];
  if (!files.length) return [];
  var d = new Date(), p2 = function (n) { return ('0' + n).slice(-2); };
  var stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  return Array.prototype.map.call(files, function (f, i) {
    if (f.name && f.name !== 'image.png') return f;
    var ext = ((f.type || '').split('/')[1] || 'png').replace('jpeg', 'jpg');
    try { return new File([f], '붙여넣기-' + stamp + (i ? '-' + i : '') + '.' + ext, { type: f.type }); } catch (_) { return f; }
  });
}
/** 입력 칸 · 창이 열려 있으면 붙여넣기를 가로채지 않음 */
function wmPasteTargetFree(e) {
  var t = e && e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return false;
  return !document.querySelector('.wa-modal-overlay');
}
