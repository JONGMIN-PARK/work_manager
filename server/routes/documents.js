var express = require('express');
var sv = require('../lib/safe-val');
var router = express.Router();
var db = require('../config/db');
var gcs = require('../services/gcs.service');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var { parsePagination } = require('../middleware/pagination');
var ps = require('../lib/project-access');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

// ═══ 권한 (v13.281) ═══
// 프로젝트 문서 → 프로젝트 규칙(읽기 gateRead · 쓰기 gateEdit = 관리자·임원·생성자·참여자)
// 프로젝트 없는 문서 → 만든 사람(또는 관리자)만. 남의 것은 존재 여부를 숨기려고 404.
var OWNER_COL = { project_folders: 'created_by', project_files: 'uploaded_by' };

/** 행 권한 게이트 — 통과하면 행 {id, project_id, folder_id?, _owner}, 아니면 응답 보내고 null */
async function _gateDoc(req, res, table, id, mode) {
  var cols = 'id, project_id, ' + OWNER_COL[table] + ' AS _owner' + (table === 'project_files' ? ', folder_id' : ', parent_id');
  var r = await db.query('SELECT ' + cols + ' FROM ' + table + ' WHERE id = $1 AND tenant_id = $2', [id, req.tenant.id]);
  if (!r.rows.length) { res.status(404).json({ error: 'NOT_FOUND' }); return null; }
  var row = r.rows[0];
  if (row.project_id) {
    var ok = mode === 'edit' ? await ps.gateEdit(req, res, row.project_id, '생성자·참여자·관리자만 문서를 수정할 수 있습니다.')
      : await ps.gateRead(req, res, row.project_id);
    return ok ? row : null;
  }
  if (row._owner === req.user.sub || req.user.role === 'admin') return row;
  res.status(404).json({ error: 'NOT_FOUND' });
  return null;
}

/** 새로 만들 문서의 프로젝트 쓰기 권한 (프로젝트 없으면 통과) */
async function _gateNewDoc(req, res, projectId) {
  if (!projectId) return true;
  return ps.gateEdit(req, res, projectId, '생성자·참여자·관리자만 문서를 올릴 수 있습니다.');
}

/** folderId 가 같은 테넌트·같은 프로젝트의 폴더인지 (null 은 통과). 아니면 400 응답 후 false */
async function _checkFolder(req, res, folderId, projectId) {
  if (!folderId) return true;
  var r = await db.query('SELECT project_id FROM project_folders WHERE id = $1 AND tenant_id = $2', [folderId, req.tenant.id]);
  if (r.rows.length && (r.rows[0].project_id || null) === (projectId || null)) return true;
  res.status(400).json({ error: 'VALIDATION', message: '폴더가 이 프로젝트에 없습니다.' });
  return false;
}

/** 원본 키는 이 테넌트 영역(upload-url 이 만든 형식)만 허용 — 남의 객체를 서명·삭제하지 못하게 */
function _validStorageKey(req, key) {
  return !key || String(key).indexOf('tenants/' + req.tenant.id + '/docs/') === 0;
}

// ═══ 폴더 ═══

// GET /api/folders?projectId=xxx — v13.34 가시성: 접근 가능한 프로젝트 + 본인이 만든 프로젝트-없는 폴더
router.get('/folders', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM project_folders WHERE tenant_id = $1';
    var params = [req.tenant.id];
    var idx = 2;
    if (req.query.projectId) {
      sql += ' AND project_id = $' + idx++;
      params.push(req.query.projectId);
    }
    var meIdx = idx++;
    params.push(req.user.sub);
    var sub = ps.accessibleProjectsSubquery(req, idx);
    sql += ' AND ((project_id IS NULL AND created_by = $' + meIdx + ') OR project_id IN (' + sub.sql + '))';
    params = params.concat(sub.params);
    idx = sub.nextIdx;

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY sort_order, name';
    sql += ' LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    httpErr.serverError(res, '[folders/list]', e);
  }
});

