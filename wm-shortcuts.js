/**
 * 🔖 바로가기 (v13.528) — 어디서든 "지금 화면"을 저장하고 내 업무 오른쪽 아래에서 바로 이동
 *   한 줄마다 메뉴 › 파트 › 항목 (예: 📁 프로젝트 관리 › 📂 문서 › 발표.pptx) — 목록은 메뉴별로 묶고 접기 · 메뉴 칩으로 거르기
 *   잡는 것: 메뉴(상위 탭) · 파트(하위 탭) + 열려 있는 항목 — 프로젝트 상세 · 문서(크게 보기 · 문서 화면에서 고른 것) · 노트 · 마인드맵 · 메신저 방
 *   넣는 곳: 머리 줄 🔖 (지금 화면 추가 + 빠른 목록) · 프로젝트 상세 ⋯ · 문서 크게 보기 · 사용자 메뉴(휴대폰)
 *   관리: 내 업무 오른쪽 칸 맨 아래 — 누르면 이동 · ✏️ 이름 · ↑↓ 순서 · 🗑 휴지통(되살리기 · 영구 삭제 · 비우기)
 * 서버: /api/shortcuts (routes/shortcuts.js)
 */
var WSC = { list: null, trashN: 0, trash: null, showTrash: false, filter: '', folded: {}, loading: null };
var WSC_CTX_IC = { project: '📁', note: '📓', map: '🧠', room: '💬', doc: '📄', docview: '📄' };
function _wscE(s) { return typeof eH === 'function' ? eH(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _wscToast(m, k) { if (typeof showToast === 'function') showToast(m, k); }
function _wscTxt(el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
try { WSC.folded = JSON.parse(localStorage.getItem('wm.wsc.fold') || '{}') || {}; } catch (_) {}

/* ─── 지금 화면 ─── */
var WSC_PAGE = { team: '📒 업무 관리', project: '📁 프로젝트 관리', mywork: '🎯 내 업무', mindmap: '🧠 마인드맵', notebook: '📓 노트', messages: '💬 메신저', useradmin: '👤 사용자 관리', patchnotes: '📋 패치노트' };
function _wscMenuLabel(page) {
  var t = document.querySelector('#pageTabs .tab[data-page="' + page + '"]');
  return _wscTxt(t) || WSC_PAGE[page] || page;
}
function _wscModeLabel(m) {
  var t = document.querySelector('#modeTabs .tab[data-m="' + m + '"],#modeTabsProj .tab[data-m="' + m + '"]');
  return _wscTxt(t) || m;
}
function wscHere() {
  var page = typeof curPage !== 'undefined' ? curPage : 'team';
  var mode = (page === 'team' || page === 'project') && typeof curMode !== 'undefined' ? curMode : null;
  var o = { menu: _wscMenuLabel(page), part: mode ? _wscModeLabel(mode) : '', item: '', target: { page: page }, icon: '' };
  if (mode) o.target.mode = mode;
  var dv = document.getElementById('docViewModal'), pd = document.getElementById('projDetailPanel');
  if (dv && dv.__file) { o.target.ctx = { k: 'docview', id: dv.__file.id }; o.item = dv.__file.name || '문서'; }
  else if (pd && pd.getAttribute('data-pid')) { o.target.ctx = { k: 'project', id: pd.getAttribute('data-pid') }; o.item = pd.getAttribute('data-pname') || '프로젝트'; }
  else if (page === 'notebook' && typeof NB !== 'undefined' && NB.cur && NB.cur.id) { o.part = '노트북'; o.target.ctx = { k: 'note', id: NB.cur.id }; o.item = NB.cur.title || '제목 없는 노트'; }
  else if (page === 'mindmap' && typeof _mm !== 'undefined' && _mm.view === 'editor' && _mm.mapId) { o.part = '맵'; o.target.ctx = { k: 'map', id: _mm.mapId }; o.item = (_mm.row && _mm.row.title) || '마인드맵'; }
  else if (page === 'messages' && typeof CX !== 'undefined' && CX.room) {
    var rm = (CX.rooms || []).filter(function (x) { return x.id === CX.room; })[0];
    o.part = '대화방'; o.target.ctx = { k: 'room', id: CX.room }; o.item = (rm && rm.name) || '대화방';
  }
  else if (page === 'project' && mode === 'docs' && typeof docSelFile !== 'undefined' && docSelFile) {
    var f = ((typeof _docDataCache !== 'undefined' && _docDataCache.allFiles) || []).filter(function (x) { return x.id === docSelFile; })[0];
    o.target.ctx = { k: 'doc', id: docSelFile, pid: typeof docSelProject !== 'undefined' ? docSelProject : '' }; o.item = f ? f.name : '문서';
  }
  if (o.target.ctx) o.icon = WSC_CTX_IC[o.target.ctx.k] || '';
  else o.icon = ((o.part || o.menu).match(/^\S+/) || [''])[0];
  o.title = o.item || o.part.replace(/^\S+\s/, '') || o.menu.replace(/^\S+\s/, '');
  return o;
}
function _wscCrumb(sc) { return [sc.menu, sc.part, sc.item].filter(Boolean).map(_wscE).join(' <i>›</i> '); }

/* ─── 받기 ─── */
function wscLoad(force) {
  if (WSC.list && !force) return Promise.resolve(WSC.list);
  if (WSC.loading) return WSC.loading;
  WSC.loading = apiFetch('/api/shortcuts').then(function (r) { WSC.list = (r && r.data) || []; WSC.trashN = (r && r.trashCount) || 0; return WSC.list; })
    .finally(function () { WSC.loading = null; });
  return WSC.loading;
}

/* ─── 추가 ─── */
function wscAddHere(over) {
  var o = Object.assign(wscHere(), over || {});
  return wmGuardedModal('wscAdd', function () {
    var md = createModal({ id: 'wscAddModal', title: '🔖 바로가기에 추가', width: '440px', closeOnEsc: true,
      html: '<div class="wsc-add"><div class="wsc-crumb">' + _wscCrumb(o) + '</div>' +
        '<label class="wrq-f"><span>이름</span><input class="wr-inp" id="wscName" maxlength="200" value="' + _wscE(o.title) + '"></label>' +
        '<div class="wsc-hint">내 업무 오른쪽 아래 🔖 바로가기에서 누르면 이 자리로 갑니다</div>' +
        '<div class="wrq-foot"><span style="flex:1"></span><button type="button" class="btn btn-g" data-x>취소</button><button type="button" class="btn btn-p" data-ok>추가</button></div></div>' });
    var box = md.box, inp = box.querySelector('#wscName');
    var go = function () {
      var title = inp.value.trim(); if (!title) { inp.focus(); return; }
      box.querySelector('[data-ok]').disabled = true;
      apiFetch('/api/shortcuts', { method: 'POST', body: JSON.stringify({ title: title, menu: o.menu, part: o.part, item: o.item, icon: o.icon, target: o.target }) }).then(function (r) {
        md.close();
        _wscToast(r && r.existed ? '🔖 이미 있던 바로가기 — 맨 위로 올렸습니다' : '🔖 바로가기에 넣었습니다 — 내 업무 오른쪽 아래에서 열 수 있어요');
        WSC.list = null; wscLoad(true).then(wscRepaint);
      }).catch(function (e) { box.querySelector('[data-ok]').disabled = false; _wscToast('넣지 못했습니다: ' + ((e && e.data && e.data.message) || e.message), 'error'); });
    };
    box.querySelector('[data-ok]').onclick = go;
    box.querySelector('[data-x]').onclick = function () { md.close(); };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    setTimeout(function () { inp.focus(); inp.select(); }, 0);
  }, 'wscAddModal');
}
/** 프로젝트 상세 ⋯ — 지금 보는 탭 그대로, 그 프로젝트 */
function wscAddProject(pid) { var pd = document.getElementById('projDetailPanel'); return wscAddHere(pd && pd.getAttribute('data-pid') === pid ? {} : { target: { page: 'project', mode: typeof curMode !== 'undefined' ? curMode : 'pipeline', ctx: { k: 'project', id: pid } } }); }

/* ─── 이동 ─── */
function _wscWait(cond, fn, ms) {
  var t0 = Date.now();
  (function tick() { var ok = false; try { ok = cond(); } catch (_) {} if (ok) return fn(); if (Date.now() - t0 > (ms || 6000)) return fn(); setTimeout(tick, 120); })();
}
function wscGo(sc) {
  if (!sc || !sc.target) return;
  var t = sc.target, c = t.ctx;
  if (typeof wmHdrPopClose === 'function') wmHdrPopClose();
  _wscPopClose();
  if (typeof setPage === 'function') setPage(t.page);
  if (t.mode && (t.page === 'team' || t.page === 'project') && typeof setMode === 'function') setMode(t.mode);
  if (!c) return;
  if (c.k === 'project') _wscWait(function () { return typeof showProjectDetail === 'function'; }, function () { showProjectDetail(c.id); }, 3000);
  else if (c.k === 'docview') _wscWait(function () { return typeof docViewFile === 'function'; }, function () { docViewFile(c.id); }, 3000);
  else if (c.k === 'note') _wscWait(function () { return typeof nbOpenNote === 'function' && document.getElementById('nbMain'); }, function () { nbOpenNote(c.id); });
  else if (c.k === 'map') _wscWait(function () { return typeof mmOpen === 'function' && document.getElementById('mindmapWrap'); }, function () { mmOpen(c.id); });
  else if (c.k === 'room') _wscWait(function () { return typeof chatOpenRoom === 'function' && typeof CX !== 'undefined' && (CX.rooms || []).length; }, function () { chatOpenRoom(c.id); });
  else if (c.k === 'doc') _wscWait(function () { return typeof docSelectProject === 'function'; }, function () {
    if (c.pid && typeof docSelProject !== 'undefined' && docSelProject !== c.pid) docSelectProject(c.pid);
    _wscWait(function () { return typeof _docDataCache !== 'undefined' && _docDataCache.allFiles && _docDataCache.allFiles.some(function (f) { return f.id === c.id; }); }, function () { if (typeof docClickFile === 'function') docClickFile(c.id); });
  });
}

/* ─── 묶음 목록 (내 업무 칸 · 머리 줄 팝업 같이) ─── */
function _wscGroups(list) {
  var g = [], at = {};
  list.forEach(function (s) { var k = s.menu || '기타'; if (!at[k]) { at[k] = { menu: k, items: [] }; g.push(at[k]); } at[k].items.push(s); });
  return g;
}
function _wscRow(s, mode) {
  var ic = s.icon || '🔖', id = _wscE(s.id);
  var sub = [s.part, s.item && s.item !== s.title ? s.item : ''].filter(Boolean).map(_wscE).join(' › ');
  var acts = mode === 'trash'
    ? '<button type="button" class="wsc-a" data-wsc="restore" data-id="' + id + '" title="되살리기">↺</button><button type="button" class="wsc-a dng" data-wsc="hard" data-id="' + id + '" title="영구 삭제">✕</button>'
    : mode === 'box' ? '<button type="button" class="wsc-a" data-wsc="up" data-id="' + id + '" title="위로">↑</button><button type="button" class="wsc-a" data-wsc="down" data-id="' + id + '" title="아래로">↓</button>' +
      '<button type="button" class="wsc-a" data-wsc="rename" data-id="' + id + '" title="이름 바꾸기">✏️</button><button type="button" class="wsc-a" data-wsc="trash" data-id="' + id + '" title="휴지통으로">🗑</button>' : '';
  return '<div class="wsc-row' + (mode === 'trash' ? ' tr' : '') + '"><button type="button" class="wsc-go" ' + (mode === 'trash' ? 'disabled' : 'data-wsc="go"') + ' data-id="' + id + '" title="' + _wscE([s.menu, s.part, s.item].filter(Boolean).join(' › ')) + '">' +
    '<span class="wsc-ic">' + _wscE(ic) + '</span><span class="wsc-t"><b>' + _wscE(s.title) + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></button>' + (acts ? '<span class="wsc-acts">' + acts + '</span>' : '') + '</div>';
}
function wscBoxHtml() {
  var list = WSC.list;
  var all = !!WSC.folded.__all;   // 목록 통째로 접기 (v13.544)
  var h = '<div class="wsc-box' + (all ? ' is-folded' : '') + '" id="wscBox"><div class="wsc-hd"><button type="button" class="wsc-hf" data-wsc="foldall" title="목록 접기 · 펴기"><span class="wsc-car">' + (all ? '▸' : '▾') + '</span><b>🔖 바로가기</b>' + (list ? '<span class="wsc-n">' + list.length + '</span>' : '') + '</button>' +
    '<span style="flex:1"></span><button type="button" class="wsc-a" data-wsc="add" title="지금 화면을 바로가기로 — 다른 화면에서는 머리 줄 🔖">＋</button></div>';
  if (all) return h + '</div>';
  if (!list) return h + '<div class="wsc-empty">⏳</div></div>';
  if (WSC.showTrash) {
    var tl = WSC.trash || [];
    h += '<div class="wsc-trhd">🗑 휴지통 ' + tl.length + '<span style="flex:1"></span>' + (tl.length ? '<button type="button" class="wsc-a dng" data-wsc="empty">비우기</button>' : '') + '<button type="button" class="wsc-a" data-wsc="trashoff">← 목록</button></div>';
    h += tl.length ? tl.map(function (s) { return _wscRow(s, 'trash'); }).join('') : '<div class="wsc-empty">휴지통이 비었습니다</div>';
    return h + '</div>';
  }
  var groups = _wscGroups(list);
  if (groups.length > 1) h += '<div class="wsc-chips"><button type="button" class="wsc-chip' + (!WSC.filter ? ' on' : '') + '" data-wsc="filter" data-f="">전체</button>' +
    groups.map(function (g) { return '<button type="button" class="wsc-chip' + (WSC.filter === g.menu ? ' on' : '') + '" data-wsc="filter" data-f="' + _wscE(g.menu) + '">' + _wscE(g.menu) + ' ' + g.items.length + '</button>'; }).join('') + '</div>';
  if (!list.length) h += '<div class="wsc-empty">아직 없습니다 — 아무 화면에서나 머리 줄 🔖 를 누르면<br>그 자리(메뉴 › 파트 › 항목)가 여기 들어옵니다</div>';
  groups.filter(function (g) { return !WSC.filter || g.menu === WSC.filter; }).forEach(function (g) {
    var fold = !!WSC.folded[g.menu];
    h += '<div class="wsc-grp' + (fold ? ' fold' : '') + '"><button type="button" class="wsc-gh" data-wsc="fold" data-f="' + _wscE(g.menu) + '"><span class="wsc-car">' + (fold ? '▸' : '▾') + '</span>' + _wscE(g.menu) + ' <span class="wsc-n">' + g.items.length + '</span></button>' +
      (fold ? '' : g.items.map(function (s) { return _wscRow(s, 'box'); }).join('')) + '</div>';
  });
  h += '<div class="wsc-ft"><button type="button" class="wsc-a" data-wsc="trashon">🗑 휴지통' + (WSC.trashN ? ' ' + WSC.trashN : '') + '</button></div>';
  return h + '</div>';
}
function wscRepaint() {
  var b = document.getElementById('wscBox'); if (b) b.outerHTML = wscBoxHtml();
  var pop = document.getElementById('wscPop'); if (pop && !pop.hidden) _wscPopPaint();
}
function _wscFind(id) { return (WSC.list || []).concat(WSC.trash || []).filter(function (s) { return s.id === id; })[0]; }
async function _wscAct(a, id, f) {
  if (a === 'go') return wscGo(_wscFind(id));
  if (a === 'add') return wscAddHere();
  if (a === 'filter') { WSC.filter = f || ''; return wscRepaint(); }
  if (a === 'foldall') f = '__all';
  if (a === 'fold' || a === 'foldall') { WSC.folded[f] = !WSC.folded[f]; try { localStorage.setItem('wm.wsc.fold', JSON.stringify(WSC.folded)); } catch (_) {} return wscRepaint(); }
  if (a === 'trashon') { WSC.showTrash = true; WSC.trash = null; wscRepaint(); var r = await apiFetch('/api/shortcuts?trash=1'); WSC.trash = (r && r.data) || []; return wscRepaint(); }
  if (a === 'trashoff') { WSC.showTrash = false; return wscRepaint(); }
  try {
    if (a === 'rename') {
      var s = _wscFind(id); if (!s) return;
      var v = await wmPrompt('바로가기 이름', s.title); if (v == null || !v.trim() || v.trim() === s.title) return;
      await apiFetch('/api/shortcuts/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ title: v.trim() }) });
      s.title = v.trim();
    } else if (a === 'up' || a === 'down') {
      var L = WSC.list, i = L.findIndex(function (x) { return x.id === id; }), cur = L[i];
      // 같은 메뉴 묶음 안에서 옆 칸과 자리 바꿈
      var step = a === 'up' ? -1 : 1, j = i + step;
      while (j >= 0 && j < L.length && (L[j].menu || '기타') !== (cur.menu || '기타')) j += step;
      if (j < 0 || j >= L.length) return;
      L[i] = L[j]; L[j] = cur;
      wscRepaint();
      await apiFetch('/api/shortcuts/order', { method: 'PUT', body: JSON.stringify({ ids: L.map(function (x) { return x.id; }) }) });
      return;
    } else if (a === 'trash') {
      await apiFetch('/api/shortcuts/' + encodeURIComponent(id), { method: 'DELETE' });
      var gone = _wscFind(id);
      WSC.list = WSC.list.filter(function (x) { return x.id !== id; }); WSC.trashN++;
      _wscToast('🗑 「' + (gone ? gone.title : '') + '」 휴지통으로 — 휴지통에서 되살릴 수 있어요');
    } else if (a === 'restore') {
      await apiFetch('/api/shortcuts/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: '{}' });
      WSC.trash = (WSC.trash || []).filter(function (x) { return x.id !== id; }); WSC.trashN = Math.max(0, WSC.trashN - 1);
      await wscLoad(true);
    } else if (a === 'hard') {
      if (!(await wmConfirm('이 바로가기를 영구 삭제할까요? (되살릴 수 없음)'))) return;
      await apiFetch('/api/shortcuts/' + encodeURIComponent(id) + '?hard=1', { method: 'DELETE' });
      WSC.trash = (WSC.trash || []).filter(function (x) { return x.id !== id; }); WSC.trashN = Math.max(0, WSC.trashN - 1);
    } else if (a === 'empty') {
      if (!(await wmConfirm('휴지통의 바로가기 ' + (WSC.trash || []).length + '개를 영구 삭제할까요?'))) return;
      await apiFetch('/api/shortcuts/trash', { method: 'DELETE' });
      WSC.trash = []; WSC.trashN = 0;
    }
    wscRepaint();
  } catch (e) { _wscToast('처리하지 못했습니다: ' + ((e && e.data && e.data.message) || e.message || e), 'error'); }
}
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-wsc]');
  if (!b || !b.closest('#wscBox,#wscPop')) return;
  e.preventDefault();
  _wscAct(b.getAttribute('data-wsc'), b.getAttribute('data-id'), b.getAttribute('data-f'));
});

/* ─── 머리 줄 🔖 팝업 — 지금 화면 추가 + 빠른 이동 ─── */
function wscPopToggle(btn) {
  var pop = document.getElementById('wscPop');
  if (pop && !pop.hidden) return _wscPopClose();
  if (!pop) {
    pop = document.createElement('div'); pop.id = 'wscPop'; pop.className = 'wsc-pop'; pop.hidden = true;
    document.body.appendChild(pop);
    document.addEventListener('mousedown', function (e) { var p = document.getElementById('wscPop'); if (p && !p.hidden && !p.contains(e.target) && !(e.target.closest && e.target.closest('#hdrScBtn'))) _wscPopClose(); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var p = document.getElementById('wscPop'); if (p && !p.hidden) _wscPopClose(); } });
  }
  var r = (btn || document.getElementById('hdrScBtn')).getBoundingClientRect();
  pop.style.top = Math.round(r.bottom + 6) + 'px';
  pop.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
  pop.hidden = false;
  pop.__openSeq = (pop.__openSeq || 0) + 1;
  _wscPopPaint();
  wscLoad().then(_wscPopPaint).catch(function () {});
}
function _wscPopClose() { var p = document.getElementById('wscPop'); if (p) p.hidden = true; }
function _wscPopPaint() {
  var pop = document.getElementById('wscPop'); if (!pop || pop.hidden) return;
  // 머리(지금 화면 · 추가)는 열 때 한 번 — 목록을 받아 다시 그려도 누르던 단추가 바뀌지 않게
  if (!pop.__built || pop.__built !== pop.__openSeq) {
    pop.__built = pop.__openSeq;
    var o = wscHere();
    pop.innerHTML = '<div class="wsc-here"><div class="wsc-crumb">' + _wscCrumb(o) + '</div><button type="button" class="btn btn-p btn-s" id="wscAddBtn">＋ 지금 화면을 바로가기로</button></div>' +
      '<div class="wsc-poplist"></div><div class="wsc-ft"><button type="button" class="wsc-a" id="wscManage">🎯 내 업무에서 관리 (이름 · 순서 · 휴지통)</button></div>';
    pop.querySelector('#wscAddBtn').onclick = function () { _wscPopClose(); wscAddHere(); };
    pop.querySelector('#wscManage').onclick = function () {
      _wscPopClose();
      if (typeof setPage === 'function') setPage('mywork');
      _wscWait(function () { return document.getElementById('wscBox'); }, function () { var b = document.getElementById('wscBox'); if (b) { b.scrollIntoView({ block: 'nearest' }); b.classList.add('flash'); setTimeout(function () { b.classList.remove('flash'); }, 1500); } }, 4000);
    };
  }
  var list = WSC.list, box = pop.querySelector('.wsc-poplist');
  box.innerHTML = !list ? '<div class="wsc-empty">⏳</div>' : !list.length ? '<div class="wsc-empty">아직 바로가기가 없습니다</div>' :
    _wscGroups(list).map(function (g) { return '<div class="wsc-pg">' + _wscE(g.menu) + '</div>' + g.items.map(function (s) { return _wscRow(s, 'pop'); }).join(''); }).join('');
}
/* Alt+B — 지금 화면을 바로가기로 (Ctrl+Shift+D 는 브라우저가 먼저 씀) */
document.addEventListener('keydown', function (e) {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === 'KeyB') && typeof currentUser !== 'undefined' && currentUser) { e.preventDefault(); wscAddHere(); }
});
