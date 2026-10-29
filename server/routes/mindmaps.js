/**
 * 마인드맵 라우트 — PRD_마인드맵 Phase 1
 * - 맵 CRUD · 복제 · 즐겨찾기
 * - 사용: 로그인한 모든 사용자. 맵은 소유자와 보낸 사람(editors 편집 · viewers 보기)만 본다 — 관리자도 남의 맵은 못 봄 (v13.249)
 *
 * 규약: 인증 + 테넌트 격리 + 사용 권한(requireMindmapAccess) + 낙관적 락(version) + 소프트 삭제.
 * 맵 범위(scope):
 *   personal — 소유자 + 공유 대상(viewers 읽기 / editors 편집). 관리자도 남의 개인 맵은 볼 수 없다.
 *   project  — 프로젝트 읽기 권한 = 읽기, 프로젝트 편집 권한 = 편집 (lib/project-access)
 *   dept     — 같은 부서 사용 권한자 읽기, 소유자·editors·admin 편집 (Phase 2)
 *   org      — 테넌트 내 사용 권한자 전체 읽기, 소유자·editors·admin 편집
 * 노드 트리는 doc(JSONB) 하나로 저장한다 — { sheets: [{ id, title, structure, root, relations }] }
 * 앱 데이터 참조 노드(node.ref = { type, id })는 저장 때 mindmap_links 로 역인덱스 (Phase 2)
 * 데이터 조회·자동 생성은 lib/mindmap-data, AI 는 services/ai-mindmap.service
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var crypto = require('crypto');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var mmAccess = require('../middleware/mindmap-access');
var pa = require('../lib/project-access');
var authService = require('../services/auth.service');
var httpErr = require('../lib/http-errors');
var mmData = require('../lib/mindmap-data');
var mmVisible = require('../lib/mindmap-visible');
var aiMindmap = require('../services/ai-mindmap.service');
var rateLimit = require('express-rate-limit');
var notificationService = require('../services/notification.service');
var assignNotify = require('../lib/assign-notify');

router.use(auth.authenticate);
router.use(tenant.tenantScope);
router.use(mmAccess.requireMindmapAccess);

var SCOPES = ['personal', 'project', 'dept', 'org'];
var MAX_SHEETS = 20;
var MAX_NODES = 2000;
var MAX_DOC_BYTES = 2 * 1024 * 1024;
// 버전 기록 — 자동 기록은 30분 넘게 쉬었다가 저장할 때 1개, 최근 40개 · 90일까지. 직접 저장은 맵당 100개
var SNAP_AUTO_GAP_MIN = 30;
var SNAP_AUTO_KEEP = 40;
var SNAP_AUTO_DAYS = 90;
var SNAP_MANUAL_MAX = 100;

function genId(prefix) { return prefix + '-' + crypto.randomUUID().slice(0, 12); }
function clampEnum(v, allowed, fallback) { return allowed.indexOf(v) >= 0 ? v : fallback; }
function asArray(v) {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = []; } }
  return Array.isArray(v) ? v : [];
}

/** 새 맵 기본 문서 — 중심 주제 하나 */
function emptyDoc(title) {
  return { sheets: [{ id: 'sh-1', title: '시트 1', structure: 'balanced', root: { id: 'n-root', text: title || '중심 주제', children: [] } }] };
}

/** doc 형식 검증 + 노드 수 계산. 오류 시 { error } */
function inspectDoc(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sheets) || !doc.sheets.length) {
    return { error: '문서 형식이 올바르지 않습니다.' };
  }
  if (doc.sheets.length > MAX_SHEETS) return { error: '시트는 최대 ' + MAX_SHEETS + '개까지 만들 수 있습니다.' };
  var bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
  if (bytes > MAX_DOC_BYTES) return { error: '맵이 너무 큽니다 (최대 2MB).' };
  var count = 0;
  var bad = false;
  function walk(n, depth) {
    if (bad) return;
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || depth > 60) { bad = true; return; }
    count++;
    if (n.children !== undefined && !Array.isArray(n.children)) { bad = true; return; }
    (n.children || []).forEach(function (c) { walk(c, depth + 1); });
  }
  doc.sheets.forEach(function (s) { walk(s && s.root, 0); });
  if (bad) return { error: '노드 형식이 올바르지 않습니다.' };
  if (count > MAX_NODES) return { error: '노드는 최대 ' + MAX_NODES + '개까지 만들 수 있습니다.' };
  return { count: count };
}

/** 보낼 사람 정리 — 같은 테넌트 · 활성 사용자만 남긴다 */
async function sanitizeShareList(req, ids) {
  ids = asArray(ids).filter(function (x) { return typeof x === 'string' && x !== req.user.sub; });
  if (!ids.length) return [];
  var r = await db.query(
    "SELECT u.id FROM users u WHERE u.tenant_id = $1 AND u.status = 'active' AND u.id::text = ANY($2)",
    [req.tenant.id, ids]
  );
  var ok = {};
  r.rows.forEach(function (u) { ok[u.id] = true; });
  return ids.filter(function (id, i) { return ok[id] && ids.indexOf(id) === i; });
}

/** 행 기준 읽기/편집 권한 → { read, edit } — 소유자 · 편집으로 받은 사람 = 편집, 보기로 받은 사람 = 읽기 (v13.249) */
async function permsOf(req, row) {
  var me = req.user.sub;
  if (row.owner_id === me || asArray(row.editors).indexOf(me) >= 0) return { read: true, edit: true };
  return { read: asArray(row.viewers).indexOf(me) >= 0, edit: false };
}

/** 범위별 부서 id 결정 — dept 는 내 부서(관리자는 지정 가능). 오류 시 { error } */
function deptFor(req, scope, b, cur) {
  if (scope !== 'dept') return { id: null };
  var want = b.departmentId || b.department_id || null;
  if (want && req.user.role === 'admin') return { id: want };
  var mine = req.user.departmentId || (cur && cur.department_id) || null;
  if (!mine) return { error: '소속 부서가 없어 팀 맵을 만들 수 없습니다.' };
  return { id: mine };
}

/* ═══ 주제 안 이미지 (v13.220) — node.blocks [{ t: 'img', id }] · 058_mindmap_images ═══ */
var MAX_IMAGES = 50;
var MAX_IMG_CHARS = 2 * 1024 * 1024;   // data URI 길이 (클라에서 긴 변 1600px 로 줄여 올림)
var IMG_SRC_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/** 문서가 쓰는 이미지 id */
function imageIdsOfDoc(doc) {
  var out = {};
  ((doc && doc.sheets) || []).forEach(function (sh) {
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      (Array.isArray(n.blocks) ? n.blocks : []).forEach(function (b) { if (b && b.t === 'img' && b.id) out[String(b.id)] = true; });
      (n.children || []).forEach(walk);
    })(sh && sh.root);
  });
  return Object.keys(out);
}

