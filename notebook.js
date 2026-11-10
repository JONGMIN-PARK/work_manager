/* ═══════════════════════════════════════════════════════════════════════
   notebook.js — 📓 노트북 (v13.316)
   ─────────────────────────────────────────────────────────────────────
   화면: 왼쪽(새 노트 · 찾기 · 모든 노트 · 낙서장 · 고정 · 즐겨찾기 · 일일 노트 · 휴지통 · 폴더 · 태그) | 목록 | 편집기
   편집기: 마크다운 — ✏️ 편집 · ◫ 나란히 · 👁 보기 · 서식 단추 · / 명령 · 목록 이어 쓰기 · Tab 들여쓰기 · 붙여넣기/끌어 놓기 사진 · 첨부
           ✍️ 손글씨 칸(::ink[id]) · 🖍 마커(노트 위에 덮어 그리기) — notebook-ink.js
           자동 저장(차례대로 · rev 충돌 409 → 고르기) · 저장 전 글은 이 기기에 임시 보관 · 고친 기록 · 내보내기(.md · Word · 인쇄/PDF)
           ✨ AI — 메일 초안 · 번역 · 다듬기 · 요약 (고른 부분 또는 전체)
   📥 낙서장 빨리 적기 — 어느 화면에서든 Alt+N (글 · 펜)
   📅 일일 노트 — 예전 📝 노트 서랍(/api/my-work/notes) 을 같은 편집기로
   전역: renderNotebook · nbOpenNote(id, kw) · nbQuickOpen · nbNewFrom(body, title, opts)
   의존: apiFetch · API_BASE · _accessToken · showToast · createModal · wmGuardedModal · eH · setPage · NbMd · NbInk
   ═══════════════════════════════════════════════════════════════════════ */

var NB = {
  inited: false, meta: null, view: 'all', folder: null, tag: null, q: '', sort: 'updated', list: [], daily: [],
  cur: null, daily1: null, mode: 'split', pane: 'list', saving: null, timer: null, conflict: null, conflictKey: null,
  // v13.332 저장 — 노트(일일 노트)마다 따로 대기: pend[key] = 그때 값 · revs[id] = 마지막으로 안 서버 rev · err[key] = 다시 보내지 않을 오류
  pend: {}, revs: {}, err: {}, sending: {}, retryN: 0, retryT: null, dtimer: null, openSeq: 0,
  inkEd: null, inkId: null, overEd: null, overHide: false, blobs: {}, focus: false, seq: 0
};
var NB_LS = 'nb-prefs';
var NB_TEMPLATES = [
  { k: 'blank', icon: '📄', name: '빈 노트', body: '' },
  { k: 'daily', icon: '📋', name: '일일 업무 (내 일정 · 할 일로 채움)', server: true },
  { k: 'meeting', icon: '🤝', name: '회의록', title: '회의록 — ', body: '## 개요\n- **일시**: \n- **장소**: \n- **참석**: \n\n## 안건\n1. \n\n## 논의 내용\n- \n\n## 결정 사항\n> [!IMPORTANT] 결정\n> \n\n## 할 일\n| 할 일 | 담당 | 기한 |\n|---|---|---|\n|  |  |  |\n\n## 다음 회의\n- ' },
  { k: 'review', icon: '🔍', name: '기술 검토', title: '기술 검토 — ', body: '## 배경 · 목적\n\n## 요구 사항\n- [ ] \n\n## 검토 안\n| 항목 | A안 | B안 |\n|---|---|---|\n| 비용 |  |  |\n| 일정 |  |  |\n| 위험 |  |  |\n\n## 결론 · 추천\n> [!TIP] 추천\n> \n\n## 남은 확인\n- [ ] ' },
  { k: 'trip', icon: '✈️', name: '출장 보고', title: '출장 보고 — ', body: '## 출장 개요\n- **기간**: \n- **장소 · 고객**: \n- **목적**: \n\n## 주요 결과 (요약)\n1. \n\n## 상세 내용\n\n## 고객 요청 · 이슈\n- \n\n## 후속 조치\n- [ ] \n' },
  { k: 'why', icon: '🧩', name: '문제 분석 (5 Why)', title: '문제 분석 — ', body: '## 현상\n> [!WARNING] 무엇이 · 언제 · 어디서 · 얼마나\n> \n\n## 5 Why\n1. 왜? \n2. 왜? \n3. 왜? \n4. 왜? \n5. 왜? \n\n## 근본 원인\n\n## 대책\n| 구분 | 내용 | 담당 | 기한 |\n|---|---|---|---|\n| 임시 |  |  |  |\n| 항구 |  |  |  |\n\n## 효과 확인\n- [ ] ' },
  { k: 'mail', icon: '✉️', name: '메일 메모', title: '메일 — ', body: '**받는 사람**: \n**용건**: \n\n## 전할 내용\n- \n\n## 요청 · 기한\n- \n\n> [!TIP] 다 쓰고 ✨ AI › 메일 초안 을 누르면 업무 메일로 다듬어 줍니다\n' }
];
var NB_SLASH = [
  ['h1', '제목 1', '# '], ['h2', '제목 2', '## '], ['h3', '제목 3', '### '],
  ['todo', '체크리스트', '- [ ] '], ['ul', '글머리 목록', '- '], ['ol', '번호 목록', '1. '],
  ['quote', '인용', '> '], ['note', '알림 상자 · 참고', '> [!NOTE] \n> '], ['tip', '알림 상자 · 팁', '> [!TIP] \n> '], ['warn', '알림 상자 · 주의', '> [!WARNING] \n> '],
  ['table', '표', '| 항목 | 내용 |\n|---|---|\n|  |  |\n'], ['code', '코드 블록', '```\n\n```'], ['hr', '구분선', '---\n'],
  ['ink', '✍️ 손글씨 칸', null], ['img', '🖼 사진 · 파일', null], ['date', '📅 오늘 날짜', null], ['time', '🕒 지금 시각', null]
];

function _nbToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _nbErr(e) { return (e && e.message) || '오류'; }
function _nbE(s) { return typeof eH === 'function' ? eH(s) : NbMd.esc(s); }
function _nbLS(k, v) {
  try {
    var o = JSON.parse(localStorage.getItem(NB_LS) || '{}');
    if (v === undefined) return o[k];
    o[k] = v; localStorage.setItem(NB_LS, JSON.stringify(o));
  } catch (_) { return undefined; }
}
function _nbUid() { return (typeof currentUser !== 'undefined' && currentUser) ? String(currentUser.sub || currentUser.id || '') : ''; }
/** 못 보낸 노트 글 임시 보관 — 사람마다 따로 (v13.332: 공용 PC 에서 다음 사람에게 보이지 않게) */
function _nbDraft(id, v) {
  var k = 'nb-draft:' + _nbUid() + ':' + id;
  try {
    if (v === undefined) {
      var raw = localStorage.getItem(k);
      if (raw == null && (raw = localStorage.getItem('nb-draft:' + id)) != null) { localStorage.removeItem('nb-draft:' + id); localStorage.setItem(k, raw); }   // 옛 이름 → 새 이름
      return JSON.parse(raw || 'null');
    }
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
  } catch (_) { return null; }
}
/** 일일 노트 임시 보관 — 📝 서랍과 같은 이름 · 모양({body, base, at}) 이라 어느 쪽에서 열어도 되살아남 */
function _nbDDraft(date, ref, v) {
  try {
    var k = 'wm.mwn.draft:' + _nbUid() + ':' + date + '|' + (ref || '');
    if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
  } catch (_) { return null; }
}
function _nbWhen(t) {
  if (!t) return '';
  var d = new Date(t), now = new Date(), diff = (now - d) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return Math.floor(diff / 60) + '분 전';
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  var y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '어제 ' + d.toTimeString().slice(0, 5);
  return (d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '. ' : '') + (d.getMonth() + 1) + '. ' + d.getDate() + '.';
}
function _nbGroup(t) {
  var d = new Date(t), now = new Date(), days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  return days <= 0 ? '오늘' : days === 1 ? '어제' : days < 7 ? '이번 주' : days < 31 ? '이번 달' : d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월';
}
function _nbToday() { var d = new Date(Date.now() + 9 * 3600000); return d.toISOString().slice(0, 10); }
function _nbRid() { return 'k' + Math.random().toString(36).slice(2, 9); }
function _nbRO() { return !!(NB.cur && (NB.cur.deletedAt || NB.cur.readOnly)); }   // 고칠 수 없는 노트 (휴지통 · 공유받음)
function _nbTitleOf(n) { return n.title || (n.snippet ? n.snippet.slice(0, 40) : '') || '제목 없음'; }

/* ═══ 시작 ═══ */
/** 글자 크기 — '' 보통 · 's' 작게 · 'l' 크게 (이 브라우저에만 기억 · v13.328) */
function _nbFs() { try { var v = localStorage.getItem('wm.nb.fs'); return v === 's' || v === 'l' ? v : ''; } catch (_) { return ''; } }
function _nbApplyFs() { var r = document.getElementById('mNotebook'); if (!r) return; var f = _nbFs(); r.classList.toggle('nb-fs-s', f === 's'); r.classList.toggle('nb-fs-l', f === 'l'); }
function renderNotebook() {
  var root = document.getElementById('mNotebook');
  if (!root) return;
  _nbApplyFs();
  if (!NB.inited) {
    NB.inited = true;
    var p = _nbLS('p') || {};
    if (typeof NBP !== 'undefined') NBP.coach = !!_nbLS('coach');
    NB.mode = p.mode || (window.innerWidth < 900 ? 'view' : 'split');
    NB.sort = p.sort || 'updated';
    NB.view = p.view || 'all'; NB.folder = p.folder || null; NB.tag = p.tag || null;
    root.innerHTML = _nbShell();
    _nbBind(root);
  }
  _nbLoadMeta().then(function () { return _nbLoadList(); }).then(function () {
    if (NB.pendingOpen) { var po = NB.pendingOpen; NB.pendingOpen = null; _nbOpen(po.id, po.kw); return; }
    if (!NB.cur && !NB.daily1) {
      _nbDrawMain();   // 빈 화면 (양식 카드)
      var last = _nbLS('last:' + _nbUid());
      if (last && window.innerWidth > 760) _nbOpen(last, null, true);
    }
  });
}
function _nbSavePrefs() { _nbLS('p', { mode: NB.mode, sort: NB.sort, view: NB.view, folder: NB.folder, tag: NB.tag }); }

function _nbShell() {
  return '<div class="nb" data-pane="list">' +
    '<aside class="nb-side" id="nbSide"></aside>' +
    '<section class="nb-list" id="nbList"><div class="nb-lh" id="nbLH"></div><div class="nb-items nb-scroll" id="nbItems" role="listbox" aria-label="노트 목록"></div></section>' +
    '<main class="nb-main" id="nbMain"></main>' +
    '</div>';
}

/* ═══ 왼쪽 ═══ */
function _nbLoadMeta() {
  return apiFetch('/api/notebook/meta').then(function (r) { NB.meta = r.data; _nbDrawSide(); }).catch(function (e) { _nbToast('❌ 노트북을 불러오지 못했습니다 — ' + _nbErr(e), 'error'); });
}
function _nbDrawSide() {
  var el = document.getElementById('nbSide'); if (!el || !NB.meta) return;
  var c = NB.meta.counts || {};
  function nav(v, icon, label, n, extra) {
    var on = NB.view === v && !NB.folder && !NB.tag && !NB.q;
    return '<button class="nb-nav' + (on ? ' on' : '') + '" data-view="' + v + '"' + (extra || '') + '><span class="nb-nav-i">' + icon + '</span><span class="nb-nav-t">' + label + '</span>' + (n ? '<span class="nb-nav-n">' + n + '</span>' : '') + '</button>';
  }
  var h = '<div class="nb-side-top">' +
    '<div class="nb-new"><button class="nb-new-b" data-nb="new" title="새 노트 (Alt+Shift+N)"><span>＋</span> 새 노트</button><button class="nb-new-m" data-nb="tpl" title="양식으로 시작" aria-label="양식으로 시작">▾</button></div>' +
    '<button class="nb-write-b" data-nb="write" title="글 종류를 고르면 양식 + ✍️ 코치가 켜진 채로 바로 (어느 화면에서든 Alt+W)">✍️ 글쓰기 · 코치와 함께 <kbd>Alt+W</kbd></button>' +
    '<button class="nb-quick-b" data-nb="quick" title="어느 화면에서든 Alt+N">📥 낙서장에 빨리 적기 <kbd>Alt+N</kbd></button>' +
    '<label class="nb-search"><span aria-hidden="true">🔍</span><input id="nbQ" type="search" placeholder="노트 찾기 — 제목 · 본문 · 태그" value="' + _nbE(NB.q) + '" autocomplete="off"></label></div>';
  h += '<div class="nb-side-sc nb-scroll"><nav class="nb-navs">' +
    nav('all', '📚', '모든 노트', c.all) + nav('inbox', '📥', '낙서장', c.inbox) + nav('pinned', '📌', '고정', c.pinned) + nav('starred', '⭐', '즐겨찾기', c.starred) +
    nav('daily', '📅', '일일 노트', c.daily) + (c.shared ? nav('shared', '👥', '공유받은 노트', c.shared) : '') + nav('trash', '🗑', '휴지통', c.trash) + '</nav>' +
    '<button class="nb-rep-b" data-nb="report" title="기간 · 폴더 · 태그의 노트를 모아 보고서로 — 주간 업무 형식 · 요약 (✨ AI)">📊 리포트 만들기</button>';
  h += '<div class="nb-sec"><span>폴더</span><button class="nb-sec-b" data-nb="fold-add" title="폴더 만들기" aria-label="폴더 만들기">＋</button></div><div class="nb-folds" id="nbFolds">';
  (NB.meta.folders || []).forEach(function (f) {
    h += '<div class="nb-fold' + (NB.folder === f.id ? ' on' : '') + '" data-folder="' + _nbE(f.id) + '" draggable="true" tabindex="0" role="button">' +
      '<span class="nb-fold-dot" style="background:' + _nbE(f.color || 'var(--ac)') + '"></span><span class="nb-fold-t">' + _nbE(f.icon ? f.icon + ' ' : '') + _nbE(f.name) + '</span>' +
      '<span class="nb-nav-n">' + (f.n || '') + '</span><button class="nb-fold-m" data-fmenu="' + _nbE(f.id) + '" title="폴더 메뉴" aria-label="폴더 메뉴">⋯</button></div>';
  });
  if (!(NB.meta.folders || []).length) h += '<div class="nb-empty-s">폴더로 노트를 묶어 보세요 — ＋</div>';
  h += '</div>';
  if ((NB.meta.tags || []).length) {
    h += '<div class="nb-sec"><span>태그</span></div><div class="nb-tags">' + NB.meta.tags.slice(0, 60).map(function (t) {
      return '<button class="nb-tag' + (NB.tag === t.tag ? ' on' : '') + '" data-tag="' + _nbE(t.tag) + '">#' + _nbE(t.tag) + ' <small>' + t.n + '</small></button>';
    }).join('') + '</div>';
  }
  h += '</div>';
  el.innerHTML = h;
}

