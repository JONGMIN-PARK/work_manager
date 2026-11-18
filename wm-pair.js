/**
 * 🤝 함께 일하기 (v13.533~) — 같이 담당 · 함께 하기(페어 세션)
 *   같이 담당: 할 일 하나를 여럿이 — 상세 패널 '🤝 같이 담당' 칸에서 사람 더하기 · 빼기(주인) · 나 빠지기
 *     서버 PUT /api/my-work/todos/:id/partners · 같이 담당도 내 업무에 보이고 고치기 · 완료(누가 끝내든 한 번에)
 *   목록 · 보드 카드에 🤝 표시 (mwPairTag)
 */
function _wpE(s) { return typeof _mwEsc === 'function' ? _mwEsc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _wpToast(m, k) { if (typeof showToast === 'function') showToast(m, k); }
function _wpMe() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : ''; }

/* 목록 · 보드 카드 — 🤝 다른 사람 이름 */
function mwPairTag(it) {
  if (!it || !it.partners || !it.partners.length) return '';
  var me = _wpMe(), others = [{ id: it.ownerId, name: it.ownerName }].concat(it.partners).filter(function (p) { return p.id && p.id !== me; });
  if (!others.length) return '';
  var nm = others.map(function (p) { return p.name; }).filter(Boolean);
  return '<span class="mw-pair" title="🤝 같이 담당: ' + _wpE(nm.join(', ')) + (it.isOwner === false ? ' (주인 ' + _wpE(it.ownerName) + ')' : '') + '">🤝 ' + _wpE(nm[0] || '') + (nm.length > 1 ? ' +' + (nm.length - 1) : '') + '</span>';
}

/* 상세 패널 칸 */
function mwPairSecHtml(it) {
  if (!it || it.src !== 'todo') return '';
  var me = _wpMe(), owner = it.ownerId || me, isOwner = !it.ownerId || it.isOwner !== false;
  var ps = it.partners || [];
  var chip = function (p, canRm) { return '<span class="mwp-pc">' + _wpE(p.name || '') + (canRm ? '<button type="button" data-p="pair-rm" data-u="' + _wpE(p.id) + '" title="같이 담당에서 빼기">✕</button>' : '') + '</span>'; };
  var h = '<div class="mwp-sec"><div class="mwp-l">🤝 같이 담당 <i>누가 끝내든 함께 완료 · 둘 다 내 업무에 보임</i></div><div class="mwp-row mwp-pair">';
  if (!isOwner) h += '<span class="mwp-pc own" title="이 할 일의 주인">👑 ' + _wpE(it.ownerName || '') + '</span>';
  h += ps.filter(function (p) { return p.id !== me; }).map(function (p) { return chip(p, isOwner); }).join('');
  if (!isOwner) h += '<span class="mwp-pc me">나</span>';
  if (!it.done) h += '<button type="button" class="mwp-chip" data-p="pair-add">＋ 사람</button>';
  if (!isOwner) h += '<button type="button" class="mwp-chip" data-p="pair-leave" title="같이 담당에서 나 빠지기">나 빠지기</button>';
  return h + '</div></div>';
}

function _wpSave(it, ids) {
  return apiFetch('/api/my-work/todos/' + encodeURIComponent(it.id) + '/partners', { method: 'PUT', body: JSON.stringify({ userIds: ids }) });
}
/* 패널 단추 — my-work-panel.js 가 부름. 처리했으면 true */
function mwPairClick(k, a, it) {
  if (k === 'pair-add') { wpPickPerson(it); return true; }
  if (k === 'pair-rm') {
    var u = a.getAttribute('data-u');
    _wpSave(it, (it.partners || []).map(function (p) { return p.id; }).filter(function (x) { return x !== u; })).then(function () { _wpAfter(it); _wpToast('같이 담당에서 뺐습니다'); }).catch(_wpErr);
    return true;
  }
  if (k === 'pair-leave') {
    var me = _wpMe();
    Promise.resolve(typeof wmConfirm === 'function' ? wmConfirm('이 할 일의 같이 담당에서 빠질까요? 내 업무에서 사라집니다.') : true).then(function (ok) {
      if (!ok) return;
      _wpSave(it, (it.partners || []).map(function (p) { return p.id; }).filter(function (x) { return x !== me; })).then(function () {
        if (typeof mwPanelClose === 'function') mwPanelClose();
        if (typeof renderMyWork === 'function') renderMyWork();
        _wpToast('같이 담당에서 빠졌습니다');
      }).catch(_wpErr);
    });
    return true;
  }
  return false;
}
function _wpErr(e) { _wpToast('바꾸지 못했습니다: ' + ((e && e.data && e.data.message) || e.message || e), 'error'); }
function _wpAfter(it) { if (typeof renderMyWork === 'function') renderMyWork(); }

