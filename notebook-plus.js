/* ═══════════════════════════════════════════════════════════════════════
   notebook-plus.js — 📓 노트북 연결 · 공유 · 리포트 (v13.317) · ✍️ 글쓰기 코치 (v13.318)
   ─────────────────────────────────────────────────────────────────────
   v13.317
     · [[노트 제목]] 잇기 — [[ 를 치면 제목 자동 완성 · 없는 노트는 누르면 만듦 · 아래에 "이 노트를 가리키는 노트"
     · 🔗 업무 연결 — 프로젝트 · 마일스톤 · 이슈 · 회의 · 할 일을 골라 넣으면 칩에 지금 상태(진척 · 상태 · D-day) — 권한 그대로
     · 체크 줄 → ✏️ 내 할 일 · 🐞 이슈 로 (줄 끝에 표시) · 할 일과 체크가 서로 맞춰짐
     · 👥 공유 (읽기 전용) — 받는 사람에게 메신저 카드 · 왼쪽 "공유받은 노트"
     · 📊 리포트 — 기간 · 폴더 · 태그 → 그대로 모으기 · ✨ 주간 업무 형식 · ✨ 요약 보고서 → 새 노트 · 주간 업무 작성에 넣기
   v13.318 ✍️ 글쓰기 코치 — 오른쪽 칸
     · 쓰는 동안 규칙 검사(notebook-coach.js) — 이유 → 힌트 → 예시 순서로 펼침 · 이 자리로
     · 글 종류별 빠진 칸 · 점수(명확성 · 간결성 · 구조 · 근거) · 데이터와 다른 곳(연결한 프로젝트 진척 · 이슈 상태)
     · ✨ AI 코치 — 총평 · 짚을 곳 · 연습 과제 · 예시로 바꾸기(고르면)
     · 📈 나의 글쓰기 — 8주 점수 흐름 · 이번 주 버릇 · 연습 과제
   의존: notebook.js 의 NB · _nb* 함수 · NbMd · NbCoach · apiFetch · createModal · wmGuardedModal · globalSearchNav · QuickParse · ISSUE_STATUS
   ═══════════════════════════════════════════════════════════════════════ */

var NBP = { titles: null, titlesAt: 0, refs: {}, back: null, backFor: null, wiki: null, coach: null, coachTab: 'now', open: {}, ai: null, logT: null, lastLog: '' };
var NBP_REF_ICON = { project: '📁', milestone: '🏁', issue: '🐞', meeting: '🤝', todo: '✏️', note: '📄' };

/* ═══ 제목 목록 ([[ ]]) ═══ */
function _nbpTitles(force) {
  if (!force && NBP.titles && Date.now() - NBP.titlesAt < 60000) return Promise.resolve(NBP.titles);
  return apiFetch('/api/notebook/titles').then(function (r) { NBP.titles = r.data || []; NBP.titlesAt = Date.now(); return NBP.titles; }).catch(function () { return NBP.titles || []; });
}
function _nbpByTitle(t) {
  var k = String(t || '').trim().toLowerCase();
  return (NBP.titles || []).filter(function (x) { return x.title.trim().toLowerCase() === k; })[0] || null;
}

/* ═══ 미리보기를 그린 뒤 — 링크 · 칩 · 체크 단추 · 가리키는 노트 ═══ */
function _nbAfterRender(doc) {
  if (!doc) return;
  // [[노트]]
  var wls = doc.querySelectorAll('a.nb-wl');
  if (wls.length) _nbpTitles().then(function () {
    wls.forEach(function (a) {
      var n = _nbpByTitle(a.getAttribute('data-wl'));
      a.classList.toggle('missing', !n);
      if (n) a.setAttribute('data-id', n.id); else a.removeAttribute('data-id');
      a.title = n ? '📄 노트 열기' : '아직 없는 노트 — 누르면 만듭니다';
    });
  });
  // 🔗 업무 칩 · 할 일 표시
  var keys = [];
  doc.querySelectorAll('a.nb-ref[data-ref]').forEach(function (a) { keys.push(a.getAttribute('data-ref')); });
  doc.querySelectorAll('a.nb-todo-ref[data-todo]').forEach(function (a) { keys.push('todo:' + a.getAttribute('data-todo')); });
  if (keys.length) _nbpRefs(keys).then(function () { _nbpPaintRefs(doc); _nbpSyncTodos(); if (NBP.coach) _nbpCoachRun(); });
  // 체크 줄 → 할 일 · 이슈 단추
  if (NB.cur && !_nbRO()) {
    doc.querySelectorAll('li.nb-task').forEach(function (li) {
      var body = li.querySelector(':scope > div'); if (!body) return;
      var linked = body.querySelector(':scope > a.nb-todo-ref, :scope > a.nb-ref[data-ref^="issue:"]');
      if (linked || li.classList.contains('done')) return;
      var s = document.createElement('span'); s.className = 'nb-task-acts';
      s.innerHTML = '<button type="button" data-tk="todo" title="✏️ 내 할 일로 — 날짜 · 중요도(내일 !높음)도 읽음">✏️ 할 일</button><button type="button" data-tk="issue" title="🐞 프로젝트 이슈로">🐞 이슈</button>';
      body.appendChild(s);
    });
  }
  // 이 노트를 가리키는 노트
  _nbpBacklinks();
}
var _nbpRefQ = null;
function _nbpRefs(keys) {
  var now = Date.now(), need = [];
  keys.forEach(function (k) { var c = NBP.refs[k]; if ((!c || now - c.t > 60000) && need.indexOf(k) < 0) need.push(k); });
  if (!need.length) return Promise.resolve();
  return apiFetch('/api/notebook/refs', { method: 'POST', body: JSON.stringify({ refs: need.map(function (k) { var i = k.indexOf(':'); return { t: k.slice(0, i), id: k.slice(i + 1) }; }) }) }).then(function (r) {
    Object.keys(r.data || {}).forEach(function (k) { NBP.refs[k] = { v: r.data[k], t: Date.now() }; });
  }).catch(function () {});
}
function _nbpDday(d) {
  if (!d) return '';
  var t = new Date(_nbToday() + 'T00:00:00Z'), x = new Date(String(d).slice(0, 10) + 'T00:00:00Z');
  var n = Math.round((x - t) / 86400000);
  return n === 0 ? 'D-day' : n > 0 ? 'D-' + n : 'D+' + (-n);
}
function _nbpRefText(type, v) {
  if (!v) return '';
  if (v.locked) return '🔒 볼 권한 없음';
  if (v.missing) return '❓ 없음';
  if (type === 'project' || type === 'milestone') return (v.progress != null ? v.progress + '%' : '') + (v.status === 'done' ? ' · ✅ 완료' : v.due ? ' · ' + _nbpDday(v.due) : '');
  if (type === 'issue') {
    var st = (typeof ISSUE_STATUS !== 'undefined' && ISSUE_STATUS[v.status]) ? ISSUE_STATUS[v.status].label : v.status;
    return (v.urgency === 'urgent' ? '🔥 ' : '') + (v.done ? '✅ ' : '') + st;
  }
  if (type === 'meeting') return v.due ? String(v.due).slice(5).replace('-', '/') : '';
  if (type === 'todo') return v.done ? '✅ 완료' : v.due ? _nbpDday(v.due) : '';
  return '';
}
function _nbpPaintRefs(doc) {
  doc.querySelectorAll('a.nb-ref[data-ref]').forEach(function (a) {
    var k = a.getAttribute('data-ref'), type = k.slice(0, k.indexOf(':')), c = NBP.refs[k];
    a.classList.add('nb-ref-' + type);
    var old = a.querySelector('.nb-ref-st'); if (old) old.remove();
    if (!c) return;
    var txt = _nbpRefText(type, c.v);
    a.classList.toggle('done', !!(c.v && (c.v.done || c.v.status === 'done')));
    a.classList.toggle('bad', !!(c.v && (c.v.missing || c.v.locked)));
    if (txt) { var s = document.createElement('span'); s.className = 'nb-ref-st'; s.textContent = txt; a.appendChild(s); }
    a.title = (c.v && c.v.title ? c.v.title + ' — ' : '') + (txt || '') + ' · 누르면 열기';
  });
}
/** 할 일과 체크 맞추기 — 할 일이 끝났으면 노트 줄도 [x] (반대로 노트에서 체크하면 할 일도) */
function _nbpSyncTodos() {
  if (!NB.cur || _nbRO()) return;
  var s = _nbSrc(); if (!s) return;
  var lines = s.value.split('\n'), changed = 0;
  lines.forEach(function (l, i) {
    var m = /⟦([^⟧]+)⟧/.exec(l), c = m && NBP.refs['todo:' + m[1]];
    if (!c || !c.v || c.v.missing) return;
    var mm = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(l); if (!mm) return;
    var on = mm[2] !== ' ';
    if (on !== !!c.v.done) { lines[i] = mm[1] + '[' + (c.v.done ? 'x' : ' ') + ']' + l.slice(mm[0].length); changed++; }
  });
  if (!changed) return;
  var a = s.selectionStart, b = s.selectionEnd;
  s.value = lines.join('\n'); s.setSelectionRange(a, b);
  _nbChanged('body'); _nbRenderPrev();
  _nbToast('✏️ 내 업무의 할 일 상태에 맞춰 체크 ' + changed + '줄을 고쳤습니다');
}
/** 체크를 누름 — 할 일이 걸린 줄이면 할 일도 완료/되돌리기 */
function _nbpTaskToggled(line, done) {
  var s = _nbSrc(); if (!s) return;
  var l = s.value.split('\n')[line] || '', m = /⟦([^⟧]+)⟧/.exec(l);
  if (!m) return;
  var key = 'todo:' + m[1], before = NBP.refs[key];
  // 먼저 맞춰 둠 — 다시 그릴 때 옛 상태로 노트 체크를 되돌리지 않게
  NBP.refs[key] = { v: Object.assign({}, (before || {}).v || {}, { done: done }), t: Date.now() };
  apiFetch('/api/my-work/done', { method: 'PUT', body: JSON.stringify({ src: 'todo', id: m[1], done: done }) }).then(function () {
    _nbToast(done ? '✅ 내 할 일도 완료로 했습니다' : '↩ 내 할 일을 다시 열었습니다');
  }).catch(function (e) { NBP.refs[key] = before; _nbToast('❌ 할 일을 바꾸지 못했습니다 — ' + _nbErr(e), 'error'); });
}

