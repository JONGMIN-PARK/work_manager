/**
 * 요소기술(기반기술) 라우트 — PRD_요소기술_개발관리 Phase 1
 * - 기술 카탈로그 CRUD + 기술스택 집계
 * - 개발일지 CRUD (진척률·투입시간 재동기화 — milestones._resyncMilestoneProgress 패턴)
 *
 * 규약: 인증 + 테넌트 격리 + 낙관적 락(version) + 소프트 삭제.
 * 요소기술은 프로젝트 무관한 조직 자산이므로 project-scope 가시성은 적용하지 않고
 * 같은 테넌트 구성원이 공유한다. 수정은 담당자·참여자·관리자만.
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var crypto = require('crypto');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var notificationService = require('../services/notification.service');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var CATEGORIES = ['vision', 'motion', 'control', 'sw', 'ai', 'comm', 'mech', 'etc'];
var STATUSES = ['research', 'developing', 'verifying', 'available', 'deprecated'];
var LOG_KINDS = ['dev', 'test', 'issue', 'doc', 'review', 'idea'];

function genId(prefix) { return prefix + '-' + crypto.randomUUID().slice(0, 12); }
function clampEnum(v, allowed, fallback) { return allowed.indexOf(v) >= 0 ? v : fallback; }
function clampInt(v, min, max, fallback) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function toHours(v) { var n = parseFloat(v); return (isNaN(n) || n < 0) ? 0 : n; }

/**
 * 개발일지 → tech_assets 재동기화.
 * progress = 최신 일지의 진척률, total_hours = 삭제되지 않은 일지 hours 합.
 * 일지가 없으면 0으로 초기화. (milestones._resyncMilestoneProgress와 동일 방식)
 */
async function resyncTech(techId, tenantId) {
  var sumR = await db.query(
    'SELECT COALESCE(SUM(hours),0) AS sum_h FROM tech_logs WHERE tech_id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
    [techId, tenantId]
  );
  var latestR = await db.query(
    'SELECT progress FROM tech_logs WHERE tech_id = $1 AND tenant_id = $2 AND deleted_at IS NULL ' +
    'ORDER BY log_date DESC NULLS LAST, created_at DESC LIMIT 1',
    [techId, tenantId]
  );
  var sumH = sumR.rows.length ? sumR.rows[0].sum_h : 0;
  var prog = latestR.rows.length ? latestR.rows[0].progress : 0;
  await db.query(
    'UPDATE tech_assets SET progress = $1, total_hours = $2, updated_at = now() WHERE id = $3 AND tenant_id = $4',
    [prog || 0, sumH, techId, tenantId]
  );
}

var STATUS_LABEL = {
  research: '연구', developing: '개발', verifying: '검증', available: '사용가능', deprecated: '폐기예정'
};

/** 담당(owner) + 참여자(이름) → user_id 목록. actorId 는 제외. */
async function techAudience(row, tenantId, actorId) {
  var ids = {};
  if (row.owner_id) ids[row.owner_id] = true;
  var names = row.participants;
  if (typeof names === 'string') { try { names = JSON.parse(names); } catch (_) { names = []; } }
  if (Array.isArray(names) && names.length) {
    var nr = await db.query(
      "SELECT id FROM users WHERE tenant_id = $1 AND status = 'active' AND (name = ANY($2) OR display_name = ANY($2))",
      [tenantId, names]
    );
    nr.rows.forEach(function (u) { ids[u.id] = true; });
  }
  if (actorId) delete ids[actorId];
  return Object.keys(ids);
}

/** 담당 배정 알림 (fire-and-forget) */
async function notifyTechAssigned(row, actorId) {
  try {
    if (!row || !row.owner_id || row.owner_id === actorId) return;
    await notificationService.notify('tech_assigned', { code: row.code, name: row.name }, [row.owner_id]);
  } catch (e) { console.error('[tech/notifyAssigned]', e.message); }
}

