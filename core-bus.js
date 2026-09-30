/* core-bus.js — 전역 진행 모달(wmProgress) · 인원 칩 접힘 · sticky KPI · 초기 로딩 단계 회전 · 크로스탭 이벤트 버스(wmDataBus) · 탭 의존 맵(WM_TAB_DEPS) + 활성 탭 자동 재렌더. <head> 에서 다른 모든 스크립트보다 먼저 로드
 * 업무일지_분석기.html <head> 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리에서 로드(defer/async 금지 — 뒤에 오는 모든 스크립트가 wmDataBus·wmProgress 를 전역으로 기대). */
/* ═══ wmDataBus — 크로스탭 이벤트 버스 (v13.40 L3) ═══
   다른 모든 스크립트보다 먼저 정의되도록 인라인 동기 로드.
   사용:
     wmDataBus.on('project', function(e){ ... });   // type별 listener
     wmDataBus.on('*', function(e){ ... });          // 와일드카드
     wmDataBus.emit('project','updated',{id:'p1'});  // mutator에서 호출
   payload: { type, action, detail }
   action 권장값: 'created' | 'updated' | 'deleted' | 'bulk' */
/* v13.66 — 글로벌 진행 모달 API
 * wmProgress.show({icon, title, sub, tip, cancelable, onCancel})
 * wmProgress.update({sub?, step?, icon?})  — 단계 메시지 갱신
 * wmProgress.step(text)                    — 현재 단계만 빠르게 갱신
 * wmProgress.hide()
 * wmProgress.run(opts, asyncFn)            — 자동 wrap (try/finally hide)
 */