/* ─── 가리키는 노트 ─── */
function _nbpBacklinks() {
  var box = document.getElementById('nbBL'); if (!box) return;
  if (!NB.cur || NB.cur.readOnly) { box.innerHTML = ''; return; }
  var id = NB.cur.id;
  function draw(list) {
    if (!NB.cur || NB.cur.id !== id) return;
    box.innerHTML = list.length ? '<div class="nb-bl-h">🔗 이 노트를 가리키는 노트 <b>' + list.length + '</b></div>' + list.map(function (x) {
      return '<button type="button" class="nb-bl-i" data-open-note="' + _nbE(x.id) + '"><b>' + _nbE(x.title) + '</b><span>' + _nbE(x.ctx || '') + '</span></button>';
    }).join('') : '';
  }
  if (NBP.backFor === id && NBP.back) { draw(NBP.back); return; }
  NBP.backFor = id; NBP.back = [];
  apiFetch('/api/notebook/notes/' + encodeURIComponent(id) + '/backlinks').then(function (r) { NBP.back = r.data || []; draw(NBP.back); }).catch(function () {});
}

/* ═══ 누르기 (notebook.js _nbClick 앞에서) ═══ */
function _nbPlusClick(e) {
  var t = e.target, x;
  if ((x = t.closest('#nbDoc a.nb-wl'))) {
    e.preventDefault();
    var id = x.getAttribute('data-id');
    if (id) { _nbOpen(id); return true; }
    var title = x.getAttribute('data-wl');
    _nbpTitles(true).then(function () {
      var n = _nbpByTitle(title);
      if (n) _nbOpen(n.id);
      else nbNewFrom('', title, { folderId: NB.cur ? NB.cur.folderId : null }).then(function () { NBP.titles = null; });
    });
    return true;
  }
  if ((x = t.closest('#nbDoc a.nb-ref'))) {
    e.preventDefault();
    var k = x.getAttribute('data-ref'), type = k.slice(0, k.indexOf(':')), c = NBP.refs[k];
    if (type === 'note') { _nbOpen(k.slice(5)); return true; }
    if (c && c.v && c.v.locked) { _nbToast('🔒 이 항목을 볼 권한이 없습니다', 'warn'); return true; }
    if (c && c.v && c.v.missing) { _nbToast('❓ 지워졌거나 없는 항목입니다', 'warn'); return true; }
    var nav = c && c.v && c.v.nav ? c.v.nav : type === 'project' ? { projectId: k.slice(8) } : type === 'issue' ? { issueId: k.slice(6) } : type === 'todo' ? { todoId: k.slice(5) } : {};
    if (typeof globalSearchNav === 'function') { _nbFlush(); globalSearchNav(type, { nav: nav }, ''); }
    return true;
  }
  if ((x = t.closest('[data-tk]'))) {
    e.preventDefault(); e.stopPropagation();
    var li = x.closest('li.nb-task'); if (!li) return true;
    var line = +li.getAttribute('data-line');
    if (x.getAttribute('data-tk') === 'todo') _nbpToTodo(line); else _nbpToIssue(line);
    return true;
  }
  if ((x = t.closest('[data-open-note]'))) { _nbOpen(x.getAttribute('data-open-note')); return true; }
  if ((x = t.closest('#nbCoach'))) { _nbpCoachClick(e); return true; }
  return false;
}

