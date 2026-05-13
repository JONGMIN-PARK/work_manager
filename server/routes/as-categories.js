var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// 관리자 권한 확인
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 접근할 수 있습니다.' });
  }
  next();
}

// GET /api/as-categories — 모두 조회 (active=true만 기본, ?all=1 로 비활성 포함)
router.get('/', async function (req, res) {
  try {
    var includeInactive = req.query.all === '1' || req.query.all === 'true';
    var sql = 'SELECT * FROM as_categories WHERE tenant_id = $1';
    var params = [req.tenant.id];
    if (!includeInactive) sql += ' AND active = TRUE';
    sql += ' ORDER BY sort_order ASC, label ASC';
    var r = await db.query(sql, params);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[as-categories/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// POST /api/as-categories — 관리자만 추가
router.post('/', requireAdmin, async function (req, res) {
  try {
    var b = req.body || {};
    var code = (b.code || '').trim();
    var label = (b.label || '').trim();
    if (!code) return res.status(400).json({ error: 'VALIDATION', message: '코드를 입력하세요.' });
    if (!label) return res.status(400).json({ error: 'VALIDATION', message: '라벨을 입력하세요.' });
    if (!/^[a-z0-9_]{2,40}$/.test(code)) {
      return res.status(400).json({ error: 'VALIDATION', message: '코드는 영소문자·숫자·언더스코어 2~40자.' });
    }

    var id = b.id || ('asc-' + require('crypto').randomUUID().slice(0, 12));
    var r = await db.query(
      'INSERT INTO as_categories (id, tenant_id, code, label, icon, sort_order, active, created_by, updated_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *',
      [id, req.tenant.id, code, label, b.icon || null,
       b.sortOrder != null ? b.sortOrder : (b.sort_order != null ? b.sort_order : 100),
       b.active != null ? !!b.active : true, req.user.sub]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'DUPLICATE', message: '이미 같은 코드의 카테고리가 있습니다.' });
    }
    console.error('[as-categories/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// PUT /api/as-categories/:id — 관리자만 수정
router.put('/:id', requireAdmin, async function (req, res) {
  try {
    var b = req.body || {};
    var fields = [];
    var params = [];
    var idx = 1;
    if (b.label !== undefined)      { fields.push('label = $' + idx++);      params.push(b.label); }
    if (b.icon !== undefined)       { fields.push('icon = $' + idx++);       params.push(b.icon); }
    if (b.sortOrder !== undefined || b.sort_order !== undefined) {
      fields.push('sort_order = $' + idx++); params.push(b.sortOrder != null ? b.sortOrder : b.sort_order);
    }
    if (b.active !== undefined)     { fields.push('active = $' + idx++);     params.push(!!b.active); }
    // code 변경은 허용하지 않음 (이미 입력된 ticket과의 정합성 보호)
    if (!fields.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 필드가 없습니다.' });

    fields.push('updated_at = NOW()');
    fields.push('updated_by = $' + idx++);
    params.push(req.user.sub);
    params.push(req.params.id);
    params.push(req.tenant.id);

    var sql = 'UPDATE as_categories SET ' + fields.join(', ') +
      ' WHERE id = $' + idx++ + ' AND tenant_id = $' + idx++ + ' RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    console.error('[as-categories/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// DELETE /api/as-categories/:id — 관리자만 soft-delete (active=false)
// ?hard=1 일 때만 hard-delete (기존 티켓 참조 없을 때)
router.delete('/:id', requireAdmin, async function (req, res) {
  try {
    if (req.query.hard === '1') {
      // 사용 중인 티켓이 있으면 거절
      var catR = await db.query('SELECT code FROM as_categories WHERE id = $1 AND tenant_id = $2',
        [req.params.id, req.tenant.id]);
      if (!catR.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
      var useR = await db.query('SELECT COUNT(*)::int AS n FROM as_tickets WHERE tenant_id = $1 AND category = $2',
        [req.tenant.id, catR.rows[0].code]);
      if (useR.rows[0].n > 0) {
        return res.status(409).json({ error: 'IN_USE', message: '이 카테고리를 사용 중인 접수가 ' + useR.rows[0].n + '건 있어 완전 삭제 불가. 비활성화만 가능합니다.' });
      }
      await db.query('DELETE FROM as_categories WHERE id = $1 AND tenant_id = $2',
        [req.params.id, req.tenant.id]);
      return res.json({ message: '카테고리가 삭제되었습니다.' });
    }
    var r = await db.query('UPDATE as_categories SET active = FALSE, updated_at = NOW(), updated_by = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [req.user.sub, req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0], message: '비활성화되었습니다.' });
  } catch (e) {
    console.error('[as-categories/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
