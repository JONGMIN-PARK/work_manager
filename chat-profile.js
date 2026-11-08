/* chat-profile.js — 💬 메신저 프로필 · 상태 · 링크 미리보기 (v13.378)
 *   ① 프로필 사진: 머리글자 대신 사진 (정사각 256px JPEG, 서버 /api/chat/avatar/:uid?v=) — 처음 한 번 받고 담아 둠
 *   ② 상태: 내가 정한 것(🍚 점심 · 🏃 외근 …, 기한) + 달력 자동(🤝 회의 중 ~15:00 · ✈️ 출장 · 🌴 연차) — 제목은 안 보임
 *   ③ 🔗 링크 미리보기 카드 — 서버가 읽어 붙인 m.link, 사진은 /api/chat/link-img 로 대신 받음
 * chat-ui.js 가 부르는 것: chatAvHtml · chatStatusText · chatLinkHtml · chatLinkImgs · chatProfileModal · chatProfileOnEvent · chatAvatarsLoad
 * 의존: CX, apiFetch, API_BASE, _accessToken, _cxE, _cxHue, _cxInit, _cxToast, createModal, wmGuardedModal */
var CXP = { v: {}, url: {}, loading: {} };

/* ─── ① 프로필 사진 ─── */
function chatAvatarsLoad() {
  if (typeof apiFetch !== 'function') return Promise.resolve();
  return apiFetch('/api/chat/avatars').then(function (r) { CXP.v = (r && r.data) || {}; _cxpRepaintAll(); }).catch(function () {});
}
function _cxpUrl(id, v) {
  var k = id + ':' + v;
  if (CXP.url[k] || CXP.loading[k]) return CXP.url[k] || null;
  CXP.loading[k] = fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/avatar/' + encodeURIComponent(id) + '?v=' + v, { headers: { Authorization: 'Bearer ' + _accessToken } })
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.blob(); })
    .then(function (b) { CXP.url[k] = URL.createObjectURL(b); _cxpPaint(id); })
    .catch(function () {}).then(function () { delete CXP.loading[k]; });
  return null;
}
/** 아바타 HTML — chat-ui _cxAv 가 부름 */
function chatAvHtml(id, name, on, extraCls) {
  var v = id && CXP.v[id], u = v ? _cxpUrl(id, v) : null;
  return '<span class="cx-av' + (u ? ' has-img' : '') + (extraCls ? ' ' + extraCls : '') + '" data-avu="' + _cxE(id || '') + '" style="--h:' + _cxHue(id) + (u ? ';background-image:url(' + u + ')' : '') + '">' + _cxE(_cxInit(name)) + (on ? '<i class="cx-on"></i>' : '') + '</span>';
}
function _cxpPaint(id) {
  var v = CXP.v[id], u = v ? CXP.url[id + ':' + v] : null;
  document.querySelectorAll('.cx-av[data-avu="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]').forEach(function (el) {
    el.classList.toggle('has-img', !!u); el.style.backgroundImage = u ? 'url(' + u + ')' : '';
  });
}
function _cxpRepaintAll() { Object.keys(CXP.v).forEach(function (id) { if (CXP.v[id] && _cxpUrl(id, CXP.v[id])) _cxpPaint(id); }); }

