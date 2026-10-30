/* ═══════════════════════════════════════════════════════════════════════
   my-work-proj.js — 📁 내 업무 · 내 프로젝트 (v13.273)
   ─────────────────────────────────────────────────────────────────────
   할 일처럼 한 번에 끝나지 않고 기간(시작 ~ 끝)이 있는 일 묶음. 본인만 보고 고친다.
     · 단독 — 여기서만. 기간 · 진행률(자동 = 소속 항목 완료 비율, 또는 직접)
     · 연계 — 프로젝트 관리의 프로젝트에 연결. 기간 · 진행률 · 마일스톤을 그대로 읽어 옴 (복사 안 함, 바꾸기는 프로젝트 관리에서)
       내가 주인 · 멤버인 진행 중 프로젝트는 '연계 후보'로 — 누르면 바로 연결
     · 소속 — 어느 출처 항목이든 넣을 수 있음 (my_work_marks.project_id). 연계 프로젝트와 같은 프로젝트의 항목(마일스톤 · 회의 액션 · 개발 · 이슈)은 저절로 묶임
       카드로 끌어 넣기 · 보드 ⋯ 메뉴 · 상세 패널 '프로젝트' 칸 · 프로젝트 패널에서 바로 할 일 추가
     · 보이기 — 프로젝트마다 👁 (타임라인 · 달력), 머리의 '타임라인 · 달력에 표시'는 전체 (이 브라우저에 기억)
   목록 · 보드 위 띠(카드) → 누르면 오른쪽 프로젝트 패널 (상세 패널 · 노트 서랍과 같은 자리, 자동 저장)
   타임라인은 맨 위 '📁 프로젝트' 줄 · ⋯ 줄 나누기 '프로젝트별', 달력은 기간 띠 (my-work-timeline.js · my-work-cal.js 에서 부름)
   서버 API: GET /api/my-work 의 projs · projCands · GET /projects · /projects/pick?q= · POST · PUT · DELETE /projects/:id · POST /projects/:id/restore · PUT /mark { project }
   전역 의존: _mw · _mwPaint · _mwFind · _mwEsc · _mwToast · _mwErr · _mwLS · _mwDays · _mwDueLabel · MW_SRC · mwAddTodo (my-work.js)
              MW_CAT_COLORS · mwPopMenu (my-work-board.js) · mwUndoToast · mwPanelOpen · mwPanelClose · mwPanelIsOpen · mwSetDone (my-work-panel.js)
              mwNotesIsOpen · mwNotesClose (my-work-notes.js) · QuickParse · showProjectDetail
   ═══════════════════════════════════════════════════════════════════════ */

var MW_PJ_STATUS = { plan: '계획', doing: '진행', hold: '보류', done: '완료' };
var _mwj = { id: null, q: {}, qId: null, timer: null, inflight: null, state: 'idle', err: '', pickQ: '', pick: null, pickT: null, drag: null };

function mwProjs() { return (_mw.data && _mw.data.projs) || []; }
function mwProjById(id) { return mwProjs().filter(function (p) { return p.id === id; })[0] || null; }
function mwProjBandOn() { return _mwLS('pjband') !== false; }
/** 색 — 내가 고른 색 → 연계 프로젝트 색 → 기본 */
function mwProjColor(p) {
  if (p && p.color && MW_CAT_COLORS[p.color]) return MW_CAT_COLORS[p.color];
  var lc = p && p.linkInfo && p.linkInfo.color;
  return lc && /^#[0-9a-fA-F]{3,8}$/.test(lc) ? lc : '#6366F1';
}
/** 이 항목이 든 프로젝트 — 직접 넣은 것 → 연계 프로젝트와 같은 프로젝트 (표시 '-' 면 뺀 것) */
function mwProjOf(it) {
  if (!it || !_mw.data || !_mw.data.self || it.proj === '-') return null;
  if (it.proj) return mwProjById(it.proj);
  if (!it.projectId) return null;
  return mwProjs().filter(function (p) { return p.link && p.link === it.projectId; })[0] || null;
}
function mwProjItems(p) { return ((_mw.data && _mw.data.data) || []).filter(function (it) { return mwProjOf(it) === p; }); }
/** 진행률 · 남은 수 — 직접 · 연계 진행률이 있으면 그것, 없으면 완료 비율 (서버가 센 지난 할 일 포함) */
function mwProjStats(p) {
  var its = mwProjItems(p);
  var open = its.filter(function (x) { return !x.done; }).length;
  var todoDoneList = its.filter(function (x) { return x.src === 'todo' && x.done; }).length;
  var otherDone = its.filter(function (x) { return x.src !== 'todo' && x.done; }).length;
  var done = Math.max(p.todoDone || 0, todoDoneList) + otherDone;
  var auto = done + open ? Math.round(done / (done + open) * 100) : null;
  return { open: open, done: done, items: its, prog: p.progress != null ? p.progress : (p.status === 'done' ? 100 : auto), auto: auto };
}
function _mwjMd(d) { return d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }
/** D-day 글 — { t, cls } */
function _mwjDday(p, today) {
  if (p.status === 'done') return { t: '완료', cls: 'is-done' };
  if (p.start && p.start > today) return { t: _mwjMd(p.start) + ' 시작', cls: '' };
  if (!p.end) return { t: '', cls: '' };
  var d = _mwDays(today, p.end);
  if (d < 0) return { t: (-d) + '일 지남', cls: 'is-late' };
  if (d === 0) return { t: 'D-day', cls: 'is-soon' };
  return { t: 'D-' + d, cls: d <= 7 ? 'is-soon' : '' };
}
/** 기간 중 오늘 자리 (0~100) — 기간이 없거나 밖이면 null */
function _mwjTodayPct(p, today) {
  if (!p.start || !p.end || p.start > today || p.end < today) return null;
  var all = _mwDays(p.start, p.end) + 1;
  return Math.round((_mwDays(p.start, today) + 0.5) / all * 100);
}