/** 문서에서 빠진 이미지는 unref_at 표시, 다시 쓰이면 해제, 7일 지난 것은 삭제 (실패해도 저장은 유지) */
async function syncImages(req, mapId, doc) {
  try {
    var ids = imageIdsOfDoc(doc);
    await db.query('UPDATE mindmap_images SET unref_at = now() WHERE map_id = $1 AND tenant_id = $2 AND unref_at IS NULL AND NOT (id = ANY($3))', [mapId, req.tenant.id, ids]);
    if (ids.length) await db.query('UPDATE mindmap_images SET unref_at = NULL WHERE map_id = $1 AND tenant_id = $2 AND unref_at IS NOT NULL AND id = ANY($3)', [mapId, req.tenant.id, ids]);
    // 버전 기록이 쓰는 이미지는 지우지 않음 (되돌리면 다시 보여야 하므로) — 개수 제한에는 지금 문서 것만 셈
    await db.query(
      "DELETE FROM mindmap_images i WHERE i.map_id = $1 AND i.tenant_id = $2 AND i.unref_at < now() - interval '7 days' " +
      'AND NOT EXISTS (SELECT 1 FROM mindmap_snapshots s WHERE s.map_id = i.map_id AND s.tenant_id = i.tenant_id AND i.id = ANY(s.image_ids))',
      [mapId, req.tenant.id]
    );
  } catch (e) {
    console.error('[mindmaps/syncImages]', e.message);
  }
}

/** 참조 노드 역인덱스 다시 계산 (실패해도 저장은 유지) */
async function syncLinks(req, mapId, doc) {
  try {
    var refs = mmData.refsOfDoc(doc);
    await db.query('DELETE FROM mindmap_links WHERE map_id = $1 AND tenant_id = $2', [mapId, req.tenant.id]);
    if (!refs.length) return;
    var vals = [], params = [mapId, req.tenant.id];
    var seen = {};
    refs.forEach(function (r) {
      if (seen[r.nodeId]) return;
      seen[r.nodeId] = true;
      params.push(r.nodeId.slice(0, 60), r.type, r.id.slice(0, 100));
      var b = params.length;
      vals.push('($1,$2,$' + (b - 2) + ',$' + (b - 1) + ',$' + b + ')');
    });
    await db.query('INSERT INTO mindmap_links (map_id, tenant_id, node_id, link_type, link_id) VALUES ' + vals.join(','), params);
  } catch (e) {
    console.error('[mindmaps/syncLinks]', e.message);
  }
}

/* ═══ 버전 기록 ═══ */
/** 스냅샷 1개 저장 → 행. at = 이 상태가 저장된 시각(기본 now) */
async function insertSnapshot(req, row, kind, label, at) {
  var doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;
  var r = await db.query(
    'INSERT INTO mindmap_snapshots (id, map_id, tenant_id, kind, label, title, doc, node_count, map_version, image_ids, created_by, created_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, now())) RETURNING id, kind, label, title, node_count, map_version, created_by, created_at',
    [genId('snap'), row.id, req.tenant.id, kind, label || null, row.title, JSON.stringify(doc), row.node_count || 0, row.version,
      imageIdsOfDoc(doc), kind === 'auto' ? row.updated_by : req.user.sub, at || null]
  );
  return r.rows[0];
}

/**
 * 저장 직전 자동 기록 — 마지막 기록(또는 맵 저장)에서 30분 넘게 지났으면, 지금까지 저장된 상태를 남긴다.
 * 같은 맵 버전은 두 번 남기지 않고, 오래된 자동 기록은 정리. 실패해도 저장은 계속.
 */
async function autoSnapshot(req, row) {
  try {
    if (!row.updated_at || row.version <= 1) return;
    var last = await db.query('SELECT MAX(created_at) AS at, BOOL_OR(map_version = $3) AS same FROM mindmap_snapshots WHERE map_id = $1 AND tenant_id = $2',
      [row.id, req.tenant.id, row.version]);
    var l = last.rows[0] || {};
    if (l.same) return;
    var gapMs = SNAP_AUTO_GAP_MIN * 60000;
    var lastAt = l.at ? new Date(l.at).getTime() : 0;
    var sinceSnap = Date.now() - lastAt;
    var idle = Date.now() - new Date(row.updated_at).getTime() >= gapMs;
    if (sinceSnap < gapMs) return;
    if (!idle && sinceSnap < gapMs * 4) return;   // 쉬지 않고 계속 편집해도 2시간마다는 남김
    await insertSnapshot(req, row, 'auto', null, row.updated_at);
    await db.query(
      "DELETE FROM mindmap_snapshots WHERE map_id = $1 AND tenant_id = $2 AND kind <> 'manual' AND (created_at < now() - make_interval(days => $3::int) OR id IN (" +
      "SELECT id FROM mindmap_snapshots WHERE map_id = $1 AND tenant_id = $2 AND kind <> 'manual' ORDER BY created_at DESC OFFSET $4))",
      [row.id, req.tenant.id, SNAP_AUTO_DAYS, SNAP_AUTO_KEEP]
    );
  } catch (e) {
    console.error('[mindmaps/autoSnapshot]', e.message);
  }
}

async function loadRow(req, id) {
  var r = await db.query(
    'SELECT m.*, COALESCE(NULLIF(u.display_name, \'\'), u.name) AS owner_name, p.name AS project_name, dp.name AS department_name ' +
    'FROM mindmaps m LEFT JOIN users u ON u.id = m.owner_id ' +
    'LEFT JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id ' +
    'LEFT JOIN departments dp ON dp.id = m.department_id ' +
    'WHERE m.id = $1 AND m.tenant_id = $2 AND m.deleted_at IS NULL',
    [id, req.tenant.id]
  );
  return r.rows[0] || null;
}

// GET /api/mindmaps/members — 보내기 · 담당자 선택용 (같은 테넌트 활성 사용자)
router.get('/members', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT u.id, COALESCE(NULLIF(u.display_name,''), u.name) AS name, TRUE AS has_access " +
      "FROM users u WHERE u.tenant_id = $1 AND u.status = 'active' ORDER BY name",
      [req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/members]', e);
  }
});

/* ═══ 앱 데이터 연동 (Phase 2) ═══ */

// POST /api/mindmaps/resolve — 참조 노드 상태 { refs: [{ type, id }] } → { 'type:id': 요약 | {locked} | {missing} }
router.post('/resolve', async function (req, res) {
  try {
    var refs = Array.isArray(req.body && req.body.refs) ? req.body.refs : [];
    res.json({ data: await mmData.resolve(req, refs) });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/resolve]', e);
  }
});

// GET /api/mindmaps/search-refs?type=&q=&projectId= — 연결할 항목 검색
router.get('/search-refs', async function (req, res) {
  try {
    var type = req.query.type;
    if (mmData.REF_TYPES.indexOf(type) < 0) return httpErr.sendError(res, 400, 'VALIDATION', '알 수 없는 항목 종류입니다.');
    res.json({ data: await mmData.search(req, type, req.query.q, req.query.projectId || null) });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/search-refs]', e);
  }
});

