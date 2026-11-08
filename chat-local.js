/* chat-local.js — 💬 메신저 휴대폰(브라우저)에 담아 두기 (v13.380)
 *   앱을 열자마자 방 목록 · 최근 연 방(최대 12곳, 방마다 최근 60개)을 바로 그리고, 서버와는 뒤에서 맞춤 (카톡처럼)
 *   IndexedDB 'wm-chat' · 사람마다 따로(uid) · 로그아웃하면 지움(authLogout → chatLocalClear) · 다른 사람으로 들어오면 버림
 * chat-ui.js 가 부르는 것: chatLocalLoad · chatLocalSave · chatLocalClear */
var CXL = { db: null, t: 0 };
function _cxlOpen() {
  if (CXL.db) return CXL.db;
  CXL.db = new Promise(function (ok, no) {
    if (!window.indexedDB) return no(new Error('no idb'));
    var rq; try { rq = indexedDB.open('wm-chat', 1); } catch (e) { return no(e); }
    rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
    rq.onsuccess = function () { ok(rq.result); };
    rq.onerror = function () { no(rq.error); };
  });
  CXL.db.catch(function () { CXL.db = null; });
  return CXL.db;
}
function _cxlTx(mode, fn) {
  return _cxlOpen().then(function (db) { return new Promise(function (ok, no) { var tx = db.transaction('kv', mode), st = tx.objectStore('kv'), r = fn(st); tx.oncomplete = function () { ok(r && r.result); }; tx.onerror = function () { no(tx.error); }; }); });
}
/** 담아 둔 것 → { rooms, cache } (다른 사람 것이면 null) */
function chatLocalLoad() {
  var uid = typeof _cxMe === 'function' ? _cxMe() : null; if (!uid) return Promise.resolve(null);
  return _cxlTx('readonly', function (st) { return st.get('snap'); }).then(function (v) {
    if (!v || v.uid !== uid || Date.now() - (v.at || 0) > 14 * 864e5) return null;
    return v;
  }).catch(function () { return null; });
}
/** 지금 모습 담기 — 몰아서 1.5초에 한 번 */
function chatLocalSave() {
  clearTimeout(CXL.t);
  CXL.t = setTimeout(function () {
    var uid = typeof _cxMe === 'function' ? _cxMe() : null; if (!uid || typeof CX === 'undefined' || !CX.rooms.length) return;
    var cache = {};
    (CX.cacheOrder || []).slice(-12).forEach(function (id) {
      var c = CX.cache[id]; if (!c || !c.info) return;
      cache[id] = { info: c.info, msgs: (c.msgs || []).filter(function (m) { return !m.pending; }).slice(-60), more: true, reads: c.reads || {} };
    });
    var snap = { uid: uid, at: Date.now(), rooms: CX.rooms, cache: cache, order: (CX.cacheOrder || []).slice(-12) };
    _cxlTx('readwrite', function (st) { return st.put(snap, 'snap'); }).catch(function () {});
  }, 1500);
}
function chatLocalClear() {
  clearTimeout(CXL.t);
  return _cxlTx('readwrite', function (st) { return st.clear(); }).catch(function () {});
}
if (typeof window !== 'undefined') { window.chatLocalLoad = chatLocalLoad; window.chatLocalSave = chatLocalSave; window.chatLocalClear = chatLocalClear; }
