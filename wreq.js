/**
 * 📨 업무 요청 (v13.525) — 보내기 창 · 메신저 카드 · 📨 요청함
 *   wrqOpen(opts)   보내기 창. opts: { type, types, title, body, dueDate, dueTime, endTime, location, projectId, projectName, srcKey, to }
 *                   type: order 업무 지시 · transfer 업무 이관 · forward 업무 전달 · event 일정 · todo 할 일
 *   wrqFromProject(projectId)   프로젝트 상세 → 지시 · 이관 · 전달 (프로젝트 이름 · 기한 채움)
 *   wrqFromItem(it)             내 업무 항목(할 일 · 이슈 · 마일스톤 …) → 이관 · 지시 · 전달 · 할 일
 *   wrqFromEvent(ev)            일정 → 같은 일정을 다른 사람에게
 *   chatWreqHtml(m) · chatWreqClick(t)   메신저 카드 (받은 사람: 수락 · 반려 · 완료 / 보낸 사람: 거두기)
 *   wrqBox(tab)     📨 요청함 — 받은 · 보낸 요청과 상태 (놓친 것 없게)
 * 서버: /api/work-requests (routes/work-requests.js)
 */
var WRQ_TYPES = {
  order: { icon: '📋', label: '업무 지시', hint: '받는 사람 할 일로 — 기한까지 해 주세요' },
  transfer: { icon: '🔁', label: '업무 이관', hint: '이 일을 넘깁니다 — 수락하면 받는 사람 할 일이 되고, 내 할 일은 닫힘' },
  forward: { icon: '📤', label: '업무 전달', hint: '알아 두세요 — 받는 사람은 확인만 하거나 할 일로 넣을 수 있음' },
  event: { icon: '📅', label: '일정', hint: '수락하면 받는 사람 일정에 들어감' },
  todo: { icon: '✅', label: '할 일', hint: '수락하면 받는 사람 할 일로' }
};
var WRQ_ST = { sent: ['⏳', '답을 기다림'], accepted: ['🟢', '수락 · 진행 중'], declined: ['↩', '반려'], done: ['✅', '완료'], canceled: ['✕', '거둠'] };
function _wqE(s) { return typeof eH === 'function' ? eH(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _wqToast(m, k) { if (typeof showToast === 'function') showToast(m, k); }
function _wqToday() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/* 사람 목록 — 한 번 받아 둠 */
var _wqPeople = null;
function _wqLoadPeople() {
  if (_wqPeople) return Promise.resolve(_wqPeople);
  return apiFetch('/api/users/lookup').then(function (r) {
    var me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : '';
    _wqPeople = ((r && r.data) || []).map(function (u) { return { id: u.id, name: u.display_name || u.displayName || u.name || '', dept: u.dept_name || u.deptName || '' }; })
      .filter(function (u) { return u.id && u.id !== me && u.name; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    return _wqPeople;
  });
}

/* ═══ 보내기 창 ═══ */
function wrqOpen(opts) {
  opts = opts || {};
  return wmGuardedModal('wrqSend', function () {
    return _wqLoadPeople().then(function (people) { _wqBuild(opts, people); });
  }, 'wrqModal', { onOpen: function () { var i = document.querySelector('#wrqModal .wrq-who-in'); if (i) i.focus(); } });
}
function _wqBuild(o, people) {
  var types = (o.types && o.types.length ? o.types : Object.keys(WRQ_TYPES)).filter(function (k) { return WRQ_TYPES[k]; });
  var st = { type: types.indexOf(o.type) >= 0 ? o.type : types[0], to: [] };
  (o.to || []).forEach(function (id) { if (people.some(function (p) { return p.id === id; })) st.to.push(id); });
  var html = '<div class="wrq">' +
    '<div class="wrq-types" role="radiogroup">' + types.map(function (k) { var t = WRQ_TYPES[k]; return '<button type="button" class="wrq-type" role="radio" data-t="' + k + '">' + t.icon + ' ' + t.label + '</button>'; }).join('') + '</div>' +
    '<div class="wrq-hint"></div>' +
    (o.projectName ? '<div class="wrq-proj">📁 ' + _wqE(o.projectName) + '</div>' : '') +
    '<label class="wrq-f"><span>받는 사람</span><div class="wrq-who"><span class="wrq-chips"></span><input class="wrq-who-in" placeholder="이름을 치세요" autocomplete="off"></div><div class="wrq-sug" hidden></div></label>' +
    '<label class="wrq-f"><span>제목</span><input class="wr-inp" data-k="title" maxlength="300" value="' + _wqE(o.title || '') + '"></label>' +
    '<label class="wrq-f"><span>내용</span><textarea class="wr-inp" data-k="body" rows="4" maxlength="4000" placeholder="해야 할 것 · 참고 · 바라는 결과">' + _wqE(o.body || '') + '</textarea></label>' +
    '<div class="wrq-row"><label class="wrq-f"><span class="wrq-due-l">기한</span><input type="date" class="wr-inp" data-k="dueDate" value="' + _wqE(o.dueDate || '') + '"></label>' +
    '<label class="wrq-f"><span>시각</span><input type="time" class="wr-inp" data-k="dueTime" value="' + _wqE(o.dueTime || '') + '"></label>' +
    '<label class="wrq-f wrq-ev"><span>끝 시각</span><input type="time" class="wr-inp" data-k="endTime" value="' + _wqE(o.endTime || '') + '"></label></div>' +
    '<label class="wrq-f wrq-ev"><span>장소</span><input class="wr-inp" data-k="location" maxlength="255" value="' + _wqE(o.location || '') + '"></label>' +
    '<div class="wrq-foot"><button type="button" class="btn btn-g btn-s" data-a="box">📨 요청함</button><span style="flex:1"></span>' +
    '<button type="button" class="btn btn-g" data-a="cancel">취소</button><button type="button" class="btn btn-p" data-a="send">보내기</button></div></div>';
  var md = createModal({ id: 'wrqModal', title: '📨 업무 보내기', width: '520px', closeOnEsc: true, html: html });
  var box = md.box || document.querySelector('#wrqModal .wa-modal-box');
  var q = function (s) { return box.querySelector(s); };
  var paint = function () {
    box.querySelectorAll('.wrq-type').forEach(function (b) { var on = b.dataset.t === st.type; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    q('.wrq-hint').textContent = WRQ_TYPES[st.type].hint + (st.type === 'transfer' ? ' (한 사람에게만)' : '');
    box.querySelectorAll('.wrq-ev').forEach(function (e) { e.hidden = st.type !== 'event'; });
    q('.wrq-due-l').textContent = st.type === 'event' ? '날짜' : '기한';
    if (st.type === 'transfer' && st.to.length > 1) st.to = st.to.slice(0, 1);
    q('.wrq-chips').innerHTML = st.to.map(function (id) { var p = people.filter(function (x) { return x.id === id; })[0]; return '<span class="wrq-chip">' + _wqE(p ? p.name : id) + '<button type="button" data-rm="' + _wqE(id) + '" aria-label="빼기">✕</button></span>'; }).join('');
    q('[data-a="send"]').textContent = '보내기' + (st.to.length > 1 ? ' (' + st.to.length + '명)' : '');
  };
  var inp = q('.wrq-who-in'), sug = q('.wrq-sug'), pick = 0, list = [];
  /* 등록된 사람 모두 — 부서별로 묶고 스크롤 (v13.529 — 예전엔 8명만 보였다). 이름 · 부서 이름으로 찾기 */
  var showSug = function () {
    var v = inp.value.trim().toLowerCase();
    list = people.filter(function (p) { return st.to.indexOf(p.id) < 0 && (!v || p.name.toLowerCase().indexOf(v) >= 0 || (p.dept || '').toLowerCase().indexOf(v) >= 0); });
    // 부서 순(부서 없음은 맨 뒤) → 이름 순, 키보드 이동도 이 순서
    list.sort(function (a, b) { return (a.dept ? 0 : 1) - (b.dept ? 0 : 1) || (a.dept || '').localeCompare(b.dept || '', 'ko') || a.name.localeCompare(b.name, 'ko'); });
    if (!v && document.activeElement !== inp) { sug.hidden = true; return; }
    pick = 0;
    var h = '<div class="wrq-sg-top">' + (v ? '찾은 사람 ' + list.length + '명' : '전체 ' + list.length + '명') + (st.type === 'transfer' ? ' · 이관은 한 사람만' : ' · 부서 이름을 누르면 그 부서 모두') + '</div>', cur = null;
    list.forEach(function (p, i) {
      var dg = p.dept || '부서 없음';
      if (dg !== cur) { cur = dg; var n = list.filter(function (x) { return (x.dept || '부서 없음') === dg; }).length; h += '<button type="button" class="wrq-sg-dept" data-dept="' + _wqE(dg) + '"' + (st.type === 'transfer' ? ' disabled' : '') + '>🏢 ' + _wqE(dg) + ' <small>' + n + '</small></button>'; }
      h += '<button type="button" class="wrq-sg' + (i === pick ? ' on' : '') + '" data-id="' + _wqE(p.id) + '" data-i="' + i + '">' + _wqE(p.name) + '</button>';
    });
    sug.innerHTML = list.length ? h : '<div class="wrq-sg-none">맞는 사람이 없습니다</div>';
    sug.hidden = false;
  };
  var add = function (id) { if (id && st.to.indexOf(id) < 0) { if (st.type === 'transfer') st.to = []; st.to.push(id); } inp.value = ''; sug.hidden = true; paint(); inp.focus(); };
  inp.addEventListener('input', showSug);
  inp.addEventListener('focus', showSug);
  inp.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 150); });
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!list.length) return; pick = (pick + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length; sug.querySelectorAll('.wrq-sg').forEach(function (b, i) { b.classList.toggle('on', i === pick); if (i === pick) b.scrollIntoView({ block: 'nearest' }); }); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!sug.hidden && list[pick]) add(list[pick].id); }
    else if (e.key === 'Backspace' && !inp.value && st.to.length) { st.to.pop(); paint(); }
  });
  sug.addEventListener('mousedown', function (e) {
    var b = e.target.closest('[data-id]'); if (b) { e.preventDefault(); add(b.dataset.id); return; }
    var d = e.target.closest('[data-dept]');   // 부서 모두 넣기
    if (d && !d.disabled) {
      e.preventDefault();
      list.filter(function (p) { return (p.dept || '부서 없음') === d.dataset.dept; }).forEach(function (p) { if (st.to.indexOf(p.id) < 0) st.to.push(p.id); });
      inp.value = ''; paint(); showSug(); inp.focus();
    }
  });
  box.addEventListener('click', function (e) {
    var t = e.target.closest('[data-t]'); if (t) { st.type = t.dataset.t; paint(); return; }
    var rm = e.target.closest('[data-rm]'); if (rm) { st.to = st.to.filter(function (x) { return x !== rm.dataset.rm; }); paint(); return; }
    var a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'cancel') return md.close();
    if (a.dataset.a === 'box') { var m0 = document.getElementById('wrqModal'); if (m0) (m0._wmClose ? m0._wmClose() : m0.remove()); return wrqBox('out'); }
    if (a.dataset.a === 'send') send(a);
  });
  var send = function (btn) {
    var v = function (k) { var el = q('[data-k="' + k + '"]'); return el ? el.value.trim() : ''; };
    if (!st.to.length) { _wqToast('받는 사람을 고르세요.', 'warn'); inp.focus(); return; }
    if (!v('title')) { _wqToast('제목을 적으세요.', 'warn'); q('[data-k="title"]').focus(); return; }
    if (st.type === 'event' && !v('dueDate')) { _wqToast('일정 날짜를 고르세요.', 'warn'); q('[data-k="dueDate"]').focus(); return; }
    btn.disabled = true;
    apiFetch('/api/work-requests', { method: 'POST', body: JSON.stringify({ type: st.type, toUserIds: st.to, title: v('title'), body: v('body'), dueDate: v('dueDate'), dueTime: v('dueTime'),
      endTime: st.type === 'event' ? v('endTime') : '', location: st.type === 'event' ? v('location') : '', projectId: o.projectId || null, srcKey: o.srcKey || null }) })
      .then(function (r) {
        var n = (r && r.data && r.data.length) || 0;
        var m1 = document.getElementById('wrqModal'); if (m1) (m1._wmClose ? m1._wmClose() : m1.remove());
        _wqToast('📨 ' + WRQ_TYPES[st.type].label + '을(를) ' + n + '명에게 보냈습니다 — 메신저 1:1 방 · 📨 요청함에서 볼 수 있어요');
        _wqBadge();
      })
      .catch(function (e) { btn.disabled = false; _wqToast('보내지 못했습니다: ' + ((e && e.data && e.data.message) || e.message || e), 'error'); });
  };
  paint();
}