/* ═══ 목록 · 보드 위 띠 ═══ */
function mwProjStripHtml(today) {
  if (!_mw.data || !_mw.data.self) return '';
  var all = mwProjs(), cands = _mw.data.projCands || [];
  var showDone = !!_mwLS('pjdone'), folded = !!_mwLS('pjfold');
  var doneN = all.filter(function (p) { return p.status === 'done'; }).length;
  var list = all.filter(function (p) { return showDone || p.status !== 'done'; });
  var h = '<section class="mwj' + (folded ? ' is-folded' : '') + '" id="mwjStrip">' +
    '<div class="mwj-h"><button class="mwj-tri" data-mwj="fold" title="접기 · 펴기">▾</button><b class="mwj-ttl" data-mwj="fold">📁 내 프로젝트</b><i class="mwj-n">' + (all.length - doneN) + '</i>' +
      '<button class="mw-btn" data-mwj="new" title="기간이 있는 일 묶음 — 여기서만 쓰거나 프로젝트 관리와 연결">＋ 프로젝트</button>' +
      (cands.length ? '<button class="mw-btn mwj-cand" data-mwj="cands" title="내가 맡은 프로젝트 관리 프로젝트 — 누르면 연결">🔗 연계 후보 <b>' + cands.length + '</b></button>' : '') +
      (doneN ? '<button class="mwj-lnk' + (showDone ? ' on' : '') + '" data-mwj="done">끝난 것 ' + doneN + '</button>' : '') +
      '<label class="mwj-tg" title="끄면 타임라인 · 달력에서 프로젝트 기간 띠를 모두 숨김"><input type="checkbox" data-mwj="band"' + (mwProjBandOn() ? ' checked' : '') + '> 타임라인 · 달력에 표시</label>' +
    '</div>';
  if (!folded) {
    h += '<div class="mwj-l">' + (list.length ? list.map(function (p) { return _mwjCard(p, today); }).join('')
      : '<div class="mwj-e">몇 주 · 몇 달 이어지는 일은 프로젝트로 묶어 보세요 — 기간 막대가 타임라인 · 달력에 보이고, 할 일을 넣으면 진행률이 저절로 올라갑니다.' +
        (cands.length ? ' 맡은 프로젝트를 <b>🔗 연계 후보</b>에서 바로 연결할 수도 있습니다.' : '') + '</div>') + '</div>';
  }
  return h + '</section>';
}
function _mwjCard(p, today) {
  var s = mwProjStats(p), dd = _mwjDday(p, today), tp = _mwjTodayPct(p, today);
  var locked = p.linkInfo && p.linkInfo.locked;
  return '<div class="mwj-c' + (p.visible ? '' : ' is-hidden') + (p.status === 'done' ? ' is-done' : '') + (p.status === 'hold' ? ' is-hold' : '') + (_mwj.id === p.id ? ' mw-picked' : '') +
      '" data-pj="' + _mwEsc(p.id) + '" style="--pc:' + mwProjColor(p) + '" tabindex="0" role="button" title="' + _mwEsc(p.title + (p.memo ? '\n' + p.memo.slice(0, 120) : '')) + '">' +
    '<div class="mwj-ct"><span class="mwj-ic">' + _mwEsc(p.icon || '📁') + '</span><span class="mwj-t">' + _mwEsc(p.title) + '</span>' +
      (p.link ? '<em class="mwj-link' + (locked ? ' is-locked' : '') + '" title="' + (locked ? '연결한 프로젝트를 볼 수 없습니다' : '프로젝트 관리와 연계 — ' + _mwEsc(p.linkInfo.name)) + '">' + (locked ? '🔒' : '🔗') + '</em>' : '') +
      '<button class="mwj-eye" data-pjeye="' + _mwEsc(p.id) + '" title="' + (p.visible ? '타임라인 · 달력에서 숨기기' : '타임라인 · 달력에 보이기') + '">' + (p.visible ? '👁' : '🙈') + '</button></div>' +
    '<div class="mwj-bar" title="진행 ' + (s.prog != null ? s.prog + '%' : '—') + (tp != null ? ' · 기간 중 오늘 자리' : '') + '"><span class="mwj-fill" style="width:' + (s.prog || 0) + '%"></span>' + (tp != null ? '<i style="left:' + tp + '%"></i>' : '') + '</div>' +
    '<div class="mwj-m">' + (p.start || p.end ? '<span>' + _mwjMd(p.start) + ' ~ ' + _mwjMd(p.end) + '</span>' : '<span class="mwj-nod">기간 없음</span>') +
      (dd.t ? '<span class="mwj-dd ' + dd.cls + '">' + dd.t + '</span>' : '') +
      (s.prog != null ? '<span>' + s.prog + '%</span>' : '') +
      '<span class="mwj-cnt" title="남은 항목">☐ ' + s.open + '</span>' +
      (p.status === 'hold' || p.status === 'plan' ? '<span class="mwj-st">' + MW_PJ_STATUS[p.status] + '</span>' : '') + '</div></div>';
}
/** 목록 줄 · 보드 카드의 작은 프로젝트 표 */
function mwProjTag(it) {
  var p = mwProjOf(it);
  return p ? '<span class="mwj-tag" style="--pc:' + mwProjColor(p) + '" data-pjopen="' + _mwEsc(p.id) + '" title="📁 ' + _mwEsc(p.title) + '">' + _mwEsc(p.icon || '📁') + ' ' + _mwEsc(p.title) + '</span>' : '';
}

/* ═══ 누르기 (my-work.js el.onclick 에서 먼저 부름) ═══ */
function mwProjClick(e) {
  var t = e.target;
  var a = t.closest('[data-mwj]');
  if (a && a.tagName !== 'INPUT') {
    var k = a.getAttribute('data-mwj');
    if (k === 'fold') { _mwLS('pjfold', !_mwLS('pjfold')); _mwPaint(); return true; }
    if (k === 'done') { _mwLS('pjdone', !_mwLS('pjdone')); _mwPaint(); return true; }
    if (k === 'new') { mwProjCreate({}); return true; }
    if (k === 'cands') { _mwjCandMenu(a); return true; }
  }
  if (a && a.tagName === 'INPUT') return true;   // 체크 박스는 change 에서
  var eye = t.closest('[data-pjeye]');
  if (eye) { var pe = mwProjById(eye.getAttribute('data-pjeye')); if (pe) mwProjSave(pe, { visible: !pe.visible }, { undo: true }); return true; }
  var tag = t.closest('[data-pjopen]');
  if (tag) { mwProjOpen(tag.getAttribute('data-pjopen')); return true; }
  var c = t.closest('[data-pj]');
  if (c) { mwProjOpen(c.getAttribute('data-pj')); return true; }
  return false;
}
function mwProjChange(e) {
  var t = e.target;
  if (t.matches && t.matches('[data-mwj="band"]')) {
    _mwLS('pjband', t.checked);
    _mwPaint();
    return true;
  }
  return false;
}
function _mwjCandMenu(anchor) {
  var cands = (_mw.data && _mw.data.projCands) || [];
  var h = '<div class="mw-pmenu-n">맡은 프로젝트 — 누르면 내 프로젝트로 연결</div>' + cands.map(function (c) {
    return '<button data-v="' + _mwEsc(c.id) + '">🔗 ' + _mwEsc(c.name) + (c.start || c.end ? ' <i>' + _mwjMd(c.start) + ' ~ ' + _mwjMd(c.end) + '</i>' : '') + '</button>';
  }).join('');
  mwPopMenu(anchor, h, function (v) { mwProjCreate({ linkProjectId: v }); });
}