// POST /api/mindmaps/generate — 자동 생성 초안 { kind: project|team|mine, projectId?, departmentId? } → { title, structure, root }
router.post('/generate', async function (req, res) {
  try {
    var b = req.body || {};
    var out = await mmData.generate(req, b.kind, { projectId: b.projectId, departmentId: b.departmentId, meetingId: b.meetingId });
    if (!out) return httpErr.sendError(res, 404, 'NOT_FOUND', '만들 수 없습니다 — 항목이 없거나 권한이 없습니다.');
    res.json({ data: out });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/generate]', e);
  }
});

// GET /api/mindmaps/by-link?type=&id= — 이 항목을 참조하는 맵 (내가 볼 수 있는 것만)
router.get('/by-link', async function (req, res) {
  try {
    var type = req.query.type, id = req.query.id;
    if (mmData.REF_TYPES.indexOf(type) < 0 || !id) return httpErr.sendError(res, 400, 'VALIDATION', 'type · id 필수');
    var r = await db.query(
      'SELECT DISTINCT m.id FROM mindmap_links l JOIN mindmaps m ON m.id = l.map_id ' +
      'WHERE l.tenant_id = $1 AND l.link_type = $2 AND l.link_id = $3 AND m.deleted_at IS NULL',
      [req.tenant.id, type, String(id)]
    );
    var out = [];
    for (var i = 0; i < r.rows.length && out.length < 30; i++) {
      var row = await loadRow(req, r.rows[i].id);
      if (!row || !(await permsOf(req, row)).read) continue;
      out.push({ id: row.id, title: row.title, scope: row.scope, owner_name: row.owner_name, updated_at: row.updated_at, node_count: row.node_count });
    }
    // 프로젝트에 귀속된 맵도 함께 (참조 노드가 없어도)
    if (type === 'project') {
      var pr = await db.query('SELECT id FROM mindmaps WHERE tenant_id = $1 AND project_id = $2 AND deleted_at IS NULL', [req.tenant.id, String(id)]);
      for (var j = 0; j < pr.rows.length; j++) {
        if (out.some(function (o) { return o.id === pr.rows[j].id; })) continue;
        var row2 = await loadRow(req, pr.rows[j].id);
        if (row2 && (await permsOf(req, row2)).read) out.push({ id: row2.id, title: row2.title, scope: row2.scope, owner_name: row2.owner_name, updated_at: row2.updated_at, node_count: row2.node_count });
      }
    }
    out.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
    res.json({ data: out });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/by-link]', e);
  }
});

/* ═══ AI (Phase 2) — 사용자당 시간당 30회 · 월 사용량은 ai_query_usage 에 기록 ═══ */
var aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: function (req) { return (req.user && req.user.sub) || req.ip; },
  message: { error: 'RATE_LIMIT', message: 'AI 호출 한도(30/시간)를 초과했습니다. 잠시 후 다시 시도하세요.' },
  standardHeaders: true, legacyHeaders: false
});

// GET /api/mindmaps/ai/status — AI 사용 가능 여부 (버튼 표시용)
router.get('/ai/status', function (req, res) {
  res.json({ data: { ready: aiMindmap.isReady() } });
});

// POST /api/mindmaps/ai — { action: expand|fromText|wbs|summarize, ... }
router.post('/ai', aiLimiter, async function (req, res) {
  try {
    if (!aiMindmap.isReady()) return httpErr.sendError(res, 503, 'AI_NOT_READY', 'AI 기능 미설정 — 서버의 ANTHROPIC_API_KEY 환경변수를 채운 뒤 재시작하세요.');
    var b = req.body || {};
    var result;
    if (b.action === 'expand') {
      if (!Array.isArray(b.path) || !b.path.length) return httpErr.sendError(res, 400, 'VALIDATION', 'path 필수');
      result = await aiMindmap.expand({ path: b.path.slice(0, 20), siblings: (b.siblings || []).slice(0, 30), existing: (b.existing || []).slice(0, 50), note: b.note });
    } else if (b.action === 'fromText') {
      if (!b.text || !String(b.text).trim()) return httpErr.sendError(res, 400, 'VALIDATION', '정리할 내용을 입력하세요.');
      result = await aiMindmap.fromText({ text: String(b.text), title: b.title });
    } else if (b.action === 'wbs') {
      var pid = b.projectId;
      if (!pid) return httpErr.sendError(res, 400, 'VALIDATION', '프로젝트를 선택하세요.');
      if (!await pa.gateRead(req, res, pid)) return;
      var pr = (await db.query('SELECT name, order_no, start_date, end_date, current_phase, memo, specs FROM projects WHERE id = $1 AND tenant_id = $2', [pid, req.tenant.id])).rows[0];
      var ms = (await db.query('SELECT name FROM milestones WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order LIMIT 60', [pid, req.tenant.id])).rows;
      var specs = pr.specs ? JSON.stringify(pr.specs) : '';
      result = await aiMindmap.wbs({
        project: { name: pr.name, orderNo: pr.order_no, start: pr.start_date, end: pr.end_date, phase: pr.current_phase, memo: pr.memo, specs: specs && specs !== '{}' && specs !== 'null' ? specs : '' },
        milestones: ms.map(function (m) { return m.name; }),
        extra: b.extra
      });
    } else if (b.action === 'summarize') {
      if (!b.outline || !String(b.outline).trim()) return httpErr.sendError(res, 400, 'VALIDATION', '요약할 내용이 없습니다.');
      result = await aiMindmap.summarize({ outline: String(b.outline) });
    } else if (b.action === 'risk') {
      if (!b.outline || !String(b.outline).trim()) return httpErr.sendError(res, 400, 'VALIDATION', '점검할 내용이 없습니다.');
      result = await aiMindmap.riskReview({ outline: String(b.outline), findings: String(b.findings || ''), today: String(b.today || '').slice(0, 10) });
    } else {
      return httpErr.sendError(res, 400, 'VALIDATION', '알 수 없는 AI 동작입니다.');
    }
    db.query('INSERT INTO ai_query_usage (tenant_id, user_id, query_text, provider) VALUES ($1, $2, $3, $4)',
      [req.tenant.id, req.user.sub, ('mindmap.' + b.action).slice(0, 500), 'anthropic']).catch(function () {});
    authService.auditLog(req.user.sub, 'mindmap.ai_' + b.action, 'mindmap', b.mapId || null, { usage: result.usage }, req).catch(function () {});
    delete result.usage;
    res.json({ data: result });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/ai]', e);
  }
});

/* ═══ 맵 ═══ */

