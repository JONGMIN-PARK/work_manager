/**
 * 💬 사내 메신저 실시간 허브 (v13.315) — SSE(서버 → 브라우저 한 방향 스트림)
 *   브라우저는 GET /api/chat/stream 을 fetch 스트림으로 열어 두고(Authorization 헤더 그대로), 보낼 때는 보통 POST.
 *   WebSocket 대신 SSE — 의존성 없음 · Render 프록시 그대로 · 끊기면 브라우저가 다시 붙음.
 *   한 서버(인스턴스) 안에서만 퍼뜨림 — 여러 대로 늘리면 PG LISTEN/NOTIFY 로 이어 붙일 것(publish 한 곳만 바꾸면 됨).
 */
var conns = {};   // userId → Set(res)
var seq = 0;

function add(userId, res) {
  (conns[userId] = conns[userId] || new Set()).add(res);
  return function () { var s = conns[userId]; if (!s) return; s.delete(res); if (!s.size) delete conns[userId]; };
}
function online(userId) { return !!(conns[userId] && conns[userId].size); }
/* v13.371 화면을 보고 있는 연결이 하나라도 있나 — 휴대폰은 앱을 내리면(화면 가려짐) 연결이 한동안 살아 있어도
 *   그 사이 화면 코드가 멈춰 알림을 못 띄움 → 가려진 연결만 남으면 푸시를 보냄 */
function awake(userId) { var s = conns[userId]; if (!s) return false; for (var r of s) if (!r.wmAway) return true; return false; }
function setAway(userId, cid, away) {
  var s = conns[userId], n = 0; if (!s || !cid) return 0;
  s.forEach(function (r) { if (r.wmCid === cid) { r.wmAway = !!away; n++; } });
  return n;
}
function onlineSet(ids) { var o = {}; (ids || []).forEach(function (id) { if (online(id)) o[id] = true; }); return o; }

function write(res, event, data) {
  try { res.write('id: ' + (++seq) + '\nevent: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); if (res.flush) res.flush(); } catch (e) {}
}
/** userIds 에게 event 보내기 (exceptRes: 보낸 탭은 빼고 싶을 때) */
function publish(userIds, event, data) {
  var json = null;   // v13.366 100명 방 — JSON 은 한 번만 만들고 같은 글을 나눠 씀
  (userIds || []).forEach(function (u) {
    var s = conns[u]; if (!s) return;
    if (json == null) json = JSON.stringify(data);
    s.forEach(function (res) { try { res.write('id: ' + (++seq) + '\nevent: ' + event + '\ndata: ' + json + '\n\n'); if (res.flush) res.flush(); } catch (e) {} });
  });
}
function count() { var n = 0; Object.keys(conns).forEach(function (k) { n += conns[k].size; }); return n; }
function _reset() { conns = {}; }

module.exports = { add: add, online: online, awake: awake, setAway: setAway, onlineSet: onlineSet, publish: publish, write: write, count: count, _reset: _reset };
