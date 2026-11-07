/**
 * chat-time.js — ⏰ 메신저 예약 보내기 · 다시 알림 (v13.362)
 *   입력칸 ⏰ → 30분 뒤 · 1시간 뒤 · 오늘 18시 · 내일 9시 · 월요일 9시 · 직접 → 그때 보냄 (입력칸 위 '⏰ 예약 N' 에서 지금 보내기 · 취소)
 *   메시지 ⋯ → ⏰ 다시 알림 → 그때 나에게 알림(화면 · 휴대폰 푸시 · 텔레그램) — 누르면 그 메시지로
 *   🛠 요청 카드 📣 다시 알림 → 담당자에게 (한 시간에 한 번) · 서버가 4시간 넘게 '접수'면 자동으로 한 번
 *   chat-ui.js 가 부르는 것: chatTimeComposer · chatRemindMenu · chatTimeOnEvent · chatTimeList
 */
var CT = { sched: [] };
function _ctE(s) { return typeof _cxE === 'function' ? _cxE(s) : String(s == null ? '' : s); }
function _ctToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _ctErr(e) { return (e && e.data && e.data.message) || (e && e.message) || '실패했습니다'; }
function _ctFmt(d) {
  d = new Date(d); var now = new Date(), t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  var day = new Date(d); day.setHours(0, 0, 0, 0); var td = new Date(now); td.setHours(0, 0, 0, 0);
  var diff = Math.round((day - td) / 86400000);
  return (diff === 0 ? '오늘' : diff === 1 ? '내일' : diff === 2 ? '모레' : (d.getMonth() + 1) + '/' + d.getDate() + '(' + '일월화수목금토'[d.getDay()] + ')') + ' ' + t;
}
/** 고르기 메뉴 — 지금 시각에 맞춰 */
function _ctPresets(cb) {
  var now = new Date(), out = [];
  function at(h, m, addDays) { var d = new Date(now); d.setDate(d.getDate() + (addDays || 0)); d.setHours(h, m || 0, 0, 0); return d; }
  out.push(['⏱ 30분 뒤', new Date(now.getTime() + 30 * 60000)]);
  out.push(['⏱ 1시간 뒤', new Date(now.getTime() + 3600000)]);
  if (now.getHours() < 17) out.push(['🌇 오늘 18:00', at(18)]);
  out.push(['🌅 내일 09:00', at(9, 0, 1)]);
  var toMon = (8 - now.getDay()) % 7 || 7;
  out.push(['📅 다음 월요일 09:00', at(9, 0, toMon)]);
  out = out.map(function (o) { return [o[0] + '  · ' + _ctFmt(o[1]), function () { cb(o[1]); }]; });
  out.push(['✏️ 직접 고르기…', function () {
    var def = at(9, 0, 1), v = prompt('언제? (예: 2026-11-10 14:30)', def.getFullYear() + '-' + ('0' + (def.getMonth() + 1)).slice(-2) + '-' + ('0' + def.getDate()).slice(-2) + ' 09:00');
    if (!v) return;
    var d = new Date(v.trim().replace(' ', 'T'));
    if (isNaN(d) || d < new Date()) { _ctToast('날짜 · 시각을 다시 확인해 주세요', 'warn'); return; }
    cb(d);
  }]);
  return out;
}

