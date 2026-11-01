/**
 * 텔레그램 사진 · 파일 · 음성 받기 (v13.304)
 *   download(fileId) → { buf, path }   (봇 API 한도 20MB)
 *   saveToDocs(user, file, projectId)  → 문서관리(project_files)에 원본 저장 (GCS)
 *     프로젝트에 편집 권한이 없으면 프로젝트 없이(올린 사람만 보이는) 문서로 저장
 */
var crypto = require('crypto');
var config = require('../config');
var db = require('../config/db');
var gcs = require('../services/gcs.service');
var pa = require('../lib/project-access');

var MAX_BYTES = 20 * 1024 * 1024;
var MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'video/mp4': 'mp4' };

function asReq(user) {
  return { user: { sub: user.user_id, role: user.role || 'member', departmentId: user.department_id || null }, tenant: { id: user.tenant_id } };
}

async function download(fileId) {
  var token = config.telegram.botToken;
  if (!token || !fileId) throw new Error('no file');
  var meta = await (await fetch('https://api.telegram.org/bot' + token + '/getFile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileId })
  })).json();
  if (!meta.ok || !meta.result || !meta.result.file_path) {
    var err = new Error((meta && meta.description) || 'getFile failed');
    if (/too big/i.test(err.message)) err.code = 'TOO_BIG';
    throw err;
  }
  if (meta.result.file_size && meta.result.file_size > MAX_BYTES) { var e2 = new Error('too big'); e2.code = 'TOO_BIG'; throw e2; }
  var res = await fetch('https://api.telegram.org/file/bot' + token + '/' + meta.result.file_path);
  if (!res.ok) throw new Error('download HTTP ' + res.status);
  var buf = Buffer.from(await res.arrayBuffer());
  return { buf: buf, path: meta.result.file_path };
}

/** 메시지에서 받을 파일 하나 고르기 — 사진은 가장 큰 것 */
function pickFile(msg) {
  if (msg.photo && msg.photo.length) {
    var p = msg.photo[msg.photo.length - 1];
    return { fileId: p.file_id, name: 'telegram-' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.jpg', mime: 'image/jpeg', size: p.file_size || 0, kind: 'photo' };
  }
  if (msg.document) {
    var d = msg.document;
    return { fileId: d.file_id, name: String(d.file_name || 'file').slice(0, 200), mime: d.mime_type || 'application/octet-stream', size: d.file_size || 0, kind: 'document' };
  }
  return null;
}

/**
 * 문서관리에 저장 → { ok: true, id, name, projectId } | { ok: false, reason: 'storage' | 'too_big' | 'error' }
 */
async function saveToDocs(user, file, projectId, memo) {
  if (!gcs.isEnabled()) return { ok: false, reason: 'storage' };
  if (file.size && file.size > MAX_BYTES) return { ok: false, reason: 'too_big' };
  var pid = null;
  if (projectId && await pa.canEditById(asReq(user), projectId)) pid = projectId;
  try {
    var got = await download(file.fileId);
    var ext = (String(file.name).match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || MIME_EXT[file.mime] || '';
    ext = ext.toLowerCase();
    var key = 'tenants/' + user.tenant_id + '/docs/' + crypto.randomUUID() + (ext ? '.' + ext : '');
    await gcs.uploadBuffer(key, got.buf, file.mime);
    var id = 'pf-' + crypto.randomUUID().slice(0, 12);
    await db.query(
      "INSERT INTO project_files (id, project_id, folder_id, name, ext, size, mime_type, storage_key, tags, memo, summary_history, version_history, uploaded_by, tenant_id) " +
      "VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,'[]','[]',$10,$11)",
      [id, pid, file.name, ext, got.buf.length, file.mime, key, JSON.stringify(['telegram']), memo || '텔레그램에서 올림', user.user_id, user.tenant_id]
    );
    return { ok: true, id: id, name: file.name, projectId: pid };
  } catch (e) {
    if (e.code === 'TOO_BIG') return { ok: false, reason: 'too_big' };
    console.error('[tg-files] save', e.message);
    return { ok: false, reason: 'error' };
  }
}

function failText(reason) {
  if (reason === 'storage') return '파일 저장소(GCS)가 설정되어 있지 않아 원본은 저장하지 못했습니다';
  if (reason === 'too_big') return '20MB 넘는 파일은 봇이 받을 수 없습니다 — 웹에서 올려 주세요';
  return '파일을 저장하지 못했습니다';
}

module.exports = { download: download, pickFile: pickFile, saveToDocs: saveToDocs, failText: failText, asReq: asReq, MAX_BYTES: MAX_BYTES };