/* ─── ② 상태 ─── */
function _cxpHm(iso) { var d = new Date(iso); return isNaN(d) ? '' : ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
/** 상태 → 짧은 글 (예: "🤝 회의 중 ~15:00") */
function chatStatusText(st, short) {
  if (!st || (!st.icon && !st.label)) return '';
  var until = '';
  if (st.until && !short) {
    if (/^\d\d:\d\d$/.test(st.until)) until = ' ~' + st.until;
    else { var d = new Date(st.until), n = new Date(), hm = _cxpHm(st.until); until = d.toDateString() === n.toDateString() ? (hm === '23:59' ? ' (오늘)' : ' ~' + hm) : ' ~' + (d.getMonth() + 1) + '/' + d.getDate(); }
  }
  return ((st.icon ? st.icon + ' ' : '') + (st.label || '') + until).trim();
}
var CXP_PRESET = [['🍚', '점심 중'], ['🏃', '외근'], ['🏠', '재택'], ['🚗', '이동 중'], ['🎧', '집중 근무'], ['🤒', '병가'], ['☕', '잠깐 자리 비움'], ['📵', '회의 중']];
function chatProfileModal() {
  if (typeof wmGuardedModal !== 'function' || typeof createModal !== 'function') return;
  return wmGuardedModal('chatProfile', function () {
    var me = typeof _cxMe === 'function' ? _cxMe() : null, myName = (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '';
    var m = createModal({ id: 'chatProfModal', title: '🙂 내 프로필 · 상태', width: '440px', closeOnEsc: true, closeOnOverlay: true,
      html: '<div class="cxp"><div class="cxp-top"><div class="cxp-av" data-av>' + chatAvHtml(me, myName, false, 'big') + '</div><div class="cxp-who"><b>' + _cxE(myName) + '</b><span data-now>상태 확인 중…</span>' +
        '<div class="cxp-avb"><button type="button" class="btn btn-g btn-s" data-pick>🖼 사진 고르기</button><button type="button" class="btn btn-g btn-s" data-delav hidden>지우기</button><input type="file" accept="image/*" data-file hidden></div></div></div>' +
        '<div class="cxp-h">상태</div><div class="cxp-pre">' + CXP_PRESET.map(function (p, i) { return '<button type="button" data-pre="' + i + '">' + p[0] + ' ' + _cxE(p[1]) + '</button>'; }).join('') + '</div>' +
        '<div class="cxp-row"><input class="wr-inp cxp-emo" data-emo maxlength="8" placeholder="🙂" aria-label="이모지"><input class="wr-inp" data-text maxlength="60" placeholder="직접 쓰기 — 예: 3시까지 고객사 미팅" aria-label="상태 글"></div>' +
        '<div class="cxp-row"><label for="cxpUntil">언제까지</label><select class="wr-inp" id="cxpUntil" data-until><option value="1h">1시간</option><option value="today" selected>오늘까지</option><option value="week">이번 주까지</option><option value="">지울 때까지</option></select></div>' +
        '<p class="cxp-note">달력에 회의 · 출장 · 연차가 있으면 정한 상태가 없을 때 자동으로 보입니다 (일정 제목은 안 보임).</p>' +
        '<div class="cx-mfoot"><button type="button" class="btn btn-g" data-clear>상태 지우기</button><button type="button" class="wm-pri" data-save>저장</button></div></div>' });
    var box = m.box;
    apiFetch('/api/chat/me/profile').then(function (r) {
      var d = r.data || {};
      box.querySelector('[data-emo]').value = d.emoji || ''; box.querySelector('[data-text]').value = d.text || '';
      box.querySelector('[data-now]').textContent = d.now ? '지금: ' + chatStatusText(d.now) + (d.now.auto ? ' (달력)' : '') : '상태 없음';
      box.querySelector('[data-delav]').hidden = !d.avatarV;
    }).catch(function () {});
    box.querySelectorAll('[data-pre]').forEach(function (b) { b.addEventListener('click', function () { var p = CXP_PRESET[+b.dataset.pre]; box.querySelector('[data-emo]').value = p[0]; box.querySelector('[data-text]').value = p[1]; box.querySelectorAll('[data-pre]').forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
    function untilOf(k) {
      var d = new Date();
      if (k === '1h') return new Date(d.getTime() + 3600000).toISOString();
      if (k === 'today') { d.setHours(23, 59, 0, 0); return d.toISOString(); }
      if (k === 'week') { d.setDate(d.getDate() + (7 - d.getDay()) % 7); d.setHours(23, 59, 0, 0); return d.toISOString(); }
      return null;
    }
    function put(body) {
      return apiFetch('/api/chat/me/status', { method: 'PUT', body: JSON.stringify(body) }).then(function (r) { chatProfileOnEvent('status', { userId: me, status: r.data.status }); return r; });
    }
    box.querySelector('[data-save]').addEventListener('click', function () {
      var emo = box.querySelector('[data-emo]').value.trim(), txt = box.querySelector('[data-text]').value.trim();
      put({ emoji: emo, text: txt, until: (emo || txt) ? untilOf(box.querySelector('[data-until]').value) : null }).then(function () { _cxToast('🙂 상태를 바꿨습니다', 'success'); m.close(); }).catch(function (e) { _cxToast(_cxErr(e), 'error'); });
    });
    box.querySelector('[data-clear]').addEventListener('click', function () { put({ emoji: '', text: '' }).then(function () { _cxToast('상태를 지웠습니다', 'info'); m.close(); }); });
    var fi = box.querySelector('[data-file]');
    box.querySelector('[data-pick]').addEventListener('click', function () { fi.click(); });
    fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0]; fi.value = ''; if (!f) return;
      _cxpSquare(f).then(function (blob) {
        return fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/me/avatar', { method: 'POST', headers: { Authorization: 'Bearer ' + _accessToken, 'Content-Type': 'image/jpeg' }, body: blob }).then(function (res) { return res.json().then(function (j) { if (!res.ok) throw new Error(j.message || '올리지 못했습니다'); return j; }); })
          .then(function (j) { CXP.url[me + ':' + j.data.v] = URL.createObjectURL(blob); CXP.v[me] = j.data.v; _cxpPaint(me); box.querySelector('[data-av]').innerHTML = chatAvHtml(me, myName, false, 'big'); box.querySelector('[data-delav]').hidden = false; _cxToast('🖼 프로필 사진을 바꿨습니다', 'success'); });
      }).catch(function (e) { _cxToast((e && e.message) || '사진을 쓰지 못했습니다', 'error'); });
    });
    box.querySelector('[data-delav]').addEventListener('click', function () {
      apiFetch('/api/chat/me/avatar', { method: 'DELETE' }).then(function () { CXP.v[me] = 0; _cxpPaint(me); box.querySelector('[data-av]').innerHTML = chatAvHtml(me, myName, false, 'big'); box.querySelector('[data-delav]').hidden = true; });
    });
  }, 'chatProfModal');
}
/** 사진 → 가운데 정사각 256px JPEG */
function _cxpSquare(file) {
  var bm = typeof createImageBitmap === 'function' ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); }) : Promise.reject(new Error('이 브라우저는 사진을 줄일 수 없습니다'));
  return bm.then(function (b) {
    var s = Math.min(b.width, b.height), c = document.createElement('canvas'); c.width = c.height = 256;
    var g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
    g.drawImage(b, (b.width - s) / 2, (b.height - s) / 2, s, s, 0, 0, 256, 256);
    return new Promise(function (ok) { c.toBlob(function (x) { ok(x); }, 'image/jpeg', 0.85); });
  });
}
/** 실시간 — 'status' · 'avatar' */
function chatProfileOnEvent(ev, d) {
  if (typeof CX === 'undefined' || !d) return;
  if (ev === 'avatar') { CXP.v[d.userId] = d.v || 0; if (d.v) _cxpUrl(d.userId, d.v); _cxpPaint(d.userId); return; }
  if (ev === 'status') {
    CX.rooms.forEach(function (r) { if (r.peerId === d.userId) r.peerStatus = d.status; });
    if (CX.info) CX.info.members.forEach(function (m) { if (m.id === d.userId) m.status = d.status; });
    if (CX.users) CX.users.forEach(function (u) { if (u.id === d.userId) u.status = d.status; });
    if (typeof _cxDrawRooms === 'function') _cxDrawRooms();
    if (typeof _cxSoon === 'function') { _cxSoon('head', _cxDrawHead); if (CX.aside && !CX.thread) _cxSoon('aside', _cxDrawAside); }
  }
}