/** 수정 권한: 담당자 · 참여자(이름) · 관리자/임원 */
async function canEdit(req, techId) {
  if (req.user.role === 'admin' || req.user.role === 'executive') return true;
  var r = await db.query('SELECT owner_id, participants FROM tech_assets WHERE id = $1 AND tenant_id = $2', [techId, req.tenant.id]);
  if (!r.rows.length) return false;
  if (r.rows[0].owner_id === req.user.sub) return true;
  var parts = r.rows[0].participants;
  if (typeof parts === 'string') { try { parts = JSON.parse(parts); } catch (_) { parts = []; } }
  if (!Array.isArray(parts) || !parts.length) return false;
  var me = await db.query("SELECT COALESCE(NULLIF(display_name,''), name) AS name FROM users WHERE id = $1", [req.user.sub]);
  var myName = me.rows.length ? me.rows[0].name : null;
  return !!(myName && parts.indexOf(myName) >= 0);
}

// GET /api/tech?category=&status=&stack=&mine=&q=
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT t.*, u.name AS owner_name FROM tech_assets t LEFT JOIN users u ON u.id = t.owner_id ' +
      'WHERE t.deleted_at IS NULL AND t.tenant_id = $1';
    var params = [req.tenant.id];
    var idx = 2;
    if (req.query.category) { sql += ' AND t.category = $' + idx++; params.push(req.query.category); }
    if (req.query.status) { sql += ' AND t.status = $' + idx++; params.push(req.query.status); }
    if (req.query.mine === 'true') { sql += ' AND t.owner_id = $' + idx++; params.push(req.user.sub); }
    if (req.query.stack) {
      // 스택 이름은 표기 흔들림(OpenCV/opencv)이 있어 소문자 비교
      sql += ' AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.stack) e WHERE lower(e->>\'name\') = lower($' + idx + '))';
      params.push(req.query.stack); idx++;
    }
    if (req.query.q) {
      sql += ' AND (t.name ILIKE $' + idx + ' OR t.code ILIKE $' + idx + ' OR t.summary ILIKE $' + idx +
        ' OR t.description ILIKE $' + idx + ' OR t.stack::text ILIKE $' + idx + ')';
      params.push('%' + req.query.q + '%'); idx++;
    }
    sql += ' ORDER BY t.status, t.name';
    var r = await db.query(sql, params);
    res.json({ data: r.rows, total: r.rows.length });
  } catch (e) {
    console.error('[tech/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/tech/stacks — 기술스택 집계 (스택 보기 · 자동완성용)
router.get('/stacks', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT max(e->>'name') AS name, e->>'kind' AS kind, COUNT(*)::int AS cnt, " +
      "  array_agg(DISTINCT NULLIF(e->>'version','')) AS versions " +
      "FROM tech_assets t, jsonb_array_elements(t.stack) e " +
      "WHERE t.deleted_at IS NULL AND t.tenant_id = $1 AND COALESCE(e->>'name','') <> '' " +
      "GROUP BY lower(e->>'name'), e->>'kind' ORDER BY cnt DESC, name",
      [req.tenant.id]
    );
    var rows = r.rows.map(function (row) {
      return {
        name: row.name,
        kind: row.kind || 'etc',
        cnt: row.cnt,
        versions: (row.versions || []).filter(Boolean)
      };
    });
    res.json({ data: rows });
  } catch (e) {
    console.error('[tech/stacks]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/tech/members — 담당/참여자 선택용 (사전검토와 동일 패턴)
router.get('/members', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT id, COALESCE(NULLIF(display_name,''), name) AS name FROM users " +
      "WHERE tenant_id = $1 AND status = 'active' ORDER BY name",
      [req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[tech/members]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/tech/usages?targetType=&targetId= — 역방향 조회
// 특정 프로젝트/사전검토에 적용된 요소기술 목록 (프로젝트·사전검토 화면에서 사용)
router.get('/usages', async function (req, res) {
  try {
    var targetType = req.query.targetType || req.query.target_type;
    var targetId = req.query.targetId || req.query.target_id;
    if (['project', 'prestudy'].indexOf(targetType) === -1 || !targetId) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: "targetType('project'|'prestudy')·targetId 필수" });
    }
    var r = await db.query(
      'SELECT u.id, u.tech_id, u.note, u.created_at, ' +
      '  t.name AS tech_name, t.code AS tech_code, t.category, t.status, t.trl, t.tech_version ' +
      'FROM tech_usages u JOIN tech_assets t ON t.id = u.tech_id AND t.tenant_id = u.tenant_id ' +
      'WHERE u.tenant_id = $1 AND u.target_type = $2 AND u.target_id = $3 AND t.deleted_at IS NULL ' +
      'ORDER BY t.name',
      [req.tenant.id, targetType, targetId]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[tech/usages/byTarget]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/tech/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT t.*, u.name AS owner_name FROM tech_assets t LEFT JOIN users u ON u.id = t.owner_id ' +
      'WHERE t.id = $1 AND t.tenant_id = $2 AND t.deleted_at IS NULL',
      [req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[tech/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/tech
router.post('/', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'VALIDATION', message: 'name 필수' });
    var id = b.id || genId('tech');
    var r = await db.query(
      "INSERT INTO tech_assets (id, tenant_id, code, name, category, summary, description, status, trl, " +
      " tech_version, owner_id, participants, stack, tags, repo_url, doc_url, created_by, updated_by) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING *",
      [
        id, req.tenant.id, (b.code || '').trim() || null, b.name,
        clampEnum(b.category, CATEGORIES, 'etc'),
        b.summary || null, b.description || null,
        clampEnum(b.status, STATUSES, 'research'),
        clampInt(b.trl, 1, 9, 1),
        b.techVersion || b.tech_version || null,
        b.ownerId || b.owner_id || req.user.sub,
        JSON.stringify(b.participants || []),
        JSON.stringify(b.stack || []),
        JSON.stringify(b.tags || []),
        b.repoUrl || b.repo_url || null,
        b.docUrl || b.doc_url || null,
        req.user.sub
      ]
    );
    res.status(201).json({ data: r.rows[0] });
    notifyTechAssigned(r.rows[0], req.user.sub);
  } catch (e) {
    console.error('[tech/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/tech/:id
router.put('/:id', async function (req, res) {
  try {
    if (!await canEdit(req, req.params.id)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '담당자·참여자·관리자만 수정할 수 있습니다.' });
    }
    // 상태 변경 알림 판단용 이전 값
    var prevR = await db.query('SELECT status FROM tech_assets WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    var prevStatus = prevR.rows.length ? prevR.rows[0].status : null;
    var b = req.body || {};
    var sets = [];
    var params = [];
    var idx = 1;
    function set(col, val) { sets.push(col + ' = $' + idx++); params.push(val); }

    if (b.code !== undefined) set('code', (b.code || '').trim() || null);
    if (b.name !== undefined) set('name', b.name);
    if (b.category !== undefined) set('category', clampEnum(b.category, CATEGORIES, 'etc'));
    if (b.summary !== undefined) set('summary', b.summary || null);
    if (b.description !== undefined) set('description', b.description || null);
    if (b.status !== undefined) set('status', clampEnum(b.status, STATUSES, 'research'));
    if (b.trl !== undefined) set('trl', clampInt(b.trl, 1, 9, 1));
    if (b.techVersion !== undefined || b.tech_version !== undefined) set('tech_version', b.techVersion || b.tech_version || null);
    if (b.ownerId !== undefined || b.owner_id !== undefined) set('owner_id', b.ownerId || b.owner_id || null);
    if (b.participants !== undefined) set('participants', JSON.stringify(b.participants || []));
    if (b.stack !== undefined) set('stack', JSON.stringify(b.stack || []));
    if (b.tags !== undefined) set('tags', JSON.stringify(b.tags || []));
    if (b.repoUrl !== undefined || b.repo_url !== undefined) set('repo_url', b.repoUrl || b.repo_url || null);
    if (b.docUrl !== undefined || b.doc_url !== undefined) set('doc_url', b.docUrl || b.doc_url || null);
    if (!sets.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '수정할 항목이 없습니다.' });

    sets.push('updated_by = $' + idx++); params.push(req.user.sub);
    sets.push('updated_at = now()');
    sets.push('version = version + 1');
    params.push(req.params.id);
    var idIdx = idx++;
    params.push(req.tenant.id);
    var sql = 'UPDATE tech_assets SET ' + sets.join(', ') + ' WHERE id = $' + idIdx + ' AND tenant_id = $' + idx + ' AND deleted_at IS NULL RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
    var updated = r.rows[0];
    if (b.ownerId || b.owner_id) notifyTechAssigned(updated, req.user.sub);
    // 상태가 실제로 바뀐 경우에만 알림 → 담당·참여자 + 관리자
    if (b.status !== undefined && prevStatus && updated.status !== prevStatus) {
      (async function () {
        try {
          var ids = await techAudience(updated, req.tenant.id, req.user.sub);
          var admR = await db.query("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' AND status = 'active'", [req.tenant.id]);
          var set = {};
          ids.forEach(function (i) { set[i] = true; });
          admR.rows.forEach(function (u) { set[u.id] = true; });
          delete set[req.user.sub];
          var list = Object.keys(set);
          if (!list.length) return;
          await notificationService.notify('tech_status_changed', {
            code: updated.code, name: updated.name,
            fromLabel: STATUS_LABEL[prevStatus] || prevStatus,
            toLabel: STATUS_LABEL[updated.status] || updated.status,
            trl: updated.trl
          }, list);
        } catch (e) { console.error('[tech/notifyStatus]', e.message); }
      })();
    }
  } catch (e) {
    console.error('[tech/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/tech/:id — 소프트 삭제
router.delete('/:id', async function (req, res) {
  try {
    if (!await canEdit(req, req.params.id)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '담당자·관리자만 삭제할 수 있습니다.' });
    }
    var r = await db.query(
      'UPDATE tech_assets SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL RETURNING id',
      [req.user.sub, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[tech/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

/* ── 개발일지 ── */

// GET /api/tech/:id/logs
router.get('/:id/logs', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM tech_logs WHERE tech_id = $1 AND tenant_id = $2 AND deleted_at IS NULL ' +
      'ORDER BY log_date DESC NULLS LAST, created_at DESC LIMIT 200',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[tech/logs/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/tech/:id/logs — 개발일지 작성
router.post('/:id/logs', async function (req, res) {
  try {
    var tR = await db.query('SELECT id FROM tech_assets WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.tenant.id]);
    if (!tR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '기술을 찾을 수 없습니다.' });

    var b = req.body || {};
    var authorName = req.user.name || '';
    try {
      var ur = await db.query("SELECT COALESCE(NULLIF(display_name,''), name) AS name FROM users WHERE id = $1", [req.user.sub]);
      if (ur.rows.length) authorName = ur.rows[0].name || authorName;
    } catch (_) {}

    var id = genId('tlog');
    var r = await db.query(
      "INSERT INTO tech_logs (id, tenant_id, tech_id, log_date, kind, author_id, author_name, progress, hours, content) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [
        id, req.tenant.id, req.params.id,
        b.logDate || b.log_date || new Date().toISOString().slice(0, 10),
        clampEnum(b.kind, LOG_KINDS, 'dev'),
        req.user.sub, authorName,
        clampInt(b.progress, 0, 100, 0),
        toHours(b.hours),
        b.content || null
      ]
    );
    await resyncTech(req.params.id, req.tenant.id);
    res.status(201).json({ data: r.rows[0] });
    // 개발일지 알림 → 담당·참여자 (작성자 제외)
    (async function () {
      try {
        var techR = await db.query('SELECT id, code, name, owner_id, participants FROM tech_assets WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
        if (!techR.rows.length) return;
        var ids = await techAudience(techR.rows[0], req.tenant.id, req.user.sub);
        if (!ids.length) return;
        await notificationService.notify('tech_log_added', {
          code: techR.rows[0].code, name: techR.rows[0].name,
          authorName: authorName, progress: r.rows[0].progress, content: r.rows[0].content
        }, ids);
      } catch (e) { console.error('[tech/notifyLog]', e.message); }
    })();
  } catch (e) {
    console.error('[tech/logs/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/tech/:id/logs/:logId — 작성자 또는 관리자만
router.put('/:id/logs/:logId', async function (req, res) {
  try {
    var cur = await db.query('SELECT author_id FROM tech_logs WHERE id = $1 AND tech_id = $2 AND tenant_id = $3 AND deleted_at IS NULL',
      [req.params.logId, req.params.id, req.tenant.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var isAdmin = req.user.role === 'admin' || req.user.role === 'executive';
    if (!isAdmin && cur.rows[0].author_id !== req.user.sub) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '작성자·관리자만 수정할 수 있습니다.' });
    }
    var b = req.body || {};
    var sets = [];
    var params = [];
    var idx = 1;
    function set(col, val) { sets.push(col + ' = $' + idx++); params.push(val); }
    if (b.logDate !== undefined || b.log_date !== undefined) set('log_date', b.logDate || b.log_date || null);
    if (b.kind !== undefined) set('kind', clampEnum(b.kind, LOG_KINDS, 'dev'));
    if (b.progress !== undefined) set('progress', clampInt(b.progress, 0, 100, 0));
    if (b.hours !== undefined) set('hours', toHours(b.hours));
    if (b.content !== undefined) set('content', b.content || null);
    if (!sets.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '수정할 항목이 없습니다.' });
    params.push(req.params.logId);
    var logIdx = idx++;
    params.push(req.tenant.id);
    var r = await db.query(
      'UPDATE tech_logs SET ' + sets.join(', ') + ' WHERE id = $' + logIdx + ' AND tenant_id = $' + idx + ' RETURNING *',
      params
    );
    await resyncTech(req.params.id, req.tenant.id);
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[tech/logs/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/tech/:id/logs/:logId — 소프트 삭제 (작성자·관리자)
router.delete('/:id/logs/:logId', async function (req, res) {
  try {
    var cur = await db.query('SELECT author_id FROM tech_logs WHERE id = $1 AND tech_id = $2 AND tenant_id = $3 AND deleted_at IS NULL',
      [req.params.logId, req.params.id, req.tenant.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var isAdmin = req.user.role === 'admin' || req.user.role === 'executive';
    if (!isAdmin && cur.rows[0].author_id !== req.user.sub) {
      return res.status(403).json({ error: 'FORBIDDEN', message: '작성자·관리자만 삭제할 수 있습니다.' });
    }
    await db.query('UPDATE tech_logs SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND tenant_id = $3',
      [req.user.sub, req.params.logId, req.tenant.id]);
    await resyncTech(req.params.id, req.tenant.id);
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[tech/logs/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

/* ── 적용 이력 (Phase 2) ── */

// GET /api/tech/:id/usages — 이 기술이 쓰인 프로젝트/사전검토
// 대상이 삭제된 경우 target_name 이 null 로 와서 화면에서 "(삭제된 대상)"으로 표시된다.
router.get('/:id/usages', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT u.*, COALESCE(p.name, ps.title) AS target_name, ps.client AS target_client ' +
      'FROM tech_usages u ' +
      "LEFT JOIN projects p ON u.target_type = 'project' AND p.id = u.target_id AND p.tenant_id = u.tenant_id " +
      "LEFT JOIN prestudies ps ON u.target_type = 'prestudy' AND ps.id = u.target_id AND ps.tenant_id = u.tenant_id " +
      'WHERE u.tech_id = $1 AND u.tenant_id = $2 ORDER BY u.created_at DESC',
      [req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[tech/usages/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/tech/:id/usages — 적용 이력 추가
router.post('/:id/usages', async function (req, res) {
  try {
    var b = req.body || {};
    var targetType = b.targetType || b.target_type;
    var targetId = b.targetId || b.target_id;
    if (['project', 'prestudy'].indexOf(targetType) === -1 || !targetId) {
      return res.status(400).json({ error: 'VALIDATION', message: "targetType('project'|'prestudy')·targetId 필수" });
    }
    var tR = await db.query('SELECT id FROM tech_assets WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.tenant.id]);
    if (!tR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '기술을 찾을 수 없습니다.' });

    // 대상이 같은 테넌트에 실재하는지 확인
    var okR = targetType === 'project'
      ? await db.query('SELECT id FROM projects WHERE id = $1 AND tenant_id = $2', [targetId, req.tenant.id])
      : await db.query('SELECT id FROM prestudies WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [targetId, req.tenant.id]);
    if (!okR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '대상을 찾을 수 없습니다.' });

    var id = genId('tuse');
    var r = await db.query(
      'INSERT INTO tech_usages (id, tenant_id, tech_id, target_type, target_id, note, created_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7) ' +
      'ON CONFLICT (tech_id, target_type, target_id) DO UPDATE SET note = EXCLUDED.note RETURNING *',
      [id, req.tenant.id, req.params.id, targetType, targetId, b.note || null, req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[tech/usages/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/tech/:id/usages/:usageId
router.delete('/:id/usages/:usageId', async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM tech_usages WHERE id = $1 AND tech_id = $2 AND tenant_id = $3 RETURNING id',
      [req.params.usageId, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[tech/usages/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