// GET /api/mindmaps?scope=&projectId=&q= — 목록 (doc 제외)
router.get('/', async function (req, res) {
  try {
    var vis = mmVisible.visibleMapsSql(req, 2);
    var params = [req.tenant.id].concat(vis.params);
    var idx = vis.nextIdx;
    var visible = vis.sql;
    var sql = 'SELECT m.id, m.title, m.scope, m.owner_id, m.project_id, m.editors, m.viewers, m.theme, m.template, ' +
      'm.node_count, m.pinned_by, m.version, m.created_at, m.updated_at, m.updated_by, ' +
      "COALESCE(NULLIF(u.display_name,''), u.name) AS owner_name, " +
      "COALESCE(NULLIF(uu.display_name,''), uu.name) AS updated_by_name, p.name AS project_name, m.department_id, dp.name AS department_name, " +
      "m.doc->'sheets'->0->'root'->>'text' AS root_text " +
      'FROM mindmaps m LEFT JOIN users u ON u.id = m.owner_id LEFT JOIN users uu ON uu.id = m.updated_by ' +
      'LEFT JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id ' +
      'LEFT JOIN departments dp ON dp.id = m.department_id ' +
      'WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND ' + visible;
    if (req.query.scope && SCOPES.indexOf(req.query.scope) >= 0) {
      sql += ' AND m.scope = $' + idx++; params.push(req.query.scope);
    }
    if (req.query.projectId) { sql += ' AND m.project_id = $' + idx++; params.push(req.query.projectId); }
    if (req.query.q) { sql += ' AND m.title ILIKE $' + idx++; params.push('%' + req.query.q + '%'); }
    sql += ' ORDER BY m.updated_at DESC LIMIT 500';
    var r = await db.query(sql, params);
    res.json({ data: r.rows, total: r.rows.length });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/list]', e);
  }
});

// GET /api/mindmaps/search?q= — v13.267 내용 검색: 볼 수 있는 맵의 제목 · 주제 · 내용 줄 · 메모 · 라벨에서 찾음.
// 맵마다 맞은 주제(시트 · 위 단계 경로 포함) 최대 5개와 전체 개수
router.get('/search', async function (req, res) {
  try {
    var q = String(req.query.q || '').trim().slice(0, 100);
    if (!q) return res.json({ data: [] });
    var vis = mmVisible.visibleMapsSql(req, 2);
    var params = [req.tenant.id].concat(vis.params);
    var like = '%' + q.replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%';
    params.push(like);
    var li = '$' + vis.nextIdx;
    var r = await db.query(
      'SELECT m.id, m.title, m.doc FROM mindmaps m WHERE m.tenant_id = $1 AND m.deleted_at IS NULL AND ' + vis.sql +
      ' AND (m.title ILIKE ' + li + ' OR m.doc::text ILIKE ' + li + ') ORDER BY m.updated_at DESC LIMIT 300', params);
    var ql = q.toLowerCase();
    var out = [];
    r.rows.forEach(function (row) {
      var doc = row.doc;
      if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (_) { doc = null; } }
      var hits = [], total = 0;
      ((doc && doc.sheets) || []).forEach(function (sh, si) {
        (function walk(n, path) {
          if (!n) return;
          var lines = (n.blocks || []).map(function (b) { return b && b.t === 'text' ? b.v || '' : ''; }).join(' ');
          var where = String(n.text || '').toLowerCase().indexOf(ql) >= 0 ? 'text'
            : lines.toLowerCase().indexOf(ql) >= 0 ? 'blocks'
            : String(n.note || '').toLowerCase().indexOf(ql) >= 0 ? 'note'
            : (n.labels || []).join(' ').toLowerCase().indexOf(ql) >= 0 ? 'label' : '';
          if (where) {
            total++;
            if (hits.length < 5) {
              var src = where === 'text' ? n.text : where === 'blocks' ? lines : where === 'note' ? n.note : (n.labels || []).join(', ');
              var at = String(src || '').toLowerCase().indexOf(ql);
              var snip = String(src || '').slice(Math.max(0, at - 30), at + ql.length + 50);
              hits.push({ sheet: si, sheetTitle: sh.title || '', node: n.id, text: String(n.text || '').slice(0, 120), where: where, snip: snip, path: path.slice(-3) });
            }
          }
          (n.children || []).forEach(function (c) { walk(c, path.concat([String(n.text || '').slice(0, 40)])); });
        })(sh.root, []);
      });
      var titleHit = String(row.title || '').toLowerCase().indexOf(ql) >= 0;
      if (total || titleHit) out.push({ id: row.id, titleHit: titleHit, total: total, hits: hits });
    });
    res.json({ data: out });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/search]', e);
  }
});

// GET /api/mindmaps/:id — 단건 (doc + 내 권한)
router.get('/:id', async function (req, res) {
  try {
    var row = await loadRow(req, req.params.id);
    if (!row) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var perm = await permsOf(req, row);
    if (!perm.read) return httpErr.sendError(res, 404, 'NOT_FOUND');
    row.can_edit = perm.edit;
    row.is_owner = row.owner_id === req.user.sub;
    res.json({ data: row });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/get]', e);
  }
});

// POST /api/mindmaps — 생성 { title, scope, projectId, doc? }
router.post('/', async function (req, res) {
  try {
    var b = req.body || {};
    var title = String(b.title || '').trim().slice(0, 255);
    if (!title) return httpErr.sendError(res, 400, 'VALIDATION', '제목을 입력하세요.');
    var scope = clampEnum(b.scope, SCOPES, 'personal');
    var projectId = scope === 'project' ? (b.projectId || b.project_id || null) : null;
    if (scope === 'project') {
      if (!projectId) return httpErr.sendError(res, 400, 'VALIDATION', '프로젝트를 선택하세요.');
      if (!await pa.gateRead(req, res, projectId)) return;
    }
    if (scope === 'org' && req.user.role !== 'admin') {
      return httpErr.sendError(res, 403, 'FORBIDDEN', '조직 맵은 관리자만 만들 수 있습니다.');
    }
    var dept = deptFor(req, scope, b, null);
    if (dept.error) return httpErr.sendError(res, 400, 'VALIDATION', dept.error);
    var doc = b.doc || emptyDoc(title);
    var info = inspectDoc(doc);
    if (info.error) return httpErr.sendError(res, 400, 'VALIDATION', info.error);
    var editors = await sanitizeShareList(req, b.editors);
    var viewers = await sanitizeShareList(req, b.viewers);
    var id = genId('mm');
    var r = await db.query(
      'INSERT INTO mindmaps (id, tenant_id, title, scope, owner_id, project_id, department_id, editors, viewers, template, doc, node_count, created_by, updated_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$5,$5) RETURNING *',
      [id, req.tenant.id, title, scope, req.user.sub, projectId, dept.id, JSON.stringify(editors), JSON.stringify(viewers),
        (b.template || null), JSON.stringify(doc), info.count]
    );
    await syncLinks(req, id, doc);
    var row = r.rows[0];
    row.can_edit = true;
    row.is_owner = true;
    res.status(201).json({ data: row });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/create]', e);
  }
});

