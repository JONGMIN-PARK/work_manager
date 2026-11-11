/* chat-win.js — 💬 대화창 여러 개 (v13.447)
 *   ① 대화 전용 화면  주소에 ?solo=방ID 가 붙으면 방 하나만 보여 주는 가벼운 화면 (업무 데이터는 안 받음 · 머리 · 메뉴 · 방 목록 숨김)
 *   ② 떼어 내기       wmChatPop(방) — 그 방을 작은 새 창으로. 창마다 자리 · 크기 기억. 이미 떠 있으면 그 창을 앞으로
 *   ③ 나란히 보기     wmChatSplitAdd(방) — 본 창 메신저 옆에 칸으로 붙임 (?solo=방&embed=1 을 끼워 넣음 · 2칸까지)
 *
 *   창끼리 이야기(BroadcastChannel 'wm-chatwin'): 떼어 낸 창 · 옆 칸이 2초마다 "여기 있음(보는 중인지)" 을 알림 →
 *     본 창은 그 방 알림 소리를 내지 않고, 알림을 누르면 그 창을 앞으로.
 *   알림 · 소리 · 통화 · 공지 창은 본 창만 — 떼어 낸 창은 자기 방만 조용히 갱신 (chat-ui.js 의 WM_SOLO 분기).
 *   로그인: 떼어 낸 창은 본 창의 로그인을 그대로 씀 (auth.js _wmAuthPeer — 갱신 토큰은 한 번 쓰면 바뀌어 창마다 따로 갱신하면 서로 로그아웃시킴)
 *
 *   머리(head)에서 바로 읽힘 — 가장 먼저 WM_SOLO 와 html 클래스를 정해야 다른 코드가 그것을 봄.
 */
(function () {
  var q = null; try { q = new URLSearchParams(location.search); } catch (e) {}
  var room = q && q.get('solo');
  if (room) {
    window.WM_SOLO = { room: room, embed: q.get('embed') === '1' };
    document.documentElement.classList.add('wm-solo');
    if (window.WM_SOLO.embed) document.documentElement.classList.add('wm-embed');
  }
})();

