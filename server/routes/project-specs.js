// ─── 프로젝트 사양서 첨부·복사 (v13.196) — /api/projects/:id/spec-files, /:id/specs/copy-from/:srcId ───
//  사양서 본문 저장은 routes/projects.js PUT /:id/specs.
//  읽기: canRead(가시성) / 쓰기: canEdit(생성자·참여자·관리자·임원)
//  첨부 저장소: GCS 가 설정되면 storage_key(브라우저 → 서명 URL 로 직접 PUT),
//              아니면 이미지만 압축 data URI 로 DB 에(최대 4MB). draw.io 는 원본 XML + 미리보기 SVG 를 DB 에.
var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var authService = require('../services/auth.service');
var gcs = require('../services/gcs.service');
var pa = require('../lib/project-access');
var specPatch = require('../lib/spec-patch');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var _INLINE_MAX = 4 * 1024 * 1024;     // 인라인 이미지 data URI
var _DRAWIO_MAX = 4 * 1024 * 1024;     // draw.io XML·SVG 각각
var _FILE_MAX = 50 * 1024 * 1024;      // GCS 업로드 파일
var _KINDS = ['image', 'file', 'drawio'];
var _LIST_COLS = 'id, project_id, section_key, kind, name, mime, size, storage_key, data, preview_svg, caption, sort_order, created_by, created_at, updated_at';

async function _gate(req, res, projectId, needEdit) {
  var pr = await db.query('SELECT id, owner_id, visibility, department_id FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, req.tenant.id]);
  if (!pr.rows.length) { res.status(404).json({ error: 'NOT_FOUND', message: '프로젝트를 찾을 수 없습니다.' }); return null; }
  var ok = needEdit ? await pa.canEdit(req, pr.rows[0]) : await pa.canRead(req, pr.rows[0]);
  if (!ok) { res.status(403).json({ error: 'FORBIDDEN', message: needEdit ? '생성자·참여자·관리자만 사양서를 수정할 수 있습니다.' : '접근 권한이 없습니다.' }); return null; }
  return pr.rows[0];
}

function _keyPrefix(req, projectId) { return 'tenants/' + req.tenant.id + '/specs/' + projectId + '/'; }
function _sectionKey(v) { var s = String(v || ''); return /^[a-z0-9_]{0,60}$/.test(s) ? s : null; }

// GCS 객체에는 1시간짜리 읽기 URL 을 붙여 돌려준다 (img src·미리보기용)
async function _withUrls(rows) {
  if (!gcs.isEnabled()) return rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].storage_key) {
      try { rows[i].url = await gcs.signDownloadUrl(rows[i].storage_key, null, 60 * 60 * 1000); } catch (_) { rows[i].url = null; }
    }
  }
  return rows;
}

// GET /api/projects/:id/spec-files — 목록 (draw.io 원본 XML 제외)
router.get('/:id/spec-files', async function (req, res) {
  try {
    if (await _gate(req, res, req.params.id, false) === null) return;
    var r = await db.query('SELECT ' + _LIST_COLS + ' FROM project_spec_files WHERE project_id = $1 AND tenant_id = $2 ORDER BY section_key, sort_order, created_at', [req.params.id, req.tenant.id]);
    res.json({ data: await _withUrls(r.rows), storage: gcs.isEnabled() ? 'gcs' : 'inline' });
  } catch (e) {
    httpErr.serverError(res, '[spec-files/list]', e);
  }
});

// GET /api/projects/:id/spec-files/:fid — 한 건 전체 (draw.io 편집용 XML 포함)
router.get('/:id/spec-files/:fid', async function (req, res) {
  try {
    if (await _gate(req, res, req.params.id, false) === null) return;
    var r = await db.query('SELECT * FROM project_spec_files WHERE id = $1 AND project_id = $2 AND tenant_id = $3', [req.params.fid, req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: (await _withUrls(r.rows))[0] });
  } catch (e) {
    httpErr.serverError(res, '[spec-files/get]', e);
  }
});

