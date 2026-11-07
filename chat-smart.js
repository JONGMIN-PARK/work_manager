/**
 * chat-smart.js — ✨ 메신저 AI 정리 (v13.364)
 *   ① 안 읽은 게 많은 방을 열면 위에 "✨ 안 읽은 N개 요약 보기" → 요점 · 나에게 필요한 것 · 정한 것 · 할 일 · 답 없는 질문 (나만 봄)
 *   ② 글쓰기 창 "✨ 내용으로 채우기" → 제목 · 종류(요청/질문/공지/자료) · 장비 · 긴급을 채움
 *   ③ 🛠 요청함 "✨ 오늘 정리" → 오늘 먼저 할 순서 · 같은 장비끼리 묶기
 *   AI 가 없거나 한도를 넘으면 서버가 규칙으로 정리 (꼬리표로 'AI' / '자동 정리' 구분)
 *   chat-ui · chat-collab 가 부르는 것: chatSmartCatchup · chatSmartSuggest · chatSmartBrief
 */
var CS_MIN = 6;   // 이만큼 안 읽었으면 요약 띠
function _csToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _csErr(e) { return (e && e.data && e.data.message) || (e && e.message) || '정리하지 못했습니다'; }
function _csMd(t) { return typeof NbMd !== 'undefined' ? NbMd.render(String(t || '')).html : '<pre>' + (typeof _cxE === 'function' ? _cxE(t) : t) + '</pre>'; }
function _csTag(ai) { return '<em class="cs-tag ' + (ai ? 'ai' : 'rule') + '">' + (ai ? '✨ AI' : '⚙️ 자동 정리') + '</em>'; }

/* ① 안 읽은 요약 */
function chatSmartCatchup(sinceId) {
  if (typeof CX === 'undefined' || !CX.room) return;
  var me = typeof _cxMe === 'function' ? _cxMe() : null;
  var n = CX.msgs.filter(function (m) { return m.id > sinceId && m.userId !== me && m.kind !== 'system'; }).length;
  var old = document.getElementById('csCatch'); if (old) old.remove();
  if (n < CS_MIN) return;
  var host = document.getElementById('cxMsgs'); if (!host) return;
  var el = document.createElement('div'); el.id = 'csCatch'; el.className = 'cs-catch';
  el.innerHTML = '<button type="button" data-go>✨ 안 읽은 <b>' + n + '</b>개 — 요약 보기</button><button type="button" class="cx-ib" data-x title="닫기">✕</button>';
  host.parentNode.insertBefore(el, host);
  var room = CX.room;
  el.querySelector('[data-x]').onclick = function () { el.remove(); };
  el.querySelector('[data-go]').onclick = function () {
    var b = el.querySelector('[data-go]'); b.disabled = true; b.innerHTML = '✨ 정리하는 중…';
    apiFetch('/api/chat/rooms/' + encodeURIComponent(room) + '/catchup', { method: 'POST', body: JSON.stringify({ sinceId: sinceId }), timeoutMs: 90000 }).then(function (r) {
      if (CX.room !== room) return;
      el.className = 'cs-catch open';
      el.innerHTML = '<div class="cs-h"><b>✨ 안 읽은 ' + r.data.count + '개 정리</b>' + _csTag(r.data.ai) + '<span>나만 보는 정리입니다</span><button type="button" class="cx-ib" data-x title="닫기">✕</button></div><div class="cs-body nb-doc">' + _csMd(r.data.text) + '</div>';
      el.querySelector('[data-x]').onclick = function () { el.remove(); };
    }).catch(function (e) { b.disabled = false; b.innerHTML = '✨ 다시 시도'; _csToast(_csErr(e), 'error'); });
  };
}

/* ② 글쓰기 창 채우기 — apply(s) 로 창에 넣음 */
function chatSmartSuggest(text, btn, apply) {
  if (!String(text || '').trim()) { _csToast('먼저 내용을 적어 주세요 — 증상 · 상황을 그대로 적으면 됩니다', 'info'); return; }
  var label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '✨ 채우는 중…';
  apiFetch('/api/chat/posts/suggest', { method: 'POST', body: JSON.stringify({ text: text }), timeoutMs: 60000 }).then(function (r) {
    btn.disabled = false; btn.innerHTML = label;
    apply(r.data);
    _csToast((r.data.ai ? '✨ AI 가' : '⚙️ 자동으로') + ' 채웠습니다 — 확인하고 고쳐 주세요', 'success');
  }).catch(function (e) { btn.disabled = false; btn.innerHTML = label; _csToast(_csErr(e), 'error'); });
}

/* ③ 요청함 오늘 정리 */
function chatSmartBrief(host) {
  var old = host.querySelector('.cs-brief'); if (old) { old.remove(); return; }
  var el = document.createElement('div'); el.className = 'cs-brief'; el.innerHTML = '<div class="cx-loading">✨ 정리하는 중…</div>';
  host.insertBefore(el, host.firstChild);
  apiFetch('/api/chat/requests/brief', { timeoutMs: 90000 }).then(function (r) {
    el.innerHTML = '<div class="cs-h"><b>✨ 오늘 정리 · 남은 요청 ' + r.data.count + '개</b>' + _csTag(r.data.ai) + '<button type="button" class="cx-ib" data-x title="닫기">✕</button></div><div class="cs-body nb-doc">' + _csMd(r.data.text) + '</div>';
    el.querySelector('[data-x]').onclick = function () { el.remove(); };
  }).catch(function (e) { el.remove(); _csToast(_csErr(e), 'error'); });
}

if (typeof window !== 'undefined') { window.chatSmartCatchup = chatSmartCatchup; window.chatSmartSuggest = chatSmartSuggest; window.chatSmartBrief = chatSmartBrief; }
