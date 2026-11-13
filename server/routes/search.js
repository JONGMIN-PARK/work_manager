/**
 * 통합 검색 (v13.291) — GET /api/search?q=검색어[&cat=범주][&limit=n]
 *
 * 예전엔 브라우저가 5초마다 프로젝트 · 마일스톤 · 이슈 · 수주 · 일정 목록을 통째로 받아 그 안에서만 찾았다
 * (업무일지 · 회의 · 맵 · 문서 등은 아예 못 찾음). 이제 서버가 범주마다 한 번씩 ILIKE 로 찾아 상위 몇 건과
 * 전체 건수를 돌려준다. 권한은 각 화면 목록과 같은 규칙:
 *   프로젝트 계열(마일스톤 · 이슈 · 일정 · 회의 · 개발 · 체크리스트 · 코멘트 · 문서) → lib/project-access
 *   업무일지 → lib/record-scope · 마인드맵 → lib/mindmap-visible · 할 일 · 노트 · 메시지 → 본인 것만
 *   주간 업무 보고 → 관리자만(화면과 같음) · 수주 · 사전검토 · 요소기술 · A/S · 팀원 → 테넌트 전체(목록 화면과 같음)
 * v13.484 띄어 쓴 단어는 모두 포함(AND · 순서 무관) · 범주 추가: 일정 · 내 프로젝트 · 공지 · 대화방 · 업무일지는 이름 · 업무 구분 · 업체 · 날짜도
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

/* v13.484 여러 단어 — 띄어 쓴 단어를 모두 포함한 것(AND, 순서 무관). 최대 6개, 겹치는 것 제외 */
function tokensOf(q) {
  var seen = {}, out = [];
  String(q || '').split(/\s+/).forEach(function (t) { var k = t.toLowerCase(); if (t && !seen[k] && out.length < 6) { seen[k] = 1; out.push(t); } });
  return out;
}
/* 글 안에서 가장 먼저 걸린 단어의 자리 { i, len } — 없으면 null */
function firstHit(s, q) {
  var low = s.toLowerCase(), best = null;
  tokensOf(q).forEach(function (t) { var i = low.indexOf(t.toLowerCase()); if (i >= 0 && (!best || i < best.i)) best = { i: i, len: t.length }; });
  return best;
}
function hasAll(text, q) { var low = String(text || '').toLowerCase(), t = tokensOf(q); return !!t.length && t.every(function (k) { return low.indexOf(k.toLowerCase()) >= 0; }); }
function hasAny(text, q) { return !!firstHit(String(text || ''), q); }
/* 텍스트에서 검색어 앞뒤 문맥 한 줄 (줄바꿈은 공백으로). 없으면 null */
function snippetOf(text, q) {
  if (text == null) return null;
  var s = typeof text === 'string' ? text : JSON.stringify(text);
  s = s.replace(/\s+/g, ' ');
  var h = firstHit(s, q);
  if (!h) return null;
  var a = Math.max(0, h.i - SNIP), b = Math.min(s.length, h.i + h.len + SNIP);
  return (a > 0 ? '…' : '') + s.slice(a, b) + (b < s.length ? '…' : '');
}
/* 칸 목록 중 처음 걸린 칸의 문맥 — [값, 라벨] 순서대로 본다. 제목에서 (모든 단어가) 걸렸으면 문맥은 생략(제목에 이미 보임) */
function firstSnip(q, pairs, titleText) {
  if (titleText && hasAll(titleText, q)) return null;
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
  if (typeof t === 'string' && hasAny(t, q)) return { id: obj.id || null, text: t };
  if (typeof obj.note === 'string' && hasAny(obj.note, q)) return { id: obj.id || null, text: obj.note };
  for (var k in obj) {
    if (k === 'text' || k === 'note' || !obj[k] || typeof obj[k] !== 'object') continue;
    var r2 = findNode(obj[k], q, (depth || 0) + 1);
    if (r2) return r2;
  }
  return null;
}
/* 여러 칸 중 하나라도 ILIKE — "(a ILIKE $n OR b ILIKE $n ...)" (jsonb 칸은 ::text) */
/* v13.484 p = 단어 패턴 배열 파라미터($n, text[]) — 단어마다 칸들 중 하나에 걸려야 함(모든 단어 AND) */
function allTok(p, fn) { return 'NOT EXISTS (SELECT 1 FROM unnest(' + p + '::text[]) AS _t(k) WHERE NOT COALESCE((' + fn('_t.k') + '), false))'; }
function anyLike(cols, p) { return allTok(p, function (k) { return cols.map(function (c) { return c + ' ILIKE ' + k; }).join(' OR '); }); }

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
        ' AND ' + anyLike(['wr.content', 'wr.ocmt', 'wr.order_no', 'wr.name', 'wr.task_type', 'wr.oclient', 'wr.date'], '$1') + ' ORDER BY wr.date DESC, wr.id DESC LIMIT $2', p);
    },
    map: function (r, q) { return { id: String(r.id), title: snippetOf(r.content, q) || r.content || r.order_no || '', sub: [r.date, r.name].filter(Boolean).join(' · '), snippet: r.order_no ? '[수주] ' + r.order_no : null, nav: { date: r.date, name: r.name } }; } },
  { key: 'meeting',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var me = meParam(req, p), sub = projSub(req, p);
      return db.query('SELECT mt.id, mt.title, mt.meet_date, mt.project_id, mt.minutes, mt.agenda, mt.form, p.name AS proj_name,' +
        ' (SELECT string_agg(a.title, \' · \') FROM meeting_action_items a WHERE a.meeting_id = mt.id AND a.tenant_id = mt.tenant_id AND a.title ILIKE ANY($2::text[])) AS act_hit, COUNT(*) OVER() AS _total' +
        ' FROM meetings mt LEFT JOIN projects p ON p.id = mt.project_id AND p.tenant_id = mt.tenant_id WHERE mt.tenant_id = $1' +
        ' AND (mt.project_id IN (' + sub + ') OR (mt.project_id IS NULL AND mt.created_by = ' + me + '))' +
        ' AND ' + allTok('$2', function (k) { return 'mt.title ILIKE ' + k + ' OR mt.minutes ILIKE ' + k + ' OR mt.agenda::text ILIKE ' + k + ' OR mt.form::text ILIKE ' + k + ' OR mt.meet_date::text ILIKE ' + k +
          ' OR EXISTS (SELECT 1 FROM meeting_action_items a WHERE a.meeting_id = mt.id AND a.tenant_id = mt.tenant_id AND a.title ILIKE ' + k + ')'; }) +
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
      // v13.316 📓 노트북 노트(제목 · 본문 · 태그)도 — 고친 순서로 일일 노트와 섞어서
      return db.query('SELECT * , COUNT(*) OVER() AS _total FROM (' +
        "SELECT NULL::text AS nb_id, NULL::text AS nb_title, note_date, ref, body, updated_at FROM my_notes WHERE tenant_id = $1 AND user_id = $4 AND " + anyLike(['body', 'note_date::text'], '$2') + ' ' +
        "UNION ALL SELECT id, title, NULL, NULL, body, updated_at FROM nb_notes WHERE tenant_id = $1 AND user_id = $4 AND deleted_at IS NULL AND " + anyLike(['title', 'body', 'tags::text'], '$2') +
        ') x ORDER BY updated_at DESC LIMIT $3', [req.tenant.id, c.like, c.limit, req.user.sub]);
    },
    map: function (r, q) {
      if (r.nb_id) return { id: r.nb_id, title: r.nb_title || snippetOf(r.body, q) || '제목 없음', sub: '📓 노트북', snippet: firstSnip(q, [[r.body, '본문']], r.nb_title), nav: { nbId: r.nb_id } };
      return { id: r.note_date + '|' + (r.ref || ''), title: snippetOf(r.body, q) || '', sub: r.note_date + ' 노트', nav: { noteDate: r.note_date } };
    } },
  { key: 'mindmap',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var v = mv.visibleMapsSql(req, 4); p = p.concat(v.params);
      return db.query('SELECT m.id, m.title, m.doc, COUNT(*) OVER() AS _total FROM mindmaps m WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND ' + v.sql +
        ' AND ' + anyLike(['m.title', 'm.doc::text'], '$2') + ' ORDER BY m.updated_at DESC LIMIT $3', p);
    },
    map: function (r, q) {
      var hitTitle = hasAll(r.title, q);
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
        ' AND ' + anyLike(['f.name', 'f.memo', 'f.tags::text', 'f.text_cache'], '$2') + ' ORDER BY f.updated_at DESC NULLS LAST LIMIT $3', p.concat([c.toks[0]]));
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
        ' WHERE ck.tenant_id = $1 AND ck.project_id IN (' + sub + ') AND ' + anyLike(['ck.items::text'], '$2') + ' ORDER BY ck.updated_at DESC NULLS LAST LIMIT $3', p);
    },
    map: function (r, q) { var n = findNode(r.items, q); return { id: r.id, title: n ? n.text : '(체크리스트)', sub: r.proj_name || '', nav: { projectId: r.project_id, tab: 'lifecycle', phase: r.phase } }; },
    keep: function (it) { return it.title !== '(체크리스트)'; } },   // items 의 다른 칸(작성자 등)만 걸린 경우 빼기
  { key: 'comment',
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var sub = projSub(req, p);
      return db.query('SELECT cm.id, cm.body, cm.author_name, cm.created_at, cm.project_id, p.name AS proj_name, COUNT(*) OVER() AS _total FROM comments cm LEFT JOIN projects p ON p.id = cm.project_id AND p.tenant_id = cm.tenant_id' +
        ' WHERE cm.tenant_id = $1 AND cm.project_id IN (' + sub + ') AND ' + anyLike(['cm.body', 'cm.author_name'], '$2') + ' ORDER BY cm.created_at DESC LIMIT $3', p);
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
      // v13.315 💬 메신저 — 내가 들어가 있는 방의 메시지 (예전 1:1 쪽지도 옮겨 와 있음)
      return db.query("SELECT m.id, m.body, m.created_at, m.room_id, m.user_id, r.kind, COALESCE(r.name, p.name) AS room_name, COALESCE(u.display_name, u.name) AS from_name, " +
        "(SELECT COALESCE(u2.display_name, u2.name) FROM chat_members m2 JOIN users u2 ON u2.id = m2.user_id WHERE m2.room_id = r.id AND m2.user_id <> $4 LIMIT 1) AS peer_name, COUNT(*) OVER() AS _total " +
        'FROM chat_messages m JOIN chat_members cm ON cm.room_id = m.room_id AND cm.user_id = $4 AND cm.left_at IS NULL JOIN chat_rooms r ON r.id = m.room_id LEFT JOIN projects p ON p.id = r.project_id LEFT JOIN users u ON u.id = m.user_id ' +
        'WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND ' + anyLike(['m.body'], '$2') + ' ORDER BY m.id DESC LIMIT $3', [req.tenant.id, c.like, c.limit, req.user.sub]);
    },
    map: function (r, q, req) {
      var where = r.kind === 'dm' ? (r.peer_name || '') : (r.room_name || '대화방');
      return { id: String(r.id), title: snippetOf(r.body, q) || '', sub: '💬 ' + where + ' · ' + (r.from_name || ''), nav: { roomId: r.room_id, messageId: +r.id } };
    } },
  { key: 'event',   // v13.484 📆 달력 일정 — 달력 화면과 같은 범위(프로젝트에 걸린 것은 볼 수 있는 프로젝트만 · 그 밖은 내가 만든 것)
    run: async function (req, c) {
      var p = [req.tenant.id, c.like, c.limit];
      var me = meParam(req, p), sub = projSub(req, p);
      return db.query("SELECT e.id, e.title, e.type, e.start_date, e.end_date, e.start_time, e.memo, e.location, e.assignees, COUNT(*) OVER() AS _total FROM events e WHERE e.tenant_id = $1" +
        " AND ((jsonb_array_length(COALESCE(e.project_ids, '[]'::jsonb)) = 0 AND e.created_by = " + me + ")" +
        " OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(e.project_ids, '[]'::jsonb)) AS _pid WHERE _pid IN (" + sub + ")))" +
        ' AND ' + anyLike(['e.title', 'e.memo', 'e.location', 'e.assignees::text', 'e.start_date'], '$2') + ' ORDER BY e.start_date DESC NULLS LAST LIMIT $3', p);
    },
    map: function (r, q) { return { id: r.id, title: r.title || '(제목 없음)', sub: [r.start_date, r.start_time].filter(Boolean).join(' '), snippet: firstSnip(q, [[r.memo, '메모'], [r.location, '장소'], [r.assignees, '참석']], r.title), nav: { eventId: r.id, date: r.start_date } }; } },
  { key: 'myproj',   // 📁 내 프로젝트(내 업무) — 본인 것만
    run: async function (req, c) {
      return db.query('SELECT id, title, memo, status, start_date, end_date, COUNT(*) OVER() AS _total FROM my_projects WHERE tenant_id = $1 AND user_id = $4 AND deleted_at IS NULL AND ' +
        anyLike(['title', 'memo'], '$2') + ' ORDER BY sort_order, title LIMIT $3', [req.tenant.id, c.like, c.limit, req.user.sub]);
    },
    map: function (r, q) { return { id: r.id, title: r.title, sub: [r.start_date, r.end_date].filter(Boolean).join(' ~ '), snippet: firstSnip(q, [[r.memo, '메모']], r.title), nav: { myProjId: r.id } }; } },
  { key: 'notice',   // 📢 공지사항 — 게시 중인 것
    run: async function (req, c) {
      return db.query("SELECT n.id, n.title, n.body, n.author_name, n.published_at, COUNT(*) OVER() AS _total FROM notices n WHERE n.tenant_id = $1 AND n.status = 'published' AND (n.expires_at IS NULL OR n.expires_at > now()) AND " +
        anyLike(['n.title', 'n.body', 'n.author_name'], '$2') + ' ORDER BY n.published_at DESC NULLS LAST LIMIT $3', [req.tenant.id, c.like, c.limit]);
    },
    map: function (r, q) { return { id: String(r.id), title: r.title, sub: r.author_name || '', snippet: firstSnip(q, [[r.body, '내용']], r.title), nav: { noticeId: +r.id } }; } },
  { key: 'room',   // 💬 대화방 이름 — 내가 들어가 있는 방 (1:1 은 상대 이름)
    run: async function (req, c) {
      return db.query("SELECT * , COUNT(*) OVER() AS _total FROM (SELECT r.id, r.kind, r.last_msg_at, CASE WHEN r.kind = 'dm' THEN (SELECT COALESCE(u2.display_name, u2.name) FROM chat_members m2 JOIN users u2 ON u2.id = m2.user_id WHERE m2.room_id = r.id AND m2.user_id <> $4 LIMIT 1) ELSE COALESCE(r.name, p.name) END AS room_name " +
        'FROM chat_rooms r JOIN chat_members cm ON cm.room_id = r.id AND cm.user_id = $4 AND cm.left_at IS NULL LEFT JOIN projects p ON p.id = r.project_id AND p.tenant_id = r.tenant_id WHERE r.tenant_id = $1 AND r.archived_at IS NULL) x WHERE ' +
        anyLike(['x.room_name'], '$2') + ' ORDER BY x.last_msg_at DESC NULLS LAST LIMIT $3', [req.tenant.id, c.like, c.limit, req.user.sub]);
    },
    map: function (r) { return { id: r.id, title: r.room_name || '대화방', sub: r.kind === 'dm' ? '1:1' : r.kind === 'project' ? '프로젝트 방' : '그룹', nav: { roomId: r.id } }; } },
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
    var toks = tokensOf(q);
    if (!toks.length) return res.json({ data: { q: '', groups: [] } });
    var ctx = { q: q, toks: toks, like: toks.map(likeOf), limit: limit };   // like = 단어별 패턴 배열(text[])
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
module.exports._test = { likeOf: likeOf, snippetOf: snippetOf, findNode: findNode, firstSnip: firstSnip, tokensOf: tokensOf, hasAll: hasAll };
