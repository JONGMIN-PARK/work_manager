/**
 * 내 업무 · 업무 부하 — 담당과 마감이 있는 할 일을 여러 곳에서 모은다 (v13.248)
 *   mindmap  마인드맵 주제 (assigneeId · dueDate · done · progress)
 *   issue    이슈 (issue_assignees — user_id, 없으면 이름)
 *   action   회의 액션아이템 (assignee_id, 없으면 이름)
 *   prestudy 사전검토 (owner_id, 회신기한)
 *   milestone 마일스톤 (milestone_assignments, 종료일)
 *   dev      개발 작업 (assignee_id, 마감은 연결된 마일스톤 종료일)
 *   todo     개인 할 일 (my_todos)
 * 새로 입력받는 것은 todo 뿐 — 나머지는 원래 자리에 있는 값을 읽기만 한다.
 *
 * 항목: { key, src, id, userId, title, ctx, ctxId, due, done, doneAt, progress, weight, pri, urgent, status, mapId, sheet, nodeId, projectId, mapOpen }
 *   pri — 중요도 1 긴급 · 2 높음 · 3 보통 · 4 낮음 (lib/priority, v13.253). urgent = pri 1
 *   todo 는 본인일 때 todoStatus · waitingFor · memo · dueTime · repeat · estimateH · checklist 도
 */
var db = require('../config/db');
var mmVisible = require('./mindmap-visible');
var pa = require('./project-access');
var prio = require('./priority');

var DONE_DAYS = 7;

function ymd(v) {
  if (!v) return null;
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  return null;
}
function firstLine(s, max) { return (String(s || '').split('\n')[0].trim().slice(0, max || 120)) || '(제목 없음)'; }
function recent(at, days) { return !!at && (Date.now() - new Date(at).getTime()) <= days * 86400000; }

/**
 * @param {object} req     요청 (테넌트 · 보는 사람). 보는 사람 ≠ 대상이면 보는 사람이 볼 수 있는 프로젝트 · 맵 것만
 * @param {Array<{id,name}>} users  대상 사용자
 * @param {object} [opt]   { done: true 면 최근 7일 안에 끝낸 것도, sources: ['mindmap',...] }
 * @returns {Promise<Array>}
 */
