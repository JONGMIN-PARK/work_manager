/* mindmap-filter.js — 마인드맵 보기 거르기 (담당자별 · 지연 · 이번 주 마감 · 진행률 미입력 · 완료 흐리게)
 * 캔버스 왼쪽 위 막대(#mmFbar). 거르면 맞는 주제와 그 위 단계만 또렷하고 나머지는 흐리게(.mm-dim).
 * 같은 칩을 다시 누르면 맞는 주제를 차례로 찾아감(접힌 위 단계는 펼침 — 검색과 같음).
 * 상태 _mm.vf = { who, st, dimDone, idx } — 맵을 열 때마다 처음 상태. 저장하지 않음(보기 설정).
 * "작업" = 중심 주제가 아니고 담당 · 시작일 · 마감일 중 하나라도 있는 주제.
 */

/** 오늘 'YYYY-MM-DD' (내 컴퓨터 날짜 기준) */
function _mmfToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _mmfAddDays(s, k) {
  var d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + k);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * 주제마다 사실 모음 — { id: { who, task, done, p(진행률 또는 null), late, week, noprog } }
 * prog = _mmProgressMap 결과, today = 'YYYY-MM-DD'
 */
function mmTaskFacts(root, prog, today) {
  var out = {}, week = _mmfAddDays(today, 6);
  mmWalk(root, function (n, parent, depth) {
    var who = _mmAssigneeName(n);
    var g = prog[n.id];
    var p = g ? g.p : null;
    var done = !!n.done || p === 100;
    var task = depth > 0 && !!(who || n.startDate || n.dueDate);
    out[n.id] = {
      who: who, task: task, done: done, p: p,
      late: !!n.dueDate && !done && n.dueDate < today,
      week: !!n.dueDate && !done && n.dueDate >= today && n.dueDate <= week,
      noprog: task && !done && p == null
    };
  });
  return out;
}

/** 사람별 요약 — [{ who, n(작업 수), avg(값 있는 것 평균 · 없으면 null), late, done }] 작업 많은 순. 담당 없는 작업은 who '' */
function mmPeopleSummary(facts) {
  var by = {};
  Object.keys(facts).forEach(function (id) {
    var f = facts[id];
    if (!f.task) return;
    var k = f.who || '';
    var s = by[k] || (by[k] = { who: k, n: 0, psum: 0, pn: 0, late: 0, done: 0 });
    s.n++;
    if (f.p != null) { s.psum += f.p; s.pn++; }
    if (f.late) s.late++;
    if (f.done) s.done++;
  });
  return Object.keys(by).map(function (k) {
    var s = by[k];
    return { who: s.who, n: s.n, avg: s.pn ? Math.round(s.psum / s.pn) : null, late: s.late, done: s.done };
  }).sort(function (a, b) { return (a.who === '') - (b.who === '') || b.n - a.n || a.who.localeCompare(b.who); });
}

/** 거르기 조건에 맞는 주제 id 목록(트리 순). 조건이 없으면 null */
function mmFilterMatch(root, facts, vf) {
  if (!vf || (vf.who == null && !vf.st)) return null;
  var ids = [];
  mmWalk(root, function (n) {
    var f = facts[n.id];
    if (!f) return;
    if (vf.who != null && !(f.task && f.who === vf.who)) return;
    if (vf.st && !f[vf.st]) return;
    ids.push(n.id);
  });
  return ids;
}

/* ═══ 화면 ═══ */
function _mmVf() { return _mm.vf || (_mm.vf = { who: null, st: null, dimDone: false, idx: -1 }); }

/**
 * _mmPaint 가 주제를 그리기 전에 부름 — 사실 · 맞는 주제 · 흐리게 할 주제를 정함.
 * _mm.vfDim = { id: true } (흐리게), _mm.vfHits = [id…]
 */
function _mmFilterPrepare(root) {
  var vf = _mmVf();
  _mm.vfFacts = mmTaskFacts(root, _mm.prog || {}, _mmfToday());
  var hits = mmFilterMatch(root, _mm.vfFacts, vf);
  _mm.vfHits = hits || [];
  var dim = {};
  if (hits) {
    var keep = {};
    hits.forEach(function (id) {
      keep[id] = true;
      var f = mmFind(root, id);
      while (f && f.parent) { keep[f.parent.id] = true; f = mmFind(root, f.parent.id); }
      // 맞는 주제의 하위는 함께 또렷하게 (가지째 보기)
      mmWalk(mmFind(root, id).node, function (c) { keep[c.id] = true; });
    });
    mmWalk(root, function (n) { if (!keep[n.id]) dim[n.id] = true; });
  }
  if (vf.dimDone) Object.keys(_mm.vfFacts).forEach(function (id) { if (_mm.vfFacts[id].done && id !== root.id) dim[id] = true; });
  _mm.vfDim = dim;
}
function _mmFilterDim(id) { return !!(_mm.vfDim && _mm.vfDim[id]); }

