/* ai-ask.js — ✨ AI에게 묻기 (통합 질의)
 * v13.297 1단계: 통합 검색창에 문장을 치면 "✨ AI에게 묻기" 줄 → 이 창에서 답. 근거 [P1] 칩 → 그 화면 (globalSearchNav)
 * v13.298 2단계: 서버에서 AI 가 조회 도구를 골라 실행 — 이 창은 "AI 가 조회한 것" 표시 · 이어 묻기(최근 3개 대화를 함께 보냄)
 * v13.299 3단계: 첫 화면 💡 지금 살펴볼 것 — /api/ai/insights 규칙 카드 (AI 호출 없음). 카드 → 그 화면 · AI 에게 더 묻기
 * v13.300 4단계: 숫자 차트 · 추천 이어 질문 · ⭐ 질문 저장(이 브라우저) · 📋 복사 · 🧠 맵으로
 * AI 답은 믿을 수 없는 글이므로 HTML 로 넣기 전에 반드시 eH 로 막은 뒤 작은 마크다운만 바꾼다.
 * 의존(전역): apiFetch, createModal, wmGuardedModal, eH, eA, globalSearchNav, AUTH_SKIP, currentUser, showToast, mmFromMarkdown(맵으로) */

var _wmAi = { ready: null, checking: null, history: [], busy: false, insights: null, insightsAt: 0, insightsLoading: false };
var WM_AI_SRC = {
  project:   { icon: '📁', label: '프로젝트' },
  milestone: { icon: '◆', label: '마일스톤' },
  issue:     { icon: '🎫', label: '이슈' },
  order:     { icon: '📋', label: '수주' },
  as:        { icon: '🛠️', label: 'A/S' }
};
var WM_AI_EXAMPLES = [
  '이번 주 지연 위험이 있는 프로젝트와 이유는?',
  '지난주와 이번 주 업무분장별 시간을 비교해줘',
  '이번 달 누가 어떤 수주에 시간을 가장 많이 썼어?',
  '긴급한 미해결 이슈 정리해줘',
  '최근 A/S 가 반복되는 장비와 공통 증상은?'
];
var WM_AI_LEVEL = { risk: '위험', warn: '주의', info: '참고' };

/** AI 사용 가능 여부 — 한 번만 묻고 기억 (로컬 모드는 없음) */
function wmAiCheck() {
  if (_wmAi.ready != null) return Promise.resolve(_wmAi.ready);
  if (typeof AUTH_SKIP !== 'undefined' && AUTH_SKIP) { _wmAi.ready = false; return Promise.resolve(false); }
  if (!_wmAi.checking) {
    _wmAi.checking = apiFetch('/api/ai/status')
      .then(function (r) { _wmAi.ready = !!(r && r.data && r.data.configured); })
      .catch(function () { _wmAi.ready = false; })
      .then(function () { _wmAi.checking = null; return _wmAi.ready; });
  }
  return _wmAi.checking;
}

/** 검색어가 질문 문장 같은지 — 물음표 · 묻는 말끝 · 띄어쓰기 3개 이상 */
function wmAiLooksQuestion(kw) {
  kw = String(kw || '').trim();
  if (kw.length < 4) return false;
  if (/[?？]$/.test(kw)) return true;
  if (/(까|나요|가요|어때|알려\s*줘|보여\s*줘|정리\s*해\s*줘|비교\s*해\s*줘|뭐야|뭐지|누구|얼마|있어|있나|줘|해줘|인가|는지)\s*[.!]?$/.test(kw)) return true;
  return (kw.match(/\s+/g) || []).length >= 3;
}

/** 검색 드롭다운의 "✨ AI에게 묻기" 줄 (AI 가 준비됐을 때만) */
function wmAiRowHtml(kw) {
  if (_wmAi.ready == null) { wmAiCheck().then(function (ok) { if (ok && typeof globalSearch === 'function' && _gs && _gs.q === kw) { var dd = document.getElementById('globalSearchDropdown'); if (dd && dd.style.display !== 'none') dd.innerHTML = gsRenderResults(_gs.groups, _gs.q, _gs.only); } }); return ''; }
  if (!_wmAi.ready || !String(kw || '').trim()) return '';
  return '<div class="gs-item gs-ai" onclick="gsAskAi()" title="내가 볼 수 있는 데이터로 AI 가 답합니다">' +
    '<span class="gs-icon">✨</span><span class="gs-main"><span class="gs-name">AI에게 묻기 — <b>' + eH(kw) + '</b></span></span>' +
    '<span class="gs-sub">Enter</span></div>';
}

