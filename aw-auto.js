/* aw-auto.js — 🔄 애니웍스 자동 갱신 (v13.521)
 *   PC 앱이 켜져 있는 동안, 관리자가 정한 주기(기본 5분)마다 조용히
 *     · 업무일지: 마지막 기록 뒤의 것만 받아 합침 (awgRecentPull silent — 업무 데이터 담당자만)
 *     · 수주    : 새 수주 넣기 · 빈 칸 채우기      (awoAutoSync — 수주를 고칠 수 있는 사람만)
 *   새로 들어온 것이 있을 때만 짧게 알리고(알림 한 줄 + 머리 줄 🔄 점), 이력은 🔄 를 누르면 보인다.
 *   · 주기 · 전체 켜기/끄기는 관리자가 정함 (서버 /api/settings/org/aw_auto — 모두 같은 값)
 *   · 「이 PC 에서 자동 갱신」 은 사람마다 끌 수 있음 · 이력은 이 PC 에만 남음
 *   · 공수 등록 · 주간업무 올리기 등 애니웍스 창을 쓰는 중이거나 PC 앱이 다른 애니웍스 일을 하는 중이면 그 회차는 건너뜀
 *   · 손으로 하는 「🔄 최근 받기」 · 「수주 가져오기」 · 로그인 때 확인은 그대로
 *   전역 이름: awa* / _awa* / AWA_*  ·  화면 클래스: .awa-* (style.css)
 */
var AWA_KEY_LOG = 'wm_awa_log', AWA_KEY_OFF = 'wm_awa_off', AWA_KEY_NEW = 'wm_awa_new', AWA_KEY_LAST = 'wm_awa_last', AWA_KEY_ASK = 'wm_awa_ask';
var AWA_LOG_MAX = 40, AWA_TICK = 20000, AWA_FIRST = 45000, AWA_CFG_TTL = 600000;
var _awa = { cfg: { on: true, min: 5 }, cfgAt: 0, busy: false, timer: null, typedAt: 0, bootAt: Date.now() };

