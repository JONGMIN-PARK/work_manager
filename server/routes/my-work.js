/**
 * 내 업무 · 업무 부하 (v13.248) — 할 일 모으기는 lib/my-work
 *   GET    /api/my-work?userId=          할 일 목록 (최근 7일 안에 끝낸 것 포함)
 *   GET    /api/my-work/people           볼 수 있는 사람 (관리자 · 임원 = 전체, 팀장 = 같은 부서, 그 외 = 나)
 *   PUT    /api/my-work/done             { src, id, userId, done } — 원래 자리에서 완료/되돌리기
 *   POST   /api/my-work/todos            { title, dueDate } 개인 할 일
 *   PUT    /api/my-work/todos/:id        { title?, dueDate?, done? }
 *   DELETE /api/my-work/todos/:id        휴지통으로 (v13.268 — 비우기 전까지 보관)
 *   GET    /api/my-work/trash            휴지통 목록
 *   POST   /api/my-work/todos/:id/restore 되살리기
 *   DELETE /api/my-work/trash/:id        하나 영구 삭제 · DELETE /api/my-work/trash 비우기
 *   GET·POST /api/my-work/categories     내 칸 (없으면 기본 4칸을 만들어 줌) · PUT·DELETE /categories/:id
 *   PUT    /api/my-work/categories-order { ids } · POST /api/my-work/categories-reset 기본 4칸으로
 *   GET    /api/my-work/notes?date=      📝 그날 노트들 (v13.272 — ref '' = 그날 노트, 'ev:<일정 id>' = 회의 메모). 본인만
 *   PUT    /api/my-work/notes            { date, ref, body } — 빈 글이면 지움
 *   GET    /api/my-work/notes/find?q=    검색 (q 없으면 최근)
 *   GET    /api/my-work/meeting-brief?eventId=   회의 일정 → 회의록 요약 (안건 · 회의록 앞부분 · 내 액션). 회의 화면과 같은 권한
 *   GET    /api/my-work/load?weeks=&deptId=   업무 부하 (관리자 · 임원 · 팀장)
 *   PUT    /api/my-work/reassign         { src, id, fromUserId, toUserId } — 담당 바꾸기 (관리자 · 임원 · 팀장)
 *   GET    /api/my-work/events?userId=&from=&to=   내 일정 (만든 것 · 담당에 내 이름) — 달력 보기용 (v13.252)
 *   PUT    /api/my-work/due              { src, id, userId, due } — 달력에서 끌어 마감 바꾸기 (todo · mindmap · issue · action)
 *   GET    /api/my-work/feed             내 .ics 구독 주소 (없으면 null)
 *   POST   /api/my-work/feed             구독 주소 만들기 · 다시 만들기 (옛 주소는 끊김)
 *   DELETE /api/my-work/feed             구독 끄기
 *   PUT    /api/my-work/priority         { src, id, userId, priority 1~4 } — 중요도, 원래 자리에 반영 (v13.253)
 *   PUT    /api/my-work/mark             { key, focus?, category? } — ⭐ 오늘 집중 · 칸 고정 (어느 출처든, 내 표시)
 *   PUT    /api/my-work/order            { keys: [...] } — 직접 순서
 *   GET    /api/my-work/directory        같은 회사 활성 사용자 이름 (참석자 · 담당 고르기)
 *   GET    /api/my-work/projects         📁 내 프로젝트 + 연계 후보 (v13.273 — 본인만, GET / 에도 projs · projCands 로 같이)
 *   GET    /api/my-work/projects/pick?q= 연결할 프로젝트 관리 프로젝트 고르기 (볼 수 있는 것)
 *   POST   /api/my-work/projects         { title, startDate, endDate, color, icon, memo, linkProjectId? }
 *   PUT    /api/my-work/projects/:id     { title?, startDate?, endDate?, status?, color?, icon?, memo?, progress?, visible?, linkProjectId? (null = 연결 끊기) }
 *   DELETE /api/my-work/projects/:id     지우기 (되살리기 POST /projects/:id/restore) · PUT /projects-order { ids }
 *
 * 완료 처리 · 담당 바꾸기는 본인 또는 관리자(완료) / 관리자 · 임원 · 팀장(담당)만.
 * 마인드맵 주제는 누가 그 맵을 편집 중이면 바꾸지 않는다 (편집 잠금).
 */
var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var myWork = require('../lib/my-work');
var myEvents = require('../lib/my-events');
var prio = require('../lib/priority');
var repeatNext = require('../lib/todo-repeat').repeatNext;
var pa = require('../lib/project-access');
var myProj = require('../lib/my-projects');
var mwDone = require('../lib/my-work-done');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var LEAD_ROLES = ['admin', 'executive', 'manager'];
var DONE_SRC = mwDone.DONE_SRC;
var MOVE_SRC = ['mindmap', 'issue', 'action', 'dev', 'prestudy'];
var DUE_SRC = ['todo', 'mindmap', 'issue', 'action'];

function genId() { return 'todo-' + crypto.randomUUID().slice(0, 12); }
function isLead(req) { return LEAD_ROLES.indexOf(req.user.role) >= 0; }

var USER_COLS = "u.id, u.name, COALESCE(NULLIF(u.display_name,''), u.name) AS display_name, u.department_id, d.name AS department_name, u.role";

/** 내가 볼 수 있는 사람들 (활성) */
async function viewablePeople(req) {
  var params = [req.tenant.id];
  var cond = '';
  if (req.user.role === 'manager') {
    if (!req.user.departmentId) cond = ' AND u.id = $2', params.push(req.user.sub);
    else cond = ' AND (u.department_id = $2 OR u.id = $3)', params.push(req.user.departmentId, req.user.sub);
  } else if (!isLead(req)) {
    cond = ' AND u.id = $2'; params.push(req.user.sub);
  }
  var r = await db.query('SELECT ' + USER_COLS + " FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.tenant_id = $1 AND u.status = 'active'" + cond + ' ORDER BY u.name', params);
  return r.rows;
}

/** 대상 한 사람 — 볼 수 없으면 null */
async function targetUser(req, userId) {
  var id = userId || req.user.sub;
  var people = await viewablePeople(req);
  return people.filter(function (u) { return u.id === id; })[0] || null;
}

function toUser(u) { return { id: u.id, name: u.display_name, dept: u.department_name || '', departmentId: u.department_id || null }; }

/** 모을 대상 — 나면 토큰 정보로 바로 (사람 목록 쿼리를 기다리지 않음, v13.270), 남이면 볼 수 있는지 확인 */
function subjectOf(req, userId) {
  var id = userId || req.user.sub;
  if (id === req.user.sub) return Promise.resolve({ id: id, name: req.user.name || '' });
  return targetUser(req, id);
}

// GET /api/my-work/people
router.get('/people', async function (req, res) {
  try {
    var people = await viewablePeople(req);
    res.json({ data: people.map(toUser), canLoad: isLead(req) });
  } catch (e) { httpErr.serverError(res, '[my-work/people]', e); }
});

