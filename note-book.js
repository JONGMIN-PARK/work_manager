/* ═══════════════════════════════════════════════════════════════════════
   note-book.js — 📖 펼쳐 보기 (v13.325 · v13.326 모든 노트로)
   ─────────────────────────────────────────────────────────────────────
   내가 쓴 글을 책처럼 2 · 3 · 4장 나란히 — 📝 일일 노트 · 📓 노트북 노트 · 📋 업무일지(내 것, 날마다 한 장) · 🤝 회의록(볼 수 있는 프로젝트)
     · 왼쪽 목록에서 종류 칩 · 찾기 · 체크로 고름 (4장까지, 더 고르면 장 수가 늘어남)
     · ‹ › · ← → · 종이 밀기 · 바깥 모서리 — 두 장이면 한 장이 등을 축으로 넘어가고(앞면 = 넘어가는 장, 뒷면 = 새 장), 3 · 4장은 차례로 넘어옴
     · 넘기기는 지금 보이는 목록(종류 · 찾기) 순서대로 · 끝 장이면 들썩
     · 종이 머리 → 원래 화면에서 열기 (노트 서랍 · 노트북 · 주간 업무 · 프로젝트 회의)
   진입: wmBookOpen({ cur: 'daily:날짜|ref' | 'note:id' | 'log:날짜' | 'meeting:id', kind }) — 📝 서랍 📖 · 📓 노트북 📖 · 회의 카드 📖
   서버: GET /api/notebook/shelf · POST /api/notebook/shelf/pages { keys }
   스타일: style.css .mwns-*  (상태 _wb · 장 수 localStorage 'mwn-spread-n')
   전역 의존: wmGuardedModal · createModal · apiFetch · NbMd(있으면 마크다운) · mwNotesOpen · nbOpenNote · globalSearchNav · showToast
   ═══════════════════════════════════════════════════════════════════════ */

var WB_MAX = 4;
var WB_KIND = {
  daily: { icon: '📝', label: '일일 노트' },
  note: { icon: '📓', label: '노트' },
  log: { icon: '📋', label: '업무일지' },
  meeting: { icon: '🤝', label: '회의록' }
};
var _wb = { n: 2, list: [], pick: [], pages: {}, q: '', kind: 'all', seq: 0, flipping: false };

function _wbEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _wbToast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }
function _wbErr(e) { return (e && e.data && e.data.message) || (e && e.message) || '서버 오류'; }
function _wbToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
function _wbDay(d) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(d || '')) return d || '';
  var t = _wbToday(), n = Math.round((Date.parse(d.slice(0, 10)) - Date.parse(t)) / 86400000);
  return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + ' (' + '일월화수목금토'[new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay()] + ')' +
    (n === 0 ? ' · 오늘' : n === -1 ? ' · 어제' : d.slice(0, 4) !== t.slice(0, 4) ? ' · ' + d.slice(0, 4) : '');
}
function _wbN() { var n = 0; try { n = +localStorage.getItem('mwn-spread-n'); } catch (e) {} return n >= 2 && n <= WB_MAX ? n : 2; }
function _wbSetN(n) {
  _wb.n = n;
  try { localStorage.setItem('mwn-spread-n', String(n)); } catch (e) {}
  document.querySelectorAll('#mwnSpreadModal .mwns-seg button').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-v') === n); });
}
function _wbItem(k) { for (var i = 0; i < _wb.list.length; i++) if (_wb.list[i].key === k) return _wb.list[i]; return null; }
/** 지금 목록에 보이는 것 (종류 칩 · 찾기) — 넘기기도 이 순서 */
function _wbVisible() {
  var q = _wb.q;
  return _wb.list.filter(function (x) {
    if (_wb.kind !== 'all' && x.kind !== _wb.kind) return false;
    if (!q) return true;
    var pg = _wb.pages[x.key];
    return [x.title, x.sub, x.snip, x.date, _wbDay(x.date), pg && pg.text].some(function (s) { return s && String(s).toLowerCase().indexOf(q) >= 0; });
  });
}
/** 고른 것 — 전체 목록 순서(최신 위). 종이는 이걸 뒤집어 옛 장이 왼쪽 */
function _wbSorted() {
  var keys = _wb.list.map(function (x) { return x.key; });
  return _wb.pick.filter(function (k) { return keys.indexOf(k) >= 0; }).sort(function (a, b) { return keys.indexOf(a) - keys.indexOf(b); });
}

