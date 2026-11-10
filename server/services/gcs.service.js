// ─── Google Cloud Storage 서비스 ───
// 문서관리 파일 "원본 바이너리"를 GCS에 저장하고, 서명 URL(signed URL)로
// 브라우저 ↔ GCS 직접 업로드/다운로드를 중계한다. DB(project_files)에는 storage_key만 저장.
//
// 필요한 환경변수 (Render):
//   GCS_PROJECT_ID  — 예: gcalcli-488210
//   GCS_BUCKET      — 예: work-manager-docs
//   GCS_SA_KEY      — 서비스계정 JSON 키를 base64로 인코딩한 문자열
//
// 셋 다 없으면 비활성화(isEnabled()=false)되어, 라우트가 503을 반환한다.

var _storage = null;
var _bucket = null;
var _initErr = null;

function _init() {
  if (_storage || _initErr) return;
  try {
    var projectId = process.env.GCS_PROJECT_ID;
    var bucketName = process.env.GCS_BUCKET;
    var saKeyB64 = process.env.GCS_SA_KEY;
    if (!projectId || !bucketName || !saKeyB64) {
      _initErr = new Error('GCS env not configured (GCS_PROJECT_ID / GCS_BUCKET / GCS_SA_KEY)');
      return;
    }
    var Storage = require('@google-cloud/storage').Storage;
    var credentials = JSON.parse(Buffer.from(saKeyB64, 'base64').toString('utf8'));
    _storage = new Storage({ projectId: projectId, credentials: credentials });
    _bucket = _storage.bucket(bucketName);
    console.log('[GCS] initialized bucket=' + bucketName);
  } catch (e) {
    _initErr = e;
    console.error('[GCS] init failed:', e.message);
  }
}

function isEnabled() {
  _init();
  return !!_bucket;
}

// 업로드용 서명 URL (브라우저가 이 URL로 PUT 하면 GCS에 직접 저장됨)
async function signUploadUrl(key, mimeType, expiresMs) {
  _init();
  if (!_bucket) throw _initErr || new Error('GCS not enabled');
  var opts = {
    version: 'v4',
    action: 'write',
    expires: Date.now() + (expiresMs || 15 * 60 * 1000),
    contentType: mimeType || 'application/octet-stream'
  };
  var res = await _bucket.file(key).getSignedUrl(opts);
  return res[0];
}

// 다운로드용 서명 URL (브라우저가 이 URL로 GET 하면 GCS에서 직접 받음)
async function signDownloadUrl(key, downloadName, expiresMs) {
  _init();
  if (!_bucket) throw _initErr || new Error('GCS not enabled');
  var opts = {
    version: 'v4',
    action: 'read',
    expires: Date.now() + (expiresMs || 15 * 60 * 1000)
  };
  if (downloadName) {
    // 다운로드 시 원본 파일명 유지
    opts.responseDisposition = 'attachment; filename="' + encodeURIComponent(downloadName) + '"';
  }
  var res = await _bucket.file(key).getSignedUrl(opts);
  return res[0];
}

// 서버가 가진 바이트를 바로 올림 (텔레그램 첨부 · 메신저 파일) — v13.315 (예전엔 부르는 곳만 있고 함수가 없어 텔레그램 문서 저장이 늘 실패)
async function uploadBuffer(key, buf, mimeType) {
  _init();
  if (!_bucket) throw _initErr || new Error('GCS not enabled');
  await _bucket.file(key).save(buf, { contentType: mimeType || 'application/octet-stream', resumable: false });
}
async function copyObject(fromKey, toKey) {
  _init();
  if (!_bucket) throw _initErr || new Error('GCS not enabled');
  await _bucket.file(fromKey).copy(_bucket.file(toKey));
}

async function deleteObject(key) {
  _init();
  if (!_bucket || !key) return;
  await _bucket.file(key).delete({ ignoreNotFound: true });
}

/* v13.386 💬 큰 파일 — 브라우저가 GCS 로 바로 · 나눠서 · 끊기면 이어서 올림(서버는 허가만). 이어 올리기 세션 주소를 돌려줌
 *   origin 을 주면 GCS 가 그 출처에 CORS 헤더를 붙여 줌 */
async function createResumable(key, mimeType, origin) {
  _init();
  if (!_bucket) throw _initErr || new Error('GCS not enabled');
  var r = await _bucket.file(key).createResumableUpload({ origin: origin || undefined, metadata: { contentType: mimeType || 'application/octet-stream' } });
  return r[0];
}
async function objectSize(key) {
  _init();
  if (!_bucket) throw _initErr || new Error('GCS not enabled');
  var m = await _bucket.file(key).getMetadata();
  return +((m && m[0] && m[0].size) || 0);
}
/** 버킷 CORS 에 우리 출처 PUT 이 없으면 덧붙임(있던 설정은 그대로). 권한이 없으면 기록만 — 한 출처당 한 번 */
var _corsDone = {};
async function ensureCors(origin) {
  _init();
  if (!_bucket || !origin || _corsDone[origin]) return;
  _corsDone[origin] = true;
  try {
    var md = (await _bucket.getMetadata())[0] || {}, cors = Array.isArray(md.cors) ? md.cors.slice() : [];
    var ok = cors.some(function (c) { return (c.origin || []).some(function (o) { return o === '*' || o === origin; }) && (c.method || []).indexOf('PUT') >= 0; });
    if (ok) return;
    cors.push({ origin: [origin], method: ['GET', 'HEAD', 'PUT', 'POST', 'OPTIONS'], responseHeader: ['Content-Type', 'Content-Range', 'Range', 'x-goog-resumable', 'Location'], maxAgeSeconds: 3600 });
    await _bucket.setCorsConfiguration(cors);
    console.log('[GCS] CORS 에 출처 추가: ' + origin);
  } catch (e) { console.warn('[GCS] CORS 확인 실패(직접 올리기가 막히면 버킷 CORS 에 ' + origin + ' PUT 허용 필요):', e.message); }
}

/* v13.431 DB 백업 — 로컬 파일을 그대로 올림(큰 파일은 나눠서) · 접두어 아래 목록 · 작은 글 파일 읽기 */
async function uploadFile(key, localPath, mimeType) {
  _init();
  if (!_bucket) throw _initErr || new Error('GCS not enabled');
  var size = require('fs').statSync(localPath).size;
  await _bucket.upload(localPath, { destination: key, resumable: size > 8 * 1024 * 1024, contentType: mimeType || 'application/octet-stream' });
}
async function listObjects(prefix) {
  _init();
  if (!_bucket) throw _initErr || new Error('GCS not enabled');
  var r = await _bucket.getFiles({ prefix: prefix, autoPaginate: true });
  return (r[0] || []).map(function (f) { var m = f.metadata || {}; return { key: f.name, size: +(m.size || 0), updated: m.updated || m.timeCreated || null }; });
}
async function readText(key) {
  _init();
  if (!_bucket) throw _initErr || new Error('GCS not enabled');
  try { var r = await _bucket.file(key).download(); return r[0].toString('utf8'); }
  catch (e) { if (e && e.code === 404) return null; throw e; }
}

module.exports = {
  uploadFile: uploadFile,
  listObjects: listObjects,
  readText: readText,
  createResumable: createResumable,
  objectSize: objectSize,
  ensureCors: ensureCors,
  isEnabled: isEnabled,
  signUploadUrl: signUploadUrl,
  signDownloadUrl: signDownloadUrl,
  deleteObject: deleteObject,
  uploadBuffer: uploadBuffer,
  copyObject: copyObject
};