// GET /api/my-work?userId=
router.get('/', async function (req, res) {
  try {
    // v13.258: 표시(⭐ 집중 · 순서)는 볼 사람 id 만 알면 되므로 권한 확인 · 모으기와 동시에 (예전엔 셋을 차례로)
    var wantId = req.query.userId || req.user.sub;
    var mkP = db.query('SELECT item_key, focus_date, sort_order, category_id, project_id FROM my_work_marks WHERE user_id = $1 AND tenant_id = $2', [wantId, req.tenant.id]);
    mkP.catch(function () {});
    var catP = categoriesOf(req, wantId, wantId === req.user.sub);
    catP.catch(function () {});
    var trP = wantId === req.user.sub ? db.query('SELECT COUNT(*)::int AS n FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NOT NULL', [req.tenant.id, req.user.sub]) : null;
    if (trP) trP.catch(function () {});
    // 📝 노트 있는 날 (타임라인 · 달력 점) — 본인만 (v13.272)
    var ndP = wantId === req.user.sub ? db.query("SELECT DISTINCT note_date FROM my_notes WHERE tenant_id = $1 AND user_id = $2 AND body <> ''", [req.tenant.id, req.user.sub]) : null;
    if (ndP) ndP.catch(function () {});
    // 📁 내 프로젝트 — 본인만 (v13.273)
    var pjP = wantId === req.user.sub ? myProj.list(req) : null;
    if (pjP) pjP.catch(function () {});
    // v13.270: 내 것이면 사람 확인을 기다리지 않고 바로 모으기 시작 (한 번 왕복 줄임)
    var self = wantId === req.user.sub;
    var uP = targetUser(req, req.query.userId);
    var itemsP = self ? myWork.collect(req, [{ id: req.user.sub, name: req.user.name || '' }], { done: true }) : null;
    if (itemsP) itemsP.catch(function () {});
    var u = await uP;
    if (!u && self) u = { id: req.user.sub, name: req.user.name, display_name: req.user.name, department_id: req.user.departmentId || null };
    if (!u) return httpErr.sendError(res, 403, 'FORBIDDEN', '이 사람의 업무를 볼 권한이 없습니다.');
    // 이름을 바꾼 뒤 아직 예전 토큰이면 (이슈 · 회의 담당을 이름으로도 찾으므로) 새 이름으로 다시
    var items = itemsP && u.name === (req.user.name || '') ? await itemsP : await myWork.collect(req, [u], { done: true });
    var canDone = self || req.user.role === 'admin';
    items.forEach(function (it) {
      it.canDone = canDone && DONE_SRC.indexOf(it.src) >= 0 && (it.src !== 'todo' || self);
      it.canPri = canDone && prio.SRC.indexOf(it.src) >= 0 && (it.src !== 'todo' || self);
    });
    // 사전검토 · 마일스톤 (v13.269) — 완료는 원래 화면 저장 API 로 (클라가 PUT /api/prestudies · /api/milestones).
    //   사전검토 = 담당 본인 · 관리자 (확정 · 보류 · 드롭 중 고름), 마일스톤 = 그 프로젝트 편집 권한 (모을 때 같이 계산 — canEdit)
    items.forEach(function (it) {
      if (it.src === 'prestudy') it.canDone = canDone;
      if (it.src === 'milestone') { it.canDone = canDone && !!it.canEdit; delete it.canEdit; }
    });
    // ⭐ 오늘 집중 · 직접 순서 — 그 사람 표시 (끝난 일의 표시는 정리)
    var mk = await mkP;
    var byKey = {};
    mk.rows.forEach(function (m) { byKey[m.item_key] = m; });
    items.forEach(function (it) {
      var m = byKey[it.src + ':' + it.id];
      if (!m) return;
      if (m.focus_date && !it.done) it.focus = m.focus_date;
      if (m.sort_order != null) it.order = m.sort_order;
      if (m.category_id) it.cat = m.category_id;
      if (m.project_id) it.proj = m.project_id;
    });
    var pj = pjP ? await pjP : null;
    res.json({ data: items, user: toUser(u), today: myWork.kstToday(), self: self, cats: await catP, trashN: trP ? (await trP).rows[0].n : 0,
      noteDays: ndP ? (await ndP).rows.map(function (x) { return x.note_date; }) : [],
      projs: pj ? pj.data : [], projCands: pj ? pj.cands : [] });
  } catch (e) { httpErr.serverError(res, '[my-work/list]', e); }
});

/* ═══ 완료 처리 — lib/my-work-done (텔레그램과 같이 씀, v13.274) ═══ */
/** 맵 주제 하나 고치기 — 안 되면 오류를 보내고 false */
async function editMapNode(req, res, mapId, nodeId, fn) {
  var e = await mwDone.editMapNode(req, mapId, nodeId, fn);
  if (e) { httpErr.sendError(res, e[0], e[1], e[2]); return false; }
  return true;
}
var splitMapId = mwDone.splitMapId;

/** 남의 업무를 고칠 때 공통 확인 — 본인 또는 관리자, 개인 할 일은 본인만 (v13.275 — /done · /due · /priority 세 곳에 같은 줄이 있던 것)
 *  opt.inList: 그 사람 담당 목록에 정말 있는지도 확인. 되돌림: { userId, u } 또는 null(이미 응답함) */
async function actingSubject(req, res, b, verb, opt) {
  var userId = b.userId || req.user.sub;
  if (userId !== req.user.sub && req.user.role !== 'admin') { httpErr.sendError(res, 403, 'FORBIDDEN', '본인 업무만 ' + verb + ' 수 있습니다.'); return null; }
  if (b.src === 'todo' && userId !== req.user.sub) { httpErr.sendError(res, 403, 'FORBIDDEN'); return null; }
  var u = b.src === 'todo' && !(opt && opt.inList) ? null : await subjectOf(req, userId);
  if (b.src !== 'todo' && !u) { httpErr.sendError(res, 403, 'FORBIDDEN'); return null; }
  if (opt && opt.inList) {
    if (!u) { httpErr.sendError(res, 403, 'FORBIDDEN'); return null; }
    var items = await myWork.collect(req, [u], { done: true, sources: [b.src] });
    if (!items.some(function (x) { return x.id === b.id; })) { httpErr.sendError(res, 404, 'NOT_FOUND', '담당 업무에서 찾을 수 없습니다.'); return null; }
  }
  return { userId: userId, u: u };
}

// PUT /api/my-work/done { src, id, userId, done }
router.put('/done', async function (req, res) {
  try {
    var b = req.body || {};
    var done = !!b.done;
    if (DONE_SRC.indexOf(b.src) < 0 || !b.id) return httpErr.sendError(res, 400, 'VALIDATION', '완료로 바꿀 수 없는 항목입니다.');
    var who = await actingSubject(req, res, b, '완료로 바꿀');
    if (!who) return;
    var r = await mwDone.setDone(req, b.src, b.id, who.u, done);
    if (r.err) return httpErr.sendError(res, r.err[0], r.err[1], r.err[2]);
    res.json({ data: r.data });
  } catch (e) { httpErr.serverError(res, '[my-work/done]', e); }
});

