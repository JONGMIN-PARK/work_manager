/**
 * mindmap-data.js — 마인드맵이 앱 데이터를 참조할 때 쓰는 조회 (PRD_마인드맵 3.2 · 3.3)
 *   resolve(req, refs)            참조 노드 상태 요약 — 요청자가 볼 수 없는 항목은 { locked: true }
 *   search(req, type, q)          연결할 항목 검색 (링크 선택 창)
 *   generate(req, kind, opts)     자동 생성 템플릿 — project(프로젝트 구조도) · team(팀원 업무 지도) · mine(내 업무)
 *   refsOfDoc(doc)                문서 안 참조 목록 (mindmap_links 재계산용)
 *
 * 가시성은 각 화면의 목록 규칙을 그대로 따른다:
 *   프로젝트 = lib/project-access.visibleProjectsSql, 마일스톤·회의 = 접근 가능 프로젝트 소속,
 *   이슈 = 접근 가능 프로젝트 소속 또는 (프로젝트 없음 + 내가 작성), 사용자·요소기술·사전검토·A/S = 같은 테넌트.
 */
var db = require('../config/db');
var crypto = require('crypto');
var pa = require('./project-access');

var REF_TYPES = ['project', 'milestone', 'issue', 'user', 'tech', 'prestudy', 'as', 'meeting'];
var ISSUE_DONE = ['resolved', 'closed'];
var AS_DONE = ['closed', 'cancelled'];

function nid() { return 'n-' + crypto.randomUUID().slice(0, 10); }
function node(text, extra) {
  var n = { id: nid(), text: String(text == null ? '' : text).slice(0, 500), children: [] };
  if (extra) Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined && extra[k] !== null) n[k] = extra[k]; });
  return n;
}
function refNode(type, id, text, extra) { return node(text, Object.assign({ ref: { type: type, id: String(id) } }, extra || {})); }
function arr(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = []; } }
  return Array.isArray(v) ? v : [];
}

/** 접근 가능한 프로젝트 id 서브쿼리 — params 에 이어 붙이고 SQL 조각 반환 */
function projSub(req, params) {
  var sub = pa.accessibleProjectsSubquery(req, params.length + 1);
  sub.params.forEach(function (p) { params.push(p); });
  return sub.sql;
}