// PUT /api/mindmaps/:id — 저장 { version, title?, doc?, scope?, projectId?, editors?, viewers?, theme? }
router.put('/:id', async function (req, res) {
  try {
    var row = await loadRow(req, req.params.id);
    if (!row) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var perm = await permsOf(req, row);
    if (!perm.read) return httpErr.sendError(res, 404, 'NOT_FOUND');
    if (!perm.edit) return httpErr.sendError(res, 403, 'FORBIDDEN', '편집 권한이 없습니다.');
    var b = req.body || {};
    var ver = parseInt(b.version, 10);
    if (!ver) return httpErr.sendError(res, 400, 'VALIDATION', 'version 필수');
    var isOwner = row.owner_id === req.user.sub;

    var sets = [];
    var params = [];
    var idx = 1;
    function set(col, val) { sets.push(col + ' = $' + idx++); params.push(val); }

    if (b.title !== undefined) {
      var title = String(b.title || '').trim().slice(0, 255);
      if (!title) return httpErr.sendError(res, 400, 'VALIDATION', '제목을 입력하세요.');
      set('title', title);
    }
    if (b.doc !== undefined) {
      var info = inspectDoc(b.doc);
      if (info.error) return httpErr.sendError(res, 400, 'VALIDATION', info.error);
      if (parseInt(row.version, 10) === ver) await autoSnapshot(req, row);
      set('doc', JSON.stringify(b.doc));
      set('node_count', info.count);
    }
    if (b.theme !== undefined) set('theme', String(b.theme || 'default').slice(0, 20));
    // 범위·공유 설정은 소유자(또는 admin)만
    var shareKeys = ['scope', 'projectId', 'project_id', 'departmentId', 'department_id', 'editors', 'viewers'];
    var touchesShare = shareKeys.some(function (k) { return b[k] !== undefined; });
    if (touchesShare && !isOwner) {
      return httpErr.sendError(res, 403, 'FORBIDDEN', '공유 설정은 소유자만 바꿀 수 있습니다.');
    }
    if (b.scope !== undefined) {
      var scope = clampEnum(b.scope, SCOPES, row.scope);
      if (scope === 'org' && req.user.role !== 'admin') return httpErr.sendError(res, 403, 'FORBIDDEN', '조직 맵은 관리자만 지정할 수 있습니다.');
      var projectId = scope === 'project' ? (b.projectId || b.project_id || row.project_id) : null;
      if (scope === 'project') {
        if (!projectId) return httpErr.sendError(res, 400, 'VALIDATION', '프로젝트를 선택하세요.');
        if (!await pa.gateRead(req, res, projectId)) return;
      }
      var dept = deptFor(req, scope, b, row);
      if (dept.error) return httpErr.sendError(res, 400, 'VALIDATION', dept.error);
      set('scope', scope);
      set('project_id', projectId);
      set('department_id', dept.id);
    }
    if (b.editors !== undefined) set('editors', JSON.stringify(await sanitizeShareList(req, b.editors)));
    if (b.viewers !== undefined) set('viewers', JSON.stringify(await sanitizeShareList(req, b.viewers)));
    if (!sets.length) return httpErr.sendError(res, 400, 'BAD_REQUEST', '수정할 항목이 없습니다.');

    sets.push('updated_by = $' + idx++); params.push(req.user.sub);
    sets.push('updated_at = now()');
    sets.push('version = version + 1');
    params.push(req.params.id); var idIdx = idx++;
    params.push(req.tenant.id); var tIdx = idx++;
    params.push(ver); var vIdx = idx++;
    var r = await db.query(
      'UPDATE mindmaps SET ' + sets.join(', ') + ' WHERE id = $' + idIdx + ' AND tenant_id = $' + tIdx +
      ' AND deleted_at IS NULL AND version = $' + vIdx + ' RETURNING id, version, updated_at, title, scope, project_id, department_id, editors, viewers, node_count',
      params
    );
    if (!r.rows.length) {
      var cur = await db.query(
        "SELECT m.version, m.updated_at, COALESCE(NULLIF(u.display_name,''), u.name) AS updated_by_name " +
        'FROM mindmaps m LEFT JOIN users u ON u.id = m.updated_by WHERE m.id = $1 AND m.tenant_id = $2',
        [req.params.id, req.tenant.id]
      );
      return httpErr.sendError(res, 409, 'CONFLICT', '다른 사용자가 먼저 저장했습니다.', { latest: cur.rows[0] || null, yourVersion: ver });
    }
    if (b.doc !== undefined) { await syncLinks(req, req.params.id, b.doc); await syncImages(req, req.params.id, b.doc); }
    res.json({ data: r.rows[0] });
    if (b.doc !== undefined) assignNotify.mindmapChanged(req.tenant.id, req.user.sub, req.user.name, Object.assign({ owner_id: row.owner_id }, r.rows[0]), row.doc, b.doc);   // 새로 담당이 된 사람에게 (응답 후)
    // 새로 공유받은 사람에게 알림 (응답 후)
    if (b.editors !== undefined || b.viewers !== undefined) {
      var before = asArray(row.editors).concat(asArray(row.viewers));
      var added = asArray(r.rows[0].editors).concat(asArray(r.rows[0].viewers)).filter(function (id, i, a) { return a.indexOf(id) === i && before.indexOf(id) < 0 && id !== req.user.sub; });
      if (added.length) {
        var editSet = asArray(r.rows[0].editors);
        Promise.all([0, 1].map(function (k) {
          var ids = added.filter(function (id) { return (editSet.indexOf(id) >= 0) === (k === 0); });
          return ids.length ? notificationService.notify('mindmap_shared', { mapTitle: r.rows[0].title, byName: req.user.name || '', canEdit: k === 0 }, ids) : null;
        })).catch(function (e) { console.error('[mindmaps/share/notify]', e.message); });
      }
    }
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/update]', e);
  }
});

// GET /api/mindmaps/:id/images — 이 맵의 이미지 (읽기 권한)
router.get('/:id/images', async function (req, res) {
  try {
    var row = await loadRow(req, req.params.id);
    if (!row || !(await permsOf(req, row)).read) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var r = await db.query('SELECT id, src, w, h FROM mindmap_images WHERE map_id = $1 AND tenant_id = $2 ORDER BY created_at', [req.params.id, req.tenant.id]);
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/images/list]', e);
  }
});

// POST /api/mindmaps/:id/images — 올리기 { src: data URI, w, h } → { id } (편집 권한)
router.post('/:id/images', async function (req, res) {
  try {
    var row = await loadRow(req, req.params.id);
    if (!row) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var perm = await permsOf(req, row);
    if (!perm.read) return httpErr.sendError(res, 404, 'NOT_FOUND');
    if (!perm.edit) return httpErr.sendError(res, 403, 'FORBIDDEN', '편집 권한이 없습니다.');
    var b = req.body || {};
    var src = String(b.src || '');
    if (!IMG_SRC_RE.test(src)) return httpErr.sendError(res, 400, 'VALIDATION', 'PNG · JPEG · WebP · GIF 이미지만 넣을 수 있습니다.');
    if (src.length > MAX_IMG_CHARS) return httpErr.sendError(res, 400, 'VALIDATION', '이미지가 너무 큽니다 (최대 약 1.5MB).');
    var cnt = await db.query('SELECT COUNT(*)::int AS n FROM mindmap_images WHERE map_id = $1 AND tenant_id = $2 AND unref_at IS NULL', [req.params.id, req.tenant.id]);
    if (cnt.rows[0].n >= MAX_IMAGES) return httpErr.sendError(res, 400, 'LIMIT', '맵 하나에 이미지는 ' + MAX_IMAGES + '장까지 넣을 수 있습니다.');
    var id = genId('img');
    var w = clampIntPx(b.w), h = clampIntPx(b.h);
    await db.query(
      'INSERT INTO mindmap_images (map_id, id, tenant_id, src, w, h, bytes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.params.id, id, req.tenant.id, src, w, h, Math.round(src.length * 0.75), req.user.sub]
    );
    res.status(201).json({ data: { id: id, w: w, h: h } });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/images/create]', e);
  }
});
function clampIntPx(v) { var n = parseInt(v, 10); return (n > 0 && n < 20000) ? n : null; }

