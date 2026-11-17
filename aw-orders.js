/* aw-orders.js — 🔄 애니웍스 수주 가져오기 (v13.513)
 *   PC 앱이 애니웍스 수주번호 조회 창에서 전체 목록(수주번호 · 거래처명 · 프로젝트명)을 훑어 오고,
 *   수주 대장과 견줘 「새 수주」 와 「내용이 다른 수주」 를 보여 준다. 고른 것만 넣는다 (다른 것은 물어본 뒤에).
 *   · 로그인하면 한 번 조용히 확인 — 새로 생기거나 달라진 것이 있을 때만 창이 뜬다 (하루 한 번 · 끌 수 있음)
 *   · 수주일 · 금액 · 담당 · 납기는 애니웍스 조회에 없어서 건드리지 않는다. 프로젝트도 만들지 않는다.
 *   · 수주를 고칠 수 있는 사람(관리자 · 매니저 · 임원) + PC 앱에서만.
 *   전역 이름: awo* / _awo* / AWO_*  ·  화면 클래스: .awo-* (style.css)
 */
var AWO_SHOW = 400;                 // 한 번에 그리는 줄 수 (그 이상은 검색으로 좁힘)
var AWO_KEY_SKIP = 'wm_awo_skip', AWO_KEY_AUTO = 'wm_awo_auto', AWO_KEY_DAY = 'wm_awo_day';
var _awo = null, _awoBusy = false;

