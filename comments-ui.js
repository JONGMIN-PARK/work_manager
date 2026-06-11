/* ═══════════════════════════════════════════════════════════════════════
   comments-ui.js — 프로젝트/마일스톤 코멘트(피드백) UI 모듈
   ─────────────────────────────────────────────────────────────────────
   관리자/운영자/PL이 프로젝트·마일스톤에 코멘트를 남기고, 담당자에게
   메일/텔레그램으로 전송하는 UI. 서버 API 계약:
     POST   /api/comments   { targetType, targetId, body, sendEmail?, sendTelegram? } → 201 {data:comment}
     GET    /api/comments?targetType=&targetId=  → {data:[...]} (최신순)
     DELETE /api/comments/:id
   서버 미배포 시 404/네트워크 오류가 날 수 있으므로 graceful 처리(토스트).

   전역(런타임 로드) 의존: apiFetch, wmGuardedModal, wmWaitForEl, eH,
     showToast, currentUser, isOperator, _pdRelTime.
   typeof 가드를 둬서 로드 순서/미존재에 안전하게 동작.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── 내부 헬퍼 ───────────────────────────────────────────────────────── */
function _cmEsc(s) {
  if (typeof eH === 'function') return eH(s == null ? '' : String(s));
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _cmToast(msg, type) {
  if (typeof showToast === 'function') showToast(msg, type);
  else if (type === 'error') console.error(msg); else console.log(msg);
}

function _cmRelTime(iso) {
  if (typeof _pdRelTime === 'function') {
    var r = _pdRelTime(iso);
    if (r) return r;
  }
  try {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString();
  } catch (e) { return ''; }
}

/* 서버 오류를 사람이 읽을 토스트 문구로 변환 (graceful) */
function _cmErrToast(err, fallbackVerb) {
  var status = err && err.status;
  if (status === 403) {
    _cmToast('권한이 없습니다 (' + fallbackVerb + ' 불가)', 'error');
  } else if (status === 404 || status === 0 || !status) {
    // 404: 라우트 미존재(서버 미배포) · status 없음: 네트워크/타임아웃
    _cmToast('코멘트 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.', 'warn');
  } else {
    var detail = (err && err.data && (err.data.message || err.data.error)) || (err && err.message) || String(err);
    _cmToast(fallbackVerb + ' 실패: ' + detail + (status ? ' (HTTP ' + status + ')' : ''), 'error');
  }
}

/* ── 데이터 래퍼 ─────────────────────────────────────────────────────── */
async function commentsGet(targetType, targetId) {
  if (typeof apiFetch !== 'function') return [];
  var q = '?targetType=' + encodeURIComponent(targetType) + '&targetId=' + encodeURIComponent(targetId);
  var r = await apiFetch('/api/comments' + q);
  return (r && r.data) || [];
}

async function commentAdd(targetType, targetId, data) {
  data = data || {};
  var payload = {
    targetType: targetType,
    targetId: targetId,
    body: data.body,
    sendEmail: data.sendEmail !== false,
    sendTelegram: data.sendTelegram !== false
  };
  if (data.recipientIds) payload.recipientIds = data.recipientIds;
  if (data.parentId) payload.parentId = data.parentId; // 대댓글(답글) — 서버가 parent_id로 저장
  var r = await apiFetch('/api/comments', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return r && r.data;
}

async function commentDel(id) {
  return apiFetch('/api/comments/' + encodeURIComponent(id), { method: 'DELETE' });
}

/* ── 코멘트 작성 모달 ────────────────────────────────────────────────── */
/* openCommentModal(targetType, targetId, opts)
     opts: { title, projectId, containerId }
       - title       : 모달 헤더 표시용
       - projectId   : 표시용(현재는 안내 외 미사용)
       - containerId  : 전송 성공 시 갱신할 스레드 컨테이너 id(있으면 renderCommentThread 재호출) */
function openCommentModal(targetType, targetId, opts) {
  opts = opts || {};
  if (typeof wmGuardedModal !== 'function') {
    _cmToast('모달을 열 수 없습니다 (필수 모듈 미로드)', 'error');
    return;
  }
  return wmGuardedModal('comment',
    function () { _cmBuildCommentModal(targetType, targetId, opts); },
    'commentModal',
    { onOpen: function () { var t = document.getElementById('commentBody'); if (t) t.focus(); } }
  );
}

function _cmBuildCommentModal(targetType, targetId, opts) {
  var ex = document.getElementById('commentModal'); if (ex) ex.remove();

  var isReply = !!opts.parentId;
  var title = opts.title || (isReply ? '답글 작성' : (targetType === 'milestone' ? '마일스톤 피드백' : '프로젝트 피드백'));
  // 전송 성공 후 스레드 갱신용 컨텍스트 — 콜백 인자를 안전하게 넘기기 위해 전역 보관
  _cmModalCtx = {
    targetType: targetType,
    targetId: targetId,
    containerId: opts.containerId || '',
    parentId: opts.parentId || ''
  };
  var replyNote = isReply
    ? '<div style="font-size:11px;color:var(--ac);margin-bottom:8px;line-height:1.5">↩ <b>' + _cmEsc(opts.replyTo || '') + '</b> 님의 코멘트에 답글을 작성합니다.</div>'
    : '';

  var modal = document.createElement('div');
  modal.id = 'commentModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px)';
  // backdrop 클릭 닫기 비활성화 — 작성 중 데이터 유실 방지 (취소/✕ 버튼만 닫기)

  modal.innerHTML =
    '<div style="background:var(--bg-p);border:1px solid var(--bd);border-radius:14px;padding:20px;width:420px;max-width:95%;max-height:90vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.4)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px">' +
        '<h3 style="font-size:14px;font-weight:700;color:var(--t1);margin:0">💬 ' + _cmEsc(title) + '</h3>' +
        '<button class="btn btn-g btn-s" onclick="closeCommentModal()" aria-label="닫기">✕</button>' +
      '</div>' +
      replyNote +
      '<div style="font-size:11px;color:var(--t5);margin-bottom:8px;line-height:1.5">담당자에게 전송됩니다.</div>' +
      '<textarea id="commentBody" placeholder="' + (isReply ? '답글 내용을 입력하세요...' : '피드백 내용을 입력하세요...') + '" ' +
        'style="width:100%;min-height:120px;resize:vertical;box-sizing:border-box;padding:10px;font-size:13px;line-height:1.5;' +
        'color:var(--t2);background:var(--bg-i);border:1px solid var(--bd);border-radius:8px"></textarea>' +
      '<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t3);cursor:pointer">' +
          '<input type="checkbox" id="commentEmail" checked> 📧 메일 발송' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t3);cursor:pointer">' +
          '<input type="checkbox" id="commentTg" checked> ✈️ 텔레그램 발송' +
        '</label>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
        '<button class="btn btn-g btn-s" onclick="closeCommentModal()">취소</button>' +
        '<button class="btn btn-p btn-s" id="commentSendBtn" onclick="commentSendUI()">전송</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
}

function closeCommentModal() {
  var m = document.getElementById('commentModal');
  if (m) m.remove();
}

/* 모달 전송 컨텍스트(빌드 시점 저장) */
var _cmModalCtx = null;

async function commentSendUI() {
  var ctx = _cmModalCtx || {};
  var bodyEl = document.getElementById('commentBody');
  var emailEl = document.getElementById('commentEmail');
  var tgEl = document.getElementById('commentTg');
  var btn = document.getElementById('commentSendBtn');

  var body = bodyEl ? (bodyEl.value || '').trim() : '';
  if (!body) {
    _cmToast('내용을 입력하세요', 'warn');
    if (bodyEl) bodyEl.focus();
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '전송 중...'; }
  try {
    await commentAdd(ctx.targetType, ctx.targetId, {
      body: body,
      sendEmail: emailEl ? emailEl.checked : true,
      sendTelegram: tgEl ? tgEl.checked : true,
      parentId: ctx.parentId || undefined
    });
    closeCommentModal();
    _cmToast(ctx.parentId ? '답글 등록됨' : '피드백 전송됨');
    // 같은 화면에 스레드가 있으면 갱신
    if (ctx.containerId && document.getElementById(ctx.containerId)) {
      renderCommentThread(ctx.targetType, ctx.targetId, ctx.containerId);
    }
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '전송'; }
    _cmErrToast(err, '전송');
  }
}

