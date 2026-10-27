/**
 * 업무 관리자 — 🧠 마인드맵 버전 기록
 * 오른쪽 서랍: 지금 버전 저장(이름 붙이기) · 날짜별 기록(직접 저장 · 자동 · 되돌리기 전 백업) · 이름 바꾸기 · 지우기.
 * 기록을 누르면 캔버스가 그 버전 미리 보기(보기 전용)로 바뀌고, 지금과 다른 주제를 표시한다
 *   (이후 삭제됨 · 내용 바뀜 · 위치 옮김 / 지금 맵에만 있는 주제는 목록으로). 미리 보기에서 가지를 복사해 지금 맵에 붙여 넣을 수 있음.
 * 되돌리기는 서버가 지금 상태를 먼저 기록으로 남긴 뒤 바꾼다 — 언제든 다시 돌아올 수 있고, Ctrl+Z 로도 취소.
 * 의존(전역): mindmap.js, mindmap-edit.js(_mmSaveNow), mindmap-view.js
 */

var MM_HIST_KIND = {
  manual: { l: '직접 저장', c: 'mm-hk-manual' },
  auto: { l: '자동 기록', c: 'mm-hk-auto' },
  restore: { l: '되돌리기 전 백업', c: 'mm-hk-restore' }
};

function _mmHist() {
  if (!_mm.hist) _mm.hist = { open: false, list: null, loading: false, renaming: null };
  return _mm.hist;
}
function _mmHistUrl(sid) {
  return '/api/mindmaps/' + encodeURIComponent(_mm.mapId) + '/snapshots' + (sid ? '/' + encodeURIComponent(sid) : '');
}

/* ═══ 서랍 열기 · 닫기 · 목록 ═══ */
function mmHistToggle(on) {
  var h = _mmHist();
  h.open = on == null ? !h.open : !!on;
  var el = _mmEl('mmHist');
  if (!el) return;
  el.classList.toggle('hidden', !h.open);
  var btn = document.querySelector('#mmEd [data-act="history"]');
  if (btn) btn.classList.toggle('on', h.open);
  if (!h.open) { if (_mm.preview) mmHistClosePreview(); return; }
  _mmHistPaint();
  _mmHistLoad();
}
function _mmHistLoad() {
  var h = _mmHist(), id = _mm.mapId;
  h.loading = true;
  return apiFetch(_mmHistUrl()).then(function (r) {
    if (_mm.mapId !== id) return;
    h.list = (r && r.data) || [];
  }).catch(function (e) { _mmToast('❌ 기록을 불러오지 못했습니다 — ' + _mmErr(e), 'error'); h.list = h.list || []; })
    .then(function () { h.loading = false; _mmHistPaint(); });
}

function _mmHistDayLabel(d) {
  var t = new Date(); t.setHours(0, 0, 0, 0);
  var x = new Date(d); x.setHours(0, 0, 0, 0);
  var diff = Math.round((t - x) / 864e5);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  return (x.getFullYear() !== t.getFullYear() ? x.getFullYear() + '년 ' : '') + (x.getMonth() + 1) + '월 ' + x.getDate() + '일 (' + MM_GT_WEEK[x.getDay()] + ')';
}
function _mmHistTime(d) {
  d = new Date(d);
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getHours()) + ':' + p(d.getMinutes());
}
function _mmHistName(s) {
  return s.label || (s.kind === 'auto' ? '자동 기록' : s.kind === 'restore' ? '되돌리기 전 백업' : '이름 없는 버전');
}

