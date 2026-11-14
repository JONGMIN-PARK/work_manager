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

/* v13.436 🖼 사진 미리보기 담아 두기 — 같은 'kv' 칸에 't:<파일 id>' = ArrayBuffer(JPEG). 최근 800장까지('tidx' 가 넣은 순서)
 *   한 번 본 사진은 다음에 서버에 묻지 않고 바로 뜸. 로그아웃하면 chatLocalClear 가 같이 지움 */
function chatThumbGet(ids) {
  return _cxlOpen().then(function (db) {
    return new Promise(function (ok) {
      var out = {}, tx = db.transaction('kv', 'readonly'), st = tx.objectStore('kv');
      ids.forEach(function (id) { var r = st.get('t:' + id); r.onsuccess = function () { if (r.result && r.result.byteLength) out[id] = r.result; }; });
      tx.oncomplete = function () { ok(out); }; tx.onerror = tx.onabort = function () { ok(out); };
    });
  }).catch(function () { return {}; });
}
/* v13.497 🖼 사진 원본 담아 두기 — 'o:<파일 id>' = Blob. 'oidx' = [[id, 바이트]] 넣은 순서(가장 최근 끝).
 *   한 번 크게 본 사진은 다시 열거나 ◀ ▶ 로 넘기거나 앱을 다시 켜도 서버 · 저장소에 묻지 않고 바로. 300MB · 400장 넘으면 오래된 것부터 버림 */
var CXL_FULL_MAX = 300 * 1024 * 1024, CXL_FULL_N = 400;
function chatFullGet(id) {
  return _cxlOpen().then(function (db) {
    return new Promise(function (ok) {
      var tx = db.transaction('kv', 'readonly'), r = tx.objectStore('kv').get('o:' + id), out = null;
      r.onsuccess = function () { if (r.result && r.result.size) out = r.result; };
      tx.oncomplete = function () { ok(out); }; tx.onerror = tx.onabort = function () { ok(null); };
    });
  }).catch(function () { return null; });
}
function chatFullPut(id, blob) {
  if (!id || !blob || !blob.size || blob.size > 60 * 1024 * 1024) return Promise.resolve();
  return _cxlOpen().then(function (db) {
    return new Promise(function (ok) {
      var tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'), g = st.get('oidx');
      g.onsuccess = function () {
        var idx = (Array.isArray(g.result) ? g.result : []).filter(function (x) { return x[0] !== id; });
        idx.push([id, blob.size]); st.put(blob, 'o:' + id);
        var tot = idx.reduce(function (s, x) { return s + x[1]; }, 0);
        while (idx.length > 1 && (tot > CXL_FULL_MAX || idx.length > CXL_FULL_N)) { var x = idx.shift(); tot -= x[1]; st.delete('o:' + x[0]); }
        st.put(idx, 'oidx');
      };
      tx.oncomplete = tx.onerror = tx.onabort = function () { ok(); };
    });
  }).catch(function () {});
}
if (typeof window !== 'undefined') { window.chatFullGet = chatFullGet; window.chatFullPut = chatFullPut; }
function chatThumbPut(map) {
  var ids = Object.keys(map || {}); if (!ids.length) return Promise.resolve();
  return _cxlOpen().then(function (db) {
    return new Promise(function (ok) {
      var tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'), g = st.get('tidx');
      g.onsuccess = function () {
        var idx = Array.isArray(g.result) ? g.result : [];
        ids.forEach(function (id) { st.put(map[id], 't:' + id); if (idx.indexOf(id) < 0) idx.push(id); });
        while (idx.length > 800) st.delete('t:' + idx.shift());
        st.put(idx, 'tidx');
      };
      tx.oncomplete = tx.onerror = tx.onabort = function () { ok(); };
    });
  }).catch(function () {});
}
