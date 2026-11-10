/**
 * chat-collab.js — 메신저 협업 (v13.358)
 *   📌 방 게시판: 공지 · 자료 · 질문 · 🛠 요청(장비 ↔ 프로그래머: 장비 · 현상 · 긴급 · 담당 · 기한 → 접수 · 처리 중 · 완료 → 🐞 이슈로)
 *      글은 대화 흐름에도 카드로 보이고, 댓글은 답글 줄기. 옆 칸 '📌 게시판' 탭에서 모아 보기
 *   🛠 요청함: 여러 방에 걸친 '나에게 온 요청 · 내가 올린 요청'
 *   📁 내 폴더: 메시지 · 사진 · 파일 · 글을 골라 내 폴더에 모아 두기 (나만 봄)
 *   </> 코드 블록: ```언어 … ``` · `한 줄 코드` — 고정폭 · 복사 단추
 *   chat-ui.js 가 부르는 것: chatCodeText · chatPostHtml · chatPostModal · chatPostsTab · chatSaveMenu · chatLibrary · chatCollabOnUpd
 */
var CC = { posts: null, postsCat: '', postsOpen: false, folders: null, libTab: 'folders', libFolder: null, libKind: '', libQ: '', reqWho: 'me', reqOpen: true };
var CC_CAT = { notice: ['📢', '공지'], data: ['📎', '자료'], qna: ['❓', '질문'], req: ['🛠', '요청'] };
var CC_ST = { open: '접수', doing: '처리 중', done: '완료', solved: '해결됨' };
function _ccE(s) { return typeof _cxE === 'function' ? _cxE(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _ccToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _ccErr(e) { return (e && e.data && e.data.message) || (e && e.message) || '실패했습니다'; }
function _ccMe() { return typeof _cxMe === 'function' ? _cxMe() : null; }

/* ─── </> 코드 블록 · 한 줄 코드 (메시지 글 → HTML) ─── */
function chatCodeText(s, inline) {
  s = String(s || '');
  var out = '', re = /```([A-Za-z0-9+#._-]{0,20})[ \t]*\n?([\s\S]*?)```/g, last = 0, mm;
  while ((mm = re.exec(s))) {
    out += _ccPlain(s.slice(last, mm.index), inline);
    var code = mm[2].replace(/\n$/, ''), lines = code.split('\n').length;
    out += '<div class="cx-code"><div class="cx-code-h"><span>' + _ccE(mm[1] || 'code') + ' · ' + lines + '줄</span><button type="button" data-copycode title="코드 복사">📋 복사</button></div><pre><code>' + _ccE(code) + '</code></pre></div>';
    last = re.lastIndex;
  }
  return out + _ccPlain(s.slice(last), inline);
}
function _ccPlain(t, inline) {
  if (!t) return '';
  t = t.replace(/^\n+|\n+$/g, function (x) { return x.length > 1 ? '\n' : ''; });
  var parts = t.split(/(`[^`\n]{1,300}`)/g);
  return parts.map(function (p) {
    if (/^`[^`\n]+`$/.test(p)) return '<code class="cx-ic">' + _ccE(p.slice(1, -1)) + '</code>';
    var h = _ccE(p);
    h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    h = h.replace(/(^|\s)@([^\s@<]{1,20})/g, function (x, a, tok) { return a + (typeof _cxAtHtml === 'function' ? _cxAtHtml(tok) : '<b class="cx-at">@' + tok + '</b>'); });
    h = chatEmoWrap(h);
    return inline ? h.replace(/\n/g, ' ') : h.replace(/\n/g, '<br>');
  }).join('');
}
/* v13.393 이모지 — 그림 이모지(색 있는 것)만 <span class="cx-ej"> 로 감쌈 (cx-emo 는 이모티콘 판 이름). 내 말풍선에서 흰 테두리를 둘러 말풍선 색에 묻히지 않게.
   ✔ ★ → 같은 글자 모양 기호는 글자색을 따르므로 빼고(Emoji_Presentation 이거나 FE0F 붙은 것만), 태그 안(링크 주소 등)은 건드리지 않음 */
var CX_EMO_ONE = '(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F|[0-9#*]\\uFE0F?\\u20E3)(?:[\\u{1F3FB}-\\u{1F3FF}]|\\uFE0F|\\u200D(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F?))*';
var CX_EMO_RE = null, CX_EMO_ONLY = null;
try { CX_EMO_RE = new RegExp('(?:' + CX_EMO_ONE + ')+', 'gu'); CX_EMO_ONLY = new RegExp('^\\s*(?:' + CX_EMO_ONE + ')(?:\\s*(?:' + CX_EMO_ONE + ')){0,2}\\s*$', 'u'); } catch (_) {}
function chatEmoWrap(h) {
  if (!CX_EMO_RE || !h) return h;
  return h.split(/(<[^>]*>)/).map(function (p) { return p.charAt(0) === '<' ? p : p.replace(CX_EMO_RE, '<span class="cx-ej">$&</span>'); }).join('');
}
/** 이모지만 1~3개인 글 — 말풍선 없이 크게 (카톡처럼) */
function chatEmojiOnly(s) { return !!(CX_EMO_ONLY && s && s.length <= 40 && CX_EMO_ONLY.test(s)); }
/** 코드 블록 하나뿐인 글 — 말풍선 색 없이 코드 상자만 */
function chatCodeOnly(s) { s = String(s || ''); return /^\s*```[\s\S]*```\s*$/.test(s) && s.split('```').length === 3; }
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-copycode]'); if (!b) return;
  var c = b.closest('.cx-code').querySelector('code');
  try { navigator.clipboard.writeText(c.textContent).then(function () { b.textContent = '✓ 복사됨'; setTimeout(function () { b.textContent = '📋 복사'; }, 1400); }); } catch (_) {}
});