/* ── 코멘트 스레드 렌더 ──────────────────────────────────────────────── */
/* renderCommentThread(targetType, targetId, containerId)
     지정 컨테이너에 "코멘트 추가" 버튼 + 코멘트 목록을 렌더한다. */
async function renderCommentThread(targetType, targetId, containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;

  var addBtn =
    '<div style="margin-bottom:10px">' +
      '<button class="btn btn-g btn-s" style="font-size:11px" ' +
        'onclick="openCommentModal(\'' + _cmEsc(targetType) + '\',\'' + _cmEsc(targetId) + '\',' +
        '{containerId:\'' + _cmEsc(containerId) + '\'})">💬 코멘트 추가</button>' +
    '</div>';

  el.innerHTML = addBtn + '<div style="font-size:11px;color:var(--t5)">로딩 중...</div>';

  var list;
  try {
    list = await commentsGet(targetType, targetId);
  } catch (err) {
    var status = err && err.status;
    var note = (status === 404 || !status)
      ? '코멘트 서버에 연결할 수 없습니다.'
      : ('코멘트를 불러오지 못했습니다' + (status ? ' (HTTP ' + status + ')' : ''));
    el.innerHTML = addBtn + '<div style="font-size:11px;color:var(--t6);padding:6px 0">' + _cmEsc(note) + '</div>';
    return;
  }

  if (!list || !list.length) {
    el.innerHTML = addBtn + '<div style="font-size:11px;color:var(--t6);padding:6px 0">아직 코멘트 없음</div>';
    return;
  }

  var meId = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  var iAmAdmin = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');

  // 스레드 트리 구성 — parent_id 기준. 최상위(질문)는 최신순(list가 DESC), 답글은 시간순(오래된→최신)
  var byId = {};
  list.forEach(function (c) { byId[c.id] = c; });
  var kids = {};
  var roots = [];
  list.forEach(function (c) {
    var pid = c.parentId || c.parent_id || null;
    if (pid && byId[pid]) { (kids[pid] = kids[pid] || []).push(c); }
    else { roots.push(c); }
  });
  Object.keys(kids).forEach(function (k) {
    kids[k].sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
  });

  function renderOne(c, depth) {
    var author = c.authorName || c.authorId || '알 수 없음';
    var when = _cmRelTime(c.createdAt);
    var canDel = iAmAdmin || (meId != null && c.authorId === meId);
    var delBtn = canDel
      ? '<button class="btn btn-d btn-s" style="font-size:10px;padding:1px 5px" title="삭제" ' +
          'onclick="commentDelUI(\'' + _cmEsc(c.id) + '\',\'' + _cmEsc(targetType) + '\',\'' +
          _cmEsc(targetId) + '\',\'' + _cmEsc(containerId) + '\')">🗑</button>'
      : '';
    // 답글(대댓글) — 로그인 당사자 명으로 작성됨(서버가 인증 사용자로 author 설정)
    var replyBtn = '<button class="btn btn-g btn-s" style="font-size:10px;padding:1px 5px" title="답글" ' +
        'onclick="openCommentModal(\'' + _cmEsc(targetType) + '\',\'' + _cmEsc(targetId) + '\',' +
        '{containerId:\'' + _cmEsc(containerId) + '\',parentId:\'' + _cmEsc(c.id) + '\',replyTo:\'' + _cmEsc(author) + '\'})">↩ 답글</button>';
    var bodyHtml = _cmEsc(c.body).replace(/\n/g, '<br>');
    var indent = depth > 0 ? ('margin-left:' + Math.min(depth, 4) * 16 + 'px;') : '';
    var accent = depth > 0 ? 'border-left:2px solid var(--ac);' : '';
    var html = '<div style="' + indent + 'padding:8px 10px;margin-bottom:6px;background:var(--bg-i);border:1px solid var(--bd);' + accent + 'border-radius:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px">' +
          '<span style="font-size:11px;font-weight:600;color:var(--t2)">' + (depth > 0 ? '↳ ' : '') + _cmEsc(author) + '</span>' +
          '<span style="display:flex;align-items:center;gap:6px">' +
            '<span style="font-size:10px;color:var(--t6)">' + _cmEsc(when) + '</span>' +
            replyBtn + delBtn +
          '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--t3);line-height:1.5;word-break:break-word">' + bodyHtml + '</div>' +
      '</div>';
    (kids[c.id] || []).forEach(function (ch) { html += renderOne(ch, depth + 1); });
    return html;
  }

  var rows = roots.map(function (c) { return renderOne(c, 0); }).join('');
  el.innerHTML = addBtn + rows;
}

/* ── 삭제 UI ─────────────────────────────────────────────────────────── */
async function commentDelUI(id, targetType, targetId, containerId) {
  if (!confirm('이 코멘트를 삭제하시겠습니까?')) return;
  try {
    await commentDel(id);
    _cmToast('코멘트가 삭제되었습니다');
    renderCommentThread(targetType, targetId, containerId);
  } catch (err) {
    _cmErrToast(err, '삭제');
  }
}

/* ── 전역 노출 (전역 함수 패턴 — 명시적 window 바인딩) ──────────────────── */
if (typeof window !== 'undefined') {
  window.commentsGet = commentsGet;
  window.commentAdd = commentAdd;
  window.commentDel = commentDel;
  window.openCommentModal = openCommentModal;
  window.closeCommentModal = closeCommentModal;
  window.commentSendUI = commentSendUI;
  window.renderCommentThread = renderCommentThread;
  window.commentDelUI = commentDelUI;
}