// PUT /api/mindmaps/:id/pin — 즐겨찾기 { pinned }
router.put('/:id/pin', async function (req, res) {
  try {
    var row = await loadRow(req, req.params.id);
    if (!row || !(await permsOf(req, row)).read) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var me = req.user.sub;
    var list = asArray(row.pinned_by).filter(function (x) { return x !== me; });
    if (req.body && req.body.pinned) list.push(me);
    // version 은 올리지 않는다 — 즐겨찾기가 편집 중인 다른 사람의 저장과 충돌하지 않도록
    await db.query('UPDATE mindmaps SET pinned_by = $1 WHERE id = $2 AND tenant_id = $3', [JSON.stringify(list), req.params.id, req.tenant.id]);
    res.json({ data: { pinned: list.indexOf(me) >= 0 } });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/pin]', e);
  }
});

// POST /api/mindmaps/:id/duplicate — 복제 (내 개인 맵으로)
router.post('/:id/duplicate', async function (req, res) {
  try {
    var row = await loadRow(req, req.params.id);
    if (!row || !(await permsOf(req, row)).read) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var id = genId('mm');
    var title = (String((req.body && req.body.title) || '') || (row.title + ' (복사본)')).slice(0, 255);
    var r = await db.query(
      "INSERT INTO mindmaps (id, tenant_id, title, scope, owner_id, theme, template, doc, node_count, created_by, updated_by) " +
      "VALUES ($1,$2,$3,'personal',$4,$5,$6,$7,$8,$4,$4) RETURNING *",
      [id, req.tenant.id, title, req.user.sub, row.theme, row.template, JSON.stringify(row.doc), row.node_count]
    );
    await syncLinks(req, id, row.doc);
    // 이미지도 같은 id 로 복사 — 복사본 문서가 그대로 이미지를 찾도록
    await db.query(
      'INSERT INTO mindmap_images (map_id, id, tenant_id, src, w, h, bytes, created_by) ' +
      'SELECT $1, id, tenant_id, src, w, h, bytes, $2 FROM mindmap_images WHERE map_id = $3 AND tenant_id = $4 AND unref_at IS NULL',
      [id, req.user.sub, req.params.id, req.tenant.id]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/duplicate]', e);
  }
});

// DELETE /api/mindmaps/:id — 소프트 삭제 (소유자 · admin(개인 맵 제외))
router.delete('/:id', async function (req, res) {
  try {
    var row = await loadRow(req, req.params.id);
    if (!row || !(await permsOf(req, row)).read) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var isOwner = row.owner_id === req.user.sub;
    if (!isOwner) {
      return httpErr.sendError(res, 403, 'FORBIDDEN', '소유자만 삭제할 수 있습니다.');
    }
    await db.query(
      'UPDATE mindmaps SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL',
      [req.user.sub, req.params.id, req.tenant.id]
    );
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/delete]', e);
  }
});

/* ═══ 버전 기록 API ═══ */
async function snapGate(req, res, needEdit) {
  var row = await loadRow(req, req.params.id);
  if (!row) { httpErr.sendError(res, 404, 'NOT_FOUND'); return null; }
  var perm = await permsOf(req, row);
  if (!perm.read) { httpErr.sendError(res, 404, 'NOT_FOUND'); return null; }
  if (needEdit && !perm.edit) { httpErr.sendError(res, 403, 'FORBIDDEN', '편집 권한이 없습니다.'); return null; }
  row._perm = perm;
  return row;
}
function snapLabel(v) { return String(v == null ? '' : v).trim().slice(0, 100); }

// GET /api/mindmaps/:id/snapshots — 기록 목록 (문서 제외, 최근 순)
router.get('/:id/snapshots', async function (req, res) {
  try {
    var row = await snapGate(req, res, false);
    if (!row) return;
    var r = await db.query(
      "SELECT s.id, s.kind, s.label, s.title, s.node_count, s.map_version, s.created_by, s.created_at, COALESCE(NULLIF(u.display_name,''), u.name) AS created_by_name " +
      'FROM mindmap_snapshots s LEFT JOIN users u ON u.id = s.created_by WHERE s.map_id = $1 AND s.tenant_id = $2 ORDER BY s.created_at DESC LIMIT 300',
      [row.id, req.tenant.id]
    );
    var me = req.user.sub, mgr = row.owner_id === me;
    res.json({ data: r.rows.map(function (s) { s.can_edit = row._perm.edit && (mgr || s.created_by === me); return s; }) });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/snapshots/list]', e);
  }
});

// GET /api/mindmaps/:id/snapshots/:sid — 기록 1개 (문서 포함)
router.get('/:id/snapshots/:sid', async function (req, res) {
  try {
    var row = await snapGate(req, res, false);
    if (!row) return;
    var r = await db.query('SELECT * FROM mindmap_snapshots WHERE id = $1 AND map_id = $2 AND tenant_id = $3', [req.params.sid, row.id, req.tenant.id]);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/snapshots/get]', e);
  }
});

// POST /api/mindmaps/:id/snapshots — 지금 저장된 상태를 이름 붙여 기록 { label }
router.post('/:id/snapshots', async function (req, res) {
  try {
    var row = await snapGate(req, res, true);
    if (!row) return;
    var cnt = await db.query("SELECT COUNT(*)::int AS n FROM mindmap_snapshots WHERE map_id = $1 AND tenant_id = $2 AND kind = 'manual'", [row.id, req.tenant.id]);
    if (cnt.rows[0].n >= SNAP_MANUAL_MAX) return httpErr.sendError(res, 400, 'LIMIT', '직접 저장한 버전은 ' + SNAP_MANUAL_MAX + '개까지 둘 수 있습니다. 오래된 것을 지워 주세요.');
    var s = await insertSnapshot(req, row, 'manual', snapLabel(req.body && req.body.label) || null, null);
    res.status(201).json({ data: s });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/snapshots/create]', e);
  }
});

