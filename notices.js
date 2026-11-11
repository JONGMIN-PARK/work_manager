/* notices.js — 📢 공지사항 (v13.444)
 *   헤더 📢 단추(안 읽은 수) → 공지 창. 관리자 · 지정된 작성자는 [관리] 탭에서 쓰기 · 고치기 · 게시 · 내리기 · 지우기 · 읽은 사람 보기.
 *   관리자는 [👥 작성자 지정] 으로 공지를 쓸 수 있는 사람을 정한다.
 *   게시되면 접속 중인 사람에게 바로(실시간 'wmnotice') 알리고, '중요' 공지는 창으로 띄운다 (로그인 직후에도 안 읽은 중요 공지를 띄움).
 *
 *   전역: wmNoticeInit() 로그인 뒤 · wmNoticeOpen(id?) 창 열기 · wmNoticeOnEvent(d) 실시간
 *   의존: apiFetch · eH · showToast · createModal · wmGuardedModal · wmConfirm · currentUser
 *   서버: server/routes/notices.js · 모양: style.css .nt-*
 */
var NT = { list: [], unread: 0, canWrite: false, isAdmin: false, tab: 'view', open: {}, total: 0, modal: null, edit: null, sub: null, popShown: {} };

function _ntE(s) { return typeof eH === 'function' ? eH(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _ntToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _ntErr(e) { return (e && e.message) || '처리하지 못했습니다'; }
/** 대한민국 시간 — 올해면 '11/11 14:30', 다른 해면 연도까지 */
function _ntDate(v) {
  if (!v) return '';
  var d = new Date(v); if (isNaN(d)) return '';
  try {
    var p = {}; new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var y = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric' }).formatToParts(new Date())[0].value;
    return (p.year !== y ? p.year + '/' : '') + p.month + '/' + p.day + ' ' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
  } catch (e) { return d.toLocaleString(); }
}
/** 본문 — 글자 그대로(HTML 아님) · 줄바꿈 유지 · 주소는 링크로 */
function _ntBody(s) {
  return _ntE(s || '').replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\r?\n/g, '<br>');
}
/** datetime-local 칸 ↔ 시각 (기기 시간대) */
function _ntToLocal(v) { if (!v) return ''; var d = new Date(v); if (isNaN(d)) return ''; var z = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes()); }

/* ─── 헤더 단추 · 안 읽은 수 ─── */
function _ntBadge() {
  var b = document.getElementById('noticeBadge'), btn = document.getElementById('hdrNoticeBtn'); if (!b) return;
  var n = NT.unread || 0;
  b.textContent = n > 99 ? '99+' : String(n); b.style.display = n ? 'flex' : 'none';
  if (btn) { btn.classList.toggle('has-new', n > 0); btn.title = n ? '📢 공지사항 — 안 읽은 공지 ' + n + '개' : '📢 공지사항'; }
}
/** 로그인 뒤 한 번 (다시 불러도 됨) — 안 읽은 수 + 안 읽은 '중요' 공지는 창으로 */
function wmNoticeInit() {
  if (window.WM_SOLO) return Promise.resolve();   // 떼어 낸 대화 창에서는 띄우지 않음 — 본 창만 (v13.447)
  if (typeof apiFetch !== 'function' || typeof _accessToken === 'undefined' || !_accessToken) return Promise.resolve();
  return apiFetch('/api/notices/summary').then(function (r) {
    var d = (r && r.data) || {};
    NT.unread = d.unread || 0; NT.canWrite = !!d.canWrite; _ntBadge();
    var imp = (d.important || []).filter(function (n) { return !NT.popShown[n.id]; });
    if (imp.length) _ntPopup(imp);
  }).catch(function () {});
}
/** 실시간 — 게시 · 고침 · 내림 · 작성자 바뀜 */
function wmNoticeOnEvent(d) {
  if (!d || window.WM_SOLO) return;
  var mine = typeof currentUser !== 'undefined' && currentUser && d.by === currentUser.id;
  if (d.op === 'publish' && !mine) {
    _ntToast((d.level === 'important' ? '📢 [중요] 새 공지 — ' : '📢 새 공지 — ') + (d.title || ''), 'info');
    var btn = document.getElementById('hdrNoticeBtn'); if (btn) { btn.classList.remove('nt-ping'); void btn.offsetWidth; btn.classList.add('nt-ping'); }
  }
  wmNoticeInit();
  if (NT.modal && document.getElementById('wmNoticeModal') && !NT.sub) _ntLoad();   // 열어 둔 목록은 새로 (쓰는 중 · 다른 화면이면 그대로)
}

