/**
 * 통합 검색 (v13.291) — GET /api/search?q=검색어[&cat=범주][&limit=n]
 *
 * 예전엔 브라우저가 5초마다 프로젝트 · 마일스톤 · 이슈 · 수주 · 일정 목록을 통째로 받아 그 안에서만 찾았다
 * (업무일지 · 회의 · 맵 · 문서 등은 아예 못 찾음). 이제 서버가 범주마다 한 번씩 ILIKE 로 찾아 상위 몇 건과
 * 전체 건수를 돌려준다. 권한은 각 화면 목록과 같은 규칙:
 *   프로젝트 계열(마일스톤 · 이슈 · 일정 · 회의 · 개발 · 체크리스트 · 코멘트 · 문서) → lib/project-access
 *   업무일지 → lib/record-scope · 마인드맵 → lib/mindmap-visible · 할 일 · 노트 · 메시지 → 본인 것만
 *   주간 업무 보고 → 관리자만(화면과 같음) · 수주 · 사전검토 · 요소기술 · A/S · 팀원 → 테넌트 전체(목록 화면과 같음)
 * 범주 하나가 실패해도(칼럼 없는 구배포 등) 나머지는 그대로 — 그 범주만 빠진다.
 *
 * 응답: { data: { q, groups: [{ key, total, items: [{ id, title, sub, snippet, nav }] }] } }
 *   snippet = 걸린 칸의 앞뒤 문맥 한 줄, nav = 화면에서 그 자리로 가는 데 필요한 값
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var pa = require('../lib/project-access');
var rs = require('../lib/record-scope');
var mv = require('../lib/mindmap-visible');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var SNIP = 34;   // 걸린 곳 앞뒤로 보여 줄 글자 수

/* LIKE 특수문자 이스케이프 — 사용자가 친 % _ \ 는 글자 그대로 */
function likeOf(q) { return '%' + q.replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%'; }

/* 텍스트에서 검색어 앞뒤 문맥 한 줄 (줄바꿈은 공백으로). 없으면 null */
function snippetOf(text, q) {
  if (text == null) return null;
  var s = typeof text === 'string' ? text : JSON.stringify(text);
  s = s.replace(/\s+/g, ' ');
  var i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  var a = Math.max(0, i - SNIP), b = Math.min(s.length, i + q.length + SNIP);
  return (a > 0 ? '…' : '') + s.slice(a, b) + (b < s.length ? '…' : '');
}
/* 칸 목록 중 처음 걸린 칸의 문맥 — [값, 라벨] 순서대로 본다. 제목에서 걸렸으면 문맥은 생략(제목에 이미 보임) */
function firstSnip(q, pairs, titleText) {
  if (titleText && String(titleText).toLowerCase().indexOf(q.toLowerCase()) >= 0) return null;
  for (var i = 0; i < pairs.length; i++) {
    var v = pairs[i][0];
    if (Array.isArray(v)) v = v.join(', ');
    else if (v && typeof v === 'object') v = JSON.stringify(v);
    var s = snippetOf(v, q);
    if (s) return (pairs[i][1] ? '[' + pairs[i][1] + '] ' : '') + s;
  }
  return null;
}
/* JSON 트리(맵 doc · 체크리스트 items)에서 글이 걸린 첫 노드 { id, text } */
function findNode(obj, q, depth) {
  if (!obj || typeof obj !== 'object' || (depth || 0) > 60) return null;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) { var r = findNode(obj[i], q, (depth || 0) + 1); if (r) return r; }
    return null;
  }
  var t = obj.text || obj.label || obj.title || obj.name;
  if (typeof t === 'string' && t.toLowerCase().indexOf(q.toLowerCase()) >= 0) return { id: obj.id || null, text: t };
  if (typeof obj.note === 'string' && obj.note.toLowerCase().indexOf(q.toLowerCase()) >= 0) return { id: obj.id || null, text: obj.note };
  for (var k in obj) {
    if (k === 'text' || k === 'note' || !obj[k] || typeof obj[k] !== 'object') continue;
    var r2 = findNode(obj[k], q, (depth || 0) + 1);
    if (r2) return r2;
  }
  return null;
}
/* 여러 칸 중 하나라도 ILIKE — "(a ILIKE $n OR b ILIKE $n ...)" (jsonb 칸은 ::text) */
function anyLike(cols, p) { return '(' + cols.map(function (c) { return c + ' ILIKE ' + p; }).join(' OR ') + ')'; }

