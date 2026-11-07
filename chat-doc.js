/**
 * chat-doc.js — 📝 방 공동 문서 (v13.360)
 *   방 사람 모두가 같이 고치는 마크다운 문서 — 왼쪽 쓰기 · 오른쪽 미리보기(노트북 NbMd) · 체크리스트는 미리보기에서 눌러 체크
 *   같이 고치기: 쓰는 대로 0.6초 뒤 저장(rev) → 다른 사람 화면에 바로 · 같은 때 고쳤으면 줄 단위 세 갈래 합치기(diff3)로 둘 다 살림
 *   누가 몇째 줄을 고치는 중인지 · 고치기 전 모습 기록(되돌리기) · 읽기만 멤버는 보기만
 *   chat-ui.js 가 부르는 것: chatDocOpen · chatDocsTab · chatDocOnEvent  ·  시험용: chatDocMerge
 */
var CD = null;   // 열린 문서 하나
function _cdE(s) { return typeof _cxE === 'function' ? _cxE(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _cdToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _cdErr(e) { return (e && e.data && e.data.message) || (e && e.message) || '실패했습니다'; }

/* ─── 줄 단위 세 갈래 합치기 ─── base(둘 다 알던 글) · mine(내 화면) · theirs(서버에 새로 온 글)
 *   한쪽만 바꾼 곳은 그쪽 · 다른 곳을 각각 바꿨으면 둘 다 · 같은 곳을 다르게 바꿨으면 서버 글 다음에 내 글을 붙여 둘 다 남김 */
function _cdMatch(a, b) {   // 같은 줄 짝 [ [i, j], ... ] (LCS) — 앞뒤 같은 줄은 먼저 덜어 내 빠르게
  var pre = 0, n = a.length, m = b.length;
  while (pre < n && pre < m && a[pre] === b[pre]) pre++;
  var suf = 0;
  while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
  var A = a.slice(pre, n - suf), B = b.slice(pre, m - suf), out = [], i, j;
  for (i = 0; i < pre; i++) out.push([i, i]);
  if (A.length && B.length) {
    if (A.length * B.length > 4000000) {   // 너무 크면 같은 줄을 앞에서부터 대충 짝짓기
      var at = 0;
      for (i = 0; i < A.length; i++) for (j = at; j < B.length; j++) if (A[i] === B[j]) { out.push([pre + i, pre + j]); at = j + 1; break; }
    } else {
      var W = B.length + 1, L = new Uint32Array((A.length + 1) * W);
      for (i = A.length - 1; i >= 0; i--) for (j = B.length - 1; j >= 0; j--) L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
      i = 0; j = 0;
      while (i < A.length && j < B.length) { if (A[i] === B[j]) { out.push([pre + i, pre + j]); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++; else j++; }
    }
  }
  for (i = 0; i < suf; i++) out.push([n - suf + i, m - suf + i]);
  return out;
}
function _cdHunks(base, other) {   // base[bs, be) 를 lines 로 바꾸기 목록
  var pairs = _cdMatch(base, other), h = [], bi = 0, oi = 0;
  pairs.concat([[base.length, other.length]]).forEach(function (p) {
    if (p[0] > bi || p[1] > oi) h.push({ bs: bi, be: p[0], lines: other.slice(oi, p[1]) });
    bi = p[0] + 1; oi = p[1] + 1;
  });
  return h;
}
function chatDocMerge(base, mine, theirs) {
  base = base || ''; mine = mine == null ? '' : mine; theirs = theirs == null ? '' : theirs;
  if (mine === theirs || mine === base) return theirs;
  if (theirs === base) return mine;
  var B = base.split('\n'), hm = _cdHunks(B, mine.split('\n')).map(function (x) { x.s = 'm'; return x; }), ht = _cdHunks(B, theirs.split('\n')).map(function (x) { x.s = 't'; return x; });
  var all = hm.concat(ht).sort(function (x, y) { return x.bs - y.bs || x.be - y.be; });
  var out = [], pos = 0, k = 0;
  while (k < all.length) {
    var g = [all[k]], lo = all[k].bs, hi = all[k].be; k++;
    while (k < all.length && (all[k].bs < hi || (all[k].bs === hi && (all[k].bs === all[k].be || hi === lo)) || all[k].bs === lo)) { g.push(all[k]); hi = Math.max(hi, all[k].be); k++; }
    for (; pos < lo; pos++) out.push(B[pos]);
    var side = function (s) {   // 이 묶음 범위를 한쪽 변경만으로 다시 만듦
      var r = [], p = lo;
      g.filter(function (x) { return x.s === s; }).forEach(function (x) { for (; p < x.bs; p++) r.push(B[p]); r = r.concat(x.lines); p = x.be; });
      for (; p < hi; p++) r.push(B[p]);
      return r;
    };
    var hasM = g.some(function (x) { return x.s === 'm'; }), hasT = g.some(function (x) { return x.s === 't'; });
    var t = side('t'), m = side('m');
    if (hasM && hasT) {
      if (t.join('\n') === m.join('\n')) out = out.concat(t);
      else { var have = {}; t.forEach(function (l) { have[l] = 1; }); out = out.concat(t, m.filter(function (l) { return !have[l]; })); }
    } else out = out.concat(hasM ? m : t);
    pos = hi;
  }
  for (; pos < B.length; pos++) out.push(B[pos]);
  return out.join('\n');
}

/* ─── 열기 ─── */
function chatDocOpen(id) {
  if (typeof wmGuardedModal === 'function') return wmGuardedModal('chatDoc', function () { return _cdOpen(id); }, 'cdDoc');
  return _cdOpen(id);
}
function _cdOpen(id) {
  if (CD) chatDocClose();
  return apiFetch('/api/chat/docs/' + encodeURIComponent(id)).then(function (r) {
    var d = r.data;
    var ov = document.createElement('div'); ov.id = 'cdDoc'; ov.className = 'cd'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', '공동 문서');
    ov.innerHTML =
      '<div class="cd-top"><span class="cd-ic">📝</span><input class="cd-title" data-title maxlength="200" placeholder="제목"' + (d.readOnly ? ' readonly' : '') + '>' +
      '<span class="cd-st" data-st></span><span class="cd-peers" data-peers></span>' +
      '<div class="cd-seg"><button type="button" data-v="edit" title="쓰기만">✏️</button><button type="button" data-v="split" title="쓰기 + 미리보기">◫</button><button type="button" data-v="view" title="미리보기만">👁</button></div>' +
      '<button type="button" class="cx-ib" data-hist title="고친 기록 · 되돌리기">🕘</button><button type="button" class="cx-ib" data-copy title="글 복사">📋</button><button type="button" class="cx-ib" data-x title="닫기 (Esc)">✕</button></div>' +
      '<div class="cd-body"><textarea class="cd-src" data-src spellcheck="false" placeholder="# 제목\n- [ ] 할 일\n| 항목 | 값 |\n|---|---|\n\n``` 로 감싸면 코드 · 로그"' + (d.readOnly ? ' readonly' : '') + '></textarea><div class="cd-prev"><article class="nb-doc" data-prev></article></div></div>' +
      '<div class="cd-foot" data-foot></div>';
    document.body.appendChild(ov);
    CD = { id: d.id, roomId: d.roomId, el: ov, ta: ov.querySelector('[data-src]'), ti: ov.querySelector('[data-title]'), base: d.body, baseTitle: d.title, rev: d.rev, ro: !!d.readOnly,
      clientId: 'c' + Math.random().toString(36).slice(2, 10), peers: {}, view: localStorage.getItem('cd-view') || (innerWidth < 900 ? 'edit' : 'split'), by: d.updatedByName, at: d.updatedAt };
    CD.ta.value = d.body; CD.ti.value = d.title;
    _cdBind(); _cdView(CD.view); _cdPrev(); _cdState('saved'); _cdFoot();
    if (CD.ro) _cdState('ro');
    setTimeout(function () { if (CD && !CD.ro) CD.ta.focus(); }, 30);
    return true;
  }).catch(function (e) { _cdToast(_cdErr(e), 'error'); return false; });
}
function chatDocClose() {
  if (!CD) return;
  if (CD.dirty && !CD.ro) _cdSave(true);
  apiFetch('/api/chat/docs/' + encodeURIComponent(CD.id) + '/cursor', { method: 'POST', body: JSON.stringify({ bye: true }) }).catch(function () {});
  CD.el.remove(); document.removeEventListener('keydown', _cdKey, true);
  CD = null;
}
function _cdKey(e) {
  if (!CD) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chatDocClose(); }
  else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); _cdSave(true); }
}
function _cdBind() {
  var el = CD.el;
  document.addEventListener('keydown', _cdKey, true);
  el.querySelector('[data-x]').onclick = chatDocClose;
  el.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { _cdView(b.dataset.v); }; });
  el.querySelector('[data-copy]').onclick = function () { try { navigator.clipboard.writeText(CD.ta.value).then(function () { _cdToast('📋 복사했습니다', 'success'); }); } catch (_) {} };
  el.querySelector('[data-hist]').onclick = _cdHistory;
  var pt = 0;
  CD.ta.addEventListener('input', function () { CD.dirty = true; _cdState('dirty'); _cdLater(); clearTimeout(pt); pt = setTimeout(_cdPrev, 150); _cdCursor(); });
  CD.ti.addEventListener('input', function () { CD.dirty = true; _cdState('dirty'); _cdLater(); });
  ['keyup', 'click'].forEach(function (ev) { CD.ta.addEventListener(ev, _cdCursor); });
  CD.ta.addEventListener('keydown', function (e) {   // Tab 은 들여쓰기
    if (e.key === 'Tab' && !CD.ro) { e.preventDefault(); var s = CD.ta.selectionStart; CD.ta.setRangeText('  ', s, CD.ta.selectionEnd, 'end'); CD.ta.dispatchEvent(new Event('input')); }
  });
  // 미리보기 체크리스트 눌러 체크 · 미리보기 누르면 그 줄로
  el.querySelector('[data-prev]').addEventListener('click', function (e) {
    var blk = e.target.closest('[data-line]'); if (!blk) return;
    var line = +blk.getAttribute('data-line');
    if (e.target.matches('input[type=checkbox]') && !CD.ro && typeof NbMd !== 'undefined' && NbMd.toggleTask) {
      e.preventDefault();
      CD.ta.value = NbMd.toggleTask(CD.ta.value, line); CD.ta.dispatchEvent(new Event('input')); return;
    }
    if (CD.view === 'split' && !CD.ro) { var p = CD.ta.value.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0); CD.ta.focus(); CD.ta.setSelectionRange(p, p); }
  });
}
function _cdView(v) {
  CD.view = v; try { localStorage.setItem('cd-view', v); } catch (_) {}
  CD.el.dataset.view = v;
  CD.el.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
  _cdPrev();
}
function _cdPrev() {
  if (!CD || CD.view === 'edit') return;
  var p = CD.el.querySelector('[data-prev]');
  var html = typeof NbMd !== 'undefined' ? NbMd.render(CD.ta.value).html : '<pre>' + _cdE(CD.ta.value) + '</pre>';
  p.innerHTML = (CD.ti.value ? '<h1>' + _cdE(CD.ti.value) + '</h1>' : '') + (html || '<p class="cd-ph">비어 있는 문서 — 왼쪽에 쓰면 여기 보입니다</p>');
}
function _cdState(s) {
  if (!CD) return;
  var el = CD.el.querySelector('[data-st]');
  el.className = 'cd-st ' + s;
  el.textContent = s === 'saving' ? '저장 중…' : s === 'dirty' ? '고치는 중' : s === 'merged' ? '🔀 함께 고친 것 합침' : s === 'error' ? '⚠️ 저장 못 함 — 다시 시도 중' : s === 'ro' ? '👁 읽기만' : '✓ 저장됨';
}
function _cdFoot() {
  if (!CD) return;
  var f = CD.el.querySelector('[data-foot]');
  f.textContent = CD.ta.value.length.toLocaleString() + '자 · ' + CD.ta.value.split('\n').length + '줄' + (CD.by ? ' · 마지막 ' + CD.by + (CD.at && typeof _cxRel === 'function' ? ' ' + _cxRel(CD.at) : '') : '') + ' · Ctrl+S 바로 저장 · 같이 고친 글은 줄 단위로 합쳐집니다';
}

