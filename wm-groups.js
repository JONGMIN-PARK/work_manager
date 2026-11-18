/**
 * 👥 그룹(TFT) (v13.535) — 고정된 사람 묶음 · 그룹 대화방
 *   wgManage()          내 그룹 창 — 만들기 · 고치기(이름 · 아이콘 · 목적 · 구성원) · 💬 대화방 · 보관 · 빠지기
 *   wgLoad()            내가 낀 그룹 (사람 고르기 세 곳이 씀: 📨 업무 보내기 · 🤝 함께 하기 · 🤝 같이 담당)
 *   wgChipsHtml(attr)   사람 고르기 맨 위 '👥 그룹' 단추 줄
 * 서버: /api/groups (routes/groups.js)
 */
var WG = { list: null, at: 0, busy: null };
function _wgE(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _wgToast(m, k) { if (typeof showToast === 'function') showToast(m, k); }
function _wgMe() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : ''; }
function wgLoad(force) {
  if (WG.list && !force && Date.now() - WG.at < 60000) return Promise.resolve(WG.list);
  if (WG.busy) return WG.busy;
  WG.busy = apiFetch('/api/groups').then(function (r) { WG.list = (r && r.data) || []; WG.at = Date.now(); return WG.list; })
    .catch(function () { return WG.list || []; }).then(function (l) { WG.busy = null; return l; });
  return WG.busy;
}
/* 사람 고르기 맨 위 — 그룹 단추 (attr: 누르면 무엇을 할지 고르기 창이 알아보는 속성 이름) */
function wgChipsHtml(attr, disabled, q) {
  var v = String(q || '').trim().toLowerCase();
  var L = (WG.list || []).filter(function (g) { return !v || g.name.toLowerCase().indexOf(v) >= 0; }); if (!L.length) return '';
  return '<div class="wg-chips"><span class="wg-l">👥 그룹</span>' + L.map(function (g) {
    return '<button type="button" class="wg-chip" ' + attr + '="' + _wgE(g.id) + '"' + (disabled ? ' disabled' : '') + ' title="' + _wgE(g.members.map(function (m) { return m.name; }).join(', ')) + '">' + _wgE(g.icon || '👥') + ' ' + _wgE(g.name) + ' <small>' + g.members.length + '</small></button>';
  }).join('') + '</div>';
}
function wgMembersOf(id, exceptMe) {
  var g = (WG.list || []).filter(function (x) { return x.id === id; })[0]; if (!g) return [];
  var me = _wgMe();
  return g.members.map(function (m) { return m.id; }).filter(function (u) { return !exceptMe || u !== me; });
}

