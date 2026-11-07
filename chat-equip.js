/**
 * chat-equip.js — 🏭 장비 단위 연결 (v13.365)
 *   장비 카드: 장비 마스터(A/S 장비 · 시리얼 · 모델 · 고객 · 라인 · 보증) + 글에 적힌 장비 이름
 *   → 🛠 요청 · 🔧 A/S 이력 · 📝 공동 문서 · 🖼 사진 · 💬 언급 · 💬 장비 방(장비마다 하나)
 *   들어가는 곳: 🗂 모아 보기 '🏭 장비' 탭 · 요청 카드의 🏭 이름 누르기 · 장비 방 옆 칸 '🏭 장비' 탭 · 글쓰기 장비 칸 고르기
 *   chat-ui · chat-collab 가 부르는 것: chatEquipOpen · chatEquipList · chatEquipAside · chatEquipKeyOf · chatEquipSuggest
 */
var CE = { key: null, q: '', list: null, map: {} };
function _ceE(s) { return typeof _cxE === 'function' ? _cxE(s) : String(s == null ? '' : s); }
function _ceToast(m, t) { if (typeof showToast === 'function') showToast(m, t); }
function _ceErr(e) { return (e && e.data && e.data.message) || (e && e.message) || '실패했습니다'; }
function chatEquipKeyOf(p) { return p.equipId ? 'm:' + p.equipId : p.equip ? 'n:' + String(p.equip).trim().replace(/\s+/g, ' ').toLowerCase() : ''; }
function chatEquipOpen(key) {
  CE.key = key;
  if (document.getElementById('cxLib') && typeof _ccLibDraw === 'function') { CC.libTab = 'equip'; _ccLibDraw(); return; }   // 모아 보기가 열려 있으면 탭만
  if (typeof chatLibrary === 'function') chatLibrary('equip');
}
var CE_AS = { received: '접수', assigned: '배정', in_progress: '진행 중', reporting: '보고서', approved: '승인', customer_wait: '고객 대기', closed: '종결', hold: '보류', cancelled: '취소' };

