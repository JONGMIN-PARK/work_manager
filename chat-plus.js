/* 💬 메신저 더하기 (v13.366) — ⌨ 빠른 방 이동(Ctrl+K · Alt+↑↓) · 🔍 이 방에서 찾기(Ctrl+F · 사람 · 파일만)
 *   chat-ui.js 의 CX · chatOpenRoom · _cxJump 를 씀. 메신저 화면이 보일 때만 단축키가 먹음.
 */
function _cpE(s) { return typeof _cxE === 'function' ? _cxE(s) : String(s == null ? '' : s); }
function _cpOn() { var p = document.getElementById('mMessages'); return !!(p && !p.classList.contains('hidden') && document.querySelector('#mMessages .cx')); }

/* ⌨ 빠른 방 이동 — 이름 · 사람 이름 일부로 찾고 Enter */
function chatQuickSwitch() {
  if (typeof wmGuardedModal !== 'function' || typeof createModal !== 'function') return;
  return wmGuardedModal('chatQuick', function () {
    var m = createModal({ id: 'chatQuickModal', title: '⌨ 대화방 이동', width: '480px', closeOnEsc: true, closeOnOverlay: true,
      html: '<input class="wr-inp cx-mq" data-q placeholder="방 이름 · 사람 이름 — ↑↓ 고르고 Enter" aria-label="대화방 찾기" autocomplete="off"><div class="cp-qs" data-list role="listbox"></div><div class="cp-qs-f">Alt+↑ · Alt+↓ 로 위 · 아래 방 · 안 읽은 방이 먼저</div>' });
    var q = m.box.querySelector('[data-q]'), list = m.box.querySelector('[data-list]'), sel = 0, items = [];
    function draw() {
      var v = q.value.trim().toLowerCase();
      var rooms = CX.rooms.filter(function (r) { return r.id !== CX.room || v; });
      if (v) rooms = rooms.filter(function (r) { return (r.name || '').toLowerCase().indexOf(v) >= 0; });
      else rooms = rooms.slice().sort(function (a, b) { return ((b.unread || 0) > 0) - ((a.unread || 0) > 0); });
      items = rooms.slice(0, 12).map(function (r) { return { room: r }; });
      // 아직 1:1 방이 없는 사람
      if (v && CX.users) CX.users.filter(function (u) { return !u.me && u.name.toLowerCase().indexOf(v) >= 0 && !CX.rooms.some(function (r) { return r.kind === 'dm' && r.peerId === u.id; }); }).slice(0, 5).forEach(function (u) { items.push({ user: u }); });
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.innerHTML = items.map(function (it, i) {
        if (it.user) return '<button type="button" class="cx-pp' + (i === sel ? ' on' : '') + '" data-i="' + i + '" role="option">' + _cxAv(it.user.id, it.user.name, it.user.online) + '<span><b>' + _cpE(it.user.name) + '</b><i>새 1:1 대화 · ' + _cpE(it.user.dept || '') + '</i></span></button>';
        var r = it.room, ic = r.kind === 'project' ? '<span class="cx-av cx-av-p">📁</span>' : r.kind === 'group' ? '<span class="cx-av cx-av-g">👥</span>' : _cxAv(r.peerId, r.name, r.online);
        return '<button type="button" class="cx-pp' + (i === sel ? ' on' : '') + '" data-i="' + i + '" role="option">' + ic + '<span><b>' + _cpE(r.name) + '</b><i>' + _cpE(r.last ? r.last.body || '' : '') + '</i></span>' + (r.unread ? '<em class="cp-n">' + (r.unread > 99 ? '99+' : r.unread) + '</em>' : '') + '</button>';
      }).join('') || '<div class="cx-empty">없음</div>';
    }
    function go(i) {
      var it = items[i]; if (!it) return;
      m.close();
      if (it.room) chatOpenRoom(it.room.id); else chatStartDm(it.user.id);
    }
    q.addEventListener('input', function () { sel = 0; draw(); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(); var on = list.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(sel); }
    });
    list.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) go(+b.dataset.i); });
    draw();
    if (typeof _cxUsers === 'function') _cxUsers().then(draw).catch(function () {});
    setTimeout(function () { q.focus(); }, 30);
  }, 'chatQuickModal');
}
/* Alt+↑ · Alt+↓ — 목록에서 위 · 아래 방 */
function _cpStep(d) {
  var btns = Array.prototype.slice.call(document.querySelectorAll('#cxRooms .cx-r[data-room]'));
  if (!btns.length) return;
  var i = btns.findIndex(function (b) { return b.dataset.room === CX.room; });
  var n = btns[Math.max(0, Math.min(btns.length - 1, (i < 0 ? 0 : i + d)))];
  if (n && n.dataset.room !== CX.room) { chatOpenRoom(n.dataset.room); n.scrollIntoView({ block: 'nearest' }); }
}