/** 검색창 글로 AI 창 열기 */
function gsAskAi() {
  var inp = document.getElementById('globalSearchInput');
  var q = inp ? inp.value.trim() : '';
  var dd = document.getElementById('globalSearchDropdown');
  if (dd) dd.style.display = 'none';
  if (inp) { inp.value = ''; inp.blur(); }
  // 아직 오는 중인 검색 결과가 드롭다운을 다시 열지 않게
  if (typeof _gsTimer !== 'undefined') clearTimeout(_gsTimer);
  if (typeof _gs !== 'undefined') { _gs.seq++; _gs.q = ''; }
  wmAiAsk(q);
}

/** ✨ AI에게 묻기 창 — q 가 있으면 바로 묻는다. q 없이 열면 지난 질문들 그대로 (없으면 💡 살펴볼 것) */
function wmAiAsk(q) {
  return wmGuardedModal('aiAsk', function () {
    var m = createModal({
      id: 'aiAskModal', width: '820px', closeOnEsc: true,
      title: '✨ AI에게 묻기 <span class="ai-scope">내가 볼 수 있는 데이터만 씁니다</span>',
      boxStyle: 'display:flex;flex-direction:column;max-height:88vh'
    });
    m.box.insertAdjacentHTML('beforeend',
      '<div id="aiAskLog" class="ai-log"></div>' +
      '<div class="ai-ask-bar">' +
        '<button class="btn ai-home" id="aiAskHome" onclick="wmAiHome()" title="새 대화 — 💡 살펴볼 것 · 저장한 질문 보기">🏠</button>' +
        '<textarea id="aiAskInput" rows="2" maxlength="1000" placeholder="질문을 입력하세요 (Enter 묻기 · Shift+Enter 줄바꿈)"></textarea>' +
        '<button class="btn btn-p" id="aiAskBtn" onclick="wmAiSend()">묻기</button>' +
      '</div>');
    var ta = document.getElementById('aiAskInput');
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); wmAiSend(); }
    });
    wmAiRenderLog();
    if (!q && !_wmAi.history.length) wmAiLoadInsights();
  }, 'aiAskModal', {
    onOpen: function () {
      var ta = document.getElementById('aiAskInput');
      if (q) { ta.value = q; wmAiSend(); } else if (ta) ta.focus();
    }
  });
}

/** 🏠 새 대화 — 기록 비우고 첫 화면 */
function wmAiHome() {
  if (_wmAi.busy) return;
  _wmAi.history = [];
  wmAiRenderLog();
  wmAiLoadInsights();
  var t = document.getElementById('aiAskInput'); if (t) t.focus();
}

/** 이어 묻기용 — 끝난 대화 최근 3개 { q, a } */
function wmAiPrevTurns(upto) {
  return _wmAi.history.slice(0, upto).filter(function (it) { return it.res && it.res.answer; })
    .slice(-3).map(function (it) { return { q: it.q, a: String(it.res.answer).slice(0, 800) }; });
}

/** 입력칸 글(또는 q)을 묻기 */
function wmAiSend(qArg) {
  var ta = document.getElementById('aiAskInput');
  var q = typeof qArg === 'string' ? qArg.trim() : (ta ? ta.value.trim() : '');
  if (!q || _wmAi.busy) return;
  if (ta && typeof qArg !== 'string') ta.value = '';
  var prev = wmAiPrevTurns(_wmAi.history.length);
  var item = { q: q, at: new Date(), loading: true };
  _wmAi.history.push(item);
  if (_wmAi.history.length > 20) _wmAi.history.shift();
  _wmAi.busy = true;
  wmAiRenderLog();
  apiFetch('/api/ai/query', { method: 'POST', body: JSON.stringify({ question: q, history: prev }), timeoutMs: 150000 })
    .then(function (r) { item.res = (r && r.data) || {}; })
    .catch(function (e) {
      var d = e && e.data;
      item.err = (d && d.message) || (e && e.name === 'AbortError' ? 'AI 응답이 너무 오래 걸립니다. 다시 시도하세요.' : (e && e.message) || 'AI 질문 실패');
    })
    .then(function () {
      item.loading = false; _wmAi.busy = false;
      wmAiRenderLog();
      var t = document.getElementById('aiAskInput'); if (t) t.focus();
    });
}