var WM_CW = { here: {}, bc: null, wins: {}, MAX_WIN: 5, MAX_PANE: 2, MIN_SPLIT_W: 1100 };
function _cwToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _cwLs(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
function _cwJson(k, d) { try { var v = JSON.parse(_cwLs(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
/** 본 창 (떼어 낸 창이면 연 창, 옆 칸이면 바깥 창) — 없거나 닫혔으면 null */
function wmSoloMain() {
  try { var s = window.WM_SOLO; if (!s) return null; var m = s.embed ? window.parent : window.opener; return m && m !== window && !m.closed ? m : null; } catch (e) { return null; }
}

/* ─── 창끼리 이야기 ─── */
function _cwChan() {
  if (WM_CW.bc || typeof BroadcastChannel !== 'function') return WM_CW.bc;
  try {
    WM_CW.bc = new BroadcastChannel('wm-chatwin');
    WM_CW.bc.onmessage = function (e) {
      var d = e.data || {};
      if (window.WM_SOLO) {
        if (d.t === 'ask') _cwHere();
        else if (d.t === 'focus' && d.room === window.WM_SOLO.room && !window.WM_SOLO.embed) { try { window.focus(); } catch (er) {} }
        else if (d.t === 'close' && d.room === window.WM_SOLO.room && !window.WM_SOLO.embed) { try { window.close(); } catch (er) {} }
      } else {
        if (d.t === 'here' && d.room) WM_CW.here[d.room + (d.embed ? '|e' : '')] = { at: Date.now(), look: !!d.look, embed: !!d.embed };
        else if (d.t === 'bye' && d.room) delete WM_CW.here[d.room + (d.embed ? '|e' : '')];
      }
    };
  } catch (e) { WM_CW.bc = null; }
  return WM_CW.bc;
}
function _cwPost(o) { var c = _cwChan(); if (c) try { c.postMessage(o); } catch (e) {} }
/** (떼어 낸 창 · 옆 칸) 지금 사람이 이 방을 보고 있는가 */
function _cwLooking() {
  if (document.hidden) return false;
  var s = window.WM_SOLO;
  if (s && s.embed) {
    try { var f = window.frameElement; if (!f || f.offsetParent === null || window.parent.document.hidden) return false; return typeof wmIsDesktopApp === 'function' && wmIsDesktopApp() ? window.parent.document.hasFocus() : true; } catch (e) { return false; }
  }
  return document.hasFocus();
}
function _cwHere() { var s = window.WM_SOLO; if (s) _cwPost({ t: 'here', room: s.room, embed: !!s.embed, look: _cwLooking() }); }
function _cwFresh(key) { var h = WM_CW.here[key]; return h && Date.now() - h.at < 5000 ? h : null; }
/** (본 창) 이 방을 떼어 낸 창이나 옆 칸에서 지금 보고 있나 → 본 창은 알림 소리를 내지 않음 */
function wmChatWinShows(room) {
  var a = _cwFresh(room), b = _cwFresh(room + '|e');
  return !!((a && a.look) || (b && b.look));
}
/** (본 창) 이 방이 새 창으로 떠 있으면 그 창을 앞으로 → true */
function wmChatWinFocus(room) {
  if (window.WM_SOLO || !_cwFresh(room)) return false;
  _cwPost({ t: 'focus', room: room });
  try { var w = WM_CW.wins[room]; if (w && !w.closed) w.focus(); } catch (e) {}
  return true;
}

/* ─── ② 떼어 내기 ─── */
function _cwWinName(room) { return 'wmchat_' + String(room).replace(/[^A-Za-z0-9]/g, '_'); }
function wmChatPop(room) {
  if (!room) return false;
  if (window.WM_SOLO) { var m = wmSoloMain(); if (m && typeof m.wmChatPop === 'function') return m.wmChatPop(room); }
  if (wmChatWinFocus(room)) return true;
  var open = Object.keys(WM_CW.here).filter(function (k) { return k.indexOf('|e') < 0 && _cwFresh(k); }).length;
  if (open >= WM_CW.MAX_WIN) { _cwToast('대화 창은 ' + WM_CW.MAX_WIN + '개까지 띄울 수 있습니다 — 안 쓰는 창을 닫아 주세요', 'warn'); return false; }
  var pos = _cwJson('wm-cw-pos', {})[room], sw = (window.screen && screen.availWidth) || 1920, sh = (window.screen && screen.availHeight) || 1080;
  var w = pos ? pos.w : 460, h = pos ? pos.h : Math.min(720, sh - 80);
  var x = pos ? pos.x : Math.max(0, (window.screenX || 0) + (window.outerWidth || 1200) - w - 40 - open * 32), y = pos ? pos.y : Math.max(0, (window.screenY || 0) + 60 + open * 32);
  var win = null;
  try { win = window.open(location.pathname + '?solo=' + encodeURIComponent(room), _cwWinName(room), 'popup=yes,width=' + Math.round(w) + ',height=' + Math.round(h) + ',left=' + Math.round(x) + ',top=' + Math.round(y)); } catch (e) {}
  if (!win) { _cwToast('새 창이 막혔습니다 — 브라우저의 팝업 차단을 이 사이트에서 풀어 주세요', 'warn'); return false; }
  WM_CW.wins[room] = win;
  WM_CW.here[room] = { at: Date.now(), look: true, embed: false };   // 뜨는 동안 같은 방을 또 열지 않게
  wmChatSplitClose(room, true);
  try { win.focus(); } catch (e) {}
  return true;
}

/* ─── ③ 나란히 보기 (본 창) ─── */
function _cwSplitRooms() { var v = _cwJson('wm-cx-split', []); return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x; }).slice(0, WM_CW.MAX_PANE) : []; }
function wmChatSplitHas(room) { return _cwSplitRooms().indexOf(room) >= 0; }
function wmChatSplitAdd(room) {
  if (!room || window.WM_SOLO) return false;
  var list = _cwSplitRooms();
  if (list.indexOf(room) >= 0) { var p = document.querySelector('#cxSplit .cx-pane[data-room="' + (window.CSS && CSS.escape ? CSS.escape(room) : room) + '"]'); if (p) { p.classList.remove('cx-pane-hi'); void p.offsetWidth; p.classList.add('cx-pane-hi'); } return true; }
  if (window.innerWidth < WM_CW.MIN_SPLIT_W) { _cwToast('창이 좁아 나란히 둘 수 없습니다 — 창을 넓히거나 ↗ 새 창으로 떼어 내 보세요', 'warn'); return false; }
  if (list.length >= WM_CW.MAX_PANE) { _cwToast('옆 칸은 ' + WM_CW.MAX_PANE + '개까지 둘 수 있습니다 — 더 띄우려면 ↗ 새 창으로', 'warn'); return false; }
  list.push(room); _cwLs('wm-cx-split', JSON.stringify(list));
  // 본 칸에 열려 있던 방이면 본 칸은 비움 (같은 방이 두 군데 보이지 않게)
  if (typeof CX !== 'undefined' && CX.room === room) { var root = document.querySelector('#mMessages .cx'); if (root) { root.classList.remove('has-room'); root.classList.add('no-aside'); } CX.room = null; CX.thread = null; if (typeof _cxDrawRooms === 'function') _cxDrawRooms(); if (typeof _cxDrawMain === 'function') _cxDrawMain(); }
  wmChatSplitRender();
  return true;
}
function wmChatSplitClose(room, quiet) {
  var list = _cwSplitRooms(), i = list.indexOf(room);
  if (i < 0) return false;
  list.splice(i, 1); _cwLs('wm-cx-split', list.length ? JSON.stringify(list) : null);
  delete WM_CW.here[room + '|e'];
  wmChatSplitRender();
  if (!quiet && typeof _cxDrawRooms === 'function') _cxDrawRooms();
  return true;
}
/** 옆 칸 그리기 — 이미 있는 칸은 건드리지 않음 (다시 받지 않게) */
function wmChatSplitRender() {
  if (window.WM_SOLO) return;
  var page = document.getElementById('mMessages'); if (!page || !page.querySelector('.cx')) return;
  var list = _cwSplitRooms(), box = document.getElementById('cxSplit');
  if (!list.length) { if (box) box.remove(); page.classList.remove('has-split'); return; }
  if (!box) { box = document.createElement('div'); box.id = 'cxSplit'; box.className = 'cx-splitbox'; page.appendChild(box); }
  page.classList.add('has-split');
  // 옆 칸이 있으면 본 칸의 정보 칸(멤버 · 파일)은 닫음 — 열어 두면 본 대화가 너무 좁아짐 (ⓘ 로 다시 열 수 있음)
  if (typeof CX !== 'undefined' && CX.aside && !box.dataset.asideClosed) {
    box.dataset.asideClosed = '1'; CX.aside = false;
    var cx = page.querySelector('.cx'); if (cx) cx.classList.add('no-aside');
    if (typeof _cxDrawHead === 'function') _cxDrawHead();
  }
  Array.prototype.slice.call(box.children).forEach(function (el) { if (list.indexOf(el.dataset.room) < 0) el.remove(); });
  list.forEach(function (room) {
    var has = Array.prototype.filter.call(box.children, function (el) { return el.dataset.room === room; })[0];
    if (has) return;   // 그대로 둠 — iframe 을 옮기면 새로 읽혀 대화를 다시 받음
    var pane = document.createElement('div'); pane.className = 'cx-pane'; pane.dataset.room = room;
    var f = document.createElement('iframe'); f.title = '나란히 보는 대화방'; f.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; camera');
    f.src = location.pathname + '?solo=' + encodeURIComponent(room) + '&embed=1';
    pane.appendChild(f); box.appendChild(pane);
  });
  box.dataset.n = String(list.length);
}

/* ─── ① 대화 전용 화면 시작 (app-init.js _postAuthInit 이 부름) ─── */
async function wmSoloInit() {
  var s = window.WM_SOLO; if (!s) return;
  for (var i = 0; i < 480; i++) {   // 로그인될 때까지 (로그인 창이 뜨면 그동안 기다림)
    if (typeof _accessToken !== 'undefined' && _accessToken && typeof currentUser !== 'undefined' && currentUser && currentUser.id) break;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  try { if (typeof initSettings === 'function') initSettings(); } catch (e) { console.warn('[solo] settings', e); }
  try { if (typeof chatStreamStart === 'function') chatStreamStart(); } catch (e) {}   // 실시간 연결 바로 (2초마다 보는 것을 기다리지 않음)
  try { if (typeof CX !== 'undefined') { CX.pending = s.room; CX.aside = false; } if (typeof setPage === 'function') setPage('messages'); } catch (e) { console.error('[solo] open', e); }
  if (window.wmSplash) try { wmSplash.done(); } catch (e) {}
  _cwChan(); _cwHere();
  setInterval(_cwHere, 2000);
  ['focus', 'blur'].forEach(function (ev) { window.addEventListener(ev, function () { setTimeout(_cwHere, 30); }); });
  document.addEventListener('visibilitychange', _cwHere);
  var bye = function () { _cwPost({ t: 'bye', room: s.room, embed: !!s.embed }); if (!s.embed) _cwSavePos(); };
  window.addEventListener('pagehide', bye); window.addEventListener('beforeunload', bye);
  if (!s.embed) { var rt = 0; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(_cwSavePos, 400); }); setInterval(_cwSavePos, 5000); }
  setTimeout(function () { var ta = document.getElementById('cxIn'); if (ta && !s.embed) try { ta.focus(); } catch (e) {} }, 900);
}
/** 창 자리 · 크기 기억 (방마다) */
function _cwSavePos() {
  var s = window.WM_SOLO; if (!s || s.embed || !window.outerWidth) return;
  var all = _cwJson('wm-cw-pos', {}), p = { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight }, o = all[s.room];
  if (o && o.x === p.x && o.y === p.y && o.w === p.w && o.h === p.h) return;
  all[s.room] = p;
  var keys = Object.keys(all); if (keys.length > 40) delete all[keys[0]];
  _cwLs('wm-cw-pos', JSON.stringify(all));
}
/** (떼어 낸 창 · 옆 칸) 업무 카드 · 다른 화면은 본 창에서 열기 → 열었으면 true */
function wmSoloToMain(fn) {
  var m = wmSoloMain();
  if (!m) { _cwToast('본 창을 찾을 수 없습니다 — 업무 관리자 본 창에서 열어 주세요', 'warn'); return false; }
  try { fn(m); if (!window.WM_SOLO.embed) m.focus(); return true; } catch (e) { _cwToast('본 창에서 열지 못했습니다', 'error'); return false; }
}

if (!window.WM_SOLO) {
  _cwChan();
  setTimeout(function () { _cwPost({ t: 'ask' }); }, 1500);   // 본 창을 새로 고쳤을 때 — 떠 있는 창이 누군지 다시 물음
  // 창을 좁히면 옆 칸은 숨김(style.css) · 다시 넓히면 보임
}