/* ═══ 개인 할 일 ═══ */
function cleanDue(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
function cleanTime(v) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  return m && +m[1] <= 23 && +m[2] <= 59 ? (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2] : null;
}
var TODO_STATUS = ['todo', 'doing', 'waiting'];
var TODO_REPEAT = ['daily', 'weekdays', 'weekly', 'monthly'];
function cleanChecklist(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).map(function (c, i) {
    var t = String((c && c.t) || '').trim().slice(0, 200);
    return t ? { id: String((c && c.id) || ('c' + Date.now().toString(36) + i)).slice(0, 30), t: t, d: !!(c && c.d) } : null;
  }).filter(Boolean);
}
/** 본문 → 고칠 칸들 [[sql, value]] — 잘못된 값은 VALIDATION 오류 문자열 */
function todoFields(b) {
  var f = [];
  if (b.title !== undefined) {
    var t = String(b.title || '').trim().slice(0, 500);
    if (!t) return '할 일을 입력하세요.';
    f.push(['title', t]);
  }
  if (b.dueDate !== undefined) f.push(['due_date', cleanDue(b.dueDate)]);
  if (b.startDate !== undefined) f.push(['start_date', cleanDue(b.startDate)]);   // v13.271 타임라인 막대
  if (b.dueTime !== undefined) f.push(['due_time', cleanTime(b.dueTime)]);
  if (b.priority !== undefined) {
    if (!prio.clamp(b.priority)) return '중요도는 1~4 입니다.';
    f.push(['priority', prio.clamp(b.priority)]);
  }
  if (b.status !== undefined) {
    if (TODO_STATUS.indexOf(b.status) < 0) return '상태 값이 맞지 않습니다.';
    f.push(['status', b.status]);
  }
  if (b.waitingFor !== undefined) f.push(['waiting_for', String(b.waitingFor || '').trim().slice(0, 100) || null]);
  if (b.memo !== undefined) f.push(['memo', String(b.memo || '').slice(0, 5000) || null]);
  if (b.repeat !== undefined) {
    if (b.repeat && TODO_REPEAT.indexOf(b.repeat) < 0) return '반복 값이 맞지 않습니다.';
    f.push(['repeat', b.repeat || null]);
  }
  if (b.estimateH !== undefined) {
    var h = b.estimateH === null || b.estimateH === '' ? null : Number(b.estimateH);
    if (h !== null && (isNaN(h) || h < 0 || h > 999)) return '예상 시간이 맞지 않습니다.';
    f.push(['estimate_h', h ? Math.round(h * 10) / 10 : null]);
  }
  if (b.checklist !== undefined) f.push(['checklist', JSON.stringify(cleanChecklist(b.checklist))]);
  return f;
}

router.post('/todos', async function (req, res) {
  try {
    var b = req.body || {};
    if (!String(b.title || '').trim()) return httpErr.sendError(res, 400, 'VALIDATION', '할 일을 입력하세요.');
    var f = todoFields(b);
    if (typeof f === 'string') return httpErr.sendError(res, 400, 'VALIDATION', f);
    var cols = ['id', 'tenant_id', 'user_id'], vals = [genId(), req.tenant.id, req.user.sub];
    f.forEach(function (x) { cols.push(x[0]); vals.push(x[1]); });
    // 300개 한도 확인과 넣기를 한 문장으로 (v13.270 — 예전엔 세고 나서 넣어 두 번 왕복)
    var r = await db.query('INSERT INTO my_todos (' + cols.join(', ') + ') SELECT ' + vals.map(function (_, i) { return '$' + (i + 1); }).join(',') +
      ' WHERE (SELECT COUNT(*) FROM my_todos WHERE tenant_id = $2 AND user_id = $3 AND done_at IS NULL AND deleted_at IS NULL) < 300 RETURNING *', vals);
    if (!r.rows.length) return httpErr.sendError(res, 400, 'VALIDATION', '끝나지 않은 개인 할 일은 300개까지입니다.');
    // 📁 내 프로젝트에 바로 (v13.273) — 내 것일 때만, 아니면 그냥 할 일로
    if (b.myProjectId && await myProj.owns(req, b.myProjectId)) {
      await db.query('INSERT INTO my_work_marks (user_id, item_key, tenant_id, project_id) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, item_key) DO UPDATE SET project_id = EXCLUDED.project_id, updated_at = now()',
        [req.user.sub, 'todo:' + r.rows[0].id, req.tenant.id, String(b.myProjectId)]);
      r.rows[0].my_project_id = String(b.myProjectId);
    }
    res.status(201).json({ data: r.rows[0] });
  } catch (e) { httpErr.serverError(res, '[my-work/todo-create]', e); }
});

router.put('/todos/:id', async function (req, res) {
  try {
    var b = req.body || {};
    var f = todoFields(b);
    if (typeof f === 'string') return httpErr.sendError(res, 400, 'VALIDATION', f);
    var sets = [], params = [];
    f.forEach(function (x) { params.push(x[1]); sets.push(x[0] + ' = $' + params.length); });
    if (b.done !== undefined) sets.push(b.done ? 'done_at = COALESCE(done_at, now())' : 'done_at = NULL');
    if (!sets.length) return httpErr.sendError(res, 400, 'VALIDATION', '바꿀 내용이 없습니다.');
    params.push(req.params.id, req.tenant.id, req.user.sub);
    var r = await db.query('UPDATE my_todos SET ' + sets.join(', ') + ', updated_at = now() WHERE id = $' + (params.length - 2) + ' AND tenant_id = $' + (params.length - 1) + ' AND user_id = $' + params.length + ' AND deleted_at IS NULL RETURNING *', params);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var nx = b.done && r.rows[0].repeat ? await repeatNext(req, req.params.id, r.rows[0]) : null;
    res.json({ data: r.rows[0], next: nx ? nx.id : null, nextRow: nx });
  } catch (e) { httpErr.serverError(res, '[my-work/todo-update]', e); }
});

// 지우기 = 휴지통으로 (v13.268). 비우기 전까지 보관
router.delete('/todos/:id', async function (req, res) {
  try {
    var r = await db.query('UPDATE my_todos SET deleted_at = now(), updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL', [req.params.id, req.tenant.id, req.user.sub]);
    if (!r.rowCount) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: { id: req.params.id } });
  } catch (e) { httpErr.serverError(res, '[my-work/todo-delete]', e); }
});

/* ═══ 휴지통 (v13.268) ═══ */
router.get('/trash', async function (req, res) {
  try {
    var r = await db.query('SELECT id, title, due_date, due_time, priority, done_at, deleted_at, memo, checklist FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1000',
      [req.tenant.id, req.user.sub]);
    res.json({ data: r.rows });
  } catch (e) { httpErr.serverError(res, '[my-work/trash]', e); }
});

router.post('/todos/:id/restore', async function (req, res) {
  try {
    var r = await db.query('UPDATE my_todos SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NOT NULL RETURNING *', [req.params.id, req.tenant.id, req.user.sub]);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: r.rows[0] });
  } catch (e) { httpErr.serverError(res, '[my-work/todo-restore]', e); }
});

/** 영구 삭제 — 칸 고정 · 집중 표시도 같이 정리 */
async function purgeTodos(req, id) {
  var params = [req.tenant.id, req.user.sub];
  if (id) params.push(id);
  var r = await db.query('DELETE FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NOT NULL' + (id ? ' AND id = $3' : '') + ' RETURNING id', params);
  var keys = r.rows.map(function (x) { return 'todo:' + x.id; });
  if (keys.length) await db.query('DELETE FROM my_work_marks WHERE user_id = $1 AND tenant_id = $2 AND item_key = ANY($3)', [req.user.sub, req.tenant.id, keys]);
  return r.rows.length;
}
router.delete('/trash/:id', async function (req, res) {
  try {
    var n = await purgeTodos(req, req.params.id);
    if (!n) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: { n: n } });
  } catch (e) { httpErr.serverError(res, '[my-work/trash-purge]', e); }
});
router.delete('/trash', async function (req, res) {
  try {
    res.json({ data: { n: await purgeTodos(req, null) } });
  } catch (e) { httpErr.serverError(res, '[my-work/trash-empty]', e); }
});