window.wmProgress = (function () {
  var _stepTimer = null;
  function _esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function _ensure() {
    var ov = document.getElementById('wmProgOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'wmProgOverlay';
    document.body.appendChild(ov);
    return ov;
  }
  function show(opts) {
    opts = opts || {};
    var ov = _ensure();
    var icon = opts.icon || '⏳';
    var title = opts.title || '처리 중…';
    var sub = opts.sub || '';
    var step = opts.step || '';
    var tip = opts.tip || '';
    var cancelable = !!opts.cancelable;
    ov.innerHTML =
      '<div class="wm-prog-card">' +
      '<div class="wm-prog-ring-wrap">' +
        '<div class="wm-prog-ring"></div>' +
        '<div class="wm-prog-ring2"></div>' +
        '<div class="wm-prog-ring-icon" id="wmProgIcon">' + _esc(icon) + '</div>' +
      '</div>' +
      '<div class="wm-prog-title" id="wmProgTitle">' + _esc(title) +
        '<span class="wm-prog-dots"><span></span><span></span><span></span></span></div>' +
      '<div class="wm-prog-sub" id="wmProgSub">' + _esc(sub) + '</div>' +
      (step ? '<div class="wm-prog-step" id="wmProgStep">' + _esc(step) + '</div>' : '<div id="wmProgStep" style="display:none"></div>') +
      '<div class="wm-prog-bar"><div class="wm-prog-bar-fill"></div></div>' +
      (tip ? '<div class="wm-prog-tip">' + _esc(tip) + '</div>' : '') +
      (cancelable ? '<button class="wm-prog-cancel" id="wmProgCancel">취소</button>' : '') +
      '</div>';
    if (cancelable && typeof opts.onCancel === 'function') {
      var btn = document.getElementById('wmProgCancel');
      if (btn) btn.onclick = function () { opts.onCancel(); hide(); };
    }
    document.body.style.overflow = 'hidden';
  }
  function update(opts) {
    opts = opts || {};
    var ov = document.getElementById('wmProgOverlay');
    if (!ov) return;
    if (opts.title != null) {
      var t = document.getElementById('wmProgTitle');
      if (t) t.firstChild.nodeValue = String(opts.title);
    }
    if (opts.sub != null) {
      var s = document.getElementById('wmProgSub');
      if (s) s.innerHTML = _esc(opts.sub);
    }
    if (opts.step != null) {
      var st = document.getElementById('wmProgStep');
      if (st) {
        st.innerHTML = _esc(opts.step);
        st.style.display = opts.step ? 'inline-block' : 'none';
        // pop 애니메이션 재시작
        st.style.animation = 'none';
        void st.offsetWidth;
        st.style.animation = '';
      }
    }
    if (opts.icon != null) {
      var ic = document.getElementById('wmProgIcon');
      if (ic) ic.innerHTML = _esc(opts.icon);
    }
  }
  function step(text) { update({ step: text }); }
  function hide() {
    var ov = document.getElementById('wmProgOverlay');
    if (ov) ov.remove();
    document.body.style.overflow = '';
    if (_stepTimer) { clearTimeout(_stepTimer); _stepTimer = null; }
  }
  /* 미리 정의된 단계 시퀀스를 자동으로 흘려보내는 헬퍼 */
  function autoSteps(steps, intervalMs) {
    if (_stepTimer) clearTimeout(_stepTimer);
    var i = 0;
    function tick() {
      if (!document.getElementById('wmProgOverlay')) return;
      if (i < steps.length) { step(steps[i]); i++; _stepTimer = setTimeout(tick, intervalMs || 1200); }
    }
    tick();
  }
  /* try/finally 자동 wrap */
  function run(opts, asyncFn) {
    show(opts);
    return Promise.resolve().then(asyncFn).then(function (r) { hide(); return r; },
      function (err) { hide(); throw err; });
  }
  return { show: show, update: update, step: step, hide: hide, autoSteps: autoSteps, run: run };
})();

/* v13.69 — 주간 분석 시인성 보조
 *  · 인원 칩 영역 접힘/펼침 (localStorage에 상태 저장)
 *  · sticky KPI 카드가 스크롤에 의해 떠 있을 때 그림자 강조
 */
window.toggleNameChipsCollapse = function () {
  var el = document.getElementById('nameChips');
  var btn = document.getElementById('chipsToggle');
  if (!el) return;
  var collapsed = !el.classList.contains('chips-collapsed');
  el.classList.toggle('chips-collapsed', collapsed);
  if (btn) {
    btn.innerHTML = (collapsed ? '▼ <span>펼치기</span>' : '▲ <span>접기</span>');
    btn.title = collapsed ? '인원 칩 펼치기' : '인원 칩 접기';
  }
  try { localStorage.setItem('wm-chips-collapsed', collapsed ? '1' : '0'); } catch (e) {}
};
(function _initChipsCollapse() {
  function apply() {
    var saved = (function () { try { return localStorage.getItem('wm-chips-collapsed') === '1'; } catch (e) { return false; } })();
    if (saved) {
      var el = document.getElementById('nameChips');
      var btn = document.getElementById('chipsToggle');
      if (el) el.classList.add('chips-collapsed');
      if (btn) btn.innerHTML = '▼ <span>펼치기</span>';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
// sticky KPI 그림자 (스크롤에 의해 떠있는 상태 감지)
(function _initStickyShadow() {
  function bind() {
    var s = document.getElementById('kpiSticky');
    if (!s) return;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        // intersectionRatio < 1 = sticky 상태로 떠 있음
        s.classList.toggle('is-stuck', e.intersectionRatio < 1 && e.boundingClientRect.top <= 1);
      });
    }, { threshold: [1] });
    obs.observe(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else setTimeout(bind, 0);
})();

/* v13.67: #initLoading 카드의 단계 메시지 자동 회전 — DOM에서 제거되면 자동 종료 */
(function () {
  var steps = [
    '📂 캐시 확인',
    '👥 팀원 정보 로드',
    '📅 주차 데이터 정리',
    '📊 통계 집계 준비',
    '🔄 최근 주차 자동 선택',
    '✨ 화면 준비'
  ];
  var i = 0;
  function tick() {
    var el = document.getElementById('wmInitStep');
    if (!el) return; // DOM에서 제거됨 — 자체 종료
    el.textContent = steps[i % steps.length];
    // pop 애니메이션 재시작
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    i++;
    setTimeout(tick, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 800); });
  else setTimeout(tick, 800);
})();

window.wmDataBus = (function () {
  var listeners = {}; // type → [fn]
  function on(type, fn) {
    if (!type || typeof fn !== 'function') return function(){};
    (listeners[type] = listeners[type] || []).push(fn);
    return function off() { listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn; }); };
  }
  function emit(type, action, detail) {
    var payload = { type: type, action: action, detail: detail || {} };
    var arr = (listeners[type] || []).concat(listeners['*'] || []);
    // 동기적으로 실행 (cache invalidate가 다음 read보다 먼저 일어나도록).
    // 단, 무한 루프 방지를 위해 한 emit 사이클 안에서는 동일 type 재emit 차단.
    if (emit._inflight && emit._inflight[type]) return;
    emit._inflight = emit._inflight || {};
    emit._inflight[type] = true;
    try {
      arr.forEach(function (fn) {
        try { fn(payload); } catch (e) { console.warn('[wmDataBus]', type, action, e); }
      });
    } finally {
      delete emit._inflight[type];
    }
  }
  return { on: on, emit: emit };
})();