/* ═══ 열기 ═══ */
function wmBookOpen(opts) {
  opts = opts || {};
  return wmGuardedModal('mwnSpread', function () {
    _wb.n = _wbN(); _wb.q = ''; _wb.pages = {}; _wb.flipping = false;
    return apiFetch('/api/notebook/shelf').then(function (r) {
      _wb.list = (r && r.data) || [];
      if (!_wb.list.length) { _wbToast('아직 쓴 노트가 없습니다 — 📝 노트 · 📓 노트북 · 업무일지 · 회의록에 먼저 써 주세요', 'warn'); return false; }
      var cur = opts.cur && _wbItem(opts.cur);
      _wb.kind = opts.kind || (cur ? cur.kind : 'all');
      if (!_wb.list.some(function (x) { return _wb.kind === 'all' || x.kind === _wb.kind; })) _wb.kind = 'all';
      var vis = _wbVisible(), at = cur ? vis.indexOf(cur) : 0;
      at = Math.max(0, Math.min(vis.length - _wb.n, at < 0 ? 0 : at));
      _wb.pick = vis.slice(at, at + _wb.n).map(function (x) { return x.key; });
      if (cur && _wb.pick.indexOf(cur.key) < 0) _wb.pick[0] = cur.key;
      _wbBuild();
    });
  }, 'mwnSpreadModal', { onOpen: _wbLoad });
}

function _wbBuild() {
  var kinds = ['all', 'daily', 'note', 'log', 'meeting'].filter(function (k) { return k === 'all' || _wb.list.some(function (x) { return x.kind === k; }); });
  var h = '<div class="mwns">' +
    '<div class="mwns-bar">' +
      '<span class="mwns-seg" role="group" aria-label="한 번에 볼 장 수">' + [2, 3, 4].map(function (n) { return '<button type="button" data-s="n" data-v="' + n + '" class="' + (_wb.n === n ? 'on' : '') + '">' + n + '장</button>'; }).join('') + '</span>' +
      '<button type="button" class="mw-btn" data-s="prev" title="옛 쪽으로 넘기기 (←)">‹ 앞 장</button><button type="button" class="mw-btn" data-s="next" title="새 쪽으로 넘기기 (→)">뒷 장 ›</button>' +
      '<span class="mwns-cnt" id="mwnsCnt"></span><span style="flex:1"></span>' +
      '<button type="button" class="mw-btn" data-s="side" title="고르는 목록 접기 · 펴기">☰ 목록</button>' +
    '</div>' +
    '<div class="mwns-main">' +
      '<div class="mwns-side">' +
        '<div class="mwns-kinds" role="group" aria-label="종류">' + kinds.map(function (k) {
          var n = k === 'all' ? _wb.list.length : _wb.list.filter(function (x) { return x.kind === k; }).length;
          return '<button type="button" data-s="kind" data-v="' + k + '" class="' + (_wb.kind === k ? 'on' : '') + '">' + (k === 'all' ? '전체' : WB_KIND[k].icon + ' ' + WB_KIND[k].label) + ' <b>' + n + '</b></button>';
        }).join('') + '</div>' +
        '<input class="mw-input" id="mwnsQ" placeholder="찾기 (날짜 · 제목 · 내용)" autocomplete="off"><div class="mwns-list" id="mwnsList"></div></div>' +
      '<div class="mwns-book" id="mwnsBook"></div>' +
    '</div></div>';
  var ov = createModal({ id: 'mwnSpreadModal', width: 'min(1500px, 97vw)', titleText: '📖 펼쳐 보기', html: h, closeOnEsc: true,
    boxStyle: 'max-height:92vh;height:92vh;padding:14px 16px;display:flex;flex-direction:column;overflow:hidden' }).overlay;
  ov.classList.add('mwns-ov');
  var wrap = ov.querySelector('.mwns').parentElement;   // createModal 의 본문 칸도 늘어나야 종이가 창 높이를 채움
  if (wrap && !wrap.classList.contains('wa-modal-box')) wrap.style.cssText += ';flex:1;min-height:0;display:flex;flex-direction:column';
  if (window.innerWidth < 700) ov.querySelector('.mwns').classList.add('no-side');   // 휴대폰은 종이부터
  _wbPaintList();
  ov.addEventListener('click', function (e) {
    var t = e.target;
    var s = t.closest('[data-s]');
    if (s) {
      var k = s.getAttribute('data-s');
      if (k === 'n') { _wbSetN(+s.getAttribute('data-v')); _wbFill(); return; }
      if (k === 'kind') { _wb.kind = s.getAttribute('data-v'); ov.querySelectorAll('.mwns-kinds button').forEach(function (b) { b.classList.toggle('on', b === s); }); _wbPaintList(); return; }
      if (k === 'prev' || k === 'next') return _wbFlip(k === 'prev' ? 1 : -1);
      if (k === 'side') { ov.querySelector('.mwns').classList.toggle('no-side'); return; }
      if (k === 'open') return _wbOpenSrc(s.getAttribute('data-k'));
      if (k === 'drop') return _wbToggle(s.getAttribute('data-k'));
    }
    var it = t.closest('[data-pk]');
    if (it) { e.preventDefault(); _wbToggle(it.getAttribute('data-pk')); }
  });
  ov.querySelector('#mwnsQ').addEventListener('input', function (e) { _wb.q = e.target.value.trim().toLowerCase(); _wbPaintList(); });
  ov.addEventListener('keydown', function (e) {
    if (e.target.id === 'mwnsQ' || e.isComposing) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); _wbFlip(1); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); _wbFlip(-1); }
  });
  _wbSwipe(ov.querySelector('#mwnsBook'));
  ov.tabIndex = -1; ov.focus();
}

