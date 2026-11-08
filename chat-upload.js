/* chat-upload.js — 💬 메신저 📦 큰 파일 직접 올리기 (v13.386)
 *   8MB 넘는 파일은 서버를 거치지 않고 GCS 로 바로 · 8MB 씩 나눠 · 끊기면 받은 데까지 묻고 이어서 올린다.
 *   서버는 허가(POST /rooms/:id/files/init → 이어 올리기 세션 주소)와 마무리(POST .../files/:fid/done)만.
 *   직접 올리기를 못 쓰면(GCS 꺼짐 · 막힘) reject({ fallback: true }) — 부르는 쪽(chat-ui.js _cxUploadOne)이 예전 25MB 경로로.
 *   의존(전역): apiFetch */
var CXU_DIRECT_MIN = 8 * 1024 * 1024;

/** 이 크기면 직접 올리기를 써 볼까 */
function chatUploadWantsDirect(f) { return !!(f && f.size > CXU_DIRECT_MIN && typeof XMLHttpRequest !== 'undefined'); }

/** 큰 파일 올리기 → Promise(메시지). opts: { replyTo, quoteId, grp, caption, onProgress(0~1), signal: { cancel } } */
function chatUploadDirect(f, room, opts) {
  opts = opts || {};
  var enc = encodeURIComponent(room);
  return apiFetch('/api/chat/rooms/' + enc + '/files/init', { method: 'POST', body: JSON.stringify({ name: f.name, mime: f.type || 'application/octet-stream', size: f.size }) })
    .then(function (r) {
      var d = r && r.data;
      if (!d || !d.direct) throw { fallback: true };
      return _cxuSend(f, d.url, d.chunk || CXU_DIRECT_MIN, opts).then(function () {
        return apiFetch('/api/chat/rooms/' + enc + '/files/' + encodeURIComponent(d.fid) + '/done', { method: 'POST', body: JSON.stringify({ caption: opts.caption || '', grp: opts.grp || null, replyTo: opts.replyTo || null, quoteId: opts.quoteId || null }) });
      }, function (e) { if (e && e.started === false) e.fallback = true; throw e; });
    })
    .then(function (r) { return r && r.data; });
}

/* 조각 보내기 — 각 조각 PUT (Content-Range). 308 = 계속, 200/201 = 끝. 실패하면 받은 양을 묻고(bytes * /전체) 그 뒤부터, 최대 6번 */
function _cxuSend(f, url, chunk, opts) {
  var total = f.size, sent = 0, tries = 0, started = false;
  chunk = Math.max(256 * 1024, Math.floor(chunk / (256 * 1024)) * 256 * 1024);   // GCS 는 256KB 배수
  function put(body, range) {
    return new Promise(function (ok, no) {
      var x = new XMLHttpRequest();
      x.open('PUT', url);
      x.setRequestHeader('Content-Range', range);
      if (opts.signal) opts.signal.cancel = function () { x.abort(); };
      if (body && opts.onProgress) x.upload.onprogress = function (e) { if (e.lengthComputable) opts.onProgress(Math.min(1, (sent + e.loaded) / total)); };
      x.onload = function () { ok(x); };
      x.onerror = function () { no({ net: true }); };
      x.onabort = function () { no({ cancel: true }); };
      x.send(body);
    });
  }
  function got(x) {   // 308 의 Range: bytes=0-N → N+1 바이트 받음
    var m = /bytes=0-(\d+)/.exec(x.getResponseHeader('Range') || '');
    return m ? +m[1] + 1 : 0;
  }
  function ask() { return put(null, 'bytes */' + total).then(function (x) { if (x.status === 200 || x.status === 201) return total; if (x.status === 308) return got(x); throw { status: x.status }; }); }
  function step() {
    if (sent >= total) return Promise.resolve();
    var end = Math.min(total, sent + chunk);
    return put(f.slice(sent, end), 'bytes ' + sent + '-' + (end - 1) + '/' + total).then(function (x) {
      started = true;
      if (x.status === 200 || x.status === 201) { sent = total; if (opts.onProgress) opts.onProgress(1); return; }
      if (x.status === 308) { sent = got(x) || end; tries = 0; return step(); }
      throw { status: x.status };
    }).catch(function (e) {
      if (e && e.cancel) throw e;
      if (!started && sent === 0 && tries === 0) { tries++; return ask().then(function (n) { sent = n; started = true; return step(); }, function () { throw { started: false, net: true }; }); }   // 첫 조각부터 막힘 = CORS · 연결 → 예전 경로로
      if (++tries > 6) throw e || { net: true };
      return new Promise(function (r) { setTimeout(r, Math.min(8000, 600 * Math.pow(2, tries))); })
        .then(ask).then(function (n) { sent = n; return step(); });
    });
  }
  return step();
}