/* ═══ 끌어 넣기 — 보드 카드 · 직접 순서 목록 줄을 프로젝트 카드로 (el 은 그대로 남으므로 한 번만) ═══ */
function mwProjBind(el) {
  if (el._mwj) return;
  el._mwj = true;
  el.addEventListener('dragstart', function (e) {
    var c = e.target.closest && e.target.closest('[data-qk][draggable], .mw-row[data-key][draggable]');
    _mwj.drag = c ? (c.getAttribute('data-qk') || c.getAttribute('data-key')) : null;
    if (_mwj.drag) { var s = el.querySelector('#mwjStrip'); if (s) s.classList.add('is-dropping'); }
  });
  el.addEventListener('dragover', function (e) {
    if (!_mwj.drag) return;
    var c = e.target.closest && e.target.closest('.mwj-c[data-pj]');
    el.querySelectorAll('.mwj-c.is-over').forEach(function (x) { if (x !== c) x.classList.remove('is-over'); });
    if (!c) return;
    e.preventDefault();
    c.classList.add('is-over');
  });
  el.addEventListener('drop', function (e) {
    var c = e.target.closest && e.target.closest('.mwj-c[data-pj]');
    if (!_mwj.drag || !c) return;
    e.preventDefault();
    var it = _mwFind(_mwj.drag);
    _mwj.drag = null;
    if (it) mwProjSetItem(it, c.getAttribute('data-pj'));
  });
  el.addEventListener('dragend', function () {
    _mwj.drag = null;
    el.querySelectorAll('.mwj-c.is-over').forEach(function (x) { x.classList.remove('is-over'); });
    var s = el.querySelector('#mwjStrip'); if (s) s.classList.remove('is-dropping');
  });
  el.addEventListener('keydown', function (e) {
    var c = e.target.closest && e.target.closest('.mwj-c[data-pj]');
    if (c && e.key === 'Enter') { e.preventDefault(); mwProjOpen(c.getAttribute('data-pj')); }
  });
}

/* ═══ 항목 넣기 · 빼기 ═══ */
/** pid = 넣을 프로젝트 (null = 빼기). 연계로 저절로 묶인 항목을 빼면 '-' 로 표시 */
function mwProjSetItem(it, pid) {
  if (!it || !_mw.data || !_mw.data.self) return;
  var cur = mwProjOf(it);
  if ((cur && cur.id) === (pid || null)) return;
  var prev = it.proj || null, val;
  if (pid) val = pid;
  else {
    it.proj = null;
    val = mwProjOf(it) ? '-' : null;   // 표시를 지워도 연계로 다시 묶이면 '빼기' 표시
  }
  it.proj = val;
  _mwPaint(); _mwjRepaintPanel();
  var p = pid ? mwProjById(pid) : cur;
  apiFetch('/api/my-work/mark', { method: 'PUT', body: JSON.stringify({ key: it.src + ':' + it.id, project: val }) }).then(function () {
    if (typeof mwUndoToast === 'function') mwUndoToast(pid ? '📁 ' + (p ? p.title : '') + '에 넣음' : '📁 ' + (p ? p.title : '프로젝트') + '에서 뺌', function () {
      it.proj = prev; _mwPaint(); _mwjRepaintPanel();
      apiFetch('/api/my-work/mark', { method: 'PUT', body: JSON.stringify({ key: it.src + ':' + it.id, project: prev }) }).catch(function (er) { _mwToast('❌ ' + _mwErr(er), 'error'); });
    });
  }).catch(function (er) { it.proj = prev; _mwPaint(); _mwjRepaintPanel(); _mwToast('❌ ' + _mwErr(er), 'error'); });
}
/** 프로젝트 고르기 메뉴 항목 (보드 ⋯ · 상세 패널) — [[id, 이름]] (끝난 것 빼고) */
function mwProjChoices() {
  return mwProjs().filter(function (p) { return p.status !== 'done'; }).map(function (p) { return [p.id, (p.icon || '📁') + ' ' + p.title]; });
}

