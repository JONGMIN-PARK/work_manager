/**
 * chat-cards.js — 💬 메신저 업무 카드 살리기 (v13.422)
 *   ① # 로 업무 부르기 — @ 사람처럼 # 치면 프로젝트 · 이슈 · A/S · 수주 · 문서 … 자동완성 → 카드로 붙음
 *   ② 자동 펼침 — 글에 A/S 번호 · 수주번호 · 프로젝트 이름이 있으면 말풍선 아래 작은 카드 (읽는 사람 권한으로만)
 *   ③ 카드에서 바로 처리 — A/S 진행 · 종결, 할 일 완료 · 내일로, 마일스톤 완료, 프로젝트 다음 단계
 *      실제 바꾸기는 각 화면과 같은 API(같은 권한 · 알림 · 변경 기록) → /chat/messages/:id/acted 가 카드 갱신 + 방에 한 줄
 * 상태 캐시: CX.live['type:id'] = { t, v } · 펼침 캐시: CX.unf[msgId] = { b: 본문, l: [card] }
 */
var CXC_TYPES = ['project', 'milestone', 'issue', 'order', 'as', 'todo'];
var CXC_TTL = 90000;
var CXC = { q: null, timer: 0, busy: false, again: false, hashSeq: 0, hashCache: {} };

function _cxcKey(c) { return c.type + ':' + c.id; }
function _cxcLive(c) { var L = CX.live && CX.live[_cxcKey(c)]; return L ? L.v : undefined; }
function chatLiveDrop(cards) { (cards || []).forEach(function (c) { if (c && CX.live) delete CX.live[_cxcKey(c)]; }); }

/* ── 카드 안 지금 상태 줄 — 상태 · 담당 · 마감(D-n) · 진행률 ── */
function _cxcDday(d) {
  if (!d) return '';
  var t = new Date(); t.setHours(0, 0, 0, 0);
  var x = new Date(d + 'T00:00:00'), n = Math.round((x - t) / 86400000);
  var cls = n < 0 ? 'late' : n <= 2 ? 'near' : '';
  return '<span class="cx-lv-d ' + cls + '" title="마감 ' + d + '">' + (n === 0 ? '오늘' : n < 0 ? (-n) + '일 지남' : 'D-' + n) + '</span>';
}
function chatCardLiveHtml(c) {
  var L = _cxcLive(c);
  if (!L) return '';
  var done = L.stc === 'done' || L.stc === 'closed' || L.stc === 'resolved' || L.stc === 'cancelled';
  var h = '<span class="cx-lv">';
  if (L.st && c.type !== 'issue') h += '<em class="cx-lv-s s-' + _cxE(L.stc || '') + '">' + _cxE(L.st) + '</em>';
  if (L.urg && c.type === 'as') h += '<em class="cx-lv-s s-urg">긴급</em>';
  if (L.who) h += '<span class="cx-lv-w" title="담당">' + _cxIco('people') + _cxE(L.who) + '</span>';
  if (L.due && !done) h += _cxcDday(L.due);
  if (L.pct != null && c.type !== 'todo') h += '<span class="cx-lv-p" title="진행률 ' + L.pct + '%"><i style="width:' + Math.max(0, Math.min(100, L.pct)) + '%"></i></span><b class="cx-lv-pn">' + L.pct + '%</b>';
  return h + '</span>';
}
/* 처리 단추 — 권한 있는 것만 (L.ed) · 이슈는 예전 단추 그대로 */
function _cxcActs(c, L) {
  if (!L || !L.ed) return [];
  var s = L.stc;
  if (c.type === 'project') return L.next ? [['phase', '▸ ' + L.nextL + ' 단계로']] : [];
  if (c.type === 'milestone') return s === 'done' ? [['ms_open', '다시 열기']] : [['ms_done', '✓ 완료']];
  if (c.type === 'as') {
    if (s === 'closed' || s === 'cancelled') return [];
    var a = [];
    if (s === 'received' || s === 'assigned' || s === 'hold' || s === 'customer_wait') a.push(['as_go', '진행 시작']);
    if (s !== 'customer_wait') a.push(['as_wait', '고객 대기']);
    a.push(['as_close', '✓ 종결']);
    return a;
  }
  if (c.type === 'todo' && L.mine) return s === 'done' ? [['td_undo', '되돌리기']] : [['td_done', '✓ 완료'], ['td_tmr', '내일로']];
  return [];
}
function chatCardActsHtml(c, i, m, unf) {
  if (m.deleted || m.pending || c.type === 'issue') return '';
  var a = _cxcActs(c, _cxcLive(c));
  if (!a.length) return '';
  return '<span class="cx-card-a">' + a.map(function (x) { return '<button type="button" data-kact="' + x[0] + '" data-ci="' + i + '"' + (unf ? ' data-u="1"' : '') + '>' + _cxE(x[1]) + '</button>'; }).join('') + '</span>';
}
/* ② 자동 펼침 카드 묶음 */
function chatUnfHtml(m) {
  var u = CX.unf && CX.unf[m.id];
  if (!u || u.b !== m.body || !u.l || !u.l.length || m.deleted) return '';
  return '<div class="cx-cards cx-unf">' + u.l.map(function (c, i) { return _cxCardHtml(c, i, m, true); }).join('') + '</div>';
}