/* ═══ 체크 줄 → 할 일 · 이슈 ═══ */
function _nbpLineText(line) {
  var l = (_nbSrc().value.split('\n')[line] || '');
  return l.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+/, '').replace(/ ?⟦[^⟧]*⟧/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_=~`]/g, '').trim();
}
function _nbpAppendToLine(line, add) {
  var s = _nbSrc(), lines = s.value.split('\n');
  if (lines[line] == null) return;
  lines[line] = lines[line].replace(/\s+$/, '') + add;
  var a = s.selectionStart;
  s.value = lines.join('\n'); s.setSelectionRange(a, a);
  _nbChanged('body'); _nbRenderPrev(); _nbFoot();
}
function _nbpToTodo(line) {
  var raw = _nbpLineText(line);
  if (!raw) { _nbToast('할 일로 올릴 내용을 적어 주세요', 'warn'); return; }
  var q = typeof QuickParse !== 'undefined' ? QuickParse.parse(raw, _nbToday()) : { title: raw };
  apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: q.title || raw, dueDate: q.due || null, dueTime: q.due && q.time ? q.time : null, priority: q.priority || 3,
    memo: '📓 노트 "' + (NB.cur.title || '제목 없음') + '" 에서' }) }).then(function (r) {
    NBP.refs['todo:' + r.data.id] = { v: { title: r.data.title, due: r.data.due_date, done: false, nav: { todoId: r.data.id } }, t: Date.now() };
    _nbpAppendToLine(line, ' ⟦' + r.data.id + '⟧');
    _nbToast('✏️ 내 할 일로 — ' + (q.title || raw) + (q.due ? ' · ' + (+q.due.slice(5, 7)) + '/' + (+q.due.slice(8, 10)) : ''));
  }).catch(function (e) { _nbToast('❌ 할 일로 올리지 못했습니다 — ' + _nbErr(e), 'error'); });
}
/* ═══ 📁 프로젝트 고르기 (이슈로 올리기 · 프로젝트 회의로 올리기 공용) ═══ */
/** 노트 본문에 연결된 프로젝트 [{ id, title }] — 칩 상태를 받아 둔 것은 이름으로 */
function nbpLinkedProjects(body) {
  var pre = [];
  (String(body || '').match(/\(wm:project:[A-Za-z0-9_.:-]+\)/g) || []).forEach(function (m) {
    var id = m.slice(12, -1), c = NBP.refs['project:' + id];
    if (!pre.some(function (p) { return p.id === id; })) pre.push({ id: id, title: c && c.v && c.v.title ? c.v.title : id });
  });
  return pre;
}
function nbpProjPickHtml(pre) {
  return '<label class="nb-fl">프로젝트<input class="mw-input nb-in" data-pp="q" placeholder="프로젝트 이름 · 수주번호로 찾기" autocomplete="off"></label>' +
    '<div class="nb-pick" data-pp="list">' + pre.map(function (p, i) { return '<button type="button" class="nb-pick-i' + (i === 0 ? ' on' : '') + '" data-pid="' + _nbE(p.id) + '">📁 ' + _nbE(p.title) + ' <small>이 노트에 연결됨</small></button>'; }).join('') + '</div>';
}
/** 창 안의 고르기 칸을 살림 → { get(): 고른 프로젝트 id | null } */
function nbpProjPick(box, pre) {
  var pid = pre[0] ? pre[0].id : null, qT = null, list = box.querySelector('[data-pp="list"]');
  box.querySelector('[data-pp="q"]').addEventListener('input', function (e) {
    clearTimeout(qT); var v = e.target.value.trim();
    qT = setTimeout(function () {
      if (!v) return;
      apiFetch('/api/search?cat=project&limit=12&q=' + encodeURIComponent(v)).then(function (r) {
        var g = (r.data.groups || [])[0], items = g ? g.items : [];
        list.innerHTML = items.length ? items.map(function (it) { return '<button type="button" class="nb-pick-i" data-pid="' + _nbE(it.id) + '">📁 ' + _nbE(it.title) + (it.sub ? ' <small>' + _nbE(it.sub) + '</small>' : '') + '</button>'; }).join('') : '<div class="nb-empty-s">찾는 프로젝트가 없습니다</div>';
        pid = null;
      });
    }, 250);
  });
  list.addEventListener('click', function (e) {
    var p = e.target.closest('[data-pid]'); if (!p) return;
    pid = p.getAttribute('data-pid');
    list.querySelectorAll('.nb-pick-i').forEach(function (b) { b.classList.toggle('on', b === p); });
  });
  return { get: function () { return pid; } };
}

function _nbpToIssue(line) {
  var raw = _nbpLineText(line);
  if (!raw) { _nbToast('이슈로 올릴 내용을 적어 주세요', 'warn'); return; }
  var pre = nbpLinkedProjects(_nbSrc().value);   // 노트에 연결한 프로젝트가 있으면 먼저 고름
  return wmGuardedModal('nbIssue', function () {
    var md = createModal({ id: 'nbIssueModal', titleText: '🐞 이슈로 올리기', width: '480px', closeOnEsc: true,
      html: '<label class="nb-fl">제목<input class="mw-input nb-in" id="nbIsT" maxlength="200" value="' + _nbE(raw) + '"></label>' + nbpProjPickHtml(pre) +
        '<label class="nb-fl">긴급도<select class="mw-input nb-in" id="nbIsU"><option value="normal">보통</option><option value="high">높음</option><option value="urgent">🔥 긴급</option></select></label>' +
        '<div class="nb-mfoot"><button class="nb-btn" data-x="cancel">취소</button><button class="nb-btn pri" data-x="ok">이슈 만들기</button></div>' });
    var pick = nbpProjPick(md.box, pre);
    md.box.addEventListener('click', function (e) {
      var x = e.target.closest('[data-x]'); if (!x) return;
      if (x.getAttribute('data-x') === 'cancel') return md.close();
      var pid = pick.get();
      if (!pid) { _nbToast('프로젝트를 골라 주세요', 'warn'); return; }
      var title = md.box.querySelector('#nbIsT').value.trim(); if (!title) return;
      x.disabled = true;
      apiFetch('/api/issues', { method: 'POST', body: JSON.stringify({ projectId: pid, title: title, urgency: md.box.querySelector('#nbIsU').value, status: 'open', reportDate: _nbToday(),
        description: '📓 노트 "' + (NB.cur.title || '제목 없음') + '" 에서 올림' }) }).then(function (r) {
        var id = (r.data && r.data.id) || (r.id);
        md.close();
        _nbpAppendToLine(line, ' [🐞 이슈](wm:issue:' + id + ')');
        _nbToast('🐞 이슈를 만들었습니다 — ' + title);
      }).catch(function (e2) { x.disabled = false; _nbToast('❌ ' + _nbErr(e2), 'error'); });
    });
  }, 'nbIssueModal', { onOpen: function () { var i = pre.length ? document.getElementById('nbIsT') : document.querySelector('#nbIssueModal [data-pp="q"]'); if (i) i.focus(); } });
}

/* ═══ 🔗 업무 연결 고르기 ═══ */
var NBP_CATS = [['project', '📁 프로젝트'], ['milestone', '🏁 마일스톤'], ['issue', '🐞 이슈'], ['meeting', '🤝 회의'], ['todo', '✏️ 내 할 일'], ['note', '📄 노트']];
function nbpLinkPick() {
  if (!NB.cur || _nbRO()) return;
  if (NB.mode === 'view') _nbSetMode('split');
  var s = _nbSrc(), a = s.selectionStart, b = s.selectionEnd;
  return wmGuardedModal('nbLink', function () {
    var md = createModal({ id: 'nbLinkModal', titleText: '🔗 업무 연결 — 넣으면 지금 상태가 칩으로 보입니다', width: '560px', closeOnEsc: true,
      html: '<input class="mw-input nb-in" id="nbLkQ" placeholder="프로젝트 · 이슈 · 마일스톤 · 회의 · 할 일 · 노트 찾기" autocomplete="off">' +
        '<div class="nb-pick nb-scroll" id="nbLkL" style="max-height:52vh;margin-top:10px"><div class="nb-empty-s">두 글자 이상 적으면 찾습니다</div></div>' });
    var qT = null, found = [];
    md.box.querySelector('#nbLkQ').addEventListener('input', function (e) {
      clearTimeout(qT); var v = e.target.value.trim();
      if (v.length < 2) return;
      qT = setTimeout(function () {
        apiFetch('/api/search?limit=6&q=' + encodeURIComponent(v)).then(function (r) {
          found = [];
          var h = '';
          NBP_CATS.forEach(function (c) {
            var g = (r.data.groups || []).filter(function (x) { return x.key === c[0]; })[0];
            if (!g || !g.items.length) return;
            var items = g.items.filter(function (it) { return c[0] !== 'note' || (it.nav && it.nav.nbId); });
            if (!items.length) return;
            h += '<div class="nb-pick-g">' + c[1] + '</div>';
            items.forEach(function (it) {
              found.push({ t: c[0], id: c[0] === 'note' ? it.nav.nbId : it.id, title: it.title });
              h += '<button type="button" class="nb-pick-i" data-li="' + (found.length - 1) + '">' + _nbE(it.title || '') + (it.sub ? ' <small>' + _nbE(it.sub) + '</small>' : '') + '</button>';
            });
          });
          md.box.querySelector('#nbLkL').innerHTML = h || '<div class="nb-empty-s">찾는 것이 없습니다</div>';
        });
      }, 250);
    });
    md.box.addEventListener('click', function (e) {
      var x = e.target.closest('[data-li]'); if (!x) return;
      var f = found[+x.getAttribute('data-li')];
      md.close();
      var label = (s.value.slice(a, b) || (NBP_REF_ICON[f.t] + ' ' + f.title)).replace(/[[\]]/g, '');
      s.focus(); s.setSelectionRange(a, b);
      _nbInsert('[' + label + '](wm:' + f.t + ':' + f.id + ')');
    });
  }, 'nbLinkModal', { onOpen: function () { var i = document.getElementById('nbLkQ'); if (i) i.focus(); } });
}

/* ═══ [[ 자동 완성 ═══ */
function _nbWikiCheck() {
  var s = _nbSrc(); if (!s) return false;
  var v = s.value, a = s.selectionStart, ls = v.lastIndexOf('\n', a - 1) + 1, before = v.slice(ls, a);
  var m = /\[\[([^\]|\n]{0,40})$/.exec(before);
  if (!m) { _nbWikiClose(); return false; }
  var q = m[1].toLowerCase(), at = ls + before.lastIndexOf('[[');
  _nbpTitles().then(function (list) {
    var items = list.filter(function (x) { return (!NB.cur || x.id !== NB.cur.id) && (!q || x.title.toLowerCase().indexOf(q) >= 0); }).slice(0, 8);
    if (q && !items.some(function (x) { return x.title.toLowerCase() === q; })) items.push({ id: null, title: m[1], create: true });
    if (!items.length) { _nbWikiClose(); return; }
    NB.wiki = { at: at, items: items, i: 0 };
    var pop = document.getElementById('nbWiki');
    if (!pop) { pop = document.createElement('div'); pop.id = 'nbWiki'; pop.className = 'nb-pop nb-slash'; pop.setAttribute('role', 'listbox'); document.body.appendChild(pop);
      pop.addEventListener('mousedown', function (e) { var b = e.target.closest('[data-wi]'); if (b) { e.preventDefault(); NB.wiki.i = +b.getAttribute('data-wi'); _nbWikiRun(); } }); }
    pop.innerHTML = '<div class="nb-pop-t">📄 노트 잇기</div>' + items.map(function (x, i) { return '<div class="nb-pop-i' + (i === 0 ? ' on' : '') + '" data-wi="' + i + '" role="option">' + (x.create ? '＋ "' + _nbE(x.title) + '" 새 노트로' : _nbE(x.title)) + '</div>'; }).join('');
    var c = _nbCaretXY(s);
    pop.style.left = Math.min(window.innerWidth - 260, c.x) + 'px';
    pop.style.top = (c.y + 24 + 280 > window.innerHeight ? c.y - Math.min(280, items.length * 34 + 40) : c.y + 24) + 'px';
  });
  return true;
}
function _nbWikiKey(e) {
  var W = NB.wiki; if (!W) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); W.i = (W.i + (e.key === 'ArrowDown' ? 1 : -1) + W.items.length) % W.items.length; document.querySelectorAll('#nbWiki .nb-pop-i').forEach(function (el, i) { el.classList.toggle('on', i === W.i); }); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); _nbWikiRun(); return true; }
  if (e.key === 'Escape') { e.preventDefault(); _nbWikiClose(); return true; }
  return false;
}
function _nbWikiClose() { NB.wiki = null; var p = document.getElementById('nbWiki'); if (p) p.remove(); }
function _nbWikiRun() {
  var W = NB.wiki, it = W.items[W.i], s = _nbSrc();
  _nbWikiClose();
  var end = s.selectionStart, after = s.value.slice(end, end + 2);
  s.setSelectionRange(W.at, after === ']]' ? end + 2 : end);
  _nbInsert('[[' + it.title + ']]');
  if (it.create) _nbToast('📄 "' + it.title + '" — 누르면 새 노트가 만들어집니다');
}

/* ═══ 👥 공유 ═══ */
function nbpShare() {
  if (!NB.cur || _nbRO()) return;
  var id = NB.cur.id;
  return wmGuardedModal('nbShare', function () {
    return Promise.all([apiFetch('/api/chat/users'), apiFetch('/api/notebook/notes/' + encodeURIComponent(id) + '/shares')]).then(function (res) {
      var users = (res[0].data || []).filter(function (u) { return !u.me; }), sel = {};
      (res[1].data || []).forEach(function (u) { sel[u.id] = true; });
      var md = createModal({ id: 'nbShareModal', titleText: '👥 공유 — 읽기 전용', width: '480px', closeOnEsc: true,
        html: '<div class="nb-share-tip">고른 사람은 📓 노트북의 <b>👥 공유받은 노트</b>에서 읽을 수 있습니다 (고치기 · 손글씨는 안 됨). 새로 고른 사람에게는 메신저로 알려 줍니다.</div>' +
          '<input class="mw-input nb-in" id="nbShQ" placeholder="이름 · 부서로 찾기" autocomplete="off">' +
          '<div class="nb-share-l nb-scroll" id="nbShL"></div>' +
          '<label class="nb-fl" style="margin-top:10px">함께 보낼 말 (선택)<input class="mw-input nb-in" id="nbShM" maxlength="300" placeholder="예: 내일 회의 전에 봐 주세요"></label>' +
          '<div class="nb-mfoot"><span class="nb-sp" id="nbShN"></span><button class="nb-btn" data-x="cancel">취소</button><button class="nb-btn pri" data-x="ok">저장</button></div>' });
      function draw(q) {
        q = (q || '').toLowerCase();
        md.box.querySelector('#nbShL').innerHTML = users.filter(function (u) { return !q || (u.name + ' ' + u.dept).toLowerCase().indexOf(q) >= 0; }).map(function (u) {
          return '<label class="nb-share-i"><input type="checkbox" data-uid="' + _nbE(u.id) + '"' + (sel[u.id] ? ' checked' : '') + '><b>' + _nbE(u.name) + '</b><small>' + _nbE(u.dept || '') + '</small></label>';
        }).join('') || '<div class="nb-empty-s">없습니다</div>';
        md.box.querySelector('#nbShN').textContent = Object.keys(sel).length + '명 고름';
      }
      draw('');
      md.box.querySelector('#nbShQ').addEventListener('input', function (e) { draw(e.target.value); });
      md.box.addEventListener('change', function (e) { var c = e.target.closest('[data-uid]'); if (!c) return; if (c.checked) sel[c.getAttribute('data-uid')] = true; else delete sel[c.getAttribute('data-uid')]; md.box.querySelector('#nbShN').textContent = Object.keys(sel).length + '명 고름'; });
      md.box.addEventListener('click', function (e) {
        var x = e.target.closest('[data-x]'); if (!x) return;
        if (x.getAttribute('data-x') === 'cancel') return md.close();
        x.disabled = true;
        _nbFlush().then(function () {
          return apiFetch('/api/notebook/notes/' + encodeURIComponent(id) + '/shares', { method: 'PUT', body: JSON.stringify({ userIds: Object.keys(sel), message: md.box.querySelector('#nbShM').value }) });
        }).then(function (r) {
          md.close();
          if (NB.cur && NB.cur.id === id) { NB.cur.shareN = r.data.userIds.length; _nbDrawTopOnly(); }
          _nbToast(r.data.userIds.length ? '👥 ' + r.data.userIds.length + '명과 공유 중' + (r.data.added ? ' — 새로 ' + r.data.added + '명에게 메신저로 알렸습니다' : '') : '공유를 껐습니다');
        }).catch(function (e2) { x.disabled = false; _nbToast('❌ ' + _nbErr(e2), 'error'); });
      });
    });
  }, 'nbShareModal', { onOpen: function () { var i = document.getElementById('nbShQ'); if (i) i.focus(); } });
}

/* ═══ 📊 리포트 ═══ */
function _nbpRange(k) {
  var t = new Date(_nbToday() + 'T00:00:00Z'), dow = (t.getUTCDay() + 6) % 7;
  function f(d) { return d.toISOString().slice(0, 10); }
  function add(n) { var d = new Date(t); d.setUTCDate(d.getUTCDate() + n); return d; }
  if (k === 'today') return [f(t), f(t)];
  if (k === 'week') return [f(add(-dow)), f(add(6 - dow))];
  if (k === 'last') return [f(add(-dow - 7)), f(add(-dow - 1))];
  if (k === 'month') return [f(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))), f(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)))];
  return [f(add(-29)), f(t)];
}
function nbpReport() {
  return wmGuardedModal('nbReport', function () {
    var r0 = _nbpRange('week');
    var folders = (NB.meta && NB.meta.folders) || [], tags = (NB.meta && NB.meta.tags) || [];
    var md = createModal({ id: 'nbReportModal', titleText: '📊 리포트 — 노트를 모아 보고서로', width: '880px', closeOnEsc: true, boxStyle: 'padding:18px 20px',
      html: '<div class="nb-rep">' +
        '<div class="nb-rep-row"><span class="nb-rep-l">기간</span><div class="nb-seg" id="nbRpR">' + [['today', '오늘'], ['week', '이번 주'], ['last', '지난 주'], ['month', '이번 달'], ['30', '30일']].map(function (x) { return '<button data-rg="' + x[0] + '" class="' + (x[0] === 'week' ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>' +
          '<input type="date" class="mw-input" id="nbRpF" value="' + r0[0] + '"> ~ <input type="date" class="mw-input" id="nbRpT" value="' + r0[1] + '"></div>' +
        '<div class="nb-rep-row"><span class="nb-rep-l">범위</span><select class="mw-input" id="nbRpS"><option value="">📚 모든 노트</option>' +
          folders.map(function (f) { return '<option value="f:' + _nbE(f.id) + '"' + (NB.folder === f.id ? ' selected' : '') + '>📁 ' + _nbE(f.name) + '</option>'; }).join('') +
          tags.slice(0, 40).map(function (t) { return '<option value="t:' + _nbE(t.tag) + '"' + (NB.tag === t.tag ? ' selected' : '') + '>#' + _nbE(t.tag) + '</option>'; }).join('') + '</select>' +
          '<label class="nb-chkl"><input type="checkbox" id="nbRpD" checked> 📅 일일 노트</label><label class="nb-chkl"><input type="checkbox" id="nbRpI"> 📥 낙서장</label></div>' +
        '<div class="nb-rep-row"><span class="nb-rep-l">방식</span><div class="nb-seg" id="nbRpM">' + [['raw', '📚 그대로 모으기'], ['weekly', '✨ 주간 업무 보고 형식'], ['summary', '✨ 요약 보고서']].map(function (x, i) { return '<button data-st="' + x[0] + '" class="' + (i === 0 ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="nb-ai-go"><button class="nb-btn pri" data-x="run">📊 만들기</button><span class="nb-ai-st" id="nbRpSt"></span></div>' +
        '<div class="nb-ai-out hidden" id="nbRpOut"><input class="mw-input nb-in" id="nbRpTitle"><div class="nb-seg nb-ai-v"><button class="on" data-v="prev">미리보기</button><button data-v="edit">고치기</button></div>' +
          '<article class="nb-doc nb-ai-prev nb-scroll" id="nbRpPrev"></article><textarea class="nb-ai-ta hidden" id="nbRpTa"></textarea>' +
          '<div class="nb-ai-act"><button class="nb-btn" data-x="new">📓 새 노트로</button><button class="nb-btn" data-x="weekly" id="nbRpWk">📝 주간 업무 작성에 넣기</button><button class="nb-btn" data-x="copy">📋 서식째 복사</button></div></div>' +
        '</div>' });
    var style = 'raw';
    function q(id) { return md.box.querySelector('#' + id); }
    function txt() { return q('nbRpTa').value; }
    function prev() { var t = txt(); q('nbRpPrev').innerHTML = style === 'weekly' ? '<pre class="nb-rep-pre">' + _nbE(t) + '</pre>' : NbMd.render(t).html; }
    md.box.addEventListener('click', function (e) {
      var x = e.target.closest('[data-rg]');
      if (x) { var r = _nbpRange(x.getAttribute('data-rg')); q('nbRpF').value = r[0]; q('nbRpT').value = r[1]; md.box.querySelectorAll('[data-rg]').forEach(function (b) { b.classList.toggle('on', b === x); }); return; }
      x = e.target.closest('[data-st]');
      if (x) { style = x.getAttribute('data-st'); md.box.querySelectorAll('[data-st]').forEach(function (b) { b.classList.toggle('on', b === x); }); return; }
      x = e.target.closest('[data-v]');
      if (x) { var ed = x.getAttribute('data-v') === 'edit'; md.box.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b === x); }); q('nbRpTa').classList.toggle('hidden', !ed); q('nbRpPrev').classList.toggle('hidden', ed); if (!ed) prev(); return; }
      x = e.target.closest('[data-x]'); if (!x) return;
      var act = x.getAttribute('data-x');
      if (act === 'run') {
        var sc = q('nbRpS').value;
        x.disabled = true; q('nbRpSt').innerHTML = '<span class="nb-spin"></span> ' + (style === 'raw' ? '모으는 중…' : 'AI 가 쓰는 중… (10~40초)');
        _nbFlush().then(function () {
          return apiFetch('/api/notebook/report', { method: 'POST', timeoutMs: 120000, body: JSON.stringify({ from: q('nbRpF').value, to: q('nbRpT').value, style: style,
            folderId: sc.indexOf('f:') === 0 ? sc.slice(2) : null, tag: sc.indexOf('t:') === 0 ? sc.slice(2) : null, daily: q('nbRpD').checked, inbox: q('nbRpI').checked }) });
        }).then(function (r) {
          x.disabled = false; q('nbRpSt').textContent = '✓ 노트 ' + r.data.count + '개' + (r.data.provider ? ' · ' + r.data.provider : '');
          q('nbRpOut').classList.remove('hidden'); q('nbRpTitle').value = r.data.title; q('nbRpTa').value = r.data.body;
          q('nbRpWk').classList.toggle('hidden', style !== 'weekly'); prev();
        }).catch(function (e2) { x.disabled = false; q('nbRpSt').textContent = '❌ ' + _nbErr(e2); });
        return;
      }
      if (act === 'new') { md.close(); nbNewFrom(style === 'weekly' ? '```\n' + txt() + '\n```' : txt(), q('nbRpTitle').value, { tags: ['리포트'] }); }
      else if (act === 'copy') _nbCopyRich(style === 'weekly' ? txt().replace(/\n/g, '  \n') : txt(), q('nbRpTitle').value);
      else if (act === 'weekly') {
        if (typeof window.wrAuthorInsert !== 'function') { _nbToast('주간 업무 화면을 열 수 없습니다 (권한)', 'warn'); return; }
        md.close(); _nbFlush(); window.wrAuthorInsert(txt());
        _nbToast('📝 주간 업무 작성 — 금주 칸 커서 자리에 넣었습니다. 확인 후 저장하세요');
      }
    });
  }, 'nbReportModal');
}

/* ═══ ✍️ 글쓰기 코치 ═══ */
function nbpCoachToggle(on) {
  NBP.coach = on == null ? !NBP.coach : !!on;
  _nbLS('coach', NBP.coach);
  var m = document.getElementById('nbMain'); if (m) m.classList.toggle('coach-on', NBP.coach);
  var b = document.querySelector('[data-nb="coach"]'); if (b) { b.classList.toggle('on', NBP.coach); b.setAttribute('aria-pressed', NBP.coach); }
  if (NBP.coach) { NBP.ai = null; NBP.open = {}; _nbpCoachRun(true); } else { var c = document.getElementById('nbCoach'); if (c) c.remove(); }
}
function _nbpCoachEnsure() {
  var m = document.getElementById('nbMain'); if (!m) return null;
  var c = document.getElementById('nbCoach');
  if (!c) { c = document.createElement('aside'); c.id = 'nbCoach'; c.className = 'nb-coach nb-scroll'; c.setAttribute('aria-label', '글쓰기 코치'); m.appendChild(c); }
  m.classList.add('coach-on');
  return c;
}
var _nbpCoachT = null;
function _nbCoachSchedule() { if (!NBP.coach) return; clearTimeout(_nbpCoachT); _nbpCoachT = setTimeout(function () { _nbpCoachRun(); }, 700); }
/** 데이터와 다른 곳 — 연결한 프로젝트 · 마일스톤 진척, 이슈 상태 */
function _nbpDataFindings(text) {
  var out = [], pos = 0;
  text.split('\n').forEach(function (l, i) {
    var st = pos; pos += l.length + 1;
    var pm = /(\d{1,3})\s?%/.exec(l);
    var re = /\(wm:(project|milestone|issue):([A-Za-z0-9_.:-]+)\)/g, m;
    while ((m = re.exec(l))) {
      var c = NBP.refs[m[1] + ':' + m[2]]; if (!c || !c.v || c.v.locked || c.v.missing) continue;
      if ((m[1] === 'project' || m[1] === 'milestone') && pm && c.v.progress != null && Math.abs(+pm[1] - c.v.progress) >= 15) {
        out.push({ k: 'data', line: i, start: st + pm.index, end: st + pm.index + pm[0].length, quote: pm[0], msg: '적은 진척 ' + pm[1] + '% · 실제 ' + (m[1] === 'project' ? '프로젝트' : '마일스톤') + ' ' + c.v.progress + '%',
          why: '보고와 시스템 숫자가 다르면 읽는 사람이 어느 쪽을 믿어야 할지 모릅니다.', hint: '시스템 진척을 고치거나, 다른 이유가 있으면 한 줄로 설명하기', ex: '"' + c.v.progress + '% (시스템 기준)"' });
      }
      if (m[1] === 'issue' && /해결|완료|조치 ?끝|마무리/.test(l) && !c.v.done) {
        out.push({ k: 'data', line: i, start: st + m.index, end: st + m.index + m[0].length, quote: '', msg: '해결했다고 썼지만 이슈는 아직 ' + _nbpRefText('issue', c.v),
          why: '이슈 상태가 그대로면 다른 사람에게는 아직 열린 일로 보입니다.', hint: '이슈 칩을 눌러 상태를 해결로 바꾸기', ex: '' });
      }
    }
  });
  return out;
}
function _nbpCoachRun(force) {
  if (!NBP.coach) return;
  var c = _nbpCoachEnsure(); if (!c) return;
  var doc = _nbDoc(), s = _nbSrc();
  if (!doc || !s) { c.innerHTML = '<div class="nb-empty">✍️ 노트를 열면 코치가 봐 드립니다</div>'; return; }
  var text = s.value, kind = NBP.kindOver || NbCoach.detectKind({ title: doc.title, tags: doc.tags || [] });
  var r = NbCoach.check(text, { kind: kind, title: doc.title, tags: doc.tags });
  r.findings = r.findings.concat(_nbpDataFindings(text));
  r.counts.data = r.findings.filter(function (f) { return f.k === 'data'; }).length || undefined;
  NBP.last = r;
  if (NBP.coachTab === 'stats') { if (force) _nbpStats(c); return; }
  _nbpCoachDraw(c, r);
  // 기록 — 코치를 켜고 쓴 노트만 · 처음은 곧, 그다음은 20초에 한 번 (보낼 때 가장 새 결과로)
  if (NB.cur && !NB.cur.readOnly && r.chars >= 30 && !NBP.logT) NBP.logT = setTimeout(_nbpCoachLog, NBP.lastLog ? 20000 : 1500);
}
function _nbpCoachLog() {
  NBP.logT = null;
  var r = NBP.last; if (!r || !NB.cur || NB.cur.readOnly || r.chars < 30) return;
  var cnt = {}; Object.keys(r.counts).forEach(function (k) { if (r.counts[k]) cnt[k] = r.counts[k]; });
  var sig = NB.cur.id + JSON.stringify(cnt) + r.scores.total;
  if (sig === NBP.lastLog) return;
  NBP.lastLog = sig;
  apiFetch('/api/notebook/coach/log', { method: 'POST', body: JSON.stringify({ noteId: NB.cur.id, kind: r.kind, counts: cnt, scores: r.scores, chars: r.chars }) }).catch(function () {});
}
function _nbpScoreBar(label, v, ai) {
  var cls = v >= 80 ? 'g' : v >= 60 ? 'm' : 'b';
  return '<div class="nb-cs-row"><span>' + label + '</span><div class="nb-cs-bar"><i class="' + cls + '" style="width:' + v + '%"></i></div><b>' + v + '</b>' + (ai != null ? '<small title="AI 점수">✨' + ai + '</small>' : '') + '</div>';
}
function _nbpCoachDraw(c, r) {
  var A = NBP.ai, filt = NBP.filter || '';
  var st = c.scrollTop;
  var h = '<div class="nb-coach-h"><b>✍️ 글쓰기 코치</b><div class="nb-seg"><button class="on" data-cz="now">이 글</button><button data-cz="stats">📈 나의 글쓰기</button></div><button class="nb-ib" data-cz="close" title="코치 닫기">✕</button></div>';
  h += '<div class="nb-coach-kind">글 종류 <select id="nbCKind">' + Object.keys(NbCoach.KINDS).map(function (k) { return '<option value="' + k + '"' + (k === r.kind ? ' selected' : '') + '>' + NbCoach.KINDS[k] + '</option>'; }).join('') + '</select><span class="nb-sp"></span><small>' + r.chars.toLocaleString() + '자</small></div>';
  var tot = r.scores.total, ring = Math.round(tot * 1.13);
  h += '<div class="nb-cs"><div class="nb-cs-ring" style="--p:' + tot + '"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18"/><circle cx="22" cy="22" r="18" class="v" style="stroke-dasharray:' + ring + ' 113"/></svg><b>' + tot + '</b><small>점</small></div><div class="nb-cs-bars">' +
    _nbpScoreBar('명확성', r.scores.clarity, A && A.scores.clarity) + _nbpScoreBar('간결성', r.scores.concise, A && A.scores.concise) + _nbpScoreBar('구조', r.scores.structure, A && A.scores.structure) + _nbpScoreBar('근거', r.scores.evidence, A && A.scores.evidence) + '</div></div>';
  if (r.outline) h += '<div class="nb-co-ol"><div class="nb-co-st">🧩 ' + NbCoach.KINDS[r.kind] + ' 뼈대</div>' + r.outline.map(function (o) { return '<span class="' + (o.ok ? 'ok' : 'no') + '">' + (o.ok ? '✓' : '○') + ' ' + _nbE(o.label) + '</span>'; }).join('') + '</div>';
  // 버릇 칩 (거르기)
  var ks = Object.keys(r.counts).filter(function (k) { return r.counts[k]; });
  if (ks.length) h += '<div class="nb-co-chips"><button class="' + (!filt ? 'on' : '') + '" data-cf="">모두 ' + r.findings.length + '</button>' + ks.map(function (k) { var L = NbCoach.LABELS[k] || ['•', k]; return '<button class="' + (filt === k ? 'on' : '') + '" data-cf="' + k + '">' + L[0] + ' ' + L[1] + ' ' + r.counts[k] + '</button>'; }).join('') + '</div>';
  var list = r.findings.filter(function (f) { return !filt || f.k === filt; });
  if (!r.findings.length) h += '<div class="nb-co-good">👏 규칙으로 찾은 것은 없습니다' + (r.chars < 30 ? ' — 조금 더 써 보세요' : '. ✨ AI 코치로 한 번 더 볼까요?') + '</div>';
  h += '<div class="nb-co-list">' + list.slice(0, 40).map(function (f) {
    var key = f.k + ':' + f.start + ':' + f.msg, o = NBP.open[key] || 0, L = NbCoach.LABELS[f.k] || ['•', f.k];
    return '<div class="nb-co-i nb-co-' + f.k + '" data-ck="' + _nbE(key) + '"><div class="nb-co-m"><span class="nb-co-tag">' + L[0] + ' ' + L[1] + '</span>' + _nbE(f.msg) + '</div>' +
      (f.quote ? '<button class="nb-co-q" data-cgo="' + f.start + ':' + f.end + '" title="이 자리로">“' + _nbE(f.quote) + (f.end - f.start > 60 ? '…' : '') + '”</button>' : '') +
      (o >= 1 ? '<div class="nb-co-why">💭 ' + _nbE(f.why) + '</div>' : '') + (o >= 2 ? '<div class="nb-co-hint">💡 ' + _nbE(f.hint) + '</div>' : '') + (o >= 3 && f.ex ? '<div class="nb-co-ex">✍️ 예: ' + _nbE(f.ex) + '</div>' : '') +
      '<div class="nb-co-a">' + (o < 1 ? '<button data-cstep="1">왜?</button>' : o < 2 ? '<button data-cstep="2">힌트</button>' : o < 3 && f.ex ? '<button data-cstep="3">예시 보기</button>' : '') + '</div></div>';
  }).join('') + (list.length > 40 ? '<div class="nb-empty-s">… ' + (list.length - 40) + '개 더 — 위 버릇 칩으로 거르세요</div>' : '') + '</div>';
  h += _nbpSpellHtml();
  // ✨ AI 코치
  h += '<div class="nb-co-ai"><div class="nb-co-st">✨ AI 코치</div>';
  if (!A) h += '<p class="nb-co-desc">규칙으로 못 찾는 흐름 · 논리 · 빠진 근거를 봅니다. 고쳐 주지 않고 짚어 주니 직접 고쳐 보세요.</p><button class="nb-btn pri" data-cai="1"' + (_nbRO() ? ' disabled' : '') + '>✨ AI 코치 받기</button><span class="nb-ai-st" id="nbCoSt"></span>';
  else {
    h += '<div class="nb-co-sum">' + _nbE(A.summary) + '</div>';
    h += A.items.map(function (it, i) {
      var key = 'ai:' + i, o = NBP.open[key] || 0;
      return '<div class="nb-co-i nb-co-aiitem" data-ck="' + key + '"><div class="nb-co-m"><span class="nb-co-tag">✨</span>' + _nbE(it.issue) + '</div>' +
        (it.quote ? '<button class="nb-co-q" data-cquote="' + i + '"' + (it.found ? '' : ' disabled title="원문에서 찾지 못함"') + '>“' + _nbE(it.quote) + '”</button>' : '') +
        (o >= 1 ? '<div class="nb-co-why">💭 ' + _nbE(it.why) + '</div>' : '') + (o >= 2 ? '<div class="nb-co-hint">💡 ' + _nbE(it.hint) + '</div>' : '') + (o >= 3 ? '<div class="nb-co-ex">✍️ 예: ' + _nbE(it.example) + '</div>' : '') +
        '<div class="nb-co-a">' + (o < 1 ? '<button data-cstep="1">왜?</button>' : o < 2 ? '<button data-cstep="2">힌트</button>' : o < 3 ? '<button data-cstep="3">예시 보기</button>' : (it.found && it.example && !_nbRO() ? '<button data-capply="' + i + '">예시로 바꾸기</button>' : '')) + '</div></div>';
    }).join('');
    if (A.task) h += '<div class="nb-co-task">🎯 <b>이번 주 연습</b> ' + _nbE(A.task) + '</div>';
    h += '<button class="nb-btn sm" data-cai="1">✨ 다시 보기</button><span class="nb-ai-st" id="nbCoSt"></span>';
  }
  h += '</div>';
  c.innerHTML = h;
  c.scrollTop = st;
}
function _nbpCoachClick(e) {
  var t = e.target, x, c = document.getElementById('nbCoach');
  if ((x = t.closest('[data-cz]'))) {
    var z = x.getAttribute('data-cz');
    if (z === 'close') return nbpCoachToggle(false);
    NBP.coachTab = z;
    if (z === 'stats') _nbpStats(c); else _nbpCoachRun();
    return;
  }
  if ((x = t.closest('[data-csp]'))) { _nbpSpellAct(x.getAttribute('data-csp')); return; }
  if ((x = t.closest('[data-cf]'))) { NBP.filter = x.getAttribute('data-cf'); _nbpCoachRun(); return; }
  if ((x = t.closest('[data-cstep]'))) { var it = x.closest('[data-ck]'); NBP.open[it.getAttribute('data-ck')] = +x.getAttribute('data-cstep'); _nbpCoachRun(); return; }
  if ((x = t.closest('[data-cgo]'))) { var p = x.getAttribute('data-cgo').split(':'); _nbpSelect(+p[0], +p[1]); return; }
  if ((x = t.closest('[data-cquote]'))) { var q = NBP.ai.items[+x.getAttribute('data-cquote')].quote, at = _nbSrc().value.indexOf(q); if (at >= 0) _nbpSelect(at, at + q.length); return; }
  if ((x = t.closest('[data-capply]'))) {
    var ai = NBP.ai.items[+x.getAttribute('data-capply')], s = _nbSrc(), at2 = s.value.indexOf(ai.quote);
    if (at2 < 0) { _nbToast('원문이 바뀌어 그 자리를 찾지 못했습니다', 'warn'); return; }
    if (NB.mode === 'view') _nbSetMode('split');
    s.focus(); s.setSelectionRange(at2, at2 + ai.quote.length); _nbInsert(ai.example);
    ai.found = false; _nbToast('✍️ 바꿨습니다 — Ctrl+Z 로 되돌릴 수 있습니다'); _nbpCoachRun();
    return;
  }
  if ((x = t.closest('[data-cai]'))) {
    var s2 = _nbSrc(), r = NBP.last, st = document.getElementById('nbCoSt');
    x.disabled = true; if (st) st.innerHTML = '<span class="nb-spin"></span> AI 가 읽는 중…';
    apiFetch('/api/notebook/coach', { method: 'POST', timeoutMs: 120000, body: JSON.stringify({ text: ((_nbDoc().title ? '# ' + _nbDoc().title + '\n' : '') + s2.value), kind: r.kind, noteId: NB.cur ? NB.cur.id : null,
      rules: r.findings.slice(0, 12).map(function (f) { return (NbCoach.LABELS[f.k] || [''])[1] + ': ' + f.msg; }) }) }).then(function (res) {
      NBP.ai = res.data; NBP.open = {}; _nbpCoachRun();
    }).catch(function (e2) { x.disabled = false; if (st) st.textContent = '❌ ' + _nbErr(e2); });
  }
}
function _nbpSelect(a, b) {
  var s = _nbSrc(); if (!s) return;
  if (NB.mode === 'view') _nbSetMode('split');
  s.focus(); s.setSelectionRange(a, b);
  var lh = parseFloat(getComputedStyle(s).lineHeight) || 24, line = s.value.slice(0, a).split('\n').length - 1;
  s.scrollTop = Math.max(0, line * lh - s.clientHeight / 3);
  var q = s.value.slice(a, Math.min(b, a + 24)).replace(/[*_=~`#>[\]()]/g, '').trim();
  if (q.length >= 2) { _nbRenderPrev(); _nbFindInDoc(q); }
}
/* 📈 나의 글쓰기 */
function _nbpStats(c) {
  c = c || _nbpCoachEnsure(); if (!c) return;
  c.innerHTML = '<div class="nb-coach-h"><b>✍️ 글쓰기 코치</b><div class="nb-seg"><button data-cz="now">이 글</button><button class="on" data-cz="stats">📈 나의 글쓰기</button></div><button class="nb-ib" data-cz="close" title="코치 닫기">✕</button></div><div class="nb-empty"><span class="nb-spin"></span></div>';
  apiFetch('/api/notebook/coach/stats').then(function (r) {
    var d = r.data, W = d.weeks || [];
    var h = c.innerHTML.replace(/<div class="nb-empty">[\s\S]*$/, '');
    if (!W.length) { c.innerHTML = h + '<div class="nb-empty">📈 아직 기록이 없습니다<small>코치를 켠 채 노트를 쓰면 주마다 점수 · 버릇이 쌓입니다</small></div>'; return; }
    var cur = W[W.length - 1], prevW = W.length > 1 ? W[W.length - 2] : null;
    var pts = W.filter(function (w) { return w.total != null; });
    var sv = '';
    if (pts.length) {
      var w0 = 280, h0 = 70, xs = function (i) { return pts.length === 1 ? w0 / 2 : 10 + i * (w0 - 20) / (pts.length - 1); }, ys = function (v) { return h0 - 8 - (v - 20) * (h0 - 16) / 80; };
      sv = '<svg class="nb-st-line" viewBox="0 0 ' + w0 + ' ' + h0 + '" role="img" aria-label="주별 글쓰기 점수"><line x1="0" x2="' + w0 + '" y1="' + ys(80) + '" y2="' + ys(80) + '" class="g80"/>' +
        '<polyline points="' + pts.map(function (p, i) { return xs(i) + ',' + ys(p.total); }).join(' ') + '"/>' +
        pts.map(function (p, i) { return '<circle cx="' + xs(i) + '" cy="' + ys(p.total) + '" r="3.5"><title>' + p.wk + ' 주 — ' + p.total + '점 · 노트 ' + p.n + '</title></circle>'; }).join('') + '</svg>' +
        '<div class="nb-st-x"><span>' + pts[0].wk.slice(5).replace('-', '/') + '</span><span>이번 주</span></div>';
    }
    var diff = prevW && prevW.total != null && cur.total != null ? cur.total - prevW.total : null;
    h += '<div class="nb-st-top"><div><small>이번 주 점수</small><b>' + (cur.total != null ? cur.total : '—') + '</b>' + (diff != null ? '<em class="' + (diff >= 0 ? 'up' : 'dn') + '">' + (diff >= 0 ? '▲' : '▼') + Math.abs(diff) + '</em>' : '') + '</div>' +
      '<div><small>점검한 글</small><b>' + cur.n + '</b></div><div><small>쓴 글자</small><b>' + (cur.chars || 0).toLocaleString() + '</b></div></div>';
    h += '<div class="nb-co-st">주별 점수 (최근 8주)</div>' + sv;
    if (cur.total != null) h += '<div class="nb-cs-bars" style="margin-top:8px">' + _nbpScoreBar('명확성', cur.clarity || 0) + _nbpScoreBar('간결성', cur.concise || 0) + _nbpScoreBar('구조', cur.structure || 0) + _nbpScoreBar('근거', cur.evidence || 0) + '</div>';
    var hb = (d.habits || []).filter(function (x) { return x.now || x.prev; });
    if (hb.length) {
      h += '<div class="nb-co-st">나의 버릇 — 이번 주 · 지난 주</div><table class="nb-st-hb"><tbody>' + hb.map(function (x) {
        var L = NbCoach.LABELS[x.k] || ['•', x.k], dd = prevW ? x.now - x.prev : 0;   // 지난 주 기록이 없으면 비교하지 않음
        return '<tr><td>' + L[0] + ' ' + L[1] + '</td><td class="n">' + x.now + '</td><td class="n p">' + x.prev + '</td><td class="' + (dd > 0 ? 'dn' : dd < 0 ? 'up' : '') + '">' + (dd > 0 ? '▲' + dd : dd < 0 ? '▼' + (-dd) : '—') + '</td></tr>';
      }).join('') + '</tbody></table><div class="nb-st-note">▼ 줄어들면 좋아지는 중</div>';
    }
    var task = d.task && (new Date(_nbToday()) - new Date(d.task.day)) / 86400000 <= 7 ? d.task.text : hb.length ? NbCoach.taskFor(hb[0].k) : NbCoach.taskFor('head');
    h += '<div class="nb-co-task">🎯 <b>이번 주 연습</b> ' + _nbE(task) + '</div>';
    c.innerHTML = h;
  }).catch(function (e) { c.innerHTML += '<div class="nb-empty">❌ ' + _nbE(_nbErr(e)) + '</div>'; });
}
document.addEventListener('change', function (e) {
  if (e.target && e.target.id === 'nbCKind') { NBP.kindOver = e.target.value; NBP.ai = null; _nbpCoachRun(); }
});