/* ═══ 항목별 조회 (ids 중 요청자가 볼 수 있는 것) ═══ */
var LOADERS = {
  project: async function (req, ids) {
    var params = [req.tenant.id, ids];
    var v = pa.visibleProjectsSql(req, 'p', 3);
    params = params.concat(v.params);
    var r = await db.query(
      'SELECT p.id, p.name, p.order_no, p.status, p.progress, p.start_date, p.end_date, p.current_phase, ' +
      "COALESCE(NULLIF(u.display_name,''), u.name) AS owner_name FROM projects p LEFT JOIN users u ON u.id = p.owner_id " +
      'WHERE p.tenant_id = $1 AND p.id = ANY($2) AND ' + v.sql, params);
    return r.rows.map(function (x) {
      return { id: x.id, title: x.name, orderNo: x.order_no, status: x.status, progress: x.progress, start: x.start_date, end: x.end_date, phase: x.current_phase, people: x.owner_name ? [x.owner_name] : [] };
    });
  },
  milestone: async function (req, ids) {
    var params = [req.tenant.id, ids];
    var sub = projSub(req, params);
    var r = await db.query(
      'SELECT m.id, m.name, m.status, m.progress, m.start_date, m.end_date, m.project_id, m.assignee_targets, p.name AS project_name, ' +
      "(SELECT array_agg(DISTINCT COALESCE(NULLIF(u.display_name,''), u.name)) FROM milestone_assignments a JOIN users u ON u.id = a.user_id " +
      ' WHERE a.milestone_id = m.id AND a.released_at IS NULL) AS people ' +
      'FROM milestones m JOIN projects p ON p.id = m.project_id ' +
      'WHERE m.tenant_id = $1 AND m.id = ANY($2) AND m.project_id IN (' + sub + ')', params);
    return r.rows.map(function (x) {
      var people = (x.people || []).filter(Boolean);
      var at = x.assignee_targets;
      if (typeof at === 'string') { try { at = JSON.parse(at); } catch (_) { at = {}; } }
      Object.keys(at || {}).forEach(function (n) { if (people.indexOf(n) < 0) people.push(n); });
      return { id: x.id, title: x.name, status: x.status, progress: x.progress, start: x.start_date, end: x.end_date, projectId: x.project_id, projectName: x.project_name, people: people };
    });
  },
  issue: async function (req, ids) {
    var params = [req.tenant.id, ids, req.user.sub];
    var sub = projSub(req, params);
    var r = await db.query(
      'SELECT i.id, i.title, i.status, i.urgency, i.due_date, i.project_id, i.assignees, p.name AS project_name ' +
      'FROM issues i LEFT JOIN projects p ON p.id = i.project_id ' +
      'WHERE i.tenant_id = $1 AND i.id = ANY($2) AND ((i.project_id IS NULL AND i.created_by = $3) OR i.project_id IN (' + sub + '))', params);
    return r.rows.map(function (x) {
      return { id: x.id, title: x.title, status: x.status, urgency: x.urgency, end: x.due_date, projectId: x.project_id, projectName: x.project_name, people: arr(x.assignees), done: ISSUE_DONE.indexOf(x.status) >= 0 };
    });
  },
  meeting: async function (req, ids) {
    var params = [req.tenant.id, ids, req.user.sub];
    var sub = projSub(req, params);
    var r = await db.query(
      'SELECT g.id, g.title, g.meet_date, g.project_id, p.name AS project_name FROM meetings g LEFT JOIN projects p ON p.id = g.project_id ' +
      'WHERE g.tenant_id = $1 AND g.id = ANY($2) AND ((g.project_id IS NULL AND g.created_by = $3) OR g.project_id IN (' + sub + '))', params);
    return r.rows.map(function (x) { return { id: x.id, title: x.title, start: x.meet_date, projectId: x.project_id, projectName: x.project_name }; });
  },
  user: async function (req, ids) {
    var uuids = ids.filter(function (s) { return /^[0-9a-f-]{36}$/i.test(s); });
    if (!uuids.length) return [];
    // 담당 건수는 요청자가 볼 수 있는 프로젝트 안에서만 센다 (권한 밖 업무량이 드러나지 않게)
    var params = [req.tenant.id, uuids];
    var sub = projSub(req, params);
    var r = await db.query(
      "SELECT u.id, COALESCE(NULLIF(u.display_name,''), u.name) AS name, u.position, d.name AS dept_name, " +
      '(SELECT COUNT(DISTINCT a.milestone_id) FROM milestone_assignments a JOIN milestones m ON m.id = a.milestone_id ' +
      "  WHERE a.user_id = u.id AND a.released_at IS NULL AND m.status <> 'done' AND m.project_id IN (" + sub + '))::int AS ms_cnt, ' +
      '(SELECT COUNT(DISTINCT ia.issue_id) FROM issue_assignees ia JOIN issues i ON i.id = ia.issue_id ' +
      "  WHERE ia.user_id = u.id AND i.status NOT IN ('resolved','closed') AND i.project_id IN (" + sub + '))::int AS issue_cnt ' +
      'FROM users u LEFT JOIN departments d ON d.id = u.department_id ' +
      "WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[]) AND u.status = 'active'", params);
    return r.rows.map(function (x) { return { id: x.id, title: x.name, position: x.position, dept: x.dept_name, msCount: x.ms_cnt, issueCount: x.issue_cnt }; });
  },
  tech: async function (req, ids) {
    var r = await db.query('SELECT id, name, code, status, progress, trl FROM tech_assets WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL', [req.tenant.id, ids]);
    return r.rows.map(function (x) { return { id: x.id, title: (x.code ? '[' + x.code + '] ' : '') + x.name, status: x.status, progress: x.progress, trl: x.trl }; });
  },
  prestudy: async function (req, ids) {
    var r = await db.query('SELECT id, title, client, status, due_date FROM prestudies WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL', [req.tenant.id, ids]);
    return r.rows.map(function (x) { return { id: x.id, title: x.title, client: x.client, status: x.status, end: x.due_date }; });
  },
  as: async function (req, ids) {
    var r = await db.query(
      'SELECT id, ticket_no, customer_name, status, priority, issue_summary FROM as_tickets WHERE tenant_id = $1 AND id::text = ANY($2) AND deleted_at IS NULL',
      [req.tenant.id, ids]);
    return r.rows.map(function (x) {
      return { id: String(x.id), title: (x.ticket_no ? x.ticket_no + ' ' : '') + (x.customer_name || ''), status: x.status, priority: x.priority, summary: String(x.issue_summary || '').slice(0, 120), done: AS_DONE.indexOf(x.status) >= 0 };
    });
  }
};