/* 프로젝트 가시성 서브쿼리 붙이기 — params 배열에 이어 붙이고 SQL 조각을 돌려줌 */
function projSub(req, params) {
  var sub = pa.accessibleProjectsSubquery(req, params.length + 1);
  params.push.apply(params, sub.params);
  return sub.sql;
}
function meParam(req, params) { params.push(req.user.sub); return '$' + params.length; }

/* ── 범주 정의 — 배열 순서 = 화면 표시 순서 ──
 * run(req, ctx) → { rows, total }   ctx = { q, like, limit }
 * map(row, q) → { id, title, sub, snippet, nav } */
var CATS = [
  { key: 'project',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var v = pa.visibleProjectsSql(req, 'p', 4); p = p.concat(v.params);
      return db.query('SELECT p.id, p.name, p.order_no, p.memo, p.assignees, p.color, COUNT(*) OVER() AS _total FROM projects p WHERE p.tenant_id = $1 AND ' + v.sql +
        ' AND ' + anyLike(['p.name', 'p.order_no', 'p.memo', 'p.assignees::text'], '$2') + ' ORDER BY p.updated_at DESC NULLS LAST LIMIT $3', p);
    },
    map: function (r, q) { return { id: r.id, title: r.name, sub: r.order_no || '', snippet: firstSnip(q, [[r.order_no, '수주번호'], [r.memo, '메모'], [r.assignees, '담당']], r.name), nav: { projectId: r.id } }; } },
  { key: 'milestone',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var v = pa.visibleProjectsSql(req, 'p', 4); p = p.concat(v.params);
      return db.query('SELECT m.id, m.name, m.progress_note, m.project_id, p.name AS proj_name, COUNT(*) OVER() AS _total FROM milestones m JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id' +
        ' WHERE m.tenant_id = $1 AND ' + v.sql + ' AND ' + anyLike(['m.name', 'm.progress_note'], '$2') + ' ORDER BY m.updated_at DESC NULLS LAST LIMIT $3', p);
    },
    map: function (r, q) { return { id: r.id, title: r.name, sub: r.proj_name || '', snippet: firstSnip(q, [[r.progress_note, '진척 메모']], r.name), nav: { projectId: r.project_id, tab: 'work' } }; } },
  { key: 'issue',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var me = meParam(req, p), sub = projSub(req, p);
      return db.query('SELECT id, title, description, resolution, reporter, tags, assignees, order_no, status, urgency, COUNT(*) OVER() AS _total FROM issues WHERE tenant_id = $1' +
        ' AND ((project_id IS NULL AND created_by = ' + me + ') OR project_id IN (' + sub + '))' +
        ' AND ' + anyLike(['title', 'description', 'resolution', 'reporter', 'order_no', 'tags::text', 'assignees::text'], '$2') + ' ORDER BY created_at DESC LIMIT $3', p);
    },
    map: function (r, q) { return { id: r.id, title: r.title, sub: r.order_no || '', status: r.status, urgency: r.urgency, snippet: firstSnip(q, [[r.description, '내용'], [r.resolution, '해결'], [r.reporter, '보고자'], [r.assignees, '담당'], [r.tags, '태그'], [r.order_no, '수주번호']], r.title), nav: { issueId: r.id } }; } },
  { key: 'order',
    run: async function (req, c) {
      return db.query('SELECT order_no, name, client, manager, memo, COUNT(*) OVER() AS _total FROM orders WHERE tenant_id = $1 AND ' +
        anyLike(['order_no', 'name', 'client', 'manager', 'memo'], '$2') + ' ORDER BY date DESC NULLS LAST LIMIT $3', [req.tenant.id, c.like, c.limit]);
    },
    map: function (r, q) { return { id: r.order_no, title: r.name || r.order_no, sub: [r.order_no, r.client].filter(Boolean).join(' · '), snippet: firstSnip(q, [[r.client, '거래처'], [r.manager, '담당'], [r.memo, '메모']], (r.name || '') + ' ' + r.order_no), nav: { orderNo: r.order_no } }; } },
  { key: 'work',
    run: async function (req, c) {
      var p = [c.like, c.limit];
      var sc = rs.recordScope(req, { alias: 'wr', startIdx: 3 }); p = p.concat(sc.params);
      return db.query('SELECT wr.id, wr.date, wr.name, wr.order_no, wr.content, wr.ocmt, wr.hours, COUNT(*) OVER() AS _total FROM work_records wr WHERE ' + sc.where +
        ' AND ' + anyLike(['wr.content', 'wr.ocmt', 'wr.order_no'], '$1') + ' ORDER BY wr.date DESC, wr.id DESC LIMIT $2', p);
    },
    map: function (r, q) { return { id: String(r.id), title: snippetOf(r.content, q) || r.content || r.order_no || '', sub: [r.date, r.name].filter(Boolean).join(' · '), snippet: r.order_no ? '[수주] ' + r.order_no : null, nav: { date: r.date, name: r.name } }; } },
  { key: 'meeting',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var me = meParam(req, p), sub = projSub(req, p);
      return db.query('SELECT mt.id, mt.title, mt.meet_date, mt.project_id, mt.minutes, mt.agenda, mt.form, p.name AS proj_name,' +
        ' (SELECT string_agg(a.title, \' · \') FROM meeting_action_items a WHERE a.meeting_id = mt.id AND a.tenant_id = mt.tenant_id AND a.title ILIKE $2) AS act_hit, COUNT(*) OVER() AS _total' +
        ' FROM meetings mt LEFT JOIN projects p ON p.id = mt.project_id AND p.tenant_id = mt.tenant_id WHERE mt.tenant_id = $1' +
        ' AND (mt.project_id IN (' + sub + ') OR (mt.project_id IS NULL AND mt.created_by = ' + me + '))' +
        ' AND (' + anyLike(['mt.title', 'mt.minutes', 'mt.agenda::text', 'mt.form::text'], '$2') +
        ' OR EXISTS (SELECT 1 FROM meeting_action_items a WHERE a.meeting_id = mt.id AND a.tenant_id = mt.tenant_id AND a.title ILIKE $2))' +
        ' ORDER BY mt.meet_date DESC NULLS LAST LIMIT $3', p);
    },
    map: function (r, q) { return { id: r.id, title: r.title || '(제목 없음)', sub: [r.meet_date, r.proj_name].filter(Boolean).join(' · '), snippet: firstSnip(q, [[r.act_hit, '액션'], [r.minutes, '회의록'], [r.agenda, '안건'], [r.form, '내용']], r.title), nav: { projectId: r.project_id, meetingId: r.id } }; } },
  { key: 'todo',
    run: async function (req, c) {
      return db.query('SELECT id, title, memo, due_date, done_at, COUNT(*) OVER() AS _total FROM my_todos WHERE tenant_id = $1 AND user_id = $4 AND deleted_at IS NULL AND ' +
        anyLike(['title', 'memo', 'waiting_for', 'checklist::text'], '$2') + ' ORDER BY (done_at IS NULL) DESC, due_date NULLS LAST LIMIT $3', [req.tenant.id, c.like, c.limit, req.user.sub]);
    },
    map: function (r, q) { return { id: r.id, title: r.title, sub: (r.done_at ? '✅ 완료' : '') + (r.due_date ? (r.done_at ? ' · ' : '') + r.due_date : ''), snippet: firstSnip(q, [[r.memo, '메모']], r.title), nav: { todoId: r.id } }; } },
  { key: 'note',
    run: async function (req, c) {
      return db.query('SELECT note_date, ref, body, COUNT(*) OVER() AS _total FROM my_notes WHERE tenant_id = $1 AND user_id = $4 AND body ILIKE $2 ORDER BY note_date DESC LIMIT $3', [req.tenant.id, c.like, c.limit, req.user.sub]);
    },
    map: function (r, q) { return { id: r.note_date + '|' + (r.ref || ''), title: snippetOf(r.body, q) || '', sub: r.note_date + ' 노트', nav: { noteDate: r.note_date } }; } },
  { key: 'mindmap',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var v = mv.visibleMapsSql(req, 4); p = p.concat(v.params);
      return db.query('SELECT m.id, m.title, m.doc, COUNT(*) OVER() AS _total FROM mindmaps m WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND ' + v.sql +
        ' AND (m.title ILIKE $2 OR m.doc::text ILIKE $2) ORDER BY m.updated_at DESC LIMIT $3', p);
    },
    map: function (r, q) {
      var hitTitle = (r.title || '').toLowerCase().indexOf(q.toLowerCase()) >= 0;
      var n = null, sheet = 0, sheets = (r.doc && Array.isArray(r.doc.sheets)) ? r.doc.sheets : [r.doc];
      for (var i = 0; !hitTitle && !n && i < sheets.length; i++) { n = findNode(sheets[i], q); if (n) sheet = i; }
      return { id: r.id, title: r.title, sub: '마인드맵', snippet: n ? '[주제] ' + snippetOf(n.text, q) : null, nav: { mapId: r.id, nodeId: n && n.id, sheet: sheet } };
    } },
  { key: 'doc',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var me = meParam(req, p), sub = projSub(req, p);
      return db.query('SELECT f.id, f.name, f.memo, f.tags, f.project_id, f.folder_id, p.name AS proj_name, substr(f.text_cache, greatest(1, strpos(lower(f.text_cache), lower($' + (p.length + 1) + ')) - 40), 120) AS txt,' +
        ' COUNT(*) OVER() AS _total FROM project_files f LEFT JOIN projects p ON p.id = f.project_id AND p.tenant_id = f.tenant_id WHERE f.tenant_id = $1' +
        ' AND ((f.project_id IS NULL AND f.uploaded_by = ' + me + ') OR f.project_id IN (' + sub + '))' +
        ' AND ' + anyLike(['f.name', 'f.memo', 'f.tags::text', 'f.text_cache'], '$2') + ' ORDER BY f.updated_at DESC NULLS LAST LIMIT $3', p.concat([c.q]));
    },
    map: function (r, q) { return { id: r.id, title: r.name, sub: r.proj_name || '', snippet: firstSnip(q, [[r.memo, '메모'], [r.tags, '태그'], [r.txt, '본문']], r.name), nav: { projectId: r.project_id, fileId: r.id, folderId: r.folder_id } }; } },
  { key: 'dev',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var sub = projSub(req, p);
      return db.query('SELECT d.id, d.title, d.description, d.status, d.project_id, p.name AS proj_name, COUNT(*) OVER() AS _total FROM project_dev_items d LEFT JOIN projects p ON p.id = d.project_id AND p.tenant_id = d.tenant_id' +
        ' WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.project_id IN (' + sub + ') AND ' + anyLike(['d.title', 'd.description'], '$2') + ' ORDER BY d.updated_at DESC NULLS LAST LIMIT $3', p);
    },
    map: function (r, q) { return { id: r.id, title: r.title, sub: r.proj_name || '', snippet: firstSnip(q, [[r.description, '설명']], r.title), nav: { projectId: r.project_id, tab: 'dev' } }; } },
  { key: 'checklist',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var sub = projSub(req, p);
      return db.query('SELECT ck.id, ck.phase, ck.items, ck.project_id, p.name AS proj_name, COUNT(*) OVER() AS _total FROM checklists ck LEFT JOIN projects p ON p.id = ck.project_id AND p.tenant_id = ck.tenant_id' +
        ' WHERE ck.tenant_id = $1 AND ck.project_id IN (' + sub + ') AND ck.items::text ILIKE $2 ORDER BY ck.updated_at DESC NULLS LAST LIMIT $3', p);
    },
    map: function (r, q) { var n = findNode(r.items, q); return { id: r.id, title: n ? n.text : '(체크리스트)', sub: r.proj_name || '', nav: { projectId: r.project_id, tab: 'lifecycle', phase: r.phase } }; },
    keep: function (it) { return it.title !== '(체크리스트)'; } },   // items 의 다른 칸(작성자 등)만 걸린 경우 빼기
  { key: 'comment',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var sub = projSub(req, p);
      return db.query('SELECT cm.id, cm.body, cm.author_name, cm.created_at, cm.project_id, p.name AS proj_name, COUNT(*) OVER() AS _total FROM comments cm LEFT JOIN projects p ON p.id = cm.project_id AND p.tenant_id = cm.tenant_id' +
        ' WHERE cm.tenant_id = $1 AND cm.project_id IN (' + sub + ') AND cm.body ILIKE $2 ORDER BY cm.created_at DESC LIMIT $3', p);
    },
    map: function (r, q) { return { id: r.id, title: snippetOf(r.body, q) || '', sub: [r.author_name, r.proj_name].filter(Boolean).join(' · '), nav: { projectId: r.project_id, tab: 'overview', commentId: r.id } }; } },
  { key: 'prestudy',
    run: async function (req, c) {
      return db.query('SELECT id, title, client, background, notes, conclusion, tags, status, COUNT(*) OVER() AS _total FROM prestudies WHERE tenant_id = $1 AND deleted_at IS NULL AND ' +
        anyLike(['title', 'client', 'background', 'notes', 'conclusion', 'tags::text'], '$2') + ' ORDER BY updated_at DESC NULLS LAST LIMIT $3', [req.tenant.id, c.like, c.limit]);
    },
    map: function (r, q) { return { id: r.id, title: r.title, sub: r.client || '', snippet: firstSnip(q, [[r.background, '배경'], [r.notes, '메모'], [r.conclusion, '결론'], [r.tags, '태그'], [r.client, '업체']], r.title), nav: { prestudyId: r.id } }; } },
  { key: 'tech',
    run: async function (req, c) {
      return db.query('SELECT id, code, name, summary, description, stack, tags, COUNT(*) OVER() AS _total FROM tech_assets WHERE tenant_id = $1 AND deleted_at IS NULL AND ' +
        anyLike(['name', 'code', 'summary', 'description', 'stack::text', 'tags::text'], '$2') + ' ORDER BY updated_at DESC NULLS LAST LIMIT $3', [req.tenant.id, c.like, c.limit]);
    },
    map: function (r, q) { return { id: r.id, title: r.name, sub: r.code || '', snippet: firstSnip(q, [[r.summary, '요약'], [r.description, '설명'], [r.stack, '스택'], [r.tags, '태그'], [r.code, '코드']], r.name), nav: { techId: r.id } }; } },
  { key: 'as',
    run: async function (req, c) {
      return db.query('SELECT id, ticket_no, customer_name, equipment_model, serial_no, issue_summary, initial_analysis, rca, closure, site_line, status, COUNT(*) OVER() AS _total FROM as_tickets WHERE tenant_id = $1 AND deleted_at IS NULL AND ' +
        anyLike(['ticket_no', 'customer_name', 'equipment_model', 'serial_no', 'issue_summary', 'initial_analysis', 'rca', 'closure', 'site_line'], '$2') + ' ORDER BY received_at DESC NULLS LAST LIMIT $3', [req.tenant.id, c.like, c.limit]);
    },
    map: function (r, q) { return { id: r.id, title: r.issue_summary || r.ticket_no, sub: [r.ticket_no, r.customer_name].filter(Boolean).join(' · '), snippet: firstSnip(q, [[r.initial_analysis, '1차 분석'], [r.rca, '원인'], [r.closure, '종결'], [r.equipment_model, '장비'], [r.serial_no, '시리얼'], [r.site_line, '라인']], (r.issue_summary || '') + ' ' + r.ticket_no + ' ' + (r.customer_name || '')), nav: { asId: r.id } }; } },
  { key: 'weekly',
    allow: function (req) { return req.user.role === 'admin'; },   // 주간 업무 화면이 관리자 전용
    run: async function (req, c) {
      return db.query('SELECT id, name, team, week_label, week_start, cur_text, last_text, COUNT(*) OVER() AS _total FROM weekly_reports WHERE tenant_id = $1 AND ' +
        anyLike(['name', 'team', 'cur_text', 'last_text'], '$2') + ' ORDER BY week_start DESC NULLS LAST LIMIT $3', [req.tenant.id, c.like, c.limit]);
    },
    map: function (r, q) { return { id: r.id, title: r.name, sub: [r.team, r.week_label].filter(Boolean).join(' · '), snippet: firstSnip(q, [[r.cur_text, '금주'], [r.last_text, '지난주']], r.name), nav: { reportId: r.id } }; } },
  { key: 'message',
    run: async function (req, c) {
      return db.query('SELECT ms.id, ms.body, ms.created_at, ms.from_user_id, ms.to_user_id, uf.name AS from_name, ut.name AS to_name, COUNT(*) OVER() AS _total FROM messages ms' +
        ' LEFT JOIN users uf ON uf.id = ms.from_user_id LEFT JOIN users ut ON ut.id = ms.to_user_id' +
        ' WHERE ms.tenant_id = $1 AND (ms.from_user_id = $4 OR ms.to_user_id = $4) AND ms.body ILIKE $2 ORDER BY ms.created_at DESC LIMIT $3', [req.tenant.id, c.like, c.limit, req.user.sub]);
    },
    map: function (r, q, req) {
      var mine = String(r.from_user_id) === String(req.user.sub);
      return { id: r.id, title: snippetOf(r.body, q) || '', sub: mine ? '→ ' + (r.to_name || '') : (r.from_name || '') + ' →', nav: { peerId: mine ? r.to_user_id : r.from_user_id } };
    } },
  { key: 'member',
    run: async function (req, c) {
      return db.query("SELECT id, name, display_name, position, email, COUNT(*) OVER() AS _total FROM users WHERE tenant_id = $1 AND COALESCE(status, 'active') = 'active' AND " +
        anyLike(['name', 'display_name', 'position', 'email'], '$2') + ' ORDER BY name LIMIT $3', [req.tenant.id, c.like, c.limit]);
    },
    map: function (r) { return { id: r.id, title: r.name + (r.display_name && r.display_name !== r.name ? ' (' + r.display_name + ')' : ''), sub: r.position || '', nav: { name: r.name } }; } }
];