/* ─── 붙이는 곳 ─── */
function wrqFromProject(pid) {
  var p = (typeof projGet === 'function') ? projGet(pid) : Promise.resolve(null);
  return Promise.resolve(p).catch(function () { return null; }).then(function (proj) {
    return wrqOpen({ type: 'order', types: ['order', 'transfer', 'forward', 'event'], projectId: pid, projectName: proj ? (proj.name || proj.orderNo || '') : '',
      title: proj ? '[' + (proj.name || proj.orderNo || '') + '] ' : '' });
  });
}
function wrqFromItem(it) {
  if (!it) return;
  var todo = it.src === 'todo';
  return wrqOpen({ type: todo ? 'transfer' : 'forward', types: todo ? ['transfer', 'order', 'forward', 'todo'] : ['forward', 'order', 'todo'],
    title: it.title || '', body: (it.memo || '') + (it.ctx && !todo ? (it.memo ? '\n' : '') + '(' + it.ctx + ')' : ''), dueDate: it.due || '', dueTime: it.dueTime || '',
    projectId: it.projectId || null, projectName: it.projectId ? it.ctx || '' : '', srcKey: todo ? 'todo:' + it.id : null });
}
function wrqFromEvent(ev) {
  if (!ev) return;
  return wrqOpen({ type: 'event', types: ['event', 'forward'], title: ev.title || '', body: ev.memo || '', dueDate: ev.startDate || ev.start_date || '', dueTime: String(ev.startTime || ev.start_time || '').slice(0, 5),
    endTime: String(ev.endTime || ev.end_time || '').slice(0, 5), location: ev.location || '', projectId: (ev.projectIds || ev.project_ids || [])[0] || null });
}

