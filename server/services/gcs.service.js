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

async function deleteObject(key) {
  _init();
  if (!_bucket || !key) return;
  await _bucket.file(key).delete({ ignoreNotFound: true });
}

module.exports = {
  isEnabled: isEnabled,
  signUploadUrl: signUploadUrl,
  signDownloadUrl: signDownloadUrl,
  deleteObject: deleteObject
};