/* ─── 🗂 모아 보기 '🏭 장비' 탭 ─── */
function chatEquipList(box) {
  box.innerHTML = '<div class="ce-v"><aside class="ce-l"><input type="search" data-q placeholder="장비 · 시리얼 · 고객 · 라인 찾기" value="' + _ceE(CE.q) + '"><div data-list><div class="cx-loading">불러오는 중…</div></div></aside><section class="ce-r" data-card><div class="cx-empty">왼쪽에서 장비를 고르세요<br><small>요청 글에 장비를 적거나 A/S 장비 마스터에 있는 장비가 여기 모입니다</small></div></section></div>';
  var t;
  box.querySelector('[data-q]').addEventListener('input', function (e) { CE.q = e.target.value.trim(); clearTimeout(t); t = setTimeout(function () { _ceLoadList(box); }, 250); });
  _ceLoadList(box);
  if (CE.key) _ceLoadCard(box.querySelector('[data-card]'), CE.key);
}
function _ceLoadList(box) {
  apiFetch('/api/chat/equipment' + (CE.q ? '?q=' + encodeURIComponent(CE.q) : '')).then(function (r) {
    var l = box.querySelector('[data-list]'); if (!l) return;
    var xs = (r && r.data) || [];
    l.innerHTML = xs.length ? xs.map(function (x) {
      return '<button type="button" class="ce-it' + (x.key === CE.key ? ' on' : '') + '" data-key="' + _ceE(x.key) + '"><b>' + (x.type === 'master' ? '🏭 ' : '🔩 ') + _ceE(x.label) + '</b><i>' + _ceE(x.sub || '') + '</i>' +
        (x.open ? '<em>' + x.open + '</em>' : '') + '</button>';
    }).join('') : '<div class="cx-empty">맞는 장비가 없습니다</div>';
    l.querySelectorAll('[data-key]').forEach(function (b) { b.onclick = function () { CE.key = b.dataset.key; l.querySelectorAll('.ce-it').forEach(function (x) { x.classList.toggle('on', x === b); }); _ceLoadCard(box.querySelector('[data-card]'), CE.key); }; });
  }).catch(function () {});
}
function _ceLoadCard(host, key, compact) {
  if (!host) return;
  host.innerHTML = '<div class="cx-loading">불러오는 중…</div>';
  apiFetch('/api/chat/equipment/card?key=' + encodeURIComponent(key)).then(function (r) { CE.card = r.data; host.innerHTML = _ceCardHtml(r.data, compact); _ceBind(host, r.data); })
    .catch(function (e) { host.innerHTML = '<div class="cx-empty">' + _ceE(_ceErr(e)) + '</div>'; });
}
function _ceCardHtml(d, compact) {
  var m = d.master, openReq = d.requests.filter(function (x) { return x.post.status !== 'done' && x.post.status !== 'solved'; });
  var asOpen = d.as.filter(function (a) { return ['closed', 'cancelled'].indexOf(a.status) < 0; });
  var w = m && m.warranty ? '<em class="ce-w ' + (/보증내/.test(m.warranty) ? 'in' : /종료/.test(m.warranty) ? 'out' : '') + '">' + _ceE(m.warranty) + '</em>' : '';
  var sec = function (icon, title, n, body, empty) { return '<section class="ce-sec"><h4>' + icon + ' ' + title + ' <i>' + n + '</i></h4>' + (n ? body : '<div class="ce-empty">' + empty + '</div>') + '</section>'; };
  return '<div class="ce-card' + (compact ? ' compact' : '') + '">' +
    '<div class="ce-h"><div class="ce-t"><b>🏭 ' + _ceE(d.label) + '</b>' + w + '<span>' + (m ? _ceE([m.model, m.serial && 'S/N ' + m.serial, m.no && 'Prj ' + m.no, m.customer, m.line].filter(Boolean).join(' · ')) : '글에 적힌 장비 이름으로 모았습니다') + '</span></div>' +
      '<div class="ce-a"><button type="button" class="btn btn-p btn-s" data-room>' + (d.room ? (d.room.mine ? '💬 장비 방 열기' : '💬 장비 방 들어가기') : '💬 장비 방 만들기') + '</button><button type="button" class="btn btn-g btn-s" data-newreq>✍️ 이 장비 요청</button></div></div>' +
    '<div class="ce-stats"><span><b>' + openReq.length + '</b> 남은 요청</span><span><b>' + d.requests.length + '</b> 전체 요청</span><span><b>' + asOpen.length + '</b>/' + d.as.length + ' A/S 진행</span><span><b>' + d.docs.length + '</b> 문서</span><span><b>' + d.photos.length + '</b> 사진</span></div>' +
    sec('🛠', '요청', d.requests.length, '<div class="ce-reqs">' + d.requests.slice(0, compact ? 6 : 20).map(function (x) { return typeof chatPostHtml === 'function' ? chatPostHtml(x, { room: x.roomName, compact: true }) : ''; }).join('') + '</div>', '이 장비 요청이 없습니다') +
    sec('🔧', 'A/S 이력', d.as.length, d.as.slice(0, 12).map(function (a) { return '<button type="button" class="ce-row" data-as="' + _ceE(a.id) + '"><span class="ce-no">' + _ceE(a.no) + '</span><span class="ce-sum">' + _ceE(a.summary) + '</span><em class="ce-st st-' + _ceE(a.status) + '">' + _ceE(CE_AS[a.status] || a.status) + '</em><i>' + (a.at ? new Date(a.at).toLocaleDateString() : '') + '</i></button>'; }).join(''), 'A/S 기록이 없습니다') +
    sec('📝', '공동 문서', d.docs.length, d.docs.map(function (x) { return '<button type="button" class="ce-row" data-doc="' + _ceE(x.id) + '"><span class="ce-sum">📝 ' + _ceE(x.title) + '</span><i>' + _ceE(x.roomName) + '</i></button>'; }).join(''), '장비 이름이 들어간 문서가 없습니다') +
    sec('🖼', '사진', d.photos.length, '<div class="ce-ph">' + d.photos.map(function (x) { return '<button type="button" data-ph="' + _ceE(x.file.id) + '" data-room="' + _ceE(x.roomId) + '" data-name="' + _ceE(x.file.name) + '"><img alt="" data-blob="' + _ceE(x.file.id) + '"></button>'; }).join('') + '</div>', '요청 댓글이나 장비 이름이 적힌 사진이 여기 모입니다') +
    (compact ? '' : sec('💬', '언급', d.mentions.length, d.mentions.map(function (x) { return '<button type="button" class="ce-row" data-msg="' + x.id + '" data-room="' + _ceE(x.roomId) + '"><span class="ce-sum">' + _ceE(x.userName || '') + ': ' + _ceE(String(x.body || '').slice(0, 100)) + '</span><i>' + _ceE(x.roomName || '') + '</i></button>'; }).join(''), '대화에서 이 장비 이름이 나온 적이 없습니다')) +
    '</div>';
}
function _ceBind(host, d) {
  host.querySelectorAll('img[data-blob]').forEach(function (img) { var id = img.dataset.blob; img.removeAttribute('data-blob'); if (typeof _cxBlob === 'function') _cxBlob(id).then(function (u) { img.src = u; }).catch(function () {}); });
  host.onclick = function (e) {
    var t = e.target;
    function closeLib() { var lib = document.getElementById('cxLib'); if (lib) { var ov = lib.closest('.wa-modal-overlay'); if (ov) ov.remove(); } }
    if (t.closest('[data-room]') && t.closest('.ce-a')) { _ceRoom(d.key).then(function (id) { if (id) { closeLib(); chatOpenRoom(id); } }); return; }
    if (t.closest('[data-newreq]')) {
      _ceRoom(d.key).then(function (id) {
        if (!id) return; closeLib(); CE.prefill = { equip: d.label, equipId: d.master ? d.master.id : null };
        chatOpenRoom(id);
        var tries = 0; (function w() { if (CX.room === id && CX.info) { chatPostModal(); } else if (++tries < 40) setTimeout(w, 150); })();
      });
      return;
    }
    var as = t.closest('[data-as]'); if (as) { closeLib(); if (typeof globalSearchNav === 'function') globalSearchNav('as', { id: as.dataset.as, nav: { ticketId: as.dataset.as } }, ''); return; }
    var doc = t.closest('[data-doc]'); if (doc && typeof chatDocOpen === 'function') { chatDocOpen(doc.dataset.doc); return; }
    var ph = t.closest('[data-ph]'); if (ph && typeof chatBoardOpen === 'function') { chatBoardOpen(ph.dataset.ph, ph.dataset.name, ph.dataset.room); return; }
    var mg = t.closest('[data-msg]'); if (mg) { closeLib(); chatOpenRoom(mg.dataset.room, false, +mg.dataset.msg); return; }
  };
}
function _ceRoom(key) {
  return apiFetch('/api/chat/equipment/room', { method: 'POST', body: JSON.stringify({ key: key }) }).then(function (r) {
    if (r.data.created) _ceToast('💬 장비 방을 만들었습니다' + (r.data.members > 1 ? ' — 이 장비 요청을 올리거나 맡은 ' + (r.data.members - 1) + '명도 함께' : ''), 'success');
    return r.data.id;
  }).catch(function (e) { _ceToast(_ceErr(e), 'error'); return null; });
}