/* ─── 📌 글 카드 (대화 흐름 · 게시판 · 요청함 공용) ─── */
function _ccDue(d) {
  if (!d) return '';
  var t = new Date(d + 'T00:00:00'), today = new Date(); today.setHours(0, 0, 0, 0);
  var days = Math.round((t - today) / 86400000);
  return '<span class="cc-due' + (days < 0 ? ' late' : days <= 1 ? ' soon' : '') + '">📅 ' + (t.getMonth() + 1) + '/' + t.getDate() + (days < 0 ? ' 지남' : days === 0 ? ' 오늘' : days === 1 ? ' 내일' : '') + '</span>';
}
function _ccStatusPill(p) { return p.status ? '<em class="cc-st st-' + _ccE(p.status) + '">' + (CC_ST[p.status] || p.status) + '</em>' : ''; }
function _ccActs(m, compact) {
  var p = m.post, me = _ccMe(), a = '';
  if (p.cat === 'req') {
    if (p.status === 'open') a += '<button type="button" data-pst="doing">▶ 처리 시작</button>';
    if (p.status !== 'done') a += '<button type="button" data-pst="done">✅ 완료</button>';
    else a += '<button type="button" data-pst="open">↺ 다시 열기</button>';
    if (p.status !== 'done' && p.assignee !== me) a += '<button type="button" data-pasg="me">🙋 내가 맡기</button>';
    if (p.status !== 'done' && p.assignee && p.assignee !== me) a += '<button type="button" data-pnudge title="담당자에게 다시 알림 (한 시간에 한 번)">📣 다시 알림</button>';
    if (!compact && typeof CX !== 'undefined' && CX.info && CX.info.kind === 'project' && CX.room === m.roomId && !(m.cards || []).some(function (c) { return c.type === 'issue'; })) a += '<button type="button" data-pissue>🐞 이슈로</button>';
  } else if (p.cat === 'qna') {
    a += p.status === 'solved' ? '<button type="button" data-pst="open">↺ 다시 열기</button>' : '<button type="button" data-pst="solved">✅ 해결됨</button>';
  }
  if (!compact) {
    a += '<button type="button" data-pthread>💬 댓글' + (m.replies ? ' ' + m.replies : '') + '</button>';
    if (m.userId === me) a += '<button type="button" data-pedit title="고치기">✏️</button>';
  }
  return a ? '<div class="cc-acts">' + a + '</div>' : '';
}
function chatPostHtml(m, opt) {
  opt = opt || {};
  var p = m.post || {}, c = CC_CAT[p.cat] || CC_CAT.data;
  var meta = [];
  if (p.equip) meta.push(typeof chatEquipKeyOf === 'function' ? '<button type="button" class="cc-eq" data-equip="' + _ccE(chatEquipKeyOf(p)) + '" title="장비 카드 — 요청 · A/S · 문서 · 사진">🏭 ' + _ccE(p.equip) + '</button>' : '<span>🏭 ' + _ccE(p.equip) + '</span>');
  if (p.cat === 'req') meta.push('<span>👤 ' + (p.assigneeName ? _ccE(p.assigneeName) : '<i>담당 없음</i>') + '</span>');
  if (p.due) meta.push(_ccDue(p.due));
  if (opt.room) meta.push('<span>💬 ' + _ccE(opt.room) + '</span>');
  if (opt.who) meta.push('<span>✍️ ' + _ccE(m.userName || '') + '</span>');
  var body = m.body ? '<div class="cc-body' + (opt.full ? '' : ' clamp') + '">' + chatCodeText(m.body) + '</div>' : '';
  return '<div class="cc-post cat-' + _ccE(p.cat) + (p.urgency === 'urgent' ? ' urg' : '') + (p.status === 'done' || p.status === 'solved' ? ' fin' : '') + '" data-post="' + m.id + '">' +
    '<div class="cc-h"><span class="cc-cat">' + c[0] + ' ' + c[1] + '</span>' + _ccStatusPill(p) + (p.urgency === 'urgent' ? '<em class="cc-st st-urg">🔴 긴급</em>' : '') + '</div>' +
    '<b class="cc-t">' + _ccE(p.title) + '</b>' +
    (meta.length ? '<div class="cc-meta">' + meta.join('') + '</div>' : '') + body +
    (opt.noActs ? '' : _ccActs(m, opt.compact)) + '</div>';
}