/* ═══ ✍️ 글쓰기 시작 (v13.322) — 어디서든 Alt+W · 글 종류 하나 고르면 양식 + 코치 켜진 채로 바로 쓰기 ═══
   예전: 📓 → 노트 고르기 / 새 노트 ▾ 양식 → ✍️ 코치 누르기 (세 단계) */
var NBP_WRITE = [
  ['meeting', '🤝', '회의록', '일시 · 참석 · 안건 · 결정 · 할 일'],
  ['daily', '📋', '업무 일지', '오늘 일정 · 할 일로 채워 시작'],
  ['review', '🔍', '기술 검토', '배경 · 요구 · 검토 안 · 결론'],
  ['trip', '✈️', '출장 보고', '개요 · 결과 · 후속 조치'],
  ['why', '🧩', '문제 분석', '현상 · 5 Why · 대책'],
  ['mail', '✉️', '업무 메일', '용건 · 전할 내용 · 요청'],
  ['blank', '📄', '자유 글', '빈 종이에서 시작']
];
function nbWriteStart() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  var coachOn = _nbLS('writeCoach'); coachOn = coachOn == null ? true : !!coachOn;
  return wmGuardedModal('nbWrite', function () {
    var src = NB.list && NB.list.length && NB.view !== 'trash' && NB.view !== 'shared' ? Promise.resolve(NB.list) : apiFetch('/api/notebook/notes?view=all&sort=updated').then(function (r) { return r.data || []; }).catch(function () { return []; });
    return src.then(function (list) { _nbpWriteModal(coachOn, list.filter(function (n) { return !n.deletedAt && !n.readOnly && !n.ownerName; }).slice(0, 3)); });
  }, 'nbWriteModal', { onOpen: function () { var b = document.querySelector('#nbWriteModal .nbw-c'); if (b) b.focus(); } });
}
function _nbpWriteModal(coachOn, recent) {
  var md = createModal({ id: 'nbWriteModal', titleText: '✍️ 무엇을 쓸까요?', width: '560px', closeOnEsc: true,
    html: '<div class="nbw-g">' + NBP_WRITE.map(function (w) {
        return '<button class="nbw-c" data-w="' + w[0] + '"><span class="nbw-i">' + w[1] + '</span><b>' + _nbE(w[2]) + '</b><small>' + _nbE(w[3]) + '</small></button>';
      }).join('') + '</div>' +
      (recent.length ? '<div class="nbw-st">이어 쓰기</div><div class="nbw-r">' + recent.map(function (n) {
        return '<button class="nbw-ri" data-wn="' + _nbE(n.id) + '"><span>📝</span><b>' + _nbE(_nbTitleOf(n)) + '</b><small>' + _nbE(_nbWhen(n.updatedAt)) + '</small></button>';
      }).join('') + '</div>' : '') +
      '<div class="nbw-f"><label class="nbpr-ck"><input type="checkbox" id="nbwCoach"' + (coachOn ? ' checked' : '') + '> ✍️ 글쓰기 코치 켜고 쓰기 <small>(고칠 곳을 이유 · 힌트 · 예시로)</small></label><span class="nb-sp"></span><small class="nbw-k">어디서든 <kbd>Alt+W</kbd></small></div>' });
  md.box.addEventListener('click', function (e) {
    var x = e.target.closest('[data-w],[data-wn]'); if (!x) return;
    var on = md.box.querySelector('#nbwCoach').checked;
    _nbLS('writeCoach', on);
    md.close();
    var p = x.hasAttribute('data-w') ? nbNewFromTemplate(x.getAttribute('data-w')) : _nbpOpenAnywhere(x.getAttribute('data-wn'));
    Promise.resolve(p).then(function () { if (on !== !!NBP.coach) nbpCoachToggle(on); else if (on) _nbpCoachRun(true); });
  });
}
/** 다른 화면에 있어도 노트 열기 */
function _nbpOpenAnywhere(id) {
  nbOpenNote(id);
  return new Promise(function (res) { var n = 0; (function wait() { if ((NB.cur && NB.cur.id === id && document.getElementById('nbSrc')) || ++n > 50) return res(); setTimeout(wait, 100); })(); });
}
document.addEventListener('keydown', function (e) {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'w' || e.key === 'W' || e.code === 'KeyW') && !(typeof nbAltTyping === 'function' && nbAltTyping(e))) {
    if (typeof currentUser === 'undefined' || !currentUser || document.getElementById('nbWriteModal')) return;
    e.preventDefault(); nbWriteStart();
  }
});