/* ─── 저장 · 합치기 ─── */
function _cdLater() { clearTimeout(CD.t); CD.t = setTimeout(function () { _cdSave(); }, 600); }
function _cdSave(now) {
  if (!CD || CD.ro) return;
  var my = CD;
  if (my.busy) { my.again = true; return; }
  var body = my.ta.value, title = my.ti.value;
  if (body === my.base && title === my.baseTitle) { my.dirty = false; _cdState('saved'); return; }
  my.busy = true; _cdState('saving');
  apiFetch('/api/chat/docs/' + encodeURIComponent(my.id), { method: 'PUT', body: JSON.stringify({ title: title, body: body, baseRev: my.rev, clientId: my.clientId }) }).then(function (r) {
    my.busy = false;
    my.base = r.data.body; my.baseTitle = r.data.title; my.rev = r.data.rev; my.by = r.data.updatedByName; my.at = r.data.updatedAt;
    if (CD !== my) return;
    if (my.ta.value !== body || my.ti.value !== title || my.again) { my.again = false; _cdSave(); return; }
    my.dirty = false; _cdState('saved'); _cdFoot();
  }).catch(function (e) {
    my.busy = false;
    if (e && e.status === 409 && e.data && e.data.data) { _cdApplyRemote(e.data.data, true); return; }   // 다른 사람이 먼저 → 합쳐서 다시
    if (CD === my) { _cdState('error'); clearTimeout(my.t); my.t = setTimeout(function () { _cdSave(); }, 4000); }
  });
}
/** 서버 글(remote)이 새로 옴 — 내 화면에 고치는 중인 것이 있으면 합침 · 커서 자리 지킴 */
function _cdApplyRemote(d, fromConflict) {
  if (!CD || d.id !== CD.id) return;
  if (!fromConflict && d.rev <= CD.rev) return;
  var ta = CD.ta, local = ta.value, merged = local === CD.base ? d.body : chatDocMerge(CD.base, local, d.body);
  if (merged !== local) _cdSetKeep(merged);
  if (document.activeElement !== CD.ti) { var tl = CD.ti.value; CD.ti.value = tl === CD.baseTitle ? d.title : tl; }
  CD.base = d.body; CD.baseTitle = d.title; CD.rev = d.rev; CD.by = d.updatedByName; CD.at = d.updatedAt;
  _cdPrev(); _cdFoot();
  if (ta.value !== d.body || CD.ti.value !== d.title) { _cdState('merged'); _cdLater(); } else { CD.dirty = false; _cdState('saved'); }
}
function _cdSetKeep(text) {   // 바뀐 글을 넣되 커서는 '같은 줄 내용'을 찾아 그 자리로
  var ta = CD.ta, old = ta.value, pos = ta.selectionStart, focused = document.activeElement === ta;
  var before = old.slice(0, pos).split('\n'), li = before.length - 1, col = before[li].length, lineText = old.split('\n')[li];
  var lines = text.split('\n'), best = -1, bd = 1e9;
  lines.forEach(function (l, i) { if (l === lineText && Math.abs(i - li) < bd) { bd = Math.abs(i - li); best = i; } });
  var st = ta.scrollTop;
  ta.value = text;
  var np = best >= 0 ? lines.slice(0, best).join('\n').length + (best ? 1 : 0) + Math.min(col, lines[best].length) : Math.min(pos, text.length);
  if (focused) ta.setSelectionRange(np, np);
  ta.scrollTop = st;
}