/** AI 답(믿을 수 없는 글) → 안전한 HTML: 막은 뒤 소제목 · 굵게 · 목록 · [P1] 근거 칩만 바꿈 */
function wmAiMdHtml(text, sources, hi) {
  var byKey = {};
  (sources || []).forEach(function (s) { byKey[s.key] = s; });
  var s = eH(String(text || ''));
  s = s.replace(/^#{2,4}\s*(.+)$/gm, '<div class="ai-h">$1</div>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*•]\s+(.+)$/gm, '<div class="ai-li">$1</div>')
    .replace(/\[((?:[PMIOA]\d+)(?:\s*,\s*[PMIOA]\d+)*)\]/g, function (_m, g) {
      return g.split(/\s*,\s*/).map(function (k) {
        var src = byKey[k];
        if (!src) return '';
        var c = WM_AI_SRC[src.type] || { icon: '•' };
        return '<button class="ai-cite" onclick="wmAiOpenSrc(' + hi + ',\'' + k + '\')" title="' + eA(src.title + (src.sub ? ' · ' + src.sub : '')) + '">' + c.icon + ' ' + eH(String(src.title).slice(0, 18)) + '</button>';
      }).join('');
    })
    .replace(/\n{2,}/g, '<div class="ai-gap"></div>')
    .replace(/(<\/div>|<div class="ai-gap"><\/div>)\n/g, '$1')   // 소제목 · 목록 줄 뒤 줄바꿈은 빈 줄을 또 만들지 않게
    .replace(/\n/g, '<br>');
  return s;
}

function wmAiSrcChip(hi, s) {
  var c = WM_AI_SRC[s.type] || { icon: '•', label: '' };
  return '<button class="ai-src" onclick="wmAiOpenSrc(' + hi + ',\'' + s.key + '\')">' +
    '<span>' + c.icon + '</span><span class="ai-src-t">' + eH(s.title || '') + '</span>' +
    (s.sub ? '<span class="ai-src-s">' + eH(s.sub) + '</span>' : '') + '</button>';
}

/** 숫자 차트 — 가로 막대 (서버 도구가 만든 묶음) */
function wmAiChartHtml(ch) {
  var rows = (ch && ch.rows) || [];
  if (rows.length < 2) return '';
  var max = Math.max.apply(null, rows.map(function (r) { return +r.value || 0; })) || 1;
  return '<div class="ai-chart"><div class="ai-chart-h">📊 ' + eH(ch.title || '') + '</div>' + rows.map(function (r) {
    var v = +r.value || 0;
    return '<div class="ai-bar"><span class="ai-bar-l" title="' + eA(r.label) + '">' + eH(r.label) + '</span>' +
      '<span class="ai-bar-t"><span class="ai-bar-f" style="width:' + Math.max(1, Math.round(v / max * 100)) + '%"></span></span>' +
      '<span class="ai-bar-v">' + eH(String(v)) + eH(ch.unit || '') + '</span></div>';
  }).join('') + '</div>';
}

/* ─── ⭐ 저장한 질문 — 이 브라우저 · 사용자별 (최대 20개) ─── */
function _wmAiSavedKey() { return 'wmAiSaved:' + ((typeof currentUser !== 'undefined' && currentUser && currentUser.id) || 'me'); }
function wmAiSaved() {
  try { var a = JSON.parse(localStorage.getItem(_wmAiSavedKey()) || '[]'); return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }) : []; } catch (_) { return []; }
}
function _wmAiSavedPut(a) { try { localStorage.setItem(_wmAiSavedKey(), JSON.stringify(a.slice(0, 20))); } catch (_) { } }
function wmAiToggleSave(q) {
  var a = wmAiSaved(), i = a.indexOf(q);
  if (i >= 0) a.splice(i, 1); else a.unshift(q);
  _wmAiSavedPut(a);
  wmAiRenderLog(true);
}