function _mmHistPaint() {
  var el = _mmEl('mmHist');
  var h = _mmHist();
  if (!el || !h.open) return;
  var live = _mm.preview ? _mm.preview.live : null;
  var canSave = !(live ? live.readOnly : _mm.readOnly);
  var pv = _mm.preview ? _mm.preview.snap.id : null;
  var nodeCount = 0;
  ((live ? live.doc : _mm.doc).sheets || []).forEach(function (sh) { mmWalk(sh.root, function () { nodeCount++; }); });
  var out = '<div class="mm-hist-h"><div><b>버전 기록</b><small>' + (h.list ? h.list.length + '개' : '') + '</small></div>' +
    '<button class="mm-tbtn mm-tbtn-icon" data-act="history-close" title="닫기 (Esc)">' + _mmIcon('x', 16) + '</button></div>';
  if (canSave) {
    out += '<div class="mm-hist-save"><input id="mmHistLabel" class="mm-input" maxlength="100" placeholder="이 버전 이름 — 예: 1차 검토안">' +
      '<button class="btn btn-p btn-s" data-act="history-save">' + _mmIcon('plus', 14) + ' 지금 버전 저장</button></div>';
  }
  out += '<div class="mm-hist-list">' +
    '<div class="mm-hist-item mm-hist-cur' + (!pv ? ' on' : '') + '" data-act="history-current">' +
    '<span class="mm-hist-dot"></span><div class="mm-hist-main"><div class="mm-hist-t">현재 버전</div>' +
    '<div class="mm-hist-m">' + (_mm.readOnly && !live ? '보기 전용' : '편집 중') + ' · 주제 ' + nodeCount + '개</div></div></div>';
  if (!h.list) out += '<div class="mm-hist-empty">불러오는 중…</div>';
  else if (!h.list.length) out += '<div class="mm-hist-empty">아직 기록이 없습니다.<br>위에서 <b>지금 버전 저장</b>을 누르거나, 편집을 쉬었다가 다시 하면 자동으로 남습니다.</div>';
  var lastDay = '';
  (h.list || []).forEach(function (s) {
    var day = _mmHistDayLabel(s.created_at);
    if (day !== lastDay) { out += '<div class="mm-hist-day">' + day + '</div>'; lastDay = day; }
    var k = MM_HIST_KIND[s.kind] || MM_HIST_KIND.manual;
    var on = pv === s.id;
    out += '<div class="mm-hist-item ' + k.c + (on ? ' on' : '') + '" data-act="history-open" data-snap="' + _mmEsc(s.id) + '">' +
      '<span class="mm-hist-dot"></span><div class="mm-hist-main">' +
      (h.renaming === s.id
        ? '<input class="mm-input mm-hist-rename" data-snap="' + _mmEsc(s.id) + '" maxlength="100" value="' + _mmEsc(s.label || '') + '" placeholder="버전 이름">'
        : '<div class="mm-hist-t">' + _mmEsc(_mmHistName(s)) + '</div>') +
      '<div class="mm-hist-m">' + _mmHistTime(s.created_at) + ' · ' + _mmEsc(s.created_by_name || '알 수 없음') + ' · 주제 ' + (s.node_count || 0) + '개' +
      (s.kind !== 'manual' ? ' · <span class="mm-hist-kind">' + k.l + '</span>' : '') + '</div>' +
      (on && _mm.preview ? _mmHistDiffHtml(_mm.preview.diff) : '') + '</div>' +
      (s.can_edit ? '<div class="mm-hist-acts"><button data-act="history-rename" data-snap="' + _mmEsc(s.id) + '" title="이름 붙이기">' + _mmIcon('pen', 13) + '</button>' +
        '<button data-act="history-del" data-snap="' + _mmEsc(s.id) + '" title="지우기">' + _mmIcon('trash', 13) + '</button></div>' : '') +
      '</div>';
  });
  out += '</div><div class="mm-hist-foot">편집을 30분 넘게 쉬었다가 다시 저장하면 그 전 상태가 자동으로 남습니다. 자동 기록은 최근 40개 · 90일까지 두고, 이름을 붙이면 계속 남습니다.</div>';
  el.innerHTML = out;
  var inp = el.querySelector('.mm-hist-rename');
  if (inp) {
    inp.focus(); inp.select();
    inp.onkeydown = function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') _mmHistRename(inp.getAttribute('data-snap'), inp.value);
      else if (e.key === 'Escape') { h.renaming = null; _mmHistPaint(); }
    };
    inp.onblur = function () { if (h.renaming) _mmHistRename(inp.getAttribute('data-snap'), inp.value); };
    inp.onclick = function (e) { e.stopPropagation(); };
  }
  var lab = _mmEl('mmHistLabel');
  if (lab) lab.onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Enter') mmHistSave(); };
}