/* ═══ 목록 ═══ */
function _nbListTitle() {
  if (NB.q) return '🔍 “' + NB.q + '”';
  if (NB.tag) return '#' + NB.tag;
  if (NB.folder) { var f = (NB.meta && NB.meta.folders || []).filter(function (x) { return x.id === NB.folder; })[0]; return f ? f.name : '폴더'; }
  return { all: '📚 모든 노트', inbox: '📥 낙서장', pinned: '📌 고정', starred: '⭐ 즐겨찾기', daily: '📅 일일 노트', trash: '🗑 휴지통', shared: '👥 공유받은 노트' }[NB.view] || '노트';
}
var NB_PAGE = 200;
/** 목록 받기 — more 면 이어서 다음 쪽 (v13.333: 한 번에 200개씩) */
function _nbLoadList(more) {
  if (more && (NB.listBusy || !NB.more)) return Promise.resolve();
  var seq = more ? NB.seq : ++NB.seq;
  if (NB.view === 'daily' && !NB.q && !NB.folder && !NB.tag) {
    return apiFetch('/api/notebook/daily').then(function (r) { if (seq !== NB.seq) return; NB.daily = r.data || []; NB.list = []; _nbDrawList(); }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
  }
  var qs = '?view=' + encodeURIComponent(NB.folder ? 'folder' : NB.tag ? 'tagged' : NB.q ? 'search' : NB.view) + '&sort=' + NB.sort;
  if (NB.folder) qs += '&folder=' + encodeURIComponent(NB.folder);
  if (NB.tag) qs += '&tag=' + encodeURIComponent(NB.tag);
  if (NB.q) qs += '&q=' + encodeURIComponent(NB.q);
  qs += '&limit=' + NB_PAGE + '&offset=' + (more ? NB.list.length : 0);
  NB.listBusy = true;
  return apiFetch('/api/notebook/notes' + qs).then(function (r) {
    if (seq !== NB.seq) return;
    var rows = r.data || [];
    if (more) { var have = {}; NB.list.forEach(function (x) { have[x.id] = 1; }); NB.list = NB.list.concat(rows.filter(function (x) { return !have[x.id]; })); }
    else NB.list = rows;
    NB.more = !!r.more;
    if (more) { var box = document.getElementById('nbItems'), st = box ? box.scrollTop : 0; _nbDrawList(); if (box) box.scrollTop = st; } else _nbDrawList();
  }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); }).then(function () { if (seq === NB.seq || more) NB.listBusy = false; });
}
function _nbDrawList() {
  var lh = document.getElementById('nbLH'), box = document.getElementById('nbItems'); if (!lh || !box) return;
  var daily = NB.view === 'daily' && !NB.q && !NB.folder && !NB.tag;
  var n = daily ? NB.daily.length : NB.list.length;
  lh.innerHTML = '<button class="nb-back" data-nb="to-side" aria-label="메뉴">☰</button><b class="nb-lh-t">' + _nbE(_nbListTitle()) + '</b><span class="nb-lh-n">' + n + (NB.more && !daily ? '+' : '') + '</span>' +
    (NB.view === 'trash' && n ? '<button class="nb-lh-b" data-nb="empty-trash">비우기</button>' : '') +
    (n && typeof wmBookOpen === 'function' ? '<button class="nb-lh-b" data-nb="book" title="📖 펼쳐 보기 — 노트 · 일일 노트 · 업무일지 · 회의록을 책처럼 2~4장 나란히">📖</button>' : '') +
    (daily && n ? '<button class="nb-lh-b" data-nb="print-bundle" title="여러 날 일일 노트를 일일 업무 보고 양식으로 묶어 출력">🖨 묶어 출력</button>' : '') +
    (daily || NB.view === 'trash' ? '' : '<select class="nb-sort" id="nbSort" aria-label="정렬"><option value="updated"' + (NB.sort === 'updated' ? ' selected' : '') + '>고친 순</option><option value="created"' + (NB.sort === 'created' ? ' selected' : '') + '>만든 순</option><option value="title"' + (NB.sort === 'title' ? ' selected' : '') + '>제목 순</option></select>') +
    (daily || NB.view === 'trash' ? '' : '<button class="nb-lh-new" data-nb="new" title="새 노트" aria-label="새 노트">＋</button>');
  var h = '';
  if (daily) {
    if (!NB.daily.length) h = '<div class="nb-empty">📅 일일 노트가 없습니다<small>내 업무 › 📝 노트 에서 날마다 적은 메모가 여기 모입니다</small></div>';
    var lastG = '';
    NB.daily.forEach(function (d) {
      var g = d.date.slice(0, 7); if (g !== lastG) { h += '<div class="nb-grp">' + d.date.slice(0, 4) + '년 ' + (+d.date.slice(5, 7)) + '월</div>'; lastG = g; }
      var on = NB.daily1 && NB.daily1.date === d.date && NB.daily1.ref === d.ref;
      h += '<div class="nb-it' + (on ? ' on' : '') + '" role="option" tabindex="0" data-daily="' + _nbE(d.date) + '" data-ref="' + _nbE(d.ref) + '"><div class="nb-it-t">' + (d.ref ? '🤝 회의 메모' : '📅 ' + (+d.date.slice(5, 7)) + '/' + (+d.date.slice(8, 10)) + ' 노트') + '</div>' +
        '<div class="nb-it-s">' + _nbE(d.snippet) + '</div><div class="nb-it-m">' + _nbE(d.date) + '</div></div>';
    });
    box.innerHTML = h; return;
  }
  if (!NB.list.length) {
    h = NB.q ? '<div class="nb-empty">찾는 노트가 없습니다</div>'
      : NB.view === 'trash' ? '<div class="nb-empty">🗑 휴지통이 비었습니다<small>지운 노트는 30일 뒤 사라집니다</small></div>'
      : NB.view === 'inbox' ? '<div class="nb-empty">📥 낙서장이 비었습니다<small>Alt+N · 텔레그램 /memo · 메신저 [노트로] 로 적은 것이 여기 쌓입니다</small></div>'
      : '<div class="nb-empty">📓 노트가 없습니다<button class="nb-btn pri" data-nb="new">＋ 첫 노트 쓰기</button></div>';
  }
  var lastG2 = '', usePin = NB.view !== 'trash' && NB.sort !== 'title';
  NB.list.forEach(function (it) {
    var g = it.pinned && usePin ? '📌 고정' : NB.sort === 'title' ? '' : _nbGroup(NB.view === 'trash' ? it.deletedAt : NB.sort === 'created' ? it.createdAt : it.updatedAt);
    if (g && g !== lastG2) { h += '<div class="nb-grp">' + _nbE(g) + '</div>'; lastG2 = g; }
    var on = NB.cur && NB.cur.id === it.id;
    var f = it.folderId && NB.meta ? (NB.meta.folders || []).filter(function (x) { return x.id === it.folderId; })[0] : null;
    h += '<div class="nb-it' + (on ? ' on' : '') + '" role="option" aria-selected="' + on + '" tabindex="0" draggable="' + (NB.view !== 'trash' && NB.view !== 'shared') + '" data-id="' + _nbE(it.id) + '">' +
      (it.thumb ? '<img class="nb-it-th" data-nbf="' + _nbE(it.thumb) + '" alt="">' : '') +
      '<div class="nb-it-t">' + (it.starred ? '<span class="nb-star">★</span>' : '') + _nbE(_nbTitleOf(it)) + '</div>' +
      '<div class="nb-it-s">' + (it.hit ? '…' + _nbHl(it.hit, NB.q) + '…' : _nbE(it.snippet || '')) + '</div>' +
      '<div class="nb-it-m">' + (it.ownerName ? '<span class="nb-it-own">👥 ' + _nbE(it.ownerName) + '</span>' : '') + '<span>' + _nbWhen(NB.view === 'trash' ? it.deletedAt : it.updatedAt) + '</span>' + (f ? '<span class="nb-it-f"><i style="background:' + _nbE(f.color || 'var(--ac)') + '"></i>' + _nbE(f.name) + '</span>' : '') +
      (it.hasInk ? '<span title="손글씨">✍️</span>' : '') + (it.source === 'telegram' ? '<span title="텔레그램에서">✈️</span>' : it.source === 'chat' ? '<span title="메신저에서">💬</span>' : '') +
      (it.tags || []).slice(0, 3).map(function (t) { return '<span class="nb-it-tag">#' + _nbE(t) + '</span>'; }).join('') + '</div>' +
      (NB.view === 'trash' ? '<div class="nb-it-act"><button class="nb-btn sm" data-restore="' + _nbE(it.id) + '">되살리기</button><button class="nb-btn sm danger" data-purge="' + _nbE(it.id) + '">영구 삭제</button></div>' : '') +
      '</div>';
  });
  if (NB.more) h += '<button class="nb-more" data-nb="more-list">아래로 더 보기</button>';
  box.innerHTML = h;
  _nbLoadImgs(box);
  // 끝에 닿으면 저절로 다음 쪽
  if (NB.moreIO) NB.moreIO.disconnect();
  var mb = box.querySelector('.nb-more');
  if (mb && typeof IntersectionObserver !== 'undefined') { NB.moreIO = new IntersectionObserver(function (es) { if (es[0].isIntersecting) _nbLoadList(true); }, { root: box, rootMargin: '200px' }); NB.moreIO.observe(mb); }
}
function _nbHl(s, q) {
  var e = _nbE(s); if (!q) return e;
  var qe = _nbE(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return e.replace(new RegExp(qe, 'gi'), function (m) { return '<mark>' + m + '</mark>'; });
}

/** 인증 붙은 받기 — 토큰이 끝났으면(401) 갱신 뒤 한 번 더 (v13.332) */
function _nbAuthFetch(path) {
  function go() { return fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + path, { headers: { Authorization: 'Bearer ' + (typeof _accessToken !== 'undefined' ? _accessToken : '') } }); }
  return go().then(function (res) {
    if (res.status === 401 && typeof _tryRefresh === 'function') return _tryRefresh().then(function (ok) { return ok ? go() : res; });
    return res;
  });
}
/* 첨부 사진 — 인증이 필요한 주소라 받아서 blob */
function _nbBlob(fid) {
  if (NB.blobs[fid]) return NB.blobs[fid];
  NB.blobs[fid] = _nbAuthFetch('/api/notebook/files/' + encodeURIComponent(fid)).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) return res.json().then(function (j) { return j.data.url; });
    return res.blob().then(function (b) { return URL.createObjectURL(b); });
  });
  NB.blobs[fid].catch(function () { delete NB.blobs[fid]; });
  return NB.blobs[fid];
}
function _nbLoadImgs(root) {
  root.querySelectorAll('img[data-nbf]').forEach(function (img) {
    var id = img.getAttribute('data-nbf'); img.removeAttribute('data-nbf'); img.setAttribute('data-nbfid', id);
    _nbBlob(id).then(function (u) { img.src = u; }).catch(function () { img.alt = '🖼 사진을 불러오지 못했습니다'; img.classList.add('nb-img-err'); });
  });
}
function _nbDownload(fid, name) {
  _nbAuthFetch('/api/notebook/files/' + encodeURIComponent(fid) + '?dl=1').then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var ct = res.headers.get('content-type') || '';
    if (ct.indexOf('application/json') >= 0) return res.json().then(function (j) { window.open(j.data.url, '_blank', 'noopener'); });
    return res.blob().then(function (b) { _nbSaveBlob(b, name || 'file'); });
  }).catch(function () { _nbToast('❌ 파일을 받지 못했습니다', 'error'); });
}
function _nbSaveBlob(b, name) {
  var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
}

/* ═══ 노트 열기 ═══ */
function nbOpenNote(id, kw) {
  if (typeof setPage === 'function' && typeof curPage !== 'undefined' && curPage !== 'notebook') {
    NB.pendingOpen = { id: id, kw: kw };
    setPage('notebook'); return;
  }
  _nbOpen(id, kw);
}
function _nbOpen(id, kw, quiet) {
  if (NB.cur && NB.cur.id === id) { _nbSetPane('note'); return Promise.resolve(); }
  var seq = ++NB.openSeq;   // 빨리 여러 개를 누르면 마지막 것만 그림
  _nbInkStop();
  // 보내던 글이 다 닿은 뒤에 받음 — 방금 고친 것이 옛 글로 보이지 않게
  return _nbFlush().then(function () { return apiFetch('/api/notebook/notes/' + encodeURIComponent(id)); }).then(function (r) {
    if (seq !== NB.openSeq) return;
    var n = r.data, key = 'n:' + id, p = NB.pend[key];
    if (p) {   // 아직 못 보낸 글 — 그 위에 얹고 기준 rev 는 그대로 (그새 다른 곳에서 고쳤으면 충돌로 알림)
      if (p.f.title || p.force) n.title = p.title;
      if (p.f.body || p.force) n.body = p.body;
      if (p.f.ink || p.force) n.ink = p.ink;
      if (NB.revs[id] == null) NB.revs[id] = n.rev;
      delete NB.err[key]; if (NB.conflictKey === key) NB.conflictKey = null;
    } else NB.revs[id] = n.rev;
    NB.cur = n; NB.daily1 = null; NB.conflict = null;
    if (typeof NBP !== 'undefined') { NBP.ai = null; NBP.sp = null; NBP.open = {}; NBP.kindOver = null; NBP.filter = ''; }
    _nbLS('last:' + _nbUid(), id);
    _nbDrawMain();
    _nbMarkList();
    _nbSetPane('note');
    if (p) _nbQueue(10); else _nbDraftCheck(n);
    if (kw) setTimeout(function () { _nbFindInDoc(kw); }, 60);
  }).catch(function (e) { if (seq !== NB.openSeq) return; if (!quiet) _nbToast('❌ 노트를 열지 못했습니다 — ' + _nbErr(e), 'error'); else _nbLS('last:' + _nbUid(), null); });
}
function _nbOpenDaily(date, ref) {
  ref = ref || '';
  var seq = ++NB.openSeq;
  _nbInkStop();
  return _nbFlush().then(function () { return apiFetch('/api/my-work/notes?date=' + encodeURIComponent(date)); }).then(function (r) {
    if (seq !== NB.openSeq) return;
    var srv = ''; (r.data.notes || []).forEach(function (n) { if (n.ref === ref) srv = n.body; });
    var p = NB.pend['d:' + date + '|' + ref], b = p ? p.body : srv, back = false;
    if (!p) {   // 이 기기에 남은 못 보낸 글 (📝 서랍 · 노트북 같이 씀)
      var d = _nbDDraft(date, ref);
      if (d && d.body !== srv) { b = d.base === srv ? d.body : (srv ? srv + '\n\n' : '') + '— 저장 못 한 글 (' + new Date(d.at).toTimeString().slice(0, 5) + ') —\n' + d.body; back = true; }
      else if (d) _nbDDraft(date, ref, null);
    }
    NB.cur = null; NB.conflict = null;
    NB.daily1 = { date: date, ref: ref, body: b, srv: srv, title: (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)) + (ref ? ' 회의 메모' : ' 일일 노트') };
    _nbDrawMain(); _nbMarkList(); _nbSetPane('note');
    if (back) { _nbPendOf(NB.daily1); _nbQueue(10); _nbToast('↩️ 저장 못 했던 글을 되살렸습니다'); }
    else if (p) _nbQueue(10);
  }).catch(function (e) { if (seq === NB.openSeq) _nbToast('❌ ' + _nbErr(e), 'error'); });
}
function _nbMarkList() {
  document.querySelectorAll('#nbItems .nb-it').forEach(function (el) {
    var on = NB.cur ? el.getAttribute('data-id') === NB.cur.id : NB.daily1 ? el.getAttribute('data-daily') === NB.daily1.date && el.getAttribute('data-ref') === NB.daily1.ref : false;
    el.classList.toggle('on', on); el.setAttribute('aria-selected', on);
  });
}
function _nbSetPane(p) {
  NB.pane = p;
  var r = document.querySelector('#mNotebook .nb'); if (r) r.setAttribute('data-pane', p);
}