/* ═══ 🔤 AI 맞춤법 · 띄어쓰기 (v13.323) — 코치 칸 안 · ⋯ 메뉴 · 틀린 곳 → 바른 말 · 규칙 한 줄 · 하나씩 / 모두 고치기 (Ctrl+Z 로 되돌림) ═══
   NBP.sp = { loading, err, items:[{wrong, right, type, why, done:false|true|'skip'}], cut } — 노트를 바꾸면 비움 */
var NBP_SP_LABEL = { spell: '✏️ 맞춤법', space: '␣ 띄어쓰기', grammar: '📐 문법' };
function nbpSpellCheck() {
  if (!NB.cur || _nbRO()) { _nbToast('고칠 수 있는 노트를 먼저 여세요', 'warn'); return; }
  NBP.coachTab = 'now';
  if (!NBP.coach) nbpCoachToggle(true);
  _nbpSpellAct('run');
  var c = document.getElementById('nbCoach'), box = c && c.querySelector('.nb-sp-box');
  if (box && box.scrollIntoView) box.scrollIntoView({ block: 'start' });
}
/** 바뀐 곳만 표시 — 앞뒤 같은 글자는 그대로, 빠지는 것은 줄 긋고 들어가는 것은 칠함 (띄어쓰기는 ␣) */
function _nbpSpDiff(a, b) {
  // 글자 단위 가장 긴 공통 부분(LCS) — "설치 하는것 → 설치하는 것" 을 설치[␣]하는[+␣]것 처럼 최소로
  var n = a.length, m = b.length, L = [], i, j;
  for (i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
  for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  var ops = [], push = function (k, ch) { var t = ops[ops.length - 1]; if (t && t.k === k) t.s += ch; else ops.push({ k: k, s: ch }); };
  i = 0; j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { push('=', a[i]); i++; j++; }
    // 같으면: 띄어쓰기를 빼거나 넣는 쪽 먼저 (다음[+␣]주[-␣]에), 아니면 빠지는 것 먼저 ("몇일 → 며칠")
    else if (i < n && (j >= m || L[i + 1][j] > L[i][j + 1] || (L[i + 1][j] === L[i][j + 1] && (a[i] === ' ' || b[j] !== ' ')))) { push('-', a[i]); i++; }
    else { push('+', b[j]); j++; }
  }
  var v = function (x) { return _nbE(x).replace(/ /g, '<i class="nb-sp-sp">␣</i>'); };
  return ops.map(function (o) { return o.k === '=' ? _nbE(o.s) : o.k === '-' ? '<del>' + v(o.s) + '</del>' : '<ins>' + v(o.s) + '</ins>'; }).join('');
}
function _nbpSpellHtml() {
  var S = NBP.sp, src = (_nbSrc() || {}).value || '', ro = _nbRO();
  var h = '<div class="nb-sp-box"><div class="nb-co-st">🔤 맞춤법 · 띄어쓰기 <small>AI</small></div>';
  if (!S || S.loading || S.err) {
    return h + (S && S.loading ? '' : '<p class="nb-co-desc">틀린 글자 · 띄어쓰기 · 조사를 찾아 바른 말과 규칙을 알려 줍니다. 하나씩 보고 고치거나 한 번에 고치기.</p>') +
      '<button class="nb-btn pri" data-csp="run"' + (ro || (S && S.loading) ? ' disabled' : '') + '>' + (S && S.loading ? '<span class="nb-spin"></span> 검사하는 중…' : '🔤 맞춤법 검사') + '</button>' +
      (S && S.err ? '<span class="nb-ai-st">❌ ' + _nbE(S.err) + '</span>' : '') + '</div>';
  }
  _nbpSpSync(src);
  var live = [], done = 0;
  S.items.forEach(function (it, i) { if (it.done === true) done++; else if (!it.done && src.indexOf(it.wrong) >= 0) live.push(i); });
  if (!S.items.length) h += '<div class="nb-co-good">👏 틀린 곳을 찾지 못했습니다</div>';
  else h += '<div class="nb-sp-sum"><span><b>' + live.length + '</b>곳 남음' + (done ? ' · 고침 ' + done : '') + '</span><span class="nb-sp"></span>' +
    (live.length > 1 && !ro ? '<button class="nb-btn sm pri" data-csp="all">모두 고치기 ' + live.length + '</button>' : '') + '</div>';
  h += '<div class="nb-sp-list">' + S.items.map(function (it, i) {
    var gone = !it.done && src.indexOf(it.wrong) < 0, st = it.done === true ? ' done' : it.done || gone ? ' off' : '';
    return '<div class="nb-sp-i t-' + it.type + st + '"><div class="nb-sp-top"><span class="nb-co-tag">' + (NBP_SP_LABEL[it.type] || '✏️') + '</span>' +
      '<button class="nb-sp-d" data-csp="go:' + i + '"' + (gone || it.done === true ? ' disabled' : '') + ' title="이 자리로">' + _nbpSpDiff(it.wrong, it.right) + '</button></div>' +
      (it.why ? '<div class="nb-sp-why">' + _nbE(it.why) + '</div>' : '') +
      '<div class="nb-co-a">' + (it.done === true ? '<span class="nb-sp-st">✓ 고침</span>' : it.done ? '<span class="nb-sp-st">무시함</span>' : gone ? '<span class="nb-sp-st">글이 바뀜</span>' :
        (ro ? '' : '<button data-csp="fix:' + i + '">고치기</button><button data-csp="skip:' + i + '">무시</button>')) + '</div></div>';
  }).join('') + '</div>' +
    '<div class="nb-sp-foot"><button class="nb-btn sm" data-csp="run"' + (ro ? ' disabled' : '') + '>🔤 다시 검사</button>' +
    (S.cut ? '<small>앞 8,000자까지만 봤습니다</small>' : '') + (S.provider ? '<small>' + _nbE(S.provider) + '</small>' : '') + '</div></div>';
  return h;
}
/** 고친 곳을 Ctrl+Z 로 되돌려 틀린 말이 다시 있으면 다시 남은 곳으로 */
function _nbpSpSync(src) { (NBP.sp && NBP.sp.items || []).forEach(function (it) { if (it.done === true && src.indexOf(it.wrong) >= 0) it.done = false; }); }
/** 한 곳 고치기 — 지금 글에서 다시 찾아 바꿈. 성공 여부 */
function _nbpSpFix(it) {
  var s = _nbSrc(), at = s ? s.value.indexOf(it.wrong) : -1;
  if (at < 0) return false;
  s.focus(); s.setSelectionRange(at, at + it.wrong.length);
  _nbInsert(it.right);
  it.done = true;
  return true;
}
function _nbpSpellAct(a) {
  var S = NBP.sp, p = a.split(':'), it = S && S.items && S.items[+p[1]];
  if (p[0] === 'run') {
    var s = _nbSrc(); if (!s || _nbRO()) return;
    if (!s.value.replace(/\s/g, '')) { _nbToast('검사할 글이 없습니다', 'warn'); return; }
    var seq = (NBP.spSeq = (NBP.spSeq || 0) + 1), nid = NB.cur && NB.cur.id;
    NBP.sp = { loading: true }; _nbpCoachRun();
    apiFetch('/api/notebook/spell', { method: 'POST', timeoutMs: 120000, body: JSON.stringify({ text: s.value }) }).then(function (r) {
      if (seq !== NBP.spSeq || !NB.cur || NB.cur.id !== nid) return;
      NBP.sp = r.data; _nbpCoachRun();
    }).catch(function (e) {
      if (seq !== NBP.spSeq) return;
      NBP.sp = { err: _nbErr(e) }; _nbpCoachRun();
    });
    return;
  }
  if (p[0] === 'all') {
    if (!S || !S.items || _nbRO()) return;
    if (NB.mode === 'view') _nbSetMode('split');
    _nbpSpSync(_nbSrc().value);
    var n = 0;
    S.items.forEach(function (x) { if (!x.done && _nbpSpFix(x)) n++; });
    _nbToast('🔤 ' + n + '곳 고쳤습니다 — Ctrl+Z 로 하나씩 되돌릴 수 있습니다');
    _nbpCoachRun(); return;
  }
  if (!it) return;
  if (p[0] === 'go') { var at = _nbSrc().value.indexOf(it.wrong); if (at >= 0) _nbpSelect(at, at + it.wrong.length); return; }
  if (p[0] === 'skip') { it.done = 'skip'; _nbpCoachRun(); return; }
  if (p[0] === 'fix') {
    if (NB.mode === 'view') _nbSetMode('split');
    if (!_nbpSpFix(it)) _nbToast('글이 바뀌어 그 자리를 찾지 못했습니다', 'warn');
    _nbpCoachRun(); return;
  }
}