/* ─── 누가 어디를 ─── */
function _cdCursor() {
  if (!CD || CD.ro) return;
  var line = CD.ta.value.slice(0, CD.ta.selectionStart).split('\n').length - 1;
  if (line === CD.lastLine && Date.now() - (CD.lastCurAt || 0) < 15000) return;
  if (Date.now() - (CD.lastCurAt || 0) < 1200) { clearTimeout(CD.ct); CD.ct = setTimeout(_cdCursor, 1300); return; }
  CD.lastLine = line; CD.lastCurAt = Date.now();
  apiFetch('/api/chat/docs/' + encodeURIComponent(CD.id) + '/cursor', { method: 'POST', body: JSON.stringify({ line: line }) }).catch(function () {});
}
function _cdPeers() {
  var b = CD && CD.el.querySelector('[data-peers]'); if (!b) return;
  var ks = Object.keys(CD.peers);
  b.innerHTML = ks.map(function (k) { var p = CD.peers[k]; return '<span class="cd-peer" style="--h:' + (typeof _cxHue === 'function' ? _cxHue(k) : 200) + '" title="' + _cdE(p.name) + ' — ' + (p.line + 1) + '째 줄을 고치는 중">' + _cdE(String(p.name || '?').slice(0, 1)) + '<i>' + (p.line + 1) + '</i></span>'; }).join('');
}