/* ── 지금 상태 · 펼침 한꺼번에 받기 (그리고 나서 250ms 모아) ── */
function chatPeekQueue() {
  clearTimeout(CXC.timer);
  CXC.timer = setTimeout(_cxcPeek, 250);
}
function _cxcPeekable(m) { return m && typeof m.id === 'number' && !m.deleted && !m.pending && (m.kind === 'text' || m.kind === 'ai') && m.body && !m.post && !m.poll && m.body[0] !== '/'; }
function _cxcPeek() {
  if (CXC.busy) { CXC.again = true; return; }
  if (!CX.room) return;
  CX.live = CX.live || {}; CX.unf = CX.unf || {};
  var now = Date.now(), refs = [], texts = [], seen = {}, list = (CX.msgs || []).concat(CX.thread ? CX.threadMsgs || [] : []);
  for (var i = list.length - 1; i >= 0; i--) {
    var m = list[i]; if (!m || m.deleted) continue;
    (m.cards || []).forEach(function (c) {
      if (CXC_TYPES.indexOf(c.type) < 0 || (m.kind === 'system' && !c.show)) return;
      var k = _cxcKey(c), L = CX.live[k];
      if (seen[k] || (L && (L.f || now - L.t < CXC_TTL))) return;
      seen[k] = 1; refs.push({ type: c.type, id: c.id });
    });
    var u = CX.unf[m.id];
    if (u && u.b === m.body) { (u.l || []).forEach(function (c) { var k = _cxcKey(c), L = CX.live[k]; if (!seen[k] && !(L && (L.f || now - L.t < CXC_TTL))) { seen[k] = 1; refs.push({ type: c.type, id: c.id }); } }); continue; }
    if (_cxcPeekable(m) && texts.length < 40) texts.push({ k: m.id, t: m.body, skip: (m.cards || []).map(_cxcKey) });
  }
  if (!refs.length && !texts.length) return;
  refs = refs.slice(0, 60);
  refs.forEach(function (r) { var k = r.type + ':' + r.id; CX.live[k] = Object.assign(CX.live[k] || { t: 0 }, { f: 1 }); });
  var bodies = {}; texts.forEach(function (x) { bodies[x.k] = x.t; CX.unf[x.k] = { b: x.t, l: [] }; });
  var room = CX.room;
  CXC.busy = true;
  apiFetch('/api/chat/peek', { method: 'POST', body: JSON.stringify({ refs: refs, texts: texts }) }).then(function (r) {
    var d = (r && r.data) || {}, t = Date.now(), changed = false;
    Object.keys(d.live || {}).forEach(function (k) { var old = CX.live[k] && CX.live[k].v; CX.live[k] = { t: t, v: d.live[k] }; if (JSON.stringify(old) !== JSON.stringify(d.live[k])) changed = true; });
    refs.forEach(function (x) { var k = x.type + ':' + x.id; if (CX.live[k] && CX.live[k].f) CX.live[k] = { t: t, v: CX.live[k].v }; });
    Object.keys(d.unf || {}).forEach(function (k) { if (bodies[k] != null) { CX.unf[k] = { b: bodies[k], l: d.unf[k] || [] }; if ((d.unf[k] || []).length) changed = true; } });
    if (changed && CX.room === room) _cxcRedraw();
  }).catch(function () {
    refs.forEach(function (x) { var k = x.type + ':' + x.id; if (CX.live[k]) CX.live[k] = { t: Date.now(), v: CX.live[k].v }; });
  }).then(function () { CXC.busy = false; if (CXC.again) { CXC.again = false; chatPeekQueue(); } });
}
function _cxcRedraw() {
  _cxDrawMsgs(true);
  if (CX.thread && typeof _cxDrawThread === 'function') { var tb = document.getElementById('cxThMsgs'), st = tb && tb.scrollTop; _cxDrawThread(); if (tb) tb.scrollTop = st; }
}