function _awaDesk() { return (window.wmDesktop && typeof window.wmDesktop.aw === 'function') ? window.wmDesktop.aw : null; }
function _awaLs(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }
function _awaLsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
function _awaJson(k, d) { try { var v = JSON.parse(_awaLs(k, 'null')); return v == null ? d : v; } catch (_) { return d; } }
function _awaUser() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? currentUser : null; }
function _awaCanWl() { return typeof wmCanWorklog === 'function' && wmCanWorklog() && typeof awgRecentPull === 'function'; }
function _awaCanOd() { return typeof awoCan === 'function' && awoCan() && typeof awoAutoSync === 'function'; }
/** 이 사람 · 이 창에서 자동 갱신을 돌릴 수 있는가 (PC 앱 + 업무 데이터 담당 또는 수주 편집 권한) */
function awaCan() { return !!(_awaDesk() && !window.WM_SOLO && _awaUser() && (_awaCanWl() || _awaCanOd())); }
function awaLocalOn() { return _awaLs(AWA_KEY_OFF, '0') !== '1'; }
function awaLog() { var l = _awaJson(AWA_KEY_LOG, []); return Array.isArray(l) ? l : []; }
function _awaLast() { return _awaJson(AWA_KEY_LAST, null) || {}; }
function _awaP(n) { return n < 10 ? '0' + n : '' + n; }
function _awaHm(ms) { var d = new Date(ms); return _awaP(d.getHours()) + ':' + _awaP(d.getMinutes()); }
function _awaWhen(ms) {
  var d = new Date(ms), n = new Date();
  return (d.toDateString() === n.toDateString() ? '오늘' : (d.getMonth() + 1) + '/' + d.getDate()) + ' ' + _awaHm(ms);
}
function _awaEsc(s) { return typeof eH === 'function' ? eH(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

/* 관리자가 정한 값 { on, min } — 10분마다 다시 읽음 (force: 바로) */
async function awaCfgLoad(force) {
  if (!force && _awa.cfgAt && Date.now() - _awa.cfgAt < AWA_CFG_TTL) return _awa.cfg;
  try {
    var r = await apiFetch('/api/settings/org/aw_auto');
    var v = r && r.data;
    if (v && isFinite(+v.min)) _awa.cfg = { on: v.on !== false, min: Math.min(720, Math.max(1, Math.round(+v.min))) };
    _awa.cfgAt = Date.now();
  } catch (_) {}
  return _awa.cfg;
}

/* 한 회차 결과를 한 줄들로 — { lines:[{ic,text,sub,ask}], news } */
function _awaSummary(wl, od) {
  var lines = [], news = 0;
  if (wl && wl.changed) {
    var s = []; if (wl.added) s.push('+' + wl.added); if (wl.updated) s.push('수정 ' + wl.updated);
    lines.push({ ic: '📒', go: 'wl', text: '업무일지 ' + s.join(' · '), sub: (wl.parts || []).join(' / ') });
    news += wl.changed;
  }
  if (od && (od.added || od.filled)) {
    var o = []; if (od.added) o.push('새로 ' + od.added + '건'); if (od.filled) o.push('빈 칸 채움 ' + od.filled + '건');
    lines.push({ ic: '🧾', go: 'od', q: (od.nos || [])[0] || '', text: '수주 ' + o.join(' · '), sub: (od.nos || []).join(' · ') + (od.added > (od.nos || []).length ? ' …' : '') });
    news += od.added + od.filled;
  }
  return { lines: lines, news: news };
}

/* 이력 줄 · 알림을 누르면 그 화면으로 — 업무일지는 업무 관리 › 주간 분석, 수주는 프로젝트 관리 › 수주 대장(새 수주 번호로 찾아 둠) */
function awaGo(kind, q) {
  if (typeof wmHdrPopClose === 'function') wmHdrPopClose();
  if (typeof setPage !== 'function' || typeof setMode !== 'function') return;
  if (kind === 'od') {
    setPage('project');
    if (q && typeof orderSearchKw !== 'undefined') { orderSearchKw = q; if (typeof orderFilterClient !== 'undefined') orderFilterClient = ''; }
    setMode('orders');
    if (typeof renderOrders === 'function') { try { renderOrders(); } catch (_) {} }
  } else { setPage('team'); setMode('weekly'); }
}
/* 「새 내용이 갱신되었습니다」 알림 — 누르면 그 화면으로 (보통 알림은 눌리지 않음) */
function _awaToast(msg, line) {
  if (typeof showToast !== 'function') return;
  showToast(msg + ' — 눌러서 보기', 'success');
  var all = document.querySelectorAll('.wa-toast'), t = all[all.length - 1];
  if (!t || !line) return;
  t.classList.add('awa-toast'); t.style.pointerEvents = 'auto'; t.style.cursor = 'pointer';
  t.onclick = function () { awaGo(line.go, line.q); t.remove(); };
}

/* 한 회차. opt.manual = 「지금 갱신」 (창이 떠 있어도 돌고, 결과를 항상 알림) */
async function awaRun(opt) {
  var manual = !!(opt && opt.manual), desk = _awaDesk();
  if (_awa.busy) return { skip: 'busy' };
  if (!awaCan()) return { skip: 'perm' };
  _awa.busy = true; _awaPaintBtn();
  var note = '', err = '', out = { news: 0 };
  try {
    var st = await desk('status');
    if (!st || !st.ok || !st.hasCred) { note = '애니웍스 계정을 연결하면 시작합니다'; out.skip = 'cred'; return out; }
    if (st.running || st.filled) { note = 'PC 앱이 애니웍스 작업 중 — 이번 회차는 건너뜀'; out.skip = 'engine'; return out; }
    if (!manual && document.querySelector('.awg, .aww, #awoBox')) { note = '애니웍스 창을 쓰는 중 — 이번 회차는 건너뜀'; out.skip = 'modal'; return out; }
    var wl = _awaCanWl() ? await awgRecentPull({ silent: true }) : null;
    var od = _awaCanOd() ? await awoAutoSync() : null;
    out.wl = wl; out.od = od;
    var errs = [];
    if (wl && wl.error) errs.push('업무일지: ' + wl.error);
    if (od && od.error) errs.push('수주: ' + od.error);
    err = errs.join(' / ');
    var sum = _awaSummary(wl, od), ask = (od && od.ask) || 0, lines = sum.lines.slice();
    // 덮어써야 하는 수주 — 건수가 바뀌었을 때만 이력에 남김 (5분마다 같은 줄이 쌓이지 않게)
    if (od && !od.error && !od.skip) {
      if (ask && String(ask) !== _awaLs(AWA_KEY_ASK, '0')) lines.push({ ic: '⚠️', text: '수주 ' + ask + '건은 대장과 내용이 달라 넣지 않았습니다', ask: 1 });
      _awaLsSet(AWA_KEY_ASK, String(ask));
    }
    out.news = sum.news;
    if (lines.length) {
      var log = awaLog(); log.unshift({ t: Date.now(), lines: lines });
      _awaLsSet(AWA_KEY_LOG, JSON.stringify(log.slice(0, AWA_LOG_MAX)));
      _awaLsSet(AWA_KEY_NEW, String((+_awaLs(AWA_KEY_NEW, '0') || 0) + 1));
    }
    if (sum.news) _awaToast('🔄 새 내용이 갱신되었습니다 — ' + sum.lines.map(function (l) { return l.text; }).join(' · '), sum.lines[0]);
    else if (manual && typeof showToast === 'function') showToast(err ? '❌ ' + err : '✓ 새로 들어온 내용이 없습니다', err ? 'error' : 'info');
    note = sum.news ? sum.lines.map(function (l) { return l.text; }).join(' · ') : (lines.length ? lines[0].text : '변동 없음');
    return out;
  } catch (e) { err = (e && e.message) || '오류'; out.error = err; return out; }
  finally {
    _awaLsSet(AWA_KEY_LAST, JSON.stringify({ at: Date.now(), note: note, err: err }));
    _awa.busy = false; _awaPaintBtn(); _awaPaintMenu();
  }
}

/* 때가 됐는지 — 20초마다 봄. 마지막 확인 시각은 localStorage 라 창이 여러 개여도 한 번만, 프로그램을 다시 켜면 곧바로 */
async function _awaTick() {
  if (_awa.busy || !awaCan()) { _awaPaintBtn(); return; }
  if (document.getElementById('initLoading')) return;
  var cfg = await awaCfgLoad();
  _awaPaintBtn();
  if (!cfg.on || !awaLocalOn()) return;
  var now = Date.now();
  if (now - _awa.bootAt < AWA_FIRST) return;                 // 켜자마자는 화면이 뜨는 것이 먼저
  if (now - _awa.typedAt < 8000) return;                     // 글을 치는 중이면 손을 뗄 때까지
  if (now - (+_awaLast().at || 0) < cfg.min * 60000) return;
  _awaLsSet(AWA_KEY_LAST, JSON.stringify(Object.assign(_awaLast(), { at: now })));   // 다른 창이 같이 시작하지 않게 먼저 적음
  awaRun();
}
function awaStart() {
  if (_awa.timer || !_awaDesk() || window.WM_SOLO) return;
  _awa.bootAt = Date.now();
  document.addEventListener('keydown', function () { _awa.typedAt = Date.now(); }, true);
  _awa.timer = setInterval(_awaTick, AWA_TICK);
  _awaTick();
}

/* ─── 머리 줄 🔄 단추 · 펼침 ─── */
function _awaPaintBtn() {
  var w = document.getElementById('hdrAwaWrap'); if (!w) return;
  var can = awaCan(); w.hidden = !can; if (!can) return;
  var b = document.getElementById('hdrAwaBtn'), dot = document.getElementById('awaDot'), last = _awaLast();
  var on = _awa.cfg.on && awaLocalOn(), nu = +_awaLs(AWA_KEY_NEW, '0') || 0;
  b.classList.toggle('busy', _awa.busy); b.classList.toggle('off', !on); b.classList.toggle('err', !!last.err);
  if (dot) dot.hidden = !nu;
  b.title = '🔄 애니웍스 자동 갱신 — ' + (on ? _awa.cfg.min + '분마다' : '꺼짐') + (last.at ? ' · 마지막 확인 ' + _awaWhen(last.at) : '') + (nu ? ' · 새 내용 ' + nu + '회' : '');
}
function _awaPaintMenu() {
  var m = document.getElementById('awaMenu'), w = document.getElementById('hdrAwaWrap');
  if (!m || !w || !w.classList.contains('open')) return;
  var u = _awaUser() || {}, cfg = _awa.cfg, last = _awaLast(), on = cfg.on && awaLocalOn(), log = awaLog();
  var what = [_awaCanWl() ? '업무일지' : '', _awaCanOd() ? '수주' : ''].filter(Boolean).join(' · ');
  var stTxt = _awa.busy ? '<span class="awg-spin"></span>애니웍스에서 확인하는 중…'
    : (on ? '<b class="awa-on">● 켜짐</b> · ' + cfg.min + '분마다' : '<b class="awa-off">○ 꺼짐</b>' + (cfg.on ? ' (이 PC)' : ' (관리자가 끔)')) +
      (last.at ? ' · 마지막 확인 ' + _awaWhen(last.at) : ' · 아직 확인 전');
  var h = '<div class="hdr-pop-t">🔄 애니웍스 자동 갱신 <span class="awa-what">' + what + '</span></div>' +
    '<div class="awa-st">' + stTxt + '</div>' +
    (last.err ? '<div class="awa-err">❌ ' + _awaEsc(last.err) + '</div>' : (last.note && !_awa.busy ? '<div class="awa-note">' + _awaEsc(last.note) + '</div>' : '')) +
    '<div class="awa-row"><label title="끄면 이 PC 에서는 자동으로 받지 않습니다 (손으로 받기는 그대로)"><input type="checkbox" id="awaLocal"' + (awaLocalOn() ? ' checked' : '') + '> 이 PC 에서 자동 갱신</label>' +
      '<span class="awa-sp"></span><button type="button" class="awa-b" data-awa="now"' + (_awa.busy ? ' disabled' : '') + '>지금 갱신</button></div>';
  if (u.role === 'admin') h += '<div class="awa-adm"><span class="awa-adm-t">관리자 설정 (모두에게 적용)</span>' +
    '<div class="awa-row"><label><input type="checkbox" id="awaOn"' + (cfg.on ? ' checked' : '') + '> 자동 갱신 사용</label><span class="awa-sp"></span>' +
    '<input type="number" id="awaMin" class="awa-in" min="1" max="720" step="1" value="' + cfg.min + '" aria-label="갱신 주기(분)"><span>분마다</span>' +
    '<button type="button" class="awa-b" data-awa="save">저장</button></div></div>';
  h += '<div class="hdr-pop-t awa-log-t">갱신 이력' + (log.length ? '<button type="button" class="awa-x" data-awa="clear" title="이력 지우기">비우기</button>' : '') + '</div><div class="awa-log">' +
    (log.length ? log.map(function (e) {
      return '<div class="awa-li"><time>' + _awaWhen(e.t) + '</time><div>' + (e.lines || []).map(function (l) {
        return '<p' + (l.ask ? ' class="awa-ask"' : l.go ? ' class="awa-go" role="button" tabindex="0" title="눌러서 그 화면으로" data-awa="go" data-go="' + l.go + '" data-q="' + _awaEsc(l.q || '') + '"' : '') + '>' + l.ic + ' ' + _awaEsc(l.text) + (l.sub ? ' <small>' + _awaEsc(l.sub) + '</small>' : '') +
          (l.ask ? ' <button type="button" class="awa-x" data-awa="orders">확인하기</button>' : '') + '</p>';
      }).join('') + '</div></div>';
    }).join('') : '<div class="awa-empty">아직 새로 들어온 내용이 없습니다.<br>새 업무일지 · 수주가 들어오면 여기에 남습니다.</div>') + '</div>';
  m.innerHTML = h;
}
function awaToggle() {
  if (typeof wmHdrPop !== 'function') return;
  wmHdrPop('hdrAwaWrap');
  var w = document.getElementById('hdrAwaWrap');
  if (!w || !w.classList.contains('open')) return;
  _awaLsSet(AWA_KEY_NEW, '0'); _awaPaintBtn(); _awaPaintMenu();
  awaCfgLoad(true).then(function () { _awaPaintBtn(); _awaPaintMenu(); });
}
async function _awaSave() {
  var on = document.getElementById('awaOn'), mi = document.getElementById('awaMin'); if (!on || !mi) return;
  var min = Math.round(+mi.value);
  if (!isFinite(min) || min < 1 || min > 720) { showToast('주기는 1 ~ 720분 사이로 넣어 주세요', 'warn'); mi.focus(); return; }
  try {
    var r = await apiFetch('/api/settings/org/aw_auto', { method: 'PUT', body: JSON.stringify({ value: { on: on.checked, min: min } }) });
    if (!r || !r.data) throw new Error('저장하지 못했습니다');
    _awa.cfg = { on: r.data.on !== false, min: r.data.min }; _awa.cfgAt = Date.now();
    showToast('✅ 자동 갱신 — ' + (_awa.cfg.on ? _awa.cfg.min + '분마다' : '끔') + ' (다른 PC 는 10분 안에 반영)', 'success');
  } catch (e) { showToast('❌ ' + ((e && e.message) || '저장하지 못했습니다'), 'error'); }
  _awaPaintBtn(); _awaPaintMenu();
}
(function () {
  var m = document.getElementById('awaMenu'); if (!m) return;
  m.addEventListener('change', function (e) {
    if (e.target.id === 'awaLocal') { _awaLsSet(AWA_KEY_OFF, e.target.checked ? '0' : '1'); _awaPaintBtn(); _awaPaintMenu(); }
  });
  m.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-awa]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-awa');
    if (a === 'now') { awaRun({ manual: true }); _awaPaintMenu(); }
    else if (a === 'save') _awaSave();
    else if (a === 'clear') { _awaLsSet(AWA_KEY_LOG, '[]'); _awaPaintMenu(); }
    else if (a === 'go') awaGo(b.getAttribute('data-go'), b.getAttribute('data-q'));
    else if (a === 'orders') { if (typeof wmHdrPopClose === 'function') wmHdrPopClose(); if (typeof awoScan === 'function') awoScan(); }
  });
  // 자동 시험 브라우저에서는 저절로 돌지 않는다 (시험은 awaRun 을 직접 부름)
  if (!navigator.webdriver || window.__awaAuto) awaStart();
})();