/* ─── 💡 살펴볼 것 (규칙 인사이트) ─── */
function wmAiLoadInsights(force) {
  if (_wmAi.insightsLoading) return;
  if (!force && _wmAi.insights && Date.now() - _wmAi.insightsAt < 5 * 60 * 1000) { wmAiRenderLog(); return; }
  _wmAi.insightsLoading = true;
  wmAiRenderLog();
  apiFetch('/api/ai/insights')
    .then(function (r) { _wmAi.insights = (r && r.data) || []; _wmAi.insightsAt = Date.now(); })
    .catch(function () { _wmAi.insights = _wmAi.insights || []; })
    .then(function () { _wmAi.insightsLoading = false; if (!_wmAi.history.length) wmAiRenderLog(); });
}
function _wmAiNavType(nav) {
  if (!nav) return null;
  if (nav.issueId) return 'issue';
  if (nav.asId) return 'as';
  if (nav.projectId) return 'project';
  if (nav.name) return 'member';
  return null;
}
function wmAiInsightHtml() {
  if (_wmAi.insightsLoading && !_wmAi.insights) return '<div class="ai-ins-h">💡 지금 살펴볼 것</div><div class="ai-ins-wait"><span class="mm-spin"></span> 찾는 중…</div>';
  var cards = _wmAi.insights || [];
  if (!cards.length) return '<div class="ai-ins-h">💡 지금 살펴볼 것</div><div class="ai-ins-none">✅ 지금 눈에 띄는 위험 · 지연은 없습니다.</div>';
  return '<div class="ai-ins-h">💡 지금 살펴볼 것 <span class="ai-ins-n">' + cards.length + '</span>' +
    '<button class="ai-ins-re" onclick="wmAiLoadInsights(true)" title="다시 계산">↻</button></div><div class="ai-ins">' +
    cards.map(function (c, ci) {
      return '<div class="ai-card ai-lv-' + eA(c.level) + '"><div class="ai-card-h"><span>' + eH(c.icon) + '</span><b>' + eH(c.title) + '</b>' +
        '<span class="ai-lv">' + eH(WM_AI_LEVEL[c.level] || '') + '</span></div>' +
        '<div class="ai-card-d">' + eH(c.detail || '') + '</div>' +
        (c.items || []).slice(0, 4).map(function (it, ii) {
          var t = _wmAiNavType(it.nav);
          return '<div class="ai-card-i' + (t ? ' ai-go' : '') + '"' + (t ? ' onclick="wmAiOpenInsight(' + ci + ',' + ii + ')"' : '') + '>' +
            '<span class="ai-card-l">' + eH(it.label) + '</span>' + (it.sub ? '<span class="ai-card-s">' + eH(it.sub) + '</span>' : '') + '</div>';
        }).join('') +
        ((c.items || []).length > 4 ? '<div class="ai-card-more">… 외 ' + (c.items.length - 4) + '건</div>' : '') +
        (c.ask ? '<button class="ai-card-ask" onclick="wmAiAskCard(' + ci + ')">✨ AI 에게 더 묻기</button>' : '') +
        '</div>';
    }).join('') + '</div>';
}
function wmAiOpenInsight(ci, ii) {
  var c = (_wmAi.insights || [])[ci], it = c && c.items[ii];
  var t = it && _wmAiNavType(it.nav);
  if (!t) return;
  var m = document.getElementById('aiAskModal'); if (m) m.remove();
  globalSearchNav(t, { title: it.label, sub: it.sub, nav: it.nav }, t === 'member' ? it.nav.name : it.label);
}
function wmAiAskCard(ci) {
  var c = (_wmAi.insights || [])[ci];
  if (c && c.ask) wmAiSend(c.ask);
}

