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
  var _stepTimer = null, _clock = null;
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
        '<div class="wm-prog-ring2"><b></b></div>' +
        '<div class="wm-prog-ring-icon" id="wmProgIcon">' + _esc(icon) + '</div>' +
      '</div>' +
      '<div class="wm-prog-title" id="wmProgTitle">' + _esc(title) +
        '<span class="wm-prog-dots"><span></span><span></span><span></span></span></div>' +
      '<div class="wm-prog-sub" id="wmProgSub">' + _esc(sub) + '</div>' +
      (step ? '<div class="wm-prog-step" id="wmProgStep">' + _esc(step) + '</div>' : '<div id="wmProgStep" style="display:none"></div>') +
      '<div class="wm-prog-bar"><div class="wm-prog-bar-fill" id="wmProgFill"></div></div>' +
      '<div class="wm-prog-meta"><span id="wmProgPct"></span><span id="wmProgTime"></span></div>' +
      (tip ? '<div class="wm-prog-tip">' + _esc(tip) + '</div>' : '') +
      (cancelable ? '<button class="wm-prog-cancel" id="wmProgCancel">취소</button>' : '') +
      '</div>';
    if (cancelable && typeof opts.onCancel === 'function') {
      var btn = document.getElementById('wmProgCancel');
      if (btn) btn.onclick = function () { opts.onCancel(); hide(); };
    }
    document.body.style.overflow = 'hidden';
    if (opts.pct != null) update({ pct: opts.pct });
    // 3초 넘게 걸리면 경과 시간 표시 — 멈춘 게 아니라는 표시
    var t0 = Date.now();
    if (_clock) clearInterval(_clock);
    _clock = setInterval(function () {
      var el = document.getElementById('wmProgTime');
      if (!el) { clearInterval(_clock); _clock = null; return; }
      var sec = Math.floor((Date.now() - t0) / 1000);
      if (sec >= 3) el.textContent = '⏱ ' + (sec >= 60 ? Math.floor(sec / 60) + '분 ' : '') + (sec % 60) + '초';
    }, 500);
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
    // 진행률을 알면 막대가 실제로 차오름 (모르면 흐르는 막대)
    if (opts.pct != null) {
      var f = document.getElementById('wmProgFill'), pc = document.getElementById('wmProgPct');
      var v = Math.max(0, Math.min(100, Math.round(opts.pct)));
      if (f) { f.classList.add('det'); f.style.width = v + '%'; }
      if (pc) pc.textContent = v + '%';
    }
  }
  function step(text) { update({ step: text }); }
  function hide() {
    var ov = document.getElementById('wmProgOverlay');
    if (ov) ov.remove();
    document.body.style.overflow = '';
    if (_stepTimer) { clearTimeout(_stepTimer); _stepTimer = null; }
    if (_clock) { clearInterval(_clock); _clock = null; }
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

/* v13.263 시작 화면(#initLoading) — 실제 단계로 진행 표시 · 오래 걸리면 서버 깨우는 중 안내 · 사용 팁.
   wmSplash.stage('auth'|'base'|'data'|'ui') · wmSplash.done() (app-init.js). 로그인 창이 뜨면 그 아래에 가려짐 */
window.wmSplash = (function () {
  var ORDER = ['auth', 'base', 'data', 'ui'];
  var PCT = { auth: 12, base: 34, data: 62, ui: 90 };
  var MSG = {
    auth: '로그인 정보를 확인하고 있어요',
    base: '수주 목록과 설정을 맞추고 있어요',
    data: '업무일지와 프로젝트를 받아 오고 있어요',
    ui: '마지막으로 보던 화면을 준비하고 있어요'
  };
  var TIPS = [
    '📍 다음에 들어오면 마지막으로 보던 화면으로 바로 이어집니다',
    '🔎 상단 검색 한 번으로 수주 · 프로젝트 · 이슈를 함께 찾을 수 있어요',
    '🎯 내 업무에서 맵 · 이슈 · 회의 액션 · 일정을 한곳에 모아 봅니다',
    '📒 업무일지 탭에 다른 파일을 놓으면 바뀐 것만 골라 병합해요',
    '📨 텔레그램 /todo · /event 로 할 일과 일정을 바로 추가할 수 있어요',
    '🧠 마인드맵은 두 손가락으로 확대 · 축소, 길게 눌러 주제를 옮겨요',
    '📅 내 업무 달력은 .ics 주소로 휴대폰 달력에 구독할 수 있어요',
    '🎨 헤더의 테마 버튼으로 화면 색을 바꿀 수 있어요'
  ];
  var cur = -1, pct = 4, t0 = Date.now(), timer = null, tipTimer = null, tipI = Math.floor(Math.random() * TIPS.length);
  function $(id) { return document.getElementById(id); }
  function alive() { return !!$('initLoading'); }
  function setBar(v) { pct = Math.max(pct, Math.min(99, v)); var b = $('wmSpBar'); if (b) b.style.width = pct + '%'; }
  function stage(k) {
    var i = ORDER.indexOf(k);
    if (i < 0 || i < cur || !alive()) return;
    cur = i;
    var lis = document.querySelectorAll('#wmSpSteps li');
    for (var j = 0; j < lis.length; j++) {
      lis[j].classList.toggle('done', j < i);
      lis[j].classList.toggle('on', j === i);
    }
    var m = $('wmSpMsg');
    if (m) { m.textContent = MSG[k]; m.style.animation = 'none'; void m.offsetWidth; m.style.animation = ''; }
    setBar(PCT[k]);
  }
  // 단계 안에서도 막대가 조금씩 차오르게 (다음 단계 몫의 직전까지만) · 경과 시간 · 서버 깨우는 중 안내
  function tick() {
    if (!alive()) { clearInterval(timer); clearInterval(tipTimer); return; }
    var next = cur + 1 < ORDER.length ? PCT[ORDER[cur + 1]] : 99;
    setBar(pct + (next - 2 - pct) * 0.06);
    var sec = Math.round((Date.now() - t0) / 1000);
    var w = $('wmSpWake');
    if (w && sec >= 7 && cur <= 2) { w.classList.add('show'); var sp = $('wmSpSec'); if (sp) sp.textContent = sec + '초'; }
    else if (w && cur > 2) w.classList.remove('show');
  }
  function showTip() {
    var el = $('wmSpTip'); if (!el) return;
    el.classList.add('fade');
    setTimeout(function () { el.textContent = TIPS[tipI++ % TIPS.length]; el.classList.remove('fade'); }, 350);
  }
  function done() {
    var el = $('initLoading');
    if (!el || el.classList.contains('out')) return;
    var lis = document.querySelectorAll('#wmSpSteps li');
    for (var j = 0; j < lis.length; j++) { lis[j].classList.remove('on'); lis[j].classList.add('done'); }
    var b = $('wmSpBar'); if (b) b.style.width = '100%';
    clearInterval(timer); clearInterval(tipTimer);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.remove(); }, 460);
    }, 220);
  }
  function start() {
    if (!alive()) return;
    var v = $('wmSpVer'); if (v && typeof WM_VERSION !== 'undefined') v.textContent = 'v' + WM_VERSION;
    var tip = $('wmSpTip'); if (tip) tip.textContent = TIPS[tipI++ % TIPS.length];
    if (cur < 0) stage('auth');
    timer = setInterval(tick, 400);
    tipTimer = setInterval(showTip, 4200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else setTimeout(start, 0);
  return { stage: stage, done: done };
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
  calendar: { project:1, milestone:1, event:1, workRecord:1 },          // 대시보드 진척률 · 업무 분포가 업무일지 집계
  timeline: { project:1, milestone:1, checklist:1, order:1, event:1, workRecord:1 },  // 마일스톤 실적 시간
  orders:   { order:1, project:1, issue:1 },
  prestudy: { prestudy:1 },
  tech:     { tech:1 },
  issues:   { issue:1, project:1 },
  docs:     { document:1, project:1 },
  as:       { as:1, asCategory:1, order:1, project:1 },
  operator: { workRecord:1 },                                          // 프로젝트 투입 실적
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
    as:       function () { if (typeof renderAS === 'function') renderAS(); },
    operator: function () { if (typeof renderOperator === 'function') renderOperator(); }
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
