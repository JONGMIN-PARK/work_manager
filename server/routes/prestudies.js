/**
 * 사전검토 (Pre-study) 라우트 — 프로젝트 이전 단계 독립 모듈
 * - 업체 문의/기술검토/개선제안/아이디어를 등록·브레인스토밍
 * - 확정 시 프로젝트 또는 수주로 전환
 * 규약: 인증 + 테넌트 격리 + 낙관적 락(version) + 소프트 삭제.
 * 프로젝트와 무관한 단계이므로 project-scope 가시성 제한은 적용하지 않고,
 * 같은 테넌트 구성원이 공유(브레인스토밍 성격)한다.
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

var CATEGORIES = ['inquiry', 'tech', 'improve', 'idea', 'quote'];
var STATUSES = ['idea', 'reviewing', 'discussing', 'proposed', 'won', 'hold', 'dropped'];
var PRIORITIES = ['high', 'normal', 'low'];

function genId(prefix) { return prefix + '-' + crypto.randomUUID().slice(0, 12); }
function clampEnum(v, allowed, fallback) { return allowed.indexOf(v) >= 0 ? v : fallback; }
function today() { return new Date().toISOString().slice(0, 10); }

/**
 * 회신기한 → events(type='review') 발행/동기화. 회의(meetings)와 동일한 패턴.
 * 기한이 없어지면 연결 일정을 제거한다. 반환: event_id | null
 */
async function syncPrestudyEvent(row, tenantId, userId) {
  var title = (row.client ? '[' + row.client + '] ' : '') + row.title;
  // 기한 없음 → 기존 일정 제거
  if (!row.due_date) {
    if (row.event_id) {
      await db.query('DELETE FROM events WHERE id = $1 AND tenant_id = $2', [row.event_id, tenantId]);
      await db.query('UPDATE prestudies SET event_id = NULL WHERE id = $1 AND tenant_id = $2', [row.id, tenantId]);
    }
    return null;
  }
  if (row.event_id) {
    await db.query(
      "UPDATE events SET title = $1, start_date = $2, end_date = $2 WHERE id = $3 AND tenant_id = $4",
      [title, row.due_date, row.event_id, tenantId]
    );
    return row.event_id;
  }
  var evId = genId('evt');
  await db.query(
    "INSERT INTO events (id, title, type, start_date, end_date, created_by, tenant_id) VALUES ($1,$2,'review',$3,$3,$4,$5)",
    [evId, title, row.due_date, userId, tenantId]
  );
  await db.query('UPDATE prestudies SET event_id = $1 WHERE id = $2 AND tenant_id = $3', [evId, row.id, tenantId]);
  return evId;
}

/** 담당 배정 알림 (fire-and-forget, 본인 제외) */
async function notifyOwner(row, actorId) {
  try {
    if (!row || !row.owner_id || row.owner_id === actorId) return;
    await notificationService.notify('prestudy_assigned', {
      prestudyId: row.id, title: row.title, client: row.client, dueDate: row.due_date
    }, [row.owner_id]);
  } catch (e) { console.error('[prestudies/notify]', e.message); }
}

/** 확정(won) 알림 → 관리자 + 담당 (fire-and-forget, 본인 제외) */
async function notifyWon(row, tenantId, actorId) {
  try {
    var ids = {};
    if (row.owner_id) ids[row.owner_id] = true;
    var admR = await db.query("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' AND status = 'active'", [tenantId]);
    admR.rows.forEach(function (r) { ids[r.id] = true; });
    delete ids[actorId];
    var list = Object.keys(ids);
    if (!list.length) return;
    await notificationService.notify('prestudy_won', { title: row.title, client: row.client }, list);
  } catch (e) { console.error('[prestudies/notifyWon]', e.message); }
}