/* 탭(mode) → 그 탭이 그리는 데이터 type — 단일 소스.
   아래 활성 탭 자동 재렌더와 mode.js 의 탭 캐시 무효화가 같은 맵을 쓴다.
   (예전엔 두 벌이라 어긋나서, 타임라인/파이프라인 탭을 연 채 수주·일정이 바뀌면 캐시만 지우고 화면은 다시 안 그렸음)
   pipeline: 카드에 수주 정보 표시 · timeline: 수주 정보 + 일정(event) 마커 표시 · archive/trend: 팀 탭(재렌더 대상 아님, 캐시만 무효화) */
window.WM_TAB_DEPS = {
  pipeline: { project:1, milestone:1, checklist:1, issue:1, order:1 },
  calendar: { project:1, milestone:1, event:1 },
  timeline: { project:1, milestone:1, checklist:1, order:1, event:1 },
  orders:   { order:1, project:1, issue:1 },
  prestudy: { prestudy:1 },
  tech:     { tech:1 },
  issues:   { issue:1, project:1 },
  docs:     { document:1, project:1 },
  as:       { as:1, asCategory:1, order:1, project:1 },
  archive:  { archive:1 },
  trend:    { archive:1 }
};

/* 활성 탭 자동 재렌더 — 어떤 데이터 변경이든 한 번 디바운스 후 현재 활성 모듈만 다시 그림.
   각 탭이 의존하는 type 매핑(WM_TAB_DEPS)으로 불필요한 재렌더 방지. */
(function () {
  var depMap = window.WM_TAB_DEPS;
  var renderMap = {
    pipeline: function () { if (typeof renderPipeline === 'function') renderPipeline(); },
    // initCalendar 는 오늘 달로 되돌린다 — 다른 달을 보다가 일정을 옮기면 화면이 이번 달로 튀었다
    calendar: function () { if (typeof renderCalendar === 'function') renderCalendar(); },
    timeline: function () { if (typeof renderTimeline === 'function') renderTimeline(); },
    orders:   function () { if (typeof renderOrders === 'function') renderOrders(); },
    prestudy: function () { if (typeof renderPrestudy === 'function') renderPrestudy(); },
    tech:     function () { if (typeof renderTech === 'function') renderTech(); },
    issues:   function () { if (typeof renderIssues === 'function') renderIssues(); },
    docs:     function () { if (typeof renderDocManager === 'function') renderDocManager(); },
    as:       function () { if (typeof renderAS === 'function') renderAS(); }
  };
  var t = null;
  window.wmDataBus.on('*', function (e) {
    if (typeof curPage === 'undefined' || curPage !== 'project') return; // 프로젝트 카테고리만 자동 재렌더
    if (typeof curMode === 'undefined') return;
    var deps = depMap[curMode];
    if (!deps || !deps[e.type]) return; // 현재 탭이 의존하지 않는 데이터면 skip
    clearTimeout(t);
    t = setTimeout(function () {
      var fn = renderMap[curMode];
      if (typeof fn === 'function') {
        try {
          fn();
          // v13.64: 자동 재렌더 후 캐시 ts 갱신 (활성 탭에서 mutation 발생 케이스)
          if (typeof _modeMarkRendered === 'function') _modeMarkRendered(curMode);
        } catch (err) { console.warn('[wmDataBus rerender]', curMode, err); }
      }
    }, 100);
  });
})();
