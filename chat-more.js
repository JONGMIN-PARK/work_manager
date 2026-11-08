/* chat-more.js — 💬 메신저 업무 도구 (v13.381)
 *   🗳 투표 · 📅 약속 잡기(후보 시간마다 일정 겹치는 사람 · 정하면 달력) · ✔ 확인 요청 · 🏢 조직도 · 📤 대화 내보내기
 * chat-ui.js 가 부르는 것: chatPollModal · chatPollHtml · chatAckHtml · chatMoreClick · chatOrgToggle · chatExportModal
 * 의존: CX, apiFetch, API_BASE, _accessToken, _cxE, _cxAv, _cxMe, _cxToast, _cxErr, _cxMenu, _cxUpsert, _cxDrawMsgs, chatStartDm, createModal, wmGuardedModal */

/* ─── 🗳 투표 · 📅 약속 잡기 ─── */
function chatPollModal(kind) {
  if (!CX.room) return;
  kind = kind === 'time' ? 'time' : 'vote';
  return wmGuardedModal('chatPoll', function () {
    var today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
    var m = createModal({ id: 'chatPollModal', title: kind === 'time' ? '📅 약속 잡기' : '🗳 투표 만들기', width: '460px', closeOnEsc: true, closeOnOverlay: false,
      html: '<div class="cxm"><div class="cx-seg"><button type="button" data-k="vote" class="' + (kind === 'vote' ? 'on' : '') + '">🗳 투표</button><button type="button" data-k="time" class="' + (kind === 'time' ? 'on' : '') + '">📅 약속 잡기</button></div>' +
        '<input class="wr-inp" id="cxPollQ" maxlength="200" placeholder="무엇을 물을까요? — 예: 3호기 점검 회의">' +
        '<div class="cxm-opts" data-opts></div><button type="button" class="btn btn-g btn-s" data-add>＋ 항목 더하기</button>' +
        '<label class="cxm-chk" data-multiw><input type="checkbox" id="cxPollMulti"> 여러 개 고르기</label>' +
        '<p class="cxm-note" data-note></p>' +
        '<div class="cx-mfoot"><span></span><button type="button" class="wm-pri" data-go>올리기</button></div></div>' });
    var box = m.box, opts = box.querySelector('[data-opts]');
    function row() {
      var d = document.createElement('div'); d.className = 'cxm-opt';
      d.innerHTML = kind === 'time' ? '<input type="date" class="wr-inp" data-at value="' + today + '"><input type="time" class="wr-inp" data-from step="600" value="10:00"><span>~</span><input type="time" class="wr-inp" data-to step="600" value="11:00"><button type="button" class="cx-ib" data-x title="빼기">✕</button>'
        : '<input class="wr-inp" data-t maxlength="100" placeholder="고를 것"><button type="button" class="cx-ib" data-x title="빼기">✕</button>';
      opts.appendChild(d);
    }
    function draw() {
      box.querySelectorAll('[data-k]').forEach(function (b) { b.classList.toggle('on', b.dataset.k === kind); });
      opts.innerHTML = ''; row(); row(); if (kind === 'vote') row();
      box.querySelector('[data-multiw]').hidden = kind === 'time';
      box.querySelector('[data-note]').textContent = kind === 'time' ? '후보 시간마다 방 사람들의 일정(회의 · 출장 · 연차)이 겹치는지 함께 보여 줍니다. 정하면 달력 일정으로 넣습니다.' : '누가 무엇을 골랐는지 모두 볼 수 있습니다.';
    }
    draw();
    box.querySelectorAll('[data-k]').forEach(function (b) { b.addEventListener('click', function () { kind = b.dataset.k; draw(); }); });
    box.querySelector('[data-add]').addEventListener('click', function () { if (opts.children.length < 12) row(); });
    opts.addEventListener('click', function (e) { var x = e.target.closest('[data-x]'); if (x && opts.children.length > 2) x.parentNode.remove(); });
    box.querySelector('[data-go]').addEventListener('click', function () {
      var list = Array.prototype.map.call(opts.children, function (d) { return kind === 'time' ? { at: d.querySelector('[data-at]').value, from: d.querySelector('[data-from]').value, to: d.querySelector('[data-to]').value } : { t: d.querySelector('[data-t]').value }; });
      apiFetch('/api/chat/rooms/' + encodeURIComponent(CX.room) + '/polls', { method: 'POST', body: JSON.stringify({ q: box.querySelector('#cxPollQ').value, kind: kind, multi: box.querySelector('#cxPollMulti').checked, opts: list }) })
        .then(function (r) { m.close(); if (r && r.data && typeof _cxAddIfNew === 'function' && _cxAddIfNew(r.data)) _cxDrawMsgs(true); })
        .catch(function (e) { _cxToast(_cxErr(e), 'error'); });
    });
    setTimeout(function () { box.querySelector('#cxPollQ').focus(); }, 50);
  }, 'chatPollModal');
}
function _cxmNames(ids) { var ms = (CX.info && CX.info.members) || []; return ids.map(function (id) { var u = ms.filter(function (x) { return x.id === id; })[0]; return u ? u.name : ''; }).filter(Boolean); }
function chatPollHtml(m) {
  var p = m.poll, me = _cxMe(), votes = p.votes || {}, total = {}, max = 0, closed = p.closed || (p.until && new Date(p.until) < new Date());
  p.opts.forEach(function (o) { (votes[o.id] || []).forEach(function (u) { total[u] = 1; }); max = Math.max(max, (votes[o.id] || []).length); });
  var people = Object.keys(total).length, mine = p.by === me;
  return '<div class="cx-poll' + (closed ? ' closed' : '') + '" data-poll="' + m.id + '"><div class="cx-poll-h">' + (p.kind === 'time' ? '📅 약속 잡기' : '🗳 투표') + (p.multi && p.kind !== 'time' ? ' · 여러 개' : '') + (closed ? ' · <b>마감</b>' : '') + '</div>' +
    '<div class="cx-poll-q">' + _cxE(p.q) + '</div>' +
    p.opts.map(function (o) {
      var vs = votes[o.id] || [], on = vs.indexOf(me) >= 0, pct = people ? Math.round(vs.length / people * 100) : 0, win = p.pick === o.id || (closed && !p.pick && vs.length && vs.length === max);
      var busy = p.kind === 'time' && o.busy && o.busy.length ? '<i class="cx-poll-busy" title="' + _cxE(o.busy.join(', ')) + '">⚠ 일정 겹침 ' + o.busy.length + '명</i>' : p.kind === 'time' ? '<i class="cx-poll-free">모두 비어 있음</i>' : '';
      return '<button type="button" class="cx-poll-o' + (on ? ' on' : '') + (win ? ' win' : '') + '" data-vote="' + o.id + '"' + (closed ? ' disabled' : '') + ' title="' + _cxE(_cxmNames(vs).join(', ') || '아직 없음') + '">' +
        '<span class="cx-poll-bar" style="width:' + pct + '%"></span><span class="cx-poll-t">' + (on ? '✔ ' : '') + _cxE(p.kind === 'time' ? _cxmTime(o) : o.t) + busy + '</span><b>' + vs.length + '</b></button>';
    }).join('') +
    '<div class="cx-poll-f"><span>' + people + '명 참여' + (p.eventId ? ' · 📅 달력에 넣음' : '') + '</span>' + (mine && !closed ? '<button type="button" data-pclose>' + (p.kind === 'time' ? '시간 정하기' : '마감') + '</button>' : '') + '</div></div>';
}
function _cxmTime(o) {
  var d = new Date(o.at + 'T00:00:00'); var w = '일월화수목금토'[d.getDay()];
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + w + ')' + (o.from ? ' ' + o.from + (o.to ? '~' + o.to : '') : ' 하루');
}
function _cxmVote(mid, oid, el) {
  var m = CX.msgs.filter(function (x) { return x.id === mid; })[0]; if (!m || !m.poll) return;
  var me = _cxMe(), cur = m.poll.opts.filter(function (o) { return (m.poll.votes[o.id] || []).indexOf(me) >= 0; }).map(function (o) { return o.id; });
  var next = m.poll.multi ? (cur.indexOf(oid) >= 0 ? cur.filter(function (x) { return x !== oid; }) : cur.concat([oid])) : (cur[0] === oid ? [] : [oid]);
  apiFetch('/api/chat/messages/' + mid + '/vote', { method: 'POST', body: JSON.stringify({ opts: next }) }).then(function (r) { if (r && r.data && _cxUpsert(r.data, true)) _cxDrawMsgs(true); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
}
function _cxmClose(mid, btn) {
  var m = CX.msgs.filter(function (x) { return x.id === mid; })[0]; if (!m || !m.poll) return;
  function go(pick) {
    apiFetch('/api/chat/messages/' + mid + '/poll-close', { method: 'POST', body: JSON.stringify({ pick: pick || null }) }).then(function (r) { if (r && r.data && _cxUpsert(r.data, true)) _cxDrawMsgs(true); if (r.eventId) _cxToast('📅 달력에 일정을 넣었습니다', 'success'); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
  }
  if (m.poll.kind !== 'time') { if (confirm('투표를 마감할까요?')) go(null); return; }
  var sorted = m.poll.opts.slice().sort(function (a, b) { return (m.poll.votes[b.id] || []).length - (m.poll.votes[a.id] || []).length; });
  _cxMenu(btn, sorted.map(function (o) { return ['📅 ' + _cxmTime(o) + ' — ' + (m.poll.votes[o.id] || []).length + '표' + (o.busy && o.busy.length ? ' · 겹침 ' + o.busy.length : ''), function () { go(o.id); }]; }));
}

/* ─── ✔ 확인 요청 ─── */
function chatAckHtml(m) {
  var a = m.ack || {}, by = a.by || {}, me = _cxMe(), ms = ((CX.info && CX.info.members) || []).filter(function (u) { return u.id !== m.userId; });
  var done = ms.filter(function (u) { return by[u.id]; }).length;
  if (m.userId === me) return '<button type="button" class="cx-ack mine' + (done >= ms.length && ms.length ? ' all' : '') + '" data-ackl="' + m.id + '">✔ 확인 ' + done + '/' + ms.length + '</button>';
  return by[me] ? '<span class="cx-ack ok">✔ 확인했어요</span>' : '<button type="button" class="cx-ack need" data-ack="' + m.id + '">✔ 확인했어요 — 눌러 주세요</button>';
}
function _cxmAckList(btn, m) {
  var by = (m.ack && m.ack.by) || {}, ms = ((CX.info && CX.info.members) || []).filter(function (u) { return u.id !== m.userId; });
  _cxMenu(btn, ms.map(function (u) { return [(by[u.id] ? '✔ ' : '⏳ ') + u.name + (by[u.id] ? '' : ' — 아직'), function () {}]; }));
}

/** _cxMsgClick 이 부름 — 처리했으면 true */
function chatMoreClick(t) {
  var v = t.closest('[data-vote]'); if (v) { _cxmVote(+v.closest('[data-poll]').dataset.poll, v.dataset.vote, v); return true; }
  var pc = t.closest('[data-pclose]'); if (pc) { _cxmClose(+pc.closest('[data-poll]').dataset.poll, pc); return true; }
  var ak = t.closest('[data-ack]');
  if (ak) { ak.disabled = true; apiFetch('/api/chat/messages/' + ak.dataset.ack + '/ack', { method: 'POST', body: '{}' }).then(function (r) { if (r && r.data && _cxUpsert(r.data, true)) _cxDrawMsgs(true); }).catch(function (e) { ak.disabled = false; _cxToast(_cxErr(e), 'error'); }); return true; }
  var al = t.closest('[data-ackl]'); if (al) { var m = CX.msgs.filter(function (x) { return x.id === +al.dataset.ackl; })[0]; if (m) _cxmAckList(al, m); return true; }
  return false;
}

/* ─── 🏢 조직도 — 목록 칸을 부서별 사람으로 ─── */
function chatOrgToggle(on) {
  var side = document.querySelector('#mMessages .cx-side'); if (!side) return;
  CX.org = on == null ? !CX.org : !!on;
  side.classList.toggle('org-on', CX.org);
  var btn = document.getElementById('cxOrgBtn'); if (btn) btn.classList.toggle('on', CX.org);
  var box = document.getElementById('cxOrg');
  if (!CX.org) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'cxOrg'; box.className = 'cx-org'; side.appendChild(box); }
  box.innerHTML = '<div class="cx-loading">불러오는 중…</div>';
  apiFetch('/api/chat/users').then(function (r) {
    CX.users = (r && r.data) || [];
    var groups = {};
    CX.users.forEach(function (u) { var d = u.dept || '부서 없음'; (groups[d] = groups[d] || []).push(u); });
    var keys = Object.keys(groups).sort(function (a, b) { return a === '부서 없음' ? 1 : b === '부서 없음' ? -1 : a.localeCompare(b, 'ko'); });
    var on = CX.users.filter(function (u) { return u.online && !u.me; }).length;
    box.innerHTML = '<div class="cx-org-h">🏢 조직도 <span>' + CX.users.length + '명 · 접속 ' + on + '</span><input type="search" class="cx-org-q" placeholder="이름 · 부서 찾기" aria-label="조직도 찾기"></div>' +
      keys.map(function (k) {
        var us = groups[k].sort(function (a, b) { return (b.online - a.online) || a.name.localeCompare(b.name, 'ko'); });
        return '<details class="cx-org-d" open><summary>' + _cxE(k) + ' <i>' + us.length + '</i></summary>' + us.map(function (u) {
          var st = u.status && typeof chatStatusText === 'function' ? chatStatusText(u.status) : '';
          return '<div class="cx-org-u" data-name="' + _cxE((u.name + ' ' + k).toLowerCase()) + '">' + _cxAv(u.id, u.name, u.online) + '<span><b>' + _cxE(u.name) + (u.me ? ' (나)' : '') + '</b><i>' + _cxE(st || (u.online ? '● 접속 중' : '')) + '</i></span>' +
            (!u.me ? '<button type="button" class="cx-ib" data-odm="' + _cxE(u.id) + '" title="1:1 대화">💬</button>' + (typeof chatCallStart === 'function' ? '<button type="button" class="cx-ib" data-ocall="' + _cxE(u.id) + '" title="음성 통화">📞</button>' : '') : '') + '</div>';
        }).join('') + '</details>';
      }).join('');
    box.querySelector('.cx-org-q').addEventListener('input', function (e) {
      var q = e.target.value.trim().toLowerCase();
      box.querySelectorAll('.cx-org-u').forEach(function (x) { x.hidden = q && x.dataset.name.indexOf(q) < 0; });
      box.querySelectorAll('.cx-org-d').forEach(function (d) { d.hidden = !d.querySelector('.cx-org-u:not([hidden])'); });
    });
    box.addEventListener('click', function (e) {
      var dm = e.target.closest('[data-odm]'), cl = e.target.closest('[data-ocall]');
      if (dm) { chatOrgToggle(false); chatStartDm(dm.dataset.odm); }
      if (cl) { apiFetch('/api/chat/rooms', { method: 'POST', body: JSON.stringify({ kind: 'dm', userId: cl.dataset.ocall }) }).then(function (r) { chatOrgToggle(false); chatOpenRoom(r.data.id); setTimeout(function () { chatCallStart(r.data.id, false); }, 600); }); }
    });
  }).catch(function (e) { box.innerHTML = '<div class="cx-empty">' + _cxE(_cxErr(e)) + '</div>'; });
}

/* ─── 📤 대화 내보내기 ─── */
function chatExportModal() {
  if (!CX.room) return;
  return wmGuardedModal('chatExport', function () {
    var today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10), d30 = new Date(Date.now() + 9 * 36e5 - 30 * 864e5).toISOString().slice(0, 10);
    var m = createModal({ id: 'chatExportModal', title: '📤 대화 내보내기', width: '400px', closeOnEsc: true, closeOnOverlay: true,
      html: '<div class="cxm"><div class="cx-seg"><button type="button" data-r="all" class="on">전체</button><button type="button" data-r="30">최근 30일</button><button type="button" data-r="pick">직접</button></div>' +
        '<div class="cxm-opt" data-pick hidden><input type="date" class="wr-inp" data-from value="' + d30 + '"><span>~</span><input type="date" class="wr-inp" data-to value="' + today + '"></div>' +
        '<p class="cxm-note">텍스트 파일(.txt)로 받습니다 — 답글 줄기 · 파일 이름 · 음성 받아쓰기 · 투표 결과 포함. 납품 · 감사 자료로 보관할 때.</p>' +
        '<div class="cx-mfoot"><span></span><button type="button" class="wm-pri" data-go>⬇ 받기</button></div></div>' });
    var box = m.box, rng = 'all';
    box.querySelectorAll('[data-r]').forEach(function (b) { b.addEventListener('click', function () { rng = b.dataset.r; box.querySelectorAll('[data-r]').forEach(function (x) { x.classList.toggle('on', x === b); }); box.querySelector('[data-pick]').hidden = rng !== 'pick'; }); });
    box.querySelector('[data-go]').addEventListener('click', function () {
      var q = rng === '30' ? '?from=' + d30 : rng === 'pick' ? '?from=' + box.querySelector('[data-from]').value + '&to=' + box.querySelector('[data-to]').value : '';
      fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/rooms/' + encodeURIComponent(CX.room) + '/export' + q, { headers: { Authorization: 'Bearer ' + _accessToken } }).then(function (res) {
        if (!res.ok) throw new Error('내보내지 못했습니다');
        var cd = res.headers.get('content-disposition') || '', nm = decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(cd) || [])[1] || 'chat.txt');
        return res.blob().then(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nm; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000); m.close(); _cxToast('📤 ' + nm, 'success'); });
      }).catch(function (e) { _cxToast(e.message, 'error'); });
    });
  }, 'chatExportModal');
}
if (typeof window !== 'undefined') { window.chatPollModal = chatPollModal; window.chatPollHtml = chatPollHtml; window.chatAckHtml = chatAckHtml; window.chatMoreClick = chatMoreClick; window.chatOrgToggle = chatOrgToggle; window.chatExportModal = chatExportModal; }
