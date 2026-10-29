/**
 * 📁 내 프로젝트 (v13.273) — 내 업무의 기간 있는 일 묶음. 본인만.
 *   단독 = 기간 · 진행률을 직접, 연계 = 프로젝트 관리 프로젝트(link_project_id)의 기간 · 진행률 · 마일스톤을 읽어 옴 (복사 안 함)
 *   항목 소속 = my_work_marks.project_id (어느 출처든). 표시가 없으면 연계 프로젝트와 같은 프로젝트(projectId)의 항목은 자동으로 묶임 — 클라에서
 *   후보 = 내가 주인 · 멤버인 진행 중 프로젝트 관리 프로젝트 중 아직 연결 안 한 것
 */
var crypto = require('crypto');
var db = require('../config/db');
var pa = require('./project-access');

var STATUS = ['plan', 'doing', 'hold', 'done'];
var COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink', 'slate'];
var MAX = 50;

function genId() { return 'mprj-' + crypto.randomUUID().slice(0, 12); }
function ymd(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

/** 본문 → 고칠 칸들 [[col, value]] — 잘못된 값은 오류 문자열 */
function fields(b) {
  var f = [];
  if (b.title !== undefined) {
    var t = String(b.title || '').trim().slice(0, 200);
    if (!t) return '프로젝트 이름을 적어 주세요.';
    f.push(['title', t]);
  }
  if (b.startDate !== undefined) f.push(['start_date', ymd(b.startDate)]);
  if (b.endDate !== undefined) f.push(['end_date', ymd(b.endDate)]);
  if (b.status !== undefined) {
    if (STATUS.indexOf(b.status) < 0) return '상태 값이 맞지 않습니다.';
    f.push(['status', b.status]);
  }
  if (b.color !== undefined) f.push(['color', COLORS.indexOf(b.color) >= 0 ? b.color : null]);
  if (b.icon !== undefined) f.push(['icon', String(b.icon || '').trim().slice(0, 16) || null]);
  if (b.memo !== undefined) f.push(['memo', String(b.memo || '').slice(0, 5000) || null]);
  if (b.progress !== undefined) {
    var p = b.progress === null || b.progress === '' ? null : Math.round(Number(b.progress));
    if (p !== null && (isNaN(p) || p < 0 || p > 100)) return '진행률은 0~100 입니다.';
    f.push(['progress', p]);
  }
  if (b.visible !== undefined) f.push(['visible', !!b.visible]);
  var s = f.filter(function (x) { return x[0] === 'start_date'; })[0], e = f.filter(function (x) { return x[0] === 'end_date'; })[0];
  if (s && e && s[1] && e[1] && s[1] > e[1]) return '끝나는 날이 시작보다 앞입니다.';
  return f;
}

/** 행 + 연계 정보 → 화면에 줄 모양. 연계면 기간 · 진행률은 프로젝트 관리 것 (없으면 내 것) */
function out(r, cnt, ms) {
  var linked = !!r.link_project_id;
  var ok = linked && r.p_id && r.can_read;
  var o = {
    id: r.id, title: r.title, status: r.status, color: r.color || null, icon: r.icon || '', memo: r.memo || '', visible: r.visible !== false,
    order: r.sort_order, start: r.start_date || null, end: r.end_date || null, progress: r.progress == null ? null : +r.progress,
    link: r.link_project_id || null, todoN: (cnt && cnt.n) || 0, todoDone: (cnt && cnt.d) || 0
  };
  if (linked) {
    o.linkInfo = ok
      ? { name: r.p_name, start: r.p_start || null, end: r.p_end || null, status: r.p_status || '', progress: r.p_progress == null ? null : +r.p_progress, color: r.p_color || null, canEdit: !!r.can_edit,
          ms: (ms || []).map(function (m) { return { id: m.id, name: m.name, start: m.start_date || null, due: m.end_date || null, status: m.status || '' }; }) }
      : { locked: true, gone: !r.p_id };
    if (ok) {
      if (o.linkInfo.start) o.start = o.linkInfo.start;
      if (o.linkInfo.end) o.end = o.linkInfo.end;
      if (o.linkInfo.progress != null) o.progress = o.linkInfo.progress;
    }
  }
  return o;
}

/** 내 프로젝트 전부 + 연계 후보 — 네 쿼리를 한 번에 */
async function list(req) {
  var tid = req.tenant.id, me = req.user.sub;
  var vis = pa.visibleProjectsSql(req, 'p', 3);
  var ed = pa.editableProjectsSql(req, 'p', vis.nextIdx);
  var rowsP = db.query(
    'SELECT mp.*, p.id AS p_id, p.name AS p_name, p.start_date AS p_start, p.end_date AS p_end, p.status AS p_status, p.progress AS p_progress, p.color AS p_color, ' +
    '(' + vis.sql + ') AS can_read, (' + ed.sql + ') AS can_edit ' +
    'FROM my_projects mp LEFT JOIN projects p ON p.id = mp.link_project_id AND p.tenant_id = mp.tenant_id ' +
    'WHERE mp.tenant_id = $1 AND mp.user_id = $2 AND mp.deleted_at IS NULL ORDER BY mp.sort_order, mp.created_at',
    [tid, me].concat(vis.params, ed.params));
  var vis2 = pa.visibleProjectsSql(req, 'p', 3);
  var msP = db.query(
    'SELECT ms.id, ms.project_id, ms.name, ms.start_date, ms.end_date, ms.status FROM milestones ms JOIN projects p ON p.id = ms.project_id AND p.tenant_id = ms.tenant_id ' +
    'WHERE ms.tenant_id = $1 AND ms.project_id IN (SELECT link_project_id FROM my_projects WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL AND link_project_id IS NOT NULL) AND ' + vis2.sql +
    ' ORDER BY ms.end_date NULLS LAST, ms.sort_order LIMIT 1000',
    [tid, me].concat(vis2.params));
  var cntP = db.query(
    "SELECT m.project_id, COUNT(*)::int AS n, COUNT(t.done_at)::int AS d FROM my_work_marks m JOIN my_todos t ON m.item_key = 'todo:' || t.id AND t.tenant_id = m.tenant_id AND t.user_id = m.user_id AND t.deleted_at IS NULL " +
    "WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.project_id IS NOT NULL AND m.project_id <> '-' GROUP BY m.project_id", [me, tid]);
  var candP = db.query(
    'SELECT p.id, p.name, p.start_date, p.end_date, p.status FROM projects p WHERE p.tenant_id = $1 ' +
    "AND COALESCE(p.status, '') NOT IN ('done', 'completed', 'cancelled') " +
    'AND (p.owner_id = $2 OR EXISTS (SELECT 1 FROM project_members _pm WHERE _pm.project_id = p.id AND _pm.user_id = $2 AND _pm.released_at IS NULL)) ' +
    'AND NOT EXISTS (SELECT 1 FROM my_projects mp WHERE mp.tenant_id = $1 AND mp.user_id = $2 AND mp.link_project_id = p.id AND mp.deleted_at IS NULL) ' +
    'ORDER BY p.end_date NULLS LAST, p.name LIMIT 30', [tid, me]);
  [rowsP, msP, cntP, candP].forEach(function (p) { p.catch(function () {}); });
  var got = await Promise.all([rowsP, msP, cntP, candP]);
  var cnt = {}, ms = {};
  got[2].rows.forEach(function (x) { cnt[x.project_id] = x; });
  got[1].rows.forEach(function (x) { (ms[x.project_id] = ms[x.project_id] || []).push(x); });
  return {
    data: got[0].rows.map(function (r) { return out(r, cnt[r.id], ms[r.link_project_id]); }),
    cands: got[3].rows.map(function (p) { return { id: p.id, name: p.name, start: p.start_date || null, end: p.end_date || null, status: p.status || '' }; })
  };
}

/** 하나 (고친 뒤 돌려줄 모양) */
async function one(req, id) {
  var all = await list(req);
  return all.data.filter(function (p) { return p.id === id; })[0] || null;
}

/** 내 것인지 (지운 것 빼고) */
async function owns(req, id) {
  if (!id) return false;
  var r = await db.query('SELECT 1 FROM my_projects WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL', [String(id), req.tenant.id, req.user.sub]);
  return r.rows.length > 0;
}

module.exports = { STATUS: STATUS, COLORS: COLORS, MAX: MAX, genId: genId, fields: fields, list: list, one: one, owns: owns };