/* ═══ 비교 — 미리 보는 버전(old) ↔ 지금(cur), 주제 id 기준 ═══ */
var MM_HIST_FIELDS = ['text', 'note', 'link', 'startDate', 'dueDate', 'assigneeId', 'progress', 'done', 'color'];
function _mmHistIndex(doc) {
  var m = {};
  (doc.sheets || []).forEach(function (sh) {
    mmWalk(sh.root, function (n, parent) { m[n.id] = { n: n, parent: parent ? parent.id : null }; });
  });
  return m;
}
function mmHistDiff(oldDoc, curDoc) {
  var a = _mmHistIndex(oldDoc), b = _mmHistIndex(curDoc);
  var d = { del: {}, chg: {}, mov: {}, add: [] };
  Object.keys(a).forEach(function (id) {
    var x = a[id], y = b[id];
    if (!y) { d.del[id] = true; return; }
    var what = [];
    MM_HIST_FIELDS.forEach(function (f) {
      var p = x.n[f], q = y.n[f];
      if ((p == null ? '' : String(p)) !== (q == null ? '' : String(q))) what.push(f);
    });
    if (JSON.stringify(x.n.markers || []) !== JSON.stringify(y.n.markers || [])) what.push('markers');
    if (JSON.stringify(x.n.blocks || []) !== JSON.stringify(y.n.blocks || [])) what.push('blocks');
    if (what.length) d.chg[id] = { fields: what, now: y.n.text || '' };
    if (x.parent !== y.parent) d.mov[id] = true;
  });
  Object.keys(b).forEach(function (id) { if (!a[id]) d.add.push(b[id].n.text || '(제목 없음)'); });
  d.counts = { del: Object.keys(d.del).length, chg: Object.keys(d.chg).length, mov: Object.keys(d.mov).length, add: d.add.length };
  return d;
}
var MM_HIST_FIELD_L = { text: '내용', note: '메모', link: '링크', startDate: '시작일', dueDate: '마감일', assigneeId: '담당', progress: '진척', done: '완료', color: '색', markers: '마커', blocks: '내용 줄' };
function _mmHistDiffHtml(d) {
  var c = d.counts;
  if (!c.del && !c.chg && !c.mov && !c.add) return '<div class="mm-hist-diff"><span class="mm-hist-same">지금과 같습니다</span></div>';
  var chip = function (cls, n, l) { return n ? '<span class="mm-df-chip ' + cls + '">' + l + ' ' + n + '</span>' : ''; };
  var h = '<div class="mm-hist-diff"><div class="mm-hist-chips">' + chip('mm-df-c-add', c.add, '추가') + chip('mm-df-c-del', c.del, '삭제') +
    chip('mm-df-c-chg', c.chg, '수정') + chip('mm-df-c-mov', c.mov, '이동') + '</div>';
  if (c.add) {
    h += '<div class="mm-hist-adds"><small>이 버전 뒤에 생긴 주제</small>' + d.add.slice(0, 6).map(function (t) { return '<span>' + _mmEsc(String(t).split('\n')[0]) + '</span>'; }).join('') +
      (c.add > 6 ? '<span class="mm-hint">외 ' + (c.add - 6) + '개</span>' : '') + '</div>';
  }
  return h + '</div>';
}
/** 미리 보기 중 주제에 붙일 표시 class */
function _mmHistNodeClass(id) {
  var d = _mm.preview && _mm.preview.diff;
  if (!d) return '';
  if (d.del[id]) return ' mm-df-del';
  if (d.chg[id]) return ' mm-df-chg';
  if (d.mov[id]) return ' mm-df-mov';
  return '';
}
function _mmHistNodeTip(id) {
  var d = _mm.preview && _mm.preview.diff;
  if (!d) return '';
  if (d.del[id]) return '이 버전 뒤에 삭제된 주제';
  if (d.chg[id]) return '지금은 바뀜: ' + d.chg[id].fields.map(function (f) { return MM_HIST_FIELD_L[f] || f; }).join(' · ') + (d.chg[id].fields.indexOf('text') >= 0 ? '\n지금 내용: ' + d.chg[id].now : '');
  if (d.mov[id]) return '지금은 다른 주제 아래로 옮겨짐';
  return '';
}