/* ═══ 👥 내 그룹 창 ═══ */
function wgManage() {
  return wmGuardedModal('wgManage', function () {
    return wgLoad(true).then(function () {
      createModal({ id: 'wgModal', title: '👥 내 그룹 (TFT)', width: '600px', closeOnEsc: true, html: '<div class="wg-box"></div>' });
      _wgPaint();
      document.querySelector('#wgModal .wg-box').addEventListener('click', _wgClick);
    });
  }, 'wgModal');
}
function _wgPaint() {
  var box = document.querySelector('#wgModal .wg-box'); if (!box) return;
  var me = _wgMe(), L = WG.list || [];
  box.innerHTML = '<div class="wg-top"><span class="wg-hint">자주 함께 일하는 사람들을 묶어 두면 📨 업무 보내기 · 🤝 함께 하기 · 🤝 같이 담당에서 그룹 이름 하나로 모두를 고릅니다. 그룹마다 대화방이 생겨요.</span>' +
    '<button type="button" class="btn btn-p btn-s" data-wg="new">＋ 새 그룹</button></div>' +
    (L.length ? L.map(function (g) {
      var lead = g.ownerId === me;
      return '<div class="wg-card"><div class="wg-h"><span class="wg-ic">' + _wgE(g.icon) + '</span><b>' + _wgE(g.name) + '</b><span class="wg-n">' + g.members.length + '명</span><span style="flex:1"></span>' +
        '<button type="button" class="wsc-a" data-wg="room" data-id="' + _wgE(g.id) + '" title="그룹 대화방">💬 대화방</button>' +
        (lead ? '<button type="button" class="wsc-a" data-wg="edit" data-id="' + _wgE(g.id) + '">✏️ 고치기</button><button type="button" class="wsc-a dng" data-wg="archive" data-id="' + _wgE(g.id) + '">보관</button>'
          : '<button type="button" class="wsc-a dng" data-wg="leave" data-id="' + _wgE(g.id) + '">빠지기</button>') + '</div>' +
        (g.purpose ? '<div class="wg-p">' + _wgE(g.purpose) + '</div>' : '') +
        '<div class="wg-m">' + g.members.map(function (m) { return '<span class="wg-mc' + (m.id === g.ownerId ? ' lead' : '') + '">' + (m.id === g.ownerId ? '👑 ' : '') + _wgE(m.name) + '</span>'; }).join('') + '</div></div>';
    }).join('') : '<div class="wp-none">아직 그룹이 없습니다 — ＋ 새 그룹으로 TFT · 팀을 묶어 보세요</div>');
}
async function _wgClick(e) {
  var b = e.target.closest('[data-wg]'); if (!b) return;
  var a = b.dataset.wg, id = b.dataset.id, g = (WG.list || []).filter(function (x) { return x.id === id; })[0];
  try {
    if (a === 'new') return wgEdit(null);
    if (a === 'edit') return wgEdit(g);
    if (a === 'room' && g) { var m = document.getElementById('wgModal'); if (m) (m._wmClose ? m._wmClose() : m.remove()); if (typeof setPage === 'function') setPage('messages'); return setTimeout(function () { if (typeof chatOpenRoom === 'function') chatOpenRoom(g.roomId); }, 400); }
    if (a === 'archive') { if (!(await wmConfirm('「' + g.name + '」 그룹을 보관할까요? (대화방은 그대로 남아요)'))) return; await apiFetch('/api/groups/' + encodeURIComponent(id), { method: 'DELETE' }); }
    if (a === 'leave') { if (!(await wmConfirm('「' + g.name + '」 그룹에서 빠질까요? 대화방에서도 나갑니다.'))) return; await apiFetch('/api/groups/' + encodeURIComponent(id) + '/leave', { method: 'POST', body: '{}' }); }
    await wgLoad(true); _wgPaint();
  } catch (err) { _wgToast('처리하지 못했습니다: ' + ((err && err.data && err.data.message) || err.message || err), 'error'); }
}
/* 만들기 · 고치기 */
function wgEdit(g) {
  return wmGuardedModal('wgEdit', function () {
    var load = typeof _wqLoadPeople === 'function' ? _wqLoadPeople() : Promise.resolve([]);
    return load.then(function (people) {
      var me = _wgMe(), pick = {};
      (g ? g.members : []).forEach(function (m) { if (m.id !== me) pick[m.id] = 1; });
      var md = createModal({ id: 'wgEditModal', title: g ? '✏️ 그룹 고치기' : '👥 새 그룹', width: '460px', closeOnEsc: true,
        html: '<div class="wg-ed"><div class="wrq-row"><label class="wrq-f" style="flex:0 0 70px"><span>아이콘</span><input class="wr-inp" id="wgIcon" maxlength="4" value="' + _wgE(g ? g.icon : '👥') + '"></label>' +
          '<label class="wrq-f"><span>그룹 이름</span><input class="wr-inp" id="wgName" maxlength="100" value="' + _wgE(g ? g.name : '') + '" placeholder="예: 2공장 라인 증설 TFT"></label></div>' +
          '<label class="wrq-f"><span>목적 (선택)</span><input class="wr-inp" id="wgPurpose" maxlength="2000" value="' + _wgE(g ? g.purpose : '') + '" placeholder="무엇을 위해 모였는지 한 줄"></label>' +
          '<div class="wrq-f"><span>구성원 <i id="wgN"></i> — 나는 자동으로 들어가요' + (g && g.ownerId !== me ? '' : ' (리더)') + '</span><input class="wr-inp" id="wgQ" placeholder="이름 · 부서로 찾기" autocomplete="off"><div class="wp-list wp-multi"></div></div>' +
          '<div class="wrq-foot"><span style="flex:1"></span><button type="button" class="btn btn-g" data-x>취소</button><button type="button" class="btn btn-p" data-go>' + (g ? '저장' : '만들기') + '</button></div></div>' });
      var box = md.box, list = box.querySelector('.wp-list'), q = box.querySelector('#wgQ');
      var draw = function () {
        var v = q.value.trim().toLowerCase(), cur = null, h = '';
        people.filter(function (p) { return pick[p.id] || !v || [p.name, p.reg, p.nm, p.dept].some(function (x) { return String(x || '').toLowerCase().indexOf(v) >= 0; }); })
          .sort(function (a, b) { return (pick[b.id] ? 1 : 0) - (pick[a.id] ? 1 : 0) || (a.dept ? 0 : 1) - (b.dept ? 0 : 1) || String(a.dept || '').localeCompare(String(b.dept || ''), 'ko') || a.name.localeCompare(b.name, 'ko'); })
          .forEach(function (p) { var d = pick[p.id] ? '✔ 고른 사람' : (p.dept || '부서 없음'); if (d !== cur) { cur = d; h += '<div class="wp-dept">' + (pick[p.id] ? '' : '🏢 ') + _wgE(d) + '</div>'; } h += '<label class="wp-p"><input type="checkbox" data-id="' + _wgE(p.id) + '"' + (pick[p.id] ? ' checked' : '') + '> ' + _wgE(p.name) + '</label>'; });
        list.innerHTML = h || '<div class="wp-none">맞는 사람이 없습니다</div>';
        box.querySelector('#wgN').textContent = (Object.keys(pick).length + 1) + '명';
      };
      q.addEventListener('input', draw);
      list.addEventListener('change', function (e) { var c = e.target.closest('[data-id]'); if (!c) return; if (c.checked) pick[c.dataset.id] = 1; else delete pick[c.dataset.id]; draw(); });
      box.querySelector('[data-x]').onclick = function () { md.close(); };
      box.querySelector('[data-go]').onclick = function () {
        var btn = this, name = box.querySelector('#wgName').value.trim();
        if (!name) { box.querySelector('#wgName').focus(); return _wgToast('그룹 이름을 적으세요.', 'warn'); }
        if (!Object.keys(pick).length) { q.focus(); return _wgToast('구성원을 한 명 이상 고르세요.', 'warn'); }
        btn.disabled = true;
        var body = { name: name, icon: box.querySelector('#wgIcon').value.trim() || '👥', purpose: box.querySelector('#wgPurpose').value.trim(), memberIds: [g ? g.ownerId : me].concat(Object.keys(pick)) };
        apiFetch(g ? '/api/groups/' + encodeURIComponent(g.id) : '/api/groups', { method: g ? 'PUT' : 'POST', body: JSON.stringify(body) }).then(function () {
          md.close();
          _wgToast(g ? '그룹을 고쳤습니다' : '👥 그룹을 만들었어요 — 그룹 대화방도 생겼습니다');
          return wgLoad(true).then(_wgPaint);
        }).catch(function (e) { btn.disabled = false; _wgToast('저장하지 못했습니다: ' + ((e && e.data && e.data.message) || e.message || e), 'error'); });
      };
      draw();
      setTimeout(function () { box.querySelector(g ? '#wgQ' : '#wgName').focus(); }, 0);
    });
  }, 'wgEditModal');
}
/* 로그인 뒤 한 번 받아 둠 — 사람 고르기에서 바로 보이게 */
(function () {
  function start() { if (typeof currentUser === 'undefined' || !currentUser) return setTimeout(start, 2000); wgLoad(); }
  if (typeof document !== 'undefined') setTimeout(start, 2500);
})();