/* ═══ 메신저 카드 ═══ */
function chatWreqHtml(m) {
  var w = m.wreq; if (!w || !w.id) return '';
  var t = WRQ_TYPES[w.type] || WRQ_TYPES.order, st = WRQ_ST[w.status] || WRQ_ST.sent;
  var me = (typeof _cxMe === 'function') ? _cxMe() : ((typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : '');
  var toMe = w.to === me, fromMe = w.from === me, id = _wqE(w.id);
  var acts = '';
  if (toMe && w.status === 'sent') acts = '<button type="button" class="btn btn-p btn-s" data-wq="accept" data-id="' + id + '">✔ 수락' + (w.type === 'event' ? ' · 일정에 넣기' : ' · 할 일로') + '</button>' +
    (w.type === 'forward' ? '<button type="button" class="btn btn-g btn-s" data-wq="done" data-id="' + id + '">👍 확인만</button>' : '') +
    '<button type="button" class="btn btn-g btn-s" data-wq="decline" data-id="' + id + '">↩ 반려</button>';
  else if (toMe && w.status === 'accepted') acts = '<button type="button" class="btn btn-p btn-s" data-wq="done" data-id="' + id + '">✅ 완료</button>';
  else if (fromMe && w.status === 'sent') acts = '<button type="button" class="btn btn-g btn-s" data-wq="cancel" data-id="' + id + '">✕ 거두기</button>';
  return '<div class="wrq-card st-' + _wqE(w.status) + '" data-wrq="' + id + '">' +
    '<div class="wrq-c-h"><span class="wrq-c-t">' + t.icon + ' ' + t.label + '</span><span class="wrq-c-st">' + st[0] + ' ' + st[1] + '</span></div>' +
    '<div class="wrq-c-title">' + _wqE(w.title) + '</div>' +
    (w.due || w.projectName || w.location ? '<div class="wrq-c-meta">' + (w.due ? '<span>' + (w.type === 'event' ? '🗓 ' : '⏰ 기한 ') + _wqE(w.due) + (w.time ? ' ' + _wqE(w.time) + (w.endTime ? '~' + _wqE(w.endTime) : '') : '') + '</span>' : '') +
      (w.location ? '<span>📍 ' + _wqE(w.location) + '</span>' : '') + (w.projectName ? '<span>📁 ' + _wqE(w.projectName) + '</span>' : '') + '</div>' : '') +
    (w.body ? '<div class="wrq-c-body">' + _wqE(w.body) + '</div>' : '') +
    (w.reply ? '<div class="wrq-c-reply">↩ ' + _wqE(w.reply) + '</div>' : '') +
    (fromMe ? '<div class="wrq-c-to">→ ' + _wqE(w.toName || '') + '</div>' : '') +
    (acts ? '<div class="wrq-c-acts">' + acts + '</div>' : '') + '</div>';
}
function chatWreqClick(t) {
  var b = t.closest('[data-wq]'); if (!b) return false;
  wrqAct(b.dataset.wq, b.dataset.id, b);
  return true;
}
async function wrqAct(act, id, btn) {
  var body = {};
  if (act === 'decline') {
    var why = typeof wmPrompt === 'function' ? await wmPrompt('반려하는 이유 (보낸 사람에게 보여요 — 비워도 됨)', '') : '';
    if (why === null) return;
    body.reply = why || '';
  }
  if (act === 'cancel' && typeof wmConfirm === 'function' && !(await wmConfirm('이 요청을 거둘까요?'))) return;
  if (btn) btn.disabled = true;
  return apiFetch('/api/work-requests/' + encodeURIComponent(id) + '/' + act, { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
    var w = r && r.data;
    _wqToast(act === 'accept' ? (w && w.type === 'event' ? '📅 내 일정에 넣었습니다' : '✅ 내 할 일에 넣었습니다') : act === 'done' ? '✅ 완료로 알렸습니다' : act === 'decline' ? '↩ 반려했습니다' : '요청을 거뒀습니다');
    if (act === 'accept' || act === 'done') { if (typeof _pdInvalidate === 'function') _pdInvalidate('evt'); if (window.wmDataBus) try { window.wmDataBus.emit(w && w.type === 'event' ? 'event' : 'myWork', 'updated', {}); } catch (_) {} }
    _wqBadge();
    if (document.getElementById('wrqBox')) _wqBoxLoad();
    return w;
  }).catch(function (e) { if (btn) btn.disabled = false; _wqToast('처리하지 못했습니다: ' + ((e && e.data && e.data.message) || e.message || e), 'error'); });
}

/* ═══ 📨 요청함 ═══ */
var _wqTab = 'in';
function wrqBox(tab) {
  if (tab) _wqTab = tab;
  return wmGuardedModal('wrqBox', function () {
    var md = createModal({ id: 'wrqBox', title: '📨 요청함', width: '640px', closeOnEsc: true,
      html: '<div class="wrq-box"><div class="wrq-tabs"><button type="button" data-tab="in">받은 요청</button><button type="button" data-tab="out">보낸 요청</button>' +
        '<label class="wrq-open"><input type="checkbox" checked> 끝나지 않은 것만</label><span style="flex:1"></span><button type="button" class="btn btn-p btn-s" data-new>📨 새로 보내기</button></div><div class="wrq-list"></div></div>' });
    var box = (md && md.box) || document.querySelector('#wrqBox .wa-modal-box');
    box.addEventListener('click', function (e) {
      var tb = e.target.closest('[data-tab]'); if (tb) { _wqTab = tb.dataset.tab; _wqBoxLoad(); return; }
      if (e.target.closest('[data-new]')) { var m0 = document.getElementById('wrqBox'); if (m0) (m0._wmClose ? m0._wmClose() : m0.remove()); wrqOpen({}); return; }
      var a = e.target.closest('[data-wq]'); if (a) { wrqAct(a.dataset.wq, a.dataset.id, a); return; }
      var go = e.target.closest('[data-go]'); if (go) { _wqGo(go.dataset.go); }
    });
    box.querySelector('.wrq-open input').addEventListener('change', _wqBoxLoad);
    _wqBoxLoad();
  }, 'wrqBox');
}
function _wqGo(key) {
  var m = /^(todo|event):/.exec(key || ''); if (!m) return;
  var b = document.getElementById('wrqBox'); if (b) (b._wmClose ? b._wmClose() : b.remove());
  if (typeof setPage === 'function') setPage('mywork');
}
function _wqBoxLoad() {
  var root = document.getElementById('wrqBox'); if (!root) return;
  root.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === _wqTab); });
  var list = root.querySelector('.wrq-list'), open = root.querySelector('.wrq-open input').checked;
  list.innerHTML = '<div class="wrq-empty">⏳ 불러오는 중…</div>';
  apiFetch('/api/work-requests?box=' + _wqTab + (open ? '&open=1' : '')).then(function (r) {
    var rows = (r && r.data) || [];
    if (!document.getElementById('wrqBox')) return;
    if (!rows.length) { list.innerHTML = '<div class="wrq-empty">' + (_wqTab === 'in' ? '받은 요청이 없습니다' : '보낸 요청이 없습니다') + (open ? ' (끝나지 않은 것)' : '') + '</div>'; return; }
    var today = _wqToday();
    list.innerHTML = rows.map(function (w) {
      var t = WRQ_TYPES[w.type] || WRQ_TYPES.order, st = WRQ_ST[w.status] || WRQ_ST.sent, id = _wqE(w.id);
      var late = w.dueDate && w.dueDate < today && (w.status === 'sent' || w.status === 'accepted');
      var acts = '';
      if (_wqTab === 'in' && w.status === 'sent') acts = '<button type="button" class="btn btn-p btn-s" data-wq="accept" data-id="' + id + '">✔ 수락</button><button type="button" class="btn btn-g btn-s" data-wq="decline" data-id="' + id + '">↩</button>';
      else if (_wqTab === 'in' && w.status === 'accepted') acts = '<button type="button" class="btn btn-p btn-s" data-wq="done" data-id="' + id + '">✅ 완료</button>';
      else if (_wqTab === 'out' && w.status === 'sent') acts = '<button type="button" class="btn btn-g btn-s" data-wq="cancel" data-id="' + id + '">거두기</button>';
      return '<div class="wrq-item st-' + _wqE(w.status) + '"><div class="wrq-i-main"><div class="wrq-i-top"><span class="wrq-i-type">' + t.icon + ' ' + t.label + '</span>' +
        '<span class="wrq-i-who">' + (_wqTab === 'in' ? _wqE(w.fromName) + ' →' : '→ ' + _wqE(w.toName)) + '</span><span class="wrq-i-st">' + st[0] + ' ' + st[1] + '</span></div>' +
        '<div class="wrq-i-title">' + _wqE(w.title) + '</div><div class="wrq-i-meta">' + (w.dueDate ? '<span' + (late ? ' class="late"' : '') + '>' + (late ? '⚠ 기한 지남 ' : '⏰ ') + _wqE(w.dueDate) + (w.dueTime ? ' ' + _wqE(w.dueTime) : '') + '</span>' : '') +
        (w.projectName ? '<span>📁 ' + _wqE(w.projectName) + '</span>' : '') + '<span>' + _wqE(String(w.createdAt || '').slice(0, 10)) + '</span>' + (w.reply ? '<span>↩ ' + _wqE(w.reply) + '</span>' : '') + '</div></div>' +
        (acts ? '<div class="wrq-i-acts">' + acts + '</div>' : '') + '</div>';
    }).join('');
  }).catch(function (e) { list.innerHTML = '<div class="wrq-empty">불러오지 못했습니다 — ' + _wqE(e.message || e) + '</div>'; });
}

/* 받은 요청 수 — 📨 단추 배지 */
function _wqBadge() {
  if (typeof apiFetch !== 'function' || typeof currentUser === 'undefined' || !currentUser) return;
  apiFetch('/api/work-requests/count').then(function (r) {
    var n = (r && r.count) || 0;
    document.querySelectorAll('.wrq-badge').forEach(function (b) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; });
  }).catch(function () {});
}

/* 받은 요청 수 — 로그인 뒤 · 2분마다(화면이 보일 때) · 메신저로 새 요청이 오면 */
(function () {
  var started = false;
  function tick() { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; _wqBadge(); }
  function start() {
    if (started) return;
    if (typeof currentUser === 'undefined' || !currentUser) return setTimeout(start, 1500);
    started = true; tick(); setInterval(tick, 120000);
    document.addEventListener('visibilitychange', tick);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1500); }); else setTimeout(start, 1500);
  }
})();