// POST /api/projects/:id/spec-files/upload-url — GCS 업로드용 서명 URL. body: { name, mimeType, ext, size }
router.post('/:id/spec-files/upload-url', async function (req, res) {
  try {
    if (await _gate(req, res, req.params.id, true) === null) return;
    if (!gcs.isEnabled()) return res.status(503).json({ error: 'STORAGE_DISABLED', message: '파일 스토리지(GCS)가 설정되지 않았습니다.' });
    var b = req.body || {};
    if (Number(b.size) > _FILE_MAX) return res.status(413).json({ error: 'TOO_LARGE', message: '파일은 50MB 이하만 첨부할 수 있습니다.' });
    var mime = b.mimeType || 'application/octet-stream';
    var ext = String(b.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
    var key = _keyPrefix(req, req.params.id) + crypto.randomUUID() + (ext ? '.' + ext : '');
    var uploadUrl = await gcs.signUploadUrl(key, mime);
    res.json({ data: { uploadUrl: uploadUrl, storageKey: key, mimeType: mime } });
  } catch (e) {
    httpErr.serverError(res, '[spec-files/upload-url]', e, '업로드 URL 발급 실패');
  }
});

// POST /api/projects/:id/spec-files — 첨부 등록
//  body: { sectionKey, kind, name, mime, size, caption, storageKey | data | (drawioXml + previewSvg) }
router.post('/:id/spec-files', async function (req, res) {
  try {
    if (await _gate(req, res, req.params.id, true) === null) return;
    var b = req.body || {};
    var kind = String(b.kind || '');
    if (_KINDS.indexOf(kind) < 0) return res.status(400).json({ error: 'VALIDATION', message: '첨부 종류 오류' });
    var sec = _sectionKey(b.sectionKey);
    if (sec === null) return res.status(400).json({ error: 'VALIDATION', message: '섹션 키 오류' });
    var storageKey = null, data = null, xml = null, svg = null;
    if (kind === 'drawio') {
      xml = String(b.drawioXml || '');
      svg = String(b.previewSvg || '');
      if (!xml) return res.status(400).json({ error: 'VALIDATION', message: '도면 내용이 없습니다.' });
      if (xml.length > _DRAWIO_MAX || svg.length > _DRAWIO_MAX) return res.status(413).json({ error: 'TOO_LARGE', message: '도면이 너무 큽니다(4MB 이하).' });
      if (svg && svg.indexOf('data:image/svg+xml') !== 0) return res.status(400).json({ error: 'VALIDATION', message: '미리보기 형식 오류' });
    } else if (b.storageKey) {
      storageKey = String(b.storageKey);
      // 다른 테넌트·프로젝트의 객체를 가리키지 못하게 — upload-url 이 발급한 접두사만
      if (storageKey.indexOf(_keyPrefix(req, req.params.id)) !== 0 || storageKey.indexOf('..') >= 0) return res.status(400).json({ error: 'VALIDATION', message: '저장 위치 오류' });
    } else if (b.data) {
      data = String(b.data);
      if (kind !== 'image' || data.indexOf('data:image/') !== 0) return res.status(400).json({ error: 'VALIDATION', message: '스토리지 없이 첨부할 수 있는 것은 이미지뿐입니다.' });
      if (data.length > _INLINE_MAX) return res.status(413).json({ error: 'TOO_LARGE', message: '이미지가 너무 큽니다(4MB 이하).' });
    } else {
      return res.status(400).json({ error: 'VALIDATION', message: '첨부 내용이 없습니다.' });
    }
    var mr = await db.query('SELECT COALESCE(MAX(sort_order), -1) AS mx FROM project_spec_files WHERE project_id = $1 AND tenant_id = $2 AND section_key = $3', [req.params.id, req.tenant.id, sec]);
    var ord = parseInt(mr.rows[0].mx, 10) + 1;
    var id = 'psf-' + crypto.randomUUID().slice(0, 12);
    var r = await db.query(
      'INSERT INTO project_spec_files (id, tenant_id, project_id, section_key, kind, name, mime, size, storage_key, data, drawio_xml, preview_svg, caption, sort_order, created_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ' + _LIST_COLS,
      [id, req.tenant.id, req.params.id, sec, kind, String(b.name || '').slice(0, 255) || null, b.mime || null, Number(b.size) || null,
       storageKey, data, xml, svg || null, b.caption || null, ord, req.user.sub]
    );
    res.status(201).json({ data: (await _withUrls(r.rows))[0] });
    try { authService.auditLog(req.user.sub, 'project.spec_file.add', 'project', req.params.id, { kind: kind, section: sec }, req); } catch (_) {}
  } catch (e) {
    httpErr.serverError(res, '[spec-files/add]', e);
  }
});

// PUT /api/projects/:id/spec-files/:fid — 이름·설명·섹션, draw.io 원본·미리보기 수정
router.put('/:id/spec-files/:fid', async function (req, res) {
  try {
    if (await _gate(req, res, req.params.id, true) === null) return;
    var b = req.body || {};
    var sets = [], params = [], idx = 1;
    if (b.name !== undefined) { sets.push('name = $' + idx++); params.push(String(b.name || '').slice(0, 255) || null); }
    if (b.caption !== undefined) { sets.push('caption = $' + idx++); params.push(b.caption || null); }
    if (b.sectionKey !== undefined) {
      var sec = _sectionKey(b.sectionKey);
      if (sec === null) return res.status(400).json({ error: 'VALIDATION', message: '섹션 키 오류' });
      sets.push('section_key = $' + idx++); params.push(sec);
    }
    if (b.drawioXml !== undefined) {
      var xml = String(b.drawioXml || ''), svg = String(b.previewSvg || '');
      if (!xml) return res.status(400).json({ error: 'VALIDATION', message: '도면 내용이 없습니다.' });
      if (xml.length > _DRAWIO_MAX || svg.length > _DRAWIO_MAX) return res.status(413).json({ error: 'TOO_LARGE', message: '도면이 너무 큽니다(4MB 이하).' });
      if (svg && svg.indexOf('data:image/svg+xml') !== 0) return res.status(400).json({ error: 'VALIDATION', message: '미리보기 형식 오류' });
      sets.push("drawio_xml = $" + idx++); params.push(xml);
      sets.push("preview_svg = $" + idx++); params.push(svg || null);
    }
    if (!sets.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 내용이 없습니다.' });
    sets.push('updated_at = now()');
    params.push(req.params.fid, req.params.id, req.tenant.id);
    var r = await db.query(
      'UPDATE project_spec_files SET ' + sets.join(', ') + ' WHERE id = $' + idx + ' AND project_id = $' + (idx + 1) + ' AND tenant_id = $' + (idx + 2) +
      (b.drawioXml !== undefined ? " AND kind = 'drawio'" : '') + ' RETURNING ' + _LIST_COLS,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: (await _withUrls(r.rows))[0] });
  } catch (e) {
    httpErr.serverError(res, '[spec-files/update]', e);
  }
});

// GET /api/projects/:id/spec-files/:fid/download-url — GCS 원본 다운로드 URL (파일명 유지)
router.get('/:id/spec-files/:fid/download-url', async function (req, res) {
  try {
    if (await _gate(req, res, req.params.id, false) === null) return;
    var r = await db.query('SELECT name, storage_key FROM project_spec_files WHERE id = $1 AND project_id = $2 AND tenant_id = $3', [req.params.fid, req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!r.rows[0].storage_key) return res.status(404).json({ error: 'NO_BINARY', message: '스토리지에 저장된 파일이 아닙니다.' });
    if (!gcs.isEnabled()) return res.status(503).json({ error: 'STORAGE_DISABLED', message: '파일 스토리지(GCS)가 설정되지 않았습니다.' });
    res.json({ data: { downloadUrl: await gcs.signDownloadUrl(r.rows[0].storage_key, r.rows[0].name || 'file'), name: r.rows[0].name } });
  } catch (e) {
    httpErr.serverError(res, '[spec-files/download-url]', e, '다운로드 URL 발급 실패');
  }
});

// DELETE /api/projects/:id/spec-files/:fid
router.delete('/:id/spec-files/:fid', async function (req, res) {
  try {
    if (await _gate(req, res, req.params.id, true) === null) return;
    var r = await db.query('DELETE FROM project_spec_files WHERE id = $1 AND project_id = $2 AND tenant_id = $3 RETURNING storage_key', [req.params.fid, req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    if (r.rows[0].storage_key) { try { await gcs.deleteObject(r.rows[0].storage_key); } catch (err) { console.warn('[spec-files/delete] GCS', err.message); } }
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[spec-files/delete]', e);
  }
});

async function _byName(req) {
  var byName = req.user.name || '';
  try { var ar = await db.query('SELECT name, display_name FROM users WHERE id = $1', [req.user.sub]); if (ar.rows.length) byName = ar.rows[0].display_name || ar.rows[0].name || byName; } catch (_) {}
  return byName;
}
function _clip(v) {
  if (v == null) return null;
  var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 300 ? s.slice(0, 299) + '…' : (typeof v === 'object' ? v : s);
}
// 변경 이력 한 행 (이력 기록 실패가 저장을 막지 않게 호출부에서 catch)
function _logChanges(client, req, projectId, byName, kind, changes) {
  var list = (changes || []).slice(0, 300).map(function (c) { return { path: c.path, label: c.label || null, from: _clip(c.from), to: _clip(c.to) }; });
  return client.query(
    'INSERT INTO project_spec_changes (tenant_id, project_id, changed_by, changed_by_name, kind, changes) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.tenant.id, projectId, req.user.sub, byName, kind, JSON.stringify(list)]
  );
}

// PATCH /api/projects/:id/specs — 변경분 병합 저장 (여러 사람 동시 편집)
//  body: { changes: [{ path, from, to, label }] } — 규칙은 lib/spec-patch.js
//  응답: { data: { specs, specs_updated_by, specs_updated_at }, applied, conflicts }
//  409 STALE: 서버 문서가 이전 형식인데 부분 변경이 왔다 → 클라이언트가 다시 불러온다.
router.patch('/:id/specs', async function (req, res) {
  try {
    if (await _gate(req, res, req.params.id, true) === null) return;
    var changes = (req.body && req.body.changes) || [];
    var verr = specPatch.validate(changes);
    if (verr) return res.status(400).json({ error: 'VALIDATION', message: verr });
    if (JSON.stringify(changes).length > 2 * 1024 * 1024) return res.status(413).json({ error: 'TOO_LARGE', message: '변경 내용이 너무 큽니다.' });
    var byName = await _byName(req);
    var out = await db.transaction(async function (client) {
      var cur = await client.query('SELECT specs FROM projects WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [req.params.id, req.tenant.id]);
      var result = specPatch.applyChanges(cur.rows[0].specs || {}, changes);
      if (result.stale) return { stale: true };
      if (JSON.stringify(result.doc).length > 2 * 1024 * 1024) return { tooLarge: true };
      var row;
      if (result.applied.length) {
        var u = await client.query(
          'UPDATE projects SET specs = $1, specs_updated_by = $2, specs_updated_at = now(), updated_at = now() WHERE id = $3 AND tenant_id = $4 RETURNING specs, specs_updated_by, specs_updated_at',
          [JSON.stringify(result.doc), byName, req.params.id, req.tenant.id]
        );
        row = u.rows[0];
        var kind = result.applied.some(function (c) { return c.path[0] === 'templateId' || c.path[0] === 'templateVersion'; }) ? 'template' : 'edit';
        await client.query('SAVEPOINT spec_log');
        try { await _logChanges(client, req, req.params.id, byName, kind, result.applied); }
        catch (le) { await client.query('ROLLBACK TO SAVEPOINT spec_log'); console.warn('[specs/patch] log', le.message); }
      } else {
        var r2 = await client.query('SELECT specs, specs_updated_by, specs_updated_at FROM projects WHERE id = $1', [req.params.id]);
        row = r2.rows[0];
      }
      return { row: row, applied: result.applied.length, conflicts: result.conflicts };
    });
    if (out.stale) return res.status(409).json({ error: 'STALE', message: '사양서 형식이 바뀌었습니다. 새로 불러온 뒤 다시 저장하세요.' });
    if (out.tooLarge) return res.status(413).json({ error: 'TOO_LARGE', message: '사양서가 너무 큽니다(2MB 이하).' });
    res.json({ data: out.row, applied: out.applied, conflicts: out.conflicts });
    if (out.applied) { try { authService.auditLog(req.user.sub, 'project.specs.patch', 'project', req.params.id, { applied: out.applied, conflicts: out.conflicts.length }, req); } catch (_) {} }
  } catch (e) {
    httpErr.serverError(res, '[specs/patch]', e);
  }
});

// GET /api/projects/:id/spec-changes?limit=50 — 변경 이력 (최근 순)
router.get('/:id/spec-changes', async function (req, res) {
  try {
    if (await _gate(req, res, req.params.id, false) === null) return;
    var limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    var r = await db.query(
      'SELECT id, changed_by, changed_by_name, changed_at, kind, changes FROM project_spec_changes WHERE project_id = $1 AND tenant_id = $2 ORDER BY changed_at DESC, id DESC LIMIT $3',
      [req.params.id, req.tenant.id, limit]
    );
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[spec-changes/list]', e);
  }
});

// POST /api/projects/:id/specs/copy-from/:srcId — 이전 프로젝트 사양서 복사
//  대상 편집 권한 + 원본 읽기 권한. 본문(specs)과 draw.io 도면을 복사한다(이미지·파일은 복사하지 않음).
//  body: { specs } — 클라이언트가 specCopySheet 로 만든 본문(표 행 id 재발급). 없으면 원본 그대로.
router.post('/:id/specs/copy-from/:srcId', async function (req, res) {
  try {
    if (req.params.id === req.params.srcId) return res.status(400).json({ error: 'VALIDATION', message: '같은 프로젝트입니다.' });
    if (await _gate(req, res, req.params.id, true) === null) return;
    if (await _gate(req, res, req.params.srcId, false) === null) return;
    var src = await db.query('SELECT specs FROM projects WHERE id = $1 AND tenant_id = $2', [req.params.srcId, req.tenant.id]);
    var specs = (req.body && req.body.specs) || src.rows[0].specs || {};
    if (JSON.stringify(specs).length > 2 * 1024 * 1024) return res.status(413).json({ error: 'TOO_LARGE', message: '사양서가 너무 큽니다.' });
    var byName = await _byName(req);
    var out = await db.transaction(async function (client) {
      var u = await client.query(
        'UPDATE projects SET specs = $1, specs_updated_by = $2, specs_updated_at = now(), updated_at = now() WHERE id = $3 AND tenant_id = $4 RETURNING specs, specs_updated_by, specs_updated_at',
        [JSON.stringify(specs), byName, req.params.id, req.tenant.id]
      );
      var c = await client.query(
        'INSERT INTO project_spec_files (id, tenant_id, project_id, section_key, kind, name, mime, size, drawio_xml, preview_svg, caption, sort_order, created_by) ' +
        "SELECT 'psf-' || substr(md5(random()::text || f.id), 1, 12), f.tenant_id, $1, f.section_key, f.kind, f.name, f.mime, f.size, f.drawio_xml, f.preview_svg, f.caption, f.sort_order, $2 " +
        "FROM project_spec_files f WHERE f.project_id = $3 AND f.tenant_id = $4 AND f.kind = 'drawio'",
        [req.params.id, req.user.sub, req.params.srcId, req.tenant.id]
      );
      await client.query('SAVEPOINT spec_log');
      try { await _logChanges(client, req, req.params.id, byName, 'copy', [{ path: [], label: '다른 프로젝트 사양서 복사', from: null, to: req.params.srcId }]); }
      catch (le) { await client.query('ROLLBACK TO SAVEPOINT spec_log'); console.warn('[specs/copy-from] log', le.message); }
      return { row: u.rows[0], drawings: c.rowCount };
    });
    res.json({ data: out.row, copiedDrawings: out.drawings, message: '사양서를 복사했습니다.' });
    try { authService.auditLog(req.user.sub, 'project.specs.copy', 'project', req.params.id, { from: req.params.srcId, drawings: out.drawings }, req); } catch (_) {}
  } catch (e) {
    httpErr.serverError(res, '[specs/copy-from]', e);
  }
});

module.exports = router;