/* ═══ 만들기 · 고치기 · 지우기 ═══ */
function _mwjPutLocal(p) {
  var list = _mw.data.projs = mwProjs().slice(), i;
  for (i = 0; i < list.length; i++) if (list[i].id === p.id) { list[i] = p; break; }
  if (i === list.length) list.push(p);
  if (p.link) _mw.data.projCands = (_mw.data.projCands || []).filter(function (c) { return c.id !== p.link; });
  return p;
}
/** 새 프로젝트 — 단독은 오늘 ~ 4주 뒤로 바로 만들고 패널에서 이름부터. 연계는 이름 · 기간을 프로젝트 관리에서 */
function mwProjCreate(b) {
  if (!_mw.data || !_mw.data.self) return Promise.resolve();
  var today = _mw.data.today;
  var body = Object.assign(b.linkProjectId ? {} : { title: '새 프로젝트', startDate: today, endDate: ymdAddDays(today, 27), status: 'doing' }, b);
  if (_mwLS('pjfold')) _mwLS('pjfold', false);
  return apiFetch('/api/my-work/projects', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
    var p = _mwjPutLocal(r.data);
    _mwPaint();
    mwProjOpen(p.id, { focus: b.linkProjectId ? null : '#mwjTitle' });
    if (b.linkProjectId) _mwToast('🔗 ' + p.title + ' — 내 프로젝트로 연결했습니다');
    return p;
  }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); });
}
/** 바로 저장 (👁 · 상태 · 연결 등) — opt.undo 면 되돌리기 알림 */
function mwProjSave(p, patch, opt) {
  opt = opt || {};
  var prev = {};
  var map = { visible: 'visible', status: 'status' };
  Object.keys(patch).forEach(function (k) { if (map[k]) { prev[k] = p[map[k]]; p[map[k]] = patch[k]; } });
  _mwPaint(); _mwjRepaintPanel();
  return apiFetch('/api/my-work/projects/' + encodeURIComponent(p.id), { method: 'PUT', body: JSON.stringify(patch) }).then(function (r) {
    var np = _mwjPutLocal(r.data);
    _mwPaint(); _mwjRepaintPanel();
    if (opt.undo) {
      var msg = 'visible' in patch ? (patch.visible ? '👁 ' + np.title + ' — 타임라인 · 달력에 보임' : '🙈 ' + np.title + ' — 타임라인 · 달력에서 숨김')
        : 'status' in patch ? '📁 ' + np.title + ' — ' + MW_PJ_STATUS[patch.status] : '📁 저장';
      mwUndoToast(msg, function () { mwProjSave(np, prev); });
    }
    return np;
  }).catch(function (e) {
    Object.keys(prev).forEach(function (k) { p[k] = prev[k]; });
    _mwPaint(); _mwjRepaintPanel();
    _mwToast('❌ ' + _mwErr(e), 'error');
  });
}
/** 기간 (타임라인 막대 끌기) — 단독만 */
function mwProjSetRange(p, s, d) {
  if (!p || p.link) return;
  var prev = { start: p.start, end: p.end };
  p.start = s; p.end = d;
  _mwPaint(); _mwjRepaintPanel();
  apiFetch('/api/my-work/projects/' + encodeURIComponent(p.id), { method: 'PUT', body: JSON.stringify({ startDate: s, endDate: d }) }).then(function (r) {
    _mwjPutLocal(r.data); _mwPaint(); _mwjRepaintPanel();
    mwUndoToast('📁 ' + p.title + ' ' + _mwjMd(s) + ' ~ ' + _mwjMd(d), function () { mwProjSetRange(mwProjById(p.id), prev.start, prev.end); });
  }).catch(function (e) { p.start = prev.start; p.end = prev.end; _mwPaint(); _mwjRepaintPanel(); _mwToast('❌ ' + _mwErr(e), 'error'); });
}
function mwProjDelete(p) {
  if (!p) return;
  mwProjClose();
  _mw.data.projs = mwProjs().filter(function (x) { return x !== p; });
  _mwPaint();
  apiFetch('/api/my-work/projects/' + encodeURIComponent(p.id), { method: 'DELETE' }).then(function () {
    mwUndoToast('🗑 "' + p.title + '" 프로젝트를 지웠습니다 (항목은 그대로)', function () {
      apiFetch('/api/my-work/projects/' + encodeURIComponent(p.id) + '/restore', { method: 'POST' }).then(function (r) {
        _mwjPutLocal(r.data); _mwPaint();
      }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); });
    });
    if (p.link) apiFetch('/api/my-work/projects').then(function (r) { _mw.data.projCands = (r && r.cands) || []; _mwPaint(); }).catch(function () {});
  }).catch(function (e) { _mwToast('❌ ' + _mwErr(e), 'error'); renderMyWork(); });
}

/* ═══ 프로젝트 패널 — 오른쪽 (상세 패널 · 노트 서랍과 같은 자리, 하나만) ═══ */
function mwProjIsOpen() { return !!_mwj.id; }
function mwProjOpen(id, opt) {
  var p = mwProjById(id);
  if (!p) return;
  opt = opt || {};
  if (typeof mwPanelIsOpen === 'function' && mwPanelIsOpen()) mwPanelClose();
  if (typeof mwNotesIsOpen === 'function' && mwNotesIsOpen()) mwNotesClose(true);
  if (_mwj.id && _mwj.id !== id) _mwjDetach();
  _mwj.id = id; _mwj.pick = null; _mwj.pickQ = '';
  var el = document.getElementById('mwjPanel');
  if (!el) {
    el = document.createElement('aside');
    el.id = 'mwjPanel'; el.className = 'mwp mwj-p';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '내 프로젝트');
    document.body.appendChild(el);
    _mwjBindPanel(el);
  }
  _mwjRender(el);
  document.body.classList.add('mwp-open');
  requestAnimationFrame(function () { el.classList.add('on'); });
  _mwjMarkCard();
  if (opt.focus) { var f = el.querySelector(opt.focus); if (f) { f.focus(); if (f.select) f.select(); } }
}
function mwProjClose() {
  if (!_mwj.id) return;
  _mwjDetach();
  _mwj.id = null;
  var el = document.getElementById('mwjPanel');
  if (el) el.classList.remove('on');
  if (!(typeof mwPanelIsOpen === 'function' && mwPanelIsOpen()) && !(typeof mwNotesIsOpen === 'function' && mwNotesIsOpen())) document.body.classList.remove('mwp-open');
  _mwjMarkCard();
}
function _mwjMarkCard() {
  document.querySelectorAll('#mMyWork .mwj-c.mw-picked').forEach(function (c) { c.classList.remove('mw-picked'); });
  if (_mwj.id) { var c = document.querySelector('#mMyWork .mwj-c[data-pj="' + (window.CSS && CSS.escape ? CSS.escape(_mwj.id) : _mwj.id) + '"]'); if (c) c.classList.add('mw-picked'); }
}
/** 목록을 새로 받은 뒤 · 항목이 바뀐 뒤 — 쓰는 중이 아니면 패널 다시 그림 */
function _mwjRepaintPanel() {
  var el = document.getElementById('mwjPanel');
  if (!_mwj.id || !el) return;
  if (!mwProjById(_mwj.id)) { mwProjClose(); return; }
  var act = document.activeElement;
  // 바로 추가 칸에서 연달아 넣는 중이면 다시 그리고 커서 · 쓰던 글을 돌려줌 (항목 목록이 따라오게)
  var inAdd = act && act.closest && act.closest('#mwjAdd') && el.contains(act);
  if (!inAdd && el.contains(act) && act.matches('input:not([type=checkbox]):not([type=range]),textarea')) return;
  if (_mwj.timer || _mwj.inflight) return;
  var keep = inAdd ? act.value : null;
  _mwjRender(el);
  if (inAdd) { var x = el.querySelector('#mwjAdd input'); if (x) { x.value = keep; x.focus(); } }
}
function mwProjSync() { _mwjRepaintPanel(); _mwjMarkCard(); }

