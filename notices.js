/* notices.js — 📢 공지사항 (v13.444) · 꾸미기 · 그림 붙이기 · 미리보기 (v13.514)
 *   헤더 📢 단추(안 읽은 수) → 공지 창. 관리자 · 지정된 작성자는 [관리] 탭에서 쓰기 · 고치기 · 게시 · 내리기 · 지우기 · 읽은 사람 보기.
 *   관리자는 [👥 작성자 지정] 으로 공지를 쓸 수 있는 사람을 정한다.
 *   게시되면 접속 중인 사람에게 바로(실시간 'wmnotice') 알리고, '중요' 공지는 창으로 띄운다 (로그인 직후에도 안 읽은 중요 공지를 띄움).
 *
 *   전역: wmNoticeInit() 로그인 뒤 · wmNoticeOpen(id?) 창 열기 · wmNoticeOnEvent(d) 실시간
 *   의존: apiFetch · eH · showToast · createModal · wmGuardedModal · wmConfirm · currentUser
 *   서버: server/routes/notices.js · 모양: style.css .nt-*
 */
var NT = { list: [], unread: 0, canWrite: false, isAdmin: false, tab: 'view', open: {}, total: 0, modal: null, edit: null, sub: null, popShown: {}, imgs: {}, imgWait: {}, eimgs: [], eimgs0: '' };

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
/** 한 줄 안 꾸미기 — 글자는 그대로(escape) 두고 주소 링크 · **굵게** · ==형광== 만 */
function _ntInline(s) {
  return _ntE(s || '').replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
}
/** 본문 (v13.514 꾸미기) — HTML 은 못 쓰고, 줄 맨 앞 기호만 모양으로 바꾼다
 *   # 큰 제목 · ## 작은 제목 · - 목록 · 1. 번호 목록 · > 강조 상자 · --- 구분선 · [그림1] 그 자리에 붙인 그림
 *   imgs: 붙인 그림(data URL) 배열 · null 이면 아직 받는 중 · 본문에서 안 쓴 그림은 아래에 차례로 */