/** 실시간 신호 (chat-ui.js 가 넘김) — 'doc' · 'doc-cur' */
function chatDocOnEvent(ev, d) {
  if (ev === 'doc') {
    if (CD && d.id === CD.id) {
      if (d.gone) { _cdToast('문서가 지워졌습니다', 'warn'); CD.dirty = false; chatDocClose(); return; }
      if (d.clientId !== CD.clientId) _cdApplyRemote(d);
      if (d.updatedBy && CD.peers[d.updatedBy]) { CD.peers[d.updatedBy].t = Date.now(); }
    }
    if (typeof CX !== 'undefined' && CX.room === d.roomId && CX.asideTab === 'docs') chatDocsTab();
  } else if (ev === 'doc-cur') {
    if (!CD || d.id !== CD.id) return;
    if (d.bye) delete CD.peers[d.by];
    else { var p = CD.peers[d.by] = { name: d.byName, line: d.line, t: Date.now() }; clearTimeout(p.tm); }
    _cdPeers();
  }
}
setInterval(function () { if (!CD) return; var n = Date.now(), ch = false; Object.keys(CD.peers).forEach(function (k) { if (n - CD.peers[k].t > 60000) { delete CD.peers[k]; ch = true; } }); if (ch) _cdPeers(); }, 15000);