// GET /api/folders/:id — 단건 (v13.281: 예전엔 테넌트 목록 첫 100건에서 찾아 오래된 폴더를 못 찾았다)
router.get('/folders/:id', async function (req, res) {
  try {
    if (!await _gateDoc(req, res, 'project_folders', req.params.id, 'read')) return;
    var r = await db.query('SELECT * FROM project_folders WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[folders/get]', e);
  }
});

function _phaseKey(v) { return (typeof v === 'string' && /^[a-z]{1,20}$/.test(v)) ? v : null; }

// POST /api/folders
router.post('/folders', async function (req, res) {
  try {
    var b = req.body;
    var id = sv.safeId(b.id, function () { return 'df-' + require('crypto').randomUUID().slice(0, 12); });
    var projectId = b.projectId || b.project_id || null;
    var parentId = b.parentId || b.parent_id || null;
    if (!await _gateNewDoc(req, res, projectId)) return;
    if (!await _checkFolder(req, res, parentId, projectId)) return;
    var r = await db.query(
      "INSERT INTO project_folders (id, project_id, parent_id, name, memo, phase, sort_order, created_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [id, projectId, parentId, b.name || '', b.memo || '', _phaseKey(b.phase),
       parseInt(b.sortOrder !== undefined ? b.sortOrder : (b.sort_order !== undefined ? b.sort_order : b.order), 10) || 0,
       req.user.sub, req.tenant.id]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[folders/create]', e);
  }
});