/** 같은 테넌트에 존재하는 id (권한 무관) — 잠김/삭제 구분용 */
var EXISTS_SQL = {
  project: 'SELECT id::text AS id FROM projects WHERE tenant_id = $1 AND id = ANY($2)',
  milestone: 'SELECT id::text AS id FROM milestones WHERE tenant_id = $1 AND id = ANY($2)',
  issue: 'SELECT id::text AS id FROM issues WHERE tenant_id = $1 AND id = ANY($2)',
  meeting: 'SELECT id::text AS id FROM meetings WHERE tenant_id = $1 AND id = ANY($2)'
};

async function resolve(req, refs) {
  var byType = {};
  (refs || []).slice(0, 1000).forEach(function (r) {
    if (!r || REF_TYPES.indexOf(r.type) < 0 || r.id == null) return;
    (byType[r.type] = byType[r.type] || {})[String(r.id)] = true;
  });
  var out = {};
  for (var type in byType) {
    var ids = Object.keys(byType[type]);
    var rows = await LOADERS[type](req, ids);
    var seen = {};
    rows.forEach(function (x) { seen[x.id] = true; out[type + ':' + x.id] = Object.assign({ type: type }, x); });
    var rest = ids.filter(function (id) { return !seen[id]; });
    if (!rest.length) continue;
    var exists = {};
    if (EXISTS_SQL[type]) {
      var er = await db.query(EXISTS_SQL[type], [req.tenant.id, rest]);
      er.rows.forEach(function (x) { exists[x.id] = true; });
    }
    rest.forEach(function (id) { out[type + ':' + id] = exists[id] ? { type: type, id: id, locked: true } : { type: type, id: id, missing: true }; });
  }
  return out;
}