/* ─── '중요' 공지 창 ─── */
function _ntPopup(list) {
  if (document.getElementById('wmNoticePop')) return;
  list.forEach(function (n) { NT.popShown[n.id] = 1; });
  var html = '<div class="nt-pop">' + list.map(function (n) {
    return '<article class="nt-pop-i"><h4><span class="nt-chip imp">중요</span>' + _ntE(n.title) + '</h4><div class="nt-meta">' + _ntE(n.authorName || '') + ' · ' + _ntDate(n.publishedAt) + '</div><div class="nt-body">' + _ntBody(n.body) + '</div></article>';
  }).join('') + '</div><div class="nt-foot"><button type="button" class="nt-btn" data-nt="pop-later">나중에 보기</button><button type="button" class="nt-btn pri" data-nt="pop-ok">확인했습니다</button></div>';
  var m = createModal({ id: 'wmNoticePop', title: '📢 중요 공지' + (list.length > 1 ? ' ' + list.length + '건' : ''), width: '560px', html: html, closeOnEsc: true });
  m.box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-nt]'); if (!b) return;
    if (b.dataset.nt === 'pop-later') return m.close();
    b.disabled = true;
    Promise.all(list.map(function (n) { return apiFetch('/api/notices/' + n.id + '/read', { method: 'POST' }).catch(function () {}); })).then(function () { m.close(); wmNoticeInit(); if (NT.modal) _ntLoad(); });
  });
}