/* ── ③ 카드 처리 ── */
function _cxcTomorrow() { var d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
var CXC_DO = {
  phase: function (c, L) { return confirm('"' + L.title + '" — ' + L.st + ' → ' + L.nextL + ' 단계로 넘길까요?') && { url: '/api/projects/' + encodeURIComponent(c.id), body: { currentPhase: L.next }, what: L.nextL + ' 단계로' }; },
  ms_done: function (c) { return { url: '/api/milestones/' + encodeURIComponent(c.id), body: { status: 'done' }, what: '완료' }; },
  ms_open: function (c) { return { url: '/api/milestones/' + encodeURIComponent(c.id), body: { status: 'active' }, what: '다시 열기' }; },
  as_go: function (c, L) { return { url: '/api/as-tickets/' + encodeURIComponent(L.id || c.id), body: { status: 'in_progress' }, what: '진행 시작' }; },
  as_wait: function (c, L) { return { url: '/api/as-tickets/' + encodeURIComponent(L.id || c.id), body: { status: 'customer_wait' }, what: '고객 대기' }; },
  as_close: function (c, L) { return confirm('"' + L.title + '" A/S 를 종결할까요?\n원인 · 종결 내용은 A/S 화면에서 채울 수 있어요.') && { url: '/api/as-tickets/' + encodeURIComponent(L.id || c.id), body: { status: 'closed' }, what: '종결' }; },
  td_done: function (c) { return { url: '/api/my-work/todos/' + encodeURIComponent(c.id), body: { done: true }, what: '완료' }; },
  td_undo: function (c) { return { url: '/api/my-work/todos/' + encodeURIComponent(c.id), body: { done: false }, what: '되돌리기' }; },
  td_tmr: function (c) { return { url: '/api/my-work/todos/' + encodeURIComponent(c.id), body: { dueDate: _cxcTomorrow() }, what: '내일로 미룸' }; }
};
function chatCardAct(btn, m) {
  var unf = !!btn.dataset.u, ci = +btn.dataset.ci;
  var c = unf ? (CX.unf[m.id] && CX.unf[m.id].l || [])[ci] : (m.cards || [])[ci];
  var L = c && _cxcLive(c), f = c && CXC_DO[btn.dataset.kact];
  if (!c || !L || !f) return;
  var job = f(c, L); if (!job) return;
  var bs = btn.parentNode.querySelectorAll('button'); bs.forEach(function (b) { b.disabled = true; });
  apiFetch(job.url, { method: 'PUT', body: JSON.stringify(job.body) }).then(function () {
    return apiFetch('/api/chat/messages/' + m.id + '/acted', { method: 'POST', body: JSON.stringify({ type: c.type, id: c.id, card: unf ? null : ci, what: job.what }) });
  }).then(function (r) {
    if (r && r.data && r.data.live) CX.live[_cxcKey(c)] = { t: Date.now(), v: r.data.live };
    _cxcRedraw();
  }).catch(function (err) {
    bs.forEach(function (b) { b.disabled = false; });
    _cxToast(_cxErr(err), 'error');
  });
}

/* ── ① # 자동완성 — 통합 검색(/api/search) 그대로 · 권한도 같음 ── */
var CXC_HASH_ORDER = ['project', 'issue', 'as', 'order', 'milestone', 'doc', 'meeting', 'todo', 'note', 'mindmap', 'checklist', 'dev', 'prestudy', 'tech', 'weekly'];
function chatHashFind(q, cb) {
  var seq = ++CXC.hashSeq;
  if (CXC.hashCache[q]) { cb(CXC.hashCache[q]); return; }
  clearTimeout(CXC.hashT);
  CXC.hashT = setTimeout(function () {
    apiFetch('/api/search?limit=3&q=' + encodeURIComponent(q)).then(function (r) {
      var gs = (r.data && r.data.groups) || [], out = [];
      CXC_HASH_ORDER.forEach(function (k) {
        var g = gs.filter(function (x) { return x.key === k; })[0];
        (g && g.items || []).forEach(function (it) { if (out.length < 8) out.push({ type: k, id: it.id, title: it.title, sub: it.sub, nav: it.nav }); });
      });
      CXC.hashCache[q] = out;
      if (seq === CXC.hashSeq) cb(out);
    }).catch(function () { if (seq === CXC.hashSeq) cb([]); });
  }, 180);
}
function chatHashCancel() { CXC.hashSeq++; clearTimeout(CXC.hashT); }
