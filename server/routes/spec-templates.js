// ─── 장비 표준 사양서 양식 (v13.196) — /api/spec-templates ───
//  읽기: 테넌트 사용자 전체 / 쓰기(초안 저장·발행·삭제): admin
//  발행하면 spec_template_versions 에 불변 스냅샷이 쌓이고, 사양서는 (id, version) 만 참조한다.
//  테넌트에 양식이 하나도 없으면 클라이언트가 내장 기본 양식(spec-schema.js, id 'builtin')을 쓴다.
var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var authService = require('../services/auth.service');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var _SCHEMA_MAX = 512 * 1024; // 양식 JSON 최대 512KB
var _KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
var _ITEM_TYPES = ['text', 'textarea', 'number', 'select', 'table'];
var _COL_TYPES = ['text', 'number', 'select'];

function _requireAdmin(req, res) {
  if (req.user.role === 'admin') return true;
  res.status(403).json({ error: 'FORBIDDEN', message: '관리자만 표준 양식을 수정할 수 있습니다.' });
  return false;
}

// 구조 검사 — 클라이언트 specValidateSchema 와 같은 규칙의 최소판(키 형식·중복·유형)
function _validateSchema(schema) {
  if (!schema || !Array.isArray(schema.sections) || !schema.sections.length) return '섹션이 없습니다.';
  if (JSON.stringify(schema).length > _SCHEMA_MAX) return '양식이 너무 큽니다.';
  var secKeys = {}, itemKeys = {};
  for (var i = 0; i < schema.sections.length; i++) {
    var sec = schema.sections[i] || {};
    if (!_KEY_RE.test(sec.key || '') || secKeys[sec.key] || sec.key === 'hw') return '섹션 키 오류: ' + sec.key;
    secKeys[sec.key] = true;
    var items = Array.isArray(sec.items) ? sec.items : [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j] || {};
      if (!_KEY_RE.test(it.key || '') || itemKeys[it.key]) return '항목 키 오류: ' + it.key;
      itemKeys[it.key] = true;
      if (_ITEM_TYPES.indexOf(it.type) < 0) return '항목 유형 오류: ' + it.key;
      if (it.type === 'table') {
        var cols = Array.isArray(it.columns) ? it.columns : [];
        if (!cols.length) return '표에 열이 없습니다: ' + it.key;
        var ck = {};
        for (var k = 0; k < cols.length; k++) {
          var c = cols[k] || {};
          if (!_KEY_RE.test(c.key || '') || c.key === 'id' || ck[c.key]) return '열 키 오류: ' + it.key + '.' + c.key;
          ck[c.key] = true;
          if (_COL_TYPES.indexOf(c.type) < 0) return '열 유형 오류: ' + it.key + '.' + c.key;
        }
      }
    }
  }
  return null;
}

function _row(r) {
  return {
    id: r.id, name: r.name, description: r.description, draft: r.draft,
    current_version: r.current_version, is_default: r.is_default,
    updated_at: r.updated_at, published_at: r.published_at || null
  };
}

// GET /api/spec-templates — 목록 (초안 포함, 최신 발행본 schema 포함)
router.get('/', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT t.*, v.schema AS published_schema, v.published_at FROM spec_templates t ' +
      'LEFT JOIN spec_template_versions v ON v.template_id = t.id AND v.version = t.current_version ' +
      'WHERE t.tenant_id = $1 AND t.deleted_at IS NULL ORDER BY t.is_default DESC, t.created_at',
      [req.tenant.id]
    );
    res.json({ data: r.rows.map(function (row) { var o = _row(row); o.schema = row.published_schema || null; return o; }) });
  } catch (e) {
    httpErr.serverError(res, '[spec-templates/list]', e);
  }
});

// GET /api/spec-templates/:id/versions/:ver — 특정 발행 버전 (사양서가 참조하는 양식)
router.get('/:id/versions/:ver', async function (req, res) {
  try {
    var ver = parseInt(req.params.ver, 10);
    if (!(ver > 0)) return res.status(400).json({ error: 'BAD_REQUEST', message: '버전 오류' });
    var r = await db.query(
      'SELECT v.template_id, v.version, v.schema, v.published_at, t.name FROM spec_template_versions v JOIN spec_templates t ON t.id = v.template_id ' +
      'WHERE v.template_id = $1 AND v.version = $2 AND v.tenant_id = $3',
      [req.params.id, ver, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '양식 버전을 찾을 수 없습니다.' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[spec-templates/version]', e);
  }
});

// POST /api/spec-templates — 새 양식 (초안). body: { name, description?, draft }
router.post('/', async function (req, res) {
  try {
    if (!_requireAdmin(req, res)) return;
    var b = req.body || {};
    var name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'VALIDATION', message: '양식 이름을 입력하세요.' });
    var draft = b.draft || { sections: [] };
    if (JSON.stringify(draft).length > _SCHEMA_MAX) return res.status(413).json({ error: 'TOO_LARGE', message: '양식이 너무 큽니다.' });
    var cnt = await db.query('SELECT COUNT(*)::int AS n FROM spec_templates WHERE tenant_id = $1 AND deleted_at IS NULL', [req.tenant.id]);
    var id = 'stpl-' + crypto.randomUUID().slice(0, 12);
    var r = await db.query(
      'INSERT INTO spec_templates (id, tenant_id, name, description, draft, is_default, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *',
      [id, req.tenant.id, name, b.description || null, JSON.stringify(draft), cnt.rows[0].n === 0, req.user.sub]
    );
    res.status(201).json({ data: _row(r.rows[0]) });
    try { authService.auditLog(req.user.sub, 'spec_template.create', 'spec_template', id, { name: name }, req); } catch (_) {}
  } catch (e) {
    httpErr.serverError(res, '[spec-templates/create]', e);
  }
});