router.get('/', async function (req, res) {
  try {
    var q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) return res.json({ data: { q: '', groups: [] } });
    var only = req.query.cat ? String(req.query.cat) : null;
    var limit = Math.max(1, Math.min(only ? 50 : 10, parseInt(req.query.limit, 10) || (only ? 30 : 5)));
    var ctx = { q: q, like: likeOf(q), limit: limit };
    var cats = CATS.filter(function (c) { return (!only || c.key === only) && (!c.allow || c.allow(req)); });
    var groups = await Promise.all(cats.map(function (c) {
      return c.run(req, ctx).then(function (r) {
        var total = r.rows.length ? parseInt(r.rows[0]._total, 10) : 0;
        var items = r.rows.map(function (row) { return c.map(row, q, req); });
        if (c.keep) items = items.filter(c.keep);
        return { key: c.key, total: total, items: items };
      }).catch(function (e) {
        console.warn('[search] ' + c.key + ' 건너뜀:', e.message);   // 이 범주만 빠짐
        return null;
      });
    }));
    res.json({ data: { q: q, groups: groups.filter(function (g) { return g && g.total > 0; }) } });
  } catch (e) {
    httpErr.serverError(res, '[search]', e);
  }
});

module.exports = router;
module.exports._test = { likeOf: likeOf, snippetOf: snippetOf, findNode: findNode, firstSnip: firstSnip };