/** 첫 화면 — 💡 살펴볼 것 · ⭐ 저장한 질문 · 예시 */
function wmAiStartHtml() {
  var saved = wmAiSaved();
  var qBtn = function (x, cls) { return '<button class="' + cls + '" data-q="' + eA(x) + '" onclick="wmAiSend(this.dataset.q)">' + eH(x) + '</button>'; };
  return '<div class="ai-empty">' + wmAiInsightHtml() +
    (saved.length ? '<div class="ai-ins-h">⭐ 저장한 질문</div><div class="ai-ex">' + saved.map(function (x) {
      return '<span class="ai-sv">' + qBtn(x, 'ai-ex-b') + '<button class="ai-sv-x" data-q="' + eA(x) + '" onclick="wmAiToggleSave(this.dataset.q)" title="저장 지우기">✕</button></span>';
    }).join('') + '</div>' : '') +
    '<div class="ai-ins-h">무엇이든 물어보세요</div>' +
    '<div class="ai-empty-s">AI 가 질문에 맞춰 프로젝트 · 마일스톤 · 이슈 · 업무일지 · 수주 · A/S · 일정에서 필요한 것을 골라 조회하고 답합니다. 업무일지는 관리자 전체 · 부서장 부서 · 그 외 본인 것만 봅니다.</div>' +
    '<div class="ai-ex">' + WM_AI_EXAMPLES.map(function (x) { return qBtn(x, 'ai-ex-b'); }).join('') + '</div></div>';
}

/** 조회한 것 한 줄 — "업무일지 시간 집계 (사람별 · 지난주) 12건" */
var WM_AI_ARG = { person: '사람별', abbr: '업무분장별', order: '수주번호별', week: '주별', month: '월별', day: '일별',
  this_week: '이번 주', last_week: '지난주', this_month: '이번 달', last_month: '지난달', last_30d: '최근 30일', last_90d: '최근 90일', this_year: '올해',
  open: '미해결·진행 중', delayed: '지연', done: '완료', all: '전체', resolved: '해결됨', urgent: '긴급' };
function wmAiToolLine(t) {
  var a = t.args || {}, bits = [];
  Object.keys(a).forEach(function (k) {
    var v = a[k];
    if (v === true) bits.push(k === 'overdue_only' ? '지난 것만' : k);
    else if (v !== false && v != null && v !== '') bits.push(WM_AI_ARG[v] || (k === 'days' ? v + '일' : String(v)));
  });
  return '<div class="ai-tool">🔎 ' + eH(t.label || t.tool) + (bits.length ? ' <span>(' + eH(bits.join(' · ')) + ')</span>' : '') +
    ' <span class="ai-tool-n">' + (t.rows < 0 ? '실패' : t.rows + '건') + '</span></div>';
}

