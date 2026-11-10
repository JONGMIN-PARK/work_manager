/**
 * chat-work.js — 💬 대화를 업무로 (v13.423)
 *   ④ 메시지 ⋯ → 🐞 이슈로 · 🔧 A/S 접수로 · 📅 일정으로 — AI 가 원문(+ 앞 대화)에서 칸을 채운 등록 창
 *      AI 가 없거나 한도를 넘으면 규칙으로(첫 줄 = 제목 · 날짜 말 = 날짜 · '긴급'). 만들면 원문에 답장으로 카드
 *   ⑤ 방 ⋯ → ✅ 정한 것 · 할 일 뽑기 (또는 /정리) — 요점 · 정한 것 · 할 일(누가 · 무엇 · 언제) · 남은 질문
 *      체크한 할 일: 내 것 → 내 할 일, 남의 것 → 그 사람 @부르고 ✔ 확인 요청 · 방에 올리기 · 노트로 · 복사
 * 실제 만들기는 각 화면과 같은 API (권한 · 알림 그대로)
 */
var CW_KIND = {
  issue: { t: '🐞 이슈로 올리기', ok: '🐞 이슈로 올렸습니다' },
  as: { t: '🔧 A/S 접수', ok: '🔧 A/S 로 접수했습니다' },
  event: { t: '📅 일정으로', ok: '📅 일정에 넣었습니다' }
};
function _cwE(s) { return typeof _cxE === 'function' ? _cxE(s) : String(s == null ? '' : s); }
function _cwToday() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _cwTag(ai) { return '<em class="cs-tag ' + (ai ? 'ai' : 'rule') + '">' + (ai ? '✨ AI 가 채움' : '⚙️ 자동으로 채움') + '</em>'; }
function _cwRow(label, inner, wide) { return '<label class="cw-f' + (wide ? ' wide' : '') + '"><span>' + label + '</span>' + inner + '</label>'; }
function _cwIn(k, v, type, ph) { return '<input class="wr-inp" data-k="' + k + '" type="' + (type || 'text') + '" value="' + _cwE(v || '') + '"' + (ph ? ' placeholder="' + _cwE(ph) + '"' : '') + '>'; }
function _cwProjSel(d, pid, none) {
  var has = (d.projects || []).some(function (p) { return p.id === pid; });
  return '<select class="wr-inp" data-k="projectId"><option value="">' + none + '</option>' + (pid && !has ? '<option value="' + _cwE(pid) + '" selected>이 방 프로젝트</option>' : '') +
    (d.projects || []).map(function (p) { return '<option value="' + _cwE(p.id) + '"' + (p.id === pid ? ' selected' : '') + '>' + _cwE(p.name) + (p.orderNo ? ' · ' + _cwE(p.orderNo) : '') + '</option>'; }).join('') + '</select>';
}
/* 원문에 붙은(또는 펼친) 프로젝트 카드 → 기본 프로젝트 */
function _cwMsgProject(m) {
  var cs = (m.cards || []).concat((CX.unf && CX.unf[m.id] && CX.unf[m.id].l) || []);
  var p = cs.filter(function (c) { return c.type === 'project'; })[0];
  return p ? String(p.id) : null;
}

