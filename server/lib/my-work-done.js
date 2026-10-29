/**
 * 내 업무 완료 처리 · 맵 주제 고치기 — 웹(routes/my-work)과 텔레그램(/mywork done · ✅ 버튼)이 같이 씀 (v13.274 에서 라우트에서 뺌)
 *   setDone(req, src, id, subject, done) → { data } | { err: [status, code, message] }
 *     subject = 담당 { id, name } (todo 는 req.user 본인). 본인 · 관리자인지는 부른 쪽에서 확인
 *   editMapNode(req, mapId, nodeId, fn) → null(저장됨) | [status, code, message]
 */
var db = require('../config/db');
var myWork = require('./my-work');
var repeatNext = require('./todo-repeat').repeatNext;

var DONE_SRC = ['mindmap', 'issue', 'action', 'dev', 'todo'];

async function mapLockedByOther(req, mapId) {
  var r = await db.query(
    "SELECT user_name FROM edit_locks WHERE resource_type = 'mindmap' AND resource_id = $1 AND tenant_id = $2 AND user_id <> $3 AND expires_at > now()",
    [mapId, req.tenant.id, req.user.sub]
  );
  return r.rows[0] ? (r.rows[0].user_name || '다른 사용자') : null;
}

/** 맵 주제 하나 고치기 — fn(node) 가 false 를 돌려주면 안 고침. 버전이 맞을 때만 저장 */
async function editMapNode(req, mapId, nodeId, fn) {
  var who = await mapLockedByOther(req, mapId);
  if (who) return [409, 'LOCKED', who + ' 님이 이 맵을 편집 중입니다. 맵에서 직접 바꾸거나 잠시 뒤에 다시 해 주세요.'];
  var r = await db.query('SELECT id, doc, version FROM mindmaps WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [mapId, req.tenant.id]);
  if (!r.rows.length) return [404, 'NOT_FOUND', undefined];
  var row = r.rows[0];
  var doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;
  var node = null;
  ((doc && doc.sheets) || []).some(function (sh) {
    (function walk(n) { if (node || !n) return; if (n.id === nodeId) { node = n; return; } (n.children || []).forEach(walk); })(sh.root);
    return !!node;
  });
  if (!node) return [404, 'NOT_FOUND', '주제를 찾을 수 없습니다.'];
  if (fn(node) === false) return [403, 'FORBIDDEN', '이 주제를 바꿀 수 없습니다.'];
  var u = await db.query('UPDATE mindmaps SET doc = $1, version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $3 AND tenant_id = $4 AND version = $5 RETURNING version',
    [JSON.stringify(doc), req.user.sub, mapId, req.tenant.id, row.version]);
  if (!u.rows.length) return [409, 'CONFLICT', '맵이 방금 바뀌었습니다. 다시 해 주세요.'];
  return null;
}

function splitMapId(id) { var i = String(id).indexOf(':'); return i > 0 ? { mapId: id.slice(0, i), nodeId: id.slice(i + 1) } : null; }

async function setDone(req, src, id, subject, done) {
  if (DONE_SRC.indexOf(src) < 0 || !id) return { err: [400, 'VALIDATION', '완료로 바꿀 수 없는 항목입니다.'] };
  // 개인 할 일은 바로 — 내 것인지는 UPDATE 조건으로 (예전엔 할 일 목록을 다 모아 확인, v13.270)
  if (src === 'todo') {
    var tr = await db.query('UPDATE my_todos SET done_at = ' + (done ? 'COALESCE(done_at, now())' : 'NULL') + ', updated_at = now() ' +
      'WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL RETURNING *', [id, req.tenant.id, req.user.sub]);
    if (!tr.rows.length) return { err: [404, 'NOT_FOUND', '담당 업무에서 찾을 수 없습니다.'] };
    var nx = done && tr.rows[0].repeat ? await repeatNext(req, id, tr.rows[0]) : null;
    return { data: { src: src, id: id, done: done, next: nx ? nx.id : null, nextRow: nx, title: tr.rows[0].title } };
  }
  // 그 사람 담당이 맞는지 — 목록을 다시 모아 확인 (권한 · 가시성 규칙을 한 곳에)
  var items = await myWork.collect(req, [subject], { done: true, sources: [src] });
  var it = items.filter(function (x) { return x.id === id; })[0];
  if (!it) return { err: [404, 'NOT_FOUND', '담당 업무에서 찾을 수 없습니다.'] };
  var tid = req.tenant.id;
  var today = myWork.kstToday();
  if (src === 'issue') {
    await db.query(
      "UPDATE issues SET status = $1::varchar, resolved_date = CASE WHEN $1::varchar = 'resolved' THEN COALESCE(NULLIF(resolved_date, ''), $2::varchar) ELSE resolved_date END, updated_by = $3, updated_at = now() WHERE id = $4 AND tenant_id = $5",
      [done ? 'resolved' : 'inProgress', today, req.user.sub, id, tid]);
  } else if (src === 'action') {
    await db.query(done
      ? "UPDATE meeting_action_items SET status = 'done', done_at = COALESCE(done_at, now()) WHERE id = $1 AND tenant_id = $2"
      : "UPDATE meeting_action_items SET status = 'open', done_at = NULL WHERE id = $1 AND tenant_id = $2", [id, tid]);
  } else if (src === 'dev') {
    await db.query('UPDATE project_dev_items SET status = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4',
      [done ? 'done' : 'doing', req.user.sub, id, tid]);
  } else if (src === 'mindmap') {
    var mp = splitMapId(id);
    var e = await editMapNode(req, mp.mapId, mp.nodeId, function (n) {
      if (n.assigneeId !== subject.id) return false;
      if (done) { n.done = true; n.doneAt = n.doneAt || new Date().toISOString(); }
      else { delete n.done; delete n.doneAt; if (parseInt(n.progress, 10) >= 100) delete n.progress; }
    });
    if (e) return { err: e };
  }
  return { data: { src: src, id: id, done: done, next: null, title: it.title } };
}

module.exports = { DONE_SRC: DONE_SRC, setDone: setDone, editMapNode: editMapNode, splitMapId: splitMapId };