// PUT /api/spec-templates/:id — 초안·이름·기본 여부 저장 (발행본은 바뀌지 않음)
router.put('/:id', async function (req, res) {
  try {
    if (!_requireAdmin(req, res)) return;
    var b = req.body || {};
    var sets = [], params = [], idx = 1;
    if (b.name !== undefined) {
      if (!String(b.name).trim()) return res.status(400).json({ error: 'VALIDATION', message: '양식 이름을 입력하세요.' });
      sets.push('name = $' + idx++); params.push(String(b.name).trim());
    }
    if (b.description !== undefined) { sets.push('description = $' + idx++); params.push(b.description || null); }
    if (b.draft !== undefined) {
      if (JSON.stringify(b.draft).length > _SCHEMA_MAX) return res.status(413).json({ error: 'TOO_LARGE', message: '양식이 너무 큽니다.' });
      sets.push('draft = $' + idx++); params.push(JSON.stringify(b.draft || {}));
    }
    if (!sets.length && b.isDefault === undefined) return res.status(400).json({ error: 'VALIDATION', message: '변경할 내용이 없습니다.' });
    var out = await db.transaction(async function (client) {
      var own = await client.query('SELECT id FROM spec_templates WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.tenant.id]);
      if (!own.rows.length) return null;
      if (b.isDefault === true) {
        await client.query('UPDATE spec_templates SET is_default = FALSE WHERE tenant_id = $1 AND id <> $2', [req.tenant.id, req.params.id]);
        sets.push('is_default = TRUE');
      }
      sets.push('updated_by = $' + idx++); params.push(req.user.sub);
      sets.push('updated_at = now()');
      params.push(req.params.id, req.tenant.id);
      var r = await client.query('UPDATE spec_templates SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' AND tenant_id = $' + (idx + 1) + ' RETURNING *', params);
      return r.rows[0];
    });
    if (!out) return res.status(404).json({ error: 'NOT_FOUND', message: '양식을 찾을 수 없습니다.' });
    res.json({ data: _row(out) });
  } catch (e) {
    httpErr.serverError(res, '[spec-templates/update]', e);
  }
});

// POST /api/spec-templates/:id/publish — 초안을 새 버전으로 발행
router.post('/:id/publish', async function (req, res) {
  try {
    if (!_requireAdmin(req, res)) return;
    var result = await db.transaction(async function (client) {
      var t = await client.query('SELECT * FROM spec_templates WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.tenant.id]);
      if (!t.rows.length) return { status: 404 };
      var err = _validateSchema(t.rows[0].draft);
      if (err) return { status: 400, message: err };
      var ver = (t.rows[0].current_version || 0) + 1;
      await client.query(
        'INSERT INTO spec_template_versions (template_id, version, tenant_id, schema, published_by) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id, ver, req.tenant.id, JSON.stringify(t.rows[0].draft), req.user.sub]
      );
      var u = await client.query('UPDATE spec_templates SET current_version = $1, updated_by = $2, updated_at = now() WHERE id = $3 RETURNING *', [ver, req.user.sub, req.params.id]);
      return { status: 200, row: u.rows[0], version: ver };
    });
    if (result.status === 404) return res.status(404).json({ error: 'NOT_FOUND', message: '양식을 찾을 수 없습니다.' });
    if (result.status === 400) return res.status(400).json({ error: 'VALIDATION', message: result.message });
    var o = _row(result.row); o.schema = result.row.draft;
    res.json({ data: o, message: 'v' + result.version + ' 발행' });
    try { authService.auditLog(req.user.sub, 'spec_template.publish', 'spec_template', req.params.id, { version: result.version }, req); } catch (_) {}
  } catch (e) {
    httpErr.serverError(res, '[spec-templates/publish]', e);
  }
});

// DELETE /api/spec-templates/:id — 소프트 삭제 (발행 버전은 남아 기존 사양서가 계속 열린다)
router.delete('/:id', async function (req, res) {
  try {
    if (!_requireAdmin(req, res)) return;
    var r = await db.query('UPDATE spec_templates SET deleted_at = now(), is_default = FALSE WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '양식을 찾을 수 없습니다.' });
    res.json({ message: '삭제 완료' });
    try { authService.auditLog(req.user.sub, 'spec_template.delete', 'spec_template', req.params.id, {}, req); } catch (_) {}
  } catch (e) {
    httpErr.serverError(res, '[spec-templates/delete]', e);
  }
});

router._validateSchema = _validateSchema;
module.exports = router;