/* ═══ 연결할 항목 검색 ═══ */
async function search(req, type, q, projectId) {
  q = String(q || '').trim();
  var like = '%' + q + '%';
  var params, r;
  switch (type) {
    case 'project': {
      params = [req.tenant.id, like];
      var v = pa.visibleProjectsSql(req, 'p', 3);
      params = params.concat(v.params);
      r = await db.query('SELECT p.id, p.name AS title, p.order_no AS sub FROM projects p WHERE p.tenant_id = $1 AND (p.name ILIKE $2 OR p.order_no ILIKE $2) AND ' + v.sql +
        ' ORDER BY p.updated_at DESC NULLS LAST LIMIT 30', params);
      break;
    }
    case 'milestone': {
      params = [req.tenant.id, like];
      var extra = '';
      if (projectId) { params.push(projectId); extra = ' AND m.project_id = $3'; }
      var sub = projSub(req, params);
      r = await db.query('SELECT m.id, m.name AS title, p.name AS sub FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.tenant_id = $1 AND m.name ILIKE $2' + extra +
        ' AND m.project_id IN (' + sub + ') ORDER BY m.end_date DESC NULLS LAST LIMIT 30', params);
      break;
    }
    case 'issue': {
      params = [req.tenant.id, like, req.user.sub];
      var sub2 = projSub(req, params);
      r = await db.query('SELECT i.id, i.title, p.name AS sub FROM issues i LEFT JOIN projects p ON p.id = i.project_id WHERE i.tenant_id = $1 AND i.title ILIKE $2' +
        ' AND ((i.project_id IS NULL AND i.created_by = $3) OR i.project_id IN (' + sub2 + ')) ORDER BY i.created_at DESC LIMIT 30', params);
      break;
    }
    case 'meeting': {
      params = [req.tenant.id, like, req.user.sub];
      var sub3 = projSub(req, params);
      r = await db.query('SELECT g.id, g.title, g.meet_date AS sub FROM meetings g WHERE g.tenant_id = $1 AND g.title ILIKE $2' +
        ' AND ((g.project_id IS NULL AND g.created_by = $3) OR g.project_id IN (' + sub3 + ')) ORDER BY g.meet_date DESC NULLS LAST LIMIT 30', params);
      break;
    }
    case 'user':
      r = await db.query("SELECT u.id::text AS id, COALESCE(NULLIF(u.display_name,''), u.name) AS title, d.name AS sub FROM users u LEFT JOIN departments d ON d.id = u.department_id " +
        "WHERE u.tenant_id = $1 AND u.status = 'active' AND (u.name ILIKE $2 OR u.display_name ILIKE $2) ORDER BY title LIMIT 30", [req.tenant.id, like]);
      break;
    case 'tech':
      r = await db.query('SELECT id, name AS title, code AS sub FROM tech_assets WHERE tenant_id = $1 AND deleted_at IS NULL AND (name ILIKE $2 OR code ILIKE $2) ORDER BY name LIMIT 30', [req.tenant.id, like]);
      break;
    case 'prestudy':
      r = await db.query('SELECT id, title, client AS sub FROM prestudies WHERE tenant_id = $1 AND deleted_at IS NULL AND (title ILIKE $2 OR client ILIKE $2) ORDER BY updated_at DESC LIMIT 30', [req.tenant.id, like]);
      break;
    case 'as':
      r = await db.query("SELECT id::text AS id, COALESCE(ticket_no,'') || ' ' || COALESCE(customer_name,'') AS title, LEFT(issue_summary, 60) AS sub FROM as_tickets " +
        'WHERE tenant_id = $1 AND deleted_at IS NULL AND (ticket_no ILIKE $2 OR customer_name ILIKE $2 OR issue_summary ILIKE $2) ORDER BY received_at DESC NULLS LAST LIMIT 30', [req.tenant.id, like]);
      break;
    default:
      return [];
  }
  return r.rows.map(function (x) { return { type: type, id: String(x.id), title: x.title, sub: x.sub || '' }; });
}

/* ═══ 자동 생성 템플릿 ═══ */
var PHASE_LABEL = require('./project-defaults').PHASE_LABEL;   // 단계 이름 단일 정의 (옛 'as' 도 완료로 — 순서에도 맨 뒤)