/** 대화 기록 그리기 (keepScroll: 저장 단추처럼 자리 유지) */
function wmAiRenderLog(keepScroll) {
  var box = document.getElementById('aiAskLog');
  if (!box) return;
  var btn = document.getElementById('aiAskBtn');
  if (btn) btn.disabled = _wmAi.busy;
  if (!_wmAi.history.length) { box.innerHTML = wmAiStartHtml(); box.scrollTop = 0; return; }
  var saved = wmAiSaved();
  var top = box.scrollTop;
  box.innerHTML = _wmAi.history.map(function (it, hi) {
    var on = saved.indexOf(it.q) >= 0;
    var h = '<div class="ai-q"><span class="ai-q-t">' + eH(it.q) + '</span>' +
      '<button class="ai-star' + (on ? ' on' : '') + '" data-q="' + eA(it.q) + '" onclick="wmAiToggleSave(this.dataset.q)" title="' + (on ? '저장 지우기' : '⭐ 질문 저장 — 첫 화면에서 다시 묻기') + '">' + (on ? '★' : '☆') + '</button></div>';
    if (it.loading) return h + '<div class="ai-a ai-wait"><span class="mm-spin"></span> 필요한 데이터를 골라 조회하고 답을 쓰는 중… (보통 10~30초)</div>';
    if (it.err) return h + '<div class="ai-a ai-err">⚠️ ' + eH(it.err) + ' <button class="ai-retry" onclick="wmAiRetry(' + hi + ')">다시 묻기</button></div>';
    var r = it.res || {};
    var src = r.sources || [];
    var cited = src.filter(function (s) { return s.cited; }), other = src.filter(function (s) { return !s.cited; });
    h += '<div class="ai-a">' + (r.note ? '<div class="ai-note">ℹ️ ' + eH(r.note) + '</div>' : '') + wmAiMdHtml(r.answer, src, hi) + '</div>';
    (r.charts || []).slice(0, 2).forEach(function (ch) { h += wmAiChartHtml(ch); });
    if (cited.length) h += '<div class="ai-srcs"><div class="ai-srcs-h">근거 ' + cited.length + '건 — 누르면 그 화면으로</div>' + cited.map(function (s) { return wmAiSrcChip(hi, s); }).join('') + '</div>';
    if ((r.followups || []).length) h += '<div class="ai-fu">' + r.followups.map(function (f) { return '<button class="ai-fu-b" data-q="' + eA(f) + '" onclick="wmAiSend(this.dataset.q)">↪ ' + eH(f) + '</button>'; }).join('') + '</div>';
    if (other.length) h += '<details class="ai-more"><summary>그 밖에 참고한 데이터 ' + other.length + '건</summary><div class="ai-srcs">' + other.map(function (s) { return wmAiSrcChip(hi, s); }).join('') + '</div></details>';
    if ((r.tools || []).length) h += '<details class="ai-more"><summary>🔎 AI 가 조회한 것 ' + r.tools.length + '가지' + (r.planned === false ? ' (기본 묶음)' : '') + '</summary><div class="ai-tools">' + r.tools.map(wmAiToolLine).join('') + '</div></details>';
    if (r.context) h += '<details class="ai-more"><summary>📋 AI 가 본 데이터</summary><pre class="ai-ctx">' + eH(r.context) + '</pre></details>';
    h += '<div class="ai-acts"><button class="ai-act" onclick="wmAiCopy(' + hi + ')">📋 복사</button>' +
      '<button class="ai-act" onclick="wmAiToMap(' + hi + ')">🧠 맵으로</button>' +
      '<span class="ai-meta">' + eH([r.provider, r.model].filter(Boolean).join(' · ')) + (r.quota && r.quota.limit ? ' · 이번 달 ' + r.quota.used + '/' + r.quota.limit + '회' : '') + '</span></div>';
    return h;
  }).join('<div class="ai-sep"></div>');
  box.scrollTop = keepScroll ? top : box.scrollHeight;
}

/** 실패한 질문 다시 */
function wmAiRetry(hi) {
  var it = _wmAi.history[hi];
  if (!it || _wmAi.busy) return;
  _wmAi.history.splice(hi, 1);
  wmAiSend(it.q);
}

/** 답 → 글 (근거 표시는 이름으로) */
function wmAiPlain(hi) {
  var it = _wmAi.history[hi], r = it && it.res;
  if (!r) return '';
  var byKey = {};
  (r.sources || []).forEach(function (s) { byKey[s.key] = s; });
  return String(r.answer || '').replace(/\s*\[((?:[PMIOA]\d+)(?:\s*,\s*[PMIOA]\d+)*)\]/g, function (_m, g) {
    var names = g.split(/\s*,\s*/).map(function (k) { return byKey[k] && byKey[k].title; }).filter(Boolean);
    return names.length ? ' (' + names.join(', ') + ')' : '';
  });
}