/* ④ 메시지 → 업무 */
function chatToWork(m, kind, opt) {
  if (!m || typeof m.id !== 'number' || !CW_KIND[kind]) return;
  opt = opt || {};
  return wmGuardedModal('chatWork', function () {
    var md = createModal({ id: 'chatWorkModal', title: CW_KIND[kind].t, width: '560px', closeOnEsc: true,
      html: '<div class="cw-src"><b>' + _cwE(m.userName || '') + '</b>' + _cwE(String(m.body || '').replace(/\s+/g, ' ').slice(0, 160)) + '</div><div class="cw-body" data-body><div class="cw-wait"><i class="cw-spin"></i>✨ 원문에서 칸을 채우는 중…</div></div>' });
    var box = md.box.querySelector('[data-body]');
    apiFetch('/api/chat/messages/' + m.id + '/draft', { method: 'POST', body: JSON.stringify({ kind: kind, ai: opt.ai }), timeoutMs: 60000 }).then(function (r) {
      var d = r.data, f = d.fields, pid = d.projectId || _cwMsgProject(m) || '', h = '<div class="cw-tagline">' + _cwTag(d.ai) + '<span>확인하고 고쳐서 만드세요</span></div><div class="cw-grid">';
      if (kind === 'issue') {
        h += _cwRow('제목', _cwIn('title', f.title), true) + _cwRow('내용', '<textarea class="wr-inp" data-k="description" rows="4">' + _cwE(f.description) + '</textarea>', true) +
          _cwRow('프로젝트', _cwProjSel(d, pid, '(프로젝트 없음 — 나만 보는 이슈)'), true) +
          _cwRow('마감', _cwIn('dueDate', f.dueDate, 'date')) + _cwRow('긴급', '<span class="cw-ck"><input type="checkbox" data-k="urgent"' + (f.urgency === 'urgent' ? ' checked' : '') + '> 🔴 긴급</span>');
      } else if (kind === 'as') {
        h += _cwRow('고객사 *', _cwIn('customerName', f.customerName, 'text', '예: 코아비스')) + _cwRow('현장 · 라인', _cwIn('siteLine', f.siteLine)) +
          _cwRow('장비 모델', _cwIn('equipmentModel', f.equipmentModel)) + _cwRow('시리얼', _cwIn('serialNo', f.serialNo)) +
          _cwRow('증상 *', _cwIn('issueSummary', f.issueSummary), true) + _cwRow('재현 조건 · 빈도', '<textarea class="wr-inp" data-k="reproduction" rows="2">' + _cwE(f.reproduction) + '</textarea>', true) +
          _cwRow('중요도', '<select class="wr-inp" data-k="priority">' + [['P1', 'P1 긴급 (라인 정지)'], ['P2', 'P2 높음'], ['P3', 'P3 보통'], ['P4', 'P4 낮음']].map(function (x) { return '<option value="' + x[0] + '"' + (f.priority === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>') +
          _cwRow('프로젝트', _cwProjSel(d, pid, '(연결 안 함)'));
      } else {
        h += _cwRow('제목', _cwIn('title', f.title), true) + _cwRow('날짜', _cwIn('startDate', f.startDate || _cwToday(), 'date')) + _cwRow('장소', _cwIn('location', f.location)) +
          _cwRow('시작', _cwIn('startTime', f.startTime, 'time')) + _cwRow('끝', _cwIn('endTime', f.endTime, 'time')) +
          _cwRow('프로젝트', _cwProjSel(d, pid, '(연결 안 함 — 내 일정)'), true);
      }
      h += '</div><div class="cw-foot"><span class="cw-hint">만들면 원문에 답장으로 카드가 붙습니다</span><button type="button" class="wm-sec" data-x>취소</button><button type="button" class="wm-pri" data-go>만들기</button></div>';
      box.innerHTML = h;
      var first = box.querySelector('[data-k]'); if (first) first.focus();
      box.querySelector('[data-x]').onclick = md.close;
      box.querySelector('[data-go]').onclick = function () { _cwCreate(m, kind, box, md, this); };
    }).catch(function (e) { box.innerHTML = '<div class="cw-wait err">⚠ ' + _cwE(_cxErr(e)) + '</div>'; });
  }, 'chatWorkModal');
}
function _cwVals(box) {
  var v = {}; box.querySelectorAll('[data-k]').forEach(function (x) { v[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.value.trim(); }); return v;
}
function _cwCreate(m, kind, box, md, btn) {
  var v = _cwVals(box), req;
  if (kind === 'issue') {
    if (!v.title) return _cxToast('제목을 적어 주세요', 'warn');
    req = ['/api/issues', { title: v.title, description: v.description + '\n\n💬 메신저 대화에서 — ' + (m.userName || ''), urgency: v.urgent ? 'urgent' : 'normal', status: 'open', dueDate: v.dueDate || null, projectId: v.projectId || null, reportDate: _cwToday(), tags: ['메신저'], fromChat: true }];
  } else if (kind === 'as') {
    if (!v.customerName || !v.issueSummary) return _cxToast('고객사 · 증상은 꼭 적어 주세요', 'warn');
    req = ['/api/as-tickets', { customerName: v.customerName, siteLine: v.siteLine, equipmentModel: v.equipmentModel, serialNo: v.serialNo, issueSummary: v.issueSummary, reproduction: v.reproduction, priority: v.priority, projectId: v.projectId || null, fromChat: true }];
  } else {
    if (!v.title || !v.startDate) return _cxToast('제목 · 날짜를 적어 주세요', 'warn');
    req = ['/api/events', { title: v.title, type: 'etc', startDate: v.startDate, endDate: v.startDate, startTime: v.startTime || null, endTime: v.endTime || null, location: v.location, projectIds: v.projectId ? [v.projectId] : [], memo: '💬 메신저 대화에서 — ' + (m.userName || '') }];
  }
  btn.disabled = true;
  apiFetch(req[0], { method: 'POST', body: JSON.stringify(req[1]) }).then(function (r) {
    var d = r.data || {}, card;
    if (kind === 'issue') card = { type: 'issue', id: d.id, title: d.title || v.title, sub: d.urgency === 'urgent' ? '긴급' : '', nav: { issueId: d.id } };
    else if (kind === 'as') card = { type: 'as', id: String(d.id), title: d.issue_summary || v.issueSummary, sub: [d.ticket_no, d.customer_name || v.customerName].filter(Boolean).join(' · '), nav: { asId: d.id } };
    else card = { type: 'event', id: d.id, title: d.title || v.title, sub: v.startDate + (v.startTime ? ' ' + v.startTime : '') + (v.location ? ' · ' + v.location : ''), nav: { eventId: d.id } };
    md.close();
    _cxToast(CW_KIND[kind].ok, 'success');
    if (m.replyTo) _cxSend(CW_KIND[kind].ok, m.replyTo, [card]);
    else _cxSend(CW_KIND[kind].ok, null, [card], m.id);
  }).catch(function (e) { btn.disabled = false; _cxToast(_cxErr(e), 'error'); });
}

/* ⑤ 대화 → 정한 것 · 할 일 · 남은 질문 */
function chatDigest(opt) {
  if (!CX.room) return;
  opt = opt || {};
  var room = CX.room;
  return wmGuardedModal('chatDigest', function () {
    var md = createModal({ id: 'chatDigestModal', title: '✅ 정한 것 · 할 일 뽑기', width: '640px', closeOnEsc: true,
      html: '<div class="cw-body" data-body><div class="cw-wait"><i class="cw-spin"></i>✨ 최근 대화를 읽는 중…</div></div>' });
    var box = md.box.querySelector('[data-body]');
    apiFetch('/api/chat/rooms/' + encodeURIComponent(room) + '/digest', { method: 'POST', body: JSON.stringify({ ai: opt.ai }), timeoutMs: 90000 }).then(function (r) {
      var d = r.data; md.data = d;
      if (!d.n) { box.innerHTML = '<div class="cw-wait">정리할 대화가 없습니다</div>'; return; }
      var me = _cxMe(), myName = ((d.members || []).filter(function (u) { return u.id === me; })[0] || {}).name || '';
      function list(arr, fmt) { return arr.length ? '<ul class="cw-ul">' + arr.map(fmt).join('') + '</ul>' : '<div class="cw-none">없음</div>'; }
      var whoSel = function (who) { return '<select class="wr-inp cw-who" data-who>' + '<option value="">맡을 사람 —</option>' + (d.members || []).map(function (u) { return '<option value="' + _cwE(u.name) + '"' + (u.name === who ? ' selected' : '') + '>' + _cwE(u.name) + (u.id === me ? ' (나)' : '') + '</option>'; }).join('') + '</select>'; };
      box.innerHTML = '<div class="cw-tagline">' + _cwTag(d.ai).replace('채움', '뽑음') + '<span>최근 대화 ' + d.n + '개에서</span></div>' +
        (d.points.length ? '<h4 class="cw-h">요점</h4>' + list(d.points, function (x) { return '<li>' + _cwE(x) + '</li>'; }) : '') +
        '<h4 class="cw-h">정한 것 <i>' + d.decisions.length + '</i></h4>' + list(d.decisions, function (x) { return '<li>' + _cwE(x) + '</li>'; }) +
        '<h4 class="cw-h">할 일 <i>' + d.todos.length + '</i><span>체크한 것: 내 것 → 내 할 일 · 남의 것 → @부르고 ✔ 확인 요청</span></h4>' +
        (d.todos.length ? '<div class="cw-todos">' + d.todos.map(function (t, i) {
          return '<div class="cw-td" data-ti="' + i + '"><input type="checkbox" data-ck checked aria-label="고르기">' + whoSel(t.who) +
            '<input class="wr-inp cw-what" data-what value="' + _cwE(t.what) + '"><input class="wr-inp cw-due" data-due type="date" value="' + _cwE(t.due || '') + '"></div>';
        }).join('') + '</div>' : '<div class="cw-none">없음</div>') +
        '<h4 class="cw-h">아직 답이 없는 질문 <i>' + d.questions.length + '</i></h4>' + list(d.questions, function (x) { return '<li>' + (x.who ? '<b>' + _cwE(x.who) + '</b> ' : '') + _cwE(x.text) + '</li>'; }) +
        '<div class="cw-foot"><button type="button" class="wm-sec" data-copy>📋 복사</button>' + (typeof nbSendToInbox === 'function' ? '<button type="button" class="wm-sec" data-note>📓 노트로</button>' : '') +
        '<button type="button" class="wm-sec" data-post>📌 방에 올리기</button><button type="button" class="wm-pri" data-reg' + (d.todos.length ? '' : ' disabled') + '>✅ 체크한 할 일 등록</button></div>';
      function cur() {
        var todos = Array.from(box.querySelectorAll('.cw-td')).map(function (row) { return { on: row.querySelector('[data-ck]').checked, who: row.querySelector('[data-who]').value, what: row.querySelector('[data-what]').value.trim(), due: row.querySelector('[data-due]').value }; });
        return { todos: todos, text: _cwDigestText(d, todos) };
      }
      box.querySelector('[data-copy]').onclick = function () { try { navigator.clipboard.writeText(cur().text); _cxToast('복사했습니다', 'success'); } catch (e) {} };
      var nb = box.querySelector('[data-note]'); if (nb) nb.onclick = function () { nbSendToInbox('> 💬 ' + ((CX.info && CX.info.name) || '대화') + ' · 정리 ' + _cwToday() + '\n\n' + cur().text, 'chat'); };
      box.querySelector('[data-post]').onclick = function () { if (CX.room !== room) return; _cxSend(cur().text); md.close(); };
      box.querySelector('[data-reg]').onclick = function () { _cwRegister(room, cur().todos.filter(function (t) { return t.on && t.what; }), myName, this, md); };
    }).catch(function (e) { box.innerHTML = '<div class="cw-wait err">⚠ ' + _cwE(_cxErr(e)) + '</div>'; });
  }, 'chatDigestModal');
}
function _cwDigestText(d, todos) {
  var L = ['📋 대화 정리 (' + _cwToday() + ')'];
  if (d.points.length) L.push('', '■ 요점'), d.points.forEach(function (x) { L.push('· ' + x); });
  L.push('', '■ 정한 것'); (d.decisions.length ? d.decisions : ['없음']).forEach(function (x) { L.push('· ' + x); });
  var ts = (todos || []).filter(function (t) { return t.what; });
  L.push('', '■ 할 일'); (ts.length ? ts : [{ what: '없음' }]).forEach(function (t) { L.push('· ' + (t.who ? t.who + ' — ' : '') + t.what + (t.due ? ' (~' + t.due.slice(5).replace('-', '/') + ')' : '')); });
  if (d.questions.length) L.push('', '■ 남은 질문'), d.questions.forEach(function (x) { L.push('· ' + (x.who ? x.who + ': ' : '') + x.text); });
  return L.join('\n');
}
function _cwRegister(room, list, myName, btn, md) {
  if (!list.length) return _cxToast('체크한 할 일이 없습니다', 'warn');
  btn.disabled = true;
  var mine = list.filter(function (t) { return !t.who || t.who === myName; }), others = list.filter(function (t) { return t.who && t.who !== myName; });
  var jobs = mine.map(function (t) { return apiFetch('/api/my-work/todos', { method: 'POST', body: JSON.stringify({ title: t.what, dueDate: t.due || null, memo: '💬 대화 정리에서' }) }); })
    .concat(others.map(function (t) { return apiFetch('/api/chat/rooms/' + encodeURIComponent(room) + '/messages', { method: 'POST', body: JSON.stringify({ body: '@' + t.who + ' 할 일 — ' + t.what + (t.due ? ' (~' + t.due.slice(5).replace('-', '/') + ')' : ''), ack: true }) }); }));
  Promise.all(jobs.map(function (p) { return p.then(function () { return 1; }, function () { return 0; }); })).then(function (rs) {
    var ok = rs.reduce(function (a, b) { return a + b; }, 0);
    _cxToast('✅ 내 할 일 ' + mine.length + ' · 확인 요청 ' + others.length + (ok < rs.length ? ' · 실패 ' + (rs.length - ok) : ''), ok < rs.length ? 'warn' : 'success');
    if (ok) md.close(); else btn.disabled = false;
  });
}

/* ⑥ 사이트 → 대화 (v13.424) — 프로젝트 · 이슈 · A/S · 할 일 · 마일스톤 화면의 "💬 대화로 보내기"
 *   방(최근 순) · 사람 찾기 → 한마디 덧붙여 카드로 보냄 → "대화 열기" */
function chatShareRef(type, id, title, sub) {
  if (!id) return;
  var card = { type: type, id: String(id), title: title || '', sub: sub || '' };
  if (card.title) return chatShareTo(card);
  apiFetch('/api/chat/peek', { method: 'POST', body: JSON.stringify({ refs: [{ type: type, id: id }] }) }).then(function (r) {
    var L = r.data && r.data.live && r.data.live[type + ':' + id];
    if (!L) return _cxToast('볼 수 없는 항목입니다', 'warn');
    card.title = L.title; card.sub = L.sub || ''; card.nav = L.nav || null;
    chatShareTo(card);
  }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
function chatShareTo(card) {
  return wmGuardedModal('chatShare', function () {
    var md = createModal({ id: 'chatShareModal', title: '💬 대화로 보내기', width: '460px', closeOnEsc: true, closeOnOverlay: true,
      html: '<div class="cw-share-c"><span class="cx-card-i">' + ((typeof CX_ICON !== 'undefined' && CX_ICON[card.type]) || '🔗') + '</span><span><b>' + _cwE(card.title) + '</b><i>' + _cwE(card.sub || '') + '</i></span></div>' +
        '<input class="wr-inp cw-share-q" data-q placeholder="방 · 사람 찾기" aria-label="방 · 사람 찾기"><div class="cw-share-l" data-l><div class="cw-wait"><i class="cw-spin"></i>방 목록…</div></div>' +
        '<textarea class="wr-inp cw-share-m" data-m rows="2" placeholder="한마디 덧붙이기 (없어도 됨) — 예: 이거 확인 부탁해요"></textarea>' +
        '<div class="cw-foot"><span class="cw-hint" data-pick>보낼 곳을 고르세요</span><button type="button" class="wm-sec" data-x>취소</button><button type="button" class="wm-pri" data-go disabled>보내기</button></div>' });
    var box = md.box, rooms = [], users = [], pick = null;
    Promise.all([apiFetch('/api/chat/rooms').catch(function () { return { data: [] }; }), apiFetch('/api/chat/users').catch(function () { return { data: [] }; })]).then(function (rs) {
      rooms = (rs[0].data || []).filter(function (r) { return r.myRole !== 'readonly'; });
      users = (rs[1].data || []).filter(function (u) { return !u.me && u.id !== _cxMe(); });
      draw(box.querySelector('[data-q]').value);
    });
    function draw(q) {
      q = q.trim().toLowerCase();
      var rl = rooms.filter(function (r) { return !q || String(r.name || '').toLowerCase().indexOf(q) >= 0; }).slice(0, q ? 20 : 8);
      var have = {}; rooms.forEach(function (r) { if (r.peerId) have[r.peerId] = 1; });
      var ul = q ? users.filter(function (u) { return !have[u.id] && (String(u.name || '') + ' ' + String(u.dept || '')).toLowerCase().indexOf(q) >= 0; }).slice(0, 8) : [];
      box.querySelector('[data-l]').innerHTML = ((rl.length ? '<div class="cx-ctx-h">' + (q ? '방' : '최근 대화') + '</div>' + rl.map(function (r) { return '<button type="button" class="cw-share-i' + (pick && pick.room === r.id ? ' on' : '') + '" data-room="' + _cwE(r.id) + '"><span class="cw-share-av">' + (r.self ? '📝' : r.kind === 'project' ? '📁' : r.kind === 'dm' ? '👤' : '👥') + '</span><b>' + _cwE(r.name || '대화') + '</b></button>'; }).join('') : '') +
        (ul.length ? '<div class="cx-ctx-h">사람 (새 1:1)</div>' + ul.map(function (u) { return '<button type="button" class="cw-share-i' + (pick && pick.user === u.id ? ' on' : '') + '" data-user="' + _cwE(u.id) + '"><span class="cw-share-av">👤</span><b>' + _cwE(u.name) + '</b><i>' + _cwE(u.dept || '') + '</i></button>'; }).join('') : '')) ||
        '<div class="cw-none">없음</div>';
    }
    box.querySelector('[data-q]').addEventListener('input', function () { draw(this.value); });
    box.querySelector('[data-l]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-room],[data-user]'); if (!b) return;
      pick = b.dataset.room ? { room: b.dataset.room, name: b.querySelector('b').textContent } : { user: b.dataset.user, name: b.querySelector('b').textContent };
      box.querySelectorAll('.cw-share-i').forEach(function (x) { x.classList.toggle('on', x === b); });
      box.querySelector('[data-pick]').textContent = '→ ' + pick.name;
      box.querySelector('[data-go]').disabled = false;
    });
    box.querySelector('[data-x]').onclick = md.close;
    box.querySelector('[data-go]').onclick = function () {
      var btn = this; if (!pick) return; btn.disabled = true;
      var roomP = pick.room ? Promise.resolve(pick.room) : apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: pick.user }) }).then(function (r) { return r.data.id; });
      roomP.then(function (rid) {
        return apiFetch('/api/chat/rooms/' + encodeURIComponent(rid) + '/messages', { method: 'POST', body: JSON.stringify({ body: box.querySelector('[data-m]').value.trim(), cards: [card] }) }).then(function () { return rid; });
      }).then(function (rid) {
        md.close();
        _cwOpenToast(rid, pick.name);
      }).catch(function (e) { btn.disabled = false; _cxToast(_cxErr(e), 'error'); });
    };
    setTimeout(function () { var q = box.querySelector('[data-q]'); if (q) q.focus(); }, 30);
  }, 'chatShareModal');
}
function _cwOpenToast(rid, name) {
  var old = document.getElementById('cwOpenTip'); if (old) old.remove();
  var t = document.createElement('div'); t.id = 'cwOpenTip'; t.className = 'cw-open-tip'; t.setAttribute('role', 'status');
  t.innerHTML = '<span>💬 ' + _cwE(name) + ' 에 보냈습니다</span><button type="button">대화 열기</button>';
  t.querySelector('button').onclick = function () { t.remove(); if (typeof setPage === 'function') setPage('messages'); if (typeof chatOpenRoom === 'function') chatOpenRoom(rid); };
  document.body.appendChild(t);
  setTimeout(function () { if (t.parentNode) t.remove(); }, 7000);
}
/* ⑧ ☀️ 아침 브리핑 — 🔔 메뉴에서 켜기 · 지금 받아 보기 */
function chatBriefToggle(on) {
  return apiFetch('/api/chat/brief', { method: 'PUT', body: JSON.stringify({ on: on }) }).then(function () {
    _cxToast(on ? '☀️ 평일 아침 8시대에 "나와의 채팅"으로 브리핑을 보내 드려요' : '아침 브리핑을 껐습니다', 'success');
  }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
function chatBriefNow() {
  return apiFetch('/api/chat/brief/now', { method: 'POST', body: '{}' }).then(function (r) {
    var rid = r.data && r.data.roomId;
    if (rid && typeof chatOpenRoom === 'function') { if (typeof setPage === 'function') setPage('messages'); chatOpenRoom(rid); }
  }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