function _mwjRender(el) {
  var p = mwProjById(_mwj.id);
  if (!p) return;
  var today = _mw.data.today, s = mwProjStats(p), li = p.linkInfo, okLink = li && !li.locked;
  var h = '<div class="mwp-h"><span class="mwp-src">📁 내 프로젝트' + (p.link ? ' · 🔗 연계' : ' · 단독') + '</span>' +
    '<span class="mwp-save" id="mwjSave" aria-live="polite"></span><button class="mwp-x" data-jp="close" title="닫기 (Esc)">✕</button></div><div class="mwp-b">';
  h += '<div class="mwp-trow"><input id="mwjIcon" class="mw-input mwj-icin" data-jf="icon" maxlength="4" value="' + _mwEsc(p.icon || '') + '" placeholder="📁" title="아이콘 (이모지 하나)">' +
    '<textarea id="mwjTitle" class="mwp-title" rows="1" maxlength="200" data-jf="title">' + _mwEsc(p.title) + '</textarea></div>';
  // 상태
  h += '<div class="mwp-sec"><div class="mwp-l">상태</div><div class="mwp-seg" data-g="pjst">' + Object.keys(MW_PJ_STATUS).map(function (k) {
    return '<button data-jst="' + k + '"' + (p.status === k ? ' class="on"' : '') + '>' + MW_PJ_STATUS[k] + '</button>';
  }).join('') + '</div></div>';
  // 기간
  var dd = _mwjDday(p, today);
  h += '<div class="mwp-sec"><div class="mwp-l">기간' + (dd.t ? ' <i class="' + (dd.cls === 'is-late' ? 'mw-late' : '') + '">' + dd.t + '</i>' : '') + '</div>';
  if (okLink && (li.start || li.end)) h += '<div class="mwp-ro">' + _mwEsc((li.start || '?') + ' ~ ' + (li.end || '?')) + ' <i>— 프로젝트 관리 기간을 따릅니다</i></div>';
  else h += '<div class="mwp-row"><input id="mwjStart" type="date" class="mw-input" value="' + _mwEsc(p.start || '') + '"><span class="mwp-tilde">~</span><input id="mwjEnd" type="date" class="mw-input" value="' + _mwEsc(p.end || '') + '"' + (p.start ? ' min="' + _mwEsc(p.start) + '"' : '') + '></div>';
  h += '</div>';
  // 진행률
  h += '<div class="mwp-sec"><div class="mwp-l">진행률 <i>' + (s.prog != null ? s.prog + '%' : '—') + '</i></div><div class="mwp-clbar"><span style="width:' + (s.prog || 0) + '%;background:' + mwProjColor(p) + '"></span></div>';
  if (okLink && li.progress != null) h += '<div class="mwp-ro"><i>프로젝트 관리 진행률 · 내 항목 ' + s.done + '/' + (s.done + s.open) + ' 완료</i></div>';
  else h += '<div class="mwp-row mwj-prow"><label class="mwj-ck"><input type="checkbox" id="mwjManual"' + (p.progress != null ? ' checked' : '') + '> 직접 정하기</label>' +
    (p.progress != null ? '<input id="mwjProg" type="range" min="0" max="100" step="5" value="' + p.progress + '"><b id="mwjProgV">' + p.progress + '%</b>'
      : '<i class="mwj-hint">자동 — 소속 항목 ' + s.done + '/' + (s.done + s.open) + ' 완료</i>') + '</div>';
  h += '</div>';
  // 보이기 · 색
  h += '<div class="mwp-sec"><div class="mwp-l">보이기 · 색</div><div class="mwp-row"><label class="mwj-ck"><input type="checkbox" id="mwjVis"' + (p.visible ? ' checked' : '') + '> 타임라인 · 달력에 기간 띠 보이기</label></div>' +
    '<div class="mwp-row"><span class="mwk-sw mwj-sw">' + Object.keys(MW_CAT_COLORS).map(function (k) {
      return '<button type="button"' + (p.color === k ? ' class="on"' : '') + ' data-jcol="' + k + '" style="background:' + MW_CAT_COLORS[k] + '" title="' + k + '"></button>';
    }).join('') + '</span>' + (p.link ? '<button type="button" class="mwj-lnk' + (!p.color ? ' on' : '') + '" data-jcol="">프로젝트 색</button>' : '') + '</div></div>';
  // 연계
  h += '<div class="mwp-sec"><div class="mwp-l">프로젝트 관리 연계</div>';
  if (p.link) {
    if (okLink) {
      h += '<div class="mwj-lk"><b>🔗 ' + _mwEsc(li.name) + '</b>' + (li.status ? ' <i>' + _mwEsc(li.status) + '</i>' : '') + '</div>' +
        '<div class="mwp-acts"><button class="mwp-chip" data-jp="openpm">↗ 프로젝트 관리에서 열기</button><button class="mwp-chip" data-jp="unlink">연결 끊기</button></div>';
    } else {
      h += '<div class="mwp-ro">' + (li && li.gone ? '🗑 연결한 프로젝트가 지워졌습니다' : '🔒 연결한 프로젝트를 볼 권한이 없습니다') + '</div><div class="mwp-acts"><button class="mwp-chip" data-jp="unlink">연결 끊기</button></div>';
    }
  } else {
    h += '<input id="mwjPickQ" class="mw-input mwp-in" maxlength="100" placeholder="🔎 프로젝트 이름 · 수주번호로 찾아 연결" value="' + _mwEsc(_mwj.pickQ) + '" autocomplete="off">' +
      '<div id="mwjPick" class="mwj-pick">' + _mwjPickHtml() + '</div>';
  }
  h += '</div>';
  // 소속 항목
  var its = s.items.slice().sort(function (a, b) {
    return (a.done ? 1 : 0) - (b.done ? 1 : 0) || String(a.due || '9999').localeCompare(String(b.due || '9999'));
  });
  h += '<div class="mwp-sec"><div class="mwp-l">항목 <i>' + s.open + '개 남음</i></div>' +
    '<form id="mwjAdd" class="mwj-add"><input class="mw-input mwp-in" maxlength="500" placeholder="+ 이 프로젝트 할 일 — Enter (예: 금요일 !높음 시안 검토)" autocomplete="off"></form>' +
    '<div class="mwj-its">' + (its.length ? its.map(function (it) {
      var sc = MW_SRC[it.src] || { icon: '•', label: it.src };
      var late = !it.done && it.due && it.due < today;
      return '<div class="mwj-it' + (it.done ? ' mw-done' : '') + '" data-jit="' + _mwEsc(it.key) + '">' +
        (it.canDone ? '<input type="checkbox" class="mw-chk" data-jdone="' + _mwEsc(it.key) + '"' + (it.done ? ' checked' : '') + '>' : '<span class="mw-chk-sp"></span>') +
        '<span class="mwj-its-ic" title="' + _mwEsc(sc.label) + '">' + sc.icon + '</span><span class="mwj-its-t" data-jopen="' + _mwEsc(it.key) + '">' + _mwEsc(it.title) + '</span>' +
        (it.due ? '<span class="mw-due' + (late ? ' mw-late' : '') + '">' + _mwEsc(_mwDueLabel(it.due, today)) + '</span>' : '') +
        '<button class="mw-x" data-jout="' + _mwEsc(it.key) + '" title="이 프로젝트에서 빼기 (항목은 그대로)">×</button></div>';
    }).join('') : '<div class="mwj-e">아직 없습니다 — 위에서 바로 추가하거나, 보드 카드를 프로젝트 카드로 끌어 넣으세요.' + (p.link ? ' 연결한 프로젝트의 내 마일스톤 · 회의 액션 · 개발 작업은 저절로 들어옵니다.' : '') + '</div>') + '</div></div>';
  // 마일스톤 (연계)
  if (okLink && li.ms && li.ms.length) {
    h += '<div class="mwp-sec"><div class="mwp-l">마일스톤 <i>' + li.ms.filter(function (m) { return m.status === 'done'; }).length + '/' + li.ms.length + ' 완료</i></div><div class="mwj-its">' +
      li.ms.slice(0, 40).map(function (m) {
        var late = m.status !== 'done' && m.due && m.due < today;
        return '<div class="mwj-it mwj-ms' + (m.status === 'done' ? ' mw-done' : '') + '"><span class="mwj-its-ic">◆</span><span class="mwj-its-t" data-jp="openpm">' + _mwEsc(m.name) + '</span>' +
          (m.due ? '<span class="mw-due' + (late ? ' mw-late' : '') + '">' + _mwEsc(_mwjMd(m.due)) + '</span>' : '') + '</div>';
      }).join('') + '</div></div>';
  }
  h += '<div class="mwp-sec"><div class="mwp-l">메모</div><textarea id="mwjMemo" class="mw-input mwp-memo" data-jf="memo" maxlength="5000" placeholder="목표 · 범위 · 링크 · 연락처…">' + _mwEsc(p.memo || '') + '</textarea></div>';
  h += '</div><div class="mwp-f"><button class="mw-btn mwp-del" data-jp="delete">🗑 프로젝트 지우기</button><span class="mwp-keys">항목은 지워지지 않습니다 · Esc 닫기</span></div>';
  el.innerHTML = h;
  _mwjGrow(el.querySelector('#mwjTitle')); _mwjGrow(el.querySelector('#mwjMemo'));
  _mwjShowState();
}
function _mwjGrow(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, ta.id === 'mwjMemo' ? 320 : 120) + 'px'; }
function _mwjPickHtml() {
  if (_mwj.pick == null) return '<div class="mwj-e">이름을 적거나 누르면 볼 수 있는 프로젝트가 나옵니다</div>';
  if (!_mwj.pick.length) return '<div class="mwj-e">맞는 프로젝트가 없습니다</div>';
  var linked = {};
  mwProjs().forEach(function (p) { if (p.link) linked[p.link] = true; });
  return _mwj.pick.slice(0, 30).map(function (x) {
    return '<button class="mwj-pk' + (linked[x.id] ? ' is-used' : '') + '" data-jlink="' + _mwEsc(x.id) + '"' + (linked[x.id] ? ' disabled title="다른 내 프로젝트에 이미 연결"' : '') + '>' +
      '<b>' + _mwEsc(x.name) + '</b>' + (x.orderNo ? ' <i>' + _mwEsc(x.orderNo) + '</i>' : '') + (x.start || x.end ? ' <i>' + _mwjMd(x.start) + ' ~ ' + _mwjMd(x.end) + '</i>' : '') + '</button>';
  }).join('');
}
function _mwjLoadPick() {
  var q = _mwj.pickQ, el = document.getElementById('mwjPick');
  apiFetch('/api/my-work/projects/pick?q=' + encodeURIComponent(q)).then(function (r) {
    if (q !== _mwj.pickQ) return;
    _mwj.pick = (r && r.data) || [];
    var box = document.getElementById('mwjPick');
    if (box) box.innerHTML = _mwjPickHtml();
  }).catch(function (e) { if (el) el.innerHTML = '<div class="mwj-e">❌ ' + _mwEsc(_mwErr(e)) + '</div>'; });
}