/* ═══ 미리 보기 ═══ */
function mmHistOpen(sid) {
  var id = _mm.mapId;
  var start = _mm.preview ? Promise.resolve() : Promise.resolve(_mmSaveNow());
  return start.then(function () {
    return apiFetch(_mmHistUrl(sid));
  }).then(function (r) {
    if (_mm.mapId !== id) return;
    var snap = r.data;
    var doc = typeof snap.doc === 'string' ? JSON.parse(snap.doc) : snap.doc;
    if (!doc || !doc.sheets || !doc.sheets.length) { _mmToast('❌ 기록 문서가 비어 있습니다', 'error'); return; }
    if (!_mm.preview) {
      _mm.preview = { live: { doc: _mm.doc, sel: _mm.sel, sheetIdx: _mm.sheetIdx, readOnly: _mm.readOnly, panX: _mm.panX, panY: _mm.panY, zoom: _mm.zoom } };
    }
    if (_mm.editing && typeof _mmEditCommit === 'function') _mmEditCommit();
    _mm.preview.snap = snap;
    _mm.preview.diff = mmHistDiff(doc, _mm.preview.live.doc);
    _mm.doc = doc;
    _mm.readOnly = true;
    _mm.sheetIdx = Math.min(_mm.preview.live.sheetIdx, doc.sheets.length - 1);
    _mm.sel = _mmRoot().id;
    _mm.multi = []; _mm.hits = []; _mm.relFrom = null;
    _mmHistRepaintAll();
    _mmFit();
  }).catch(function (e) { _mmToast('❌ 기록을 열 수 없습니다 — ' + _mmErr(e), 'error'); });
}
function mmHistClosePreview() {
  var p = _mm.preview;
  if (!p) return;
  _mm.doc = p.live.doc;
  _mm.sel = mmFind(_mm.doc.sheets[Math.min(p.live.sheetIdx, _mm.doc.sheets.length - 1)].root, p.live.sel) ? p.live.sel : null;
  _mm.sheetIdx = Math.min(p.live.sheetIdx, _mm.doc.sheets.length - 1);
  if (!_mm.sel) _mm.sel = _mmRoot().id;
  // 미리 보는 동안 편집을 다른 사람이 가져갔으면 보기 전용 유지
  _mm.readOnly = _mm.lockedBy ? true : p.live.readOnly;
  _mm.preview = null;
  _mm.multi = []; _mm.hits = [];
  _mmHistRepaintAll();
  _mm.zoom = p.live.zoom; _mm.panX = p.live.panX; _mm.panY = p.live.panY;
  if (_mm.panX == null) _mmFit(); else _mmApplyTransform();
  _mmFocusCanvas();
}
function _mmHistRepaintAll() {
  var st = _mmEl('mmStructure');
  if (st) st.value = _mmSheet().structure || 'balanced';
  var ed = _mmEl('mmEd');
  if (ed) ed.classList.toggle('mm-previewing', !!_mm.preview);
  _mmRefreshMode();
  _mmPaintSheets();
  _mmPaint();
  if (_mm.outline) _mmPaintOutline();
  _mmHistPaint();
}
/** 미리 보기 배너 (_mmBanner 가 부름) */
function _mmHistBannerHtml() {
  var p = _mm.preview, s = p.snap, c = p.diff.counts;
  var canRestore = !(p.live.readOnly || _mm.lockedBy);
  var bits = [];
  if (c.add) bits.push('<span class="mm-df-chip mm-df-c-add">이후 추가 ' + c.add + '</span>');
  if (c.del) bits.push('<span class="mm-df-chip mm-df-c-del">이후 삭제 ' + c.del + '</span>');
  if (c.chg) bits.push('<span class="mm-df-chip mm-df-c-chg">이후 수정 ' + c.chg + '</span>');
  if (c.mov) bits.push('<span class="mm-df-chip mm-df-c-mov">이후 이동 ' + c.mov + '</span>');
  var d = new Date(s.created_at);
  return '<div class="mm-banner mm-banner-hist">' + _mmIcon('history', 16) +
    '<div class="mm-bh-main"><b>' + _mmEsc(_mmHistName(s)) + '</b><span>' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + _mmHistTime(d) + ' · ' + _mmEsc(s.created_by_name || '') + ' — 미리 보기 (보기 전용)</span></div>' +
    '<div class="mm-bh-chips">' + (bits.join('') || '<span class="mm-hist-same">지금과 같습니다</span>') + '</div>' +
    '<span class="mm-flex"></span>' +
    '<span class="mm-hint mm-bh-hint">가지를 Ctrl+C 로 복사해 지금 맵에 붙여 넣을 수 있습니다</span>' +
    (canRestore ? '<button class="btn btn-p btn-s" data-act="history-restore">이 버전으로 되돌리기</button>' : '') +
    '<button class="btn btn-g btn-s" data-act="history-current">지금 버전으로 돌아가기</button></div>';
}

