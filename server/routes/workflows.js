var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ─── GET /api/workflows — 워크플로우 목록 ───
router.get('/', async function (req, res) {
  try {
    var where = ['tenant_id = $1'];
    var params = [req.tenant.id];
    var idx = 2;

    if (req.query.entityType) {
      where.push('entity_type = $' + idx++);
      params.push(req.query.entityType);
    }

    var r = await db.query(
      'SELECT * FROM workflow_definitions WHERE ' + where.join(' AND ') + ' ORDER BY is_default DESC, created_at',
      params
    );
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[workflows/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/workflows — 워크플로우 생성 (admin) ───
router.post('/', auth.requireRole('admin'), async function (req, res) {
  try {
    var b = req.body;
    if (!b.name || !b.entity_type) {
      return res.status(400).json({ error: 'VALIDATION', message: 'name과 entity_type은 필수입니다.' });
    }

    // states 기본값
    var states = b.states || [
      { id: 'open', name: '열림', color: '#3B82F6' },
      { id: 'in_progress', name: '진행 중', color: '#F59E0B' },
      { id: 'review', name: '검토', color: '#8B5CF6' },
      { id: 'done', name: '완료', color: '#10B981' },
      { id: 'closed', name: '닫힘', color: '#64748B' }
    ];

    // transitions 기본값
    var transitions = b.transitions || [
      { from: 'open', to: 'in_progress' },
      { from: 'in_progress', to: 'review' },
      { from: 'review', to: 'done' },
      { from: 'review', to: 'in_progress' },
      { from: 'done', to: 'closed' },
      { from: '*', to: 'open' }
    ];

    // is_default인 경우, 기존 default 해제
    if (b.is_default) {
      await db.query(
        'UPDATE workflow_definitions SET is_default = false WHERE tenant_id = $1 AND entity_type = $2',
        [req.tenant.id, b.entity_type]
      );
    }

    var r = await db.query(
      'INSERT INTO workflow_definitions (tenant_id, entity_type, name, is_default, states, transitions) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.tenant.id, b.entity_type, b.name, b.is_default || false, JSON.stringify(states), JSON.stringify(transitions)]
    );

    res.status(201).json({ data: r.rows[0], message: '워크플로우가 생성되었습니다.' });
  } catch (e) {
    console.error('[workflows/create]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── PUT /api/workflows/:id — 워크플로우 수정 ───
router.put('/:id', auth.requireRole('admin'), async function (req, res) {
  try {
    var b = req.body;
    var sets = [];
    var params = [];
    var idx = 1;

    if (b.name !== undefined) { sets.push('name = $' + idx++); params.push(b.name); }
    if (b.states !== undefined) { sets.push('states = $' + idx++); params.push(JSON.stringify(b.states)); }
    if (b.transitions !== undefined) { sets.push('transitions = $' + idx++); params.push(JSON.stringify(b.transitions)); }
    if (b.is_default !== undefined) {
      sets.push('is_default = $' + idx++);
      params.push(b.is_default);
      if (b.is_default) {
        // 기존 워크플로우 조회 후 entity_type 확인
        var cur = await db.query('SELECT entity_type FROM workflow_definitions WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
        if (cur.rows.length) {
          await db.query(
            'UPDATE workflow_definitions SET is_default = false WHERE tenant_id = $1 AND entity_type = $2 AND id != $3',
            [req.tenant.id, cur.rows[0].entity_type, req.params.id]
          );
        }
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 항목이 없습니다.' });

    sets.push('updated_at = now()');
    params.push(req.params.id, req.tenant.id);

    var r = await db.query(
      'UPDATE workflow_definitions SET ' + sets.join(', ') + ' WHERE id = $' + idx++ + ' AND tenant_id = $' + idx + ' RETURNING *',
      params
    );

    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0], message: '워크플로우가 수정되었습니다.' });
  } catch (e) {
    console.error('[workflows/update]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── DELETE /api/workflows/:id — 워크플로우 삭제 ───
router.delete('/:id', auth.requireRole('admin'), async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM workflow_definitions WHERE id = $1 AND tenant_id = $2 AND is_default = false RETURNING id',
      [req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'CANNOT_DELETE', message: '기본 워크플로우는 삭제할 수 없습니다.' });
    res.json({ message: '워크플로우가 삭제되었습니다.' });
  } catch (e) {
    console.error('[workflows/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ─── POST /api/workflows/:id/validate — 상태 전이 유효성 검사 ───
router.post('/:id/validate', async function (req, res) {
  try {
    var b = req.body;
    if (!b.from || !b.to) {
      return res.status(400).json({ error: 'VALIDATION', message: 'from과 to 상태가 필요합니다.' });
    }

    var r = await db.query(
      'SELECT transitions FROM workflow_definitions WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });

    var transitions = r.rows[0].transitions || [];
    var valid = transitions.some(function (t) {
      return (t.from === b.from || t.from === '*') && t.to === b.to;
    });

    res.json({ data: { valid: valid, from: b.from, to: b.to } });
  } catch (e) {
    console.error('[workflows/validate]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