// PUT /api/mindmaps/:id/snapshots/:sid — 이름 바꾸기 { label }. 자동 기록에 이름을 붙이면 직접 저장으로 (정리 대상에서 빠짐)
router.put('/:id/snapshots/:sid', async function (req, res) {
  try {
    var row = await snapGate(req, res, true);
    if (!row) return;
    var label = snapLabel(req.body && req.body.label);
    var mgr = row.owner_id === req.user.sub;
    var r = await db.query(
      "UPDATE mindmap_snapshots SET label = $1::varchar, kind = CASE WHEN $1::varchar IS NOT NULL AND kind = 'auto' THEN 'manual' ELSE kind END " +
      'WHERE id = $2 AND map_id = $3 AND tenant_id = $4 AND ($5 OR created_by = $6 OR kind = \'auto\') RETURNING id, kind, label',
      [label || null, req.params.sid, row.id, req.tenant.id, mgr, req.user.sub]
    );
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/snapshots/rename]', e);
  }
});

// DELETE /api/mindmaps/:id/snapshots/:sid — 지우기 (만든 사람 · 맵 소유자 · admin)
router.delete('/:id/snapshots/:sid', async function (req, res) {
  try {
    var row = await snapGate(req, res, true);
    if (!row) return;
    var mgr = row.owner_id === req.user.sub;
    var r = await db.query('DELETE FROM mindmap_snapshots WHERE id = $1 AND map_id = $2 AND tenant_id = $3 AND ($4 OR created_by = $5) RETURNING id',
      [req.params.sid, row.id, req.tenant.id, mgr, req.user.sub]);
    if (!r.rows.length) return httpErr.sendError(res, 403, 'FORBIDDEN', '만든 사람이나 맵 소유자만 지울 수 있습니다.');
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/snapshots/delete]', e);
  }
});

// POST /api/mindmaps/:id/snapshots/:sid/restore — 이 버전으로 되돌리기 { version }. 지금 상태는 'restore' 기록으로 먼저 남김
router.post('/:id/snapshots/:sid/restore', async function (req, res) {
  try {
    var row = await snapGate(req, res, true);
    if (!row) return;
    var ver = parseInt(req.body && req.body.version, 10);
    if (!ver) return httpErr.sendError(res, 400, 'VALIDATION', 'version 필수');
    var s = await db.query('SELECT * FROM mindmap_snapshots WHERE id = $1 AND map_id = $2 AND tenant_id = $3', [req.params.sid, row.id, req.tenant.id]);
    if (!s.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var snap = s.rows[0];
    if (parseInt(row.version, 10) !== ver) {
      return httpErr.sendError(res, 409, 'CONFLICT', '다른 사용자가 먼저 저장했습니다.', { latest: { version: row.version, updated_at: row.updated_at }, yourVersion: ver });
    }
    var backup = await insertSnapshot(req, row, 'restore', ('‘' + (snap.label || (snap.kind === 'auto' ? '자동 기록' : '이전 버전')) + '’으로 되돌리기 전').slice(0, 100), null);
    var r = await db.query(
      'UPDATE mindmaps SET doc = $1, node_count = $2, updated_by = $3, updated_at = now(), version = version + 1 ' +
      'WHERE id = $4 AND tenant_id = $5 AND deleted_at IS NULL AND version = $6 RETURNING id, version, updated_at, doc, node_count',
      [JSON.stringify(snap.doc), snap.node_count, req.user.sub, row.id, req.tenant.id, ver]
    );
    if (!r.rows.length) {
      await db.query('DELETE FROM mindmap_snapshots WHERE id = $1', [backup.id]);
      return httpErr.sendError(res, 409, 'CONFLICT', '다른 사용자가 먼저 저장했습니다.', { yourVersion: ver });
    }
    await syncLinks(req, row.id, snap.doc);
    await syncImages(req, row.id, snap.doc);
    res.json({ data: r.rows[0], backup: backup });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/snapshots/restore]', e);
  }
});

/* ═══ 주제 댓글 (v13.237) — 읽기 권한이면 쓰기 가능, 알림: @이름 · 주제 담당 · 같은 주제에 댓글 단 사람 · 맵 소유자 ═══ */
var CMT_MAX = 2000;
var CMT_SELECT = 'SELECT c.id, c.node_id, c.body, c.resolved, c.created_by, c.created_at, c.updated_at, ' +
  "COALESCE(NULLIF(u.display_name,''), u.name) AS author_name FROM mindmap_comments c LEFT JOIN users u ON u.id = c.created_by ";

// GET /api/mindmaps/:id/comments — 맵의 댓글 전부 (오래된 순)
router.get('/:id/comments', async function (req, res) {
  try {
    var row = await snapGate(req, res, false);
    if (!row) return;
    var r = await db.query(CMT_SELECT + 'WHERE c.map_id = $1 AND c.tenant_id = $2 ORDER BY c.created_at LIMIT 2000', [row.id, req.tenant.id]);
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/comments/list]', e);
  }
});

/** 알림 받을 사람 — 맵을 읽을 수 있는 사람으로 한정(개인 맵은 소유자 · 공유 대상만) */
async function commentRecipients(req, row, nodeId, body, assigneeId) {
  var ids = {};
  var users = await db.query("SELECT id, COALESCE(NULLIF(display_name,''), name) AS name FROM users WHERE tenant_id = $1 AND status = 'active'", [req.tenant.id]);
  var byName = {};
  users.rows.forEach(function (u) { if (u.name) byName[String(u.name).replace(/\s+/g, '')] = u.id; });
  (String(body).match(/@([^\s@]+)/g) || []).forEach(function (t) { var id = byName[t.slice(1)]; if (id) ids[id] = 1; });
  if (assigneeId && users.rows.some(function (u) { return u.id === assigneeId; })) ids[assigneeId] = 1;
  var prev = await db.query('SELECT DISTINCT created_by FROM mindmap_comments WHERE map_id = $1 AND tenant_id = $2 AND node_id = $3 AND created_by IS NOT NULL', [row.id, req.tenant.id, nodeId]);
  prev.rows.forEach(function (p) { ids[p.created_by] = 1; });
  if (row.owner_id) ids[row.owner_id] = 1;
  delete ids[req.user.sub];
  var out = Object.keys(ids);
  if (row.scope === 'personal') {
    var allowed = [row.owner_id].concat(asArray(row.editors), asArray(row.viewers));
    out = out.filter(function (id) { return allowed.indexOf(id) >= 0; });
  }
  return out;
}

// POST /api/mindmaps/:id/comments — { nodeId, body, nodeText?, assigneeId? } (nodeText · assigneeId 는 알림용 — 문서는 클라에 있음)
router.post('/:id/comments', async function (req, res) {
  try {
    var row = await snapGate(req, res, false);
    if (!row) return;
    var b = req.body || {};
    var nodeId = String(b.nodeId || '').slice(0, 100);
    var body = String(b.body || '').trim();
    if (!nodeId || !body) return httpErr.sendError(res, 400, 'VALIDATION', '주제와 내용이 필요합니다.');
    if (body.length > CMT_MAX) return httpErr.sendError(res, 400, 'VALIDATION', '댓글은 ' + CMT_MAX + '자까지 쓸 수 있습니다.');
    var id = genId('mmc');
    await db.query('INSERT INTO mindmap_comments (id, map_id, tenant_id, node_id, body, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, row.id, req.tenant.id, nodeId, body, req.user.sub]);
    var r = await db.query(CMT_SELECT + 'WHERE c.id = $1', [id]);
    res.status(201).json({ data: r.rows[0] });
    // 알림 (응답 후)
    commentRecipients(req, row, nodeId, body, b.assigneeId ? String(b.assigneeId) : null).then(function (to) {
      if (!to.length) return;
      return notificationService.notify('mindmap_comment', {
        mapTitle: row.title, nodeText: String(b.nodeText || '').split('\n')[0].slice(0, 80), authorName: r.rows[0].author_name, body: body
      }, to);
    }).catch(function (e) { console.error('[mindmaps/comments/notify]', e.message); });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/comments/create]', e);
  }
});

