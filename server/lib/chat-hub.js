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
function onlineSet(ids) { var o = {}; (ids || []).forEach(function (id) { if (online(id)) o[id] = true; }); return o; }

function write(res, event, data) {
  try { res.write('id: ' + (++seq) + '\nevent: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); if (res.flush) res.flush(); } catch (e) {}
}
/** userIds 에게 event 보내기 (exceptRes: 보낸 탭은 빼고 싶을 때) */
function publish(userIds, event, data) {
  (userIds || []).forEach(function (u) { var s = conns[u]; if (s) s.forEach(function (res) { write(res, event, data); }); });
}
function count() { var n = 0; Object.keys(conns).forEach(function (k) { n += conns[k].size; }); return n; }
function _reset() { conns = {}; }

module.exports = { add: add, online: online, onlineSet: onlineSet, publish: publish, write: write, count: count, _reset: _reset };