function _mmPaintFilter() {
  var bar = _mmEl('mmFbar');
  if (!bar || !_mm.vfFacts) return;
  var vf = _mmVf(), facts = _mm.vfFacts;
  var cnt = { late: 0, week: 0, noprog: 0, done: 0 };
  Object.keys(facts).forEach(function (id) {
    var f = facts[id];
    if (vf.who != null && !(f.task && f.who === vf.who)) return;
    if (f.late) cnt.late++;
    if (f.week) cnt.week++;
    if (f.noprog) cnt.noprog++;
    if (f.done && f.task) cnt.done++;
  });
  var people = mmPeopleSummary(facts);
  if (!people.length && !vf.dimDone && vf.who == null && !vf.st) { bar.innerHTML = ''; bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  function chip(st, label, n, cls) {
    var on = vf.st === st;
    return '<button class="mm-fchip' + (cls || '') + (on ? ' on' : '') + '" data-vf-st="' + st + '"' + (!n && !on ? ' disabled' : '') +
      ' title="' + (on ? '다시 누르면 다음 주제로 · 끄려면 ×' : label + ' 주제만 보기') + '">' + label + ' <b>' + n + '</b></button>';
  }
  var whoLabel = vf.who == null ? '담당 전체' : (vf.who || '담당 없음');
  var h = '<div class="mm-fwho"><button class="mm-fchip mm-fchip-who' + (vf.who != null ? ' on' : '') + '" data-vf-act="people">' + _mmIcon('user', 13) + ' ' + _mmEsc(whoLabel) + ' ▾</button>' +
    '<div class="mm-fpeople hidden" id="mmFpeople"><div class="mm-fp-h">사람별 <span class="mm-hint">작업 · 평균 진행률 · 지연</span></div>' +
    '<button class="mm-fp-row' + (vf.who == null ? ' on' : '') + '" data-vf-who="*"><span>전체</span></button>' +
    people.map(function (s) {
      return '<button class="mm-fp-row' + (vf.who === s.who ? ' on' : '') + '" data-vf-who="' + _mmEsc(s.who) + '">' +
        '<span class="mm-fp-name">' + (s.who ? _mmEsc(s.who) : '<i>담당 없음</i>') + '</span>' +
        '<span class="mm-fp-n">' + s.n + '건</span>' +
        '<span class="mm-fp-bar"><i style="width:' + (s.avg || 0) + '%"></i></span><span class="mm-fp-p">' + (s.avg == null ? '—' : s.avg + '%') + '</span>' +
        '<span class="mm-fp-late' + (s.late ? '' : ' mm-fp-zero') + '">' + (s.late ? '지연 ' + s.late : '') + '</span></button>';
    }).join('') + '</div></div>' +
    chip('late', '지연', cnt.late, ' mm-fchip-late') + chip('week', '이번 주 마감', cnt.week) + chip('noprog', '진행률 미입력', cnt.noprog) +
    '<button class="mm-fchip' + (vf.dimDone ? ' on' : '') + '" data-vf-act="dimdone" title="완료한 주제를 흐리게">완료 흐리게</button>' +
    (typeof mmRiskModal === 'function' ? '<button class="mm-fchip mm-fchip-risk" data-vf-act="risk" title="지연 · 담당 없음 · 몰림 · 선후 역전 · 진척 정체 점검">🩺 점검</button>' : '') +
    (vf.who != null || vf.st || vf.dimDone ? '<button class="mm-fchip mm-fchip-x" data-vf-act="clear" title="거르기 끄기">×</button>' : '') +
    (vf.st || vf.who != null ? '<span class="mm-fcount">' + (_mm.vfHits.length ? (vf.idx >= 0 ? (vf.idx + 1) + '/' : '') + _mm.vfHits.length + '개' : '맞는 주제 없음') + '</span>' : '');
  bar.innerHTML = h;
}

/** 맞는 주제를 차례로 — 접힌 위 단계는 펼침 */
function _mmFilterJump(step) {
  var vf = _mmVf(), hits = _mm.vfHits || [];
  if (!hits.length) return;
  vf.idx = (vf.idx + (step || 1) + hits.length) % hits.length;
  var id = hits[vf.idx];
  var f = mmFind(_mmRoot(), id), opened = false;
  while (f && f.parent) {
    if (f.parent.collapsed) { f.parent.collapsed = false; opened = true; }
    f = mmFind(_mmRoot(), f.parent.id);
  }
  _mm.sel = id;
  _mmPaint();
  if (opened && !_mm.readOnly) _mmMarkDirty();
  _mmSelect(id);
}

function _mmFilterClick(e) {
  var t = e.target.closest('[data-vf-st],[data-vf-act],[data-vf-who]');
  if (!t) return;
  e.stopPropagation();
  var vf = _mmVf();
  var pop = _mmEl('mmFpeople');
  if (t.hasAttribute('data-vf-act')) {
    var act = t.getAttribute('data-vf-act');
    if (act === 'people') { if (pop) pop.classList.toggle('hidden'); return; }
    if (act === 'risk') { mmRiskModal(); return; }
    if (act === 'dimdone') vf.dimDone = !vf.dimDone;
    if (act === 'clear') { vf.who = null; vf.st = null; vf.dimDone = false; }
    vf.idx = -1;
    _mmPaint();
    return;
  }
  if (t.hasAttribute('data-vf-who')) {
    var w = t.getAttribute('data-vf-who');
    vf.who = w === '*' ? null : w;
    vf.idx = -1;
    _mmPaint();
    if (vf.who != null) _mmFilterJump(1);
    return;
  }
  var st = t.getAttribute('data-vf-st');
  if (vf.st === st) { _mmFilterJump(e.shiftKey ? -1 : 1); return; }
  vf.st = st; vf.idx = -1;
  _mmPaint();
  _mmFilterJump(1);
}

function _mmBindFilter() {
  var bar = _mmEl('mmFbar');
  if (!bar) return;
  bar.addEventListener('click', _mmFilterClick);
  // 캔버스 끌기 · 선택이 시작되지 않게
  bar.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  document.addEventListener('mousedown', function (e) {
    var pop = _mmEl('mmFpeople');
    if (pop && !pop.classList.contains('hidden') && !e.target.closest('.mm-fwho')) pop.classList.add('hidden');
  });
}

if (typeof module !== 'undefined') module.exports = { mmTaskFacts: mmTaskFacts, mmPeopleSummary: mmPeopleSummary, mmFilterMatch: mmFilterMatch };