/* ═══ 고르기 ═══ */
/** 장 수를 바꾸면 — 늘면 지금 목록에서 고른 것 옆(옛 쪽 먼저)으로 채우고, 줄면 옛 쪽부터 뺌 */
function _wbFill() {
  var keys = _wbVisible().map(function (x) { return x.key; }), pick = _wbSorted().slice(0, _wb.n);
  var last = -1, i;
  pick.forEach(function (k) { var j = keys.indexOf(k); if (j > last) last = j; });
  for (i = last + 1; pick.length < _wb.n && i < keys.length; i++) if (pick.indexOf(keys[i]) < 0) pick.push(keys[i]);
  for (i = last - 1; pick.length < _wb.n && i >= 0; i--) if (pick.indexOf(keys[i]) < 0) pick.push(keys[i]);
  _wb.pick = pick;
  _wbPaintList(); _wbLoad();
}
function _wbToggle(k) {
  var at = _wb.pick.indexOf(k);
  if (at >= 0) _wb.pick.splice(at, 1);
  else {
    if (_wb.pick.length >= _wb.n) {
      if (_wb.n < WB_MAX) _wbSetN(_wb.n + 1);   // 더 고르면 장 수도 늘림 (4장까지)
      else { _wbToast('한 번에 ' + WB_MAX + '장까지 펼칠 수 있습니다 — 하나를 빼고 고르세요', 'warn'); return; }
    }
    _wb.pick.push(k);
  }
  _wbPaintList(); _wbLoad();
}
function _wbPaintList() {
  var box = document.getElementById('mwnsList');
  if (!box) return;
  var sorted = _wbSorted(), rows = _wbVisible();
  box.innerHTML = rows.length ? rows.map(function (x) {
    var on = sorted.indexOf(x.key) >= 0, K = WB_KIND[x.kind] || { icon: '•' };
    var head = x.kind === 'daily' || x.kind === 'log' ? _wbDay(x.date) + (x.kind === 'log' ? ' · 업무일지' : x.title === '회의 메모' ? ' · 🤝 회의 메모' : '') : x.title;
    var side = x.kind === 'daily' || x.kind === 'log' ? (x.sub || (x.lines ? x.lines + '줄' : '')) : _wbDay(x.date);
    return '<label class="mwns-it k-' + x.kind + (on ? ' on' : '') + '" data-pk="' + _wbEsc(x.key) + '"><input type="checkbox" tabindex="-1"' + (on ? ' checked' : '') + '>' +
      '<b><em>' + K.icon + '</em> ' + _wbEsc(head) + '</b><i>' + _wbEsc(side) + '</i><span>' + _wbEsc((x.kind === 'meeting' && x.sub ? x.sub + ' — ' : '') + (x.snip || '')) + '</span></label>';
  }).join('') : '<div class="mwn-e">맞는 것이 없습니다</div>';
  var c = document.getElementById('mwnsCnt');
  if (c) c.textContent = sorted.length + ' / ' + _wb.n + '장';
}

