/* mindmap-comments.js — 주제 댓글 (v13.237)
 * 서버: /api/mindmaps/:id/comments (060_mindmap_comments). 읽기 권한이면 쓸 수 있음 — 보기 전용 공유 대상도 의견 가능.
 * 알림(서버): 본문의 @이름 · 주제 담당 · 같은 주제에 댓글 단 사람 · 맵 소유자 (쓴 사람 제외).
 * 화면: 주제에 💬 개수(해결 안 된 것) · 오른쪽 패널 "댓글" 칸(쓰기 Ctrl+Enter · 해결 · 고치기 · 지우기).
 *       중심 주제 패널에는 지워진 주제에 달린 댓글을 모아 보여줌.
 * 상태 _mm.comments = [{ id, node_id, body, resolved, created_by, created_at, updated_at, author_name }] — 맵 열 때 불러옴.
 */

function _mmCmtUrl(cid) { return '/api/mindmaps/' + encodeURIComponent(_mm.mapId) + '/comments' + (cid ? '/' + encodeURIComponent(cid) : ''); }

/** 맵을 열 때 · 새로고침 때 */
function mmLoadComments() {
  var mapId = _mm.mapId;
  _mm.comments = [];
  return apiFetch(_mmCmtUrl()).then(function (r) {
    if (_mm.mapId !== mapId) return;
    _mm.comments = (r && r.data) || [];
    // 댓글이 있을 때만 다시 그림 — 열자마자 누르던 주제가 바뀌지 않게
    if (_mm.comments.length) _mmPaint();
  }).catch(function () { /* 권한 · 서버 오류 — 댓글 없이 계속 */ });
}

/** 주제별 해결 안 된 댓글 수 */
function _mmCmtOpenCount(id) {
  var n = 0;
  (_mm.comments || []).forEach(function (c) { if (c.node_id === id && !c.resolved) n++; });
  return n;
}
/** 주제 칸 안 💬 표시 (해결 안 된 것이 있을 때만) */
function _mmCmtBadge(n) {
  var k = _mmCmtOpenCount(n.id);
  return k ? '<span class="mm-cmt" title="댓글 ' + k + '개 — 눌러서 보기">💬' + k + '</span>' : '';
}

function _mmCmtTime(s) {
  var d = new Date(s);
  return (typeof _mmFmtTime === 'function') ? _mmFmtTime(s) : (d.getMonth() + 1) + '/' + d.getDate();
}
/** @이름 강조 */
function _mmCmtBody(t) {
  return _mmEsc(t).replace(/(^|\s)(@[^\s@]+)/g, '$1<b class="mm-cmt-at">$2</b>').replace(/\n/g, '<br>');
}
function _mmCmtItem(c, showNode) {
  var me = typeof currentUser !== 'undefined' && currentUser && currentUser.id === c.created_by;
  var mgr = me || (_mm.row && _mm.row.is_owner);
  return '<div class="mm-cmt-item' + (c.resolved ? ' mm-cmt-done' : '') + '" data-cmt-id="' + _mmEsc(c.id) + '">' +
    '<div class="mm-cmt-head"><b>' + _mmEsc(c.author_name || '알 수 없음') + '</b><span class="mm-hint">' + _mmEsc(_mmCmtTime(c.created_at)) + (c.updated_at ? ' · 고침' : '') + '</span>' +
    (c.resolved ? '<span class="mm-cmt-tag">해결</span>' : '') + '</div>' +
    (showNode ? '<div class="mm-hint">' + _mmEsc(showNode) + '</div>' : '') +
    '<div class="mm-cmt-body">' + _mmCmtBody(c.body) + '</div>' +
    '<div class="mm-cmt-acts">' +
    ((me || _mm.canEdit) ? '<button data-cmt-act="resolve">' + (c.resolved ? '다시 열기' : '해결') + '</button>' : '') +
    (me ? '<button data-cmt-act="edit">고치기</button>' : '') +
    (mgr ? '<button data-cmt-act="del">지우기</button>' : '') + '</div></div>';
}

/** 오른쪽 패널 댓글 칸 HTML (단일 주제) */
function _mmCommentsPanelHtml(n, depth) {
  var list = (_mm.comments || []).filter(function (c) { return c.node_id === n.id; });
  var open = list.filter(function (c) { return !c.resolved; }).length;
  var h = '<div class="mm-pn-sec" id="mmPnCmt"><div class="mm-pn-h">댓글 ' + (list.length ? '<span class="mm-hint">' + open + ' / ' + list.length + '</span>' : '') +
    '<button class="mm-cmt-refresh" data-cmt-act="reload" title="새로고침">↻</button></div>' +
    '<div class="mm-cmt-list">' + list.map(function (c) { return _mmCmtItem(c); }).join('') + '</div>' +
    '<textarea id="mmCmtIn" class="mm-input" rows="2" placeholder="의견 남기기 — @이름 으로 알림, Ctrl+Enter 로 등록"></textarea>' +
    '<div class="mm-cmt-send"><button class="btn btn-p btn-s" data-cmt-act="send">등록</button></div>';
  // 중심 주제: 지워진 주제의 댓글
  if (depth === 0) {
    var alive = {};
    mmWalk(_mmRoot(), function (x) { alive[x.id] = true; });
    (_mm.doc.sheets || []).forEach(function (sh) { if (sh.root) mmWalk(sh.root, function (x) { alive[x.id] = true; }); });
    var orphan = (_mm.comments || []).filter(function (c) { return !alive[c.node_id]; });
    if (orphan.length) h += '<details class="mm-cmt-orphan"><summary>지워진 주제의 댓글 ' + orphan.length + '</summary>' + orphan.map(function (c) { return _mmCmtItem(c, '(지워진 주제)'); }).join('') + '</details>';
  }
  return h + '</div>';
}