/* ─── 장비 방 옆 칸 '🏭 장비' 탭 ─── */
function chatEquipAside(box) { if (typeof CX !== 'undefined' && CX.info && CX.info.equipKey) _ceLoadCard(box, CX.info.equipKey, true); }

/* ─── 글쓰기 장비 칸 — 장비 마스터 · 쓰던 이름 고르기 ─── */
function chatEquipSuggest(input) {
  if (!input || input._ce) return;
  input._ce = true;
  var dl = document.createElement('datalist'); dl.id = 'ceDl' + Date.now(); input.setAttribute('list', dl.id); input.parentNode.appendChild(dl);
  var t;
  function load() {
    apiFetch('/api/chat/equipment' + (input.value.trim() ? '?q=' + encodeURIComponent(input.value.trim()) : '')).then(function (r) {
      (r.data || []).forEach(function (x) { CE.map[x.label] = x; });
      dl.innerHTML = (r.data || []).slice(0, 30).map(function (x) { return '<option value="' + _ceE(x.label) + '">' + _ceE(x.sub || '') + '</option>'; }).join('');
    }).catch(function () {});
  }
  input.addEventListener('focus', load);
  input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(load, 250); });
  if (CE.prefill) { input.value = CE.prefill.equip; if (CE.prefill.equipId) CE.map[CE.prefill.equip] = { key: 'm:' + CE.prefill.equipId, type: 'master' }; CE.prefill = null; }
}
/** 장비 칸 값 → 장비 마스터 id (고른 것이면) */
function chatEquipIdOf(label) { var x = CE.map[String(label || '').trim()]; return x && x.type === 'master' ? x.key.slice(2) : null; }

/* 요청 카드의 🏭 이름 누르면 장비 카드 */
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-equip]'); if (!b) return;
  e.stopPropagation(); e.preventDefault();
  chatEquipOpen(b.dataset.equip);
}, true);

if (typeof window !== 'undefined') { window.chatEquipOpen = chatEquipOpen; window.chatEquipList = chatEquipList; window.chatEquipAside = chatEquipAside; window.chatEquipKeyOf = chatEquipKeyOf; window.chatEquipSuggest = chatEquipSuggest; window.chatEquipIdOf = chatEquipIdOf; }