/* ═══ 본문 ═══ */
function _wbLoad() {
  var keys = _wbSorted(), seq = ++_wb.seq;
  _wb.flipping = false;
  _wbPaintBook();
  if (keys.every(function (k) { return k in _wb.pages; })) return;
  _wbEnsure(keys).then(function () { if (seq === _wb.seq) _wbPaintBook(); })
    .catch(function (e) { _wbToast('❌ 불러오지 못했습니다 — ' + _wbErr(e), 'error'); });
}
/** 본문 받아 두기 — 넘기기 전에 먼저 (뒷면이 '불러오는 중' 이 되지 않게) */
function _wbEnsure(keys) {
  var need = keys.filter(function (k) { return !(k in _wb.pages); });
  if (!need.length) return Promise.resolve();
  return apiFetch('/api/notebook/shelf/pages', { method: 'POST', body: JSON.stringify({ keys: need }) }).then(function (r) {
    var d = (r && r.data) || {};
    need.forEach(function (k) { _wb.pages[k] = d[k] || null; });   // null = 지워졌거나 볼 수 없음
  });
}
function _wbBodyHtml(pg) {
  if (pg === undefined) return '<div class="mwn-e">불러오는 중…</div>';
  if (pg === null) return '<div class="mwn-e">지워졌거나 볼 수 없는 글입니다</div>';
  if (!String(pg.text || '').trim()) return '<div class="mwn-e">빈 노트</div>';
  if (pg.mode === 'md' && typeof NbMd !== 'undefined') return '<div class="mwns-md">' + NbMd.render(pg.text).html + '</div>';
  // 일일 노트 줄 — ## 은 제목, - [ ] 은 빈 칸, - [x] 는 ✓ (v13.332: 기호를 그대로 보이지 않게)
  var lines = String(pg.text).split('\n').map(function (l) {
    var m = /^- \[[xX]\] (.*?)(?: ⟦[^⟧]*⟧)?$/.exec(l);
    if (m) return { t: m[1], c: 'is-todo', i: '<i>✓</i>' };
    if ((m = /^- \[ \] (.*?)(?: ⟦[^⟧]*⟧)?$/.exec(l))) return { t: m[1], c: 'is-pend', i: '<i class="mwns-box"></i>' };
    if ((m = /^#{1,3}\s+(.*)$/.exec(l))) return { t: m[1], c: 'is-h' };
    return { t: l };
  });
  while (lines.length && !lines[lines.length - 1].t) lines.pop();
  return lines.map(function (r) { return '<div class="mwns-l' + (r.c ? ' ' + r.c : '') + '">' + (r.i || '') + (_wbEsc(r.t) || '&nbsp;') + '</div>'; }).join('');
}
function _wbPaintBook() {
  var book = document.getElementById('mwnsBook');
  if (!book) return;
  var keys = _wbSorted().slice().reverse();   // 옛 장이 왼쪽 — 책 넘기는 순서
  book.style.setProperty('--mwns-n', Math.max(1, keys.length));
  book.className = 'mwns-book' + (keys.length === 2 ? ' is-pair' : '');
  if (!keys.length) { book.innerHTML = '<div class="mwns-empty">왼쪽 목록에서 볼 글을 고르세요 (최대 ' + WB_MAX + '장)</div>'; return; }
  var last = keys.length - 1;
  book.innerHTML = keys.map(function (k, i) {
    var x = _wbItem(k) || {}, pg = _wb.pages[k], K = WB_KIND[x.kind] || { icon: '', label: '' };
    var dated = x.kind === 'daily' || x.kind === 'log';
    var title = dated ? _wbDay(x.date) : (pg && pg.title) || x.title || '';
    var sub = [dated ? (x.title === '회의 메모' ? '🤝 회의 메모' : K.label) : _wbDay(x.date), (pg && pg.sub) || (x.kind !== 'daily' ? x.sub : '')].filter(Boolean).join(' · ');
    var lineN = pg && pg.text ? String(pg.text).split('\n').filter(function (l) { return l.trim(); }).length : 0;
    return '<article class="mwns-page k-' + _wbEsc(x.kind || '') + '" data-k="' + _wbEsc(k) + '">' +
      '<header><button type="button" class="mwns-ph" data-s="open" data-k="' + _wbEsc(k) + '" title="원래 화면에서 열기"><em>' + K.icon + '</em><b>' + _wbEsc(title) + '</b><span>' + _wbEsc(sub) + '</span></button>' +
        '<button type="button" class="mwns-x" data-s="drop" data-k="' + _wbEsc(k) + '" title="이 장 빼기">✕</button></header>' +
      '<div class="mwns-lines">' + _wbBodyHtml(pg) + '</div>' +
      '<footer><span>' + (lineN ? lineN + '줄' : '') + '</span><span>' + (i + 1) + '</span></footer>' +
      (i === 0 ? '<button type="button" class="mwns-corner l" data-s="prev" title="앞 장 (옛 쪽)" aria-label="앞 장"></button>' : '') +
      (i === last ? '<button type="button" class="mwns-corner r" data-s="next" title="뒷 장 (새 쪽)" aria-label="뒷 장"></button>' : '') +
      '</article>';
  }).join('');
}

/* ═══ 넘기기 ═══ */
/** ‹ › — 지금 목록(종류 · 찾기)에서 장 수만큼 통째로 (d=1 옛 쪽 · -1 새 쪽). 본문을 먼저 받은 뒤 책장 넘기듯 */
function _wbFlip(d) {
  if (_wb.flipping) return;
  var keys = _wbVisible().map(function (x) { return x.key; }), cur = _wbSorted(), n = _wb.n;
  var idx = cur.map(function (k) { return keys.indexOf(k); }).filter(function (j) { return j >= 0; });
  var top = idx.length ? Math.min.apply(null, idx) : (d > 0 ? -n : keys.length);
  var start = Math.max(0, Math.min(Math.max(0, keys.length - n), top + d * n));
  var next = keys.slice(start, start + n);
  if (!next.length || next.join() === cur.join()) { _wbBump(d); return; }
  var seq = ++_wb.seq;
  _wb.flipping = true;
  _wbEnsure(next).catch(function () {}).then(function () {
    if (seq !== _wb.seq || !document.getElementById('mwnsBook')) { _wb.flipping = false; return; }
    _wb.pick = next;
    _wbPaintList();
    var first = document.querySelector('#mwnsList .mwns-it.on');
    if (first) first.scrollIntoView({ block: 'nearest' });
    _wbTurn(d, function () { _wb.flipping = false; });
  });
}
function _wbCalm() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
/** 끝에서 더 넘기려 하면 — 종이가 살짝 들렸다 내려앉음 */
function _wbBump(d) {
  var book = document.getElementById('mwnsBook');
  var p = book && book.querySelector(d > 0 ? '.mwns-page:first-child' : '.mwns-page:last-child');
  if (p && !_wbCalm()) { p.classList.remove('mwns-bump-l', 'mwns-bump-r'); void p.offsetWidth; p.classList.add(d > 0 ? 'mwns-bump-l' : 'mwns-bump-r'); }
  _wbToast(d > 0 ? '가장 옛 장입니다' : '가장 최근 장입니다');
}
/** 책장 넘기기 — 두 장이면 한 장(앞면 = 넘어가는 장, 뒷면 = 새로 보일 장)이 등을 축으로. 3 · 4장이면 차례로 넘어옴 */
function _wbTurn(d, done) {
  var book = document.getElementById('mwnsBook');
  var olds = book ? book.querySelectorAll('.mwns-page') : [];
  var nowN = _wbSorted().length;
  if (!book || _wbCalm() || !olds.length) { _wbPaintBook(); done(); return; }
  var pair = olds.length === 2 && nowN === 2 && book.classList.contains('is-pair');
  if (!pair) {
    _wbPaintBook();
    var ps = book.querySelectorAll('.mwns-page'), cnt = ps.length;
    ps.forEach(function (p, i) {
      p.style.animationDelay = ((d < 0 ? i : cnt - 1 - i) * 90) + 'ms';   // 새 쪽으로 넘기면 왼쪽부터, 옛 쪽이면 오른쪽부터
      p.classList.add(d < 0 ? 'mwns-in-r' : 'mwns-in-l');
    });
    setTimeout(function () { ps.forEach(function (p) { p.classList.remove('mwns-in-r', 'mwns-in-l'); p.style.animationDelay = ''; }); done(); }, 520 + cnt * 90);
    return;
  }
  var fwd = d < 0, from = olds[fwd ? 1 : 0], stay = olds[fwd ? 0 : 1];
  var box = function (el) { return 'left:' + el.offsetLeft + 'px;top:' + el.offsetTop + 'px;width:' + el.offsetWidth + 'px;height:' + el.offsetHeight + 'px'; };
  var fromBox = box(from), stayBox = box(stay), frontHtml = from.outerHTML, coverHtml = stay.outerHTML;
  _wbPaintBook();   // 밑에는 이미 새 펼침면
  var backHtml = book.querySelectorAll('.mwns-page')[fwd ? 0 : 1].outerHTML;   // 넘어간 장의 뒷면 = 새 펼침면에서 그쪽 장
  var cover = document.createElement('div');   // 넘어가는 장이 내려앉기 전까지 반대쪽은 옛 장이 덮고 있음
  cover.className = 'mwns-cover'; cover.style.cssText = stayBox; cover.innerHTML = coverHtml;
  var leaf = document.createElement('div');
  leaf.className = 'mwns-leaf ' + (fwd ? 'to-l' : 'to-r'); leaf.style.cssText = fromBox;
  leaf.innerHTML = '<div class="mwns-face front">' + frontHtml + '<i class="mwns-shade"></i></div><div class="mwns-face back">' + backHtml + '<i class="mwns-shade"></i></div>';
  book.appendChild(cover); book.appendChild(leaf);
  book.classList.add('is-turning');
  var fin = false, end = function () { if (fin) return; fin = true; leaf.remove(); cover.remove(); book.classList.remove('is-turning'); done(); };
  leaf.addEventListener('animationend', function (e) { if (e.target === leaf) { cover.remove(); setTimeout(end, 30); } });
  setTimeout(end, 1300);   // 애니메이션 이벤트가 안 와도 풀림
  requestAnimationFrame(function () { leaf.classList.add('go'); });
}
/** 손가락 · 마우스로 밀어 넘기기 (종이 위에서 옆으로 60px 넘게) */
function _wbSwipe(book) {
  var sx = null, sy = 0;
  book.addEventListener('pointerdown', function (e) {
    if (e.button || e.target.closest('button, a, input')) { sx = null; return; }
    sx = e.clientX; sy = e.clientY;
  });
  book.addEventListener('pointerup', function (e) {
    if (sx == null) return;
    var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(window.getSelection && String(window.getSelection()))) _wbFlip(dx < 0 ? -1 : 1);
  });
  book.addEventListener('pointercancel', function () { sx = null; });
}

/* ═══ 원래 화면에서 열기 ═══ */
function _wbOpenSrc(k) {
  var x = _wbItem(k), pg = _wb.pages[k];
  if (!x) return;
  var m = document.getElementById('mwnSpreadModal');
  if (m) m.remove();
  var id = k.slice(k.indexOf(':') + 1);
  if (x.kind === 'daily') {
    var at = id.indexOf('|'), d = id.slice(0, at), ref = id.slice(at + 1);
    if (typeof curPage !== 'undefined' && curPage === 'mywork' && typeof mwNotesOpen === 'function') {
      if (typeof mwNotesIsOpen === 'function' && mwNotesIsOpen()) mwNotesGo(d, ref); else mwNotesOpen(d, ref);
    } else if (typeof globalSearchNav === 'function') globalSearchNav('note', { nav: { noteDate: d } }, '');
  } else if (x.kind === 'note') {
    if (typeof nbOpenNote === 'function') nbOpenNote(id);
  } else if (x.kind === 'log') {
    if (typeof globalSearchNav === 'function') globalSearchNav('work', { nav: { date: id } }, id);
  } else if (x.kind === 'meeting') {
    if (typeof globalSearchNav === 'function') globalSearchNav('meeting', { nav: (pg && pg.nav) || { meetingId: id } }, '');
  }
}