function _mmCmtSend(n) {
  var ta = _mmEl('mmCmtIn');
  var body = ta ? ta.value.trim() : '';
  if (!body) return;
  ta.disabled = true;
  apiFetch(_mmCmtUrl(), { method: 'POST', body: JSON.stringify({ nodeId: n.id, body: body, nodeText: n.text || '', assigneeId: n.assigneeId || null }) })
    .then(function (r) {
      _mm.comments.push(r.data);
      ta.value = '';
      ta.blur();
      _mmPaint();
      var t = _mmEl('mmCmtIn'); if (t) t.focus();
    })
    .catch(function (e) { _mmToast('❌ 댓글을 남기지 못했습니다 — ' + _mmErr(e), 'error'); })
    .then(function () { var t = _mmEl('mmCmtIn'); if (t) t.disabled = false; });
}
function _mmCmtReplace(c) {
  _mm.comments = (_mm.comments || []).map(function (x) { return x.id === c.id ? c : x; });
  if (document.activeElement) document.activeElement.blur();
  _mmPaint();
}

/** 패널을 그린 뒤 — 보기 전용이어도 연결 (읽기 권한이면 댓글 가능) */
function _mmBindComments(pn, n) {
  var sec = pn.querySelector('#mmPnCmt');
  if (!sec) return;
  var ta = _mmEl('mmCmtIn');
  if (ta) ta.onkeydown = function (e) {
    e.stopPropagation();   // 맵 단축키로 가지 않게
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _mmCmtSend(n); }
  };
  pn.querySelectorAll('#mmPnCmt [data-cmt-act]').forEach(function (b) {
    b.onclick = function () {
      var act = b.getAttribute('data-cmt-act');
      if (act === 'send') return _mmCmtSend(n);
      if (act === 'reload') return mmLoadComments();
      var item = b.closest('[data-cmt-id]');
      var id = item && item.getAttribute('data-cmt-id');
      var c = (_mm.comments || []).filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      if (act === 'resolve') {
        apiFetch(_mmCmtUrl(id), { method: 'PUT', body: JSON.stringify({ resolved: !c.resolved }) }).then(function (r) { _mmCmtReplace(r.data); })
          .catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
      } else if (act === 'del') {
        if (!confirm('이 댓글을 지울까요?')) return;
        apiFetch(_mmCmtUrl(id), { method: 'DELETE' }).then(function () {
          _mm.comments = _mm.comments.filter(function (x) { return x.id !== id; });
          _mmPaint();
        }).catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
      } else if (act === 'edit') {
        var bodyEl = item.querySelector('.mm-cmt-body');
        bodyEl.innerHTML = '<textarea class="mm-input" rows="3"></textarea><div class="mm-cmt-send"><button class="btn btn-g btn-s" data-x="cancel">취소</button><button class="btn btn-p btn-s" data-x="ok">저장</button></div>';
        var ed = bodyEl.querySelector('textarea');
        ed.value = c.body;
        ed.focus();
        ed.onkeydown = function (e) { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) bodyEl.querySelector('[data-x="ok"]').click(); };
        bodyEl.querySelector('[data-x="cancel"]').onclick = function () { ed.blur(); _mmPaintPanel(); };
        bodyEl.querySelector('[data-x="ok"]').onclick = function () {
          apiFetch(_mmCmtUrl(id), { method: 'PUT', body: JSON.stringify({ body: ed.value }) }).then(function (r) { _mmCmtReplace(r.data); })
            .catch(function (e) { _mmToast('❌ ' + _mmErr(e), 'error'); });
        };
      }
    };
  });
}

// 주제의 💬 를 누르면 패널의 댓글 칸으로 (선택은 캔버스 클릭 처리가 함)
document.addEventListener('click', function (e) {
  if (!e.target.closest || !e.target.closest('#mmStage .mm-cmt')) return;
  setTimeout(function () {
    var sec = _mmEl('mmPnCmt');
    if (sec) { sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); var t = _mmEl('mmCmtIn'); if (t) t.focus({ preventScroll: true }); }
  }, 60);
});
