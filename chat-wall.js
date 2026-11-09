/* chat-wall.js — 🎨 대화방 배경 화면 (v13.396)
 * 템플릿 20가지(기본 · 색 · 그라데이션 · 무늬) + 📷 내 사진. 모든 방 기본값 + 방마다 따로.
 * 템플릿은 모두 테마 바탕색(var(--bg))에 섞어 만들어 밝은 · 어두운 테마 어디서나 말풍선 글자가 읽힘.
 * 저장은 이 기기(localStorage, 사람마다 열쇠) — 사진은 긴 변 1600px JPEG 로 줄여서. */
var CXW_TPL = [
  // 기본
  { k: 'dots', g: '기본', n: '점 (기본)', bg: '' },
  { k: 'plain', g: '기본', n: '단색', bg: 'var(--bg)' },
  // 색 — 바탕에 살짝 물들임
  { k: 'sky', g: '색', n: '하늘', c: '#38BDF8' },
  { k: 'mint', g: '색', n: '민트', c: '#34D399' },
  { k: 'lavender', g: '색', n: '라벤더', c: '#A78BFA' },
  { k: 'peach', g: '색', n: '복숭아', c: '#FB923C' },
  { k: 'lemon', g: '색', n: '레몬', c: '#FACC15' },
  { k: 'rose', g: '색', n: '장미', c: '#F472B6' },
  { k: 'gray', g: '색', n: '회색', c: '#64748B' },
  // 그라데이션
  { k: 'sunset', g: '그라데이션', n: '노을', c2: ['#FB923C', '#F472B6', '#A78BFA'] },
  { k: 'ocean', g: '그라데이션', n: '바다', c2: ['#38BDF8', '#22D3EE', '#34D399'] },
  { k: 'aurora', g: '그라데이션', n: '오로라', c2: ['#34D399', '#22D3EE', '#8B5CF6'] },
  { k: 'dawn', g: '그라데이션', n: '새벽', c2: ['#6366F1', '#A78BFA', '#F9A8D4'] },
  // 무늬
  { k: 'grid', g: '무늬', n: '모눈', bg: 'linear-gradient(var(--cxw-l) 1px,transparent 1px) 0 0/24px 24px,linear-gradient(90deg,var(--cxw-l) 1px,transparent 1px) 0 0/24px 24px,var(--bg)' },
  { k: 'ruled', g: '무늬', n: '줄 노트', bg: 'linear-gradient(transparent 27px,var(--cxw-l) 28px) 0 0/100% 28px,linear-gradient(90deg,transparent 46px,color-mix(in srgb,#F87171 35%,transparent) 47px,transparent 48px),var(--bg)' },
  { k: 'diag', g: '무늬', n: '빗금', bg: 'repeating-linear-gradient(45deg,var(--cxw-l) 0 1px,transparent 1px 14px),var(--bg)' },
  { k: 'check', g: '무늬', n: '체크', bg: 'conic-gradient(var(--cxw-f) 25%,transparent 0 50%,var(--cxw-f) 0 75%,transparent 0) 0 0/36px 36px,var(--bg)' },
  { k: 'wave', g: '무늬', n: '물결', bg: 'radial-gradient(circle at 50% 100%,transparent 9px,var(--cxw-l) 10px,transparent 11px) 0 0/28px 14px,var(--bg)' },
  { k: 'stars', g: '무늬', n: '별밤', bg: 'radial-gradient(1.4px 1.4px at 20px 30px,var(--cxw-s),transparent) 0 0/200px 170px,radial-gradient(1px 1px at 90px 70px,var(--cxw-s),transparent) 0 0/200px 170px,radial-gradient(1.6px 1.6px at 150px 20px,var(--cxw-s),transparent) 0 0/200px 170px,radial-gradient(1px 1px at 60px 140px,var(--cxw-s),transparent) 0 0/200px 170px,radial-gradient(1.3px 1.3px at 170px 120px,var(--cxw-s),transparent) 0 0/200px 170px,radial-gradient(0.9px 0.9px at 115px 105px,var(--cxw-s),transparent) 0 0/200px 170px,radial-gradient(1.1px 1.1px at 35px 95px,var(--cxw-s),transparent) 0 0/200px 170px,radial-gradient(0.9px 0.9px at 185px 60px,var(--cxw-s),transparent) 0 0/200px 170px,radial-gradient(1px 1px at 40px 50px,color-mix(in srgb,var(--cxw-s) 60%,transparent),transparent) 0 0/260px 230px,radial-gradient(1.2px 1.2px at 130px 160px,color-mix(in srgb,var(--cxw-s) 60%,transparent),transparent) 0 0/260px 230px,radial-gradient(0.9px 0.9px at 220px 90px,color-mix(in srgb,var(--cxw-s) 60%,transparent),transparent) 0 0/260px 230px,linear-gradient(180deg,color-mix(in srgb,var(--bg) 88%,#312E81),var(--bg))' },
  { k: 'bigdots', g: '무늬', n: '큰 점', bg: 'radial-gradient(var(--cxw-f2) 2.6px,transparent 3.2px) 0 0/26px 26px,radial-gradient(var(--cxw-f2) 2.6px,transparent 3.2px) 13px 13px/26px 26px,var(--bg)' },
  // 사진
  { k: 'photo', g: '사진', n: '📷 내 사진' }
];
var CXW = { s: null };
function _cxwKey() { return 'wm-cx-wall:' + ((typeof _cxMe === 'function' && _cxMe()) || 'me'); }
function _cxwGet() {
  if (CXW.s) return CXW.s;
  var s = null; try { s = JSON.parse(localStorage.getItem(_cxwKey()) || 'null'); } catch (e) {}
  CXW.s = s && typeof s === 'object' ? s : {};
  if (!CXW.s.rooms) CXW.s.rooms = {};
  if (CXW.s.dim == null) CXW.s.dim = 35;
  if (CXW.s.depth == null) CXW.s.depth = 1;   // v13.399 💎 입체감 0 끄기 · 1 은은하게 · 2 또렷하게
  return CXW.s;
}
function _cxwSave() {
  try { localStorage.setItem(_cxwKey(), JSON.stringify(CXW.s)); return true; }
  catch (e) { if (typeof _cxToast === 'function') _cxToast('⚠ 이 기기에 저장할 자리가 모자랍니다 — 사진을 더 작은 것으로 골라 주세요', 'warn'); return false; }
}
/** 템플릿 → background 값 ('' 이면 CSS 기본 점) */
function chatWallCss(k, s) {
  s = s || _cxwGet();
  var t = CXW_TPL.filter(function (x) { return x.k === k; })[0];
  if (!t) return '';
  if (t.k === 'photo') {
    if (!s.photo) return '';
    var d = Math.max(0, Math.min(85, +s.dim || 0));
    return 'linear-gradient(color-mix(in srgb,var(--bg) ' + d + '%,transparent),color-mix(in srgb,var(--bg) ' + d + '%,transparent)),url("' + s.photo + '") center/cover no-repeat,var(--bg)';
  }
  if (t.c) return 'linear-gradient(180deg,color-mix(in srgb,var(--bg) 86%,' + t.c + '),color-mix(in srgb,var(--bg) 80%,' + t.c + '))';
  if (t.c2) return 'linear-gradient(160deg,' + t.c2.map(function (c, i) { return 'color-mix(in srgb,var(--bg) ' + (i === 1 ? 80 : 84) + '%,' + c + ')'; }).join(',') + ')';
  return t.bg;
}
/** 이 방에 걸 배경 열쇠 — 방 따로 > 모든 방 > 기본 */
function chatWallFor(room) { var s = _cxwGet(); return (room && s.rooms[room]) || s.all || 'dots'; }
/** 대화 칸에 입힘 — _cxDrawMain 뒤 · 고른 뒤 */
function chatWallApply() {
  document.documentElement.setAttribute('data-cx-depth', String(_cxwGet().depth));
  var m = document.getElementById('cxMain'); if (!m) return;
  var k = (typeof CX !== 'undefined' && CX.room) ? chatWallFor(CX.room) : 'dots';
  var css = chatWallCss(k);
  m.style.background = css;
  if (css && k !== 'dots') m.setAttribute('data-wall', k); else m.removeAttribute('data-wall');
}
/* 사진 줄이기 — 긴 변 1600px · JPEG 0.82 */
function _cxwShrink(file) {
  return new Promise(function (ok, no) {
    if (!/^image\//.test(file.type || '')) return no(new Error('사진 파일만 됩니다'));
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = function () { URL.revokeObjectURL(url); no(new Error('사진을 읽지 못했습니다')); };
    img.src = url;
  });
}

/** 🎨 배경 고르기 창 — scopeRoom 이 있으면 '이 방만' 으로 시작 */
function chatWallModal(scopeRoom) {
  if (typeof wmGuardedModal !== 'function' || typeof createModal !== 'function') return;
  return wmGuardedModal('chatWall', function () {
    var s = _cxwGet(), room = (typeof CX !== 'undefined' && CX.room) || null;
    var scope = scopeRoom && room ? 'room' : 'all';
    var groups = [];
    CXW_TPL.forEach(function (t) { if (groups.indexOf(t.g) < 0) groups.push(t.g); });
    var m = createModal({ id: 'chatWallModal', title: '🎨 대화방 배경', width: '560px', closeOnEsc: true, closeOnOverlay: true,
      html: '<p class="cxw-hint">아래에서 고르면 위 미리보기와 대화방에 바로 바뀝니다 — 닫으면 끝. <b>이 방만</b> 고르면 이 방에만, <b>모든 방</b>은 따로 안 정한 방 전부에.</p>' +
        '<div class="cxw-live" data-live><span class="cxw-b">안녕하세요 👋</span><span class="cxw-b me">내일 회의 10시 맞죠?</span><span class="cxw-b me">자료 올려 둘게요 ✅</span></div>' +
        '<div class="cxw-depth">💎 말풍선 입체감 <span class="cxw-scope" role="radiogroup">' + ['끄기', '은은하게', '또렷하게'].map(function (n, i) { return '<button type="button" data-depth="' + i + '">' + n + '</button>'; }).join('') + '</span></div>' +
        '<div class="cxw-scope" role="radiogroup">' +
          (room ? '<button type="button" data-scope="room">이 방만</button>' : '') + '<button type="button" data-scope="all">모든 방 (기본)</button></div>' +
        '<div class="cxw-body">' + groups.map(function (g) {
          return '<div class="cxw-g"><b>' + g + '</b><div class="cxw-grid">' + CXW_TPL.filter(function (t) { return t.g === g; }).map(function (t) {
            return '<button type="button" class="cxw-sw" data-k="' + t.k + '" title="' + t.n + '"><span class="cxw-pv" data-pv="' + t.k + '"><i></i><i class="me"></i></span><em>' + t.n + '</em></button>';
          }).join('') + '</div></div>';
        }).join('') + '</div>' +
        '<div class="cxw-photo"><input type="file" accept="image/*" hidden data-file><button type="button" class="cxw-btn" data-up>📷 사진 고르기</button>' +
          '<label data-dimw>흐리게 <input type="range" min="0" max="85" step="5" data-dim> <span data-dimv></span></label></div>' +
        '<div class="cx-mfoot"><span class="cxp-note">이 기기에 저장됩니다 · 템플릿은 테마 색에 맞춰 바뀝니다</span><button type="button" class="cxw-btn" data-reset>기본으로</button></div>' });
    var box = m.box;
    function cur() { return scope === 'room' ? (s.rooms[room] || s.all || 'dots') : (s.all || 'dots'); }
    function paint() {
      box.querySelectorAll('[data-depth]').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-depth') === s.depth); });
      box.querySelectorAll('[data-scope]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-scope') === scope); b.setAttribute('aria-checked', b.getAttribute('data-scope') === scope); });
      var k = cur();
      box.querySelectorAll('.cxw-sw').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-k') === k); });
      box.querySelectorAll('[data-pv]').forEach(function (p) {
        var kk = p.getAttribute('data-pv'), css = chatWallCss(kk, s);
        p.style.background = css || '';
        p.classList.toggle('is-dots', !css && kk === 'dots');
        p.classList.toggle('is-empty', kk === 'photo' && !s.photo);
      });
      box.querySelector('[data-dimw]').hidden = !s.photo;
      box.querySelector('[data-dim]').value = s.dim;
      box.querySelector('[data-dimv]').textContent = s.dim + '%';
      var lv = box.querySelector('[data-live]'), lc = chatWallCss(k, s); lv.style.background = lc || ''; lv.classList.toggle('is-dots', !lc);
      chatWallApply();
    }
    function pick(k) {
      if (scope === 'room') { if (k === (s.all || 'dots')) delete s.rooms[room]; else s.rooms[room] = k; }
      else s.all = k;
      _cxwSave(); paint();
    }
    box.addEventListener('click', function (e) {
      var dp = e.target.closest('[data-depth]'); if (dp) { s.depth = +dp.getAttribute('data-depth'); _cxwSave(); paint(); return; }
      var sc = e.target.closest('[data-scope]'); if (sc) { scope = sc.getAttribute('data-scope'); paint(); return; }
      var sw = e.target.closest('.cxw-sw');
      if (sw) { var k = sw.getAttribute('data-k'); if (k === 'photo' && !s.photo) { box.querySelector('[data-file]').click(); return; } pick(k); return; }
      if (e.target.closest('[data-up]')) { box.querySelector('[data-file]').click(); return; }
      if (e.target.closest('[data-reset]')) { if (scope === 'room') delete s.rooms[room]; else s.all = 'dots'; _cxwSave(); paint(); }
    });
    box.querySelector('[data-file]').addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      _cxwShrink(f).then(function (url) {
        var old = s.photo; s.photo = url;
        if (!_cxwSave()) { s.photo = old; return; }
        pick('photo');
      }).catch(function (err) { if (typeof _cxToast === 'function') _cxToast('❌ ' + err.message, 'error'); });
    });
    box.querySelector('[data-dim]').addEventListener('input', function () { s.dim = +this.value; paint(); });
    box.querySelector('[data-dim]').addEventListener('change', function () { _cxwSave(); });
    paint();
    return m;
  }, 'chatWallModal');
}
if (typeof window !== 'undefined') { window.chatWallModal = chatWallModal; window.chatWallApply = chatWallApply; }