/* ─── ③ 링크 미리보기 ─── */
function chatLinkHtml(l) {
  if (!l || !l.url) return '';
  var host = ''; try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch (e) {}
  return '<a class="cx-lk" href="' + _cxE(l.url) + '" target="_blank" rel="noopener noreferrer">' +
    (l.image ? '<span class="cx-lk-img"><img alt="" data-lkimg="' + _cxE(l.image) + '"></span>' : '') +
    '<span class="cx-lk-t"><b>' + _cxE(l.title) + '</b>' + (l.desc ? '<i>' + _cxE(l.desc) + '</i>' : '') + '<em>🔗 ' + _cxE(l.site || host) + '</em></span></a>';
}
var _cxpLk = {};
function chatLinkImgs(root) {
  root.querySelectorAll('img[data-lkimg]').forEach(function (img) {
    var u = img.dataset.lkimg; img.removeAttribute('data-lkimg');
    var p = _cxpLk[u] || (_cxpLk[u] = fetch((typeof API_BASE !== 'undefined' ? API_BASE : '') + '/api/chat/link-img?u=' + encodeURIComponent(u), { headers: { Authorization: 'Bearer ' + _accessToken } })
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res.blob(); }).then(function (b) { return URL.createObjectURL(b); }));
    p.then(function (src) { img.src = src; }).catch(function () { var w = img.closest('.cx-lk-img'); if (w) w.remove(); delete _cxpLk[u]; });
  });
}

if (typeof window !== 'undefined') {
  window.chatAvHtml = chatAvHtml; window.chatStatusText = chatStatusText; window.chatProfileModal = chatProfileModal; window.chatProfileOnEvent = chatProfileOnEvent;
  window.chatLinkHtml = chatLinkHtml; window.chatLinkImgs = chatLinkImgs; window.chatAvatarsLoad = chatAvatarsLoad;
}
