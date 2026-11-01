/* ai-ask.js — ✨ AI에게 묻기 (v13.297, 통합 질의 1단계)
 * 통합 검색창에 문장을 치면 "✨ AI에게 묻기" 줄이 나오고, 고르면(또는 문장 + Enter) 이 창에서 답을 보여 준다.
 * 서버 POST /api/ai/query 는 묻는 사람이 화면에서 볼 수 있는 데이터만 AI 에 넘기고,
 * 답 속 [P1] · [M2] · [I3] · [O4] · [A5] 표시를 근거 목록(sources)과 함께 준다 → 누르면 그 화면 · 그 자리로 (globalSearchNav).
 * AI 답은 믿을 수 없는 글이므로 HTML 로 넣기 전에 반드시 eH 로 막은 뒤 작은 마크다운만 바꾼다.
 * 의존(전역): apiFetch, createModal, wmGuardedModal, eH, eA, globalSearchNav, AUTH_SKIP */

var _wmAi = { ready: null, checking: null, history: [], busy: false };
var WM_AI_SRC = {
  project:   { icon: '📁', label: '프로젝트' },
  milestone: { icon: '◆', label: '마일스톤' },
  issue:     { icon: '🎫', label: '이슈' },
  order:     { icon: '📋', label: '수주' },
  as:        { icon: '🛠️', label: 'A/S' }
};
var WM_AI_EXAMPLES = [
  '이번 주 지연 위험이 있는 프로젝트와 이유는?',
  '2주 안에 마감인데 진행률이 낮은 마일스톤 알려줘',
  '이번 주 누가 가장 바빴어?',
  '긴급한 미해결 이슈 정리해줘',
  '최근 A/S 가 반복되는 장비는?'
];

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
  if (/(까|나요|가요|어때|알려\s*줘|보여\s*줘|정리\s*해\s*줘|뭐야|뭐지|누구|얼마|있어|있나|줘|해줘|인가|는지)\s*[.!]?$/.test(kw)) return true;
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

/** ✨ AI에게 묻기 창 — q 가 있으면 바로 묻는다. q 없이 열면 지난 질문들 그대로 */
function wmAiAsk(q) {
  return wmGuardedModal('aiAsk', function () {
    var m = createModal({
      id: 'aiAskModal', width: '780px', closeOnEsc: true,
      title: '✨ AI에게 묻기 <span class="ai-scope">내가 볼 수 있는 데이터만 씁니다</span>',
      boxStyle: 'display:flex;flex-direction:column;max-height:88vh'
    });
    m.box.insertAdjacentHTML('beforeend',
      '<div id="aiAskLog" class="ai-log"></div>' +
      '<div class="ai-ask-bar">' +
        '<textarea id="aiAskInput" rows="2" maxlength="1000" placeholder="예: 이번 주 지연 위험이 있는 프로젝트와 이유는? (Enter 묻기 · Shift+Enter 줄바꿈)"></textarea>' +
        '<button class="btn btn-p" id="aiAskBtn" onclick="wmAiSend()">묻기</button>' +
      '</div>');
    var ta = document.getElementById('aiAskInput');
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); wmAiSend(); }
    });
    wmAiRenderLog();
  }, 'aiAskModal', {
    onOpen: function () {
      var ta = document.getElementById('aiAskInput');
      if (q) { ta.value = q; wmAiSend(); } else if (ta) ta.focus();
    }
  });
}

/** 입력칸 글을 묻기 */
function wmAiSend() {
  var ta = document.getElementById('aiAskInput');
  var q = ta ? ta.value.trim() : '';
  if (!q || _wmAi.busy) return;
  ta.value = '';
  var item = { q: q, at: new Date(), loading: true };
  _wmAi.history.push(item);
  if (_wmAi.history.length > 20) _wmAi.history.shift();
  _wmAi.busy = true;
  wmAiRenderLog();
  apiFetch('/api/ai/query', { method: 'POST', body: JSON.stringify({ question: q }), timeoutMs: 120000 })
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

/** 대화 기록 그리기 */
function wmAiRenderLog() {
  var box = document.getElementById('aiAskLog');
  if (!box) return;
  if (!_wmAi.history.length) {
    box.innerHTML = '<div class="ai-empty"><div class="ai-empty-t">사이트 데이터에 대해 무엇이든 물어보세요</div>' +
      '<div class="ai-empty-s">프로젝트 · 마일스톤 · 이슈 · 업무일지 · 수주 · A/S · 일정 중 질문에 맞는 것을 찾아 답합니다. 업무일지는 관리자 전체 · 부서장 부서 · 그 외 본인 것만 봅니다.</div>' +
      '<div class="ai-ex">' + WM_AI_EXAMPLES.map(function (x) { return '<button class="ai-ex-b" data-q="' + eA(x) + '" onclick="var t=document.getElementById(\'aiAskInput\');t.value=this.dataset.q;wmAiSend()">' + eH(x) + '</button>'; }).join('') + '</div></div>';
    return;
  }
  box.innerHTML = _wmAi.history.map(function (it, hi) {
    var h = '<div class="ai-q">' + eH(it.q) + '</div>';
    if (it.loading) return h + '<div class="ai-a ai-wait"><span class="mm-spin"></span> 데이터를 찾고 답을 쓰는 중… (보통 5~20초)</div>';
    if (it.err) return h + '<div class="ai-a ai-err">⚠️ ' + eH(it.err) + '</div>';
    var r = it.res || {};
    var src = r.sources || [];
    var cited = src.filter(function (s) { return s.cited; }), other = src.filter(function (s) { return !s.cited; });
    h += '<div class="ai-a">' + (r.note ? '<div class="ai-note">ℹ️ ' + eH(r.note) + '</div>' : '') + wmAiMdHtml(r.answer, src, hi) + '</div>';
    if (cited.length) h += '<div class="ai-srcs"><div class="ai-srcs-h">근거 ' + cited.length + '건 — 누르면 그 화면으로</div>' + cited.map(function (s) { return wmAiSrcChip(hi, s); }).join('') + '</div>';
    if (other.length) h += '<details class="ai-more"><summary>그 밖에 참고한 데이터 ' + other.length + '건</summary><div class="ai-srcs">' + other.map(function (s) { return wmAiSrcChip(hi, s); }).join('') + '</div></details>';
    if (r.context) h += '<details class="ai-more"><summary>📋 AI 가 본 데이터</summary><pre class="ai-ctx">' + eH(r.context) + '</pre></details>';
    h += '<div class="ai-meta">' + eH([r.provider, r.model].filter(Boolean).join(' · ')) + (r.quota && r.quota.limit ? ' · 이번 달 ' + r.quota.used + '/' + r.quota.limit + '회' : '') + '</div>';
    return h;
  }).join('<div class="ai-sep"></div>');
  box.scrollTop = box.scrollHeight;
  var btn = document.getElementById('aiAskBtn');
  if (btn) btn.disabled = _wmAi.busy;
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

/** 검색창이 비었을 때 — 지난 AI 답이 있으면 다시 보기 줄 */
function wmAiRecentRow() {
  if (!_wmAi.history.length) return '';
  var last = _wmAi.history[_wmAi.history.length - 1];
  return '<div class="gs-head"><span>AI</span></div><div class="gs-list"><div class="gs-item gs-ai" onclick="gsAskAi()">' +
    '<span class="gs-icon">✨</span><span class="gs-main"><span class="gs-name">지난 AI 답 다시 보기 — ' + eH(last.q) + '</span></span></div></div>';
}