/* ─── 공지 창 ─── */
function wmNoticeOpen(focusId) {
  if (typeof wmGuardedModal !== 'function') return _ntBuild(focusId);
  return wmGuardedModal('notice', function () { return _ntBuild(focusId); }, 'wmNoticeModal');
}
function _ntBuild(focusId) {
  NT.tab = 'view'; NT.sub = null; NT.edit = null; NT.open = {};
  if (focusId) NT.open[+focusId] = 1;
  var m = createModal({ id: 'wmNoticeModal', title: '📢 공지사항', width: '760px', html: '<div class="nt" id="ntRoot"><div class="nt-loading">불러오는 중…</div></div>', onClose: function () { NT.modal = null; } });
  NT.modal = m;
  m.box.classList.add('nt-box');
  m.box.addEventListener('click', _ntClick);
  m.box.addEventListener('input', function (e) { if (e.target && e.target.id === 'ntWSearch') _ntWritersFilter(e.target.value); });
  return _ntLoad().then(function () {
    if (focusId) { var el = document.querySelector('#ntRoot [data-id="' + (+focusId) + '"]'); if (el) { el.scrollIntoView({ block: 'nearest' }); _ntRead(+focusId); } }
  });
}
function _ntLoad() {
  var manage = NT.tab === 'manage';
  return apiFetch('/api/notices' + (manage ? '?manage=1' : '')).then(function (r) {
    NT.list = (r && r.data) || []; NT.unread = r.unread || 0; NT.canWrite = !!r.canWrite; NT.isAdmin = !!r.isAdmin; NT.total = r.total || 0;
    if (!NT.canWrite) NT.tab = 'view';
    _ntBadge(); _ntDraw();
  }).catch(function (e) { var root = document.getElementById('ntRoot'); if (root) root.innerHTML = '<div class="nt-empty">' + _ntE(_ntErr(e)) + '</div>'; });
}
function _ntStatus(n) { return n.status !== 'published' ? ['draft', '임시'] : n.ended ? ['end', '끝남'] : ['live', '게시 중']; }
function _ntDraw() {
  var root = document.getElementById('ntRoot'); if (!root) return;
  if (NT.sub === 'edit') return _ntDrawEdit(root);
  if (NT.sub === 'readers') return;      // 따로 그림
  if (NT.sub === 'writers') return;
  var manage = NT.tab === 'manage';
  var bar = '<div class="nt-bar">' +
    (NT.canWrite ? '<div class="nt-tabs" role="tablist"><button type="button" role="tab" class="' + (!manage ? 'on' : '') + '" data-nt="tab" data-v="view">공지 보기</button><button type="button" role="tab" class="' + (manage ? 'on' : '') + '" data-nt="tab" data-v="manage">관리</button></div>' : '<span class="nt-cnt">' + (NT.unread ? '안 읽은 공지 <b>' + NT.unread + '</b>개' : '모두 읽었습니다') + '</span>') +
    '<span class="nt-sp"></span>' +
    (!manage && NT.unread ? '<button type="button" class="nt-btn" data-nt="read-all">모두 읽음</button>' : '') +
    (NT.isAdmin && manage ? '<button type="button" class="nt-btn" data-nt="writers">👥 작성자 지정</button>' : '') +
    (NT.canWrite ? '<button type="button" class="nt-btn pri" data-nt="new">＋ 공지 쓰기</button>' : '') + '</div>';
  var body;
  if (!NT.list.length) body = '<div class="nt-empty">' + (manage ? '아직 쓴 공지가 없습니다 — <b>＋ 공지 쓰기</b> 로 시작하세요' : '게시된 공지가 없습니다') + '</div>';
  else if (manage) {
    body = '<div class="nt-list">' + NT.list.map(function (n) {
      var st = _ntStatus(n), mine = NT.isAdmin || (typeof currentUser !== 'undefined' && currentUser && n.authorId === currentUser.id);
      return '<article class="nt-row" data-id="' + n.id + '"><div class="nt-row-h"><span class="nt-chip st-' + st[0] + '">' + st[1] + '</span>' + (n.level === 'important' ? '<span class="nt-chip imp">중요</span>' : '') + (n.pinned ? '<span class="nt-pin" title="맨 위 고정">📌</span>' : '') +
        '<b class="nt-title">' + _ntE(n.title) + '</b></div>' +
        '<div class="nt-meta">' + _ntE(n.authorName || '') + ' · ' + (n.status === 'published' ? '게시 ' + _ntDate(n.publishedAt) : '고침 ' + _ntDate(n.updatedAt)) + (n.expiresAt ? ' · ' + _ntDate(n.expiresAt) + ' 까지' : '') +
        (n.status === 'published' ? ' · <button type="button" class="nt-link" data-nt="readers" data-id="' + n.id + '" title="누가 읽었는지 보기">읽음 ' + (n.readCount || 0) + ' / ' + NT.total + '</button>' : '') + '</div>' +
        (mine ? '<div class="nt-acts"><button type="button" class="nt-btn sm" data-nt="edit" data-id="' + n.id + '">✏️ 고치기</button>' +
          (n.status === 'published' ? '<button type="button" class="nt-btn sm" data-nt="unpub" data-id="' + n.id + '">내리기</button>' : '<button type="button" class="nt-btn sm pri" data-nt="pub" data-id="' + n.id + '">📢 게시</button>') +
          '<button type="button" class="nt-btn sm dng" data-nt="del" data-id="' + n.id + '">지우기</button></div>' : '<div class="nt-acts"><span class="nt-hint">다른 작성자가 쓴 공지</span></div>') + '</article>';
    }).join('') + '</div>';
  } else {
    body = '<div class="nt-list">' + NT.list.map(function (n) {
      var op = !!NT.open[n.id];
      return '<article class="nt-card' + (n.read ? '' : ' unread') + (op ? ' open' : '') + (n.level === 'important' ? ' imp' : '') + '" data-id="' + n.id + '">' +
        '<button type="button" class="nt-card-h" data-nt="toggle" data-id="' + n.id + '" aria-expanded="' + op + '">' +
        (n.pinned ? '<span class="nt-pin" title="맨 위 고정">📌</span>' : '') + (n.level === 'important' ? '<span class="nt-chip imp">중요</span>' : '') +
        '<b class="nt-title">' + _ntE(n.title) + '</b>' + (n.read ? '' : '<span class="nt-new">NEW</span>') + '<span class="nt-caret">▾</span></button>' +
        '<div class="nt-meta">' + _ntE(n.authorName || '') + ' · ' + _ntDate(n.publishedAt) + (n.expiresAt ? ' · ' + _ntDate(n.expiresAt) + ' 까지' : '') + '</div>' +
        (op ? '<div class="nt-body">' + (_ntBody(n.body) || '<span class="nt-hint">내용 없음</span>') + '</div>' : '<div class="nt-prev">' + _ntE(String(n.body || '').replace(/\s+/g, ' ').slice(0, 140)) + '</div>') + '</article>';
    }).join('') + '</div>';
  }
  root.innerHTML = bar + body;
}
function _ntRead(id) {
  var n = NT.list.filter(function (x) { return x.id === id; })[0];
  if (!n || n.read) return;
  n.read = true; NT.unread = Math.max(0, NT.unread - 1); _ntBadge();
  apiFetch('/api/notices/' + id + '/read', { method: 'POST' }).then(function (r) { if (r && r.data) { NT.unread = r.data.unread || 0; _ntBadge(); } }).catch(function () {});
}