/* 글 카드 단추 — 대화 · 게시판 · 요청함 어디서든 */
function _ccFindPost(mid) {
  var all = [];
  if (typeof CX !== 'undefined') all = all.concat(CX.msgs || [], CX.threadMsgs || []);
  all = all.concat(CC.posts || [], CC.reqs || []);
  return all.filter(function (x) { return x.id === mid && x.post; })[0];
}
function _ccUpdate(mid, body, btn) {
  if (btn) btn.disabled = true;
  return apiFetch('/api/chat/messages/' + mid + '/post', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
    if (r && r.data) chatCollabOnUpd(r.data);
    return r;
  }).catch(function (e) { if (btn) btn.disabled = false; _ccToast(_ccErr(e), 'error'); });
}
document.addEventListener('click', function (e) {
  var t = e.target; if (!t.closest) return;
  var card = t.closest('.cc-post[data-post]'); if (!card) return;
  var mid = +card.dataset.post, m = _ccFindPost(mid);
  var st = t.closest('[data-pst]'), asg = t.closest('[data-pasg]');
  if (st) { e.stopPropagation(); _ccUpdate(mid, { status: st.dataset.pst }, st); return; }
  if (asg) { e.stopPropagation(); _ccUpdate(mid, { assignee: _ccMe() }, asg); return; }
  if (t.closest('[data-pnudge]')) { e.stopPropagation(); var nb = t.closest('[data-pnudge]'); nb.disabled = true; apiFetch('/api/chat/messages/' + mid + '/nudge', { method: 'POST', body: '{}' }).then(function () { _ccToast('📣 담당자에게 다시 알렸습니다', 'success'); }).catch(function (er) { nb.disabled = false; _ccToast(_ccErr(er), 'error'); }); return; }
  if (t.closest('[data-pissue]')) { e.stopPropagation(); _ccUpdate(mid, { toIssue: true }, t.closest('[data-pissue]')).then(function (r) { if (r) _ccToast('🐞 이슈로 올렸습니다', 'success'); }); return; }
  if (t.closest('[data-pedit]') && m) { e.stopPropagation(); chatPostModal(m); return; }
  if (t.closest('[data-pthread]')) { e.stopPropagation(); _ccOpenPost(m || { id: mid }); return; }
  if (t.closest('.cc-body.clamp') && !t.closest('a,button,code')) { t.closest('.cc-body').classList.remove('clamp'); }
});
function _ccOpenPost(m) {
  var lib = document.getElementById('cxLib'); if (lib) { var ov = lib.closest('.wa-modal-overlay'); if (ov) ov.remove(); }
  if (typeof CX === 'undefined') return;
  if (m.roomId && CX.room !== m.roomId) { CX.openThread = m.id; chatOpenRoom(m.roomId, false, m.id); return; }
  chatOpenThread(m.id);
}

/** 실시간 · 내 처리 결과 — 글이 바뀌면 대화 · 게시판 · 요청함 모두 새로 */
function chatCollabOnUpd(d) {
  if (!d || !d.post) return;
  if (typeof CX !== 'undefined') {
    if (typeof _cxUpsert === 'function' && CX.room === d.roomId && !d.replyTo && _cxUpsert(d, true)) _cxDrawMsgs();
    if (CX.thread === d.id && CX.threadMsgs.length) { CX.threadMsgs[0] = d; if (typeof _cxDrawThread === 'function') _cxDrawThread(); }
  }
  [CC.posts, CC.reqs].forEach(function (list) { (list || []).forEach(function (x, i) { if (x.id === d.id) { var keep = x.roomName; list[i] = d; if (keep) d.roomName = keep; } }); });
  _ccDrawPosts(); _ccDrawReqs();
}