/* ── 자동 저장 (글 · 기간 · 진행률) ── */
function _mwjQueue(patch, delay) {
  if (_mwj.qId && _mwj.qId !== _mwj.id) _mwjDetach();
  _mwj.qId = _mwj.id;
  Object.keys(patch).forEach(function (k) { _mwj.q[k] = patch[k]; });
  _mwj.state = 'dirty'; _mwjShowState();
  clearTimeout(_mwj.timer);
  _mwj.timer = setTimeout(_mwjFlush, delay == null ? 0 : delay);
}
/** 다른 프로젝트로 옮기거나 닫을 때 — 모아 둔 것은 원래 프로젝트 몫으로 따로 보냄 (v13.275, 패널 _mwpDetach 와 같은 이유) */
function _mwjDetach() {
  clearTimeout(_mwj.timer); _mwj.timer = null;
  var id = _mwj.qId, body = _mwj.q;
  _mwj.q = {}; _mwj.qId = null;
  if (!id || !Object.keys(body).length) return;
  (_mwj.inflight || Promise.resolve()).catch(function () {}).then(function () {
    return apiFetch('/api/my-work/projects/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(body) });
  }).then(function (r) { _mwjPutLocal(r.data); _mwPaint(); }, function (e) { _mwToast('❌ 프로젝트 저장 못 함: ' + _mwErr(e), 'error'); });
}
function _mwjFlush() {
  clearTimeout(_mwj.timer); _mwj.timer = null;
  var p = mwProjById(_mwj.qId);
  if (!p || !Object.keys(_mwj.q).length) return _mwj.inflight || Promise.resolve();
  if (_mwj.inflight) { _mwj.inflight.then(function () { _mwjFlush(); }, function () {}); return _mwj.inflight; }
  var body = _mwj.q; _mwj.q = {}; _mwj.qId = null;
  var id = p.id;
  _mwj.state = 'saving'; _mwjShowState();
  _mwj.inflight = apiFetch('/api/my-work/projects/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(body) }).then(function (r) {
    _mwj.inflight = null;
    _mwjPutLocal(r.data);
    _mwj.state = Object.keys(_mwj.q).length ? 'dirty' : 'saved'; _mwjShowState();
    _mwPaint();
    if (Object.keys(_mwj.q).length) _mwjFlush();
  }).catch(function (e) {
    _mwj.inflight = null;
    if (_mwj.id !== id || (_mwj.qId && _mwj.qId !== id)) { _mwToast('❌ 프로젝트 저장 못 함: ' + _mwErr(e), 'error'); return; }
    _mwj.qId = id;
    Object.keys(body).forEach(function (k) { if (!(k in _mwj.q)) _mwj.q[k] = body[k]; });
    _mwj.state = 'error'; _mwj.err = _mwErr(e); _mwjShowState();
  });
  return _mwj.inflight;
}
function _mwjShowState() {
  var el = document.getElementById('mwjSave');
  if (!el) return;
  el.textContent = { idle: '', dirty: '…', saving: '저장 중…', saved: '✓ 저장됨', error: '⚠️ 저장 못 함 — 다시 하기' }[_mwj.state] || '';
  el.className = 'mwp-save is-' + _mwj.state;
  el.title = _mwj.state === 'error' ? (_mwj.err || '') : '';
}
/** 화면의 프로젝트 값도 바로 (저장 응답 전에 카드 · 막대가 따라오게) */
function _mwjApply(p, b) {
  if ('title' in b) p.title = b.title;
  if ('icon' in b) p.icon = b.icon;
  if ('memo' in b) p.memo = b.memo;
  if ('startDate' in b && !(p.linkInfo && p.linkInfo.start)) p.start = b.startDate;
  if ('endDate' in b && !(p.linkInfo && p.linkInfo.end)) p.end = b.endDate;
  if ('progress' in b) p.progress = b.progress;
  if ('color' in b) p.color = b.color;
}