/* ═══ 저장 · 이름 · 지우기 · 되돌리기 ═══ */
function mmHistSave() {
  var lab = _mmEl('mmHistLabel');
  var label = lab ? lab.value.trim() : '';
  var id = _mm.mapId;
  if (_mm.preview) mmHistClosePreview();
  return Promise.resolve(_mmSaveNow()).then(function () {
    if (_mm.dirty) throw new Error('저장되지 않은 변경이 있습니다');
    return apiFetch(_mmHistUrl(), { method: 'POST', body: JSON.stringify({ label: label }) });
  }).then(function () {
    if (_mm.mapId !== id) return;
    _mmToast('✓ 지금 버전을 저장했습니다' + (label ? ' — ' + label : ''));
    if (lab) lab.value = '';
    return _mmHistLoad();
  }).catch(function (e) { _mmToast('❌ 버전 저장 실패 — ' + _mmErr(e), 'error'); });
}
function _mmHistRename(sid, label) {
  var h = _mmHist();
  h.renaming = null;
  var cur = (h.list || []).filter(function (s) { return s.id === sid; })[0];
  label = String(label || '').trim();
  if (!cur || (cur.label || '') === label) { _mmHistPaint(); return; }
  apiFetch(_mmHistUrl(sid), { method: 'PUT', body: JSON.stringify({ label: label }) }).then(function (r) {
    cur.label = r.data.label; cur.kind = r.data.kind;
    if (_mm.preview && _mm.preview.snap.id === sid) { _mm.preview.snap.label = cur.label; _mmBanner(); }
    _mmHistPaint();
  }).catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); _mmHistPaint(); });
}
function _mmHistDelete(sid) {
  var h = _mmHist();
  var cur = (h.list || []).filter(function (s) { return s.id === sid; })[0];
  if (!cur || !confirm('"' + _mmHistName(cur) + '" 기록을 지울까요? 되돌릴 수 없습니다.')) return;
  apiFetch(_mmHistUrl(sid), { method: 'DELETE' }).then(function () {
    if (_mm.preview && _mm.preview.snap.id === sid) mmHistClosePreview();
    h.list = h.list.filter(function (s) { return s.id !== sid; });
    _mmHistPaint();
  }).catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}
function mmHistRestore() {
  var p = _mm.preview;
  if (!p) return;
  var s = p.snap;
  if (!confirm('"' + _mmHistName(s) + '" 버전으로 되돌릴까요?\n지금 상태는 "되돌리기 전 백업"으로 기록에 남아 언제든 다시 돌아올 수 있습니다.')) return;
  var id = _mm.mapId;
  apiFetch(_mmHistUrl(s.id) + '/restore', { method: 'POST', body: JSON.stringify({ version: _mm.version }) }).then(function (r) {
    if (_mm.mapId !== id) return;
    var live = p.live;
    var doc = typeof r.data.doc === 'string' ? JSON.parse(r.data.doc) : r.data.doc;
    // Ctrl+Z 로 되돌리기 전 상태로 (그러면 다시 저장됨)
    _mm.undo.push(JSON.stringify({ sheets: live.doc.sheets, sel: live.sel, sheetIdx: live.sheetIdx }));
    _mm.redo = [];
    _mm.preview = null;
    _mm.doc = doc;
    _mm.version = r.data.version;
    _mm.readOnly = live.readOnly;
    _mm.dirty = false;
    _mm.lastSaved = new Date();
    _mm.sheetIdx = Math.min(live.sheetIdx, doc.sheets.length - 1);
    _mm.sel = _mmRoot().id;
    _mmHistRepaintAll();
    _mmFit();
    _mmToast('✓ 되돌렸습니다 — 되돌리기 전 상태도 기록에 남겼습니다 (Ctrl+Z 로도 취소)');
    _mmHistLoad();
  }).catch(function (e) {
    if (e && e.status === 409) {
      _mmToast('⚠️ 그 사이 다른 사람이 저장했습니다 — 최신본을 다시 불러옵니다', 'error');
      _mm.preview = null;
      mmOpen(id);
      return;
    }
    _mmToast('❌ 되돌리기 실패 — ' + _mmErr(e), 'error');
  });
}

/** 편집기 클릭 동작 (mindmap-edit.js _mmEdClick 에서) — 처리했으면 true */
function mmHistAction(act, t) {
  var sid = t.getAttribute('data-snap');
  switch (act) {
    case 'history': mmHistToggle(); return true;
    case 'history-close': mmHistToggle(false); return true;
    case 'history-save': mmHistSave(); return true;
    case 'history-current': mmHistClosePreview(); _mmHistPaint(); return true;
    case 'history-open': if (!_mm.preview || _mm.preview.snap.id !== sid) mmHistOpen(sid); return true;
    case 'history-rename': _mmHist().renaming = sid; _mmHistPaint(); return true;
    case 'history-del': _mmHistDelete(sid); return true;
    case 'history-restore': mmHistRestore(); return true;
  }
  return false;
}
