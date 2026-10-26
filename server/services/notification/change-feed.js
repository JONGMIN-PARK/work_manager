/**
 * 프로젝트 변경 알림 묶음 — v13.215
 *
 * 프로젝트·마일스톤·체크리스트·사양서 저장은 화면에서 연달아 일어난다(체크 여러 번, 드래그로 날짜 이동…).
 * 저장마다 보내면 텔레그램이 도배되므로 (테넌트, 프로젝트, 작성자) 단위로 모았다가
 *  - 마지막 변경 후 QUIET_MS 동안 조용하면, 또는 첫 변경 후 MAX_MS 가 지나면
 * 한 건(project_updated)으로 프로젝트 이해관계자 + 프로젝트 그룹방에 보낸다.
 * 같은 값을 여러 번 바꾸면 처음 값 → 마지막 값으로 합치고, 원래대로 돌아오면 빠진다(lib/change-diff 항목 형식).
 * 메모리 버퍼라 서버 재시작 직전 1분 안의 변경은 빠질 수 있다(알림은 best-effort).
 */
var db = require('../../config/db');
var dispatch = require('./dispatch');

var QUIET_MS = +process.env.CHANGE_FEED_QUIET_MS || 60 * 1000;
var MAX_MS = +process.env.CHANGE_FEED_MAX_MS || 5 * 60 * 1000;
var MAX_LINES = 15;

var _buf = new Map(); // key → { tenantId, projectId, actorId, actorName, entries: Map, order: [], first, timer }

/** 항목 → 한 줄. 내용이 없어졌으면(원래 값으로 돌아옴) '' */
function lineOf(e) {
  if (e.list) {
    var l = e.list.slice(0, 6).join(', ') + (e.list.length > 6 ? ' 외 ' + (e.list.length - 6) + '개' : '');
    return e.label + ': ' + l;
  }
  if (e.text != null) return e.text;
  if (String(e.from) === String(e.to)) return '';
  return e.label + ': ' + (e.from === '' || e.from == null ? '(없음)' : e.from) + ' → ' + (e.to === '' || e.to == null ? '(없음)' : e.to);
}

function merge(cur, e) {
  if (!cur) return Object.assign({}, e, e.list ? { list: e.list.slice() } : {});
  if (e.list && cur.list) { e.list.forEach(function (x) { if (cur.list.indexOf(x) < 0) cur.list.push(x); }); return cur; }
  if (e.from !== undefined && cur.from !== undefined && cur.text == null) return Object.assign({}, e, { from: cur.from });
  return Object.assign({}, e);
}

function linesOf(b) {
  return b.order.map(function (k) { return lineOf(b.entries.get(k)); }).filter(Boolean);
}

async function flush(key) {
  var b = _buf.get(key);
  if (!b) return;
  _buf.delete(key);
  clearTimeout(b.timer);
  var lines = linesOf(b);
  if (!lines.length) return;
  try {
    var pr = await db.query('SELECT name, order_no FROM projects WHERE id = $1 AND tenant_id = $2', [b.projectId, b.tenantId]);
    if (!pr.rows.length) return; // 그 사이 삭제됨
    await dispatch.notifyProjectStakeholders('project_updated', {
      projectName: pr.rows[0].name,
      orderNo: pr.rows[0].order_no,
      actorName: b.actorName || null,
      lines: lines.slice(0, MAX_LINES),
      more: Math.max(0, lines.length - MAX_LINES)
    }, b.projectId);
  } catch (e) {
    console.error('[change-feed] flush', e.message);
  }
}

function schedule(key, b) {
  clearTimeout(b.timer);
  var wait = Math.max(0, Math.min(QUIET_MS, b.first + MAX_MS - Date.now()));
  b.timer = setTimeout(function () { flush(key); }, wait);
  if (b.timer.unref) b.timer.unref();
}

/**
 * 변경 기록 — 라우트에서 응답을 보낸 뒤 호출 (동기, 예외 없음)
 * @param {object} req  인증된 요청 (tenant·user)
 * @param {string} projectId
 * @param {object[]} entries lib/change-diff 항목
 */
function record(req, projectId, entries) {
  try {
    if (!projectId || !entries || !entries.length || !req || !req.tenant) return;
    var actorId = req.user && req.user.sub;
    var key = req.tenant.id + ':' + projectId + ':' + (actorId || '');
    var b = _buf.get(key);
    if (!b) {
      b = { tenantId: req.tenant.id, projectId: projectId, actorId: actorId, actorName: (req.user && req.user.name) || '', entries: new Map(), order: [], first: Date.now(), timer: null };
      _buf.set(key, b);
    }
    entries.forEach(function (e) {
      if (!e || !e.key) return;
      if (!b.entries.has(e.key)) b.order.push(e.key);
      b.entries.set(e.key, merge(b.entries.get(e.key), e));
    });
    schedule(key, b);
  } catch (e) {
    console.error('[change-feed] record', e.message);
  }
}

/** 대기 중인 묶음을 모두 지금 보낸다 (종료 직전·테스트) */
function flushAll() {
  return Promise.all(Array.from(_buf.keys()).map(flush));
}

/** 테스트용 — 보내지 않고 대기 묶음의 줄만 본다 */
function _peek(tenantId, projectId, actorId) {
  var b = _buf.get(tenantId + ':' + projectId + ':' + (actorId || ''));
  return b ? linesOf(b) : [];
}
function _reset() { _buf.forEach(function (b) { clearTimeout(b.timer); }); _buf.clear(); }

module.exports = { record: record, flushAll: flushAll, lineOf: lineOf, _peek: _peek, _reset: _reset };