// PUT /api/mindmaps/:id/comments/:cid — { body? (쓴 사람만), resolved? (쓴 사람 · 맵 편집 권한) }
router.put('/:id/comments/:cid', async function (req, res) {
  try {
    var row = await snapGate(req, res, false);
    if (!row) return;
    var c = await db.query('SELECT * FROM mindmap_comments WHERE id = $1 AND map_id = $2 AND tenant_id = $3', [req.params.cid, row.id, req.tenant.id]);
    if (!c.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var mine = c.rows[0].created_by === req.user.sub;
    var b = req.body || {};
    if (b.body != null) {
      if (!mine) return httpErr.sendError(res, 403, 'FORBIDDEN', '쓴 사람만 고칠 수 있습니다.');
      var body = String(b.body).trim();
      if (!body || body.length > CMT_MAX) return httpErr.sendError(res, 400, 'VALIDATION', '내용은 1~' + CMT_MAX + '자입니다.');
      await db.query('UPDATE mindmap_comments SET body = $1, updated_at = NOW() WHERE id = $2', [body, req.params.cid]);
    }
    if (b.resolved != null) {
      if (!mine && !row._perm.edit) return httpErr.sendError(res, 403, 'FORBIDDEN', '쓴 사람이나 편집 권한이 있는 사람만 해결 처리할 수 있습니다.');
      await db.query('UPDATE mindmap_comments SET resolved = $1 WHERE id = $2', [!!b.resolved, req.params.cid]);
    }
    var r = await db.query(CMT_SELECT + 'WHERE c.id = $1', [req.params.cid]);
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/comments/update]', e);
  }
});

// DELETE /api/mindmaps/:id/comments/:cid — 쓴 사람 · 맵 소유자 · admin
router.delete('/:id/comments/:cid', async function (req, res) {
  try {
    var row = await snapGate(req, res, false);
    if (!row) return;
    var mgr = row.owner_id === req.user.sub;
    var r = await db.query('DELETE FROM mindmap_comments WHERE id = $1 AND map_id = $2 AND tenant_id = $3 AND ($4 OR created_by = $5) RETURNING id',
      [req.params.cid, row.id, req.tenant.id, mgr, req.user.sub]);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: { id: req.params.cid } });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/comments/delete]', e);
  }
});

/* ═══ 주제 첨부 파일 (v13.244) — DB 저장 · 파일당 5MB · 맵당 100개. 목록 · 내려받기 = 읽기, 올리기 · 지우기 = 편집 ═══ */
var FILE_MAX_BYTES = 5 * 1024 * 1024;
var FILE_MAX_COUNT = 100;
var FILE_SELECT = "SELECT f.id, f.node_id, f.name, f.mime, f.size, f.created_by, f.created_at, COALESCE(NULLIF(u.display_name,''), u.name) AS author_name " +
  'FROM mindmap_files f LEFT JOIN users u ON u.id = f.created_by ';

// GET /api/mindmaps/:id/files — 목록 (내용 없이)
router.get('/:id/files', async function (req, res) {
  try {
    var row = await snapGate(req, res, false);
    if (!row) return;
    var r = await db.query(FILE_SELECT + 'WHERE f.map_id = $1 AND f.tenant_id = $2 ORDER BY f.created_at', [row.id, req.tenant.id]);
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/files/list]', e);
  }
});

// GET /api/mindmaps/:id/files/:fid — 내려받기 { name, mime, data(base64) }
router.get('/:id/files/:fid', async function (req, res) {
  try {
    var row = await snapGate(req, res, false);
    if (!row) return;
    var r = await db.query('SELECT name, mime, size, data FROM mindmap_files WHERE id = $1 AND map_id = $2 AND tenant_id = $3', [req.params.fid, row.id, req.tenant.id]);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    var f = r.rows[0];
    res.json({ data: { name: f.name, mime: f.mime, size: f.size, data: Buffer.from(f.data).toString('base64') } });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/files/get]', e);
  }
});

// POST /api/mindmaps/:id/files — { nodeId, name, mime, data(base64) }
router.post('/:id/files', async function (req, res) {
  try {
    var row = await snapGate(req, res, true);
    if (!row) return;
    var b = req.body || {};
    var nodeId = String(b.nodeId || '').slice(0, 100);
    var name = String(b.name || '').replace(/[\\/\r\n]+/g, '_').trim().slice(0, 255);
    if (!nodeId || !name || typeof b.data !== 'string') return httpErr.sendError(res, 400, 'VALIDATION', '주제 · 파일 이름 · 내용이 필요합니다.');
    var buf = Buffer.from(b.data, 'base64');
    if (!buf.length) return httpErr.sendError(res, 400, 'VALIDATION', '빈 파일입니다.');
    if (buf.length > FILE_MAX_BYTES) return httpErr.sendError(res, 400, 'VALIDATION', '파일이 너무 큽니다 (최대 5MB).');
    var cnt = await db.query('SELECT COUNT(*)::int AS n FROM mindmap_files WHERE map_id = $1 AND tenant_id = $2', [row.id, req.tenant.id]);
    if (cnt.rows[0].n >= FILE_MAX_COUNT) return httpErr.sendError(res, 400, 'LIMIT', '맵 하나에 첨부는 ' + FILE_MAX_COUNT + '개까지 둘 수 있습니다.');
    var id = genId('mmf');
    await db.query('INSERT INTO mindmap_files (id, map_id, tenant_id, node_id, name, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, row.id, req.tenant.id, nodeId, name, String(b.mime || 'application/octet-stream').slice(0, 120), buf.length, buf, req.user.sub]);
    var r = await db.query(FILE_SELECT + 'WHERE f.id = $1', [id]);
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/files/create]', e);
  }
});

// DELETE /api/mindmaps/:id/files/:fid — 편집 권한
router.delete('/:id/files/:fid', async function (req, res) {
  try {
    var row = await snapGate(req, res, true);
    if (!row) return;
    var r = await db.query('DELETE FROM mindmap_files WHERE id = $1 AND map_id = $2 AND tenant_id = $3 RETURNING id', [req.params.fid, row.id, req.tenant.id]);
    if (!r.rows.length) return httpErr.sendError(res, 404, 'NOT_FOUND');
    res.json({ data: { id: req.params.fid } });
  } catch (e) {
    httpErr.serverError(res, '[mindmaps/files/delete]', e);
  }
});

module.exports = router;
