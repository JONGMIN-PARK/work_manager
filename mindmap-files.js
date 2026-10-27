/* mindmap-files.js — 주제 첨부 파일 (v13.244)
 * 서버: /api/mindmaps/:id/files (061_mindmap_files, DB 저장 · 파일당 5MB · 맵당 100개).
 * 화면: 주제에 📎 개수 · 오른쪽 패널 [첨부] 칸(＋ 파일 · 내려받기 · 지우기) · 이미지가 아닌 파일을 주제에 끌어다 놓으면 첨부.
 * 상태 _mm.files = [{ id, node_id, name, mime, size, created_by, created_at, author_name }] — 맵 열 때 불러옴.
 */
var MM_FILE_MAX = 5 * 1024 * 1024;

function _mmFileUrl(fid) { return '/api/mindmaps/' + encodeURIComponent(_mm.mapId) + '/files' + (fid ? '/' + encodeURIComponent(fid) : ''); }

function mmLoadFiles() {
  var mapId = _mm.mapId;
  _mm.files = [];
  return apiFetch(_mmFileUrl()).then(function (r) {
    if (_mm.mapId !== mapId) return;
    _mm.files = (r && r.data) || [];
    if (_mm.files.length) _mmPaint();
  }).catch(function () { /* 서버 미배포 · 권한 — 첨부 없이 계속 */ });
}

function _mmFileSize(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n >= 1024 ? Math.round(n / 1024) + 'KB' : n + 'B';
}
function _mmFileIcon(f) {
  var m = (f.mime || '') + ' ' + f.name;
  if (/pdf/i.test(m)) return '📕';
  if (/sheet|excel|\.xlsx?|\.csv/i.test(m)) return '📗';
  if (/word|\.docx?/i.test(m)) return '📘';
  if (/presentation|powerpoint|\.pptx?/i.test(m)) return '📙';
  if (/image\//i.test(m)) return '🖼';
  if (/zip|compressed|\.7z|\.rar/i.test(m)) return '🗜';
  if (/\.(dwg|dxf|step|stp|igs)$/i.test(f.name)) return '📐';
  return '📄';
}
/** 주제 칸 안 📎 개수 */
function _mmFileBadge(n) {
  var k = (_mm.files || []).filter(function (f) { return f.node_id === n.id; }).length;
  return k ? '<span class="mm-filebadge" title="첨부 ' + k + '개">📎' + k + '</span>' : '';
}

function _mmFileRow(f) {
  return '<div class="mm-file" data-file-id="' + _mmEsc(f.id) + '"><span class="mm-file-ic">' + _mmFileIcon(f) + '</span>' +
    '<button class="mm-file-name" data-file-act="get" title="내려받기">' + _mmEsc(f.name) + '</button>' +
    '<span class="mm-hint">' + _mmFileSize(f.size) + '</span>' +
    (_mm.readOnly ? '' : '<button class="mm-file-del" data-file-act="del" title="지우기">✕</button>') + '</div>';
}
function _mmFilesPanelHtml(n, depth) {
  var list = (_mm.files || []).filter(function (f) { return f.node_id === n.id; });
  var h = '<div class="mm-pn-sec" id="mmPnFiles"><div class="mm-pn-h">첨부 ' + (list.length ? '<span class="mm-hint">' + list.length + '</span>' : '') +
    (_mm.readOnly ? '' : ' <span class="mm-hint">파일을 주제에 끌어다 놓아도 됨 · 5MB</span>') + '</div>' +
    list.map(_mmFileRow).join('') +
    (_mm.readOnly ? '' : '<button class="btn btn-g btn-s" data-file-act="add">＋ 파일</button>');
  if (depth === 0) {
    var alive = {};
    (_mm.doc.sheets || []).forEach(function (sh) { if (sh.root) mmWalk(sh.root, function (x) { alive[x.id] = true; }); });
    var orphan = (_mm.files || []).filter(function (f) { return !alive[f.node_id]; });
    if (orphan.length) h += '<details class="mm-cmt-orphan"><summary>지워진 주제의 첨부 ' + orphan.length + '</summary>' + orphan.map(_mmFileRow).join('') + '</details>';
  }
  if (!list.length && _mm.readOnly && depth !== 0) return '';
  return h + '</div>';
}

function _mmReadB64(file) {
  return new Promise(function (resolve, reject) {
    var rd = new FileReader();
    rd.onload = function () { resolve(String(rd.result).replace(/^data:[^,]*,/, '')); };
    rd.onerror = function () { reject(new Error('파일을 읽지 못했습니다')); };
    rd.readAsDataURL(file);
  });
}
/** 파일들 → 주제에 첨부 (하나씩) */
function mmAttachFiles(files, nodeId) {
  if (_mm.readOnly || !nodeId) return Promise.resolve();
  var list = Array.prototype.slice.call(files || []);
  var big = list.filter(function (f) { return f.size > MM_FILE_MAX; });
  list = list.filter(function (f) { return f.size <= MM_FILE_MAX && f.size > 0; });
  if (big.length) _mmToast('5MB 넘는 파일은 뺐습니다: ' + big.map(function (f) { return f.name; }).join(', '), 'warning');
  if (!list.length) return Promise.resolve();
  var mapId = _mm.mapId, done = 0;
  _mmToast('첨부하는 중… (' + list.length + '개)');
  var chain = Promise.resolve();
  list.forEach(function (f) {
    chain = chain.then(function () { return _mmReadB64(f); }).then(function (b64) {
      return apiFetch('/api/mindmaps/' + encodeURIComponent(mapId) + '/files', { method: 'POST', timeoutMs: 120000, body: JSON.stringify({ nodeId: nodeId, name: f.name, mime: f.type, data: b64 }) });
    }).then(function (r) { if (_mm.mapId === mapId) { _mm.files.push(r.data); done++; } });
  });
  return chain.catch(function (e) { _mmToast('❌ ' + _mmErr(e) + (done ? ' — ' + done + '개는 첨부했습니다' : ''), 'error'); })
    .then(function () { if (done) { _mmToast('📎 ' + done + '개 첨부했습니다', 'success'); _mmPaint(); } });
}

function _mmFileGet(f) {
  apiFetch(_mmFileUrl(f.id), { timeoutMs: 120000 }).then(function (r) {
    var bin = atob(r.data.data), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    _mmDownload(r.data.name, new Blob([arr], { type: r.data.mime || 'application/octet-stream' }));
  }).catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
}

function _mmBindFiles(pn, n) {
  var sec = pn.querySelector('#mmPnFiles');
  if (!sec) return;
  sec.onclick = function (e) {
    var b = e.target.closest('[data-file-act]');
    if (!b) return;
    var act = b.getAttribute('data-file-act');
    if (act === 'add') {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true;
      inp.onchange = function () { mmAttachFiles(inp.files, n.id); };
      inp.click();
      return;
    }
    var id = b.closest('[data-file-id]').getAttribute('data-file-id');
    var f = (_mm.files || []).filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    if (act === 'get') _mmFileGet(f);
    else if (act === 'del') {
      if (!confirm('「' + f.name + '」 첨부를 지울까요?')) return;
      apiFetch(_mmFileUrl(id), { method: 'DELETE' }).then(function () {
        _mm.files = _mm.files.filter(function (x) { return x.id !== id; });
        _mmPaint();
      }).catch(function (err) { _mmToast('❌ ' + _mmErr(err), 'error'); });
    }
  };
}