/* ─── 입력칸: ⏰ 예약 보내기 ─── */
function chatTimeComposer(btn, ta) {
  var body = (ta && ta.value || '').trim();
  if (!body) { _ctToast('먼저 보낼 글을 적고 ⏰ 를 누르세요', 'info'); if (ta) ta.focus(); return; }
  if (typeof _cxMenu !== 'function') return;
  _cxMenu(btn, _ctPresets(function (d) {
    var room = CX.room;
    apiFetch('/api/chat/rooms/' + encodeURIComponent(room) + '/scheduled', { method: 'POST', body: JSON.stringify({ body: body, sendAt: d.toISOString() }) }).then(function () {
      if (ta.value.trim() === body) { ta.value = ''; ta.dispatchEvent(new Event('input')); }
      _ctToast('⏰ ' + _ctFmt(d) + ' 에 보냅니다', 'success');
      chatTimeStrip();
    }).catch(function (e) { _ctToast(_ctErr(e), 'error'); });
  }));
}
/** 입력칸 위 '⏰ 예약 N' 줄 */
function chatTimeStrip() {
  if (typeof CX === 'undefined' || !CX.room) return;
  var room = CX.room;
  apiFetch('/api/chat/scheduled?room=' + encodeURIComponent(room)).then(function (r) {
    if (CX.room !== room) return;
    CT.sched = (r && r.data) || [];
    var comp = document.getElementById('cxComp'); if (!comp) return;
    var el = comp.querySelector('.ct-strip');
    if (!CT.sched.length) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('button'); el.type = 'button'; el.className = 'ct-strip'; comp.insertBefore(el, comp.firstChild); el.addEventListener('click', function () { _ctStripMenu(el); }); }
    el.innerHTML = '⏰ 예약 <b>' + CT.sched.length + '</b> · 다음 ' + _ctE(_ctFmt(CT.sched[0].sendAt)) + ' — <span>' + _ctE(CT.sched[0].body.slice(0, 40)) + '</span>';
  }).catch(function () {});
}
function _ctStripMenu(anchor) {
  var items = [];
  CT.sched.forEach(function (s) {
    items.push(['⏰ ' + _ctFmt(s.sendAt) + ' · ' + s.body.slice(0, 40), function () {
      _cxMenu(anchor, [
        ['➤ 지금 보내기', function () { apiFetch('/api/chat/scheduled/' + s.id + '/now', { method: 'POST', body: '{}' }).then(function (r) { if (r && r.data && _cxAddIfNew(r.data)) _cxDrawMsgs(true); chatTimeStrip(); }).catch(function (e) { _ctToast(_ctErr(e), 'error'); }); }],
        ['✏️ 입력칸으로 가져와 고치기', function () { apiFetch('/api/chat/scheduled/' + s.id, { method: 'DELETE' }).then(function () { var ta = document.getElementById('cxIn'); if (ta) { ta.value = s.body; ta.dispatchEvent(new Event('input')); ta.focus(); } chatTimeStrip(); }); }],
        ['🗑 예약 취소', function () { apiFetch('/api/chat/scheduled/' + s.id, { method: 'DELETE' }).then(function () { _ctToast('예약을 취소했습니다', 'info'); chatTimeStrip(); }); }]
      ]);
    }]);
  });
  _cxMenu(anchor, items);
}

/* ─── 메시지 ⋯ → ⏰ 다시 알림 ─── */
function chatRemindMenu(anchor, m) {
  if (typeof _cxMenu !== 'function') return;
  _cxMenu(anchor, _ctPresets(function (d) {
    apiFetch('/api/chat/messages/' + m.id + '/remind', { method: 'POST', body: JSON.stringify({ at: d.toISOString() }) })
      .then(function () { _ctToast('⏰ ' + _ctFmt(d) + ' 에 다시 알려 드립니다', 'success'); })
      .catch(function (e) { _ctToast(_ctErr(e), 'error'); });
  }));
}

/* ─── 실시간: 다시 알림 도착 · 예약이 나감 ─── */
function chatTimeOnEvent(ev, d) {
  if (ev === 'remind') {
    var box = document.getElementById('cxPop');
    if (!box) { box = document.createElement('div'); box.id = 'cxPop'; box.className = 'cx-pops'; document.body.appendChild(box); }
    var p = document.createElement('button'); p.type = 'button'; p.className = 'cx-pop ct-pop';
    p.innerHTML = '<span class="ct-ic">⏰</span><span><b></b><i></i></span>';
    p.querySelector('b').textContent = '다시 알림' + (d.roomName ? ' · ' + d.roomName : '') + (d.note ? ' — ' + d.note : '');
    p.querySelector('i').textContent = (d.fromName ? d.fromName + ': ' : '') + (d.body || '');
    p.addEventListener('click', function () { p.remove(); chatOpenRoom(d.roomId, false, d.msgId); });
    box.appendChild(p);
    setTimeout(function () { p.classList.add('out'); setTimeout(function () { p.remove(); }, 300); }, 20000);   // 다시 알림은 오래 둠
    if (typeof wmAppNotify === 'function') wmAppNotify('⏰ 다시 알림' + (d.note ? ' — ' + d.note : ''), (d.fromName ? d.fromName + ': ' : '') + (d.body || ''), 'chat:' + d.roomId);
  } else if (ev === 'sched') {
    if (typeof CX !== 'undefined' && CX.room === d.roomId) chatTimeStrip();
  }
}