/* ─── 쓰기 · 고치기 ─── */
function _ntDrawEdit(root) {
  var n = NT.edit || {}, isNew = !n.id, live = n.status === 'published';
  root.innerHTML = '<div class="nt-bar"><button type="button" class="nt-btn" data-nt="back">← 목록</button><b class="nt-ed-t">' + (isNew ? '새 공지 쓰기' : '공지 고치기') + '</b><span class="nt-sp"></span>' + (live ? '<span class="nt-chip st-live">게시 중</span>' : '<span class="nt-chip st-draft">임시</span>') + '</div>' +
    '<div class="nt-form">' +
    '<label class="nt-f"><span>제목</span><input type="text" id="ntTitle" maxlength="200" placeholder="예: 11월 정기 점검 안내" value="' + _ntE(n.title || '') + '"></label>' +
    '<label class="nt-f"><span>내용</span><textarea id="ntBody" rows="10" placeholder="공지 내용을 적어 주세요 — 줄바꿈은 그대로 보이고, 주소(https://…)는 링크가 됩니다">' + _ntE(n.body || '') + '</textarea></label>' +
    '<div class="nt-opts">' +
    '<label class="nt-chk"><input type="checkbox" id="ntImp"' + (n.level === 'important' ? ' checked' : '') + '> <b>중요</b> — 로그인하면 창으로 띄움</label>' +
    '<label class="nt-chk"><input type="checkbox" id="ntPin"' + (n.pinned ? ' checked' : '') + '> 📌 맨 위 고정</label>' +
    '<label class="nt-f inl"><span>게시 끝</span><input type="datetime-local" id="ntExp" value="' + _ntToLocal(n.expiresAt) + '" title="이때가 지나면 목록에서 내려갑니다 (비우면 계속 게시)"></label>' +
    '</div>' +
    (live ? '<label class="nt-chk nt-renotify"><input type="checkbox" id="ntNotify"> 고친 내용을 <b>다시 알림</b> — 모두에게 새 공지처럼 (안 읽음으로 돌아감)</label>' : '') +
    '</div>' +
    '<div class="nt-foot">' + (isNew ? '' : '<button type="button" class="nt-btn dng" data-nt="del" data-id="' + n.id + '">지우기</button>') + '<span class="nt-sp"></span>' +
    (live ? '<button type="button" class="nt-btn pri" data-nt="save">저장</button>' : '<button type="button" class="nt-btn" data-nt="save">임시 저장</button><button type="button" class="nt-btn pri" data-nt="save-pub">📢 게시</button>') + '</div>';
  var t = document.getElementById('ntTitle'); if (t && isNew) setTimeout(function () { t.focus(); }, 30);
}
function _ntFormVal() {
  var g = function (id) { return document.getElementById(id); };
  var exp = g('ntExp').value;
  return { title: g('ntTitle').value.trim(), body: g('ntBody').value, level: g('ntImp').checked ? 'important' : 'normal', pinned: g('ntPin').checked, expiresAt: exp ? new Date(exp).toISOString() : null, notify: !!(g('ntNotify') && g('ntNotify').checked) };
}
function _ntDirty() {
  if (NT.sub !== 'edit' || !document.getElementById('ntTitle')) return false;
  var v = _ntFormVal(), n = NT.edit || {};
  return v.title !== (n.title || '') || v.body !== (n.body || '') || v.level !== (n.level || 'normal') || v.pinned !== !!n.pinned || _ntToLocal(v.expiresAt) !== _ntToLocal(n.expiresAt);
}
async function _ntSave(publish, btn) {
  var v = _ntFormVal(), n = NT.edit || {};
  if (!v.title) { _ntToast('제목을 적어 주세요', 'warn'); var t = document.getElementById('ntTitle'); if (t) t.focus(); return; }
  if (v.expiresAt && new Date(v.expiresAt) <= new Date() && !(await wmConfirm('게시 끝 시각이 이미 지났습니다. 그대로 저장할까요? (목록에 보이지 않습니다)'))) return;
  if (publish && !(await wmConfirm('이 공지를 게시할까요? 모든 사용자에게 알림이 갑니다.'))) return;
  if (btn) btn.disabled = true;
  var p = n.id ? apiFetch('/api/notices/' + n.id, { method: 'PUT', body: JSON.stringify(v) }).then(function (r) { return publish ? apiFetch('/api/notices/' + n.id + '/publish', { method: 'POST' }) : r; })
    : apiFetch('/api/notices', { method: 'POST', body: JSON.stringify(Object.assign({ publish: !!publish }, v)) });
  p.then(function () {
    _ntToast(publish ? '📢 공지를 게시했습니다' : n.status === 'published' ? (v.notify ? '저장하고 다시 알렸습니다' : '저장했습니다') : '임시 저장했습니다', 'success');
    NT.sub = null; NT.edit = null; NT.tab = 'manage'; _ntLoad();
  }).catch(function (e) { if (btn) btn.disabled = false; _ntToast(_ntErr(e), 'error'); });
}