async function collect(req, users, opt) {
  opt = opt || {};
  if (!users.length) return [];
  var tid = req.tenant.id;
  var ids = users.map(function (u) { return u.id; });
  var names = users.map(function (u) { return u.name; }).filter(Boolean);
  var idByName = {};
  users.forEach(function (u) { if (u.name) idByName[u.name] = u.id; });
  var onlySelf = ids.length === 1 && ids[0] === req.user.sub;
  // 남의 것을 볼 때는 보는 사람이 볼 수 있는 프로젝트 것만 (관리자는 전체)
  var projFilter = function (col, startIdx) {
    if (onlySelf || req.user.role === 'admin') return { sql: '', params: [] };
    var sub = pa.accessibleProjectsSubquery(req, startIdx);
    return { sql: ' AND (' + col + ' IS NULL OR ' + col + ' IN (' + sub.sql + '))', params: sub.params };
  };
  var want = function (s) { return !opt.sources || opt.sources.indexOf(s) >= 0; };
  var doneWin = opt.done ? DONE_DAYS : 0;
  var out = [];
  var jobs = [];

  if (want('issue')) jobs.push((async function () {
    var pf = projFilter('i.project_id', 5);
    var r = await db.query(
      'SELECT i.id, i.title, i.due_date, i.status, i.urgency, i.project_id, i.updated_at, p.name AS project_name, ia.user_id, ia.assignee_name ' +
      'FROM issues i JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.tenant_id = i.tenant_id ' +
      'LEFT JOIN projects p ON p.id = i.project_id AND p.tenant_id = i.tenant_id ' +
      'WHERE i.tenant_id = $1 AND (ia.user_id = ANY($2) OR (ia.user_id IS NULL AND ia.assignee_name = ANY($3))) ' +
      "AND (COALESCE(i.status, '') NOT IN ('resolved','closed') OR ($4::int > 0 AND i.updated_at >= now() - make_interval(days => $4::int)))" + pf.sql,
      [tid, ids, names, doneWin].concat(pf.params)
    );
    var seen = {};
    r.rows.forEach(function (x) {
      var uid = x.user_id || idByName[x.assignee_name];
      if (!uid || seen[x.id + uid]) return;
      seen[x.id + uid] = true;
      var done = x.status === 'resolved' || x.status === 'closed';
      out.push({ src: 'issue', id: x.id, userId: uid, title: firstLine(x.title), ctx: x.project_name || '', projectId: x.project_id,
        due: ymd(x.due_date), done: done, doneAt: done ? x.updated_at : null, status: x.status, pri: prio.fromWord(x.urgency) });
    });
  })());

  if (want('action')) jobs.push((async function () {
    var pf = projFilter('m.project_id', 5);
    var r = await db.query(
      'SELECT a.id, a.title, a.due_date, a.status, a.done_at, a.priority, a.assignee_id, a.assignee_name, a.meeting_id, m.title AS meeting_title, m.meet_date, m.project_id, p.name AS project_name ' +
      'FROM meeting_action_items a JOIN meetings m ON m.id = a.meeting_id AND m.tenant_id = a.tenant_id ' +
      'LEFT JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id ' +
      'WHERE a.tenant_id = $1 AND (a.assignee_id = ANY($2) OR (a.assignee_id IS NULL AND a.assignee_name = ANY($3))) ' +
      "AND (COALESCE(a.status, '') <> 'done' OR ($4::int > 0 AND a.done_at >= now() - make_interval(days => $4::int)))" + pf.sql,
      [tid, ids, names, doneWin].concat(pf.params)
    );
    r.rows.forEach(function (x) {
      var uid = x.assignee_id || idByName[x.assignee_name];
      if (!uid) return;
      var done = x.status === 'done';
      out.push({ src: 'action', id: x.id, userId: uid, title: firstLine(x.title), ctx: (x.meeting_title || '회의') + (x.meet_date ? ' ' + String(x.meet_date).slice(5) : ''),
        ctxId: x.meeting_id, projectId: x.project_id, due: ymd(x.due_date), done: done, doneAt: done ? x.done_at : null, status: x.status, pri: prio.fromInt(x.priority) });
    });
  })());

  if (want('prestudy')) jobs.push((async function () {
    var r = await db.query(
      'SELECT id, title, client, due_date, status, priority, owner_id FROM prestudies ' +
      "WHERE tenant_id = $1 AND deleted_at IS NULL AND owner_id = ANY($2) AND status NOT IN ('won','dropped','hold')",
      [tid, ids]
    );
    r.rows.forEach(function (x) {
      out.push({ src: 'prestudy', id: x.id, userId: x.owner_id, title: firstLine(x.title), ctx: x.client || '사전검토', due: ymd(x.due_date), done: false, status: x.status, pri: prio.fromWord(x.priority) });
    });
  })());

  if (want('milestone')) jobs.push((async function () {
    var pf = projFilter('ms.project_id', 4);
    var r = await db.query(
      'SELECT DISTINCT ON (ms.id, a.user_id) ms.id, ms.name, ms.end_date, ms.status, ms.progress, ms.project_id, p.name AS project_name, a.user_id ' +
      'FROM milestones ms JOIN milestone_assignments a ON a.milestone_id = ms.id AND a.tenant_id = ms.tenant_id AND a.released_at IS NULL ' +
      'JOIN projects p ON p.id = ms.project_id AND p.tenant_id = ms.tenant_id ' +
      "WHERE ms.tenant_id = $1 AND a.user_id = ANY($2) AND COALESCE(ms.status, '') <> 'done' AND COALESCE(p.status, '') <> 'done' " +
      "AND (a.valid_until IS NULL OR a.valid_until = '' OR a.valid_until >= $3)" + pf.sql,
      [tid, ids, new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)].concat(pf.params)
    );
    r.rows.forEach(function (x) {
      var p = parseInt(x.progress, 10) || 0;
      out.push({ src: 'milestone', id: x.id, userId: x.user_id, title: firstLine(x.name), ctx: x.project_name || '', projectId: x.project_id,
        due: ymd(x.end_date), done: false, progress: p, status: x.status });
    });
  })());

  if (want('dev')) jobs.push((async function () {
    var pf = projFilter('d.project_id', 4);
    var r = await db.query(
      'SELECT d.id, d.title, d.status, d.priority, d.assignee_id, d.project_id, d.updated_at, p.name AS project_name, ms.end_date ' +
      'FROM project_dev_items d LEFT JOIN projects p ON p.id = d.project_id AND p.tenant_id = d.tenant_id ' +
      'LEFT JOIN milestones ms ON ms.id = d.milestone_id AND ms.tenant_id = d.tenant_id ' +
      'WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.assignee_id = ANY($2) ' +
      "AND (COALESCE(d.status, '') <> 'done' OR ($3::int > 0 AND d.updated_at >= now() - make_interval(days => $3::int)))" + pf.sql,
      [tid, ids, doneWin].concat(pf.params)
    );
    r.rows.forEach(function (x) {
      var done = x.status === 'done';
      out.push({ src: 'dev', id: x.id, userId: x.assignee_id, title: firstLine(x.title), ctx: x.project_name || '', projectId: x.project_id,
        due: ymd(x.end_date), done: done, doneAt: done ? x.updated_at : null, status: x.status, pri: prio.fromWord(x.priority) });
    });
  })());

  if (want('todo')) jobs.push((async function () {
    if (!onlySelf && !opt.load) return;   // 개인 할 일은 본인만 — 업무 부하에서는 개수만
    var r = await db.query(
      'SELECT id, user_id, title, due_date, done_at, priority, status, waiting_for, memo, due_time, repeat, estimate_h, checklist FROM my_todos WHERE tenant_id = $1 AND user_id = ANY($2) AND deleted_at IS NULL ' +
      'AND (done_at IS NULL OR ($3::int > 0 AND done_at >= now() - make_interval(days => $3::int)))',
      [tid, ids, doneWin]
    );
    r.rows.forEach(function (x) {
      var it = { src: 'todo', id: x.id, userId: x.user_id, title: onlySelf ? firstLine(x.title, 500) : '개인 할 일', ctx: '', due: ymd(x.due_date), done: !!x.done_at, doneAt: x.done_at,
        pri: prio.fromInt(x.priority), estimateH: x.estimate_h != null ? Number(x.estimate_h) : null };
      var cl = Array.isArray(x.checklist) ? x.checklist : [];
      if (cl.length) { it.checkDone = cl.filter(function (c) { return c && c.d; }).length; it.checkTotal = cl.length; it.progress = Math.round(it.checkDone / it.checkTotal * 100); }
      if (onlySelf) {   // 내용은 본인만
        it.todoStatus = x.status || 'todo'; it.waitingFor = x.waiting_for || ''; it.memo = x.memo || ''; it.dueTime = x.due_time || null;
        it.repeat = x.repeat || null; it.checklist = cl;
      }
      out.push(it);
    });
  })());

  if (want('mindmap')) jobs.push((async function () {
    // 보는 사람이 볼 수 있는 맵인지 (열기 가능) — 남의 것을 볼 때는 볼 수 있는 맵만
    var vis = mmVisible.visibleMapsSql(req, 3);
    var like = ids.map(function (id) { return '%' + id + '%'; });
    var r = await db.query(
      'SELECT m.id, m.title, m.doc, (' + vis.sql + ') AS can_open FROM mindmaps m ' +
      'WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND m.doc::text LIKE ANY($2)',
      [tid, like].concat(vis.params)
    );
    var wantId = {};
    ids.forEach(function (id) { wantId[id] = true; });
    r.rows.forEach(function (m) {
      if (!onlySelf && !m.can_open) return;
      var doc = typeof m.doc === 'string' ? JSON.parse(m.doc) : m.doc;
      ((doc && doc.sheets) || []).forEach(function (sh, si) {
        (function walk(n, path) {
          if (!n || typeof n !== 'object') return;
          if (n.assigneeId && wantId[n.assigneeId] && n.id !== (sh.root && sh.root.id)) {
            var p = parseInt(n.progress, 10);
            var done = !!n.done || p >= 100;
            if (!done || (doneWin && recent(n.doneAt, doneWin))) {
              out.push({ src: 'mindmap', id: m.id + ':' + n.id, userId: n.assigneeId, title: firstLine(n.text), ctx: m.title + (path ? ' › ' + path : ''),
                mapId: m.id, sheet: si, nodeId: n.id, due: ymd(n.dueDate), done: done, doneAt: done ? n.doneAt || null : null,
                progress: isNaN(p) ? null : p, pri: prio.fromMarkers(n.markers), mapOpen: !!m.can_open });
            }
          }
          var here = n === sh.root ? '' : firstLine(n.text, 24);
          (n.children || []).forEach(function (c) { walk(c, n === sh.root ? '' : here); });
        })(sh && sh.root, '');
      });
    });
  })());

  await Promise.all(jobs);
  out.forEach(function (it) {
    it.key = it.src + ':' + it.id + (ids.length > 1 ? ':' + it.userId : '');
    if (it.pri == null) it.pri = 3;
    it.urgent = it.pri === 1;
    // 남은 양 — 1 = 반나절(4시간). 예상 시간이 있으면 그만큼, 진행률이 있으면 그만큼 덜 셈 (0.1 아래로는 안 내림)
    var base = it.estimateH ? Math.max(0.25, it.estimateH / 4) : 1;
    var left = it.progress != null && it.progress > 0 ? Math.max(0, 100 - it.progress) / 100 : 1;
    it.weight = it.done ? 0 : Math.max(0.1, Math.round(base * left * 100) / 100);
  });
  return out;
}