/* ─── 모아 보기 '⏰ 알림 · 예약' 탭 ─── */
function chatTimeList(box) {
  box.innerHTML = '<div class="ct-list"><div class="cx-loading">불러오는 중…</div></div>';
  Promise.all([apiFetch('/api/chat/reminders'), apiFetch('/api/chat/scheduled')]).then(function (rs) {
    var rem = rs[0].data || [], sch = rs[1].data || [];
    var l = box.querySelector('.ct-list');
    function row(kind, x) {
      return '<div class="ct-row" data-k="' + kind + '" data-id="' + x.id + '"><span class="ct-when">' + _ctE(_ctFmt(kind === 'r' ? x.remindAt : x.sendAt)) + '</span>' +
        '<span class="ct-what"><b>' + _ctE(kind === 'r' ? (x.who ? x.who + ': ' : '') + x.body : x.body) + '</b><i>💬 ' + _ctE(x.roomName || '') + (x.note ? ' · 📝 ' + _ctE(x.note) : '') + '</i></span>' +
        '<button type="button" class="cx-ib" data-go title="대화에서 보기">↗</button>' + (kind === 's' ? '<button type="button" class="cx-ib" data-now title="지금 보내기">➤</button>' : '') + '<button type="button" class="cx-ib" data-x title="취소">✕</button></div>';
    }
    l.innerHTML = '<h4>⏰ 다시 알림 <i>' + rem.length + '</i></h4>' + (rem.length ? rem.map(function (x) { return row('r', x); }).join('') : '<div class="cx-empty">없음 — 메시지 ⋯ → ⏰ 다시 알림</div>') +
      '<h4>📤 예약 보내기 <i>' + sch.length + '</i></h4>' + (sch.length ? sch.map(function (x) { return row('s', x); }).join('') : '<div class="cx-empty">없음 — 글을 쓰고 입력칸 ⏰</div>');
    l.onclick = function (e) {
      var r = e.target.closest('[data-id]'); if (!r) return;
      var k = r.dataset.k, id = +r.dataset.id, x = (k === 'r' ? rem : sch).filter(function (y) { return y.id === id; })[0];
      if (e.target.closest('[data-x]')) apiFetch(k === 'r' ? '/api/chat/reminders/' + id : '/api/chat/scheduled/' + id, { method: 'DELETE' }).then(function () { chatTimeList(box); });
      else if (e.target.closest('[data-now]')) apiFetch('/api/chat/scheduled/' + id + '/now', { method: 'POST', body: '{}' }).then(function () { _ctToast('보냈습니다', 'success'); chatTimeList(box); }).catch(function (er) { _ctToast(_ctErr(er), 'error'); });
      else if (e.target.closest('[data-go]') && x) { var ov = box.closest('.wa-modal-overlay'); if (ov) ov.remove(); chatOpenRoom(x.roomId, false, k === 'r' ? x.msgId : null); }
    };
  }).catch(function () { box.innerHTML = '<div class="cx-empty">불러오지 못했습니다</div>'; });
}

if (typeof window !== 'undefined') { window.chatTimeComposer = chatTimeComposer; window.chatTimeStrip = chatTimeStrip; window.chatRemindMenu = chatRemindMenu; window.chatTimeOnEvent = chatTimeOnEvent; window.chatTimeList = chatTimeList; }