/* 사람 고르기 — 📨 업무 보내기와 같은 사람 목록(바꾼 이름(등록 이름) · 부서) */
function wpPickPerson(it, onPick) {
  return wmGuardedModal('wpPick', function () {
    var load = typeof _wqLoadPeople === 'function' ? _wqLoadPeople() : apiFetch('/api/users/lookup').then(function (r) { return (r.data || []).map(function (u) { return { id: u.id, name: u.display_name || u.name, dept: u.dept_name || '' }; }); });
    return load.then(function (people) {
      var taken = it ? [it.ownerId].concat((it.partners || []).map(function (p) { return p.id; })) : [];
      var md = createModal({ id: 'wpPickModal', title: it ? '🤝 같이 담당할 사람' : '🤝 함께 할 사람', width: '400px', closeOnEsc: true,
        html: '<div class="wp-pick"><input class="wr-inp" id="wpQ" placeholder="이름 · 부서로 찾기" autocomplete="off"><div class="wp-list"></div></div>' });
      var q = md.box.querySelector('#wpQ'), list = md.box.querySelector('.wp-list');
      var draw = function () {
        var v = q.value.trim().toLowerCase(), cur = null, h = '';
        people.filter(function (p) { return taken.indexOf(p.id) < 0 && (!v || [p.name, p.reg, p.nm, p.dept].some(function (x) { return String(x || '').toLowerCase().indexOf(v) >= 0; })); })
          .sort(function (a, b) { return (a.dept ? 0 : 1) - (b.dept ? 0 : 1) || String(a.dept || '').localeCompare(String(b.dept || ''), 'ko') || a.name.localeCompare(b.name, 'ko'); })
          .forEach(function (p) { var d = p.dept || '부서 없음'; if (d !== cur) { cur = d; h += '<div class="wp-dept">🏢 ' + _wpE(d) + '</div>'; } h += '<button type="button" class="wp-p" data-id="' + _wpE(p.id) + '">' + _wpE(p.name) + '</button>'; });
        list.innerHTML = h || '<div class="wp-none">맞는 사람이 없습니다</div>';
      };
      q.addEventListener('input', draw);
      list.addEventListener('click', function (e) {
        var b = e.target.closest('[data-id]'); if (!b) return;
        md.close();
        if (onPick) return onPick(b.dataset.id, people.filter(function (p) { return p.id === b.dataset.id; })[0]);
        _wpSave(it, (it.partners || []).map(function (p) { return p.id; }).concat([b.dataset.id])).then(function () { _wpAfter(it); _wpToast('🤝 같이 담당을 더했습니다 — 그 사람 내 업무에도 보이고 메신저로 알렸어요'); }).catch(_wpErr);
      });
      draw();
      setTimeout(function () { q.focus(); }, 0);
    });
  }, 'wpPickModal');
}

/* ═══ 🤝 함께 하기 — 페어 세션 (v13.534) ═══
   시작: wpStart({ title, itemKey, projectId }) — 함께 할 사람 고르기 → 방 · 📝 공동 메모 · 세션 (서버 /api/pair)
   진행 중 막대(왼쪽 아래): 제목 · 사람 · 경과 · 📝 메모 · 💬 방 · 📞 통화 · ⏹ 끝내기 (초대받은 사람은 [참여])
   끝내기: 요약 한 줄 · (할 일이면) 같이 담당으로 → 방 · 할 일 메모 · 참여자 모두의 그날 노트에 한 줄 */