/* ─── ✍️ 글쓰기 · 고치기 ─── */
function chatPostModal(edit) {
  if (typeof wmGuardedModal === 'function') return wmGuardedModal('chatPost', function () { return _ccPostModal(edit); }, 'cxPostModal');
  return _ccPostModal(edit);
}
function _ccPostModal(edit) {
  if (typeof CX === 'undefined' || !CX.room || !CX.info) return false;
  var p = edit ? edit.post : { cat: CC.lastCat || 'req', urgency: 'normal' };
  var members = (CX.info.members || []);
  var div = document.createElement('div'); div.id = 'cxPostModal'; div.className = 'cc-form';
  div.innerHTML =
    '<div class="cc-cats" role="radiogroup">' + Object.keys(CC_CAT).map(function (k) { return '<button type="button" data-cat="' + k + '" class="' + (p.cat === k ? 'on' : '') + '"' + (edit ? ' disabled' : '') + '><span>' + CC_CAT[k][0] + '</span>' + CC_CAT[k][1] + '</button>'; }).join('') + '</div>' +
    '<label class="cc-l">제목<input id="ccTitle" maxlength="200" placeholder="한 줄로 — 예: 조립기 #3 PLC 통신 10분마다 끊김"></label>' +
    '<div class="cc-req">' +
      '<label class="cc-l">🏭 장비 · 설비<input id="ccEquip" maxlength="120" placeholder="예: 조립기 #3 · 라인 B · 비전 검사기"></label>' +
      '<label class="cc-l">👤 담당<select id="ccAsg"><option value="">(나중에 정함)</option>' + members.filter(function (u) { return u.id; }).map(function (u) { return '<option value="' + _ccE(u.id) + '">' + _ccE(u.name) + (u.me ? ' (나)' : '') + (u.dept ? ' · ' + _ccE(u.dept) : '') + '</option>'; }).join('') + '</select></label>' +
      '<label class="cc-l">📅 기한<input id="ccDue" type="date"></label>' +
      '<label class="cc-chk"><input type="checkbox" id="ccUrg"> 🔴 긴급</label>' +
    '</div>' +
    '<label class="cc-l">내용 <i>``` 로 감싸면 코드 · 로그</i>' + (typeof chatSmartSuggest === 'function' && !edit ? '<button type="button" class="cs-fill" data-fill title="쓴 내용을 보고 제목 · 종류 · 장비 · 긴급을 채움">✨ 내용으로 채우기</button>' : '') + '<textarea id="ccBody" rows="9" maxlength="8000"></textarea></label>' +
    '<div class="cc-foot"><span class="cc-tip">💬 댓글은 글의 답글로 · 🛠 요청은 접수 → 처리 중 → 완료</span><button type="button" class="btn btn-g" data-x>취소</button><button type="button" class="btn btn-p" data-ok>' + (edit ? '고치기' : '올리기') + '</button></div>';
  var modal = createModal({ title: edit ? '✏️ 글 고치기' : '✍️ 게시판에 글쓰기', content: div, width: '640px' });
  var $ = function (s) { return div.querySelector(s); };
  var TPL = { req: '현상:\n언제부터 · 얼마나 자주:\n재현 방법:\n기대 동작:\n로그 · 에러:\n```\n\n```', qna: '', data: '', notice: '' };
  var cat = p.cat;
  function setCat(k) {
    var prevTpl = TPL[cat];
    cat = k;
    div.querySelectorAll('[data-cat]').forEach(function (b) { b.classList.toggle('on', b.dataset.cat === k); });
    $('.cc-req').hidden = k !== 'req';
    if (!edit && (!$('#ccBody').value.trim() || $('#ccBody').value === prevTpl)) $('#ccBody').value = TPL[k];
  }
  if (edit) { $('#ccTitle').value = p.title || ''; $('#ccBody').value = edit.body || ''; $('#ccEquip').value = p.equip || ''; $('#ccDue').value = p.due || ''; $('#ccUrg').checked = p.urgency === 'urgent'; $('#ccAsg').value = p.assignee || ''; $('#ccAsg').disabled = true; }
  setCat(cat);
  if (typeof chatEquipSuggest === 'function') chatEquipSuggest($('#ccEquip'));   // 🏭 장비 마스터 · 쓰던 이름 고르기
  div.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]'); if (b && !edit) setCat(b.dataset.cat);
    if (e.target.closest('[data-x]')) modal.close();
    if (e.target.closest('[data-ok]')) save(e.target.closest('[data-ok]'));
    var fb = e.target.closest('[data-fill]');
    if (fb) {
      e.preventDefault();
      var tx = $('#ccBody').value === TPL[cat] ? '' : $('#ccBody').value;
      chatSmartSuggest(($('#ccTitle').value ? $('#ccTitle').value + '\n' : '') + tx, fb, function (sg) {
        setCat(sg.cat);
        if (!$('#ccTitle').value.trim() && sg.title) $('#ccTitle').value = sg.title;
        if (sg.cat === 'req') { if (sg.equip && !$('#ccEquip').value.trim()) $('#ccEquip').value = sg.equip; $('#ccUrg').checked = sg.urgency === 'urgent'; }
      });
    }
  });
  div.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save($('[data-ok]')); } });
  function save(btn) {
    var title = $('#ccTitle').value.trim();
    if (!title) { $('#ccTitle').focus(); _ccToast('제목을 적어 주세요', 'warn'); return; }
    var body = $('#ccBody').value;
    if (body === TPL[cat]) body = '';
    var data = { title: title, body: body };
    if (cat === 'req') { data.equip = $('#ccEquip').value.trim(); if (!edit && typeof chatEquipIdOf === 'function') data.equipId = chatEquipIdOf(data.equip) || undefined; data.due = $('#ccDue').value || null; data.urgency = $('#ccUrg').checked ? 'urgent' : 'normal'; if (!edit) data.assignee = $('#ccAsg').value || null; }
    btn.disabled = true;
    var req = edit ? apiFetch('/api/chat/messages/' + edit.id + '/post', { method: 'POST', body: JSON.stringify(data) })
      : apiFetch('/api/chat/rooms/' + encodeURIComponent(CX.room) + '/posts', { method: 'POST', body: JSON.stringify(Object.assign({ cat: cat }, data)) });
    req.then(function (r) {
      modal.close();
      if (!edit) CC.lastCat = cat;
      if (r && r.data) { if (edit) chatCollabOnUpd(r.data); else if (typeof _cxAddIfNew === 'function' && CX.room === r.data.roomId && _cxAddIfNew(r.data)) _cxDrawMsgs(true); }
      if (!edit && CX.aside && CX.asideTab === 'board') chatPostsTab();
      _ccToast(edit ? '고쳤습니다' : '📌 올렸습니다', 'success');
    }).catch(function (e) { btn.disabled = false; _ccToast(_ccErr(e), 'error'); });
  }
  setTimeout(function () { $('#ccTitle').focus(); }, 30);
  return true;
}