/* ═══ 📝 노트 (v13.272) — 본인만 ═══ */
var NOTE_MAX = 20000;
function cleanRef(v) { var s = String(v == null ? '' : v); return s === '' || /^ev:[^\s]{1,110}$/.test(s) ? s : null; }

router.get('/notes', async function (req, res) {
  try {
    var d = cleanDue(req.query.date);
    if (!d) return httpErr.sendError(res, 400, 'VALIDATION', '날짜가 맞지 않습니다.');
    var r = await db.query('SELECT ref, body, updated_at FROM my_notes WHERE tenant_id = $1 AND user_id = $2 AND note_date = $3', [req.tenant.id, req.user.sub, d]);
    res.json({ data: { date: d, notes: r.rows.map(function (x) { return { ref: x.ref, body: x.body, updatedAt: x.updated_at }; }) } });
  } catch (e) { httpErr.serverError(res, '[my-work/notes]', e); }
});

router.put('/notes', async function (req, res) {
  try {
    var b = req.body || {};
    var d = cleanDue(b.date), ref = cleanRef(b.ref);
    if (!d || ref == null) return httpErr.sendError(res, 400, 'VALIDATION', '날짜 · 회의가 맞지 않습니다.');
    var body = String(b.body == null ? '' : b.body);
    if (body.length > NOTE_MAX) return httpErr.sendError(res, 400, 'VALIDATION', '노트는 ' + NOTE_MAX + '자까지입니다.');
    if (!body.trim()) {
      await db.query('DELETE FROM my_notes WHERE user_id = $1 AND note_date = $2 AND ref = $3 AND tenant_id = $4', [req.user.sub, d, ref, req.tenant.id]);
      return res.json({ data: { date: d, ref: ref, updatedAt: null, empty: true } });
    }
    var r = await db.query(
      'INSERT INTO my_notes (user_id, note_date, ref, tenant_id, body) VALUES ($1, $2, $3, $4, $5) ' +
      'ON CONFLICT (user_id, note_date, ref) DO UPDATE SET body = EXCLUDED.body, updated_at = now() RETURNING updated_at',
      [req.user.sub, d, ref, req.tenant.id, body]);
    res.json({ data: { date: d, ref: ref, updatedAt: r.rows[0].updated_at } });
  } catch (e) { httpErr.serverError(res, '[my-work/notes-put]', e); }
});