// GET /api/prestudies?status=&client=&category=&mine=true&q=
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT p.*, u.name AS owner_name FROM prestudies p LEFT JOIN users u ON u.id = p.owner_id ' +
      'WHERE p.deleted_at IS NULL AND p.tenant_id = $1';
    var params = [req.tenant.id];
    var idx = 2;
    if (req.query.status) { sql += ' AND p.status = $' + idx++; params.push(req.query.status); }
    if (req.query.client) { sql += ' AND p.client ILIKE $' + idx++; params.push('%' + req.query.client + '%'); }
    if (req.query.category) { sql += ' AND p.category = $' + idx++; params.push(req.query.category); }
    if (req.query.mine === 'true') { sql += ' AND p.owner_id = $' + idx++; params.push(req.user.sub); }
    if (req.query.q) {
      sql += ' AND (p.title ILIKE $' + idx + ' OR p.client ILIKE $' + idx + ' OR p.background ILIKE $' + idx + ' OR p.notes ILIKE $' + idx + ')';
      params.push('%' + req.query.q + '%'); idx++;
    }
    sql += ' ORDER BY p.sort_order, p.updated_at DESC';
    var r = await db.query(sql, params);
    res.json({ data: r.rows, total: r.rows.length });
  } catch (e) {
    console.error('[prestudies/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/prestudies/clients — 업체별 집계 (업체별 보기용)
router.get('/clients', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT COALESCE(NULLIF(client,''),'(미지정)') AS client, COUNT(*)::int AS total, " +
      "  COUNT(*) FILTER (WHERE status NOT IN ('won','dropped'))::int AS open_cnt, " +
      "  COUNT(*) FILTER (WHERE status = 'won')::int AS won_cnt, MAX(updated_at) AS last_at " +
      "FROM prestudies WHERE deleted_at IS NULL AND tenant_id = $1 GROUP BY 1 ORDER BY open_cnt DESC, total DESC",
      [req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[prestudies/clients]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/prestudies/members — 담당자/참여자 선택용 경량 목록 (테넌트 활성 사용자)
// 이름은 이미 앱 전반(팀 현황·담당자 등)에서 노출되므로 id·name만 반환한다.
router.get('/members', async function (req, res) {
  try {
    var r = await db.query(
      "SELECT id, COALESCE(NULLIF(display_name,''), name) AS name FROM users " +
      "WHERE tenant_id = $1 AND status = 'active' ORDER BY name",
      [req.tenant.id]
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[prestudies/members]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/prestudies/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT p.*, u.name AS owner_name FROM prestudies p LEFT JOIN users u ON u.id = p.owner_id ' +
      'WHERE p.id = $1 AND p.tenant_id = $2 AND p.deleted_at IS NULL',
      [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[prestudies/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/prestudies
router.post('/', async function (req, res) {
  try {
    var b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'VALIDATION', message: 'title 필수' });
    var id = b.id || genId('pst');
    var r = await db.query(
      "INSERT INTO prestudies (id, tenant_id, title, client, category, status, priority, owner_id, participants, " +
      " background, notes, conclusion, due_date, tags, sort_order, created_by, updated_by) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *",
      [
        id, req.tenant.id, b.title, b.client || null,
        clampEnum(b.category, CATEGORIES, 'inquiry'),
        clampEnum(b.status, STATUSES, 'idea'),
        clampEnum(b.priority, PRIORITIES, 'normal'),
        b.ownerId || b.owner_id || req.user.sub,
        JSON.stringify(b.participants || []),
        b.background || null, b.notes || null, b.conclusion || null,
        b.dueDate || b.due_date || null,
        JSON.stringify(b.tags || []),
        parseInt(b.sortOrder || b.sort_order, 10) || 0,
        req.user.sub
      ]
    );
    res.status(201).json({ data: r.rows[0] });
    notifyOwner(r.rows[0], req.user.sub);
    syncPrestudyEvent(r.rows[0], req.tenant.id, req.user.sub).catch(function (e) { console.error('[prestudies/event]', e.message); });
  } catch (e) {
    console.error('[prestudies/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/prestudies/:id
router.put('/:id', async function (req, res) {
  try {
    var b = req.body || {};
    var sets = [];
    var params = [];
    var idx = 1;
    function set(col, val) { sets.push(col + ' = $' + idx++); params.push(val); }

    if (b.title !== undefined) set('title', b.title);
    if (b.client !== undefined) set('client', b.client || null);
    if (b.category !== undefined) set('category', clampEnum(b.category, CATEGORIES, 'inquiry'));
    if (b.status !== undefined) set('status', clampEnum(b.status, STATUSES, 'idea'));
    if (b.priority !== undefined) set('priority', clampEnum(b.priority, PRIORITIES, 'normal'));
    if (b.ownerId !== undefined || b.owner_id !== undefined) set('owner_id', b.ownerId || b.owner_id || null);
    if (b.participants !== undefined) set('participants', JSON.stringify(b.participants || []));
    if (b.background !== undefined) set('background', b.background || null);
    if (b.notes !== undefined) set('notes', b.notes || null);
    if (b.conclusion !== undefined) set('conclusion', b.conclusion || null);
    if (b.dueDate !== undefined || b.due_date !== undefined) set('due_date', b.dueDate || b.due_date || null);
    if (b.tags !== undefined) set('tags', JSON.stringify(b.tags || []));
    if (b.sortOrder !== undefined || b.sort_order !== undefined) set('sort_order', parseInt(b.sortOrder || b.sort_order, 10) || 0);
    if (!sets.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '수정할 항목이 없습니다.' });

    sets.push('updated_by = $' + idx++); params.push(req.user.sub);
    sets.push('updated_at = now()');
    sets.push('version = version + 1');
    params.push(req.params.id);
    var idIdx = idx++;
    params.push(req.tenant.id);
    var sql = 'UPDATE prestudies SET ' + sets.join(', ') + ' WHERE id = $' + idIdx + ' AND tenant_id = $' + idx + ' AND deleted_at IS NULL RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
    if (b.ownerId || b.owner_id) notifyOwner(r.rows[0], req.user.sub);
    if (b.status === 'won') notifyWon(r.rows[0], req.tenant.id, req.user.sub);
    syncPrestudyEvent(r.rows[0], req.tenant.id, req.user.sub).catch(function (e) { console.error('[prestudies/event]', e.message); });
  } catch (e) {
    console.error('[prestudies/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/prestudies/:id/move — 칸반 이동
router.put('/:id/move', async function (req, res) {
  try {
    var status = clampEnum(req.body.status, STATUSES, null);
    if (!status) return res.status(400).json({ error: 'VALIDATION', message: 'status 필수 (' + STATUSES.join('/') + ')' });
    var sortOrder = parseInt(req.body.sortOrder || req.body.sort_order, 10) || 0;
    var r = await db.query(
      'UPDATE prestudies SET status = $1, sort_order = $2, updated_by = $3, updated_at = now(), version = version + 1 ' +
      'WHERE id = $4 AND tenant_id = $5 AND deleted_at IS NULL RETURNING *',
      [status, sortOrder, req.user.sub, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
    if (status === 'won') notifyWon(r.rows[0], req.tenant.id, req.user.sub);
  } catch (e) {
    console.error('[prestudies/move]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/prestudies/:id/convert — 프로젝트 또는 수주로 전환 (body: { target: 'project' | 'order' })
router.post('/:id/convert', async function (req, res) {
  try {
    var target = req.body.target === 'order' ? 'order' : 'project';
    var pR = await db.query('SELECT * FROM prestudies WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.tenant.id]);
    if (!pR.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var ps = pR.rows[0];

    var created;
    if (target === 'order') {
      if (ps.linked_order_no) return res.status(409).json({ error: 'CONFLICT', message: '이미 수주로 전환되었습니다.' });
      var orderNo = (req.body.orderNo || req.body.order_no || '').trim();
      if (!orderNo) return res.status(400).json({ error: 'VALIDATION', message: '수주번호(orderNo)가 필요합니다.' });
      var dupR = await db.query('SELECT order_no FROM orders WHERE order_no = $1', [orderNo]);
      if (dupR.rows.length) return res.status(409).json({ error: 'CONFLICT', message: '이미 존재하는 수주번호입니다.' });
      var oR = await db.query(
        "INSERT INTO orders (order_no, date, client, name, memo, created_by, updated_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$6,$7) RETURNING *",
        [orderNo, today(), ps.client || null, ps.title, [ps.background, ps.notes, ps.conclusion].filter(Boolean).join('\n\n') || null, req.user.sub, req.tenant.id]
      );
      created = oR.rows[0];
      await db.query("UPDATE prestudies SET linked_order_no = $1, status = 'won', updated_by = $2, updated_at = now(), version = version + 1 WHERE id = $3 AND tenant_id = $4",
        [orderNo, req.user.sub, ps.id, req.tenant.id]);
    } else {
      if (ps.linked_project_id) return res.status(409).json({ error: 'CONFLICT', message: '이미 프로젝트로 전환되었습니다.' });
      var projId = genId('proj');
      var memo = [ps.background, ps.notes, ps.conclusion].filter(Boolean).join('\n\n');
      var prR = await db.query(
        "INSERT INTO projects (id, name, status, start_date, memo, created_by, updated_by, tenant_id, owner_id) " +
        "VALUES ($1,$2,'waiting',$3,$4,$5,$5,$6,$5) RETURNING *",
        [projId, ps.title, today().replace(/-/g, ''), memo || null, req.user.sub, req.tenant.id]
      );
      created = prR.rows[0];
      // 담당자를 PL로 등록 (있으면)
      if (ps.owner_id) {
        try {
          await db.query(
            "INSERT INTO project_members (project_id, user_id, role, assigned_by) VALUES ($1,$2,'pl',$3) ON CONFLICT (project_id, user_id) DO NOTHING",
            [projId, ps.owner_id, req.user.sub]
          );
        } catch (_) { /* 멤버 등록 실패는 전환을 막지 않음 */ }
      }
      await db.query("UPDATE prestudies SET linked_project_id = $1, status = 'won', updated_by = $2, updated_at = now(), version = version + 1 WHERE id = $3 AND tenant_id = $4",
        [projId, req.user.sub, ps.id, req.tenant.id]);
      // 사전검토에 연결돼 있던 요소기술 적용 이력을 새 프로젝트로 이관(복제)
      // — 검토 단계에서 "이 기술로 된다"고 판단한 근거가 프로젝트에도 남는다.
      try {
        await db.query(
          "INSERT INTO tech_usages (id, tenant_id, tech_id, target_type, target_id, note, created_by) " +
          "SELECT 'tuse-' || substr(md5(random()::text || u.tech_id), 1, 12), u.tenant_id, u.tech_id, 'project', $1, u.note, $2 " +
          "FROM tech_usages u WHERE u.tenant_id = $3 AND u.target_type = 'prestudy' AND u.target_id = $4 " +
          "ON CONFLICT (tech_id, target_type, target_id) DO NOTHING",
          [projId, req.user.sub, req.tenant.id, ps.id]
        );
      } catch (e) {
        // 요소기술 모듈 미적용(테이블 없음) 등은 전환을 막지 않음
        if (e.code !== '42P01') console.error('[prestudies/convert/tech]', e.message);
      }
    }
    res.status(201).json({ data: { target: target, created: created } });
    notifyWon(ps, req.tenant.id, req.user.sub);
  } catch (e) {
    console.error('[prestudies/convert]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
  }
});

// DELETE /api/prestudies/:id — 소프트 삭제
router.delete('/:id', async function (req, res) {
  try {
    var r = await db.query(
      'UPDATE prestudies SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL RETURNING id, event_id',
      [req.user.sub, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    // 연결된 캘린더 일정도 함께 제거
    if (r.rows[0].event_id) {
      await db.query('DELETE FROM events WHERE id = $1 AND tenant_id = $2', [r.rows[0].event_id, req.tenant.id]);
    }
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[prestudies/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