/* 🔍 이 방에서 찾기 — 머리 아래 띠 */
var CPF = { t: null, seq: 0 };
function chatFindOpen() {
  if (!CX.room) return;
  var ex = document.getElementById('cxFind'); if (ex) { ex.querySelector('input').focus(); ex.querySelector('input').select(); return; }
  var head = document.getElementById('cxHead'); if (!head) return;
  var bar = document.createElement('div'); bar.id = 'cxFind'; bar.className = 'cp-find';
  var ms = (CX.info && CX.info.members) || [];
  bar.innerHTML = '<span class="cp-fi">🔍</span><input type="search" data-q placeholder="이 방에서 찾기 — 2글자 이상" aria-label="이 방에서 찾기" autocomplete="off">' +
    (CX.info && CX.info.kind !== 'dm' ? '<select data-from aria-label="보낸 사람"><option value="">모든 사람</option>' + ms.map(function (u) { return '<option value="' + _cpE(u.id) + '">' + _cpE(u.name) + (u.me ? ' (나)' : '') + '</option>'; }).join('') + '</select>' : '') +
    '<label class="cp-ff"><input type="checkbox" data-file> 📎 파일만</label><span class="cp-fn" data-n></span><button type="button" class="cx-ib" data-x title="닫기 (Esc)">✕</button>' +
    '<div class="cp-fr" data-res hidden></div>';
  head.parentNode.insertBefore(bar, head.nextSibling);
  var q = bar.querySelector('[data-q]'), res = bar.querySelector('[data-res]'), nEl = bar.querySelector('[data-n]'), room = CX.room, found = [], sel = -1;
  function close() { bar.remove(); }
  function run() {
    var v = q.value.trim(), from = bar.querySelector('[data-from]'), file = bar.querySelector('[data-file]').checked;
    if (v.length < 2) { res.hidden = true; nEl.textContent = ''; return; }
    var my = ++CPF.seq;
    nEl.textContent = '찾는 중…';
    apiFetch('/api/chat/search?q=' + encodeURIComponent(v) + '&room=' + encodeURIComponent(room) + (from && from.value ? '&from=' + encodeURIComponent(from.value) : '') + (file ? '&has=file' : '')).then(function (r) {
      if (my !== CPF.seq || CX.room !== room) return;
      found = (r && r.data) || []; sel = -1;
      nEl.textContent = found.length ? found.length + (found.length >= 60 ? '+' : '') + '건' : '없음';
      var re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
      res.innerHTML = found.map(function (m, i) {
        var txt = (m.body || (m.file ? '📎 ' + m.file.name : '')).replace(/\s+/g, ' ');
        var at = txt.toLowerCase().indexOf(v.toLowerCase()), from0 = Math.max(0, at - 30);
        var cut = (from0 ? '…' : '') + txt.slice(from0, from0 + 140);
        return '<button type="button" data-i="' + i + '"><b>' + _cpE(m.userName || '') + '</b><span>' + _cpE(cut).replace(re, function (x) { return '<mark>' + x + '</mark>'; }) + '</span><i>' + (typeof _cxRel === 'function' ? _cxRel(m.at) : '') + '</i></button>';
      }).join('');
      res.hidden = !found.length;
    }).catch(function () { if (my === CPF.seq) nEl.textContent = '찾지 못했습니다'; });
  }
  function go(i) { var m = found[i]; if (!m) return; sel = i; res.querySelectorAll('[data-i]').forEach(function (b) { b.classList.toggle('on', +b.dataset.i === i); }); _cxJump(m.id); }
  q.addEventListener('input', function () { clearTimeout(CPF.t); CPF.t = setTimeout(run, 250); });
  bar.addEventListener('change', function (e) { if (e.target.matches('[data-from],[data-file]')) run(); });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); var ta = document.getElementById('cxIn'); if (ta) ta.focus(); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (found.length) go((sel + (e.shiftKey ? -1 : 1) + found.length) % found.length); else run(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && found.length) { e.preventDefault(); go((sel + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length); }
  });
  res.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) go(+b.dataset.i); });
  bar.querySelector('[data-x]').addEventListener('click', close);
  q.focus();
}

/* 단축키 — 메신저가 보일 때만 (Ctrl+K 는 전체 찾기보다 먼저) */
document.addEventListener('keydown', function (e) {
  if (!_cpOn() || e.isComposing) return;
  var mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); e.stopImmediatePropagation(); chatQuickSwitch(); return; }
  if (mod && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F') && CX.room && !document.querySelector('.wa-modal-overlay, #cbBoard, #cdDoc')) { e.preventDefault(); chatFindOpen(); return; }
  if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); _cpStep(e.key === 'ArrowUp' ? -1 : 1); }
}, true);