function _awoDesk() { return (window.wmDesktop && typeof window.wmDesktop.aw === 'function') ? window.wmDesktop.aw : null; }
function awoCan() {
  var u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  return !!(_awoDesk() && u && ['admin', 'manager', 'executive'].indexOf(u.role) >= 0);
}
function _awoN(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
function _awoLs(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }
function _awoLsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
function _awoSkip() { try { return JSON.parse(_awoLs(AWO_KEY_SKIP, '{}')) || {}; } catch (_) { return {}; } }
function _awoSig(r) { return r.name + '\u0001' + r.client; }
function _awoToday() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function awoAutoOn() { return _awoLs(AWO_KEY_AUTO, '1') !== '0'; }

/* 애니웍스 목록 ↔ 수주 대장 견주기 → { total, same, add:[…], diff:[…] } */
function _awoCompare(rows, orders) {
  var db = {}, seen = {}, skip = _awoSkip(), out = { total: 0, same: 0, add: [], diff: [] };
  (orders || []).forEach(function (o) { db[_awoN(o.orderNo)] = o; });
  (rows || []).forEach(function (x) {
    var r = { no: _awoN(x.orderno), client: _awoN(x.client), name: _awoN(x.name) };
    if (!r.no || seen[r.no]) return;          // 애니웍스에 같은 번호가 두 줄이면 첫 줄만
    seen[r.no] = true; out.total++;
    r.skipped = skip[r.no] === _awoSig(r);    // 지난번에 "안 넣음" 으로 넘긴 것 (애니웍스 내용이 그대로일 때만)
    var o = db[r.no];
    if (!o) { r.on = !r.skipped; out.add.push(r); return; }
    var on = _awoN(o.name), oc = _awoN(o.client);
    // 애니웍스 쪽이 빈 칸이면 다른 것으로 치지 않는다 (있는 값을 지우지 않게)
    var dn = !!r.name && r.name !== on, dc = !!r.client && r.client !== oc;
    if (!dn && !dc) { out.same++; return; }
    r.cur = { name: on, client: oc }; r.dn = dn; r.dc = dc;
    r.fill = (!dn || !on) && (!dc || !oc);    // 빈 칸만 채우는 것 → 기본 선택. 다른 값을 덮는 것은 물어본다(기본 해제)
    r.on = r.fill && !r.skipped;
    out.diff.push(r);
  });
  return out;
}

/* 훑기. opt.auto = 로그인 뒤 조용히 (새 것 · 달라진 것이 없으면 아무것도 안 띄움) */
async function awoScan(opt) {
  opt = opt || {};
  var desk = _awoDesk(), auto = !!opt.auto, say = function (m, t) { if (!auto && typeof showToast === 'function') showToast(m, t || 'warn'); };
  if (!desk) { say('애니웍스 수주 가져오기는 PC 앱(업무 관리자)에서 됩니다'); return null; }
  if (!awoCan()) { say('수주를 고칠 수 있는 사람(관리자 · 매니저 · 임원)만 쓸 수 있습니다'); return null; }
  if (_awoBusy || _awo) return null;
  _awoBusy = true;
  try {
    var st = await desk('status');
    if (!st || !st.ok || !st.hasCred) { if (!auto) { say('먼저 애니웍스 계정을 연결해 주세요'); if (typeof awgAcctOpen === 'function') awgAcctOpen(); } return null; }
    if (!auto) say('🔄 애니웍스에서 수주 목록을 훑는 중…', 'info');
    var rs = await Promise.all([desk('scan'), orderGetAll()]);
    var r = rs[0];
    if (!r || !r.ok) {
      if (r && r.code === 'BAD') say('PC 앱이 예전 버전입니다 — 새 버전으로 올린 뒤 다시 해 주세요');
      else { say('❌ ' + ((r && r.error) || '애니웍스에서 가져오지 못했습니다'), 'error'); if (!auto && r && r.code === 'LOGIN' && typeof awgAcctOpen === 'function') awgAcctOpen(); }
      return null;
    }
    var cmp = _awoCompare(r.rows, rs[1]);
    var fresh = cmp.add.filter(function (x) { return !x.skipped; }).length + cmp.diff.filter(function (x) { return !x.skipped; }).length;
    if (auto) { _awoLsSet(AWO_KEY_DAY, _awoToday()); if (!fresh) return cmp; }
    else if (!cmp.add.length && !cmp.diff.length) { say('✅ 애니웍스 수주 ' + cmp.total + '건 — 수주 대장과 모두 같습니다', 'success'); return cmp; }
    _awoBusy = false;
    awoOpen(cmp, auto);
    return cmp;
  } catch (e) { say('❌ ' + ((e && e.message) || '실패했습니다'), 'error'); return null; }
  finally { _awoBusy = false; }
}

function awoOpen(cmp, auto) {
  var build = function () { return _awoBuild(cmp, auto); };
  return typeof wmGuardedModal === 'function' ? wmGuardedModal('awo', build, 'awoBox') : build();
}
function _awoBuild(cmp, auto) {
  var m = createModal({ id: 'awoModal', title: '🔄 애니웍스 수주 가져오기', width: '980px', boxStyle: 'padding:18px 20px', onClose: function () { _awo = null; } });
  var el = document.createElement('div'); el.id = 'awoBox'; el.className = 'awg awo';
  m.box.appendChild(el);
  // 자동으로 떴을 때는 지난번에 넘긴 것을 빼고 보여 준다 (직접 눌렀을 때는 전부)
  var keep = function (x) { return !auto || !x.skipped; };
  _awo = { el: el, m: m, cmp: cmp, auto: auto, tab: cmp.add.filter(keep).length ? 'add' : 'diff', q: '', add: cmp.add.filter(keep), diff: cmp.diff.filter(keep), busy: false };
  _awoBind(el);
  _awoPaint();
}
function _awoList() { var s = _awo, q = s.q.toLowerCase(), l = s[s.tab]; return q ? l.filter(function (r) { return (r.no + ' ' + r.name + ' ' + r.client).toLowerCase().indexOf(q) >= 0; }) : l; }
function _awoRowHtml(r, tab) {
  var h = '<label class="awo-r' + (r.on ? ' on' : '') + '"><input type="checkbox" data-no="' + eH(r.no) + '"' + (r.on ? ' checked' : '') + '><b>' + eH(r.no) + '</b>';
  if (tab === 'add') return h + '<span class="awo-nm">' + eH(r.name || '(이름 없음)') + '</span><span class="awo-cl">' + eH(r.client) + '</span></label>';
  var line = function (lbl, cur, aw, diff) { return diff ? '<span class="awo-df"><i>' + lbl + '</i><s>' + eH(cur || '(비어 있음)') + '</s> → <em>' + eH(aw) + '</em></span>' : ''; };
  return h + '<span class="awo-dfs">' + line('프로젝트명', r.cur.name, r.name, r.dn) + line('거래처', r.cur.client, r.client, r.dc) + '</span>' +
    (r.fill ? '<span class="awo-tag">빈 칸 채움</span>' : '<span class="awo-tag warn">덮어씀</span>') + '</label>';
}
function _awoPaint() {
  var s = _awo; if (!s) return;
  var c = s.cmp, list = _awoList(), shown = list.slice(0, AWO_SHOW);
  var tab = function (k, t, n) { return '<button type="button" class="awo-tab' + (s.tab === k ? ' on' : '') + '" data-awo-tab="' + k + '"' + (n ? '' : ' disabled') + '>' + t + ' <b>' + n + '</b></button>'; };
  s.el.innerHTML =
    '<div class="awo-sum">애니웍스 수주 <b>' + c.total + '</b>건 중 — 수주 대장과 같음 ' + c.same + ' · 대장에 없음 <b>' + c.add.length + '</b> · 내용 다름 <b>' + c.diff.length + '</b></div>' +
    '<div class="awg-top">' + tab('add', '🆕 새 수주', s.add.length) + tab('diff', '✏️ 내용이 다른 수주', s.diff.length) +
      '<span class="awg-sp"></span><input class="awg-in awo-q" id="awoQ" placeholder="🔍 수주번호 · 프로젝트명 · 거래처" value="' + eH(s.q) + '">' +
      '<button type="button" class="awg-b" data-awo="all">보이는 것 모두 선택</button><button type="button" class="awg-b" data-awo="none">모두 해제</button></div>' +
    '<p class="awg-hint awo-hint">' + (s.tab === 'add'
      ? '수주 대장에 없는 번호입니다. 선택한 것만 새로 넣습니다. 수주일 · 금액 · 담당은 애니웍스 조회에 없어 빈 칸으로 들어갑니다 (프로젝트는 만들지 않음).'
      : '번호는 같은데 프로젝트명 · 거래처가 다릅니다. <b>선택한 것만</b> 애니웍스 내용으로 바꿉니다 — 수주일 · 금액 · 담당 · 메모는 그대로 둡니다. 「덮어씀」 은 지금 적힌 값이 사라지니 확인하고 고르세요.') + '</p>' +
    '<div class="awo-list" id="awoList">' + (shown.length ? shown.map(function (r) { return _awoRowHtml(r, s.tab); }).join('') : '<div class="awg-load">' + (s.q ? '찾는 것이 없습니다' : '없습니다') + '</div>') +
      (list.length > shown.length ? '<div class="awg-load">… 외 ' + (list.length - shown.length) + '건 — 검색으로 좁혀 보세요 (「모두 선택」 은 안 보이는 것까지 포함)</div>' : '') + '</div>' +
    '<div class="awg-act awo-act"><label class="awo-auto" title="PC 앱으로 로그인하면 하루 한 번 조용히 확인하고, 새로 생기거나 달라진 수주가 있을 때만 이 창을 띄웁니다"><input type="checkbox" id="awoAuto"' + (awoAutoOn() ? ' checked' : '') + '> 로그인할 때 자동으로 확인</label>' +
      '<span class="awg-sp"></span><span class="awg-hint" id="awoCnt"></span>' +
      '<button type="button" class="awg-b" data-awo="later" title="아무것도 넣지 않고 닫습니다. 다음에 다시 물어봅니다">나중에</button>' +
      '<button type="button" class="btn btn-p" data-awo="apply" id="awoGo">적용</button></div>';
  _awoCount();
}
function _awoCount() {
  var s = _awo; if (!s) return;
  var a = s.add.filter(function (r) { return r.on; }).length, d = s.diff.filter(function (r) { return r.on; }).length, c = s.el.querySelector('#awoCnt'), go = s.el.querySelector('#awoGo');
  if (c) c.textContent = '새로 넣기 ' + a + '건 · 바꾸기 ' + d + '건 — 선택 안 한 것은 다시 묻지 않습니다';
  if (go) { go.disabled = s.busy; go.textContent = s.busy ? '넣는 중…' : (a + d ? '적용 (' + (a + d) + '건)' : '아무것도 안 넣고 닫기'); }
}
function _awoBind(el) {
  el.addEventListener('input', function (e) {
    var s = _awo; if (!s || e.target.id !== 'awoQ') return;
    s.q = e.target.value.trim();
    var list = _awoList(), box = el.querySelector('#awoList'), shown = list.slice(0, AWO_SHOW);
    box.innerHTML = (shown.length ? shown.map(function (r) { return _awoRowHtml(r, s.tab); }).join('') : '<div class="awg-load">찾는 것이 없습니다</div>') +
      (list.length > shown.length ? '<div class="awg-load">… 외 ' + (list.length - shown.length) + '건</div>' : '');
  });
  el.addEventListener('change', function (e) {
    var s = _awo, t = e.target; if (!s) return;
    if (t.id === 'awoAuto') { _awoLsSet(AWO_KEY_AUTO, t.checked ? '1' : '0'); return; }
    var no = t.getAttribute && t.getAttribute('data-no'); if (no == null) return;
    var r = s[s.tab].filter(function (x) { return x.no === no; })[0]; if (!r) return;
    r.on = t.checked; t.closest('.awo-r').classList.toggle('on', r.on); _awoCount();
  });
  el.addEventListener('click', function (e) {
    var s = _awo, t = e.target; if (!s || !t.closest) return;
    var tb = t.closest('[data-awo-tab]'); if (tb && !tb.disabled) { s.tab = tb.getAttribute('data-awo-tab'); _awoPaint(); return; }
    var b = t.closest('[data-awo]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-awo');
    if (a === 'all' || a === 'none') { _awoList().forEach(function (r) { r.on = a === 'all'; }); _awoPaint(); }
    else if (a === 'later') s.m.close();
    else if (a === 'apply') _awoApply();
  });
}
async function _awoApply() {
  var s = _awo; if (!s || s.busy) return;
  var pick = function (l) { return l.filter(function (r) { return r.on; }).map(function (r) { return { orderNo: r.no, client: r.client, name: r.name }; }); };
  var add = pick(s.add), upd = pick(s.diff), over = s.diff.filter(function (r) { return r.on && !r.fill; }).length;
  if (over && !(await wmConfirm('수주 ' + over + '건은 지금 적힌 프로젝트명 · 거래처를 애니웍스 내용으로 덮어씁니다.\n계속할까요?', { ok: '덮어쓰기' }))) return;
  if (_awo !== s) return;
  s.busy = true; _awoCount();
  try {
    var ins = 0, up = 0;
    if (add.length + upd.length) {
      // 2000건씩 — 새 수주부터, 그다음 바꿀 것
      var jobs = [];
      for (var i = 0; i < add.length; i += 2000) jobs.push({ add: add.slice(i, i + 2000), update: [] });
      for (var j = 0; j < upd.length; j += 2000) jobs.push({ add: [], update: upd.slice(j, j + 2000) });
      for (var k = 0; k < jobs.length; k++) {
        var r = await apiFetch('/api/orders/aw-sync', { method: 'POST', body: JSON.stringify(jobs[k]) });
        if (!r) throw new Error('저장하지 못했습니다');
        ins += r.inserted || 0; up += r.updated || 0;
      }
    }
    // 선택 안 한 것 → 다시 묻지 않게 기억 (애니웍스 내용이 바뀌면 다시 물어봄). 넣은 것은 목록에서 지움
    var skip = _awoSkip();
    s.add.concat(s.diff).forEach(function (x) { if (x.on) delete skip[x.no]; else skip[x.no] = _awoSig(x); });
    _awoLsSet(AWO_KEY_SKIP, JSON.stringify(skip));
    if (ins + up) {
      if (typeof loadOrdersToMap === 'function') { try { await loadOrdersToMap(); } catch (_) {} }
      if (typeof _emitBus === 'function') _emitBus('order', 'bulk-synced', { count: ins + up });
      if (typeof renderOrders === 'function' && document.getElementById('orderQ')) { try { renderOrders(); } catch (_) {} }
    }
    showToast(ins + up ? '✅ 수주 대장 — 새로 ' + ins + '건 · 바꿈 ' + up + '건' : '넣은 것 없이 닫았습니다 (다시 묻지 않음)', ins + up ? 'success' : 'info');
    if (_awo === s) s.m.close();
  } catch (e) {
    showToast('❌ ' + ((e && e.message) || '저장하지 못했습니다'), 'error');
    if (_awo === s) { s.busy = false; _awoCount(); }
  }
}

/* 로그인 뒤 한 번 조용히 확인 — PC 앱 · 수주 고칠 수 있는 사람 · 하루 한 번 · 끌 수 있음 (자동 시험 브라우저에서는 안 함) */
(function () {
  if (!_awoDesk() || window.WM_SOLO || navigator.webdriver) return;
  var n = 0, t = setInterval(function () {
    if (++n > 900) return clearInterval(t);
    if (typeof currentUser === 'undefined' || !currentUser || !currentUser.id || document.getElementById('initLoading')) return;
    clearInterval(t);
    setTimeout(function () {
      if (!awoAutoOn() || !awoCan() || _awoLs(AWO_KEY_DAY, '') === _awoToday()) return;
      if (document.querySelector('.wa-modal-overlay')) return;      // 다른 창을 쓰는 중이면 다음 로그인 때
      awoScan({ auto: true });
    }, 6000);
  }, 1000);
})();