/* ═══ 편집기 그리기 ═══ */
function _nbDoc() { return NB.cur || NB.daily1; }
function _nbDrawMain() {
  var m = document.getElementById('nbMain'); if (!m) return;
  var n = _nbDoc();
  var root = document.querySelector('#mNotebook .nb');
  if (root) root.classList.toggle('nb-focus', !!NB.focus);
  if (!n) {
    m.innerHTML = '<div class="nb-blank"><div class="nb-blank-i">📓</div><b>노트를 고르거나 새로 쓰세요</b>' +
      '<button class="nb-btn pri nb-blank-w" data-nb="write">✍️ 글쓰기 시작 — 코치와 함께</button>' +
      '<div class="nb-blank-g">' + NB_TEMPLATES.map(function (t) { return '<button class="nb-tplc" data-tpl="' + t.k + '"><span>' + t.icon + '</span>' + _nbE(t.name) + '</button>'; }).join('') + '</div>' +
      '<small>Alt+W 글쓰기 · Alt+N 낙서장 · / 로 명령 · 펜이 있으면 ✍️ 손글씨</small></div>';
    return;
  }
  var daily = !!NB.daily1, shared = !!(NB.cur && NB.cur.readOnly), trash = !!(NB.cur && NB.cur.deletedAt) || shared;   // trash = 고칠 수 없음 (휴지통 · 공유받음)
  var f = NB.cur && NB.cur.folderId && NB.meta ? (NB.meta.folders || []).filter(function (x) { return x.id === NB.cur.folderId; })[0] : null;
  var h = '<div class="nb-top">' +
    '<button class="nb-back" data-nb="to-list" aria-label="목록으로">‹</button>' +
    (daily ? '<span class="nb-crumb">📅 일일 노트</span>' : shared ? '<span class="nb-crumb">👥 ' + _nbE(NB.cur.ownerName || '') + '</span>' :
      '<button class="nb-crumb" data-nb="folder-pick" title="폴더 옮기기">' + (NB.cur.inbox ? '📥 낙서장' : f ? '<i style="background:' + _nbE(f.color || 'var(--ac)') + '"></i>' + _nbE(f.name) : '📁 폴더 없음') + ' ▾</button>') +
    '<span class="nb-state" id="nbState" aria-live="polite"></span><span class="nb-sp"></span>' +
    (shared ? '' : '<div class="nb-seg" role="tablist" aria-label="보기">' + [['edit', '✏️', '편집'], ['split', '◫', '나란히'], ['view', '👁', '보기'], ['paper', '🖨', '출력 모양']].map(function (x) {
      return '<button role="tab" aria-selected="' + (NB.mode === x[0]) + '" class="' + (NB.mode === x[0] ? 'on' : '') + '" data-mode="' + x[0] + '" title="' + (x[0] === 'paper' ? '🖨 출력 모양 — 쓰면서 인쇄될 종이 그대로 보기' : x[2]) + ' (Ctrl+Alt+' + ({ edit: 1, split: 2, view: 3, paper: 4 })[x[0]] + ')">' + x[1] + '<span> ' + x[2] + '</span></button>';
    }).join('') + '</div>') +
    (trash ? '' : '<button class="nb-ib nb-ai" data-nb="ai" title="✨ AI — 메일 초안 · 번역 · 다듬기 · 요약">✨<span> AI</span></button>') +
    '<button class="nb-ib nb-cbtn' + (typeof NBP !== 'undefined' && NBP.coach ? ' on' : '') + '" data-nb="coach" title="✍️ 글쓰기 코치 — 고칠 곳을 이유 · 힌트 · 예시로" aria-pressed="' + !!(typeof NBP !== 'undefined' && NBP.coach) + '">✍️<span> 코치</span></button>' +
    (daily || trash ? '' : '<button class="nb-ib nb-shb' + (NB.cur.shareN ? ' on' : '') + '" data-nb="share" title="👥 공유 (읽기 전용)">👥' + (NB.cur.shareN ? '<small>' + NB.cur.shareN + '</small>' : '') + '</button>' +
      '<button class="nb-ib' + (NB.cur.pinned ? ' on' : '') + '" data-nb="pin" title="고정" aria-pressed="' + NB.cur.pinned + '">📌</button><button class="nb-ib' + (NB.cur.starred ? ' on' : '') + '" data-nb="star" title="즐겨찾기" aria-pressed="' + NB.cur.starred + '">' + (NB.cur.starred ? '★' : '☆') + '</button>') +
    (shared || trash || typeof wmBookOpen !== 'function' ? '' : '<button class="nb-ib" data-nb="book" title="📖 펼쳐 보기 — 이 노트와 다른 노트를 책처럼 나란히" aria-label="펼쳐 보기">📖</button>') +
    (NB.cur && NB.cur.deletedAt ? '' : '<button class="nb-ib nb-prb" data-nb="print" title="🖨 출력 미리 보기 · 양식 (Ctrl+P)" aria-label="출력 미리 보기">🖨</button>') +
    '<button class="nb-ib nb-fsb" data-nb="fs" title="글자 크기 — 작게 · 보통 · 크게 (누를 때마다)">가' + ({ s: '⁻', l: '⁺' }[_nbFs()] || '') + '</button>' +
    '<button class="nb-ib" data-nb="focus" title="집중 모드 (Ctrl+Shift+F)">⤢</button>' +
    '<button class="nb-ib" data-nb="more" title="더 보기" aria-label="더 보기">⋯</button></div>';
  if (shared) h += '<div class="nb-bar info">👥 <b>' + _nbE(NB.cur.ownerName || '') + '</b> 님이 공유한 노트 — 읽기 전용 <button class="nb-btn sm" data-nb="copy-mine">📓 내 노트로 복사</button></div>';
  else if (trash) h += '<div class="nb-bar warn">🗑 휴지통에 있는 노트입니다 <button class="nb-btn sm" data-restore="' + _nbE(NB.cur.id) + '">되살리기</button></div>';
  h += '<div id="nbBars"></div>';
  h += '<div class="nb-head"><input class="nb-title" id="nbTitle" placeholder="제목" maxlength="300" value="' + _nbE(daily ? NB.daily1.title : NB.cur.title) + '"' + (daily || trash ? ' readonly' : '') + ' aria-label="제목">' +
    (daily ? '' : '<div class="nb-tagrow" id="nbTagRow">' + _nbTagsHtml() + '</div>') + '</div>';
  if (!shared) h += '<div class="nb-tb" id="nbTb" role="toolbar" aria-label="서식">' + _nbTbHtml(daily) + '</div>';
  h += '<div class="nb-ed nb-m-' + (shared ? 'view' : NB.mode) + '" id="nbEd">' +
    '<textarea class="nb-src nb-scroll" id="nbSrc" spellcheck="false" placeholder="여기에 쓰세요 — 마크다운 · / 명령 · [[ 노트 잇기 · 사진은 붙여넣기" aria-label="본문"' + (trash ? ' readonly' : '') + '></textarea>' +
    '<div class="nb-prev nb-scroll" id="nbPrev"><div class="nb-doc-w"><article class="nb-doc" id="nbDoc"></article><div class="nb-over" id="nbOver"></div><div class="nb-bl" id="nbBL"></div></div></div>' +
    (typeof nbPaperPaneHtml === 'function' ? nbPaperPaneHtml() : '') +
    '</div>';
  h += '<div class="nb-foot" id="nbFoot"></div>';
  m.innerHTML = h;
  var src = document.getElementById('nbSrc');
  src.value = daily ? NB.daily1.body : NB.cur.body;
  _nbRenderPrev();
  _nbFoot();
  _nbStateCur();
  if (typeof NBP !== 'undefined' && NBP.coach) { m.classList.add('coach-on'); _nbpCoachRun(true); }
  if (!daily && !trash && NB.mode !== 'view' && !src.value && !NB.cur.title) document.getElementById('nbTitle').focus();
}
function _nbTbHtml(daily) {
  function b(k, label, title) { return '<button class="nb-tbb" data-fmt="' + k + '" title="' + title + '" aria-label="' + title + '">' + label + '</button>'; }
  var sep = '<span class="nb-tbs"></span>';
  return b('h1', 'H1', '제목 1') + b('h2', 'H2', '제목 2') + b('h3', 'H3', '제목 3') + sep +
    b('b', '<b>B</b>', '굵게 (Ctrl+B)') + b('i', '<i>I</i>', '기울임 (Ctrl+I)') + b('s', '<s>S</s>', '취소선 (Ctrl+Shift+X)') + b('mark', '<span class="nb-tb-hl">H</span>', '형광펜 (Ctrl+Shift+H)') + b('code', '&lt;/&gt;', '코드 (Ctrl+E)') + sep +
    b('ul', '•', '글머리 목록') + b('ol', '1.', '번호 목록') + b('todo', '☑', '체크리스트 (Ctrl+Shift+C)') + b('quote', '❝', '인용') + b('callout', '💡', '알림 상자') + b('table', '▦', '표') + b('hr', '―', '구분선') + sep +
    b('link', '🔗', '링크 (Ctrl+K)') + b('file', '🖼', '사진 · 파일 넣기') +
    (daily ? '' : sep + '<button class="nb-tbb nb-tb-ink" data-fmt="wm" title="🔗 업무 연결 — 프로젝트 · 이슈 · 마일스톤 · 회의 · 할 일 (지금 상태가 칩으로)">📌<span> 업무</span></button>' +
      '<button class="nb-tbb nb-tb-ink" data-fmt="wl" title="📄 노트 잇기 — [[ 를 쳐도 됩니다">[[ ]]</button>') +
    (daily ? '' : sep + '<button class="nb-tbb nb-tb-ink" data-fmt="ink" title="✍️ 손글씨 칸 넣기 — 펜 · 마우스 · 손가락">✍️<span> 손글씨</span></button><button class="nb-tbb nb-tb-ink" data-fmt="over" title="🖍 마커 — 노트 위에 동그라미 · 밑줄 · 형광 표시">🖍<span> 마커</span></button>');
}
function _nbTagsHtml() {
  var tags = NB.cur.tags || [];
  return tags.map(function (t, i) { return '<span class="nb-chip">#' + _nbE(t) + (_nbRO() ? '' : '<button data-untag="' + i + '" aria-label="태그 빼기">×</button>') + '</span>'; }).join('') +
    (_nbRO() ? '' : '<input class="nb-tagin" id="nbTagIn" list="nbTagDl" placeholder="' + (tags.length ? '+ 태그' : '+ 태그 달기') + '" aria-label="태그 추가"><datalist id="nbTagDl">' +
      ((NB.meta && NB.meta.tags) || []).map(function (t) { return '<option value="' + _nbE(t.tag) + '">'; }).join('') + '</datalist>');
}
function _nbFoot() {
  var el = document.getElementById('nbFoot'), src = document.getElementById('nbSrc'); if (!el || !src) return;
  var s = src.value;
  var chars = s.replace(/```[\s\S]*?```/g, '').replace(/^::ink\[[^\]]*\]$/gm, '').replace(/[#>*_`~=\-|[\]()]/g, '').replace(/\s+/g, '').length;
  var mins = Math.max(1, Math.round(chars / 500));
  var n = _nbDoc();
  el.innerHTML = '<span>글자 ' + chars.toLocaleString() + '</span><span>읽기 약 ' + mins + '분</span>' +
    (NB.cur ? '<span>만든 날 ' + new Date(NB.cur.createdAt).toLocaleDateString() + '</span><span id="nbUpd">고침 ' + _nbWhen(NB.cur.updatedAt) + '</span>' : '<span>' + _nbE(n.date) + '</span>') +
    '<span class="nb-sp"></span><span class="nb-foot-k">/ 명령 · Ctrl+S 저장 · Ctrl+Alt+1~4 보기</span>';
}
function _nbState(s, msg) {
  var el = document.getElementById('nbState'); if (!el) return;
  el.className = 'nb-state ' + s;
  el.textContent = s === 'saving' ? '저장 중…' : s === 'dirty' ? '고치는 중' : s === 'error' ? '⚠️ ' + (msg || '저장 안 됨') : s === 'offline' ? '⚠️ ' + (msg || '연결 끊김 — 이 기기에 보관 중') : '저장됨';
  el.title = s === 'offline' || s === 'error' ? '못 보낸 글은 이 기기에 남아 있습니다 — Ctrl+S 로 바로 다시 보낼 수 있습니다' : '';
}

/* 미리보기 */
function _nbRenderPrev() {
  var doc = document.getElementById('nbDoc'), src = document.getElementById('nbSrc'); if (!doc || !src) return;
  var r = NbMd.render(src.value);
  NB.toc = r.toc;
  var keepImg = null;   // 이미 받아 둔 사진 요소 — 새로 그린 자리에 옮겨 씀 (다시 그릴 때 깜빡이지 않게 · v13.333)
  doc.querySelectorAll('img[data-nbfid]').forEach(function (img) { if (!img.getAttribute('src')) return; keepImg = keepImg || {}; var id = img.getAttribute('data-nbfid'); (keepImg[id] = keepImg[id] || []).push(img); });
  doc.innerHTML = r.html || '<p class="nb-ph">' + (NB.mode === 'view' ? '비어 있는 노트 — ✏️ 편집 을 누르거나 더블클릭해서 쓰세요' : '미리보기') + '</p>';
  var ink = NB.cur && NB.cur.ink && NB.cur.ink.blocks || {};
  doc.querySelectorAll('.nb-ink').forEach(function (el) {
    var id = el.getAttribute('data-ink'), blk = ink[id];
    if (NB.inkId === id && NB.inkEd) { NB.inkEd.destroy(); NB.inkEd = null; }
    el.innerHTML = blk ? NbInk.svg(blk) : '<div class="nb-ink-miss">✍️ 손글씨 칸 (비어 있음)</div>';
    if (blk) el.style.aspectRatio = NbInk.W + ' / ' + Math.max(40, blk.h || 300);
    if (NB.cur && !_nbRO()) {
      var b = document.createElement('button');
      b.className = 'nb-ink-go'; b.type = 'button'; b.setAttribute('data-inkgo', id); b.textContent = '✍️ 그리기';
      el.appendChild(b);
    }
  });
  if (keepImg) doc.querySelectorAll('img[data-nbf]').forEach(function (img) {
    var k = keepImg[img.getAttribute('data-nbf')], old = k && k.shift();
    if (old) { old.alt = img.alt; if (img.title) old.title = img.title; else old.removeAttribute('title'); img.replaceWith(old); }
  });
  _nbLoadImgs(doc);
  if (NB.inkId && NB.cur) { var host = doc.querySelector('.nb-ink[data-ink="' + NB.inkId + '"]'); if (host) _nbInkStart(NB.inkId, true); else _nbInkStop(); }
  _nbDrawOver();
  if (typeof _nbAfterRender === 'function') _nbAfterRender(doc);   // 🔗 링크 · 칩 · 체크 단추 · 가리키는 노트 (notebook-plus.js)
  if (NB.mode === 'paper' && typeof nbPaperLive === 'function') nbPaperLive();   // 🖨 출력 모양 — 쓰는 대로 종이에 (v13.321)
}
/* 🖍 덮어 그린 표시 */
function _nbDrawOver() {
  var ov = document.getElementById('nbOver'), doc = document.getElementById('nbDoc'); if (!ov || !doc) return;
  if (NB.overEd) return;   // 그리는 중
  var o = NB.cur && NB.cur.ink && NB.cur.ink.over;
  if (!o || !o.s || !o.s.length || NB.overHide) { ov.innerHTML = ''; ov.classList.remove('has'); return; }
  var h = doc.offsetHeight * NbInk.W / Math.max(1, doc.offsetWidth);
  ov.innerHTML = NbInk.svg({ h: h, s: o.s });
  ov.classList.add('has');
}

/* ═══ 바인딩 ═══ */
function _nbBind(root) {
  var prevT = null;
  root.addEventListener('click', _nbClick);
  root.addEventListener('dblclick', function (e) {
    var blk = e.target.closest('#nbDoc [data-line]');
    if (!blk || NB.mode !== 'view' || !_nbDoc() || _nbRO() || e.target.closest('.nb-ink, a, button')) return;
    _nbSetMode('split');
    _nbCaretToLine(+blk.getAttribute('data-line'));
  });
  root.addEventListener('input', function (e) {
    if (e.target.id === 'nbSrc' && _nbImeEnter(e)) return;
    if (e.target.id === 'nbSrc' && NB.inserting) return;   // _nbInsert 가 바로 이어서 처리 (두 번 그리지 않게)
    if (e.target.id === 'nbSrc') {
      _nbChanged('body');
      var len = e.target.value.length;
      clearTimeout(prevT); prevT = setTimeout(function () { _nbRenderPrev(); _nbFoot(); }, (NB.mode === 'edit' ? 400 : 120) + Math.min(600, Math.floor(len / 500)));
      if (!(typeof _nbWikiCheck === 'function' && _nbWikiCheck())) _nbSlashCheck();
      if (typeof _nbCoachSchedule === 'function') _nbCoachSchedule();
    } else if (e.target.id === 'nbTitle') { _nbChanged('title'); if (NB.mode === 'paper' && typeof nbPaperLive === 'function') nbPaperLive(); }
    else if (e.target.id === 'nbQ') {
      clearTimeout(NB.qT);
      var v = e.target.value.trim();
      NB.qT = setTimeout(function () { NB.q = v; _nbLoadList(); _nbDrawSideOn(); }, 250);
    }
  });
  root.addEventListener('change', function (e) {
    if (e.target.id === 'nbSort') { NB.sort = e.target.value; _nbSavePrefs(); _nbLoadList(); }
  });
  root.addEventListener('keydown', _nbKey);
  root.addEventListener('paste', function (e) {
    if (e.target.id !== 'nbSrc') return;
    var files = [].slice.call((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) { e.preventDefault(); files.forEach(_nbUpload); return; }
    var t = e.clipboardData && e.clipboardData.getData('text/plain');
    var src = e.target;
    if (t && /^https?:\/\/\S+$/.test(t.trim()) && src.selectionStart !== src.selectionEnd) {   // 글을 고르고 주소를 붙이면 링크
      e.preventDefault();
      var sel = src.value.slice(src.selectionStart, src.selectionEnd);
      _nbInsert('[' + sel + '](' + t.trim() + ')');
    }
  });
  root.addEventListener('dragover', function (e) {
    if (e.target.closest && e.target.closest('#nbEd') && e.dataTransfer && [].slice.call(e.dataTransfer.types || []).indexOf('Files') >= 0) { e.preventDefault(); document.getElementById('nbEd').classList.add('drop'); }
    var fo = e.target.closest && e.target.closest('.nb-fold, .nb-nav[data-view="inbox"], .nb-nav[data-view="all"]');
    if (fo && NB.drag) { e.preventDefault(); fo.classList.add('drop'); }
  });
  root.addEventListener('dragleave', function (e) {
    var ed = document.getElementById('nbEd'); if (ed && !ed.contains(e.relatedTarget)) ed.classList.remove('drop');
    var fo = e.target.closest && e.target.closest('.nb-fold, .nb-nav'); if (fo) fo.classList.remove('drop');
  });
  root.addEventListener('drop', function (e) {
    var ed = document.getElementById('nbEd'); if (ed) ed.classList.remove('drop');
    var fo = e.target.closest && e.target.closest('.nb-fold, .nb-nav[data-view="inbox"], .nb-nav[data-view="all"]');
    if (fo && NB.drag) {
      e.preventDefault(); fo.classList.remove('drop');
      var id = NB.drag; NB.drag = null;
      if (fo.classList.contains('nb-fold')) _nbPatch(id, { folderId: fo.getAttribute('data-folder'), inbox: false }, '📁 폴더로 옮겼습니다');
      else if (fo.getAttribute('data-view') === 'inbox') _nbPatch(id, { inbox: true }, '📥 낙서장으로 옮겼습니다');
      else _nbPatch(id, { inbox: false, folderId: null }, '📚 모든 노트로 옮겼습니다');
      return;
    }
    if (e.target.closest && e.target.closest('#nbEd') && e.dataTransfer && e.dataTransfer.files.length) {
      e.preventDefault();
      if (NB.mode === 'view') _nbSetMode('split');
      [].slice.call(e.dataTransfer.files).forEach(_nbUpload);
    }
  });
  root.addEventListener('dragstart', function (e) {
    var it = e.target.closest && e.target.closest('.nb-it[data-id]');
    if (it) { NB.drag = it.getAttribute('data-id'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', _nbTitleOf(NB.list.filter(function (x) { return x.id === NB.drag; })[0] || {})); } catch (_) {} }
  });
  root.addEventListener('dragend', function () { NB.drag = null; root.querySelectorAll('.drop').forEach(function (x) { x.classList.remove('drop'); }); });
  // 편집 ↔ 미리보기 스크롤 맞추기 (나란히)
  root.addEventListener('scroll', function (e) {
    if (NB.mode !== 'split' || NB._sync) return;
    var a = e.target, b = a.id === 'nbSrc' ? document.getElementById('nbPrev') : a.id === 'nbPrev' ? document.getElementById('nbSrc') : null;
    if (!b) return;
    // v13.417 좁아서 위아래로 쌓였으면 맞추지 않음 — 한쪽을 굴리면 다른 쪽도 따라 움직여 읽던 자리를 잃던 것
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    var side = ra.right <= rb.left + 1 || rb.right <= ra.left + 1;   // 옆에 나란히 있을 때만
    if (!side) return;
    var r = a.scrollTop / Math.max(1, a.scrollHeight - a.clientHeight);
    NB._sync = true; b.scrollTop = r * (b.scrollHeight - b.clientHeight);
    requestAnimationFrame(function () { NB._sync = false; });
  }, true);
  root.addEventListener('focusout', function (e) {
    if (e.target.id === 'nbTagIn' && e.target.value.trim()) _nbAddTag(e.target.value);
  });
}
function _nbDrawSideOn() {
  document.querySelectorAll('#nbSide .nb-nav').forEach(function (b) { b.classList.toggle('on', !NB.q && !NB.folder && !NB.tag && b.getAttribute('data-view') === NB.view); });
  document.querySelectorAll('#nbSide .nb-fold').forEach(function (b) { b.classList.toggle('on', !NB.q && b.getAttribute('data-folder') === NB.folder); });
  document.querySelectorAll('#nbSide .nb-tag').forEach(function (b) { b.classList.toggle('on', !NB.q && b.getAttribute('data-tag') === NB.tag); });
}

function _nbClick(e) {
  var t = e.target, x;
  if (typeof _nbPlusClick === 'function' && _nbPlusClick(e)) return;
  if ((x = t.closest('[data-view]')) && x.closest('#nbSide')) {
    NB.view = x.getAttribute('data-view'); NB.folder = null; NB.tag = null; NB.q = ''; var qi = document.getElementById('nbQ'); if (qi) qi.value = '';
    _nbSavePrefs(); _nbDrawSideOn(); _nbLoadList(); _nbSetPane('list'); return;
  }
  if ((x = t.closest('[data-fmenu]'))) { e.stopPropagation(); _nbFolderMenu(x.getAttribute('data-fmenu'), x); return; }
  if ((x = t.closest('.nb-fold[data-folder]'))) { NB.folder = x.getAttribute('data-folder'); NB.tag = null; NB.q = ''; NB.view = 'all'; _nbSavePrefs(); _nbDrawSideOn(); _nbLoadList(); _nbSetPane('list'); return; }
  if ((x = t.closest('[data-tag]')) && x.closest('#nbSide')) { NB.tag = NB.tag === x.getAttribute('data-tag') ? null : x.getAttribute('data-tag'); NB.folder = null; NB.q = ''; _nbSavePrefs(); _nbDrawSideOn(); _nbLoadList(); _nbSetPane('list'); return; }
  if ((x = t.closest('[data-restore]'))) { e.stopPropagation(); _nbRestore(x.getAttribute('data-restore')); return; }
  if ((x = t.closest('[data-purge]'))) { e.stopPropagation(); _nbPurge(x.getAttribute('data-purge')); return; }
  if ((x = t.closest('.nb-it[data-id]'))) { _nbOpen(x.getAttribute('data-id')); return; }
  if ((x = t.closest('.nb-it[data-daily]'))) { _nbOpenDaily(x.getAttribute('data-daily'), x.getAttribute('data-ref') || ''); return; }
  if ((x = t.closest('[data-tpl]'))) { nbNewFromTemplate(x.getAttribute('data-tpl')); return; }
  if ((x = t.closest('[data-mode]'))) { _nbSetMode(x.getAttribute('data-mode')); return; }
  if ((x = t.closest('[data-fmt]'))) { _nbFmt(x.getAttribute('data-fmt')); return; }
  if ((x = t.closest('[data-untag]'))) { var tg = (NB.cur.tags || []).slice(); tg.splice(+x.getAttribute('data-untag'), 1); _nbSetTags(tg); return; }
  if ((x = t.closest('[data-inkgo]'))) { e.preventDefault(); _nbInkStart(x.getAttribute('data-inkgo')); return; }
  if ((x = t.closest('[data-ink-t]'))) { _nbInkTool(x); return; }
  if ((x = t.closest('input[data-task]'))) {
    e.preventDefault();
    if (_nbRO()) return;
    var src = document.getElementById('nbSrc'), tl = +x.getAttribute('data-task');
    var wasOn = /^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]/.test(src.value.split('\n')[tl] || '');
    src.value = NbMd.toggleTask(src.value, tl);
    if (typeof _nbpTaskToggled === 'function') _nbpTaskToggled(tl, !wasOn);   // 할 일이 걸린 줄이면 할 일도
    _nbChanged('body'); _nbRenderPrev(); _nbFoot(); return;
  }
  if ((x = t.closest('.nb-code-copy'))) { var code = x.parentElement.querySelector('code'); _nbCopy(code ? code.textContent : ''); x.textContent = '✓ 복사됨'; setTimeout(function () { x.textContent = '복사'; }, 1200); return; }
  if ((x = t.closest('a.nb-file[data-nbf]'))) { e.preventDefault(); _nbDownload(x.getAttribute('data-nbf'), x.textContent.replace(/^📎\s*/, '')); return; }
  if ((x = t.closest('a.nb-todo-ref'))) { e.preventDefault(); if (typeof globalSearchNav === 'function') globalSearchNav('todo', { nav: { todoId: x.getAttribute('data-todo') } }); return; }
  if ((x = t.closest('#nbDoc a[data-anchor]'))) { e.preventDefault(); var tgt = document.getElementById(x.getAttribute('href').slice(1)); if (tgt) tgt.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if ((x = t.closest('#nbDoc img.nb-img'))) { _nbZoomImg(x); return; }
  if (!(x = t.closest('[data-nb]'))) return;
  var k = x.getAttribute('data-nb');
  if (k === 'new') nbNewFromTemplate('blank');
  else if (k === 'tpl') _nbTplMenu(x);
  else if (k === 'quick') nbQuickOpen();
  else if (k === 'write') nbWriteStart();
  else if (k === 'fold-add') _nbFolderEdit(null);
  else if (k === 'to-list') { _nbFlush(); _nbSetPane('list'); }
  else if (k === 'to-side') _nbSetPane('side');
  else if (k === 'empty-trash') _nbEmptyTrash();
  else if (k === 'pin') _nbPatch(NB.cur.id, { pinned: !NB.cur.pinned });
  else if (k === 'star') _nbPatch(NB.cur.id, { starred: !NB.cur.starred });
  else if (k === 'focus') _nbToggleFocus();
  else if (k === 'fs') { var f = { s: '', '': 'l', l: 's' }[_nbFs()]; try { localStorage.setItem('wm.nb.fs', f); } catch (_) {} _nbApplyFs(); x.innerHTML = '가' + ({ s: '⁻', l: '⁺' }[f] || ''); }
  else if (k === 'more') _nbMoreMenu(x);
  else if (k === 'print') nbPrintOpen();
  else if (k === 'book') nbBookOpen();
  else if (k === 'print-bundle') nbPrintBundle(NB.view === 'daily' ? 'daily' : 'notes');
  else if (k === 'ai') nbAiOpen();
  else if (k === 'coach') nbpCoachToggle();
  else if (k === 'share') nbpShare();
  else if (k === 'report') nbpReport();
  else if (k === 'copy-mine') nbNewFrom(NB.cur.body, (NB.cur.title || '노트') + ' (' + (NB.cur.ownerName || '공유') + ')', {});
  else if (k === 'folder-pick') _nbFolderPick(x);
  else if (k === 'draft-use') _nbDraftUse();
  else if (k === 'draft-drop') { _nbDraft(NB.cur.id, null); NB._draft = null; document.getElementById('nbBars').innerHTML = ''; }
  else if (k === 'draft-copy') _nbDraftCopy();
  else if (k === 'more-list') _nbLoadList(true);
  else if (k === 'cf-reload') _nbConflict('reload');
  else if (k === 'cf-mine') _nbConflict('mine');
  else if (k === 'cf-copy') _nbConflict('copy');
}
function _nbSetMode(m) {
  if (m === NB.mode) return;
  NB.mode = m; _nbSavePrefs();
  var ed = document.getElementById('nbEd'); if (ed) ed.className = 'nb-ed nb-m-' + m;
  document.querySelectorAll('#nbMain .nb-seg button').forEach(function (b) { var on = b.getAttribute('data-mode') === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  if (m === 'edit') { _nbInkStop(); _nbOverStop(); }
  _nbRenderPrev();
  if (m !== 'view') { var s = document.getElementById('nbSrc'); if (s && !s.readOnly) s.focus(); }
}
function _nbToggleFocus() {
  NB.focus = !NB.focus;
  var root = document.querySelector('#mNotebook .nb'); if (root) root.classList.toggle('nb-focus', NB.focus);
  document.body.classList.toggle('nb-focus-on', NB.focus);
  setTimeout(_nbDrawOver, 50);
}

/* ═══ 키 ═══ */
function _nbKey(e) {
  var t = e.target, ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Enter' && e.isComposing && t.id === 'nbSrc' && !e.shiftKey) NB.imeEnter = Date.now();   // Mac: 이 Enter 하나로 줄이 바뀜 → input 에서 이어 처리
  if (NB.slash && t.id === 'nbSrc' && _nbSlashKey(e)) return;
  if (NB.wiki && t.id === 'nbSrc' && _nbWikiKey(e)) return;
  if (t.id === 'nbTagIn') {
    if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) { e.preventDefault(); _nbAddTag(t.value); }
    else if (e.key === 'Backspace' && !t.value && NB.cur.tags.length) { _nbSetTags(NB.cur.tags.slice(0, -1)); }
    return;
  }
  if (t.id === 'nbTitle' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); var s0 = document.getElementById('nbSrc'); if (NB.mode === 'view') _nbSetMode('split'); if (s0) { s0.focus(); s0.setSelectionRange(0, 0); } return; }
  if (ctrl && e.altKey && /^[1234]$/.test(e.key)) { e.preventDefault(); _nbSetMode(['edit', 'split', 'view', 'paper'][+e.key - 1]); return; }
  if (ctrl && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); _nbToggleFocus(); return; }
  if (e.key === 'Escape' && NB.focus) { _nbToggleFocus(); return; }
  if (ctrl && (e.key === 's' || e.key === 'S')) { e.preventDefault(); _nbFlush(true); return; }
  if (ctrl && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P') && (NB.cur || NB.daily1)) { e.preventDefault(); nbPrintOpen(); return; }
  if (NB.inkEd || NB.overEd) {
    var ed = NB.inkEd || NB.overEd;
    if (ctrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); ed.undoOne(); return; }
    if (ctrl && (e.key === 'y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { e.preventDefault(); ed.redoOne(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ed.hasSel() && t.tagName !== 'TEXTAREA' && t.tagName !== 'INPUT') { e.preventDefault(); ed.deleteSel(); return; }
    if (e.key === 'Escape') { _nbInkStop(); _nbOverStop(); return; }
  }
  if (t.id !== 'nbSrc') {
    if (t.closest && t.closest('.nb-it') && e.key === 'Enter') t.click();
    if (t.closest && t.closest('.nb-it') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); var sib = e.key === 'ArrowDown' ? t.nextElementSibling : t.previousElementSibling;
      while (sib && !sib.classList.contains('nb-it')) sib = e.key === 'ArrowDown' ? sib.nextElementSibling : sib.previousElementSibling;
      if (sib) { sib.focus(); sib.click(); }
    }
    return;
  }
  if (ctrl && !e.altKey) {
    var k = e.key.toLowerCase();
    if (k === 'b' && !e.shiftKey) { e.preventDefault(); _nbFmt('b'); return; }
    if (k === 'i' && !e.shiftKey) { e.preventDefault(); _nbFmt('i'); return; }
    if (k === 'e' && !e.shiftKey) { e.preventDefault(); _nbFmt('code'); return; }
    if (k === 'k' && !e.shiftKey) { e.preventDefault(); _nbFmt('link'); return; }
    if (k === 'x' && e.shiftKey) { e.preventDefault(); _nbFmt('s'); return; }
    if (k === 'h' && e.shiftKey) { e.preventDefault(); _nbFmt('mark'); return; }
    if (k === 'c' && e.shiftKey) { e.preventDefault(); _nbFmt('todo'); return; }
  }
  if (e.key === 'Tab') { e.preventDefault(); _nbIndent(e.shiftKey); return; }
  if (e.key === 'Enter' && !e.shiftKey && !ctrl && !e.isComposing) { if (_nbListEnter()) e.preventDefault(); }
}

/* ═══ 글 다루기 ═══ */
function _nbSrc() { return document.getElementById('nbSrc'); }
/** 고른 곳을 글로 바꿈 — 되돌리기(Ctrl+Z)가 되게 execCommand 우선 */
function _nbInsert(text, selStart, selEnd) {
  var s = _nbSrc(); if (!s || s.readOnly) return;
  s.focus();
  var ok = false;
  NB.inserting = true;
  try { ok = text === '' ? (s.selectionStart === s.selectionEnd || document.execCommand('delete')) : document.execCommand('insertText', false, text); } catch (_) {}
  NB.inserting = false;
  if (!ok) { var a = s.selectionStart; s.setRangeText(text, a, s.selectionEnd, 'end'); }
  if (selStart != null) { var base = s.selectionEnd - text.length; s.setSelectionRange(base + selStart, base + (selEnd != null ? selEnd : selStart)); }
  _nbChanged('body');
  _nbRenderPrev(); _nbFoot();
}
function _nbLineRange(s) {
  var v = s.value, a = v.lastIndexOf('\n', s.selectionStart - 1) + 1, b = v.indexOf('\n', s.selectionEnd);
  if (b < 0) b = v.length;
  return [a, b];
}
function _nbWrap(pre, post, ph) {
  var s = _nbSrc(); if (!s) return;
  var a = s.selectionStart, b = s.selectionEnd, sel = s.value.slice(a, b);
  if (sel && s.value.slice(a - pre.length, a) === pre && s.value.slice(b, b + post.length) === post) {   // 이미 감싸져 있으면 풀기
    s.setSelectionRange(a - pre.length, b + post.length); _nbInsert(sel, 0, sel.length); return;
  }
  var inner = sel || ph || '';
  _nbInsert(pre + inner + post, pre.length, pre.length + inner.length);
}
function _nbLinePrefix(pre, re) {
  var s = _nbSrc(); if (!s) return;
  var r = _nbLineRange(s), block = s.value.slice(r[0], r[1]), lines = block.split('\n');
  var all = lines.every(function (l) { return !l.trim() || re.test(l); });
  var out = lines.map(function (l, i) {
    if (all) return l.replace(re, '');
    var stripped = l.replace(/^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)/, '');
    return (typeof pre === 'function' ? pre(i) : pre) + stripped;
  }).join('\n');
  s.setSelectionRange(r[0], r[1]);
  _nbInsert(out, out.length);
}
function _nbFmt(k) {
  if (NB.mode === 'view' && ['ink', 'over'].indexOf(k) < 0) _nbSetMode('split');
  var s = _nbSrc();
  switch (k) {
    case 'b': return _nbWrap('**', '**', '굵게');
    case 'i': return _nbWrap('*', '*', '기울임');
    case 's': return _nbWrap('~~', '~~', '취소');
    case 'mark': return _nbWrap('==', '==', '형광');
    case 'code': {
      var sel = s.value.slice(s.selectionStart, s.selectionEnd);
      if (sel.indexOf('\n') >= 0) return _nbInsert('```\n' + sel + '\n```');
      return _nbWrap('`', '`', '코드');
    }
    case 'h1': return _nbLinePrefix('# ', /^#\s+/);
    case 'h2': return _nbLinePrefix('## ', /^##\s+/);
    case 'h3': return _nbLinePrefix('### ', /^###\s+/);
    case 'ul': return _nbLinePrefix('- ', /^[-*+]\s+(?!\[)/);
    case 'ol': return _nbLinePrefix(function (i) { return (i + 1) + '. '; }, /^\d+[.)]\s+/);
    case 'todo': return _nbLinePrefix('- [ ] ', /^[-*+]\s+\[[ xX]\]\s+/);
    case 'quote': return _nbLinePrefix('> ', /^>\s?/);
    case 'callout': return _nbBlock('> [!NOTE] 참고\n> ', 0);
    case 'table': return _nbBlock('| 항목 | 내용 |\n|---|---|\n|  |  |\n', 2);
    case 'hr': return _nbBlock('---\n');
    case 'link': {
      var a = s.selectionStart, b = s.selectionEnd, t = s.value.slice(a, b);
      if (/^https?:\/\//.test(t)) return _nbInsert('[링크](' + t + ')', 1, 3);
      return _nbInsert('[' + (t || '글') + '](https://)', t ? t.length + 3 : 1, t ? t.length + 11 : 2);
    }
    case 'file': return _nbPickFile();
    case 'ink': return _nbInkNew();
    case 'over': return _nbOverToggle();
    case 'wm': return nbpLinkPick();
    case 'wl': { _nbInsert('[['); return _nbWikiCheck(); }
  }
}
/** 줄 처음에 블록 넣기 (앞뒤 빈 줄 맞춤) */
function _nbBlock(text, caretFromStart) {
  var s = _nbSrc(); if (!s) return;
  var v = s.value, a = s.selectionStart;
  var ls = v.lastIndexOf('\n', a - 1) + 1, lineTxt = v.slice(ls, (v.indexOf('\n', a) + 1 || v.length + 1) - 1);
  var pre = '';
  if (lineTxt.trim()) { var le = v.indexOf('\n', a); s.setSelectionRange(le < 0 ? v.length : le, le < 0 ? v.length : le); pre = '\n\n'; }
  else if (ls > 0 && v.slice(0, ls).slice(-2) !== '\n\n') pre = '\n';
  var full = pre + text;
  _nbInsert(full, caretFromStart != null ? pre.length + (caretFromStart === 0 ? text.indexOf('\n> ') + 3 : text.indexOf('|  |') + 2) : full.length);
}
function _nbIndent(out) {
  var s = _nbSrc(), r = _nbLineRange(s), a0 = s.selectionStart, b0 = s.selectionEnd;
  var lines = s.value.slice(r[0], r[1]).split('\n');
  var first = 0;
  var res = lines.map(function (l, i) {
    if (out) { var m = /^( {1,2}|\t)/.exec(l); if (m) { if (i === 0) first = -m[0].length; return l.slice(m[0].length); } return l; }
    if (i === 0) first = 2;
    return '  ' + l;
  }).join('\n');
  if (!out && a0 === b0 && !/^\s*([-*+]|\d+[.)])\s/.test(lines[0]) && lines.length === 1) { _nbInsert('  '); return; }
  var delta = res.length - (r[1] - r[0]);
  s.setSelectionRange(r[0], r[1]);
  _nbInsert(res);
  s.setSelectionRange(Math.max(r[0], a0 + first), Math.max(r[0], b0 + delta));
}
/** Enter — 목록 · 체크 · 인용 이어 쓰기 (빈 항목에서 Enter 면 목록 끝) */
/** 한글 입력 중 Enter 로 줄이 바로 바뀐 경우(Mac) — 그 줄바꿈을 거두고 목록 잇기 · / 명령으로 (v13.333)
 *  Windows 는 글자 마무리 Enter 뒤에 보통 Enter 가 한 번 더 와서 keydown 에서 처리됨 */
function _nbImeEnter(e) {
  if (!NB.imeEnter || Date.now() - NB.imeEnter > 400) return false;
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return false;
  NB.imeEnter = 0;
  var s = _nbSrc(), a = s.selectionStart;
  if (a < 1 || s.value.charAt(a - 1) !== '\n' || s.selectionEnd !== a) return false;
  s.value = s.value.slice(0, a - 1) + s.value.slice(a); s.setSelectionRange(a - 1, a - 1);
  if (NB.slash) { _nbSlashRun(); return true; }
  if (!_nbListEnter()) { s.value = s.value.slice(0, a - 1) + '\n' + s.value.slice(a - 1); s.setSelectionRange(a, a); return false; }
  return true;
}
function _nbListEnter() {
  var s = _nbSrc(); if (s.selectionStart !== s.selectionEnd) return false;
  var v = s.value, a = s.selectionStart, ls = v.lastIndexOf('\n', a - 1) + 1, line = v.slice(ls, a);
  var m = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line) || /^(\s*)(>)(\s?)()()()(.*)$/.exec(line);
  if (!m) return false;
  var rest = m[7];
  if (!rest.trim() && !v.slice(a, (v.indexOf('\n', a) + 1 || v.length + 1) - 1).trim()) {   // 빈 항목 → 표시 지우고 끝
    s.setSelectionRange(ls, a); _nbInsert(m[1] && m[2] !== '>' ? m[1].slice(2) : ''); return true;
  }
  var mark;
  if (m[2] === '>') mark = m[1] + '> ';
  else if (m[3]) mark = m[1] + (+m[3] + 1) + m[4] + m[5];
  else mark = m[1] + m[2] + m[5];
  if (m[6]) mark += '[ ] ';
  _nbInsert('\n' + mark);
  return true;
}
function _nbCaretToLine(n) {
  var s = _nbSrc(); if (!s) return;
  var lines = s.value.split('\n'), pos = 0;
  for (var i = 0; i < Math.min(n, lines.length); i++) pos += lines[i].length + 1;
  s.focus(); s.setSelectionRange(pos, pos);
  var lh = parseFloat(getComputedStyle(s).lineHeight) || 22;
  s.scrollTop = Math.max(0, n * lh - s.clientHeight / 3);
}

/* ─── / 명령 ─── */
function _nbSlashCheck() {
  var s = _nbSrc(); if (!s) return;
  var v = s.value, a = s.selectionStart, ls = v.lastIndexOf('\n', a - 1) + 1, line = v.slice(ls, a);
  var m = /^\s*\/([^\s/]{0,12})$/.exec(line);
  if (!m) { _nbSlashClose(); return; }
  var q = m[1].toLowerCase();
  var items = NB_SLASH.filter(function (x) { return !q || x[0].indexOf(q) >= 0 || x[1].toLowerCase().indexOf(q) >= 0; });
  if (!items.length) { _nbSlashClose(); return; }
  NB.slash = { at: ls + line.indexOf('/'), items: items, i: 0 };
  var pop = document.getElementById('nbSlash');
  if (!pop) { pop = document.createElement('div'); pop.id = 'nbSlash'; pop.className = 'nb-pop nb-slash'; pop.setAttribute('role', 'listbox'); document.body.appendChild(pop);
    pop.addEventListener('mousedown', function (e) { var b = e.target.closest('[data-si]'); if (b) { e.preventDefault(); NB.slash.i = +b.getAttribute('data-si'); _nbSlashRun(); } }); }
  pop.innerHTML = items.map(function (x, i) { return '<div class="nb-pop-i' + (i === 0 ? ' on' : '') + '" data-si="' + i + '" role="option">' + _nbE(x[1]) + '<small>/' + x[0] + '</small></div>'; }).join('');
  var c = _nbCaretXY(s);
  pop.style.left = Math.min(window.innerWidth - 240, c.x) + 'px';
  pop.style.top = (c.y + 24 + 260 > window.innerHeight ? c.y - Math.min(260, items.length * 34 + 10) : c.y + 24) + 'px';
}
function _nbSlashKey(e) {
  var S = NB.slash;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.i = (S.i + (e.key === 'ArrowDown' ? 1 : -1) + S.items.length) % S.items.length; document.querySelectorAll('#nbSlash .nb-pop-i').forEach(function (el, i) { el.classList.toggle('on', i === S.i); if (i === S.i) el.scrollIntoView({ block: 'nearest' }); }); return true; }
  if ((e.key === 'Enter' || e.key === 'Tab') && e.isComposing) return true;   // 글자 마무리만 — 뒤따르는 Enter(또는 Mac 은 input)에서 실행
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); _nbSlashRun(); return true; }
  if (e.key === 'Escape') { e.preventDefault(); _nbSlashClose(); return true; }
  return false;
}
function _nbSlashClose() { NB.slash = null; var p = document.getElementById('nbSlash'); if (p) p.remove(); }
function _nbSlashRun() {
  var S = NB.slash, it = S.items[S.i], s = _nbSrc();
  _nbSlashClose();
  s.setSelectionRange(S.at, s.selectionStart);
  var k = it[0];
  if (k === 'ink') { _nbInsert(''); return _nbInkNew(); }
  if (k === 'img') { _nbInsert(''); return _nbPickFile(); }
  if (k === 'date') { var d = new Date(); return _nbInsert(d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '. (' + '일월화수목금토'[d.getDay()] + ')'); }
  if (k === 'time') return _nbInsert(new Date().toTimeString().slice(0, 5));
  var text = it[2], caret = text.indexOf('\n\n```') >= 0 ? 4 : text.indexOf('|  |') >= 0 ? text.indexOf('|  |') + 2 : text.length;
  if (k === 'code') caret = 4;
  _nbInsert(text, caret);
}
/** 글 상자 안 커서의 화면 위치 — 똑같은 모양의 숨은 div 로 잼 */
function _nbCaretXY(ta) {
  var cs = getComputedStyle(ta), d = document.createElement('div');
  ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderTopWidth', 'tabSize'].forEach(function (p) { d.style[p] = cs[p]; });
  d.style.position = 'fixed'; d.style.visibility = 'hidden'; d.style.whiteSpace = 'pre-wrap'; d.style.wordWrap = 'break-word'; d.style.width = ta.clientWidth + 'px';
  d.textContent = ta.value.slice(0, ta.selectionStart);
  var sp = document.createElement('span'); sp.textContent = '​'; d.appendChild(sp);
  document.body.appendChild(d);
  var r = ta.getBoundingClientRect(), x = r.left + sp.offsetLeft, y = r.top + sp.offsetTop - ta.scrollTop;
  d.remove();
  return { x: x, y: y };
}

/* ═══ 저장 ═══ */
var NB_RETRY = [3000, 10000, 30000, 60000];
function _nbKeyOf(d) { return d.id ? 'n:' + d.id : 'd:' + d.date + '|' + (d.ref || ''); }
/** 그 노트(일일 노트)의 대기 칸 — 지금 값을 담음. 보낼 때는 그때 담긴 값을 보냄 (그새 다른 노트로 가도 섞이지 않음) */
function _nbPendOf(d) {
  var k = _nbKeyOf(d), p = NB.pend[k];
  if (!p) p = NB.pend[k] = d.id ? { key: k, k: 'n', id: d.id, f: {} } : { key: k, k: 'd', date: d.date, ref: d.ref || '', f: {} };
  delete NB.err[k];
  if (d.id) { p.title = d.title; p.body = d.body; p.ink = d.ink; } else { p.body = d.body; p.base = d.srv || ''; }
  return p;
}
function _nbChanged(what) {
  var d = _nbDoc(); if (!d) return;
  if (NB.daily1) d.body = _nbSrc().value;
  else {
    if (what === 'body') d.body = _nbSrc().value;
    if (what === 'title') d.title = document.getElementById('nbTitle').value;
  }
  var p = _nbPendOf(d);
  if (d.id) p.f[what] = 1;
  _nbDraftSoon();
  _nbStateCur();
  _nbQueue(what === 'ink' ? 1200 : 800);
}
function _nbHasPend() { return Object.keys(NB.pend).length > 0; }
function _nbSendable() { return Object.keys(NB.pend).filter(function (k) { return k !== NB.conflictKey && !NB.err[k]; }); }
function _nbQueue(ms) { clearTimeout(NB.timer); NB.timer = setTimeout(function () { NB.timer = null; _nbSave(); }, ms); }
/** 지금 바로 보내기 — 늘 끝나는(실패해도 resolve) 약속을 돌려줌 */
function _nbFlush() { clearTimeout(NB.timer); NB.timer = null; return _nbSave(); }
/* 임시 보관 — 치는 동안 0.7초에 한 번만 (40만 자를 키마다 쓰지 않게) */
function _nbDraftSoon() { if (!NB.dtimer) NB.dtimer = setTimeout(_nbDraftAll, 700); }
function _nbDraftAll() { clearTimeout(NB.dtimer); NB.dtimer = null; Object.keys(NB.pend).forEach(function (k) { _nbDraftPut(NB.pend[k]); }); }
function _nbDraftPut(p) {
  if (!p) return;
  if (p.k === 'd') { _nbDDraft(p.date, p.ref, { body: p.body, base: p.base || '', at: Date.now() }); return; }
  var o = { rev: NB.revs[p.id], title: p.title, body: p.body, t: Date.now() };
  if (p.f.ink || p.force) o.ink = p.ink;
  _nbDraft(p.id, o);
}
/** 보낼 주소 · 내용 */
function _nbReq(j) {
  if (j.k === 'd') return { url: '/api/my-work/notes', body: { date: j.date, ref: j.ref, body: j.body, base: j.base || '' } };
  var b = { baseRev: NB.revs[j.id] };
  if (j.force) { b.force = true; b.title = j.title; b.body = j.body; b.ink = j.ink; }
  else { if (j.f.title) b.title = j.title; if (j.f.body) b.body = j.body; if (j.f.ink) b.ink = j.ink; }
  return { url: '/api/notebook/notes/' + encodeURIComponent(j.id), body: b };
}
function _nbSave() {
  if (NB.saving) return NB.saving.then(function () { return _nbSendable().length ? _nbSave() : null; });
  var keys = _nbSendable();
  if (!keys.length) { _nbStateCur(); return Promise.resolve(); }
  clearTimeout(NB.retryT); NB.retryT = null;
  var jobs = keys.map(function (k) { var j = NB.pend[k]; delete NB.pend[k]; NB.sending[k] = 1; return j; });
  var again = false;
  _nbStateCur();
  NB.saving = jobs.reduce(function (pr, j) {
    return pr.then(function () {
      var q = _nbReq(j);
      return apiFetch(q.url, { method: 'PUT', body: JSON.stringify(q.body) }).then(function (r) {
        if (!r) throw new Error('로그인이 끝났습니다');
        _nbDone(j, r.data, q.body);
      }).catch(function (e) { if (_nbFail(j, e)) again = true; }).then(function () { delete NB.sending[j.key]; });
    });
  }, Promise.resolve()).then(function () {
    NB.saving = null;
    if (again) {
      var ms = NB_RETRY[Math.min(NB.retryN++, NB_RETRY.length - 1)];
      NB.retryT = setTimeout(function () { NB.retryT = null; _nbSave(); }, ms);
    } else if (!_nbHasPend()) NB.retryN = 0;
    _nbStateCur();
  });
  return NB.saving;
}
/** 잘 닿음 */
function _nbDone(j, o, sent) {
  if (j.k === 'd') {
    if (NB.daily1 && _nbKeyOf(NB.daily1) === j.key) NB.daily1.srv = j.body;
    if (NB.pend[j.key]) NB.pend[j.key].base = j.body;
    var dd = _nbDDraft(j.date, j.ref); if (dd && (!NB.pend[j.key] || dd.body === j.body)) _nbDDraft(j.date, j.ref, null);
    return;
  }
  NB.revs[j.id] = o.rev;
  if (!NB.pend[j.key]) _nbDraft(j.id, null);
  if (j.force) _nbToast('✓ 내 것으로 저장했습니다');
  try {
    if (NB.cur && NB.cur.id === j.id) { NB.cur.rev = o.rev; NB.cur.updatedAt = o.updatedAt; NB.cur.words = o.words; var u = document.getElementById('nbUpd'); if (u) u.textContent = '고침 ' + _nbWhen(o.updatedAt); }
    _nbListUpdate(o, sent);
  } catch (_) {}
}
/** 못 닿음 — 다시 보낼 것이면 true */
function _nbFail(j, e) {
  var st = e && e.status, srv = e && e.data && e.data.data, cur = !!(_nbDoc() && _nbKeyOf(_nbDoc()) === j.key);
  var name = j.k === 'd' ? (+j.date.slice(5, 7)) + '/' + (+j.date.slice(8, 10)) + ' 일일 노트' : '"' + (j.title || '제목 없음').slice(0, 30) + '"';
  if (j.k === 'n' && st === 409) {
    if (srv && _nbSameAs(srv, j)) { _nbDone(j, srv, {}); return false; }   // 시간 초과 뒤 다시 보낸 것 — 실은 이미 저장됨
    _nbBack(j); _nbDraftPut(NB.pend[j.key]);   // 임시 보관은 지우지 않음
    if (NB.cur && NB.cur.id === j.id) { NB.conflictKey = j.key; _nbShowConflict(srv); }
    else { NB.err[j.key] = '다른 곳에서 고침'; _nbToast('⚠️ ' + name + ' 노트를 다른 곳에서 먼저 고쳐 저장하지 못했습니다 — 다시 열면 고를 수 있습니다', 'warn'); }
    return false;
  }
  if (j.k === 'd' && st === 409 && srv) {   // 일일 노트를 다른 곳(📝 서랍 · 다른 창)에서 먼저 고침 → 합쳐서 다시 (v13.333)
    var theirs = srv.body || '', live = !!(NB.daily1 && _nbKeyOf(NB.daily1) === j.key), p2 = NB.pend[j.key];
    var mine = live ? NB.daily1.body : p2 ? p2.body : j.body;
    var merged = typeof wmMergeNote === 'function' ? wmMergeNote(j.base || '', mine, theirs) : mine;
    if (live) {
      NB.daily1.srv = theirs; NB.daily1.body = merged;
      var sr = _nbSrc(); if (sr && sr.value !== merged) { var ca = sr.selectionStart; sr.value = merged; sr.setSelectionRange(Math.min(ca, merged.length), Math.min(ca, merged.length)); _nbRenderPrev(); _nbFoot(); }
    }
    if (merged === theirs) { delete NB.pend[j.key]; _nbDDraft(j.date, j.ref, null); return false; }
    var q2 = p2 || (NB.pend[j.key] = { key: j.key, k: 'd', date: j.date, ref: j.ref, f: {} });
    q2.body = merged; q2.base = theirs; _nbDraftPut(q2);
    _nbToast('🔀 다른 곳에서 고친 일일 노트와 합쳤습니다', 'info');
    _nbQueue(50); return false;   // 기다리지 않고 바로 다시
  }
  _nbBack(j); _nbDraftPut(NB.pend[j.key]);
  if (j.k === 'n' && (st === 410 || st === 404 || st === 403)) {
    delete NB.pend[j.key];   // 다시 보내도 안 됨 — 글은 이 기기 임시 보관에 남음
    _nbToast('❌ ' + name + ' — ' + (st === 410 ? '휴지통에 있는 노트라' : '고칠 수 없는 노트라') + ' 저장하지 않았습니다 (쓴 글은 이 기기에 남겨 둠)', 'error');
    return false;
  }
  if (!st || st >= 500 || st === 408 || st === 429) {
    if (!NB.retryN) _nbToast('⚠️ 노트 저장이 잠깐 안 됩니다 — 이 기기에 두고 곧 다시 보냅니다', 'warn');
    return true;
  }
  NB.err[j.key] = _nbErr(e);   // 고쳐 쓰기 전엔 다시 보내지 않음 (예: 너무 긺)
  if (!cur) _nbToast('❌ ' + name + ' 저장 못 함 — ' + _nbErr(e) + ' (글은 이 기기에 남아 있습니다)', 'error');
  return false;
}
/** 못 보낸 것을 다시 대기열로 — 그새 더 쓴 게 있으면 그 값이 이기고 고친 칸 표시만 합침 */
function _nbBack(j) {
  var p = NB.pend[j.key];
  if (!p) { NB.pend[j.key] = j; return; }
  Object.keys(j.f).forEach(function (f) { p.f[f] = 1; });
  if (j.force) p.force = true;
}
function _nbCanon(v) {
  if (Array.isArray(v)) return v.map(_nbCanon);
  if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = _nbCanon(v[k]); }); return o; }
  return v;
}
function _nbSameAs(s, j) {
  var all = !!j.force;
  return ((!all && !j.f.title) || (s.title || '') === (j.title || '')) && ((!all && !j.f.body) || (s.body || '') === (j.body || '')) &&
    ((!all && !j.f.ink) || JSON.stringify(_nbCanon(s.ink || {})) === JSON.stringify(_nbCanon(j.ink || {})));
}
/** 지금 보는 노트의 저장 표시 */
function _nbStateCur() {
  var d = _nbDoc(); if (!d) return;
  var k = _nbKeyOf(d);
  if (NB.conflict && NB.conflictKey === k) return _nbState('error', '다른 곳에서 고침');
  if (NB.err[k]) return _nbState('error', NB.err[k]);
  if (NB.sending[k]) return _nbState('saving');
  if (NB.pend[k]) return NB.retryT ? _nbState('offline', navigator.onLine === false ? '연결 끊김 — 이 기기에 보관 중' : '저장 안 됨 — 곧 다시 보냄') : _nbState('dirty');
  _nbState('saved');
}
/** 창을 닫을 때 — 남은 글을 keepalive 로 (64KB 넘는 글은 임시 보관으로만) */
function _nbFlushNow() {
  clearTimeout(NB.timer); NB.timer = null;
  _nbDraftAll();
  if (typeof _accessToken === 'undefined' || !_accessToken) return;
  _nbSendable().forEach(function (k) {
    var j = NB.pend[k], q = _nbReq(j), s = JSON.stringify(q.body);
    if (typeof Blob !== 'undefined' && new Blob([s]).size > 60000) return;
    try {
      fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + q.url, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + _accessToken }, body: s })
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (o) { if (o && NB.pend[k] === j) { delete NB.pend[k]; _nbDone(j, o.data, q.body); } }).catch(function () {});
    } catch (_) {}
  });
}
/** 로그아웃 — 화면 · 기억을 비움 (다음 사람에게 보이지 않게). 못 보낸 글은 그 사람 이름의 임시 보관에 남음 */
function nbReset() {
  try { _nbFlushNow(); } catch (_) {}
  try { _nbInkStop(); _nbOverStop(); } catch (_) {}
  clearTimeout(NB.timer); clearTimeout(NB.retryT); clearTimeout(NB.dtimer);
  Object.keys(NB.blobs).forEach(function (k) { Promise.resolve(NB.blobs[k]).then(function (u) { if (/^blob:/.test(u)) URL.revokeObjectURL(u); }).catch(function () {}); });
  Object.assign(NB, { inited: false, meta: null, list: [], daily: [], q: '', cur: null, daily1: null, saving: null, timer: null, conflict: null, conflictKey: null,
    pend: {}, revs: {}, err: {}, sending: {}, retryN: 0, retryT: null, dtimer: null, openSeq: NB.openSeq + 1, blobs: {}, pendingOpen: null, toc: null, _draft: null, inkEd: null, inkId: null, overEd: null });
  if (typeof NBP !== 'undefined') { NBP.ai = null; NBP.sp = null; NBP.open = {}; NBP.titles = null; NBP.kindOver = null; NBP.filter = ''; }
  var r = document.getElementById('mNotebook'); if (r) r.innerHTML = '';
  var q = document.getElementById('nbQuick'); if (q) q.remove();
}
/** 목록 미리보기 — 서버 snippet() 과 같은 방식 (v13.332: 꾸밈 기호 자리에 빈칸이 생기지 않게) */
function _nbSnippet(body) {
  return String(body || '').slice(0, 6000)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/gm, ' ')
    .replace(/^::ink\[[^\]]*\]\s*$/gm, '✍️ ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼 ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+|^>\s*(\[![A-Z]+\]\s*)?|^\s*[-*+]\s+(\[[ xX]\]\s+)?|^\s*\d+\.\s+/gm, '')
    .replace(/\*\*|__|~~|==|`+/g, '').replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2').replace(/\s*\|\s*/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
}
/** 목록 한 줄만 고치기 (다시 받지 않고) */
function _nbListUpdate(o, sent) {
  var it = NB.list.filter(function (x) { return x.id === o.id; })[0];
  if (!it) return;
  Object.assign(it, { title: o.title, updatedAt: o.updatedAt, rev: o.rev, pinned: o.pinned, starred: o.starred, tags: o.tags, folderId: o.folderId, inbox: o.inbox, words: o.words, hasInk: o.hasInk });
  if (sent && sent.body != null) it.snippet = _nbSnippet(sent.body);
  var el = document.querySelector('#nbItems .nb-it[data-id="' + o.id + '"]');
  if (el) {
    var t = el.querySelector('.nb-it-t'); if (t) t.innerHTML = (it.starred ? '<span class="nb-star">★</span>' : '') + _nbE(_nbTitleOf(it));
    var s = el.querySelector('.nb-it-s'); if (s && !it.hit) s.textContent = it.snippet || '';
    var m = el.querySelector('.nb-it-m span'); if (m) m.textContent = _nbWhen(it.updatedAt);
  }
}
/** 부분 고치기 (고정 · 즐겨찾기 · 폴더 · 태그 · 낙서장) — 충돌 확인 없이 */
function _nbPatch(id, patch, okMsg) {
  return apiFetch('/api/notebook/notes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(patch) }).then(function (r) {
    var o = r.data;
    if (NB.cur && NB.cur.id === id) { Object.keys(patch).forEach(function (k) { NB.cur[k] = o[k]; }); _nbDrawTopOnly(); }
    if (okMsg) _nbToast(okMsg);
    _nbLoadMeta().then(function () { if ('folderId' in patch && NB.cur && NB.cur.id === id) _nbDrawTopOnly(); });   // 새 폴더 이름이 머리에 보이게
    var listChanges = 'folderId' in patch || 'inbox' in patch || 'pinned' in patch;
    if (listChanges) _nbLoadList(); else _nbListUpdate(o);
  }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
}
function _nbDrawTopOnly() {
  // 편집 중인 글 · 커서는 두고 위 막대와 태그만
  var src = _nbSrc(), a = src ? src.selectionStart : 0, b = src ? src.selectionEnd : 0, st = src ? src.scrollTop : 0, focused = document.activeElement === src;
  var keepBody = src ? src.value : null;
  _nbDrawMain();
  var s2 = _nbSrc();
  if (s2 && keepBody != null) { s2.value = keepBody; s2.scrollTop = st; if (focused) { s2.focus(); s2.setSelectionRange(a, b); } }
}
function _nbAddTag(v) {
  var parts = String(v || '').split(/[,\s]+/).map(function (x) { return x.replace(/^#+/, '').trim(); }).filter(Boolean);
  if (!parts.length) return;
  var tags = (NB.cur.tags || []).slice();
  parts.forEach(function (p) { if (tags.map(function (x) { return x.toLowerCase(); }).indexOf(p.toLowerCase()) < 0) tags.push(p); });
  _nbSetTags(tags, true);
}
function _nbSetTags(tags, refocus) {
  NB.cur.tags = tags;
  var row = document.getElementById('nbTagRow'); if (row) row.innerHTML = _nbTagsHtml();
  if (refocus) { var i = document.getElementById('nbTagIn'); if (i) i.focus(); }
  apiFetch('/api/notebook/notes/' + encodeURIComponent(NB.cur.id), { method: 'PUT', body: JSON.stringify({ tags: tags }) }).then(function (r) { _nbListUpdate(r.data); _nbLoadMeta(); }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
}

/* 충돌 · 임시 보관 */
function _nbShowConflict(server) {
  NB.conflict = server || true;
  _nbStateCur();
  var b = document.getElementById('nbBars'); if (!b) return;
  b.innerHTML = '<div class="nb-bar err" role="alert">⚠️ 다른 창이나 기기에서 이 노트를 먼저 고쳤습니다' + (server && server.updatedAt ? ' (' + _nbWhen(server.updatedAt) + ')' : '') + '. 내 글은 이 기기에 남아 있습니다.' +
    '<button class="nb-btn sm" data-nb="cf-reload">그쪽 것 불러오기</button><button class="nb-btn sm" data-nb="cf-mine">내 것으로 덮기</button><button class="nb-btn sm" data-nb="cf-copy">내 것을 사본으로</button></div>';
}
function _nbConflict(how) {
  var server = NB.conflict && NB.conflict.id ? NB.conflict : null, mine = NB.cur; if (!mine) return;
  var key = 'n:' + mine.id;
  NB.conflict = null; NB.conflictKey = null; delete NB.err[key];
  var bars = document.getElementById('nbBars'); if (bars) bars.innerHTML = '';
  if (how === 'reload') {
    delete NB.pend[key]; _nbDraft(mine.id, null);
    if (server) { NB.cur = server; NB.revs[server.id] = server.rev; _nbDrawMain(); } else { NB.cur = null; _nbOpen(mine.id); }
    return;
  }
  if (how === 'mine') {   // 대기열로 — 앞 저장이 끝난 뒤 차례로 (따로 보내 엇갈리지 않게)
    var p = _nbPendOf(mine); p.force = true; p.f = { title: 1, body: 1, ink: 1 };
    _nbFlush(); return;
  }
  delete NB.pend[key];
  apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: (mine.title || '제목 없음') + ' (내 사본)', body: mine.body, ink: mine.ink, tags: mine.tags, folderId: mine.folderId }) }).then(function (r) {
    _nbDraft(mine.id, null);
    NB.cur = null; _nbToast('✓ 사본으로 저장했습니다'); _nbLoadList(); _nbOpen(r.data.id);
  }).catch(function (e) {
    _nbPendOf(mine).f = { title: 1, body: 1, ink: 1 }; NB.conflictKey = key; _nbShowConflict(server);   // 다시 고를 수 있게
    _nbToast('❌ ' + _nbErr(e), 'error');
  });
}
/** 열 때 이 기기에 남은 글이 있으면 — 서버 글과 같으면 지우고, 다르면 고르게 */
function _nbDraftCheck(n) {
  var d = _nbDraft(n.id); if (!d) return;
  var same = (d.title == null || d.title === n.title) && (d.body == null || d.body === n.body) && (!d.ink || JSON.stringify(_nbCanon(d.ink)) === JSON.stringify(_nbCanon(n.ink || {})));
  if (same || _nbRO()) { _nbDraft(n.id, null); return; }
  _nbShowDraftBar(d, d.rev != null && d.rev !== n.rev);
}
function _nbShowDraftBar(d, moved) {
  var b = document.getElementById('nbBars'); if (!b) return;
  NB._draft = d;
  b.innerHTML = '<div class="nb-bar warn" role="alert">💾 저장되지 못한 글이 이 기기에 남아 있습니다 (' + _nbWhen(d.t) + ')' +
    (moved ? ' — 그 뒤 다른 곳에서 고친 글이 있어, 되살리면 그 글을 덮습니다' : '') + '.' +
    '<button class="nb-btn sm" data-nb="draft-use">되살리기</button>' + (moved ? '<button class="nb-btn sm" data-nb="draft-copy">사본으로</button>' : '') +
    '<button class="nb-btn sm" data-nb="draft-drop">버리기</button></div>';
}
function _nbDraftUse() {
  var d = NB._draft; if (!d || !NB.cur) return;
  if (d.title != null) NB.cur.title = d.title;
  if (d.body != null) NB.cur.body = d.body;
  if (d.ink) NB.cur.ink = d.ink;
  NB._draft = null;
  _nbDrawMain();
  var p = _nbPendOf(NB.cur); p.f.title = 1; p.f.body = 1; if (d.ink) p.f.ink = 1;
  _nbQueue(10);
}
function _nbDraftCopy() {
  var d = NB._draft, n = NB.cur; if (!d || !n) return;
  apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: (d.title || n.title || '제목 없음') + ' (이 기기에 남은 글)', body: d.body != null ? d.body : n.body, ink: d.ink || n.ink, tags: n.tags, folderId: n.folderId }) }).then(function (r) {
    _nbDraft(n.id, null); NB._draft = null; _nbToast('✓ 사본으로 저장했습니다'); _nbLoadList(); _nbOpen(r.data.id);
  }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
}

/* ═══ 새 노트 · 양식 ═══ */
function nbNewFromTemplate(k) {
  var t = NB_TEMPLATES.filter(function (x) { return x.k === k; })[0] || NB_TEMPLATES[0];
  var folderId = NB.folder || null, inbox = NB.view === 'inbox' && !NB.folder;
  if (t.server) {
    return apiFetch('/api/notebook/template/daily?date=' + _nbToday()).then(function (r) { return nbNewFrom(r.data.body, r.data.title, { folderId: folderId, tags: ['일일업무'] }); })
      .catch(function (e) { _nbToast('❌ 양식을 만들지 못했습니다 — ' + _nbErr(e), 'error'); });
  }
  return nbNewFrom(t.body, t.title || '', { folderId: folderId, inbox: inbox, tags: NB.tag ? [NB.tag] : [] });
}
function nbNewFrom(body, title, o) {
  o = o || {};
  _nbFlush();
  var go = function () {
    return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ title: title || '', body: body || '', folderId: o.folderId || null, inbox: !!o.inbox, tags: o.tags || [], ink: o.ink || undefined }) }).then(function (r) {
      NB.cur = r.data; NB.daily1 = null; NB.revs[r.data.id] = r.data.rev; NB.openSeq++;
      if (typeof NBP !== 'undefined') { NBP.titles = null; NBP.ai = null; NBP.sp = null; NBP.open = {}; NBP.kindOver = null; }
      if (NB.view === 'trash' || NB.view === 'shared' || NB.view === 'daily' || (NB.view === 'inbox' && !o.inbox)) { NB.view = o.inbox ? 'inbox' : 'all'; NB.folder = o.folderId || null; }
      NB.list.unshift(Object.assign({ snippet: _nbSnippet(body) }, r.data));
      _nbDrawList(); _nbLoadMeta();
      if (NB.mode === 'view') NB.mode = 'split';
      _nbDrawMain(); _nbSetPane('note'); _nbLS('last:' + _nbUid(), r.data.id);
      var tt = document.getElementById('nbTitle'), s = _nbSrc();
      if (title && /— $/.test(title)) { tt.focus(); tt.setSelectionRange(tt.value.length, tt.value.length); }
      else if (!title) tt.focus();
      else if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      return r.data;
    }).catch(function (e) { _nbToast('❌ 노트를 만들지 못했습니다 — ' + _nbErr(e), 'error'); });
  };
  if (typeof curPage !== 'undefined' && curPage !== 'notebook') { setPage('notebook'); return new Promise(function (res) { setTimeout(function () { res(go()); }, 150); }); }
  return go();
}
function _nbTplMenu(anchor) {
  _nbMenu(anchor, NB_TEMPLATES.map(function (t) { return [t.icon + ' ' + t.name, function () { nbNewFromTemplate(t.k); }]; }));
}

/* ═══ 떠 있는 메뉴 ═══ */
function _nbMenu(anchor, items) {
  var old = document.getElementById('nbMenu'); if (old) { old.remove(); if (old._anchor === anchor) return; }
  var m = document.createElement('div'); m.id = 'nbMenu'; m.className = 'nb-pop nb-menu'; m.setAttribute('role', 'menu'); m._anchor = anchor;
  m.innerHTML = items.map(function (it, i) { return it === '-' ? '<div class="nb-pop-sep"></div>' : '<button class="nb-pop-i' + (it[2] ? ' ' + it[2] : '') + '" role="menuitem" data-mi="' + i + '">' + it[0] + '</button>'; }).join('');
  document.body.appendChild(m);
  var r = anchor.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w > 8 ? r.right - w : r.left)) + 'px';
  m.style.top = (r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  m.addEventListener('click', function (e) { var b = e.target.closest('[data-mi]'); if (!b) return; m.remove(); items[+b.getAttribute('data-mi')][1](); });
  setTimeout(function () {
    function off(e) { if (!m.contains(e.target) && e.target !== anchor) { m.remove(); document.removeEventListener('mousedown', off, true); document.removeEventListener('keydown', esc, true); } }
    function esc(e) { if (e.key === 'Escape') { m.remove(); document.removeEventListener('mousedown', off, true); document.removeEventListener('keydown', esc, true); } }
    document.addEventListener('mousedown', off, true); document.addEventListener('keydown', esc, true);
  }, 0);
  var f = m.querySelector('button'); if (f) f.focus();
}
function _nbMoreMenu(anchor) {
  var n = NB.cur, items = [];
  if (NB.daily1) {
    items = [['📓 노트북 노트로 복사', function () { nbNewFrom(NB.daily1.body, NB.daily1.title, {}); }], ['⬇️ Markdown(.md) 내려받기', _nbExportMd], '-',
      ['🖨 출력 미리 보기 · 일일 업무 보고 양식', nbPrintOpen], ['📚 여러 날 묶어 출력', function () { nbPrintBundle('daily'); }]];
    return _nbMenu(anchor, items);
  }
  if (n.readOnly) return _nbMenu(anchor, [['📓 내 노트로 복사', function () { nbNewFrom(n.body, (n.title || '노트') + ' (' + (n.ownerName || '공유') + ')', {}); }], ['⬇️ Markdown(.md) 내려받기', _nbExportMd], ['🖨 출력 미리 보기 · 양식', nbPrintOpen], ['📋 서식째 복사', function () { _nbCopyRich(_nbSrc().value, n.title); }]]);
  if (n.deletedAt) return _nbMenu(anchor, [['♻️ 되살리기', function () { _nbRestore(n.id); }], ['🗑 영구 삭제', function () { _nbPurge(n.id); }, 'danger']]);
  items.push(['👥 공유 (읽기 전용)' + (n.shareN ? ' — ' + n.shareN + '명' : ''), nbpShare]);
  items.push(['📊 리포트 만들기', nbpReport]);
  items.push(['🔤 맞춤법 · 띄어쓰기 검사 (AI)', nbpSpellCheck]);
  items.push('-');
  items.push(['🕘 고친 기록 · 되돌리기', nbVersions]);
  items.push(['🏷 지금 모습에 이름 붙여 남기기', _nbSnapNamed]);
  items.push('-');
  items.push([n.inbox ? '📚 낙서장에서 꺼내기' : '📥 낙서장으로', function () { _nbPatch(n.id, { inbox: !n.inbox }, n.inbox ? '📚 노트로 옮겼습니다' : '📥 낙서장으로 옮겼습니다'); }]);
  items.push(['📑 사본 만들기', function () { apiFetch('/api/notebook/notes/' + encodeURIComponent(n.id) + '/duplicate', { method: 'POST' }).then(function (r) { _nbToast('✓ 사본을 만들었습니다'); _nbLoadList(); _nbOpen(r.data.id); }); }]);
  items.push(['🧭 목차', function () { _nbTocMenu(anchor); }]);
  if (NB.cur.ink && NB.cur.ink.over && NB.cur.ink.over.s && NB.cur.ink.over.s.length) items.push([NB.overHide ? '🖍 마커 표시 보이기' : '🖍 마커 표시 숨기기', function () { NB.overHide = !NB.overHide; _nbDrawOver(); }]);
  items.push('-');
  items.push(['⬇️ Markdown(.md) 내려받기', _nbExportMd]);
  items.push(['📝 Word(.doc) 내려받기', nbPrintQuickWord]);
  items.push(['🖨 출력 미리 보기 · 양식 (Ctrl+P)', nbPrintOpen]);
  items.push(['📚 여러 노트 묶어 출력', function () { nbPrintBundle('notes'); }]);
  items.push(['📋 서식째 복사 (메일 · 메신저에 붙여넣기)', function () { _nbCopyRich(_nbSrc().value, NB.cur.title); }]);
  items.push('-');
  items.push(['🗑 휴지통으로', function () { _nbTrash(n.id); }, 'danger']);
  _nbMenu(anchor, items);
}
function _nbTocMenu(anchor) {
  var toc = NB.toc || [];
  if (!toc.length) { _nbToast('제목(#)이 없어 목차가 비었습니다', 'warn'); return; }
  if (NB.mode === 'edit') _nbSetMode('split');
  _nbMenu(anchor, toc.map(function (t) { return ['<span style="padding-left:' + (t.level - 1) * 12 + 'px">' + _nbE(t.text) + '</span>', function () { var el = document.getElementById(t.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); _nbCaretToLine(t.line); }]; }));
}
function _nbFolderPick(anchor) {
  var items = [['📚 폴더 없음', function () { _nbPatch(NB.cur.id, { folderId: null, inbox: false }, '📁 폴더에서 뺐습니다'); }]];
  ((NB.meta && NB.meta.folders) || []).forEach(function (f) { items.push(['<i class="nb-dot" style="background:' + _nbE(f.color || 'var(--ac)') + '"></i>' + _nbE(f.name), function () { _nbPatch(NB.cur.id, { folderId: f.id, inbox: false }, '📁 ' + f.name + ' 로 옮겼습니다'); }]); });
  items.push('-'); items.push(['＋ 새 폴더 만들어 옮기기', function () { _nbFolderEdit(null, NB.cur.id); }]);
  _nbMenu(anchor, items);
}

/* ═══ 폴더 ═══ */
var NB_FCOLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#64748b'];
function _nbFolderEdit(fid, moveNoteId) {
  var f = fid ? (NB.meta.folders || []).filter(function (x) { return x.id === fid; })[0] : { name: '', color: NB_FCOLORS[(NB.meta.folders || []).length % NB_FCOLORS.length] };
  return wmGuardedModal('nbFolder', function () {
    var md = createModal({ id: 'nbFolderModal', titleText: fid ? '📁 폴더 고치기' : '📁 새 폴더', width: '380px', closeOnEsc: true,
      html: '<label class="nb-fl">이름<input class="mw-input nb-in" id="nbFName" maxlength="80" value="' + _nbE(f.name) + '" placeholder="예: 고객 미팅 · 기술 자료"></label>' +
        '<div class="nb-fl">색<div class="nb-colors" id="nbFColors">' + NB_FCOLORS.map(function (c) { return '<button type="button" class="nb-cl' + (c === f.color ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>'; }).join('') + '</div></div>' +
        '<div class="nb-mfoot"><button class="nb-btn" data-x="cancel">취소</button><button class="nb-btn pri" data-x="ok">' + (fid ? '저장' : '만들기') + '</button></div>' });
    var color = f.color;
    md.box.addEventListener('click', function (e) {
      var c = e.target.closest('[data-c]');
      if (c) { color = c.getAttribute('data-c'); md.box.querySelectorAll('.nb-cl').forEach(function (b) { b.classList.toggle('on', b === c); }); return; }
      var x = e.target.closest('[data-x]'); if (!x) return;
      if (x.getAttribute('data-x') === 'cancel') return md.close();
      save();
    });
    md.box.querySelector('#nbFName').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) save(); });
    function save() {
      var name = md.box.querySelector('#nbFName').value.trim();
      if (!name) { _nbToast('폴더 이름을 적어 주세요', 'warn'); return; }
      (fid ? apiFetch('/api/notebook/folders/' + encodeURIComponent(fid), { method: 'PUT', body: JSON.stringify({ name: name, color: color }) })
        : apiFetch('/api/notebook/folders', { method: 'POST', body: JSON.stringify({ name: name, color: color }) })).then(function (r) {
        md.close(); _nbLoadMeta();
        if (moveNoteId) _nbPatch(moveNoteId, { folderId: r.data.id, inbox: false }, '📁 ' + name + ' 로 옮겼습니다');
        else if (!fid) _nbToast('📁 ' + name + ' 폴더를 만들었습니다 — 노트를 끌어다 놓아 보세요');
        else _nbLoadList();
      }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
    }
  }, 'nbFolderModal', { onOpen: function () { var i = document.getElementById('nbFName'); if (i) { i.focus(); i.select(); } } });
}
function _nbFolderMenu(fid, anchor) {
  var f = (NB.meta.folders || []).filter(function (x) { return x.id === fid; })[0]; if (!f) return;
  _nbMenu(anchor, [
    ['✏️ 이름 · 색 바꾸기', function () { _nbFolderEdit(fid); }],
    ['＋ 이 폴더에 새 노트', function () { NB.folder = fid; nbNewFromTemplate('blank'); }],
    '-',
    ['🗑 폴더 지우기 (노트는 남김)', function () {
      if (!confirm('"' + f.name + '" 폴더를 지울까요?\n안의 노트 ' + (f.n || 0) + '개는 지워지지 않고 \'폴더 없음\' 으로 갑니다.')) return;
      apiFetch('/api/notebook/folders/' + encodeURIComponent(fid), { method: 'DELETE' }).then(function () { if (NB.folder === fid) NB.folder = null; _nbLoadMeta(); _nbLoadList(); _nbToast('폴더를 지웠습니다'); });
    }, 'danger']
  ]);
}

/* ═══ 휴지통 ═══ */
function _nbTrash(id) {
  _nbFlush().then(function () { return apiFetch('/api/notebook/notes/' + encodeURIComponent(id), { method: 'DELETE' }); }).then(function () {
    _nbToastUndo('🗑 휴지통으로 옮겼습니다', function () { _nbRestore(id); });
    if (NB.cur && NB.cur.id === id) { NB.cur = null; _nbDrawMain(); _nbSetPane('list'); }
    _nbLoadMeta(); _nbLoadList();
  }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
}
function _nbRestore(id) {
  apiFetch('/api/notebook/notes/' + encodeURIComponent(id) + '/restore', { method: 'POST' }).then(function (r) {
    _nbToast('♻️ 되살렸습니다'); _nbLoadMeta(); _nbLoadList();
    if (NB.cur && NB.cur.id === id) { NB.cur.deletedAt = null; _nbDrawMain(); }
  }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
}
function _nbPurge(id) {
  if (!confirm('이 노트를 영구 삭제할까요? 되돌릴 수 없습니다.')) return;
  apiFetch('/api/notebook/notes/' + encodeURIComponent(id) + '?purge=1', { method: 'DELETE' }).then(function () {
    if (NB.cur && NB.cur.id === id) { NB.cur = null; _nbDrawMain(); }
    _nbLoadMeta(); _nbLoadList();
  }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
}
function _nbEmptyTrash() {
  if (!confirm('휴지통의 노트 ' + NB.list.length + '개를 모두 영구 삭제할까요?')) return;
  apiFetch('/api/notebook/trash/empty', { method: 'POST' }).then(function (r) { _nbToast('🗑 ' + r.data.n + '개를 지웠습니다'); NB.cur = null; _nbDrawMain(); _nbLoadMeta(); _nbLoadList(); });
}
function _nbToastUndo(msg, undo) {
  var t = document.createElement('div'); t.className = 'nb-undo'; t.setAttribute('role', 'status');
  t.innerHTML = '<span>' + _nbE(msg) + '</span><button>되돌리기</button>';
  document.body.appendChild(t);
  t.querySelector('button').onclick = function () { t.remove(); undo(); };
  setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, 5000);
}

/* ═══ 첨부 ═══ */
function _nbPickFile() {
  var i = document.createElement('input'); i.type = 'file'; i.multiple = true;
  i.onchange = function () { [].slice.call(i.files || []).forEach(_nbUpload); };
  i.click();
}
function _nbUpload(f) {
  if (!f) return;
  if (f.size > 25 * 1024 * 1024) { _nbToast('❌ 25MB 까지 올릴 수 있습니다 — ' + f.name, 'error'); return; }
  var s = _nbSrc(); if (!s || s.readOnly) return;
  var img = /^image\//.test(f.type);
  var name = f.name && f.name !== 'image.png' ? f.name : '사진-' + new Date().toTimeString().slice(0, 8).replace(/:/g, '') + '.png';
  var ph = '⏳ ' + name + ' 올리는 중…';
  _nbInsert((img ? '![' : '[') + ph + '](uploading)' + (img ? '\n' : ''));
  var noteId = NB.cur ? NB.cur.id : '', key0 = _nbKeyOf(_nbDoc());
  var mark = (img ? '![' : '[') + ph + '](uploading)';
  function finish(rep) {   // rep: 바꿀 글 ('' 이면 자리표 지움)
    var d = _nbDoc(), src = _nbSrc();
    if (!d || _nbKeyOf(d) !== key0 || !src) { _nbFixAway(key0, mark + (rep ? '' : img ? '\n' : ''), rep); return; }
    var at = src.value.indexOf(mark); if (at < 0) return;
    var len = mark.length + (!rep && img && src.value.charAt(at + mark.length) === '\n' ? 1 : 0);
    var a0 = src.selectionStart, b0 = src.selectionEnd, keep = document.activeElement === src;
    src.setSelectionRange(at, at + len); _nbInsert(rep);
    var dl = rep.length - len; src.setSelectionRange(a0 > at ? a0 + dl : a0, b0 > at ? b0 + dl : b0);
    if (!keep) src.blur();
  }
  var tried = false;
  function send() {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/notebook/files?name=' + encodeURIComponent(name) + (noteId ? '&noteId=' + encodeURIComponent(noteId) : ''));
    xhr.setRequestHeader('Authorization', 'Bearer ' + (typeof _accessToken !== 'undefined' ? _accessToken : ''));
    xhr.setRequestHeader('Content-Type', f.type || 'application/octet-stream');
    xhr.onload = function () {
      if (xhr.status === 401 && !tried && typeof _tryRefresh === 'function') { tried = true; _tryRefresh().then(function (ok) { if (ok) send(); else { _nbToast('❌ 로그인이 끝나 ' + name + ' 을(를) 올리지 못했습니다', 'error'); finish(''); } }); return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        var d = JSON.parse(xhr.responseText).data, nm = name.replace(/[[\]]/g, '');
        finish(img ? '![' + nm + '](nbf:' + d.id + ')' : '[📎 ' + nm + '](nbf:' + d.id + ')');
      } else {
        var msg = '올리지 못했습니다'; try { msg = JSON.parse(xhr.responseText).message || msg; } catch (_) {}
        _nbToast('❌ ' + name + ' — ' + msg, 'error');
        finish('');
      }
    };
    xhr.onerror = function () { _nbToast('❌ 연결이 끊겨 ' + name + ' 을(를) 올리지 못했습니다', 'error'); finish(''); };
    xhr.send(f);
  }
  send();
}
/** 올리는 사이 다른 노트로 갔을 때 — 그 노트(대기 중인 글 또는 서버 글)의 자리표를 바꿈 */
function _nbFixAway(key, mark, rep) {
  _nbEditAway(key, function (b) { return b.indexOf(mark) >= 0 ? b.replace(mark, rep) : null; }, '올린 파일 자리를 그 노트에 넣지 못했습니다 — 그 노트에서 다시 붙여 주세요');
}
/** 지금 열려 있지 않은 노트(일일 노트)의 글을 고침 — 못 보낸 글이 있으면 거기에, 없으면 서버 글을 받아 고쳐 보냄
 *  fn(body) → 새 글 (null 이면 고칠 곳 없음) · 돌려주는 약속은 고쳤으면 true */
function _nbEditAway(key, fn, failMsg) {
  var p = NB.pend[key];
  if (p && p.body != null) { var nb = fn(p.body); if (nb != null) { p.body = nb; if (p.k === 'n') p.f.body = 1; _nbDraftPut(p); _nbQueue(300); return Promise.resolve(true); } }
  return (NB.saving || Promise.resolve()).then(function () {
    if (key.charAt(0) === 'n') {
      var id = key.slice(2);
      return apiFetch('/api/notebook/notes/' + encodeURIComponent(id)).then(function (r) {
        var n = r.data, nb2 = n ? fn(n.body || '') : null; if (nb2 == null) return false;
        return apiFetch('/api/notebook/notes/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ baseRev: n.rev, body: nb2 }) }).then(function (r2) { NB.revs[id] = r2.data.rev; _nbListUpdate(r2.data, { body: nb2 }); return true; });
      });
    }
    var m = /^d:(\d{4}-\d{2}-\d{2})\|(.*)$/.exec(key); if (!m) return false;
    return apiFetch('/api/my-work/notes?date=' + m[1]).then(function (r) {
      var b = null; (r.data.notes || []).forEach(function (n) { if (n.ref === m[2]) b = n.body; });
      var nb3 = b == null ? null : fn(b); if (nb3 == null) return false;
      return apiFetch('/api/my-work/notes', { method: 'PUT', body: JSON.stringify({ date: m[1], ref: m[2], body: nb3 }) }).then(function () { return true; });
    });
  }).then(function (ok) { if (!ok && failMsg) _nbToast('⚠️ ' + failMsg, 'warn'); return ok; }, function () { if (failMsg) _nbToast('⚠️ ' + failMsg, 'warn'); return false; });
}
function _nbZoomImg(img) {
  if (!img.src) return;
  var ov = document.createElement('div'); ov.className = 'nb-zoom'; ov.innerHTML = '<img src="' + img.src + '" alt="">';
  ov.onclick = function () { ov.remove(); };
  document.body.appendChild(ov);
}

/* ═══ ✍️ 손글씨 ═══ */
function _nbInk() { if (!NB.cur.ink || typeof NB.cur.ink !== 'object') NB.cur.ink = {}; if (!NB.cur.ink.blocks) NB.cur.ink.blocks = {}; return NB.cur.ink; }
function _nbInkNew() {
  if (!NB.cur || _nbRO()) return;
  var id = _nbRid();
  _nbInk().blocks[id] = { h: 360, s: [] };
  if (NB.mode === 'view') { var s = _nbSrc(); s.setSelectionRange(s.value.length, s.value.length); }
  _nbBlock('::ink[' + id + ']\n');
  _nbChanged('ink');
  if (NB.mode === 'edit') _nbSetMode('split');
  setTimeout(function () { _nbInkStart(id); }, 30);
}
function _nbInkStart(id, silent) {
  if (!NB.cur) return;
  var host = document.querySelector('#nbDoc .nb-ink[data-ink="' + id + '"]'); if (!host) return;
  if (NB.inkEd && NB.inkId !== id) _nbInkStop();
  _nbOverStop();
  if (NB.inkEd) NB.inkEd.destroy();
  var blk = _nbInk().blocks[id] || (_nbInk().blocks[id] = { h: 360, s: [] });
  var go = host.querySelector('.nb-ink-go'); if (go) go.remove();
  NB.inkId = id;
  NB.inkEd = NbInk.attach(host, blk, { onChange: function () { _nbChanged('ink'); } });
  NB.inkEd.onState = _nbInkBarState;
  _nbInkBar(host);
  if (!silent) host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function _nbInkStop() {
  if (NB.inkEd) { NB.inkEd.destroy(); NB.inkEd = null; }
  var id = NB.inkId; NB.inkId = null;
  var bar = document.getElementById('nbInkBar'); if (bar) bar.remove();
  if (id) {
    var host = document.querySelector('#nbDoc .nb-ink[data-ink="' + id + '"]');
    if (host && NB.cur) {
      var blk = _nbInk().blocks[id];
      host.innerHTML = blk ? NbInk.svg(blk) : '';
      var b = document.createElement('button'); b.className = 'nb-ink-go'; b.type = 'button'; b.setAttribute('data-inkgo', id); b.textContent = '✍️ 그리기'; host.appendChild(b);
    }
  }
}
function _nbInkBar(host) {
  var old = document.getElementById('nbInkBar'); if (old) old.remove();
  var T = NbInk.tool;
  var bar = document.createElement('div'); bar.id = 'nbInkBar'; bar.className = 'nb-inkbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '손글씨 도구');
  function tb(t, icon, title) { return '<button data-ink-t="t:' + t + '" class="' + (T.t === t ? 'on' : '') + '" title="' + title + '" aria-pressed="' + (T.t === t) + '">' + icon + '</button>'; }
  var cols = (T.t === 'hl' ? NbInk.HL_COLORS : NbInk.COLORS);
  bar.innerHTML = tb('pen', '🖊', '펜') + tb('hl', '🖍', '형광펜') + tb('eraser', '🧽', '지우개 (펜 뒤쪽 버튼도)') + tb('lasso', '➰', '올가미 — 골라서 옮기기 · Delete 로 지우기 · 색 누르면 색 바꾸기') +
    '<span class="nb-inkbar-s"></span>' + cols.map(function (c) { return '<button data-ink-t="c:' + c + '" class="nb-ic' + (T.c === c ? ' on' : '') + '" style="--c:' + c + '" title="색" aria-label="색 ' + c + '"></button>'; }).join('') +
    '<span class="nb-inkbar-s"></span>' + [2, 4, 7].map(function (w) { return '<button data-ink-t="w:' + w + '" class="nb-iw' + (T.w === w ? ' on' : '') + '" title="굵기" aria-label="굵기 ' + w + '"><i style="width:' + (w + 2) + 'px;height:' + (w + 2) + 'px"></i></button>'; }).join('') +
    '<span class="nb-inkbar-s"></span><button data-ink-t="snap" class="' + (T.snap ? 'on' : '') + '" title="📐 도형 보정 — 대충 그린 직선 · 사각형 · 원을 반듯하게" aria-pressed="' + T.snap + '">📐</button>' +
    '<button data-ink-t="undo" title="되돌리기 (Ctrl+Z)">↶</button><button data-ink-t="redo" title="다시 (Ctrl+Y)">↷</button>' +
    (NB.overEd ? '' : '<button data-ink-t="grow" title="칸 늘리기">⇩</button>') + '<button data-ink-t="clear" title="모두 지우기">🗑</button>' +
    '<button data-ink-t="done" class="nb-inkbar-ok" title="다 그림 (Esc)">✓ 완료</button>' +
    (NbInk.penSeen() ? '<span class="nb-inkbar-tip">펜만 그리고 손가락은 화면 이동</span>' : '');
  var wrap = host.closest('.nb-prev') || document.getElementById('nbMain');
  wrap.insertBefore(bar, wrap.firstChild);   // 맨 앞 sticky — 스크롤해도 위에 붙어 있게
}
function _nbInkBarState() { /* 고르기 상태가 바뀌면 (예: 올가미) — 지금은 표시만 그대로 */ }
function _nbInkTool(btn) {
  var v = btn.getAttribute('data-ink-t'), ed = NB.inkEd || NB.overEd, T = NbInk.tool;
  if (!ed) return;
  if (v.indexOf('t:') === 0) {
    var nt = v.slice(2), wasHl = T.t === 'hl';
    T.t = nt;
    if (nt === 'hl' && !wasHl) T.c = NbInk.HL_COLORS[0];
    if (nt === 'pen' && wasHl) T.c = NbInk.COLORS[0];
  } else if (v.indexOf('c:') === 0) { if (!ed.recolorSel(v.slice(2))) T.c = v.slice(2); }
  else if (v.indexOf('w:') === 0) T.w = +v.slice(2);
  else if (v === 'snap') T.snap = !T.snap;
  else if (v === 'undo') ed.undoOne();
  else if (v === 'redo') ed.redoOne();
  else if (v === 'grow') ed.grow(240);
  else if (v === 'clear') { if (confirm('이 칸의 손글씨를 모두 지울까요? (되돌리기로 살릴 수 있습니다)')) ed.clear(); }
  else if (v === 'done') { _nbInkStop(); _nbOverStop(); return; }
  _nbInkBar(NB.overEd ? document.getElementById('nbOver') : document.querySelector('#nbDoc .nb-ink[data-ink="' + NB.inkId + '"]'));
}
/* 🖍 마커 — 노트 전체 위에 덮어 그리기 */
function _nbOverToggle() {
  if (!NB.cur) return;
  if (NB.overEd) return _nbOverStop();
  if (NB.mode !== 'view') _nbSetMode('view');   // 다 쓴 노트 위에 표시 — 넓은 보기에서 (나란히면 글이 바뀌며 자리가 밀림)
  _nbInkStop();
  var ov = document.getElementById('nbOver'), doc = document.getElementById('nbDoc'); if (!ov || !doc) return;
  var ink = _nbInk(); if (!ink.over) ink.over = { s: [] };
  NB.overHide = false;
  if (NbInk.tool.t === 'pen' && !ink.over.s.length) { NbInk.tool.t = 'pen'; NbInk.tool.c = '#dc2626'; }
  ov.classList.add('editing', 'has');
  NB.overEd = NbInk.attach(ov, ink.over, { overlay: true, height: function () { return doc.offsetHeight * NbInk.W / Math.max(1, doc.offsetWidth); }, onChange: function () { _nbChanged('ink'); } });
  _nbInkBar(ov);
  var btn = document.querySelector('[data-fmt="over"]'); if (btn) btn.classList.add('on');
  _nbToast('🖍 노트 위에 표시하세요 — 다 하면 ✓ 완료 (Esc)');
}
function _nbOverStop() {
  if (!NB.overEd) return;
  NB.overEd.destroy(); NB.overEd = null;
  var ov = document.getElementById('nbOver'); if (ov) ov.classList.remove('editing');
  var bar = document.getElementById('nbInkBar'); if (bar) bar.remove();
  var btn = document.querySelector('[data-fmt="over"]'); if (btn) btn.classList.remove('on');
  _nbDrawOver();
}

/* ═══ 찾기 (노트 안) ═══ */
function _nbFindInDoc(kw) {
  var doc = document.getElementById('nbDoc'); if (!doc || !kw) return;
  if (NB.mode === 'edit') _nbSetMode('split');
  var low = kw.toLowerCase(), walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT), node, first = null;
  var hits = [];
  while ((node = walker.nextNode())) { if (node.nodeValue.toLowerCase().indexOf(low) >= 0) hits.push(node); }
  hits.forEach(function (n) {
    var i = n.nodeValue.toLowerCase().indexOf(low);
    var r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + kw.length);
    var mk = document.createElement('mark'); mk.className = 'nb-found';
    try { r.surroundContents(mk); if (!first) first = mk; } catch (_) {}
  });
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ═══ 내보내기 ═══ */
function _nbFileName(ext) { var n = _nbDoc(); return String((n.title || '노트')).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.' + ext; }
function _nbExportMd() {
  var n = _nbDoc(), body = _nbSrc().value;
  var md = (n.title && !/^#\s/.test(body) ? '# ' + n.title + '\n\n' : '') + body;
  _nbSaveBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), _nbFileName('md'));
}
function _nbCopy(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function () { _nbCopyOld(text); });
  _nbCopyOld(text); return Promise.resolve();
}
function _nbCopyOld(text) { var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (_) {} t.remove(); }
/** 서식째 복사 — 메일(Outlook) · 메신저에 붙이면 제목 · 표 · 목록이 그대로 */
function _nbCopyRich(md) {
  // 출력 양식과 같은 꾸밈(notebook-print.js) — 체크 ☑/☐ · 표 테두리 · 강조 상자 · 업무 칩
  var prefs = typeof wmPrintPrefs === 'function' ? wmPrintPrefs() : {};
  return wmCopyHtml(NbPrint.richMd(md, prefs), NbPrint.plainMd(md)).then(function (rich) {
    _nbToast(rich ? '📋 서식째 복사했습니다 — 메일 · 문서에 붙여넣으세요' : '📋 복사했습니다');
  });
}

/* ═══ 고친 기록 ═══ */
function nbVersions() {
  if (!NB.cur) return;
  _nbFlush();
  var id = NB.cur.id;
  return wmGuardedModal('nbVer', function () {
    return apiFetch('/api/notebook/notes/' + encodeURIComponent(id) + '/versions').then(function (r) {
      var vs = r.data || [];
      var md = createModal({ id: 'nbVerModal', titleText: '🕘 고친 기록 — ' + (NB.cur.title || '제목 없음'), width: '980px', closeOnEsc: true, boxStyle: 'padding:18px 20px',
        html: '<div class="nb-ver">' +
          '<div class="nb-ver-l nb-scroll">' + (vs.length ? vs.map(function (v, i) {
            return '<button class="nb-ver-i' + (i === 0 ? ' on' : '') + '" data-v="' + v.id + '"><b>' + new Date(v.createdAt).toLocaleString() + '</b><span>' + (v.label ? '🏷 ' + _nbE(v.label) + ' · ' : '') + '글자 ' + (v.words || 0).toLocaleString() + '</span></button>';
          }).join('') : '<div class="nb-empty">아직 기록이 없습니다<small>고치기 시작하면 10분마다 그 전 모습을 남깁니다</small></div>') + '</div>' +
          '<div class="nb-ver-r"><div class="nb-ver-tb"><div class="nb-seg"><button class="on" data-vm="diff">바뀐 곳</button><button data-vm="view">그때 모습</button></div><span class="nb-sp"></span>' +
          (vs.length ? '<button class="nb-btn pri" data-x="restore">이 모습으로 되돌리기</button>' : '') + '</div><div class="nb-ver-b nb-scroll" id="nbVerB"></div></div></div>' });
      var cur = vs[0] ? vs[0].id : null, mode = 'diff', cache = {};
      function show() {
        var b = md.box.querySelector('#nbVerB'); if (!cur) { b.innerHTML = ''; return; }
        (cache[cur] ? Promise.resolve(cache[cur]) : apiFetch('/api/notebook/notes/' + encodeURIComponent(id) + '/versions/' + cur).then(function (x) { cache[cur] = x.data; return x.data; })).then(function (v) {
          if (mode === 'view') b.innerHTML = '<article class="nb-doc">' + (v.title ? '<h1>' + _nbE(v.title) + '</h1>' : '') + NbMd.render(v.body).html + '</article>';
          else b.innerHTML = _nbDiffHtml((v.title ? '# ' + v.title + '\n' : '') + v.body, (NB.cur.title ? '# ' + NB.cur.title + '\n' : '') + NB.cur.body);
        });
      }
      md.box.addEventListener('click', function (e) {
        var x = e.target.closest('[data-v]');
        if (x) { cur = +x.getAttribute('data-v'); md.box.querySelectorAll('.nb-ver-i').forEach(function (b) { b.classList.toggle('on', b === x); }); show(); return; }
        x = e.target.closest('[data-vm]');
        if (x) { mode = x.getAttribute('data-vm'); md.box.querySelectorAll('[data-vm]').forEach(function (b) { b.classList.toggle('on', b === x); }); show(); return; }
        if (e.target.closest('[data-x="restore"]') && cur) {
          if (!confirm('이 모습으로 되돌릴까요? 지금 모습도 기록에 남아서 다시 돌아올 수 있습니다.')) return;
          apiFetch('/api/notebook/notes/' + encodeURIComponent(id) + '/versions/' + cur + '/restore', { method: 'POST' }).then(function (r) {
            md.close(); delete NB.pend['n:' + id]; NB.revs[id] = r.data.rev; NB.cur = r.data; _nbDraft(id, null); _nbDrawMain(); _nbLoadList(); _nbToast('🕘 되돌렸습니다');
          }).catch(function (e2) { _nbToast('❌ ' + _nbErr(e2), 'error'); });
        }
      });
      show();
    });
  }, 'nbVerModal');
}
function _nbSnapNamed() {
  var label = prompt('이 모습에 붙일 이름 (예: 고객 전달본 · 1차 검토)', '');
  if (label == null) return;
  _nbFlush().then(function () {
    return apiFetch('/api/notebook/notes/' + encodeURIComponent(NB.cur.id) + '/versions', { method: 'POST', body: JSON.stringify({ label: label }) });
  }).then(function () { _nbToast('🏷 남겼습니다 — ⋯ › 고친 기록 에서 볼 수 있습니다'); }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
}
/** 줄 단위 비교 (LCS) — 그때 → 지금 */
function _nbDiff(a, b) {
  var A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  if (n * m > 4000000) return null;
  var dp = []; for (var i = 0; i <= n; i++) { dp.push(new Uint16Array(m + 1)); }
  for (var i2 = n - 1; i2 >= 0; i2--) for (var j = m - 1; j >= 0; j--) dp[i2][j] = A[i2] === B[j] ? dp[i2 + 1][j + 1] + 1 : Math.max(dp[i2 + 1][j], dp[i2][j + 1]);
  var out = [], x = 0, y = 0;
  while (x < n && y < m) {
    if (A[x] === B[y]) { out.push([0, A[x]]); x++; y++; }
    else if (dp[x + 1][y] >= dp[x][y + 1]) { out.push([-1, A[x]]); x++; }
    else { out.push([1, B[y]]); y++; }
  }
  while (x < n) out.push([-1, A[x++]]);
  while (y < m) out.push([1, B[y++]]);
  return out;
}
function _nbDiffHtml(a, b) {
  var d = _nbDiff(a, b);
  if (!d) return '<div class="nb-empty">글이 너무 길어 비교하지 못했습니다 — "그때 모습" 으로 보세요</div>';
  var add = 0, del = 0;
  d.forEach(function (x) { if (x[0] > 0) add++; else if (x[0] < 0) del++; });
  var h = '<div class="nb-diff-s"><span class="add">+' + add + ' 줄 (지금 생김)</span><span class="del">−' + del + ' 줄 (그때만 있음)</span></div><div class="nb-diff">';
  var ctx = 2;
  d.forEach(function (x, i) {
    var near = x[0] !== 0 || d.slice(Math.max(0, i - ctx), i + ctx + 1).some(function (y) { return y[0] !== 0; });
    if (!near) { if (h.slice(-6) !== '</i>…\n') h += '<i class="gap">…</i>…\n'; return; }
    h += '<div class="' + (x[0] > 0 ? 'add' : x[0] < 0 ? 'del' : '') + '"><b>' + (x[0] > 0 ? '+' : x[0] < 0 ? '−' : ' ') + '</b>' + (_nbE(x[1]) || '&nbsp;') + '</div>';
  });
  return h.replace(/…\n/g, '') + '</div>' + (add + del ? '' : '<div class="nb-empty">지금과 같습니다</div>');
}

/* ═══ ✨ AI — 메일 초안 · 번역 · 다듬기 · 요약 ═══ */
function nbAiOpen(preset) {
  var s = _nbSrc(), n = _nbDoc(); if (!s || !n) return;
  var a = s.selectionStart, b = s.selectionEnd, part = a !== b && NB.mode !== 'view';
  var text = part ? s.value.slice(a, b) : ((n.title ? '# ' + n.title + '\n\n' : '') + s.value);
  return wmGuardedModal('nbAi', function () {
    var md = createModal({ id: 'nbAiModal', titleText: '✨ AI 글 도구 — ' + (part ? '고른 부분 (' + text.length.toLocaleString() + '자)' : '노트 전체'), width: '860px', closeOnEsc: true, boxStyle: 'padding:18px 20px',
      html: '<div class="nb-ai">' +
        '<div class="nb-seg nb-ai-k">' + [['mail', '✉️ 메일 초안'], ['translate', '🌐 번역'], ['polish', '✍️ 다듬기'], ['summary', '📝 요약']].map(function (x) { return '<button data-k="' + x[0] + '" class="' + ((preset || 'mail') === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<div class="nb-ai-opt" id="nbAiOpt"></div>' +
        '<div class="nb-ai-go"><button class="nb-btn pri" data-x="run">✨ 만들기</button><span class="nb-ai-st" id="nbAiSt"></span></div>' +
        '<div class="nb-ai-out hidden" id="nbAiOut">' +
          '<div class="nb-ai-subj hidden" id="nbAiSubjW"><label>제목</label><input class="mw-input nb-in" id="nbAiSubj"></div>' +
          '<div class="nb-seg nb-ai-v"><button class="on" data-v="prev">미리보기</button><button data-v="diff" id="nbAiDiffB" title="원문과 비교 — 무엇이 바뀌었는지">↔ 바뀐 곳</button><button data-v="edit">고치기</button></div>' +
          '<article class="nb-doc nb-ai-prev nb-scroll" id="nbAiPrev"></article><textarea class="nb-ai-ta hidden" id="nbAiTa"></textarea>' +
          '<div class="nb-ai-act">' +
            '<button class="nb-btn" data-x="copy">📋 서식째 복사</button><button class="nb-btn" data-x="mailto" id="nbAiMailto">✉️ 메일 앱으로</button>' +
            '<button class="nb-btn" data-x="new">📓 새 노트로</button>' + (NB.cur ? '<button class="nb-btn" data-x="below">⤵ 노트 끝에 넣기</button>' : '') +
            (part && NB.cur ? '<button class="nb-btn" data-x="replace">↔ 고른 부분 바꾸기</button>' : '') + '</div>' +
          '<div class="nb-ai-note">AI 결과는 꼭 확인하고 보내세요 — 사실 · 숫자 · 날짜는 원문에 없으면 [확인 필요] 로 표시하게 했습니다.</div>' +
        '</div></div>' });
    var k = preset || 'mail', out = null;
    function opt() {
      var o = md.box.querySelector('#nbAiOpt');
      if (k === 'mail') o.innerHTML = '<label>받는 사람<input class="mw-input nb-in" id="nbAiTo" placeholder="예: 고객사 구매팀 김과장 · 사내 생산팀"></label>' +
        '<label>목적 (선택)<input class="mw-input nb-in" id="nbAiPur" placeholder="예: 납기 지연 양해 요청 · 회의 결과 공유"></label>' +
        '<label>말투<select class="mw-input nb-in" id="nbAiTone"><option value="polite">공손 · 격식</option><option value="brief">간결 · 핵심만</option><option value="friendly">부드럽게</option><option value="en">영문 비즈니스</option></select></label>';
      else if (k === 'translate') o.innerHTML = '<label>어느 말로<select class="mw-input nb-in" id="nbAiLang"><option value="en">영어</option><option value="ja">일본어</option><option value="zh">중국어(간체)</option><option value="vi">베트남어</option><option value="de">독일어</option><option value="ko">한국어로</option></select></label><span class="nb-ai-hint">표 · 목록 · 체크 같은 서식은 그대로 둡니다</span>';
      else if (k === 'polish') o.innerHTML = '<span class="nb-ai-hint">뜻은 그대로 두고 군더더기 · 중복 · 모호한 표현을 고치고 결론을 앞으로 — 다음 단계의 ✍️ 글쓰기 코치는 고친 이유까지 알려 줍니다</span>';
      else o.innerHTML = '<span class="nb-ai-hint">요약 · 핵심 내용 · 결정 · 할 일로 정리합니다</span>';
    }
    function val(id) { var e = md.box.querySelector('#' + id); return e ? e.value : ''; }
    function result() { return md.box.querySelector('#nbAiTa').value; }
    function showOut(t, subj) {
      out = t;
      md.box.querySelector('#nbAiOut').classList.remove('hidden');
      md.box.querySelector('#nbAiTa').value = t;
      md.box.querySelector('#nbAiPrev').innerHTML = NbMd.render(t).html;
      var sw = md.box.querySelector('#nbAiSubjW'); sw.classList.toggle('hidden', k !== 'mail');
      md.box.querySelector('#nbAiSubj').value = subj || '';
      md.box.querySelector('#nbAiMailto').classList.toggle('hidden', k !== 'mail');
      md.box.querySelector('#nbAiDiffB').classList.toggle('hidden', k !== 'polish');
    }
    md.box.addEventListener('click', function (e) {
      var x = e.target.closest('[data-k]');
      if (x) { k = x.getAttribute('data-k'); md.box.querySelectorAll('[data-k]').forEach(function (b2) { b2.classList.toggle('on', b2 === x); }); opt(); return; }
      x = e.target.closest('[data-v]');
      if (x) {
        var ed = x.getAttribute('data-v') === 'edit', df = x.getAttribute('data-v') === 'diff';
        md.box.querySelectorAll('[data-v]').forEach(function (b2) { b2.classList.toggle('on', b2 === x); });
        md.box.querySelector('#nbAiTa').classList.toggle('hidden', !ed); md.box.querySelector('#nbAiPrev').classList.toggle('hidden', ed);
        if (df) md.box.querySelector('#nbAiPrev').innerHTML = '<div class="nb-ai-diffnote">다듬기 전 → 후 — 줄마다 바뀐 곳 (✍️ 코치에서 왜 바꾸는지 배워 보세요)</div>' + _nbDiffHtml(text, result());
        else if (!ed) md.box.querySelector('#nbAiPrev').innerHTML = NbMd.render(result()).html;
        return;
      }
      x = e.target.closest('[data-x]'); if (!x) return;
      var act = x.getAttribute('data-x'), st = md.box.querySelector('#nbAiSt');
      if (act === 'run') {
        x.disabled = true; st.innerHTML = '<span class="nb-spin"></span> AI 가 쓰는 중… (10~40초)';
        apiFetch('/api/notebook/ai', { method: 'POST', timeoutMs: 120000, body: JSON.stringify({ action: k, text: text, to: val('nbAiTo'), purpose: val('nbAiPur'), tone: val('nbAiTone'), lang: val('nbAiLang') }) }).then(function (r) {
          x.disabled = false; st.textContent = '✓ ' + (r.data.provider || 'AI') + ' 로 만들었습니다';
          showOut(k === 'mail' ? r.data.body : r.data.text, r.data.subject);
        }).catch(function (e2) { x.disabled = false; st.textContent = '❌ ' + _nbErr(e2); });
        return;
      }
      var t = result(), subj = md.box.querySelector('#nbAiSubj').value;
      if (act === 'copy') _nbCopyRich(t, subj);
      else if (act === 'mailto') {
        var plain = t.replace(/^#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/==([^=]+)==/g, '$1').replace(/^- \[[ xX]\] /gm, '- ');
        var url = 'mailto:?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(plain);
        if (url.length > 1900) { _nbCopy(plain); _nbToast('본문이 길어 메일 앱에는 제목만 넣었습니다 — 본문은 복사해 두었으니 붙여넣으세요', 'warn'); url = 'mailto:?subject=' + encodeURIComponent(subj); }
        location.href = url;
      } else if (act === 'new') {
        var ttl = k === 'mail' ? (subj || '메일 초안') : k === 'translate' ? (n.title || '노트') + ' (' + (md.box.querySelector('#nbAiLang') ? md.box.querySelector('#nbAiLang').selectedOptions[0].textContent : '번역') + ')' : (n.title || '노트') + (k === 'summary' ? ' — 요약' : ' — 다듬음');
        md.close(); nbNewFrom(t, ttl, { folderId: NB.cur ? NB.cur.folderId : null, tags: k === 'mail' ? ['메일'] : [] });
      } else if (act === 'below') {
        md.close(); if (NB.mode === 'view') _nbSetMode('split');
        var s2 = _nbSrc(); s2.setSelectionRange(s2.value.length, s2.value.length);
        _nbInsert((s2.value && !/\n\n$/.test(s2.value) ? '\n\n' : '') + '---\n' + (k === 'mail' && subj ? '**제목: ' + subj + '**\n\n' : '') + t + '\n');
      } else if (act === 'replace') {
        md.close(); var s3 = _nbSrc(); s3.setSelectionRange(a, b); _nbInsert(t);
      }
    });
    opt();
  }, 'nbAiModal');
}

/* ═══ 📥 낙서장 빨리 적기 (어느 화면에서든) ═══ */
function nbQuickOpen() {
  var el = document.getElementById('nbQuick');
  if (el) { el.querySelector('textarea').focus(); return; }
  el = document.createElement('div'); el.id = 'nbQuick'; el.className = 'nb-quick'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '낙서장에 빨리 적기');
  el.innerHTML = '<div class="nb-quick-h"><b>📥 낙서장</b><span class="nb-sp"></span><button data-q="pen" title="✍️ 펜으로 쓰기" aria-pressed="false">✍️</button><button data-q="x" title="닫기 (Esc)" aria-label="닫기">✕</button></div>' +
    '<textarea placeholder="떠오른 것을 바로 — 나중에 노트북에서 정리 (Ctrl+Enter 저장)" aria-label="낙서장 내용"></textarea>' +
    '<div class="nb-quick-ink hidden"></div>' +
    '<div class="nb-quick-f"><small>Alt+N · 텔레그램 /memo</small><span class="nb-sp"></span><button class="nb-btn" data-q="open">📓 노트북</button><button class="nb-btn pri" data-q="save">저장</button></div>';
  document.body.appendChild(el);
  var ta = el.querySelector('textarea'), ink = null, blk = { h: 260, s: [] };
  var qk = 'nb-quick-draft:' + _nbUid(), busy = false;
  try { localStorage.removeItem('nb-quick-draft'); } catch (_) {}   // 옛 이름 (사람 구분 없음) 은 지움
  try { var dr = localStorage.getItem(qk); if (dr) ta.value = dr; } catch (_) {}
  ta.addEventListener('input', function () { try { localStorage.setItem(qk, ta.value); } catch (_) {} });
  function close() { if (ink) ink.destroy(); el.remove(); document.removeEventListener('keydown', key, true); }
  function save() {
    var body = ta.value.trim(), has = blk.s.length > 0;
    if (!body && !has) { close(); return; }
    if (busy) return; busy = true;
    var sb = el.querySelector('[data-q="save"]'); if (sb) { sb.disabled = true; sb.textContent = '저장 중…'; }
    var id = _nbRid(), data = { inbox: true, source: 'quick', body: body + (has ? (body ? '\n\n' : '') + '::ink[' + id + ']\n' : '') };
    if (has) { data.ink = { blocks: {} }; data.ink.blocks[id] = blk; }
    apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify(data) }).then(function () {
      try { localStorage.removeItem(qk); } catch (_) {}
      _nbToast('📥 낙서장에 적었습니다');
      close();
      if (NB.inited) { _nbLoadMeta(); if (NB.view === 'inbox') _nbLoadList(); }
    }).catch(function (e) { busy = false; if (sb) { sb.disabled = false; sb.textContent = '저장'; } _nbToast('❌ 저장하지 못했습니다 — ' + _nbErr(e) + ' (글은 이 기기에 남겨 두었습니다)', 'error'); });
  }
  function key(e) {
    if (!el.isConnected) return;
    if (e.key === 'Escape' && el.contains(document.activeElement)) { e.preventDefault(); if (ta.value.trim() || blk.s.length) save(); else close(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && el.contains(document.activeElement)) { e.preventDefault(); save(); }
  }
  document.addEventListener('keydown', key, true);
  el.addEventListener('click', function (e) {
    var b = e.target.closest('[data-q]'); if (!b) return;
    var k = b.getAttribute('data-q');
    if (k === 'x') close();
    else if (k === 'save') save();
    else if (k === 'open') { save(); if (typeof setPage === 'function') { NB.view = 'inbox'; NB.folder = null; NB.tag = null; setPage('notebook'); } }
    else if (k === 'pen') {
      var box = el.querySelector('.nb-quick-ink'), on = box.classList.toggle('hidden') === false;
      b.setAttribute('aria-pressed', on); b.classList.toggle('on', on);
      if (on && !ink) { ink = NbInk.attach(box, blk, {}); }
    }
  });
  ta.focus();
}
/** Mac 에서는 Option+글자가 글자 입력(˜ · ∑ …) — 쓰는 칸 안에서는 단축키로 가로채지 않음 (v13.332) */
function nbAltTyping(e) {
  if (e.isComposing) return true;
  if (!/Mac|iPhone|iPad/.test(navigator.platform || '')) return false;
  var t = e.target; return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
}
document.addEventListener('keydown', function (e) {
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'N' || e.code === 'KeyN') && !nbAltTyping(e)) {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    e.preventDefault();
    if (e.shiftKey && typeof curPage !== 'undefined' && curPage === 'notebook') nbNewFromTemplate('blank');
    else nbQuickOpen();
  }
});

/* 내 업무 📝 노트 서랍에서 — 📅 일일 노트로 */
function nbOpenDailyView() {
  NB.view = 'daily'; NB.folder = null; NB.tag = null; NB.q = '';
  if (NB.inited) { _nbSavePrefs(); _nbDrawSideOn(); }
  else { try { var o = JSON.parse(localStorage.getItem(NB_LS) || '{}'); o.p = Object.assign(o.p || {}, { view: 'daily', folder: null, tag: null }); localStorage.setItem(NB_LS, JSON.stringify(o)); } catch (_) {} }
  setPage('notebook');
}

/* 다른 화면에서 — 예: 메신저 메시지를 노트로 */
function nbSendToInbox(body, source) {
  return apiFetch('/api/notebook/notes', { method: 'POST', body: JSON.stringify({ inbox: true, source: source || 'quick', body: body }) }).then(function (r) {
    _nbToast('📥 노트북 낙서장에 넣었습니다');
    if (NB.inited) { _nbLoadMeta(); if (NB.view === 'inbox') _nbLoadList(); }
    return r.data;
  }).catch(function (e) { _nbToast('❌ ' + _nbErr(e), 'error'); });
}

/* 📖 펼쳐 보기 (v13.326) — 보던 노트(일일 노트)부터, 목록이면 그 종류부터 */
function nbBookOpen() {
  if (typeof wmBookOpen !== 'function') return;
  if (typeof _nbFlush === 'function') _nbFlush();
  var cur = NB.daily1 ? 'daily:' + NB.daily1.date + '|' + (NB.daily1.ref || '') : NB.cur && NB.cur.id && !NB.cur.readOnly ? 'note:' + NB.cur.id : null;
  return wmBookOpen({ cur: cur, kind: cur ? null : NB.view === 'daily' ? 'daily' : 'note' });
}

/* 창 이벤트 (v13.332) — 닫을 때 남은 글 보내기 · 숨길 때 바로 저장 · 다시 연결되면 바로 */
window.addEventListener('pagehide', function () { try { _nbFlushNow(); } catch (_) {} });
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { _nbDraftAll(); if (_nbSendable().length) _nbFlush(); } });
window.addEventListener('beforeunload', function (e) { if (_nbSendable().length || NB.saving) { _nbDraftAll(); _nbFlush(); e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('online', function () { if (_nbHasPend()) { NB.retryN = 0; _nbFlush(); } });