function _ntBody(s, imgs) {
  if (!String(s || '').trim() && !(imgs && imgs.length)) return '';
  var lines = String(s || '').split(/\r?\n/), out = [], mode = '', used = {}, m;
  var close = function () { if (mode === 'ul') out.push('</ul>'); else if (mode === 'ol') out.push('</ol>'); else if (mode === 'call') out.push('</div>'); mode = ''; };
  var open = function (k, tag) { if (mode !== k) { close(); out.push(tag); mode = k; } };
  var img = function (i) {
    if (imgs === null) return '<div class="nt-img-wait">🖼 그림 ' + (i + 1) + ' 불러오는 중…</div>';
    if (!imgs || !imgs[i]) return '';
    used[i] = 1;
    return '<figure class="nt-fig"><img class="nt-img" src="' + imgs[i] + '" alt="그림 ' + (i + 1) + '" data-nt="img" data-i="' + i + '" title="눌러서 크게 보기"></figure>';
  };
  lines.forEach(function (ln) {
    var t = ln.trim();
    if ((m = /^\[그림\s*(\d+)\]$/.exec(t))) { close(); out.push(img(+m[1] - 1)); }
    else if ((m = /^(#{1,2})\s+(.+)$/.exec(t))) { close(); out.push('<div class="nt-h' + m[1].length + '">' + _ntInline(m[2]) + '</div>'); }
    else if (/^-{3,}$/.test(t)) { close(); out.push('<hr class="nt-hr">'); }
    else if ((m = /^>\s?(.*)$/.exec(t))) { var first = mode !== 'call'; open('call', '<div class="nt-call">'); out.push((first ? '' : '<br>') + _ntInline(m[1])); }
    else if ((m = /^[-•·]\s+(.+)$/.exec(t))) { open('ul', '<ul class="nt-ul">'); out.push('<li>' + _ntInline(m[1]) + '</li>'); }
    else if ((m = /^\d{1,2}[.)]\s+(.+)$/.exec(t))) { open('ol', '<ol class="nt-ol">'); out.push('<li>' + _ntInline(m[1]) + '</li>'); }
    else if (!t) { close(); out.push('<div class="nt-gap"></div>'); }
    else { close(); out.push('<div class="nt-p">' + _ntInline(ln) + '</div>'); }
  });
  close();
  var rest = '';
  if (imgs === null) rest = '';
  else (imgs || []).forEach(function (_, i) { if (!used[i]) rest += img(i); });
  return out.join('') + (rest ? '<div class="nt-imgs">' + rest + '</div>' : '');
}
/** 한 줄 미리보기 — 꾸미기 기호를 뺀 글 */
function _ntPlain(s) { return String(s || '').replace(/\[그림\s*\d+\]/g, ' ').replace(/^\s*(#{1,2}|>|-{3,})\s?/gm, '').replace(/\*\*|==/g, '').replace(/\s+/g, ' ').trim(); }
/** 붙인 그림 — 공지를 펼칠 때만 받는다 (목록은 가볍게). 받으면 cb */
function _ntImgs(n, cb) {
  if (!n || !n.imageCount) return [];
  if (NT.imgs[n.id]) return NT.imgs[n.id];
  if (!NT.imgWait[n.id]) {
    NT.imgWait[n.id] = 1;
    apiFetch('/api/notices/' + n.id + '/images').then(function (r) { NT.imgs[n.id] = (r && r.data) || []; }).catch(function () { NT.imgs[n.id] = []; })
      .then(function () { delete NT.imgWait[n.id]; if (cb) cb(); });
  }
  return null;
}
function _ntImgView(src) {
  var m = createModal({ id: 'wmNoticeImg', title: '🖼 그림', width: '96vw', closeOnEsc: true, closeOnOverlay: true, html: '<div class="nt-view"><img src="' + src + '" alt=""></div>' });
  m.box.classList.add('nt-view-box');
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
  if (d.id) delete NT.imgs[d.id];
  wmNoticeInit();
  if (NT.modal && document.getElementById('wmNoticeModal') && !NT.sub) _ntLoad();   // 열어 둔 목록은 새로 (쓰는 중 · 다른 화면이면 그대로)
}

/* ─── '중요' 공지 창 ─── */
function _ntPopup(list) {
  if (document.getElementById('wmNoticePop')) return;
  list.forEach(function (n) { NT.popShown[n.id] = 1; });
  var redraw = function () { list.forEach(function (n) { var el = document.querySelector('#wmNoticePop [data-pb="' + n.id + '"]'); if (el) el.innerHTML = _ntBody(n.body, _ntImgs(n, redraw)); }); };
  var html = '<div class="nt-pop">' + list.map(function (n) {
    return '<article class="nt-pop-i"><h4><span class="nt-chip imp">중요</span>' + _ntE(n.title) + '</h4><div class="nt-meta">' + _ntE(n.authorName || '') + ' · ' + _ntDate(n.publishedAt) + '</div><div class="nt-body" data-pb="' + n.id + '">' + _ntBody(n.body, _ntImgs(n, redraw)) + '</div></article>';
  }).join('') + '</div><div class="nt-foot"><button type="button" class="nt-btn" data-nt="pop-later">나중에 보기</button><button type="button" class="nt-btn pri" data-nt="pop-ok">확인했습니다</button></div>';
  var m = createModal({ id: 'wmNoticePop', title: '📢 중요 공지' + (list.length > 1 ? ' ' + list.length + '건' : ''), width: list.some(function (n) { return n.imageCount; }) ? '760px' : '560px', html: html, closeOnEsc: true });
  m.box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-nt]'); if (!b) return;
    if (b.dataset.nt === 'img') return _ntImgView(b.src);
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
  m.box.addEventListener('input', function (e) { if (e.target && e.target.id === 'ntWSearch') _ntWritersFilter(e.target.value); if (e.target && e.target.id === 'ntBody') _ntPvSync(); });
  m.box.addEventListener('change', function (e) { if (e.target && e.target.id === 'ntFile') { _ntAddFiles(e.target.files); e.target.value = ''; } });
  m.box.addEventListener('paste', function (e) {
    if (NT.sub !== 'edit' || !e.clipboardData) return;
    var fs = [].filter.call(e.clipboardData.files || [], function (f) { return /^image\//.test(f.type); });
    if (fs.length) { e.preventDefault(); _ntAddFiles(fs, true); }
  });
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
  if (NT.sub === 'edit') return document.getElementById('ntBody') ? undefined : _ntDrawEdit(root);   // 쓰는 중에는 다시 그리지 않는다
  if (NT.modal) NT.modal.box.classList.remove('nt-wide');
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
        '<b class="nt-title">' + _ntE(n.title) + '</b>' + (n.imageCount ? '<span class="nt-prev-img" title="그림 ' + n.imageCount + '장">🖼 ' + n.imageCount + '</span>' : '') + '</div>' +
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
        (op ? '<div class="nt-body">' + (_ntBody(n.body, _ntImgs(n, _ntDraw)) || '<span class="nt-hint">내용 없음</span>') + '</div>' : '<div class="nt-prev">' + (n.imageCount ? '<span class="nt-prev-img" title="그림 ' + n.imageCount + '장">🖼 ' + n.imageCount + '</span>' : '') + _ntE(_ntPlain(n.body).slice(0, 140)) + '</div>') + '</article>';
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
  root.innerHTML = '<div class="nt-bar"><button type="button" class="nt-btn" data-nt="back">← 목록</button><b class="nt-ed-t">' + (isNew ? '새 공지 쓰기' : '공지 고치기') + '</b><span class="nt-sp"></span>' + (isNew ? '<button type="button" class="nt-btn" data-nt="sample" title="꾸민 공지가 어떻게 보이는지 예시를 채워 넣습니다 (공수 등록 안내 · 캡처 3장) — 고쳐서 그대로 게시해도 됩니다">✨ 예시 넣기</button>' : '') + (live ? '<span class="nt-chip st-live">게시 중</span>' : '<span class="nt-chip st-draft">임시</span>') + '</div>' +
    '<div class="nt-form">' +
    '<label class="nt-f"><span>제목</span><input type="text" id="ntTitle" maxlength="200" placeholder="예: 11월 정기 점검 안내" value="' + _ntE(n.title || '') + '"></label>' +
    '<div class="nt-f"><span>내용</span>' +
    '<div class="nt-tools" role="toolbar" aria-label="꾸미기">' +
      '<button type="button" class="nt-tool" data-nt="fmt" data-v="h1" title="큰 제목 — 줄 앞에 #">제목</button>' +
      '<button type="button" class="nt-tool" data-nt="fmt" data-v="h2" title="작은 제목 — 줄 앞에 ##">소제목</button>' +
      '<button type="button" class="nt-tool" data-nt="fmt" data-v="b" title="굵게 — **글자**"><b>굵게</b></button>' +
      '<button type="button" class="nt-tool" data-nt="fmt" data-v="hl" title="형광펜 — ==글자=="><mark>형광</mark></button>' +
      '<button type="button" class="nt-tool" data-nt="fmt" data-v="ul" title="목록 — 줄 앞에 -">• 목록</button>' +
      '<button type="button" class="nt-tool" data-nt="fmt" data-v="ol" title="번호 목록 — 줄 앞에 1.">1. 번호</button>' +
      '<button type="button" class="nt-tool" data-nt="fmt" data-v="call" title="강조 상자 — 줄 앞에 >">💡 상자</button>' +
      '<button type="button" class="nt-tool" data-nt="fmt" data-v="hr" title="구분선 — ---">― 선</button>' +
      '<span class="nt-sp"></span><button type="button" class="nt-tool pri" data-nt="img-add" title="그림 파일 고르기 — 캡처는 내용 칸에 Ctrl+V 로 바로 붙여도 됩니다 (8장까지)">🖼 그림 붙이기</button><input type="file" id="ntFile" accept="image/*" multiple hidden></div>' +
    '<div class="nt-split"><textarea id="ntBody" rows="14" aria-label="내용" placeholder="공지 내용을 적어 주세요 — 위 단추로 꾸미고, 캡처는 Ctrl+V 로 붙이면 됩니다">' + _ntE(n.body || '') + '</textarea>' +
      '<div class="nt-pv"><div class="nt-pv-t">미리보기</div><div class="nt-body" id="ntPv"></div></div></div>' +
    '<div class="nt-thumbs" id="ntThumbs"></div></div>' +
    '<div class="nt-opts">' +
    '<label class="nt-chk"><input type="checkbox" id="ntImp"' + (n.level === 'important' ? ' checked' : '') + '> <b>중요</b> — 로그인하면 창으로 띄움</label>' +
    '<label class="nt-chk"><input type="checkbox" id="ntPin"' + (n.pinned ? ' checked' : '') + '> 📌 맨 위 고정</label>' +
    '<label class="nt-f inl"><span>게시 끝</span><input type="datetime-local" id="ntExp" value="' + _ntToLocal(n.expiresAt) + '" title="이때가 지나면 목록에서 내려갑니다 (비우면 계속 게시)"></label>' +
    '</div>' +
    (live ? '<label class="nt-chk nt-renotify"><input type="checkbox" id="ntNotify"> 고친 내용을 <b>다시 알림</b> — 모두에게 새 공지처럼 (안 읽음으로 돌아감)</label>' : '') +
    '</div>' +
    '<div class="nt-foot">' + (isNew ? '' : '<button type="button" class="nt-btn dng" data-nt="del" data-id="' + n.id + '">지우기</button>') + '<span class="nt-sp"></span>' +
    (live ? '<button type="button" class="nt-btn pri" data-nt="save">저장</button>' : '<button type="button" class="nt-btn" data-nt="save">임시 저장</button><button type="button" class="nt-btn pri" data-nt="save-pub">📢 게시</button>') + '</div>';
  var t = document.getElementById('ntTitle'); if (t && isNew) setTimeout(function () { if (!root.contains(document.activeElement)) t.focus(); }, 30);   // 이미 다른 칸을 쓰고 있으면 빼앗지 않는다
  if (NT.modal) NT.modal.box.classList.add('nt-wide');
  // 붙어 있던 그림 불러오기 (고치기)
  NT.eimgs = []; NT.eimgs0 = n.id && n.imageCount ? '?' : _ntImgSig();
  if (n.id && n.imageCount) {
    var take = function () { if (NT.sub !== 'edit' || NT.edit !== n) return; NT.eimgs = (NT.imgs[n.id] || []).slice(); NT.eimgs0 = _ntImgSig(); _ntEdSync(); };
    if (_ntImgs(n, take)) take();
  }
  _ntEdSync();
}
function _ntImgSig() { return NT.eimgs.length + ':' + NT.eimgs.map(function (s) { return s.length; }).join(','); }
/* 쓰는 화면 — 미리보기 · 붙인 그림 줄 */
function _ntPvSync() {
  var pv = document.getElementById('ntPv'), ta = document.getElementById('ntBody'); if (!pv || !ta) return;
  pv.innerHTML = _ntBody(ta.value, NT.eimgs) || '<span class="nt-hint">여기에 게시될 모습이 보입니다</span>';
}
function _ntEdSync() {
  var th = document.getElementById('ntThumbs');
  if (th) th.innerHTML = NT.eimgs.length ? NT.eimgs.map(function (src, i) {
    return '<div class="nt-thumb"><img src="' + src + '" alt="그림 ' + (i + 1) + '"><button type="button" class="nt-thumb-n" data-nt="img-put" data-i="' + i + '" title="내용의 지금 자리에 [그림' + (i + 1) + '] 넣기">그림' + (i + 1) + ' ↵</button><button type="button" class="nt-thumb-x" data-nt="img-del" data-i="' + i + '" title="이 그림 빼기" aria-label="그림 빼기">✕</button></div>';
  }).join('') + '<span class="nt-hint">그림을 넣고 싶은 줄에 <b>[그림1]</b> 처럼 적으면 그 자리에 들어갑니다. 안 적은 그림은 글 아래에 차례로 붙습니다.</span>' : '';
  _ntPvSync();
}
/* 내용 칸의 지금 자리에 글 넣기 */
function _ntInsert(text) {
  var ta = document.getElementById('ntBody'); if (!ta) return;
  var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
  if (text.charAt(0) === '\n' && (a === 0 || v.charAt(a - 1) === '\n')) text = text.slice(1);
  ta.value = v.slice(0, a) + text + v.slice(b);
  ta.selectionStart = ta.selectionEnd = a + text.length;
  ta.focus(); _ntPvSync();
}
/* 꾸미기 단추 — 고른 글자를 감싸거나(굵게 · 형광), 고른 줄 앞에 기호를 붙인다(제목 · 목록 · 상자) */
function _ntFmt(k) {
  var ta = document.getElementById('ntBody'); if (!ta) return;
  var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
  if (k === 'hr') return _ntInsert('\n---\n');
  if (k === 'b' || k === 'hl') {
    var w = k === 'b' ? '**' : '==', sel = v.slice(a, b) || (k === 'b' ? '굵은 글자' : '강조할 글자');
    ta.value = v.slice(0, a) + w + sel + w + v.slice(b);
    ta.selectionStart = a + w.length; ta.selectionEnd = a + w.length + sel.length;
    ta.focus(); return _ntPvSync();
  }
  var pre = { h1: '# ', h2: '## ', ul: '- ', call: '> ' }[k];
  var ls = v.lastIndexOf('\n', a - 1) + 1, le = v.indexOf('\n', b); if (le < 0) le = v.length;
  var n = 0, block = v.slice(ls, le).split('\n').map(function (ln) {
    var bare = ln.replace(/^\s*(#{1,2}\s+|[-•·]\s+|>\s?|\d{1,2}[.)]\s+)/, '');
    n++;
    return (k === 'ol' ? n + '. ' : pre) + bare;
  }).join('\n');
  ta.value = v.slice(0, ls) + block + v.slice(le);
  ta.selectionStart = ta.selectionEnd = ls + block.length;
  ta.focus(); _ntPvSync();
}
/* 그림 넣기 — 큰 그림은 줄여서(가로 1600px 까지) 붙인다. paste=true 면 지금 자리에 [그림N] 도 넣는다 */
var NT_IMG_MAX = 8, NT_IMG_LEN = 1600000;
function _ntShrink(file) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      URL.revokeObjectURL(url);
      var tryAt = function (maxW, type, q) {
        var k = Math.min(1, maxW / im.naturalWidth, 2600 / im.naturalHeight), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        var x = c.getContext('2d');
        if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
        x.drawImage(im, 0, 0, c.width, c.height);
        return c.toDataURL(type, q);
      };
      // 캡처는 PNG 가 또렷하다 — 너무 크면 JPEG 로, 그래도 크면 더 줄인다
      var out = /png/.test(file.type) ? tryAt(1600, 'image/png') : '';
      if (!out || out.length > 900000) out = tryAt(1600, 'image/jpeg', 0.88);
      if (out.length > NT_IMG_LEN) out = tryAt(1280, 'image/jpeg', 0.8);
      if (out.length > NT_IMG_LEN) out = tryAt(1000, 'image/jpeg', 0.7);
      out.length > NT_IMG_LEN ? rej(new Error('그림이 너무 큽니다')) : res(out);
    };
    im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('그림을 읽지 못했습니다')); };
    im.src = url;
  });
}
/* ✨ 예시 — 꾸민 공지 한 편 (공수 등록 안내). 캡처는 pwa/notice/ 에 실어 둔 것(/notice-img/…)을 붙인다 */
var NT_SAMPLE = {
  title: '📝 공수 등록 화면이 생겼습니다 — 업무 관리자에서 쓰고 바로 애니웍스에 올리기',
  imgs: ['/notice-img/gongsu-where.png', '/notice-img/gongsu-write.png', '/notice-img/gongsu-history.png'],
  body: [
    '# 📝 공수 등록 화면이 생겼습니다',
    '애니웍스 업무보고(공수)를 이제 **업무 관리자에서 쓰고 바로 올릴 수** 있습니다.',
    '따로 켜 두던 주간일지 · 공수등록 프로그램은 쓰지 않아도 됩니다.',
    '',
    '> 💡 애니웍스에 올리는 것은 **PC 앱(업무 관리자)** 에서 됩니다.',
    '> 웹 · 휴대폰에서는 작성 · 저장 · 이력 보기까지 됩니다.',
    '',
    '## 📍 어디에 있나요',
    '- **내 업무** 화면 위쪽 도구 막대의 ==📝 공수== 단추',
    '- 주간 분석 화면의 ⋯ 메뉴 → 📝 공수 등록 (애니웍스)',
    '[그림1]',
    '',
    '## ✍️ 쓰는 방법',
    '1. (처음 한 번) **🔑 계정 연결** — 애니웍스 아이디 · 비밀번호를 넣습니다. 그 PC 에만 암호화해 저장합니다.',
    '2. 날짜를 고르고 수주번호 · 시간 · 사내외 · 업무구분 · 작업내용(50자)을 적습니다. 쓰는 대로 자동 저장됩니다.',
    '3. 수주번호를 모르면 🔍 로 찾습니다 (수주번호 · 고객명 · 프로젝트명).',
    '4. **① 웹에 입력 · 확인** — 애니웍스 화면에 들어간 모습을 보여 줍니다.',
    '5. 맞으면 **② 애니웍스에 등록** — 올린 뒤 주간일지에서 올라갔는지까지 확인합니다.',
    '[그림2]',
    '',
    '## 📚 이력 — 지난 공수 다시 쓰기',
    '- 공수 등록 창의 ==📚 이력== 에서 날짜별로 써 둔 것 · 올린 것을 모아 봅니다.',
    '- 행을 골라 **다른 날짜에 복사**해서 고쳐 쓸 수 있습니다.',
    '[그림3]',
    '',
    '---',
    '> PC 앱은 최신 버전으로 올려 주세요. 쓰다가 이상한 점이 있으면 알려 주세요.'
  ].join('\n')
};
async function _ntSample(btn) {
  var g = function (id) { return document.getElementById(id); };
  if ((g('ntTitle').value.trim() || g('ntBody').value.trim() || NT.eimgs.length) && !(await wmConfirm('쓰던 내용을 예시로 바꿀까요?', { ok: '바꾸기' }))) return;
  if (NT.sub !== 'edit' || !g('ntBody')) return;
  g('ntTitle').value = NT_SAMPLE.title; g('ntBody').value = NT_SAMPLE.body; g('ntImp').checked = true;
  NT.eimgs = []; _ntEdSync();
  if (btn) btn.disabled = true;
  try {
    for (var i = 0; i < NT_SAMPLE.imgs.length; i++) {
      var r = await fetch(NT_SAMPLE.imgs[i]);
      if (!r.ok) throw new Error('예시 그림을 받지 못했습니다');
      var src = await _ntShrink(await r.blob());
      if (NT.sub !== 'edit' || !g('ntBody')) return;
      NT.eimgs.push(src); _ntEdSync();
    }
  } catch (e) { _ntToast(_ntErr(e) + ' — 글만 넣었습니다', 'warn'); }
  finally { if (btn) btn.disabled = false; }
}
async function _ntAddFiles(files, paste) {
  var list = [].filter.call(files || [], function (f) { return /^image\//.test(f.type); });
  for (var i = 0; i < list.length; i++) {
    if (NT.eimgs.length >= NT_IMG_MAX) { _ntToast('그림은 ' + NT_IMG_MAX + '장까지 붙일 수 있습니다', 'warn'); break; }
    try {
      var src = await _ntShrink(list[i]);
      if (NT.sub !== 'edit') return;
      NT.eimgs.push(src);
      if (paste) _ntInsert('\n[그림' + NT.eimgs.length + ']\n');
    } catch (e) { _ntToast(_ntErr(e), 'error'); }
  }
  _ntEdSync();
}
function _ntFormVal() {
  var g = function (id) { return document.getElementById(id); };
  var exp = g('ntExp').value;
  return { title: g('ntTitle').value.trim(), body: g('ntBody').value, level: g('ntImp').checked ? 'important' : 'normal', pinned: g('ntPin').checked, expiresAt: exp ? new Date(exp).toISOString() : null, notify: !!(g('ntNotify') && g('ntNotify').checked), images: NT.eimgs.slice() };
}
function _ntDirty() {
  if (NT.sub !== 'edit' || !document.getElementById('ntTitle')) return false;
  var v = _ntFormVal(), n = NT.edit || {};
  return (NT.eimgs0 !== '?' && _ntImgSig() !== NT.eimgs0) || v.title !== (n.title || '') || v.body !== (n.body || '') || v.level !== (n.level || 'normal') || v.pinned !== !!n.pinned || _ntToLocal(v.expiresAt) !== _ntToLocal(n.expiresAt);
}
async function _ntSave(publish, btn) {
  var v = _ntFormVal(), n = NT.edit || {};
  if (!v.title) { _ntToast('제목을 적어 주세요', 'warn'); var t = document.getElementById('ntTitle'); if (t) t.focus(); return; }
  if (v.expiresAt && new Date(v.expiresAt) <= new Date() && !(await wmConfirm('게시 끝 시각이 이미 지났습니다. 그대로 저장할까요? (목록에 보이지 않습니다)'))) return;
  if (publish && !(await wmConfirm('이 공지를 게시할까요? 모든 사용자에게 알림이 갑니다.'))) return;
  if (NT.eimgs0 === '?') delete v.images;     // 붙어 있던 그림을 아직 못 받았으면 그림은 건드리지 않는다
  if (btn) btn.disabled = true;
  if (n.id) delete NT.imgs[n.id];
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
  if (k === 'img') return _ntImgView(b.src);
  if (k === 'fmt') return _ntFmt(b.dataset.v);
  if (k === 'sample') return _ntSample(b);
  if (k === 'img-add') { var fi = document.getElementById('ntFile'); if (fi) fi.click(); return; }
  if (k === 'img-del') { NT.eimgs.splice(+b.dataset.i, 1); return _ntEdSync(); }
  if (k === 'img-put') return _ntInsert('\n[그림' + (+b.dataset.i + 1) + ']\n');
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