/* ─── 옆 칸 '📌 게시판' 탭 ─── */
function chatPostsTab(box) {
  box = box || document.getElementById('cxAsB'); if (!box || typeof CX === 'undefined' || !CX.room) return;
  CC.postsBox = box; CC.postsRoom = CX.room;
  box.innerHTML = '<div class="cc-pb"><div class="cc-chips">' + [['', '전체']].concat(Object.keys(CC_CAT).map(function (k) { return [k, CC_CAT[k][0] + ' ' + CC_CAT[k][1]]; })).map(function (c) { return '<button type="button" data-pc="' + c[0] + '" class="' + (CC.postsCat === c[0] ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div>' +
    '<div class="cc-pbar"><label class="cc-chk"><input type="checkbox" data-popen' + (CC.postsOpen ? ' checked' : '') + '> 끝나지 않은 것만</label><button type="button" class="btn btn-p btn-s" data-pnew>✍️ 글쓰기</button></div>' +
    '<div class="cc-plist" data-plist><div class="cx-loading">불러오는 중…</div></div></div>';
  box.querySelector('[data-pnew]').addEventListener('click', function () { chatPostModal(); });
  box.querySelector('[data-popen]').addEventListener('change', function (e) { CC.postsOpen = e.target.checked; _ccLoadPosts(); });
  box.querySelectorAll('[data-pc]').forEach(function (b) { b.addEventListener('click', function () { CC.postsCat = b.dataset.pc; box.querySelectorAll('[data-pc]').forEach(function (x) { x.classList.toggle('on', x === b); }); _ccLoadPosts(); }); });
  _ccLoadPosts();
}
function _ccLoadPosts() {
  var room = CC.postsRoom; if (!room) return;
  apiFetch('/api/chat/rooms/' + encodeURIComponent(room) + '/posts?' + (CC.postsCat ? 'cat=' + CC.postsCat + '&' : '') + (CC.postsOpen ? 'open=1' : '')).then(function (r) {
    if (CC.postsRoom !== room) return;
    CC.posts = (r && r.data) || [];
    _ccDrawPosts();
  }).catch(function () { var l = CC.postsBox && CC.postsBox.querySelector('[data-plist]'); if (l) l.innerHTML = '<div class="cx-empty">불러오지 못했습니다</div>'; });
}
function _ccDrawPosts() {
  var l = CC.postsBox && document.body.contains(CC.postsBox) && CC.postsBox.querySelector('[data-plist]'); if (!l || !CC.posts) return;
  l.innerHTML = CC.posts.length ? CC.posts.map(function (m) { return chatPostHtml(m, { who: true, compact: true }); }).join('') :
    '<div class="cx-empty">아직 글이 없습니다<br><small>공지 · 자료 · 질문 · 🛠 요청을 올려 두면 대화에 묻히지 않아요</small></div>';
}
// 글 카드 본문을 누르면 그 글(댓글 줄기)로
document.addEventListener('click', function (e) {
  var t = e.target; if (!t.closest || t.closest('button,a,code,input,select')) return;
  var card = t.closest('[data-plist] .cc-post, .cc-reqs .cc-post'); if (!card) return;
  var m = _ccFindPost(+card.dataset.post); if (m) _ccOpenPost(m);
});

/* ─── 📁 폴더에 담기 (메시지 메뉴) ─── */
function _ccFolders(force) {
  if (CC.folders && !force) return Promise.resolve(CC.folders);
  return apiFetch('/api/chat/folders').then(function (r) { CC.folders = (r && r.data) || []; return CC.folders; });
}
function chatSaveMenu(anchor, m) {
  Promise.all([_ccFolders(true), apiFetch('/api/chat/messages/' + m.id + '/folders').then(function (r) { return r.data || []; }).catch(function () { return []; })]).then(function (rs) {
    var fs = rs[0].filter(function (f) { return !f.roomId || f.roomId === m.roomId; }), inF = rs[1];
    var items = fs.map(function (f) {
      var on = inF.indexOf(f.id) >= 0;
      return [(on ? '✓ ' : '') + (f.icon || '📁') + ' ' + f.name + (f.roomId ? '  · 방 폴더' : ''), function () {
        (on ? apiFetch('/api/chat/folders/' + f.id + '/items/' + m.id, { method: 'DELETE' }) : apiFetch('/api/chat/folders/' + f.id + '/items', { method: 'POST', body: JSON.stringify({ messageId: m.id }) }))
          .then(function () { _ccToast(on ? '폴더에서 뺐습니다' : '📁 "' + f.name + '" 에 담았습니다', 'success'); CC.folders = null; })
          .catch(function (e) { _ccToast(_ccErr(e), 'error'); });
      }];
    });
    function newIn(roomId) {
      var nm = prompt(roomId ? '새 방 폴더 이름 (이 방 사람 모두가 봄)' : '새 내 폴더 이름 (나만 봄)', ''); if (!nm || !nm.trim()) return;
      apiFetch('/api/chat/folders', { method: 'POST', body: JSON.stringify({ name: nm.trim(), roomId: roomId || undefined }) })
        .then(function (r) { return apiFetch('/api/chat/folders/' + r.data.id + '/items', { method: 'POST', body: JSON.stringify({ messageId: m.id }) }).then(function () { return r.data; }); })
        .then(function (f) { CC.folders = null; _ccToast((roomId ? '🗂 ' : '📁 ') + '"' + f.name + '" 에 담았습니다', 'success'); })
        .catch(function (e) { _ccToast(_ccErr(e), 'error'); });
    }
    items.push(['＋ 새 내 폴더에 담기', function () { newIn(null); }]);
    if (m.roomId) items.push(['＋ 새 방 폴더에 담기 (같이 봄)', function () { newIn(m.roomId); }]);
    items.push(['📂 내 폴더 열기', function () { chatLibrary('folders'); }]);
    if (typeof _cxMenu === 'function') _cxMenu(anchor, items);
  }).catch(function (e) { _ccToast(_ccErr(e), 'error'); });
}

/* ─── 📁 내 폴더 · 🛠 요청함 (큰 창) ─── */
function chatLibrary(tab) {
  if (tab) CC.libTab = tab;
  if (typeof wmGuardedModal === 'function') return wmGuardedModal('chatLib', _ccLibOpen, 'cxLib');
  return _ccLibOpen();
}
function _ccLibOpen() {
  var div = document.createElement('div'); div.id = 'cxLib'; div.className = 'cc-lib';
  div.innerHTML = '<div class="cc-lib-tabs"><button type="button" data-lt="folders">📁 폴더</button><button type="button" data-lt="reqs">🛠 요청함</button><button type="button" data-lt="times">⏰ 알림 · 예약</button><button type="button" data-lt="equip">🏭 장비</button></div><div class="cc-lib-b" data-lb></div>';
  var modal = createModal({ title: '🗂 모아 보기', content: div, width: '1080px', boxStyle: 'max-height:88vh' });
  CC.libModal = modal;
  div.querySelectorAll('[data-lt]').forEach(function (b) { b.addEventListener('click', function () { CC.libTab = b.dataset.lt; _ccLibDraw(); }); });
  _ccLibDraw();
  return true;
}
function _ccLibDraw() {
  var div = document.getElementById('cxLib'); if (!div) return;
  div.querySelectorAll('[data-lt]').forEach(function (b) { b.classList.toggle('on', b.dataset.lt === CC.libTab); });
  var b = div.querySelector('[data-lb]');
  if (CC.libTab === 'reqs') return _ccReqsView(b);
  if (CC.libTab === 'times' && typeof chatTimeList === 'function') return chatTimeList(b);
  if (CC.libTab === 'equip' && typeof chatEquipList === 'function') return chatEquipList(b);
  _ccFolderView(b);
}
function _ccFolderView(box) {
  box.innerHTML = '<div class="cc-fv"><aside class="cc-fl"><div class="cc-fl-h"><b>폴더</b><button type="button" class="cx-ib" data-fnew title="새 폴더">＋</button></div><div data-flist></div><p class="cc-tip">메시지 ⋯ → 📁 폴더에 담기<br>📁 내 폴더는 나만 · 🗂 방 폴더는 그 방 사람 모두</p></aside>' +
    '<section class="cc-fi"><div class="cc-fi-h"><div class="cc-chips">' + [['', '전체'], ['img', '🖼 사진'], ['file', '📎 파일'], ['post', '📌 글'], ['msg', '💬 메시지']].map(function (c) { return '<button type="button" data-fk="' + c[0] + '" class="' + (CC.libKind === c[0] ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div>' +
    '<input type="search" data-fq placeholder="폴더 안에서 찾기" value="' + _ccE(CC.libQ) + '"><span class="cc-facts" data-facts></span></div><div class="cc-grid" data-fitems></div></section></div>';
  box.querySelector('[data-fnew]').addEventListener('click', function (e) {
    function mk(roomId) {
      var nm = prompt(roomId ? '새 방 폴더 이름 (이 방 사람 모두가 봄)' : '새 내 폴더 이름 (나만 봄)', ''); if (!nm || !nm.trim()) return;
      apiFetch('/api/chat/folders', { method: 'POST', body: JSON.stringify({ name: nm.trim(), roomId: roomId || undefined }) }).then(function (r) { CC.libFolder = r.data.id; _ccFolderList(box); }).catch(function (er) { _ccToast(_ccErr(er), 'error'); });
    }
    var room = typeof CX !== 'undefined' && CX.room && CX.info ? CX.info : null;
    if (!room || typeof _cxMenu !== 'function') return mk(null);
    _cxMenu(e.currentTarget, [['📁 새 내 폴더 (나만 봄)', function () { mk(null); }], ['🗂 새 방 폴더 — ' + (CX.rooms.filter(function (r) { return r.id === CX.room; })[0] || {}).name, function () { mk(CX.room); }]]);
  });
  box.querySelectorAll('[data-fk]').forEach(function (b) { b.addEventListener('click', function () { CC.libKind = b.dataset.fk; box.querySelectorAll('[data-fk]').forEach(function (x) { x.classList.toggle('on', x === b); }); _ccDrawItems(box); }); });
  box.querySelector('[data-fq]').addEventListener('input', function (e) { CC.libQ = e.target.value.trim(); _ccDrawItems(box); });
  _ccFolderList(box);
}
function _ccFolderList(box) {
  _ccFolders(true).then(function (fs) {
    var l = box.querySelector('[data-flist]'); if (!l) return;
    if (!fs.some(function (f) { return f.id === CC.libFolder; })) CC.libFolder = fs[0] ? fs[0].id : null;
    function row(f) { return '<button type="button" class="cc-f' + (f.id === CC.libFolder ? ' on' : '') + '" data-fid="' + _ccE(f.id) + '"><span>' + _ccE(f.icon || '📁') + '</span><b>' + _ccE(f.name) + (f.roomId ? '<small>' + _ccE(f.roomName || '') + '</small>' : '') + '</b><i>' + f.n + '</i></button>'; }
    var mine = fs.filter(function (f) { return !f.roomId; }), shared = fs.filter(function (f) { return f.roomId; });
    l.innerHTML = fs.length ? (mine.length ? '<div class="cc-fsec">📁 내 폴더 <i>나만 봄</i></div>' + mine.map(row).join('') : '') + (shared.length ? '<div class="cc-fsec">🗂 방 폴더 <i>방 사람 모두</i></div>' + shared.map(row).join('') : '') :
      '<div class="cx-empty">폴더가 없습니다<br><small>＋ 로 만들어 보세요</small></div>';
    l.querySelectorAll('[data-fid]').forEach(function (b) { b.addEventListener('click', function () { CC.libFolder = b.dataset.fid; l.querySelectorAll('.cc-f').forEach(function (x) { x.classList.toggle('on', x === b); }); _ccLoadItems(box); }); });
    _ccLoadItems(box);
  });
}
function _ccLoadItems(box) {
  var g = box.querySelector('[data-fitems]'), acts = box.querySelector('[data-facts]');
  var f = (CC.folders || []).filter(function (x) { return x.id === CC.libFolder; })[0];
  acts.innerHTML = f ? '<button type="button" class="cx-ib" data-fren title="이름 바꾸기">✏️</button><button type="button" class="cx-ib" data-fdel title="폴더 지우기 (담긴 메시지는 대화에 그대로)">🗑</button>' : '';
  if (f) {
    acts.querySelector('[data-fren]').onclick = function () { var nm = prompt('폴더 이름', f.name); if (!nm || !nm.trim()) return; apiFetch('/api/chat/folders/' + f.id, { method: 'PUT', body: JSON.stringify({ name: nm.trim() }) }).then(function () { _ccFolderList(box); }); };
    acts.querySelector('[data-fdel]').onclick = function () { if (!confirm('"' + f.name + '" 폴더를 지울까요? 담긴 메시지는 대화방에 그대로 있습니다.')) return; apiFetch('/api/chat/folders/' + f.id, { method: 'DELETE' }).then(function () { CC.libFolder = null; _ccFolderList(box); }); };
  }
  if (!f) { g.innerHTML = ''; CC.items = []; return; }
  g.innerHTML = '<div class="cx-loading">불러오는 중…</div>';
  var my = f.id;
  apiFetch('/api/chat/folders/' + f.id + '/items').then(function (r) { if (CC.libFolder !== my) return; CC.items = (r && r.data) || []; _ccDrawItems(box); })
    .catch(function () { g.innerHTML = '<div class="cx-empty">불러오지 못했습니다</div>'; });
}
function _ccKind(m) { return m.post ? 'post' : m.file ? (/^image\//.test(m.file.mime || '') ? 'img' : 'file') : 'msg'; }
function _ccDrawItems(box) {
  var g = box.querySelector('[data-fitems]'); if (!g || !CC.items) return;
  var q = CC.libQ.toLowerCase();
  var list = CC.items.filter(function (m) {
    if (CC.libKind && _ccKind(m) !== CC.libKind) return false;
    if (!q) return true;
    return [m.body, m.file && m.file.name, m.post && m.post.title, m.userName, m.roomName, m.savedNote].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  g.innerHTML = list.length ? list.map(function (m) {
    var k = _ccKind(m), inner;
    if (k === 'img') inner = '<button type="button" class="cc-thumb" data-iimg><img alt="" data-blob="' + _ccE(m.file.id) + '"></button><div class="cc-it-t">' + _ccE(m.file.name) + (m.body ? '<i>' + _ccE(m.body) + '</i>' : '') + '</div>';
    else if (k === 'file') inner = '<div class="cc-filebig"><span class="cx-fx">' + _ccE(((/\.([A-Za-z0-9]{1,6})$/.exec(m.file.name) || [])[1] || 'FILE').toUpperCase()) + '</span><b>' + _ccE(m.file.name) + '</b><i>' + (typeof _cxSize === 'function' ? _cxSize(m.file.size || 0) : '') + '</i></div>';
    else if (k === 'post') inner = chatPostHtml(m, { noActs: true });
    else inner = '<div class="cc-msgtxt">' + chatCodeText(m.body) + '</div>';
    return '<div class="cc-it k-' + k + '" data-imid="' + m.id + '">' + inner +
      (m.savedNote ? '<div class="cc-note">📝 ' + _ccE(m.savedNote) + '</div>' : '') +
      '<div class="cc-it-f"><span>' + (m.savedBy && (CC.folders || []).some(function (f) { return f.id === CC.libFolder && f.roomId; }) ? '📥 ' + _ccE(m.savedBy) + ' · ' : '') + '💬 ' + _ccE(m.roomName) + ' · ' + _ccE(m.userName || '') + ' · ' + (typeof _cxRel === 'function' ? _cxRel(m.at) : '') + '</span>' +
      (k === 'file' ? '<button type="button" class="cx-ib" data-idl title="받기">⬇</button>' : '') +
      '<button type="button" class="cx-ib" data-igo title="대화에서 보기">↗</button><button type="button" class="cx-ib" data-irm title="폴더에서 빼기">✕</button></div></div>';
  }).join('') : '<div class="cx-empty">' + (CC.items.length ? '맞는 것이 없습니다' : '비어 있습니다<br><small>대화의 메시지 ⋯ → 📁 폴더에 담기</small>') + '</div>';
  // 사진 미리보기 (표시한 모습)
  g.querySelectorAll('img[data-blob]').forEach(function (img) {
    var id = img.dataset.blob; img.removeAttribute('data-blob');
    var m = CC.items.filter(function (x) { return x.file && x.file.id === id; })[0];
    if (typeof _cxBlob === 'function') _cxBlob(id).then(function (u) { img.src = u; if (m && typeof chatBoardThumb === 'function') chatBoardThumb(img, m.file); }).catch(function () {});
  });
  g.onclick = function (e) {
    var it = e.target.closest('[data-imid]'); if (!it) return;
    var m = CC.items.filter(function (x) { return x.id === +it.dataset.imid; })[0]; if (!m) return;
    if (e.target.closest('[data-irm]')) {
      apiFetch('/api/chat/folders/' + CC.libFolder + '/items/' + m.id, { method: 'DELETE' }).then(function () { CC.items = CC.items.filter(function (x) { return x !== m; }); _ccDrawItems(box); var c = box.querySelector('.cc-f.on i'); if (c) c.textContent = CC.items.length; });
      return;
    }
    if (e.target.closest('[data-idl]') && typeof _cxDownload === 'function') { _cxDownload(m.file.id, m.file.name); return; }
    if (e.target.closest('[data-iimg]') && typeof chatBoardOpen === 'function') { chatBoardOpen(m.file.id, m.file.name, m.roomId); return; }
    if (e.target.closest('[data-igo]') || e.target.closest('.cc-msgtxt,.cc-post,.cc-filebig')) {
      if (CC.libModal) CC.libModal.close();
      if (m.post) _ccOpenPost(m); else chatOpenRoom(m.roomId, false, m.id);
    }
  };
}

/* 🛠 요청함 */
function _ccReqsView(box) {
  box.innerHTML = '<div class="cc-reqs"><div class="cc-fi-h"><div class="cc-chips"><button type="button" data-rw="me">📥 나에게 온 요청</button><button type="button" data-rw="mine">📤 내가 올린 요청</button></div>' +
    '<label class="cc-chk"><input type="checkbox" data-ro' + (CC.reqOpen ? ' checked' : '') + '> 끝나지 않은 것만</label>' + (typeof chatSmartBrief === 'function' ? '<button type="button" class="btn btn-g btn-s" data-brief title="나에게 온 요청을 오늘 할 순서로">✨ 오늘 정리</button>' : '') + '<span class="cc-rsum" data-rsum></span></div><div class="cc-rlist" data-rlist><div class="cx-loading">불러오는 중…</div></div></div>';
  box.querySelectorAll('[data-rw]').forEach(function (b) { b.classList.toggle('on', b.dataset.rw === CC.reqWho); b.addEventListener('click', function () { CC.reqWho = b.dataset.rw; _ccReqsView(box); }); });
  box.querySelector('[data-ro]').addEventListener('change', function (e) { CC.reqOpen = e.target.checked; _ccLoadReqs(box); });
  var bb = box.querySelector('[data-brief]'); if (bb) bb.addEventListener('click', function () { chatSmartBrief(box.querySelector('.cc-reqs')); });
  CC.reqBox = box;
  _ccLoadReqs(box);
}
function _ccLoadReqs(box) {
  apiFetch('/api/chat/requests?who=' + CC.reqWho + (CC.reqOpen ? '&open=1' : '')).then(function (r) { CC.reqs = (r && r.data) || []; _ccDrawReqs(); })
    .catch(function () { var l = box.querySelector('[data-rlist]'); if (l) l.innerHTML = '<div class="cx-empty">불러오지 못했습니다</div>'; });
}
function _ccDrawReqs() {
  var box = CC.reqBox, l = box && document.body.contains(box) && box.querySelector('[data-rlist]'); if (!l || !CC.reqs) return;
  var list = CC.reqs.filter(function (m) { return !CC.reqOpen || (m.post.status !== 'done'); });
  var n = { open: 0, doing: 0, done: 0, urg: 0 };
  CC.reqs.forEach(function (m) { n[m.post.status] = (n[m.post.status] || 0) + 1; if (m.post.urgency === 'urgent' && m.post.status !== 'done') n.urg++; });
  var s = box.querySelector('[data-rsum]'); if (s) s.innerHTML = '접수 <b>' + n.open + '</b> · 처리 중 <b>' + n.doing + '</b>' + (CC.reqOpen ? '' : ' · 완료 <b>' + n.done + '</b>') + (n.urg ? ' · <em>긴급 ' + n.urg + '</em>' : '');
  l.innerHTML = list.length ? list.map(function (m) { return chatPostHtml(m, { room: m.roomName, who: CC.reqWho === 'me', compact: true }); }).join('') :
    '<div class="cx-empty">' + (CC.reqWho === 'me' ? '나에게 온 요청이 없습니다 🎉' : '올린 요청이 없습니다') + '<br><small>대화방 ✍️ → 🛠 요청 으로 장비 · 현상 · 담당을 정해 올려요</small></div>';
}

/* 옆 칸 📎 파일 탭 위 — 이 방 폴더 (v13.359) */
function chatRoomFolders(box) {
  if (typeof CX === 'undefined' || !CX.room) return;
  var room = CX.room;
  apiFetch('/api/chat/folders?room=' + encodeURIComponent(room)).then(function (r) {
    if (CX.room !== room || !document.body.contains(box)) return;
    var fs = (r && r.data) || [], old = box.querySelector('.cc-rf'); if (old) old.remove();
    var ro = CX.info && CX.info.myRole === 'readonly';
    box.insertAdjacentHTML('afterbegin', '<div class="cc-rf"><div class="cc-rf-h"><b>🗂 방 폴더</b><i>방 사람 모두가 같이 담고 봄</i>' + (ro ? '' : '<button type="button" class="cx-ib" data-rfnew title="새 방 폴더">＋</button>') + '</div>' +
      (fs.length ? '<div class="cc-rf-l">' + fs.map(function (f) { return '<button type="button" data-rf="' + _ccE(f.id) + '">' + _ccE(f.icon || '🗂') + ' ' + _ccE(f.name) + ' <i>' + f.n + '</i></button>'; }).join('') + '</div>' : '<div class="cc-rf-e">아직 없음 — 메시지 ⋯ → 폴더에 담기에서도 만들 수 있어요</div>') + '</div>');
    box.querySelectorAll('[data-rf]').forEach(function (b) { b.addEventListener('click', function () { CC.libFolder = b.dataset.rf; chatLibrary('folders'); }); });
    var nb = box.querySelector('[data-rfnew]');
    if (nb) nb.addEventListener('click', function () {
      var nm = prompt('새 방 폴더 이름 (이 방 사람 모두가 봄)', ''); if (!nm || !nm.trim()) return;
      apiFetch('/api/chat/folders', { method: 'POST', body: JSON.stringify({ name: nm.trim(), roomId: room }) }).then(function () { chatRoomFolders(box); }).catch(function (e) { _ccToast(_ccErr(e), 'error'); });
    });
  }).catch(function () {});
}
/** 방 폴더가 바뀜 (누가 담거나 만들거나 지움) — 열린 화면만 새로 */
function chatCollabOnFolder(d) {
  CC.folders = null;
  var lib = document.getElementById('cxLib');
  if (lib && CC.libTab === 'folders') { var b = lib.querySelector('[data-lb]'); if (b && b.querySelector('[data-flist]')) _ccFolderList(b); }
  var as = document.getElementById('cxAsB');
  if (as && typeof CX !== 'undefined' && CX.room === d.roomId && as.querySelector('.cc-rf')) chatRoomFolders(as);
}

if (typeof window !== 'undefined') {
  window.chatRoomFolders = chatRoomFolders; window.chatCollabOnFolder = chatCollabOnFolder;
  window.chatCodeText = chatCodeText; window.chatPostHtml = chatPostHtml; window.chatPostModal = chatPostModal; window.chatPostsTab = chatPostsTab;
  window.chatSaveMenu = chatSaveMenu; window.chatLibrary = chatLibrary; window.chatCollabOnUpd = chatCollabOnUpd;
}