function _mwjBindPanel(el) {
  el.addEventListener('click', function (e) {
    var t = e.target, p = mwProjById(_mwj.id);
    if (!p) return;
    if (t.closest('#mwjSave.is-error')) { _mwjFlush(); return; }
    var a = t.closest('[data-jp]');
    if (a) {
      var k = a.getAttribute('data-jp');
      if (k === 'close') return mwProjClose();
      if (k === 'delete') return mwProjDelete(p);
      if (k === 'openpm') { if (p.link && typeof showProjectDetail === 'function') showProjectDetail(p.link); return; }
      if (k === 'unlink') { mwProjSave(p, { linkProjectId: null }).then(function () { apiFetch('/api/my-work/projects').then(function (r) { _mw.data.projCands = (r && r.cands) || []; _mwPaint(); }).catch(function () {}); }); return; }
    }
    var st = t.closest('[data-jst]');
    if (st) { mwProjSave(p, { status: st.getAttribute('data-jst') }, { undo: true }); return; }
    var col = t.closest('[data-jcol]');
    if (col) { var c = col.getAttribute('data-jcol') || null; _mwjApply(p, { color: c }); _mwjQueue({ color: c }, 0); _mwPaint(); _mwjRender(el); return; }
    var lk = t.closest('[data-jlink]');
    if (lk) { mwProjSave(p, { linkProjectId: lk.getAttribute('data-jlink') }).then(function (np) { if (np) _mwToast('🔗 ' + np.linkInfo.name + ' 와 연결했습니다'); }); return; }
    var out = t.closest('[data-jout]');
    if (out) { mwProjSetItem(_mwFind(out.getAttribute('data-jout')), null); return; }
    var op = t.closest('[data-jopen]');
    if (op) { var it = _mwFind(op.getAttribute('data-jopen')); if (it && typeof mwPanelOpen === 'function') mwPanelOpen(it); return; }
  });
  el.addEventListener('change', function (e) {
    var t = e.target, p = mwProjById(_mwj.id);
    if (!p) return;
    if (t.hasAttribute('data-jdone')) { var it = _mwFind(t.getAttribute('data-jdone')); if (it) mwSetDone(it, t.checked, t); setTimeout(_mwjRepaintPanel, 300); return; }
    if (t.id === 'mwjVis') { mwProjSave(p, { visible: t.checked }); return; }
    if (t.id === 'mwjStart' || t.id === 'mwjEnd') {
      var s = el.querySelector('#mwjStart').value || null, d = el.querySelector('#mwjEnd').value || null;
      if (s && d && s > d) { if (t.id === 'mwjStart') d = s; else s = d; }
      _mwjApply(p, { startDate: s, endDate: d }); _mwjQueue({ startDate: s, endDate: d }, 0); _mwPaint(); _mwjRender(el);
      return;
    }
    if (t.id === 'mwjManual') {
      var v = t.checked ? (mwProjStats(p).auto || 0) : null;
      _mwjApply(p, { progress: v }); _mwjQueue({ progress: v }, 0); _mwPaint(); _mwjRender(el);
      return;
    }
    if (t.id === 'mwjProg') { _mwjQueue({ progress: +t.value }, 0); _mwPaint(); }
  });
  el.addEventListener('input', function (e) {
    var t = e.target, p = mwProjById(_mwj.id);
    if (!p) return;
    var f = t.getAttribute('data-jf');
    if (f) {
      var v = f === 'title' ? t.value.replace(/\n/g, ' ') : t.value;
      if (f === 'title' && !v.trim()) return;
      var b = {}; b[f] = v;
      _mwjApply(p, b); _mwjQueue(b, 600);
      if (t.tagName === 'TEXTAREA') _mwjGrow(t);
      return;
    }
    if (t.id === 'mwjProg') { p.progress = +t.value; var pv = el.querySelector('#mwjProgV'); if (pv) pv.textContent = t.value + '%'; return; }
    if (t.id === 'mwjPickQ') {
      _mwj.pickQ = t.value.trim();
      clearTimeout(_mwj.pickT);
      _mwj.pickT = setTimeout(_mwjLoadPick, 250);
    }
  });
  el.addEventListener('focusin', function (e) { if (e.target.id === 'mwjPickQ' && _mwj.pick == null) _mwjLoadPick(); });
  el.addEventListener('focusout', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-jf')) { _mwjFlush(); setTimeout(function () { _mwPaint(); }, 0); } });
  el.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.key === 'Escape') { e.stopPropagation(); if (t.blur) t.blur(); mwProjClose(); return; }
    if (e.key === 'Enter' && t.id === 'mwjTitle') { e.preventDefault(); t.blur(); }
  });
  el.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('#mwjAdd');
    if (!f) return;
    e.preventDefault();
    var inp = f.querySelector('input'), raw = (inp.value || '').trim(), p = mwProjById(_mwj.id);
    if (!raw || !p) return;
    var q = typeof QuickParse !== 'undefined' ? QuickParse.parse(raw, _mw.data.today) : { title: raw };
    if (!q.title) { _mwToast('할 일 내용을 적어 주세요', 'warn'); return; }
    inp.value = '';
    mwAddTodo({ title: q.title, dueDate: q.due || null, dueTime: q.due && q.time ? q.time : null, priority: q.priority || 3, myProjectId: p.id }).then(function () {
      _mwjRepaintPanel();
      var x = document.querySelector('#mwjAdd input'); if (x) x.focus();
    }).catch(function (er) { _mwToast('❌ 추가하지 못했습니다 — ' + _mwErr(er), 'error'); if (!inp.value) inp.value = raw; });
  });
}