/* ─── 읽은 사람 ─── */
function _ntReaders(id) {
  var n = NT.list.filter(function (x) { return x.id === id; })[0], root = document.getElementById('ntRoot'); if (!n || !root) return;
  NT.sub = 'readers';
  root.innerHTML = '<div class="nt-bar"><button type="button" class="nt-btn" data-nt="back">← 목록</button><b class="nt-ed-t">' + _ntE(n.title) + '</b></div><div class="nt-loading">불러오는 중…</div>';
  apiFetch('/api/notices/' + id + '/readers').then(function (r) {
    if (NT.sub !== 'readers') return;
    var list = (r && r.data) || [], yes = list.filter(function (u) { return u.readAt; }), no = list.filter(function (u) { return !u.readAt; });
    var col = function (title, arr, cls) { return '<section class="nt-rd ' + cls + '"><h5>' + title + ' <b>' + arr.length + '</b></h5>' + (arr.length ? '<ul>' + arr.map(function (u) { return '<li><span>' + _ntE(u.name) + (u.dept ? ' <i>' + _ntE(u.dept) + '</i>' : '') + '</span>' + (u.readAt ? '<em>' + _ntDate(u.readAt) + '</em>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="nt-hint">없음</p>') + '</section>'; };
    var ld = root.querySelector('.nt-loading'); if (ld) ld.outerHTML = '<div class="nt-rds">' + col('✅ 읽음', yes, 'yes') + col('⏳ 아직 안 읽음', no, 'no') + '</div>';
  }).catch(function (e) { _ntToast(_ntErr(e), 'error'); NT.sub = null; _ntDraw(); });
}

/* ─── 작성자 지정 (관리자) ─── */
function _ntWriters() {
  var root = document.getElementById('ntRoot'); if (!root) return;
  NT.sub = 'writers';
  root.innerHTML = '<div class="nt-bar"><button type="button" class="nt-btn" data-nt="back">← 목록</button><b class="nt-ed-t">👥 공지 작성자 지정</b></div><div class="nt-loading">불러오는 중…</div>';
  apiFetch('/api/notices/writers').then(function (r) {
    if (NT.sub !== 'writers') return;
    var list = (r && r.data) || [], roles = { admin: '관리자', executive: '임원', manager: '팀장', member: '팀원' };
    var ld = root.querySelector('.nt-loading'); if (!ld) return;
    ld.outerHTML = '<p class="nt-hint nt-w-help">고른 사람은 공지를 쓰고 게시할 수 있습니다 (자기가 쓴 공지만 고치고 지울 수 있음). 관리자는 늘 쓸 수 있고 모든 공지를 관리합니다.</p>' +
      '<input type="search" id="ntWSearch" class="nt-search" placeholder="이름 · 부서로 찾기" autocomplete="off">' +
      '<div class="nt-wlist">' + list.map(function (u) {
        return '<label class="nt-w' + (u.fixed ? ' fixed' : '') + '" data-q="' + _ntE((u.name + ' ' + u.dept).toLowerCase()) + '"><input type="checkbox" value="' + _ntE(u.id) + '"' + (u.writer ? ' checked' : '') + (u.fixed ? ' disabled' : '') + '><span>' + _ntE(u.name) + '</span><i>' + _ntE(u.dept || '') + '</i><em>' + (roles[u.role] || _ntE(u.role || '')) + '</em></label>';
      }).join('') + '</div><div class="nt-foot"><span class="nt-sp"></span><button type="button" class="nt-btn pri" data-nt="writers-save">저장</button></div>';
  }).catch(function (e) { _ntToast(_ntErr(e), 'error'); NT.sub = null; _ntDraw(); });
}
function _ntWritersFilter(q) {
  q = String(q || '').trim().toLowerCase();
  document.querySelectorAll('#ntRoot .nt-w').forEach(function (el) { el.hidden = !!q && el.dataset.q.indexOf(q) < 0; });
}

/* ─── 누르기 ─── */
async function _ntClick(e) {
  var b = e.target.closest('[data-nt]'); if (!b) return;
  var k = b.dataset.nt, id = +b.dataset.id || 0;
  if (k === 'tab') { if (NT.tab !== b.dataset.v) { NT.tab = b.dataset.v; _ntLoad(); } }
  else if (k === 'toggle') { NT.open[id] = !NT.open[id]; if (NT.open[id]) _ntRead(id); _ntDraw(); }
  else if (k === 'read-all') { b.disabled = true; apiFetch('/api/notices/read-all', { method: 'POST' }).then(function () { _ntLoad(); }).catch(function (er) { b.disabled = false; _ntToast(_ntErr(er), 'error'); }); }
  else if (k === 'new') { NT.sub = 'edit'; NT.edit = {}; _ntDraw(); }
  else if (k === 'edit') { var n = NT.list.filter(function (x) { return x.id === id; })[0]; if (n) { NT.sub = 'edit'; NT.edit = n; _ntDraw(); } }
  else if (k === 'back') { if (_ntDirty() && !(await wmConfirm('쓰던 내용을 저장하지 않고 나갈까요?'))) return; NT.sub = null; NT.edit = null; _ntDraw(); }
  else if (k === 'save') _ntSave(false, b);
  else if (k === 'save-pub') _ntSave(true, b);
  else if (k === 'pub') { if (!(await wmConfirm('이 공지를 게시할까요? 모든 사용자에게 알림이 갑니다.'))) return; apiFetch('/api/notices/' + id + '/publish', { method: 'POST' }).then(function () { _ntToast('📢 공지를 게시했습니다', 'success'); _ntLoad(); }).catch(function (er) { _ntToast(_ntErr(er), 'error'); }); }
  else if (k === 'unpub') { if (!(await wmConfirm('이 공지를 내릴까요? 목록에서 사라지고 읽음 기록이 지워집니다. (다시 게시할 수 있습니다)'))) return; apiFetch('/api/notices/' + id + '/unpublish', { method: 'POST' }).then(function () { _ntToast('공지를 내렸습니다', 'success'); _ntLoad(); }).catch(function (er) { _ntToast(_ntErr(er), 'error'); }); }
  else if (k === 'del') { if (!(await wmConfirm('이 공지를 지울까요? 되돌릴 수 없습니다.'))) return; apiFetch('/api/notices/' + id, { method: 'DELETE' }).then(function () { _ntToast('공지를 지웠습니다', 'success'); NT.sub = null; NT.edit = null; NT.tab = 'manage'; _ntLoad(); }).catch(function (er) { _ntToast(_ntErr(er), 'error'); }); }
  else if (k === 'readers') _ntReaders(id);
  else if (k === 'writers') _ntWriters();
  else if (k === 'writers-save') {
    var ids = Array.prototype.map.call(document.querySelectorAll('#ntRoot .nt-w input:checked:not(:disabled)'), function (i) { return i.value; });
    b.disabled = true;
    apiFetch('/api/notices/writers', { method: 'PUT', body: JSON.stringify({ userIds: ids }) }).then(function () { _ntToast('작성자를 저장했습니다 (' + ids.length + '명)', 'success'); NT.sub = null; _ntDraw(); }).catch(function (er) { b.disabled = false; _ntToast(_ntErr(er), 'error'); });
  }
}

if (typeof window !== 'undefined') { window.wmNoticeInit = wmNoticeInit; window.wmNoticeOpen = wmNoticeOpen; window.wmNoticeOnEvent = wmNoticeOnEvent; }