// GET /notes/find?q= — 맞은 줄 조각 (q 없으면 최근 고친 것)
router.get('/notes/find', async function (req, res) {
  try {
    var q = String(req.query.q || '').trim().slice(0, 100);
    var params = [req.tenant.id, req.user.sub], cond = '';
    if (q) { params.push('%' + q.replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%'); cond = ' AND body ILIKE $3'; }
    var r = await db.query("SELECT note_date, ref, body, updated_at FROM my_notes WHERE tenant_id = $1 AND user_id = $2 AND body <> ''" + cond + ' ORDER BY ' + (q ? 'note_date DESC' : 'updated_at DESC') + ' LIMIT 30', params);
    var ql = q.toLowerCase();
    res.json({ data: r.rows.map(function (x) {
      var lines = x.body.split('\n').map(function (l) { return l.replace(/⟦[^⟧]*⟧/g, '').replace(/^- \[[ x]\] /, '').trim(); }).filter(Boolean);
      var hit = ql ? lines.filter(function (l) { return l.toLowerCase().indexOf(ql) >= 0; }) : lines;
      return { date: x.note_date, ref: x.ref, snip: (hit[0] || lines[0] || '').slice(0, 120), lines: lines.length, updatedAt: x.updated_at };
    }) });
  } catch (e) { httpErr.serverError(res, '[my-work/notes-find]', e); }
});

// GET /meeting-brief?eventId= — 회의 일정 → 회의록 요약. 권한은 회의 화면과 같게 (프로젝트 읽기 · 프로젝트 없으면 만든 사람)
router.get('/meeting-brief', async function (req, res) {
  try {
    var ev = String(req.query.eventId || '').slice(0, 100);
    if (!ev) return httpErr.sendError(res, 400, 'VALIDATION');
    var r = await db.query('SELECT m.id, m.title, m.meet_date, m.project_id, m.agenda, m.minutes, m.created_by, p.name AS project_name FROM meetings m ' +
      'LEFT JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id WHERE m.event_id = $1 AND m.tenant_id = $2 LIMIT 1', [ev, req.tenant.id]);
    var m = r.rows[0];
    if (!m) return res.json({ data: null });   // 회의록 없는 일정
    var ok = m.project_id ? await pa.canReadById(req, m.project_id) : m.created_by === req.user.sub;
    if (!ok) return res.json({ data: { locked: true, title: m.title } });
    var acts = await db.query('SELECT title, due_date, status, assignee_id, assignee_name FROM meeting_action_items WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY sort_order, created_at', [m.id, req.tenant.id]);
    var agenda = (Array.isArray(m.agenda) ? m.agenda : []).map(function (g) {
      return typeof g === 'string' ? { text: g, done: false, result: '' } : { text: String((g && g.text) || ''), done: !!(g && g.done), result: String((g && g.result) || '') };
    }).filter(function (g) { return g.text; });
    var me = req.user.sub, myName = req.user.name || '';
    res.json({ data: { meetingId: m.id, title: m.title, date: m.meet_date, projectId: m.project_id, projectName: m.project_name || '',
      agenda: agenda.slice(0, 8), agendaN: agenda.length, minutes: String(m.minutes || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
      actionN: acts.rows.length,
      myActions: acts.rows.filter(function (a) { return a.assignee_id === me || (!a.assignee_id && myName && a.assignee_name === myName); })
        .map(function (a) { return { title: a.title, due: a.due_date, done: a.status === 'done' }; }) } });
  } catch (e) { httpErr.serverError(res, '[my-work/meeting-brief]', e); }
});

/* ═══ 📁 내 프로젝트 (v13.273) — 본인만 ═══ */
router.get('/projects', async function (req, res) {
  try { res.json(await myProj.list(req)); } catch (e) { httpErr.serverError(res, '[my-work/projects]', e); }
});

// 연결할 프로젝트 고르기 — 볼 수 있는 프로젝트 관리 프로젝트 (진행 중 먼저)
router.get('/projects/pick', async function (req, res) {
  try {
    var q = String(req.query.q || '').trim().slice(0, 100);
    var vis = pa.visibleProjectsSql(req, 'p', 2);
    var params = [req.tenant.id].concat(vis.params), cond = '';
    if (q) { params.push('%' + q.replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%'); cond = ' AND (p.name ILIKE $' + params.length + ' OR p.order_no ILIKE $' + params.length + ')'; }
    var r = await db.query('SELECT p.id, p.name, p.order_no, p.start_date, p.end_date, p.status FROM projects p WHERE p.tenant_id = $1 AND ' + vis.sql + cond +
      " ORDER BY (COALESCE(p.status, '') IN ('done', 'completed', 'cancelled')), p.sort_order ASC NULLS LAST, p.created_at DESC LIMIT 100", params);
    res.json({ data: r.rows.map(function (p) { return { id: p.id, name: p.name, orderNo: p.order_no || '', start: p.start_date || null, end: p.end_date || null, status: p.status || '' }; }) });
  } catch (e) { httpErr.serverError(res, '[my-work/projects-pick]', e); }
});

/** 연결 확인 — 볼 수 있어야 함 (아니면 응답 보내고 null) */
async function linkTarget(req, res, pid) {
  var r = await db.query('SELECT id, name, start_date, end_date FROM projects WHERE id = $1 AND tenant_id = $2', [String(pid), req.tenant.id]);
  if (!r.rows.length) { httpErr.sendError(res, 404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.'); return null; }
  if (!(await pa.canReadById(req, r.rows[0].id))) { httpErr.sendError(res, 403, 'FORBIDDEN', '이 프로젝트를 볼 권한이 없습니다.'); return null; }
  return r.rows[0];
}
function dupLink(e) { return e && e.code === '23505'; }

router.post('/projects', async function (req, res) {
  try {
    var b = req.body || {};
    var lp = null;
    if (b.linkProjectId) { lp = await linkTarget(req, res, b.linkProjectId); if (!lp) return; }
    var f = myProj.fields(Object.assign({}, b, { title: b.title || (lp ? lp.name : '') }));
    if (typeof f === 'string') return httpErr.sendError(res, 400, 'VALIDATION', f);
    var cols = ['id', 'tenant_id', 'user_id', 'link_project_id'], vals = [myProj.genId(), req.tenant.id, req.user.sub, lp ? lp.id : null];
    f.forEach(function (x) { cols.push(x[0]); vals.push(x[1]); });
    // 개수 한도 · 맨 뒤 순서를 넣기와 한 문장으로 (INSERT…SELECT 는 파라미터 타입 캐스트 필요)
    var casts = { id: '::varchar', tenant_id: '::uuid', user_id: '::uuid', link_project_id: '::varchar', title: '::varchar', start_date: '::varchar', end_date: '::varchar',
      status: '::varchar', color: '::varchar', icon: '::varchar', memo: '::text', progress: '::smallint', visible: '::boolean' };
    var r = await db.query('INSERT INTO my_projects (' + cols.join(', ') + ', sort_order) SELECT ' + cols.map(function (c, i) { return '$' + (i + 1) + (casts[c] || ''); }).join(',') +
      ', COALESCE((SELECT MAX(sort_order) + 1 FROM my_projects WHERE tenant_id = $2::uuid AND user_id = $3::uuid AND deleted_at IS NULL), 0)' +
      ' WHERE (SELECT COUNT(*) FROM my_projects WHERE tenant_id = $2::uuid AND user_id = $3::uuid AND deleted_at IS NULL) < ' + myProj.MAX + ' RETURNING id', vals);
    if (!r.rows.length) return httpErr.sendError(res, 400, 'VALIDATION', '내 프로젝트는 ' + myProj.MAX + '개까지입니다. 끝난 것을 지워 주세요.');
    res.status(201).json({ data: await myProj.one(req, r.rows[0].id) });
  } catch (e) {
    if (dupLink(e)) return httpErr.sendError(res, 409, 'CONFLICT', '이미 연결한 프로젝트입니다.');
    httpErr.serverError(res, '[my-work/project-create]', e);
  }
});

router.put('/projects/:id', async function (req, res) {
  try {
    var b = req.body || {};
    var f = myProj.fields(b);
    if (typeof f === 'string') return httpErr.sendError(res, 400, 'VALIDATION', f);
    if (b.linkProjectId !== undefined) {
      if (b.linkProjectId) { var lp = await linkTarget(req, res, b.linkProjectId); if (!lp) return; f.push(['link_project_id', lp.id]); }
      else f.push(['link_project_id', null]);
    }
    if (!f.length) return httpErr.sendError(res, 400, 'VALIDATION', '바꿀 내용이 없습니다.');
    var params = f.map(function (x) { return x[1]; });
    var sets = f.map(function (x, i) { return x[0] + ' = $' + (i + 1); });
    params.push(req.params.id, req.tenant.id, req.user.sub);
    var n = params.length;
    var r = await db.query('UPDATE my_projects SET ' + sets.join(', ') + ', updated_at = now() WHERE id = $' + (n - 2) + ' AND tenant_id = $' + (n - 1) + ' AND user_id = $' + n + ' AND deleted_at IS NULL RETURNING id, start_date, end_date', params);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var x = r.rows[0];
    if (x.start_date && x.end_date && x.start_date > x.end_date) await db.query('UPDATE my_projects SET end_date = start_date WHERE id = $1 AND tenant_id = $2', [x.id, req.tenant.id]);
    res.json({ data: await myProj.one(req, req.params.id) });
  } catch (e) {
    if (dupLink(e)) return httpErr.sendError(res, 409, 'CONFLICT', '이미 다른 내 프로젝트에 연결한 프로젝트입니다.');
    httpErr.serverError(res, '[my-work/project-update]', e);
  }
});

// 지우기 — 소속 표시는 남겨 둠 (되살리면 그대로). 항목 자체는 그대로
router.delete('/projects/:id', async function (req, res) {
  try {
    var r = await db.query('UPDATE my_projects SET deleted_at = now(), updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NULL', [req.params.id, req.tenant.id, req.user.sub]);
    if (!r.rowCount) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: { id: req.params.id } });
  } catch (e) { httpErr.serverError(res, '[my-work/project-delete]', e); }
});

router.post('/projects/:id/restore', async function (req, res) {
  try {
    var r = await db.query('UPDATE my_projects SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND deleted_at IS NOT NULL RETURNING id', [req.params.id, req.tenant.id, req.user.sub]);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: await myProj.one(req, req.params.id) });
  } catch (e) {
    if (dupLink(e)) return httpErr.sendError(res, 409, 'CONFLICT', '그 프로젝트는 다른 내 프로젝트에 이미 연결되어 있어 되살릴 수 없습니다.');
    httpErr.serverError(res, '[my-work/project-restore]', e);
  }
});

router.put('/projects-order', async function (req, res) {
  try {
    var ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > myProj.MAX) return httpErr.sendError(res, 400, 'VALIDATION', '순서가 맞지 않습니다.');
    await db.query('UPDATE my_projects m SET sort_order = (t.o - 1)::int FROM unnest($1::text[]) WITH ORDINALITY AS t(k, o) WHERE m.id = t.k AND m.tenant_id = $2 AND m.user_id = $3',
      [ids.map(String), req.tenant.id, req.user.sub]);
    res.json({ data: { ids: ids } });
  } catch (e) { httpErr.serverError(res, '[my-work/project-order]', e); }
});

/* ═══ 내 칸 — 카테고리 (v13.268) ═══ */
var DEFAULT_CATS = [
  { name: '지금 하기', icon: '🔥', color: 'red', rule: 1 },
  { name: '계획하기', icon: '📅', color: 'blue', rule: 2 },
  { name: '빨리 끝내기 · 맡기기', icon: '⚡', color: 'amber', rule: 3 },
  { name: '나중에', icon: '🗂', color: 'slate', rule: 4 }
];
var CAT_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink', 'slate'];
var MAX_CATS = 12;
function genCatId() { return 'cat-' + crypto.randomUUID().slice(0, 12); }
function catOut(c) { return { id: c.id, name: c.name, icon: c.icon || '', color: c.color || 'slate', rule: c.rule || null, order: c.sort_order }; }
/** 그 사람 칸 — 본인이 처음 보면 기본 4칸을 만들어 둠. 남의 것은 없으면 기본 모양만 (저장 안 함) */
async function categoriesOf(req, userId, seed) {
  var q = function () { return db.query('SELECT * FROM my_work_categories WHERE tenant_id = $1 AND user_id = $2 ORDER BY sort_order, created_at', [req.tenant.id, userId]); };
  var r = await q();
  if (!r.rows.length && seed) {
    // 처음 두 요청이 겹쳐도 한 벌만 — 기본 칸 id 를 사람마다 정해 두고 겹치면 건너뜀
    var vals = [], params = [req.tenant.id, userId];
    DEFAULT_CATS.forEach(function (d, i) {
      params.push('catd-' + d.rule + '-' + userId, d.name, d.icon, d.color, d.rule, i);
      var b = params.length;
      vals.push('($' + (b - 5) + ', $1, $2, $' + (b - 4) + ', $' + (b - 3) + ', $' + (b - 2) + ', $' + (b - 1) + ', $' + b + ')');
    });
    await db.query('INSERT INTO my_work_categories (id, tenant_id, user_id, name, icon, color, rule, sort_order) VALUES ' + vals.join(', ') + ' ON CONFLICT (id) DO NOTHING', params);
    r = await q();
  }
  if (!r.rows.length) return DEFAULT_CATS.map(function (d, i) { return { id: 'catd-' + d.rule + '-' + userId, name: d.name, icon: d.icon, color: d.color, rule: d.rule, order: i }; });
  return r.rows.map(catOut);
}
function catFields(b) {
  var f = [];
  if (b.name !== undefined) {
    var n = String(b.name || '').trim().slice(0, 40);
    if (!n) return '칸 이름을 적어 주세요.';
    f.push(['name', n]);
  }
  if (b.icon !== undefined) f.push(['icon', String(b.icon || '').trim().slice(0, 16) || null]);
  if (b.color !== undefined) f.push(['color', CAT_COLORS.indexOf(b.color) >= 0 ? b.color : 'slate']);
  return f;
}

router.get('/categories', async function (req, res) {
  try { res.json({ data: await categoriesOf(req, req.user.sub, true) }); } catch (e) { httpErr.serverError(res, '[my-work/cats]', e); }
});

router.post('/categories', async function (req, res) {
  try {
    var b = req.body || {};
    var f = catFields(Object.assign({}, b, { name: b.name || '' }));
    if (typeof f === 'string') return httpErr.sendError(res, 400, 'VALIDATION', f);
    var cur = await categoriesOf(req, req.user.sub, true);
    if (cur.length >= MAX_CATS) return httpErr.sendError(res, 400, 'VALIDATION', '칸은 ' + MAX_CATS + '개까지 만들 수 있습니다.');
    var cols = ['id', 'tenant_id', 'user_id', 'sort_order'];
    var vals = [genCatId(), req.tenant.id, req.user.sub, cur.reduce(function (m, c) { return Math.max(m, c.order); }, -1) + 1];
    f.forEach(function (x) { cols.push(x[0]); vals.push(x[1]); });
    var r = await db.query('INSERT INTO my_work_categories (' + cols.join(', ') + ') VALUES (' + vals.map(function (_, i) { return '$' + (i + 1); }).join(',') + ') RETURNING *', vals);
    res.status(201).json({ data: catOut(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[my-work/cat-create]', e); }
});

router.put('/categories/:id', async function (req, res) {
  try {
    var f = catFields(req.body || {});
    if (typeof f === 'string') return httpErr.sendError(res, 400, 'VALIDATION', f);
    if (!f.length) return httpErr.sendError(res, 400, 'VALIDATION', '바꿀 내용이 없습니다.');
    var params = f.map(function (x) { return x[1]; });
    var sets = f.map(function (x, i) { return x[0] + ' = $' + (i + 1); });
    params.push(req.params.id, req.tenant.id, req.user.sub);
    var r = await db.query('UPDATE my_work_categories SET ' + sets.join(', ') + ' WHERE id = $' + (params.length - 2) + ' AND tenant_id = $' + (params.length - 1) + ' AND user_id = $' + params.length + ' RETURNING *', params);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: catOut(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[my-work/cat-update]', e); }
});

// 칸 지우기 — 들어 있던 항목은 고정이 풀려 자동 분류로 (항목은 그대로)
router.delete('/categories/:id', async function (req, res) {
  try {
    var r = await db.query('DELETE FROM my_work_categories WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [req.params.id, req.tenant.id, req.user.sub]);
    if (!r.rowCount) return httpErr.sendError(res, 404, 'NOT_FOUND');
    await db.query('UPDATE my_work_marks SET category_id = NULL, updated_at = now() WHERE user_id = $1 AND tenant_id = $2 AND category_id = $3', [req.user.sub, req.tenant.id, req.params.id]);
    res.json({ data: { id: req.params.id } });
  } catch (e) { httpErr.serverError(res, '[my-work/cat-delete]', e); }
});

router.put('/categories-order', async function (req, res) {
  try {
    var ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_CATS) return httpErr.sendError(res, 400, 'VALIDATION', '순서가 맞지 않습니다.');
    await db.query('UPDATE my_work_categories c SET sort_order = (t.o - 1)::int FROM unnest($1::text[]) WITH ORDINALITY AS t(k, o) WHERE c.id = t.k AND c.tenant_id = $2 AND c.user_id = $3',
      [ids.map(String), req.tenant.id, req.user.sub]);
    res.json({ data: await categoriesOf(req, req.user.sub, false) });
  } catch (e) { httpErr.serverError(res, '[my-work/cat-order]', e); }
});

router.post('/categories-reset', async function (req, res) {
  try {
    await db.query('DELETE FROM my_work_categories WHERE tenant_id = $1 AND user_id = $2', [req.tenant.id, req.user.sub]);
    await db.query('UPDATE my_work_marks SET category_id = NULL, updated_at = now() WHERE user_id = $1 AND tenant_id = $2 AND category_id IS NOT NULL', [req.user.sub, req.tenant.id]);
    res.json({ data: await categoriesOf(req, req.user.sub, true) });
  } catch (e) { httpErr.serverError(res, '[my-work/cat-reset]', e); }
});

/* ═══ 업무 부하 ═══ */
// GET /api/my-work/load?weeks=8&deptId=
router.get('/load', async function (req, res) {
  try {
    if (!isLead(req)) return httpErr.sendError(res, 403, 'FORBIDDEN', '관리자 · 임원 · 팀장만 볼 수 있습니다.');
    var weeks = Math.max(2, Math.min(12, parseInt(req.query.weeks, 10) || 8));
    var people = await viewablePeople(req);
    if (req.query.deptId) people = people.filter(function (u) { return u.department_id === req.query.deptId; });
    // v13.258: 주 칸은 오늘만으로 정해지므로 휴가 조회를 모으기와 동시에
    var w0 = myWork.loadGrid([], weeks).weeks[0];
    var got = await Promise.all([myWork.collect(req, people, { load: true }), leaveDays(req, people, w0, myEvents.addDays(w0, weeks * 7 - 1))]);
    var items = got[0], leaves = got[1];
    var grid = myWork.loadGrid(items, weeks);
    // 칸을 누르면 볼 목록 — 개인 할 일은 제목 없이
    res.json({ data: { users: people.map(toUser), weeks: grid.weeks, today: grid.today, rows: grid.rows, items: items, leaves: leaves } });
  } catch (e) { httpErr.serverError(res, '[my-work/load]', e); }
});

/** 휴가 (연차 · 반차 일정) — { userId: [{ date, type }] } 주말 · 반복 회차 포함. 일정의 담당(이름) 또는 만든 사람(개인 일정) */
async function leaveDays(req, people, from, to) {
  var names = people.map(function (u) { return u.name; });
  var byName = {}, out = {};
  people.forEach(function (u) { byName[u.name] = u.id; });
  var r = await db.query(
    "SELECT * FROM events WHERE tenant_id = $1 AND type IN ('dayoff','amoff','pmoff') AND start_date <= $2 " +
    "AND (COALESCE(NULLIF(end_date, ''), start_date) >= $3 OR (repeat IN ('weekly','biweekly','monthly') AND (COALESCE(repeat_until, '') = '' OR repeat_until >= $3))) " +
    "AND (created_by = ANY($4) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(assignees, '[]'::jsonb)) a WHERE a = ANY($5)))",
    [req.tenant.id, to, from, people.map(function (u) { return u.id; }), names]);
  r.rows.forEach(function (ev) {
    var who = (Array.isArray(ev.assignees) ? ev.assignees : []).map(function (n) { return byName[n]; }).filter(Boolean);
    if (!who.length && people.some(function (u) { return u.id === ev.created_by; })) who = [ev.created_by];
    myEvents.occurrences(ev, from, to).forEach(function (o) {
      for (var d = o.date; d <= o.end; d = myEvents.addDays(d, 1)) {
        if (d < from || d > to) continue;
        var w = new Date(d + 'T00:00:00Z').getUTCDay();
        if (w === 0 || w === 6) continue;
        who.forEach(function (uid) { (out[uid] = out[uid] || []).push({ date: d, type: ev.type }); });
      }
    });
  });
  return out;
}

// PUT /api/my-work/reassign { src, id, fromUserId, toUserId }
router.put('/reassign', async function (req, res) {
  try {
    if (!isLead(req)) return httpErr.sendError(res, 403, 'FORBIDDEN', '관리자 · 임원 · 팀장만 담당을 바꿀 수 있습니다.');
    var b = req.body || {};
    if (MOVE_SRC.indexOf(b.src) < 0 || !b.id) return httpErr.sendError(res, 400, 'VALIDATION', '담당을 바꿀 수 없는 항목입니다.');
    var people = await viewablePeople(req);
    var by = {};
    people.forEach(function (u) { by[u.id] = u; });
    var from = by[b.fromUserId], to = by[b.toUserId];
    if (!from || !to) return httpErr.sendError(res, 403, 'FORBIDDEN', '담당을 바꿀 수 없는 사람입니다.');
    if (from.id === to.id) return res.json({ data: { id: b.id } });
    var items = await myWork.collect(req, [from], { sources: [b.src], load: true });
    if (!items.some(function (x) { return x.id === b.id; })) return httpErr.sendError(res, 404, 'NOT_FOUND', '그 사람의 업무에서 찾을 수 없습니다.');
    var tid = req.tenant.id;
    if (b.src === 'issue') {
      var cur = await db.query('SELECT assignees FROM issues WHERE id = $1 AND tenant_id = $2', [b.id, tid]);
      var list = cur.rows[0] && cur.rows[0].assignees;
      if (typeof list === 'string') { try { list = JSON.parse(list); } catch (_) { list = []; } }
      list = (Array.isArray(list) ? list : []).filter(function (n) { return n !== from.name; });
      if (list.indexOf(to.name) < 0) list.push(to.name);
      await db.query('UPDATE issues SET assignees = $1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [JSON.stringify(list), req.user.sub, b.id, tid]);
    } else if (b.src === 'action') {
      await db.query('UPDATE meeting_action_items SET assignee_id = $1, assignee_name = $2 WHERE id = $3 AND tenant_id = $4', [to.id, to.name, b.id, tid]);
    } else if (b.src === 'dev') {
      await db.query('UPDATE project_dev_items SET assignee_id = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [to.id, req.user.sub, b.id, tid]);
    } else if (b.src === 'prestudy') {
      await db.query('UPDATE prestudies SET owner_id = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [to.id, req.user.sub, b.id, tid]);
    } else if (b.src === 'mindmap') {
      var mp = splitMapId(b.id);
      var ok = await editMapNode(req, res, mp.mapId, mp.nodeId, function (n) {
        if (n.assigneeId !== from.id) return false;
        n.assigneeId = to.id; delete n.assigneeName;
      });
      if (!ok) return;
    }
    res.json({ data: { src: b.src, id: b.id, userId: to.id } });
  } catch (e) { httpErr.serverError(res, '[my-work/reassign]', e); }
});

/* ═══ 달력 (v13.252) ═══ */
function cleanYmd(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

// GET /api/my-work/events?userId=&from=&to=
router.get('/events', async function (req, res) {
  try {
    var u = await subjectOf(req, req.query.userId);
    if (!u) return httpErr.sendError(res, 403, 'FORBIDDEN', '이 사람의 일정을 볼 권한이 없습니다.');
    var today = myWork.kstToday();
    var from = cleanYmd(req.query.from) || myEvents.addDays(today, -31);
    var to = cleanYmd(req.query.to) || myEvents.addDays(today, 62);
    if (myWork.daysBetween(from, to) > 400) return httpErr.sendError(res, 400, 'VALIDATION', '기간이 너무 깁니다.');
    var rows = await myEvents.eventsFor(req, u, from, to);
    await myEvents.markCanModify(req, rows);
    res.json({ data: rows, from: from, to: to });
  } catch (e) { httpErr.serverError(res, '[my-work/events]', e); }
});

// PUT /api/my-work/due { src, id, userId, due } — 마감 바꾸기 (due 가 null 이면 마감 없앰)
router.put('/due', async function (req, res) {
  try {
    var b = req.body || {};
    if (DUE_SRC.indexOf(b.src) < 0 || !b.id) return httpErr.sendError(res, 400, 'VALIDATION', '여기서 마감을 바꿀 수 없는 항목입니다. 원래 화면에서 바꿔 주세요.');
    var due = b.due == null || b.due === '' ? null : cleanYmd(b.due);
    if (b.due && !due) return httpErr.sendError(res, 400, 'VALIDATION', '날짜 형식이 맞지 않습니다.');
    var who = await actingSubject(req, res, b, '마감을 바꿀', { inList: true });
    if (!who) return;
    var userId = who.userId;
    var tid = req.tenant.id;
    if (b.src === 'todo') {
      await db.query('UPDATE my_todos SET due_date = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 AND user_id = $4', [due, b.id, tid, req.user.sub]);
    } else if (b.src === 'issue') {
      await db.query('UPDATE issues SET due_date = $1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [due, req.user.sub, b.id, tid]);
    } else if (b.src === 'action') {
      await db.query('UPDATE meeting_action_items SET due_date = $1 WHERE id = $2 AND tenant_id = $3', [due, b.id, tid]);
    } else if (b.src === 'mindmap') {
      var mp = splitMapId(b.id);
      var ok = await editMapNode(req, res, mp.mapId, mp.nodeId, function (n) {
        if (n.assigneeId !== userId) return false;
        if (due) n.dueDate = due; else delete n.dueDate;
      });
      if (!ok) return;
    }
    res.json({ data: { src: b.src, id: b.id, due: due } });
  } catch (e) { httpErr.serverError(res, '[my-work/due]', e); }
});

/* ═══ 중요도 · 오늘 집중 · 순서 (v13.253) ═══ */
// PUT /api/my-work/priority { src, id, userId, priority }
router.put('/priority', async function (req, res) {
  try {
    var b = req.body || {};
    var p = prio.clamp(b.priority);
    if (prio.SRC.indexOf(b.src) < 0 || !b.id) return httpErr.sendError(res, 400, 'VALIDATION', '중요도를 바꿀 수 없는 항목입니다.');
    if (!p) return httpErr.sendError(res, 400, 'VALIDATION', '중요도는 1~4 입니다.');
    var who = await actingSubject(req, res, b, '중요도를 바꿀', { inList: true });
    if (!who) return;
    var userId = who.userId;
    var tid = req.tenant.id;
    if (b.src === 'todo') {
      await db.query('UPDATE my_todos SET priority = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 AND user_id = $4', [p, b.id, tid, req.user.sub]);
    } else if (b.src === 'issue') {
      await db.query('UPDATE issues SET urgency = $1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [prio.toWord(p), req.user.sub, b.id, tid]);
    } else if (b.src === 'action') {
      await db.query('UPDATE meeting_action_items SET priority = $1 WHERE id = $2 AND tenant_id = $3', [p, b.id, tid]);
    } else if (b.src === 'dev') {
      await db.query('UPDATE project_dev_items SET priority = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [prio.toWord(p), req.user.sub, b.id, tid]);
    } else if (b.src === 'prestudy') {
      await db.query('UPDATE prestudies SET priority = $1, version = version + 1, updated_by = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4', [prio.toWord(p), req.user.sub, b.id, tid]);
    } else if (b.src === 'mindmap') {
      var mp = splitMapId(b.id);
      var ok = await editMapNode(req, res, mp.mapId, mp.nodeId, function (n) {
        if (n.assigneeId !== userId) return false;
        prio.setMarkers(n, p);
      });
      if (!ok) return;
    }
    res.json({ data: { src: b.src, id: b.id, priority: p } });
  } catch (e) { httpErr.serverError(res, '[my-work/priority]', e); }
});

function cleanKey(k) { return typeof k === 'string' && /^[a-z]+:[^\s]{1,190}$/.test(k) ? k : null; }

// PUT /api/my-work/mark { key, focus?, category?, project? } — 내 표시만. 보낸 것만 바꿈 (category null = 칸 고정 풀기, project null = 자동 · '-' = 빼기)
router.put('/mark', async function (req, res) {
  try {
    var b = req.body || {};
    var key = cleanKey(b.key);
    if (!key) return httpErr.sendError(res, 400, 'VALIDATION', '항목이 맞지 않습니다.');
    if (b.focus === undefined && b.category === undefined && b.project === undefined) return httpErr.sendError(res, 400, 'VALIDATION', '바꿀 내용이 없습니다.');
    if (b.category) {
      var c = await db.query('SELECT id FROM my_work_categories WHERE id = $1 AND tenant_id = $2 AND user_id = $3', [String(b.category), req.tenant.id, req.user.sub]);
      if (!c.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND', '칸을 찾을 수 없습니다.');
    }
    if (b.project && b.project !== '-' && !(await myProj.owns(req, b.project))) return httpErr.sendError(res, 404, 'NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    var out = { key: key }, cols = [], vals = [];
    if (b.focus !== undefined) { out.focus = b.focus ? myWork.kstToday() : null; cols.push('focus_date'); vals.push(out.focus); }
    if (b.category !== undefined) { out.category = b.category ? String(b.category) : null; cols.push('category_id'); vals.push(out.category); }
    if (b.project !== undefined) { out.project = b.project ? String(b.project) : null; cols.push('project_id'); vals.push(out.project); }
    await db.query(
      'INSERT INTO my_work_marks (user_id, item_key, tenant_id, ' + cols.join(', ') + ') VALUES ($1, $2, $3' + cols.map(function (_, i) { return ', $' + (i + 4); }).join('') + ') ' +
      'ON CONFLICT (user_id, item_key) DO UPDATE SET ' + cols.map(function (x) { return x + ' = EXCLUDED.' + x; }).join(', ') + ', updated_at = now()',
      [req.user.sub, key, req.tenant.id].concat(vals));
    res.json({ data: out });
  } catch (e) { httpErr.serverError(res, '[my-work/mark]', e); }
});

// PUT /api/my-work/order { keys: [...] } — 이 순서대로 0,1,2…
router.put('/order', async function (req, res) {
  try {
    var keys = ((req.body || {}).keys || []).map(cleanKey);
    if (!keys.length || keys.length > 500 || keys.some(function (k) { return !k; })) return httpErr.sendError(res, 400, 'VALIDATION', '항목이 맞지 않습니다.');
    await db.query(
      'INSERT INTO my_work_marks (user_id, item_key, tenant_id, sort_order) SELECT $1, k, $2, (o - 1)::int FROM unnest($3::text[]) WITH ORDINALITY AS t(k, o) ' +
      'ON CONFLICT (user_id, item_key) DO UPDATE SET sort_order = EXCLUDED.sort_order, updated_at = now()',
      [req.user.sub, req.tenant.id, keys]);
    res.json({ data: { n: keys.length } });
  } catch (e) { httpErr.serverError(res, '[my-work/order]', e); }
});

// GET /api/my-work/directory — 같은 회사 활성 사용자 (이름 · 부서만)
router.get('/directory', async function (req, res) {
  try {
    var r = await db.query('SELECT ' + USER_COLS + " FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.tenant_id = $1 AND u.status = 'active' ORDER BY u.name", [req.tenant.id]);
    res.json({ data: r.rows.map(function (u) { return { id: u.id, name: u.name, display: u.display_name, dept: u.department_name || '' }; }) });
  } catch (e) { httpErr.serverError(res, '[my-work/directory]', e); }
});

/* ═══ .ics 구독 주소 ═══ */
function feedUrl(req, token) {
  var proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  var host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return proto + '://' + host + '/api/ics/' + token + '.ics';
}

router.get('/feed', async function (req, res) {
  try {
    var r = await db.query('SELECT token, created_at, last_used_at FROM calendar_feeds WHERE user_id = $1 AND tenant_id = $2', [req.user.sub, req.tenant.id]);
    var f = r.rows[0];
    res.json({ data: f ? { url: feedUrl(req, f.token), createdAt: f.created_at, lastUsedAt: f.last_used_at } : null });
  } catch (e) { httpErr.serverError(res, '[my-work/feed]', e); }
});

router.post('/feed', async function (req, res) {
  try {
    var token = crypto.randomBytes(24).toString('hex');
    await db.query(
      'INSERT INTO calendar_feeds (user_id, tenant_id, token) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, tenant_id = EXCLUDED.tenant_id, created_at = now(), last_used_at = NULL',
      [req.user.sub, req.tenant.id, token]);
    res.json({ data: { url: feedUrl(req, token), createdAt: new Date().toISOString(), lastUsedAt: null } });
  } catch (e) { httpErr.serverError(res, '[my-work/feed-create]', e); }
});

router.delete('/feed', async function (req, res) {
  try {
    await db.query('DELETE FROM calendar_feeds WHERE user_id = $1 AND tenant_id = $2', [req.user.sub, req.tenant.id]);
    res.json({ data: null });
  } catch (e) { httpErr.serverError(res, '[my-work/feed-delete]', e); }
});

module.exports = router;