/* ═══ 타임라인 (my-work-timeline.js) ═══ */
/** 보일 프로젝트 — 전체 표시 켜짐 · 👁 · 날짜 있음 (끝난 것은 '다 한 것도'일 때만) */
function mwProjBandList(showDone) {
  if (!_mw.data || !_mw.data.self || !mwProjBandOn()) return [];
  return mwProjs().filter(function (p) { return p.visible && (p.start || p.end) && (showDone || p.status !== 'done'); });
}
/** 줄 나누기 '프로젝트별'에서 이 항목의 줄 */
function mwProjLaneOf(it) {
  var p = mwProjOf(it);
  return p && p.visible && mwProjBandOn() ? 'pj:' + p.id : '__nopj';
}
/** 타임라인 막대들 (+ 프로젝트별이면 연계 마일스톤 ◆) — numFn = _mtlNum */
function mwProjTimelineTasks(grp, numFn, today, showDone) {
  var out = [], have = {};
  ((_mw.data && _mw.data.data) || []).forEach(function (it) { if (it.src === 'milestone') have[it.id] = true; });
  mwProjBandList(showDone).forEach(function (p) {
    var s = p.start || p.end, d = p.end || p.start;
    var st = mwProjStats(p), lane = grp === 'proj' ? 'pj:' + p.id : '__pj';
    var dd = _mwjDday(p, today);
    out.push({ key: 'pj:' + p.id, proj: p, title: p.title + (st.prog != null ? ' · ' + st.prog + '%' : ''), icon: p.icon || '📁', lane: lane, color: mwProjColor(p),
      bar: true, n0: numFn(s), n1: numFn(d), f0: 0, f1: 1, late: dd.cls === 'is-late', done: p.status === 'done', pri: 3,
      drag: p.link ? null : 'bar',
      tip: '📁 내 프로젝트' + (p.link ? ' · 🔗 연계' : '') + '\n' + (s || '') + ' ~ ' + (d || '') + (dd.t ? ' · ' + dd.t : '') + ' · 남은 항목 ' + st.open });
    if (grp !== 'proj' || !p.linkInfo || !p.linkInfo.ms) return;
    p.linkInfo.ms.forEach(function (m) {
      if (!m.due || have[m.id] || (m.status === 'done' && !showDone)) return;
      out.push({ key: 'pjms:' + m.id, pjms: m, pjLink: p.link, title: m.name, icon: '◆', lane: lane, color: mwProjColor(p), bar: false,
        n0: numFn(m.due), n1: numFn(m.due), f0: 0.5, f1: 1, late: m.status !== 'done' && m.due < today, done: m.status === 'done', pri: 3, drag: null,
        tip: '◆ 마일스톤 (프로젝트 관리) · ' + m.due + (m.status ? ' · ' + m.status : '') });
    });
  });
  return out;
}
/** 프로젝트별 줄 — 보일 프로젝트마다 한 줄 + 프로젝트 없음 */
function mwProjLanes(showDone) {
  return mwProjBandList(showDone).map(function (p) { return { id: 'pj:' + p.id, name: p.title, icon: p.icon || '📁', color: mwProjColor(p), keep: true }; })
    .concat([{ id: '__nopj', name: '프로젝트 없음', icon: '📥', color: '#94A3B8' }]);
}

/* ═══ 달력 (my-work-cal.js) — 기간 띠 ═══ */
function mwProjCalEntries(from, to) {
  return mwProjBandList(false).filter(function (p) {
    var s = p.start || p.end, d = p.end || p.start;
    return s <= to && d >= from;
  }).map(function (p) {
    var s = p.start || p.end, d = p.end || p.start, st = mwProjStats(p);
    return { kind: 'proj', key: 'p|' + p.id, p: p, title: p.title, icon: p.icon || '📁', color: mwProjColor(p), date: s, end: d, time: '', timeEnd: '',
      done: false, late: false, drag: false, tip: '📁 ' + p.title + ' · ' + s + ' ~ ' + d + (st.prog != null ? ' · ' + st.prog + '%' : '') };
  });
}