/** 프로젝트 구조도: 프로젝트 → 마일스톤 / 체크리스트(단계별) / 미해결 이슈 / 최근 회의 */
async function genProject(req, projectId) {
  if (!await pa.canReadById(req, projectId)) return null;
  var pr = (await db.query('SELECT id, name FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id])).rows[0];
  var root = refNode('project', pr.id, pr.name);
  var ms = (await db.query('SELECT id, name FROM milestones WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order, start_date NULLS LAST, name', [projectId, req.tenant.id])).rows;
  var gMs = node('📅 마일스톤');
  ms.forEach(function (m) { gMs.children.push(refNode('milestone', m.id, m.name)); });
  root.children.push(gMs);
  var cl = (await db.query('SELECT phase, items FROM checklists WHERE project_id = $1 AND tenant_id = $2', [projectId, req.tenant.id])).rows;
  var order = Object.keys(PHASE_LABEL);
  cl.sort(function (a, b) { return order.indexOf(a.phase) - order.indexOf(b.phase); });
  var gCl = node('✅ 체크리스트');
  cl.forEach(function (c) {
    var items = arr(c.items);
    if (!items.length) return;
    var ph = node(PHASE_LABEL[c.phase] || c.phase || '기타', { collapsed: true });
    items.slice(0, 60).forEach(function (it) { ph.children.push(node(it.text || '', { done: it.done ? true : undefined, dueDate: it.dueDate || undefined })); });
    gCl.children.push(ph);
  });
  if (gCl.children.length) root.children.push(gCl);
  var iss = (await db.query("SELECT id, title FROM issues WHERE project_id = $1 AND tenant_id = $2 AND status NOT IN ('resolved','closed') ORDER BY created_at DESC LIMIT 40", [projectId, req.tenant.id])).rows;
  var gIs = node('🎫 미해결 이슈');
  iss.forEach(function (i) { gIs.children.push(refNode('issue', i.id, i.title)); });
  root.children.push(gIs);
  var mt = (await db.query('SELECT id, title FROM meetings WHERE project_id = $1 AND tenant_id = $2 ORDER BY meet_date DESC NULLS LAST LIMIT 5', [projectId, req.tenant.id])).rows;
  if (mt.length) {
    var gMt = node('🤝 최근 회의', { collapsed: true });
    mt.forEach(function (m) { gMt.children.push(refNode('meeting', m.id, m.title)); });
    root.children.push(gMt);
  }
  root.children.push(node('💡 아이디어 · 리스크'));
  return { title: pr.name + ' 구조도', structure: 'right', root: root };
}

/**
 * 한 사람의 진행 중 업무 → 노드 목록 (프로젝트별 마일스톤 묶음 + 이슈 + A/S). 요청자가 볼 수 있는 프로젝트만.
 */
async function workOf(req, userId) {
  var params = [req.tenant.id, userId];
  var sub = projSub(req, params);
  var ms = (await db.query(
    'SELECT DISTINCT m.id, m.name, m.end_date, m.project_id, p.name AS project_name FROM milestone_assignments a ' +
    'JOIN milestones m ON m.id = a.milestone_id JOIN projects p ON p.id = m.project_id ' +
    "WHERE a.tenant_id = $1 AND a.user_id = $2 AND a.released_at IS NULL AND m.status <> 'done' AND m.project_id IN (" + sub + ') ' +
    'ORDER BY p.name, m.end_date NULLS LAST', params)).rows;
  var params2 = [req.tenant.id, userId];
  var sub2 = projSub(req, params2);
  var iss = (await db.query(
    'SELECT DISTINCT i.id, i.title, i.created_at FROM issue_assignees ia JOIN issues i ON i.id = ia.issue_id ' +
    "WHERE i.tenant_id = $1 AND ia.user_id = $2 AND i.status NOT IN ('resolved','closed') AND i.project_id IN (" + sub2 + ') ORDER BY i.created_at DESC LIMIT 30', params2)).rows;
  var as = (await db.query(
    'SELECT DISTINCT t.id, t.ticket_no, t.customer_name FROM as_assignments s JOIN as_tickets t ON t.id = s.ticket_id ' +
    "WHERE t.tenant_id = $1 AND s.assignee_id = $2 AND t.deleted_at IS NULL AND t.status NOT IN ('closed','cancelled') LIMIT 30",
    [req.tenant.id, userId]).catch(function () { return { rows: [] }; })).rows;
  var out = [];
  var byProj = {};
  ms.forEach(function (m) {
    if (!byProj[m.project_id]) { byProj[m.project_id] = refNode('project', m.project_id, m.project_name); out.push(byProj[m.project_id]); }
    byProj[m.project_id].children.push(refNode('milestone', m.id, m.name));
  });
  if (iss.length) {
    var gi = node('🎫 이슈');
    iss.forEach(function (i) { gi.children.push(refNode('issue', i.id, i.title)); });
    out.push(gi);
  }
  if (as.length) {
    var ga = node('🛠️ A/S');
    as.forEach(function (t) { ga.children.push(refNode('as', t.id, (t.ticket_no ? t.ticket_no + ' ' : '') + (t.customer_name || ''))); });
    out.push(ga);
  }
  return out;
}

/** 팀원 업무 지도: 부서 → 팀원 → 담당 프로젝트·마일스톤 / 이슈 / A/S */
async function genTeam(req, departmentId) {
  // departmentId '__all' = 전체 사용자 (관리자만), 없으면 내 부서
  var all = departmentId === '__all';
  if (all && req.user.role !== 'admin') return null;
  var deptId = all ? null : (departmentId || (req.user && req.user.departmentId) || null);
  // 다른 부서는 관리자만
  if (!all && departmentId && departmentId !== (req.user && req.user.departmentId) && req.user.role !== 'admin') return null;
  var deptName = '전체';
  var users;
  if (deptId) {
    var d = (await db.query('SELECT name FROM departments WHERE id = $1 AND tenant_id = $2', [deptId, req.tenant.id])).rows[0];
    if (!d) return null;
    deptName = d.name;
    users = (await db.query("SELECT id, COALESCE(NULLIF(display_name,''), name) AS name FROM users WHERE tenant_id = $1 AND department_id = $2 AND status = 'active' ORDER BY name", [req.tenant.id, deptId])).rows;
  } else {
    if (req.user.role !== 'admin') return null;
    users = (await db.query("SELECT id, COALESCE(NULLIF(display_name,''), name) AS name FROM users WHERE tenant_id = $1 AND status = 'active' ORDER BY name LIMIT 60", [req.tenant.id])).rows;
  }
  var root = node(deptName + ' 업무 지도');
  for (var i = 0; i < users.length; i++) {
    var u = refNode('user', users[i].id, users[i].name);
    u.children = await workOf(req, users[i].id);
    if (!u.children.length) u.children.push(node('(진행 중인 담당 업무 없음)'));
    else u.collapsed = u.children.length > 6 ? true : undefined;
    root.children.push(u);
  }
  if (!users.length) root.children.push(node('(팀원 없음)'));
  return { title: deptName + ' 업무 지도', structure: 'balanced', root: root, departmentId: deptId };
}

/** 내 업무: 나 → 담당 업무 + 할 일 · 아이디어 (자유 가지) */
async function genMine(req) {
  var me = (await db.query("SELECT id, COALESCE(NULLIF(display_name,''), name) AS name FROM users WHERE id = $1", [req.user.sub])).rows[0];
  var root = refNode('user', me.id, me.name + ' 업무');
  root.children = await workOf(req, me.id);
  root.children.push(node('📝 할 일'));
  root.children.push(node('💡 아이디어'));
  return { title: me.name + ' 업무', structure: 'balanced', root: root };
}

/** 글 → 줄 목록 (빈 줄 · 목록 기호 제거) */
function _lines(t) {
  return String(t || '').replace(/\r\n?/g, '\n').split('\n').map(function (s) {
    return s.trim().replace(/^(?:-\.|[-*+•·▪◦‣□■○●]|\d{1,3}[.)])\s*/, '');
  }).filter(Boolean);
}
/**
 * 회의 → 맵 트리 (순수 — 테스트). m = meetings 행(agenda · minutes · attendees · form), acts = meeting_action_items 행
 * 가지: 📋 안건(완료 표시 · 논의/결과는 하위) · 💬 논의 · ✅ 결정 사항 · 🎯 액션 아이템(담당 · 마감 · 완료) · 👥 참석자(접힘) · 📅 다음 회의
 */
function meetingTree(m, acts) {
  var root = refNode('meeting', m.id, (m.title || '회의') + (m.meet_date ? ' (' + String(m.meet_date).slice(0, 10) + ')' : ''));
  var form = (m.form && typeof m.form === 'object') ? m.form : {};
  var agenda = arr(m.agenda).map(function (g) { return typeof g === 'string' ? { text: g } : (g || {}); }).filter(function (g) { return g.text; });
  if (agenda.length) {
    var gA = node('📋 안건');
    agenda.forEach(function (g) {
      var a = node(String(g.text), { done: g.done ? true : undefined });
      _lines(g.note).forEach(function (t) { a.children.push(node('💬 ' + t)); });
      _lines(g.result).forEach(function (t) { a.children.push(node('✅ ' + t)); });
      gA.children.push(a);
    });
    root.children.push(gA);
  }
  var talk = _lines(m.minutes).slice(0, 80);
  if (talk.length) { var gT = node('💬 논의'); talk.forEach(function (t) { gT.children.push(node(t)); }); root.children.push(gT); }
  var dec = _lines(form.decisions).slice(0, 60);
  if (dec.length) { var gD = node('✅ 결정 사항'); dec.forEach(function (t) { gD.children.push(node(t)); }); root.children.push(gD); }
  if (acts && acts.length) {
    var gX = node('🎯 액션 아이템');
    acts.forEach(function (a) {
      gX.children.push(node(a.title || '', {
        assigneeId: a.assignee_id || undefined,
        assigneeName: !a.assignee_id && a.assignee_name ? a.assignee_name : undefined,
        dueDate: a.due_date ? String(a.due_date).slice(0, 10) : undefined,
        done: a.status === 'done' ? true : undefined
      }));
    });
    root.children.push(gX);
  }
  var att = arr(m.attendees).filter(Boolean);
  if (att.length) { var gP = node('👥 참석자', { collapsed: true }); att.forEach(function (p) { gP.children.push(node(String(p))); }); root.children.push(gP); }
  if (form.nextDate || form.nextNote) {
    var gN = node('📅 다음 회의' + (form.nextDate ? ' ' + String(form.nextDate).slice(0, 10) : ''));
    _lines(form.nextNote).forEach(function (t) { gN.children.push(node(t)); });
    root.children.push(gN);
  }
  return root;
}
/** 회의록 → 맵 — 프로젝트 회의는 프로젝트 읽기 권한, 프로젝트 없는 회의는 만든 사람만 */
async function genMeeting(req, meetingId) {
  var m = (await db.query('SELECT * FROM meetings WHERE id = $1 AND tenant_id = $2', [meetingId, req.tenant.id])).rows[0];
  if (!m) return null;
  if (m.project_id ? !await pa.canReadById(req, m.project_id) : m.created_by !== req.user.sub) return null;
  var acts = (await db.query('SELECT * FROM meeting_action_items WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY sort_order, created_at', [meetingId, req.tenant.id])).rows;
  return { title: '회의 · ' + (m.title || ''), structure: 'right', root: meetingTree(m, acts), projectId: m.project_id || null };
}

async function generate(req, kind, opts) {
  opts = opts || {};
  if (kind === 'meeting') return opts.meetingId ? genMeeting(req, opts.meetingId) : null;
  if (kind === 'project') return opts.projectId ? genProject(req, opts.projectId) : null;
  if (kind === 'team') return genTeam(req, opts.departmentId || null);
  if (kind === 'mine') return genMine(req);
  return null;
}

/** 문서의 참조 목록 [{ nodeId, type, id }] — 시트 전체 */
function refsOfDoc(doc) {
  var out = [];
  ((doc && doc.sheets) || []).forEach(function (s) {
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.ref && REF_TYPES.indexOf(n.ref.type) >= 0 && n.ref.id != null) out.push({ nodeId: String(n.id), type: n.ref.type, id: String(n.ref.id) });
      (n.children || []).forEach(walk);
    })(s && s.root);
  });
  return out;
}

module.exports = { meetingTree: meetingTree, REF_TYPES: REF_TYPES, resolve: resolve, search: search, generate: generate, refsOfDoc: refsOfDoc };