/** 'YYYY-MM-DD' 두 날의 차이 (b - a, 일) */
function daysBetween(a, b) {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}
function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
/** 그 날이 든 주의 월요일 */
function mondayOf(d) {
  var t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  var w = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - w);
  return t.toISOString().slice(0, 10);
}

/**
 * 업무 부하 — 사람 × 주 칸. 열 = [지연, 이번 주, +1주 ...] + 마감 없음
 * @returns {{ weeks: string[], rows: { userId: { late:{n,w}, cells:[{n,w}], nodue:{n,w}, total:{n,w} } } }}
 */
function loadGrid(items, weeks, today) {
  today = today || kstToday();
  var mon0 = mondayOf(today);
  var cols = [];
  for (var i = 0; i < weeks; i++) {
    var t = new Date(Date.UTC(+mon0.slice(0, 4), +mon0.slice(5, 7) - 1, +mon0.slice(8, 10) + i * 7));
    cols.push(t.toISOString().slice(0, 10));
  }
  var rows = {};
  function cell() { return { n: 0, w: 0 }; }
  function add(c, it) { c.n++; c.w = Math.round((c.w + it.weight) * 10) / 10; }
  items.forEach(function (it) {
    if (it.done) return;
    var r = rows[it.userId] = rows[it.userId] || { late: cell(), cells: cols.map(cell), later: cell(), nodue: cell(), total: cell() };
    add(r.total, it);
    if (!it.due) return add(r.nodue, it);
    if (it.due < today) return add(r.late, it);
    var k = Math.floor(daysBetween(mon0, it.due) / 7);
    if (k < weeks) add(r.cells[k], it); else add(r.later, it);
  });
  return { weeks: cols, today: today, rows: rows };
}

module.exports = { collect: collect, loadGrid: loadGrid, mondayOf: mondayOf, kstToday: kstToday, daysBetween: daysBetween, ymd: ymd, DONE_DAYS: DONE_DAYS };