/* ─── 🕘 기록 · 되돌리기 ─── */
function _cdHistory() {
  if (!CD) return;
  var my = CD;
  apiFetch('/api/chat/docs/' + encodeURIComponent(my.id) + '/versions').then(function (r) {
    var vs = r.data || [];
    if (!vs.length) { _cdToast('아직 기록이 없습니다 — 고치면 10분마다 · 다른 사람이 고칠 때 남습니다', 'info'); return; }
    var items = vs.slice(0, 30).map(function (v) {
      return [new Date(v.at).toLocaleString() + ' · ' + (v.byName || '') + ' · ' + v.chars + '자', function () {
        apiFetch('/api/chat/docs/' + encodeURIComponent(my.id) + '/versions/' + v.id).then(function (x) {
          if (CD !== my || my.ro) return;
          if (!confirm('이 때 글로 되돌릴까요? (지금 글도 기록에 남습니다)')) return;
          my.ta.value = x.data.body; if (x.data.title) my.ti.value = x.data.title;
          my.ta.dispatchEvent(new Event('input')); _cdSave(true);
        });
      }];
    });
    if (typeof _cxMenu === 'function') _cxMenu(my.el.querySelector('[data-hist]'), items);
  }).catch(function (e) { _cdToast(_cdErr(e), 'error'); });
}

/* ─── 옆 칸 '📝 문서' 탭 ─── */
function chatDocsTab(box) {
  box = box || document.getElementById('cxAsB'); if (!box || typeof CX === 'undefined' || !CX.room) return;
  var room = CX.room, ro = CX.info && CX.info.myRole === 'readonly';
  if (!box.querySelector('.cd-list')) box.innerHTML = '<div class="cd-list"><div class="cd-lh"><b>📝 공동 문서</b><i>방 사람 모두가 같이 고침</i>' + (ro ? '' : '<button type="button" class="btn btn-p btn-s" data-dnew>＋ 새 문서</button>') + '</div><div data-dl><div class="cx-loading">불러오는 중…</div></div></div>';
  var nb = box.querySelector('[data-dnew]');
  if (nb) nb.onclick = function () {
    var t = prompt('새 문서 제목', '회의 · 점검 · 사양 메모'); if (t == null) return;
    apiFetch('/api/chat/rooms/' + encodeURIComponent(room) + '/docs', { method: 'POST', body: JSON.stringify({ title: t }) }).then(function (r) { chatDocsTab(box); chatDocOpen(r.data.id); }).catch(function (e) { _cdToast(_cdErr(e), 'error'); });
  };
  apiFetch('/api/chat/rooms/' + encodeURIComponent(room) + '/docs').then(function (r) {
    if (CX.room !== room) return;
    var l = box.querySelector('[data-dl]'); if (!l) return;
    var ds = r.data || [];
    l.innerHTML = ds.length ? ds.map(function (d) { return '<button type="button" class="cd-it" data-did="' + _cdE(d.id) + '"><b>📝 ' + _cdE(d.title) + '</b><span>' + _cdE(d.preview || '(비어 있음)') + '</span><i>' + _cdE(d.updatedByName || '') + ' · ' + (typeof _cxRel === 'function' ? _cxRel(d.updatedAt) : '') + ' · ' + d.chars.toLocaleString() + '자</i></button>'; }).join('') :
      '<div class="cx-empty">아직 문서가 없습니다<br><small>시운전 체크리스트 · 회의록 · 사양 메모를 같이 써 보세요</small></div>';
    l.querySelectorAll('[data-did]').forEach(function (b) { b.onclick = function () { chatDocOpen(b.dataset.did); }; });
  }).catch(function () {});
}

if (typeof window !== 'undefined') { window.chatDocOpen = chatDocOpen; window.chatDocClose = chatDocClose; window.chatDocsTab = chatDocsTab; window.chatDocOnEvent = chatDocOnEvent; window.chatDocMerge = chatDocMerge; }