var WP = { active: [], tick: null };
function wpStart(o) {
  o = o || {};
  return wmGuardedModal('wpStart', function () {
    var load = typeof _wqLoadPeople === 'function' ? _wqLoadPeople() : Promise.resolve([]);
    return load.then(function (people) {
      var pick = {};
      var md = createModal({ id: 'wpStartModal', title: '🤝 함께 하기', width: '440px', closeOnEsc: true,
        html: '<div class="wp-start"><label class="wrq-f"><span>무엇을 함께</span><input class="wr-inp" id="wpTitle" maxlength="200" value="' + _wpE(o.title || '') + '" placeholder="예: 견적 검토 · 3번 축 디버깅"></label>' +
          '<div class="wrq-f"><span>함께 할 사람 <i id="wpN"></i></span><input class="wr-inp" id="wpQ2" placeholder="이름 · 부서로 찾기" autocomplete="off"><div class="wp-list wp-multi"></div></div>' +
          '<div class="wp-hint">시작하면 함께 쓰는 📝 공동 메모가 있는 대화방이 열리고, 필요하면 📞 통화 · 화면 공유로 이어 갈 수 있어요. 끝내면 걸린 시간과 요약이 참여자 모두의 노트에 남습니다.</div>' +
          '<div class="wrq-foot"><span style="flex:1"></span><button type="button" class="btn btn-g" data-x>취소</button><button type="button" class="btn btn-p" data-go>🤝 시작</button></div></div>' });
      var box = md.box, list = box.querySelector('.wp-list'), q = box.querySelector('#wpQ2');
      var draw = function () {
        var v = q.value.trim().toLowerCase(), cur = null, h = '';
        people.filter(function (p) { return pick[p.id] || !v || [p.name, p.reg, p.nm, p.dept].some(function (x) { return String(x || '').toLowerCase().indexOf(v) >= 0; }); })
          .sort(function (a, b) { return (pick[b.id] ? 1 : 0) - (pick[a.id] ? 1 : 0) || (a.dept ? 0 : 1) - (b.dept ? 0 : 1) || String(a.dept || '').localeCompare(String(b.dept || ''), 'ko') || a.name.localeCompare(b.name, 'ko'); })
          .forEach(function (p) { var d = pick[p.id] ? '✔ 고른 사람' : (p.dept || '부서 없음'); if (d !== cur) { cur = d; h += '<div class="wp-dept">' + (pick[p.id] ? '' : '🏢 ') + _wpE(d) + '</div>'; } h += '<label class="wp-p"><input type="checkbox" data-id="' + _wpE(p.id) + '"' + (pick[p.id] ? ' checked' : '') + '> ' + _wpE(p.name) + '</label>'; });
        list.innerHTML = h || '<div class="wp-none">맞는 사람이 없습니다</div>';
        box.querySelector('#wpN').textContent = Object.keys(pick).length ? Object.keys(pick).length + '명' : '';
      };
      q.addEventListener('input', draw);
      list.addEventListener('change', function (e) { var c = e.target.closest('[data-id]'); if (!c) return; if (c.checked) pick[c.dataset.id] = 1; else delete pick[c.dataset.id]; draw(); });
      box.querySelector('[data-x]').onclick = function () { md.close(); };
      box.querySelector('[data-go]').onclick = function () {
        var btn = this, title = box.querySelector('#wpTitle').value.trim(), ids = Object.keys(pick);
        if (!title) { box.querySelector('#wpTitle').focus(); return _wpToast('무엇을 함께 할지 적으세요.', 'warn'); }
        if (!ids.length) { q.focus(); return _wpToast('함께 할 사람을 고르세요.', 'warn'); }
        btn.disabled = true;
        apiFetch('/api/pair', { method: 'POST', body: JSON.stringify({ title: title, userIds: ids, itemKey: o.itemKey || null, projectId: o.projectId || null }) }).then(function (r) {
          md.close();
          WP.active = [r.data].concat(WP.active.filter(function (s) { return s.id !== r.data.id; }));
          wpBarPaint();
          if (typeof chatDocOpen === 'function') chatDocOpen(r.data.docId);
          _wpToast('🤝 함께 하기를 시작했어요 — 상대에게 메신저로 알렸습니다');
        }).catch(function (e) { btn.disabled = false; _wpErr(e); });
      };
      draw();
      setTimeout(function () { (o.title ? q : box.querySelector('#wpTitle')).focus(); }, 0);
    });
  }, 'wpStartModal');
}
function wpLoad() {
  if (typeof currentUser === 'undefined' || !currentUser) return Promise.resolve();
  return apiFetch('/api/pair?active=1').then(function (r) { WP.active = (r && r.data) || []; wpBarPaint(); }).catch(function () {});
}
function _wpAgo(s) { var m = Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 60000)); return m < 60 ? m + '분' : Math.floor(m / 60) + '시간 ' + (m % 60) + '분'; }
function wpBarPaint() {
  var bar = document.getElementById('wpBar'), me = _wpMe();
  if (!WP.active.length) { if (bar) bar.remove(); clearInterval(WP.tick); WP.tick = null; return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'wpBar'; bar.className = 'wp-bar'; document.body.appendChild(bar); bar.addEventListener('click', _wpBarClick); }
  bar.innerHTML = WP.active.map(function (s) {
    var others = s.members.filter(function (m) { return m.id !== me; }).map(function (m) { return m.name; }).join(', ');
    var meJ = s.members.some(function (m) { return m.id === me && m.joined; });
    return '<div class="wp-s" data-sid="' + _wpE(s.id) + '"><span class="wp-ic">🤝</span><span class="wp-t"><b>' + _wpE(s.title) + '</b><small>' + _wpE(others) + ' · <span class="wp-ago">' + _wpAgo(s) + '</span></small></span>' +
      (meJ ? '' : '<button type="button" class="btn btn-p btn-s" data-wp="join">참여</button>') +
      '<button type="button" class="wp-b" data-wp="doc" title="📝 공동 메모">📝</button><button type="button" class="wp-b" data-wp="room" title="💬 대화방">💬</button>' +
      '<button type="button" class="wp-b" data-wp="call" title="📞 통화 (화면 공유는 통화 창에서)">📞</button><button type="button" class="wp-b end" data-wp="end" title="⏹ 끝내기">⏹</button></div>';
  }).join('');
  if (!WP.tick) WP.tick = setInterval(function () { document.querySelectorAll('#wpBar .wp-s').forEach(function (el) { var s = WP.active.filter(function (x) { return x.id === el.dataset.sid; })[0]; if (s) el.querySelector('.wp-ago').textContent = _wpAgo(s); }); }, 30000);
}
function _wpBarClick(e) {
  var b = e.target.closest('[data-wp]'); if (!b) return;
  var s = WP.active.filter(function (x) { return x.id === b.closest('[data-sid]').dataset.sid; })[0]; if (!s) return;
  var a = b.dataset.wp;
  if (a === 'join') return apiFetch('/api/pair/' + encodeURIComponent(s.id) + '/join', { method: 'POST', body: '{}' }).then(function (r) { Object.assign(s, r.data); wpBarPaint(); if (typeof chatDocOpen === 'function') chatDocOpen(s.docId); }).catch(_wpErr);
  if (a === 'doc') return typeof chatDocOpen === 'function' && chatDocOpen(s.docId);
  if (a === 'room' || a === 'call') {
    if (typeof setPage === 'function') setPage('messages');
    return setTimeout(function () { if (typeof chatOpenRoom === 'function') chatOpenRoom(s.roomId); if (a === 'call' && typeof chatCallStart === 'function') setTimeout(function () { chatCallStart(s.roomId, false); }, 600); }, 400);
  }
  if (a === 'end') return wpEnd(s);
}
function wpEnd(s) {
  return wmGuardedModal('wpEnd', function () {
    var todo = /^todo:/.test(s.itemKey || '');
    var md = createModal({ id: 'wpEndModal', title: '⏹ 함께 하기 끝내기', width: '420px', closeOnEsc: true,
      html: '<div class="wp-end"><div class="wp-hint">' + _wpE(s.title) + ' · ' + _wpAgo(s) + ' 동안</div>' +
        '<label class="wrq-f"><span>결과 한 줄 (모두의 노트에 남아요)</span><input class="wr-inp" id="wpSum" maxlength="1000" placeholder="예: 간섭 원인 찾음 — 내일 지그 수정"></label>' +
        (todo ? '<label class="wp-ck"><input type="checkbox" id="wpAddP" checked> 연결된 할 일에 함께한 사람을 🤝 같이 담당으로</label>' : '') +
        '<div class="wrq-foot"><span style="flex:1"></span><button type="button" class="btn btn-g" data-x>계속하기</button><button type="button" class="btn btn-p" data-go>끝내기</button></div></div>' });
    var box = md.box;
    box.querySelector('[data-x]').onclick = function () { md.close(); };
    var go = function () {
      box.querySelector('[data-go]').disabled = true;
      var ap = box.querySelector('#wpAddP');
      apiFetch('/api/pair/' + encodeURIComponent(s.id) + '/end', { method: 'POST', body: JSON.stringify({ summary: box.querySelector('#wpSum').value.trim(), addPartners: !!(ap && ap.checked) }) }).then(function (r) {
        md.close();
        WP.active = WP.active.filter(function (x) { return x.id !== s.id; }); wpBarPaint();
        _wpToast('🤝 끝 — ' + (r.data.minutes || 0) + '분. 함께한 사람 모두의 노트에 남겼어요');
        if (typeof renderMyWork === 'function' && typeof curPage !== 'undefined' && curPage === 'mywork') renderMyWork();
      }).catch(function (e) { box.querySelector('[data-go]').disabled = false; if (e && e.status === 409) { md.close(); wpLoad(); return _wpToast('이미 끝난 세션입니다'); } _wpErr(e); });
    };
    box.querySelector('[data-go]').onclick = go;
    box.querySelector('#wpSum').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    setTimeout(function () { box.querySelector('#wpSum').focus(); }, 0);
  }, 'wpEndModal');
}
/* 🤝 함께 한 기록 */
function wpHistory() {
  return wmGuardedModal('wpHist', function () {
    return apiFetch('/api/pair').then(function (r) {
      var me = _wpMe(), L = (r && r.data) || [];
      createModal({ id: 'wpHistModal', title: '🤝 함께 한 기록', width: '560px', closeOnEsc: true,
        html: '<div class="wp-hist">' + (L.length ? L.map(function (s) {
          var others = s.members.filter(function (m) { return m.id !== me; }).map(function (m) { return m.name; }).join(', ');
          var d = new Date(s.startedAt), day = (d.getMonth() + 1) + '/' + d.getDate();
          return '<div class="wp-h"><div class="wp-h-t"><b>' + _wpE(s.title) + '</b><span>' + _wpE(day) + ' · ' + (s.endedAt ? (s.minutes || 0) + '분' : '<i>진행 중</i>') + '</span></div>' +
            '<div class="wp-h-s">🤝 ' + _wpE(others) + (s.summary ? ' · ' + _wpE(s.summary) : '') + '</div>' +
            '<div class="wp-h-a"><button type="button" class="wsc-a" data-doc="' + _wpE(s.docId) + '">📝 메모</button></div></div>';
        }).join('') : '<div class="wp-none">아직 함께 한 기록이 없습니다</div>') + '</div>' });
      var m = document.getElementById('wpHistModal');
      if (m) m.addEventListener('click', function (e) { var b = e.target.closest('[data-doc]'); if (b && typeof chatDocOpen === 'function') chatDocOpen(b.dataset.doc); });
    });
  }, 'wpHistModal');
}
/* 로그인 뒤 · 2분마다 · 다시 볼 때 — 진행 중 세션(초대받은 것 포함) */
(function () {
  var started = false;
  function start() {
    if (started) return;
    if (typeof currentUser === 'undefined' || !currentUser) return setTimeout(start, 1500);
    started = true; wpLoad(); setInterval(function () { if (document.visibilityState !== 'hidden') wpLoad(); }, 120000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'hidden') wpLoad(); });
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1800); }); else setTimeout(start, 1800); }
})();

/* 프로젝트 상세 ⋯ — 그 프로젝트 이름으로 */
function wpStartProject(pid) {
  var pd = document.getElementById('projDetailPanel');
  return wpStart({ projectId: pid, title: pd && pd.getAttribute('data-pid') === pid ? '[' + (pd.getAttribute('data-pname') || '') + '] ' : '' });
}
