/**
 * 프로젝트 검토 체크리스트 (간단형) 라우트 — PRD_프로젝트관리_확장 모듈 A
 * 단계 전환/출하 전 확인 항목. 판정/전자서명 없이 체크·검토자 메모·결과 3단계.
 * 규약: 인증 + 테넌트 격리 + 접근가능 프로젝트 제한 + 낙관적 락 + 소프트 삭제.
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var ps = require('../middleware/project-scope');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var RESULTS = ['open', 'ok', 'issue'];
function genId() { return 'rev-' + require('crypto').randomUUID().slice(0, 12); }
function clampEnum(v, allowed, fallback) { return allowed.indexOf(v) >= 0 ? v : fallback; }

/** 단계별 검토 항목 템플릿 프리셋 (신규 검토 생성 시 기본 항목) */
var REVIEW_TEMPLATES = {
  order:       { title: '수주 검토',   items: ['사양/요구사항 확정', '납기 타당성', '견적/원가 검토', '리스크 식별'] },
  design:      { title: '설계 검토(DR)', items: ['요구사양 반영', '기구/전장 도면 검토', '부품 표준화/수급', '인터페이스 정의', '안전/규격 준수'] },
  manufacture: { title: '제작 검토',   items: ['BOM 확정', '조립 공정 점검', '배선/결선 확인', '동작 테스트'] },
  inspect:     { title: '검수 검토',   items: ['성능 스펙 충족', '검사 성적서', '외관/마감', '고객 입회 항목'] },
  deliver:     { title: '출하 전 검토', items: ['최종 동작 확인', '포장/운송 준비', '납품 서류(성적서/매뉴얼)', '설치 지원 계획'] }
};

// GET /api/project-reviews/templates — 템플릿 프리셋 목록
router.get('/templates', function (req, res) {
  res.json({ data: REVIEW_TEMPLATES });
});

// GET /api/project-reviews?projectId=&phase=
router.get('/', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM project_reviews WHERE deleted_at IS NULL';
    var params = [];
    var idx = 1;
    sql += ' AND tenant_id = $' + idx++; params.push(req.tenant.id);
    if (req.query.projectId) { sql += ' AND project_id = $' + idx++; params.push(req.query.projectId); }
    if (req.query.phase) { sql += ' AND phase = $' + idx++; params.push(req.query.phase); }
    var sub = ps.accessibleProjectsSubquery(req, idx);
    sql += ' AND project_id IN (' + sub.sql + ')';
    params = params.concat(sub.params);
    idx = sub.nextIdx;

    sql += ' ORDER BY created_at DESC';
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function (row) { delete row._total; });
    res.json({ data: r.rows, total: total });
  } catch (e) {
    console.error('[project-reviews/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// GET /api/project-reviews/:id
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query('SELECT * FROM project_reviews WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[project-reviews/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/project-reviews — 생성 (template 지정 시 기본 항목 채움)
router.post('/', async function (req, res) {
  try {
    var b = req.body;
    var projectId = b.projectId || b.project_id;
    if (!projectId) return res.status(400).json({ error: 'VALIDATION', message: 'projectId 필수' });
    var pR = await db.query('SELECT id FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id]);
    if (!pR.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' });

    // 템플릿 적용
    var title = b.title;
    var items = Array.isArray(b.items) ? b.items : null;
    var phase = b.phase || null;
    if (b.template && REVIEW_TEMPLATES[b.template]) {
      var tpl = REVIEW_TEMPLATES[b.template];
      if (!title) title = tpl.title;
      if (!phase) phase = b.template;
      if (!items) items = tpl.items.map(function (t) { return { text: t, done: false }; });
    }
    if (!title) return res.status(400).json({ error: 'VALIDATION', message: 'title 또는 template 필수' });
    if (!items) items = [];

    var id = b.id || genId();
    var r = await db.query(
      "INSERT INTO project_reviews (id, tenant_id, project_id, phase, title, items, reviewer_id, note, result, created_by, updated_by) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *",
      [id, req.tenant.id, projectId, phase, title, JSON.stringify(items),
       b.reviewerId || b.reviewer_id || null, b.note || null, clampEnum(b.result, RESULTS, 'open'), req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    console.error('[project-reviews/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/project-reviews/:id — 제목·단계·검토자·의견·결과·항목 수정
router.put('/:id', async function (req, res) {
  try {
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;
    function set(col, val) { sets.push(col + ' = $' + idx++); params.push(val); }

    if (b.title !== undefined) set('title', b.title);
    if (b.phase !== undefined) set('phase', b.phase || null);
    if (b.items !== undefined) set('items', JSON.stringify(b.items || []));
    if (b.reviewerId !== undefined || b.reviewer_id !== undefined) set('reviewer_id', b.reviewerId || b.reviewer_id || null);
    if (b.note !== undefined) set('note', b.note || null);
    if (b.result !== undefined) set('result', clampEnum(b.result, RESULTS, 'open'));
    if (!sets.length) return res.status(400).json({ error: 'BAD_REQUEST', message: '수정할 항목이 없습니다.' });

    sets.push('updated_by = $' + idx++); params.push(req.user.sub);
    sets.push('updated_at = now()');
    sets.push('version = version + 1');
    params.push(req.params.id);
    var idIdx = idx++;
    params.push(req.tenant.id);
    var sql = 'UPDATE project_reviews SET ' + sets.join(', ') + ' WHERE id = $' + idIdx + ' AND tenant_id = $' + idx + ' AND deleted_at IS NULL RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[project-reviews/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/project-reviews/:id/items/:idx/toggle — 항목 완료 토글 (체커·시각 기록)
router.put('/:id/items/:idx/toggle', async function (req, res) {
  try {
    var itemIdx = parseInt(req.params.idx, 10);
    if (isNaN(itemIdx) || itemIdx < 0) return res.status(400).json({ error: 'VALIDATION', message: '잘못된 항목 번호' });

    var cur = await db.query('SELECT items FROM project_reviews WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL', [req.params.id, req.tenant.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var items = cur.rows[0].items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
    if (!Array.isArray(items) || !items[itemIdx]) return res.status(404).json({ error: 'NOT_FOUND', message: '항목 없음' });

    var done = !items[itemIdx].done;
    items[itemIdx].done = done;
    items[itemIdx].checker = done ? (req.user.name || null) : null;
    items[itemIdx].checked_at = done ? new Date().toISOString() : null;

    var r = await db.query(
      'UPDATE project_reviews SET items = $1, updated_by = $2, updated_at = now(), version = version + 1 WHERE id = $3 AND tenant_id = $4 RETURNING *',
      [JSON.stringify(items), req.user.sub, req.params.id, req.tenant.id]
    );
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[project-reviews/toggle]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/project-reviews/:id — 소프트 삭제
router.delete('/:id', async function (req, res) {
  try {
    var r = await db.query(
      'UPDATE project_reviews SET deleted_at = now(), deleted_by = $1 WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL RETURNING id',
      [req.user.sub, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    console.error('[project-reviews/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