/** 📋 복사 — 질문 + 답 (근거는 이름으로) */
function wmAiCopy(hi) {
  var it = _wmAi.history[hi];
  if (!it || !it.res) return;
  var text = 'Q. ' + it.q + '\n\n' + wmAiPlain(hi);
  var done = function () { if (typeof showToast === 'function') showToast('📋 질문과 답을 복사했습니다', 'success'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(function () { _wmAiCopyOld(text); done(); });
  else { _wmAiCopyOld(text); done(); }
}
function _wmAiCopyOld(text) {
  var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (_) { } t.remove();
}

/** 답 → 마인드맵 Markdown: 질문이 중심, 소제목이 가지, 목록이 하위, 문단은 메모 */
function wmAiMapMarkdown(hi) {
  var it = _wmAi.history[hi];
  var lines = ['# ' + String(it.q).replace(/\n/g, ' ').slice(0, 80)];
  var body = wmAiPlain(hi).replace(/\*\*([^*\n]+)\*\*/g, '$1').split('\n');
  var head = false, para = [];
  body.forEach(function (ln) {
    var h = ln.match(/^#{1,6}\s+(.+)$/), li = ln.match(/^(\s*)[-*•]\s+(.+)$/);
    if (h) { lines.push('## ' + h[1].trim()); head = true; }
    else if (li) lines.push(li[1].replace(/\t/g, '  ') + '- ' + li[2].trim());
    else if (ln.trim()) { if (!head && lines.length === 1) para.push(ln.trim()); else lines.push((head ? '  ' : '') + '- ' + ln.trim()); }
  });
  if (para.length) lines.splice(1, 0, '## 핵심', '- ' + para.join(' ').slice(0, 200));
  return lines.join('\n');
}

/** 🧠 맵으로 — 새 개인 맵을 만들어 엶 */
function wmAiToMap(hi) {
  var it = _wmAi.history[hi];
  if (!it || !it.res) return;
  if (typeof mmFromMarkdown !== 'function') { if (typeof showToast === 'function') showToast('마인드맵 화면을 아직 불러오지 못했습니다', 'warn'); return; }
  var root = mmFromMarkdown(wmAiMapMarkdown(hi));
  if (!root) return;
  var title = '✨ ' + String(it.q).replace(/\n/g, ' ').slice(0, 40);
  var doc = { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: root }] };
  apiFetch('/api/mindmaps', { method: 'POST', body: JSON.stringify({ title: title, scope: 'personal', doc: doc }) })
    .then(function (r) {
      var id = r && r.data && r.data.id;
      if (!id) throw new Error('맵을 만들지 못했습니다');
      var m = document.getElementById('aiAskModal'); if (m) m.remove();
      if (typeof showToast === 'function') showToast('🧠 새 맵을 만들었습니다 — ' + title, 'success');
      if (typeof _mm !== 'undefined' && typeof setPage === 'function') { _mm.goto = null; _mm.mapId = id; setPage('mindmap'); }
    })
    .catch(function (e) { if (typeof showToast === 'function') showToast('⚠️ ' + ((e && e.data && e.data.message) || (e && e.message) || '맵 만들기 실패'), 'error'); });
}

/** 근거 칩 → 창을 닫고 그 화면 · 그 자리로 (통합 검색과 같은 이동). 기록은 남아 있어 다시 열면 그대로 */
function wmAiOpenSrc(hi, key) {
  var it = _wmAi.history[hi];
  var s = it && it.res && (it.res.sources || []).filter(function (x) { return x.key === key; })[0];
  if (!s) return;
  var m = document.getElementById('aiAskModal');
  if (m) m.remove();
  globalSearchNav(s.type, { title: s.title, sub: s.sub, nav: s.nav || {} }, s.title);
}

/** 검색창이 비었을 때 — 지난 AI 답 다시 보기 · 💡 살펴볼 것 (AI 준비됐을 때) */
function wmAiRecentRow() {
  if (_wmAi.history.length) {
    var last = _wmAi.history[_wmAi.history.length - 1];
    return '<div class="gs-head"><span>AI</span></div><div class="gs-list"><div class="gs-item gs-ai" onclick="gsAskAi()">' +
      '<span class="gs-icon">✨</span><span class="gs-main"><span class="gs-name">지난 AI 답 다시 보기 — ' + eH(last.q) + '</span></span></div></div>';
  }
  if (!_wmAi.ready) return '';
  return '<div class="gs-head"><span>AI</span></div><div class="gs-list"><div class="gs-item gs-ai" onclick="gsAskAi()" title="규칙으로 찾은 위험 · 지연 카드와 AI 질문">' +
    '<span class="gs-icon">💡</span><span class="gs-main"><span class="gs-name">지금 살펴볼 것 · AI에게 묻기</span></span></div></div>';
}