// PUT /api/folders/:id
router.put('/folders/:id', async function (req, res) {
  try {
    var b = req.body;
    var cur = await _gateDoc(req, res, 'project_folders', req.params.id, 'edit');
    if (!cur) return;
    var parentId = b.parentId || b.parent_id || null;
    if (parentId && parentId !== cur.parent_id) {
      if (parentId === cur.id) return res.status(400).json({ error: 'VALIDATION', message: '자기 자신 아래로 옮길 수 없습니다.' });
      if (!await _checkFolder(req, res, parentId, cur.project_id)) return;
    }
    var r = await db.query(
      "UPDATE project_folders SET name=COALESCE($1,name), memo=COALESCE($2,memo), parent_id=COALESCE($3,parent_id), updated_at=now() WHERE id=$4 AND tenant_id=$5 RETURNING *",
      [b.name, b.memo, parentId, req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[folders/update]', e);
  }
});

// DELETE /api/folders/:id
router.delete('/folders/:id', async function (req, res) {
  try {
    if (!await _gateDoc(req, res, 'project_folders', req.params.id, 'edit')) return;
    var r = await db.query(
      'WITH upd_files AS (UPDATE project_files SET folder_id = NULL WHERE folder_id = $1 AND tenant_id = $2), upd_folders AS (UPDATE project_folders SET parent_id = NULL WHERE parent_id = $1 AND tenant_id = $2) DELETE FROM project_folders WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ message: '삭제 완료' });
  } catch (e) {
    httpErr.serverError(res, '[folders/delete]', e);
  }
});

// ═══ 파일 (메타데이터) ═══

// GET /api/files?projectId=xxx&folderId=yyy — v13.34 가시성
router.get('/files', async function (req, res) {
  try {
    var sql = 'SELECT *, COUNT(*) OVER() AS _total FROM project_files WHERE tenant_id = $1';
    var params = [req.tenant.id];
    var idx = 2;
    if (req.query.projectId) { sql += ' AND project_id = $' + idx++; params.push(req.query.projectId); }
    if (req.query.folderId) { sql += ' AND folder_id = $' + idx++; params.push(req.query.folderId); }
    var meIdx = idx++;
    params.push(req.user.sub);
    var sub = ps.accessibleProjectsSubquery(req, idx);
    // project_files의 작성자 컬럼은 uploaded_by (project_folders는 created_by — 주의)
    sql += ' AND ((project_id IS NULL AND uploaded_by = $' + meIdx + ') OR project_id IN (' + sub.sql + '))';
    params = params.concat(sub.params);
    idx = sub.nextIdx;

    var pg = parsePagination(req.query, 100);
    sql += ' ORDER BY created_at DESC LIMIT $' + idx++ + ' OFFSET $' + idx++;
    params.push(pg.limit, pg.offset);
    var r = await db.query(sql, params);
    var total = r.rows.length > 0 ? parseInt(r.rows[0]._total, 10) : 0;
    r.rows.forEach(function(row) { delete row._total; });
    res.json({ data: r.rows, total: total, limit: pg.limit, offset: pg.offset });
  } catch (e) {
    httpErr.serverError(res, '[files/list]', e);
  }
});

// POST /api/files
router.post('/files', async function (req, res) {
  try {
    var b = req.body;
    var id = sv.safeId(b.id, function () { return 'pf-' + require('crypto').randomUUID().slice(0, 12); });
    var projectId = b.projectId || b.project_id || null;
    var folderId = b.folderId || b.folder_id || null;
    var storageKey = b.storageKey || b.storage_key || null;
    if (!_validStorageKey(req, storageKey)) return res.status(400).json({ error: 'VALIDATION', message: '잘못된 저장 위치입니다.' });
    if (!await _gateNewDoc(req, res, projectId)) return;
    if (!await _checkFolder(req, res, folderId, projectId)) return;
    var r = await db.query(
      "INSERT INTO project_files (id, project_id, folder_id, name, ext, size, mime_type, storage_key, text_cache, tags, memo, summary_history, version_history, uploaded_by, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
      [id, projectId, folderId,
       b.name || '', b.ext || '', b.size || 0, b.mimeType || b.mime_type || '',
       storageKey, b.textCache || b.text_cache || null,
       JSON.stringify(b.tags || []), b.memo || '',
       JSON.stringify(b.summaryHistory || b.summary_history || []),
       JSON.stringify(b.versionHistory || b.version_history || []),
       req.user.sub, req.tenant.id]
    );
    res.status(201).json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[files/create]', e);
  }
});

// POST /api/docs/files/upload-url — 원본 업로드용 GCS 서명 URL 발급
// body: { name, mimeType, ext, projectId } → { uploadUrl, storageKey }  (projectId 가 있으면 쓰기 권한 확인)
// 프론트는 uploadUrl로 파일을 직접 PUT한 뒤, storageKey를 POST /files 메타데이터에 넣는다.
router.post('/files/upload-url', async function (req, res) {
  try {
    if (!gcs.isEnabled()) {
      return res.status(503).json({ error: 'STORAGE_DISABLED', message: '파일 스토리지(GCS)가 설정되지 않았습니다.' });
    }
    var b = req.body || {};
    if (!await _gateNewDoc(req, res, b.projectId || b.project_id || null)) return;
    var mime = b.mimeType || b.mime_type || 'application/octet-stream';
    var ext = (b.ext || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    // 테넌트별 격리 + 충돌 없는 키. 원본 파일명은 DB(name)에 보관하므로 키는 불투명해도 됨.
    var uid = require('crypto').randomUUID();
    var key = 'tenants/' + req.tenant.id + '/docs/' + uid + (ext ? '.' + ext : '');
    var uploadUrl = await gcs.signUploadUrl(key, mime);
    res.json({ data: { uploadUrl: uploadUrl, storageKey: key, mimeType: mime } });
  } catch (e) {
    httpErr.serverError(res, '[files/upload-url]', e, '업로드 URL 발급 실패');
  }
});

// GET /api/docs/files/:id/download-url — 원본 다운로드용 GCS 서명 URL 발급
router.get('/files/:id/download-url', async function (req, res) {
  try {
    if (!await _gateDoc(req, res, 'project_files', req.params.id, 'read')) return;
    var r = await db.query(
      'SELECT id, name, storage_key FROM project_files WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    var row = r.rows[0];
    if (!row.storage_key) {
      return res.status(404).json({ error: 'NO_BINARY', message: '이 파일은 원본이 저장되어 있지 않습니다.' });
    }
    if (!gcs.isEnabled()) {
      return res.status(503).json({ error: 'STORAGE_DISABLED', message: '파일 스토리지(GCS)가 설정되지 않았습니다.' });
    }
    var url = await gcs.signDownloadUrl(row.storage_key, row.name);
    res.json({ data: { downloadUrl: url, name: row.name } });
  } catch (e) {
    httpErr.serverError(res, '[files/download-url]', e, '다운로드 URL 발급 실패');
  }
});

// GET /api/docs/files/:id — 단건 (v13.281)
router.get('/files/:id', async function (req, res) {
  try {
    if (!await _gateDoc(req, res, 'project_files', req.params.id, 'read')) return;
    var r = await db.query('SELECT * FROM project_files WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[files/get]', e);
  }
});

// PUT /api/files/:id
router.put('/files/:id', async function (req, res) {
  try {
    var b = req.body;
    var cur = await _gateDoc(req, res, 'project_files', req.params.id, 'edit');
    if (!cur) return;
    var sets = [];
    var params = [];
    var idx = 1;

    if (b.name !== undefined) { sets.push('name=$' + idx++); params.push(b.name); }
    if (b.ext !== undefined) { sets.push('ext=$' + idx++); params.push(String(b.ext || '').slice(0, 20)); }
    if (b.folderId !== undefined || b.folder_id !== undefined) {
      var fid = b.folderId || b.folder_id || null;
      if (fid !== cur.folder_id && !await _checkFolder(req, res, fid, cur.project_id)) return;
      sets.push('folder_id=$' + idx++); params.push(fid);
    }
    if (b.tags !== undefined) { sets.push('tags=$' + idx++); params.push(JSON.stringify(b.tags)); }
    if (b.memo !== undefined) { sets.push('memo=$' + idx++); params.push(b.memo); }
    if (b.textCache !== undefined || b.text_cache !== undefined) { sets.push('text_cache=$' + idx++); params.push(b.textCache || b.text_cache); }
    if (b.summaryHistory !== undefined) { sets.push('summary_history=$' + idx++); params.push(JSON.stringify(b.summaryHistory)); }
    if (b.versionHistory !== undefined) { sets.push('version_history=$' + idx++); params.push(JSON.stringify(b.versionHistory)); }

    if (!sets.length) return res.status(400).json({ error: 'VALIDATION', message: '변경할 필드가 없습니다.' });

    sets.push('updated_at=now()');
    params.push(req.params.id);
    var idIdx = idx++;
    params.push(req.tenant.id);
    var sql = 'UPDATE project_files SET ' + sets.join(',') + ' WHERE id=$' + idIdx + ' AND tenant_id=$' + idx + ' RETURNING *';
    var r = await db.query(sql, params);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[files/update]', e);
  }
});

// DELETE /api/files/:id
router.delete('/files/:id', async function (req, res) {
  try {
    if (!await _gateDoc(req, res, 'project_files', req.params.id, 'edit')) return;
    var r = await db.query('DELETE FROM project_files WHERE id = $1 AND tenant_id = $2 RETURNING id, storage_key', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND' });
    // GCS 원본도 삭제 (실패해도 메타데이터 삭제는 성공 처리 — 고아 객체는 추후 정리)
    var sk = r.rows[0].storage_key;
    if (sk && gcs.isEnabled()) {
      gcs.deleteObject(sk).catch(function (e) { console.warn('[files/delete] GCS delete failed:', e.message); });
    }
    res.json({ message: '삭제 완료', storageKey: sk });
  } catch (e) {
    httpErr.serverError(res, '[files/delete]', e);
  }
});

module.exports = router;
