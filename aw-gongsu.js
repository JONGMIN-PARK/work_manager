/* aw-gongsu.js — 📝 애니웍스 공수 등록 (v13.512) · 📚 이력 (v13.513)
 *   내 업무일지를 여기서 쓰고(날짜별 초안은 서버에 저장 → 휴대폰 · 웹에서도 이어 씀),
 *   PC 앱이면 애니웍스에 바로 등록한다: ① 웹에 입력(애니웍스 화면 캡처로 확인) → ② 등록 → 주간일지를 내려받아 올라갔는지 확인.
 *   실제 애니웍스 조작은 PC 앱(desktop/anyworks.js · window.wmDesktop.aw)이 한다. 아이디 · 비밀번호는 그 PC 에만 있다.
 *   📥 주간일지 받기(awgPullOpen) — PC 앱이 3개 사업부 엑셀을 내려받아 기존 가져오기(hFiles)로 넘긴다.
 *   전역 이름: awg* / _awg* / AWG_*  ·  화면 클래스: .awg-* (style.css)
 */
var AWG_DIVI = ['사내', '사외'];
var AWG_JOB = ['제안', '수주', '개발', '지원', 'CS', '양산', '공통'];
var AWG_MAX = 15, AWG_MEMO = 50;
var AWG_DOW = ['일', '월', '화', '수', '목', '금', '토'];
var _awg = null;

/* ─── 작은 도우미 ─── */
function _awgDesk() { return (window.wmDesktop && typeof window.wmDesktop.aw === 'function') ? window.wmDesktop.aw : null; }
function _awgIso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function _awgDate(day) { var p = day.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function _awgAdd(day, n) { var d = _awgDate(day); d.setDate(d.getDate() + n); return _awgIso(d); }
function _awgMon(day) { var d = _awgDate(day); return _awgAdd(day, -((d.getDay() + 6) % 7)); }
function _awgLabel(day) { var d = _awgDate(day); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + AWG_DOW[d.getDay()] + ')'; }
function _awgBlank() { return { orderno: '', prodspec: '', hours: '', divi: '사내', job: '', memo: '' }; }
function _awgHasText(it) { return !!(it && (it.orderno || it.memo || +it.hours > 0)); }
function _awgRows() { return _awg ? _awg.items.filter(_awgHasText) : []; }
function _awgSum(items) { var t = 0; (items || []).forEach(function (it) { t += +it.hours || 0; }); return Math.round(t * 100) / 100; }
function _awgNames() {
  var u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : {};
  return [u.name, u.display_name].filter(Boolean).map(function (s) { return String(s).replace(/\s/g, ''); });
}
function _awgClean(items) {
  return (items || []).map(function (it) {
    return { orderno: String(it.orderno || '').trim(), prodspec: String(it.prodspec || '').trim(), hours: +it.hours > 0 ? +it.hours : 0, divi: it.divi || '', job: it.job || '', memo: String(it.memo || '').trim() };
  });
}
function _awgSig(items) { return JSON.stringify(_awgClean(items).map(function (it) { return [it.orderno, it.hours, it.divi, it.job, it.memo]; })); }
function _awgKey(orderno, hours, memo) { return String(orderno).trim() + '|' + (+hours || 0) + '|' + String(memo).replace(/\s+/g, ' ').trim(); }
function _awgTime(ts) { var d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

/* ─── 열기 ─── */
function awgOpen(day, view) {
  if (typeof wmGuardedModal !== 'function') return _awgBuild(day, view);
  return wmGuardedModal('awg', function () { return _awgBuild(day, view); }, 'awgBox');
}
function awgHistOpen() { return awgOpen('', 'hist'); }
function _awgBuild(day, view) {
  var m = createModal({
    id: 'awgModal', title: '📝 공수 등록 <span class="awg-sub">애니웍스 업무보고</span>', width: '1100px', boxStyle: 'padding:18px 20px',
    onClose: function () { var s = _awg; _awg = null; if (s) { clearTimeout(s.saveT); if (s.dirty) _awgSaveOf(s); } }
  });
  var el = document.createElement('div');
  el.id = 'awgBox'; el.className = 'awg';
  m.box.appendChild(el);
  _awg = { el: el, day: /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : _awgIso(new Date()), items: [_awgBlank()], docs: {}, range: null, orders: [], view: view === 'hist' ? 'hist' : 'edit', hist: null, st: null, shot: null, dup: null, note: null, busy: '', saveT: 0, dirty: false, saved: '' };
  el.innerHTML = '<div class="awg-load">불러오는 중…</div>';
  _awgBind(el);
  _awgLoad();
}
async function _awgStatus() {
  var desk = _awgDesk(), s = _awg;
  if (!desk || !s) return;
  try { var r = await desk('status'); if (_awg === s) s.st = r && r.ok ? r : null; } catch (_) { s.st = null; }
}
async function _awgLoad() {
  var s = _awg; if (!s) return;
  var from = _awgAdd(s.day, -35), to = _awgAdd(s.day, 14);
  try {
    var rs = await Promise.all([
      apiFetch('/api/gongsu?from=' + from + '&to=' + to),
      apiFetch('/api/gongsu/orders').catch(function () { return null; }),
      _awgStatus()
    ]);
    if (_awg !== s) return;
    if (!rs[0]) throw new Error('로그인이 필요합니다');
    s.docs = {}; (rs[0].data || []).forEach(function (d) { s.docs[d.day] = d; });
    s.range = [from, to];
    s.orders = (rs[1] && rs[1].data) || [];
    if (s.view === 'hist') { _awgShow(s.day, true); _awgHistLoad(); } else _awgShow(s.day);
  } catch (e) {
    if (_awg !== s) return;
    s.el.innerHTML = '<div class="awg-load">불러오지 못했습니다 — ' + eH((e && e.message) || '') + ' <button class="btn btn-g btn-s" data-awg="reload">다시</button></div>';
  }
}
/* 그 날짜를 화면에 */
function _awgShow(day, quiet) {
  var s = _awg; if (!s) return;
  s.day = day;
  var doc = s.docs[day];
  s.items = doc && doc.items && doc.items.length ? doc.items.map(function (it) { return Object.assign(_awgBlank(), it, { hours: +it.hours > 0 ? it.hours : '' }); }) : [_awgBlank()];
  s.shot = null; s.dup = null; s.note = null; s.dirty = false; s.saved = '';
  if (!quiet) _awgPaint();
}
async function _awgGo(day) {
  var s = _awg; if (!s || s.busy) return;
  await _awgFlush();
  if (_awg !== s) return;
  if (!s.range || day < s.range[0] || day > s.range[1]) { s.day = day; s.el.innerHTML = '<div class="awg-load">불러오는 중…</div>'; return _awgLoad(); }
  _awgShow(day);
}

/* ─── 그리기 ─── */
function _awgAcctHtml() {
  var s = _awg, desk = _awgDesk();
  if (!desk) return '<span class="awg-chip" title="애니웍스 등록은 PC 앱(업무 관리자)에서 됩니다. 여기서는 작성 · 저장까지">📱 작성만</span>';
  if (s.st && s.st.hasCred) return '<button type="button" class="awg-chip on" data-awg="acct" title="애니웍스 계정 — 눌러서 바꾸기">🟢 ' + eH(s.st.id) + '</button>';
  return '<button type="button" class="awg-chip warn" data-awg="acct" title="애니웍스 아이디 · 비밀번호를 이 PC 에 저장">🔑 계정 연결</button>';
}
function _awgWeekHtml() {
  var s = _awg, mon = _awgMon(s.day), today = _awgIso(new Date()), h = '';
  for (var i = 0; i < 7; i++) {
    var d = _awgAdd(mon, i), doc = s.docs[d], has = doc && (doc.items || []).some(_awgHasText);
    if (i > 4 && !has && d !== s.day) continue;
    var sent = doc && doc.status === 'sent';
    h += '<button type="button" class="awg-wd' + (d === s.day ? ' on' : '') + (sent ? ' sent' : has ? ' draft' : '') + (d === today ? ' today' : '') + '" data-awg-day="' + d + '" title="' +
      _awgLabel(d) + (sent ? ' — 등록함' : has ? ' — 작성 중' : ' — 비어 있음') + '">' + AWG_DOW[_awgDate(d).getDay()] + '<b>' + (sent ? '✓' : has ? '✎' : '·') + '</b></button>';
  }
  return h;
}
function _awgCopyHtml() {
  var s = _awg, days = Object.keys(s.docs).filter(function (d) { return d !== s.day && (s.docs[d].items || []).some(_awgHasText); }).sort().reverse().slice(0, 10);
  return '<select id="awgCopy" class="awg-in awg-copy" title="다른 날에 쓴 내용을 가져오기"><option value="">📋 불러오기…</option>' + days.map(function (d) {
    var it = s.docs[d].items.filter(_awgHasText);
    return '<option value="' + d + '">' + _awgLabel(d) + ' — ' + it.length + '행 ' + _awgSum(it) + 'h</option>';
  }).join('') + '</select>';
}
function _awgStateHtml() {
  var s = _awg, doc = s.docs[s.day];
  if (doc && doc.status === 'sent') {
    var si = doc.sentItems || [], changed = _awgSig(_awgRows()) !== _awgSig(si);
    return '<span class="awg-st ok">✅ ' + _awgTime(doc.sentAt) + ' 애니웍스에 등록함 · ' + si.length + '행 ' + _awgSum(si) + 'h</span>' +
      (doc.checkedAt ? '<span class="awg-st ok">주간일지에서 확인됨</span>' : '<span class="awg-st">주간일지 확인 전</span>') +
      (changed ? '<span class="awg-st warn" title="애니웍스에는 고치기 전 내용이 올라가 있습니다. 다시 등록하면 애니웍스에 한 번 더 올라갑니다">⚠ 등록한 뒤에 내용이 바뀜</span>' : '');
  }
  return '<span class="awg-st">✏️ 작성 중</span>';
}
function _awgRowHtml(it, i) {
  var s = _awg, memo = String(it.memo || '');
  var sel = function (f, list, ph) {
    return '<select class="awg-in" data-f="' + f + '" aria-label="' + ph + '">' + (ph === '업무구분' ? '<option value="">업무구분</option>' : '') + list.map(function (v) { return '<option' + (it[f] === v ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select>';
  };
  return '<div class="awg-r" data-i="' + i + '">' +
    '<span class="awg-no" title="끌어서 순서 바꾸기 (칸 안에서 Alt+↑ · ↓)" aria-label="' + (i + 1) + '번 행 — 끌어서 순서 바꾸기"><b>' + (i + 1) + '</b><i aria-hidden="true">⠿</i></span>' +
    '<span class="awg-c awg-c-ord"><input class="awg-in" data-f="orderno" list="awgOrdList" maxlength="40" placeholder="수주번호" autocomplete="off" aria-label="수주번호" value="' + eH(it.orderno || '') + '">' +
      (_awgDesk() ? '<button type="button" class="awg-b" data-awg="find" title="애니웍스에서 수주번호 · 고객 · 프로젝트명으로 찾기">🔍</button>' : '') + '</span>' +
    '<span class="awg-c awg-c-ps" data-ps title="' + eH(it.prodspec || '') + '">' + (it.prodspec ? eH(it.prodspec) : '<i>프로젝트명</i>') + '</span>' +
    '<span class="awg-c awg-c-h"><input class="awg-in" data-f="hours" type="number" min="0" max="24" step="0.5" placeholder="시간" aria-label="작업시간" value="' + eH(String(it.hours == null ? '' : it.hours)) + '"></span>' +
    '<span class="awg-c awg-c-d">' + sel('divi', AWG_DIVI, '사내외') + '</span>' +
    '<span class="awg-c awg-c-j">' + sel('job', AWG_JOB, '업무구분') + '</span>' +
    '<span class="awg-c awg-c-memo"><input class="awg-in" data-f="memo" maxlength="' + AWG_MEMO + '" placeholder="작업내용 (50자까지)" aria-label="작업내용" value="' + eH(memo) + '"><i class="awg-cnt" data-cnt>' + memo.length + '/' + AWG_MEMO + '</i></span>' +
    '<button type="button" class="awg-b awg-del" data-awg="del" title="이 행 지우기" aria-label="행 지우기">✕</button>' +
  '</div>';
}
function _awgPaint() {
  var s = _awg; if (!s) return;
  if (s.view === 'hist' && s.hist) return _awgHistPaint();
  var today = _awgIso(new Date());
  var h = '<div class="awg-top">' +
      '<button type="button" class="awg-b" data-awg-day="' + _awgAdd(s.day, -1) + '" title="전날">◀</button>' +
      '<input type="date" id="awgDay" class="awg-in awg-day" value="' + s.day + '" aria-label="작성일자">' +
      '<button type="button" class="awg-b" data-awg-day="' + _awgAdd(s.day, 1) + '" title="다음 날">▶</button>' +
      (s.day !== today ? '<button type="button" class="awg-b" data-awg-day="' + today + '">오늘</button>' : '') +
      '<span class="awg-wk" title="이번 주 — ✓ 등록함 · ✎ 작성 중 · · 비어 있음">' + _awgWeekHtml() + '</span>' +
      '<span class="awg-sp"></span>' + _awgCopyHtml() + '<button type="button" class="awg-b" data-awg="hist" title="날짜별로 써 둔 · 올린 공수를 모아 보고, 골라서 다른 날짜에 복사">📚 이력</button>' + _awgAcctHtml() +
    '</div>' +
    '<div class="awg-state" id="awgState">' + _awgStateHtml() + '<span class="awg-saved" id="awgSaved"></span></div>' +
    '<div class="awg-rows" id="awgRows">' +
      '<div class="awg-hd"><span></span><span>수주번호</span><span>프로젝트명</span><span>시간</span><span>사내외</span><span>업무구분</span><span>작업내용</span><span></span></div>' +
      s.items.map(_awgRowHtml).join('') +
    '</div>' +
    '<datalist id="awgOrdList">' + s.orders.map(function (o) { return '<option value="' + eH(o.orderno) + '" label="' + eH(o.prodspec || '') + '"></option>'; }).join('') + '</datalist>' +
    '<div class="awg-foot"><button type="button" class="awg-b" data-awg="add"' + (s.items.length >= AWG_MAX ? ' disabled' : '') + '>+ 행 추가</button>' +
      '<span class="awg-sum" id="awgSum"></span><span class="awg-sp"></span>' +
      (s.docs[s.day] ? '<button type="button" class="awg-b awg-quiet" data-awg="wipe" title="이 날짜에 써 둔 것을 여기서 지웁니다 (애니웍스에 올라간 것은 그대로)">이 날짜 비우기</button>' : '') + '</div>' +
    '<div class="awg-act" id="awgAct"></div>' +
    '<div class="awg-shot" id="awgShot"></div>';
  s.el.innerHTML = h;
  _awgSync();
}
/* 합계 · 단추 상태 · 확인 영역 — 글자를 칠 때마다 (입력 칸은 다시 그리지 않는다) */
function _awgSync() {
  var s = _awg; if (!s) return;
  var rows = _awgRows(), sum = _awgSum(rows), el = s.el, q = function (id) { return el.querySelector('#' + id); };
  // 내용이 같으면 다시 그리지 않는다 — 자동 저장 때 단추가 새로 그려지면 누르던 클릭이 씹힘
  var put = function (id, html) { var n = q(id); if (n && n.__awgH !== html) { n.__awgH = html; n.innerHTML = html; } };
  put('awgSum', rows.length + '행 · 합계 <b>' + sum + 'h</b>');
  put('awgState', _awgStateHtml() + '<span class="awg-saved" id="awgSaved">' + eH(s.saved) + '</span>');
  var desk = _awgDesk(), cred = !!(s.st && s.st.hasCred), busy = !!s.busy, ready = !!(s.shot && s.shot.sig === _awgSig(rows));
  var a = '';
  if (!desk) {
    a = '<span class="awg-hint">📱 여기서는 작성 · 저장까지 됩니다. <b>PC 앱(업무 관리자)</b>에서 이 창을 열면 써 둔 그대로 애니웍스에 등록할 수 있습니다.' +
      (window.wmDesktop ? ' (지금 PC 앱은 예전 버전입니다 — 새 버전으로 올려 주세요)' : '') + '</span>';
  } else if (!cred) {
    a = '<button type="button" class="btn btn-p" data-awg="acct">🔑 애니웍스 계정 연결</button><span class="awg-hint">아이디 · 비밀번호는 이 PC 에만 암호화해 둡니다 (서버로 보내지 않음)</span>';
  } else {
    a = '<button type="button" class="btn btn-g" data-awg="fill"' + (busy || !rows.length ? ' disabled' : '') + ' title="애니웍스 공수등록 화면에 넣어 보고, 들어간 화면을 아래에 보여 줍니다 (아직 등록 전)">① 웹에 입력 · 확인</button>' +
      '<button type="button" class="btn btn-p" data-awg="send"' + (busy || !ready ? ' disabled' : '') + ' title="' + (ready ? '애니웍스에 등록' : '먼저 ① 웹에 입력으로 확인') + '">② ▶ 애니웍스에 등록</button>' +
      '<span class="awg-hint">' + (busy ? '' : ready ? '아래 화면이 맞으면 등록을 누르세요' : s.shot ? '내용이 바뀌었습니다 — ① 을 다시 눌러 주세요' : '') + '</span><span class="awg-sp"></span>' +
      (typeof wmCanWorklog === 'function' && wmCanWorklog() ? '<button type="button" class="awg-b" data-awg="pull"' + (busy ? ' disabled' : '') + ' title="3개 사업부 주간일지를 내려받아 업무일지 데이터를 갱신">📥 주간일지 받기</button>' : '');
  }
  put('awgAct', a);
  put('awgShot', _awgShotHtml(ready));
  el.classList.toggle('busy', busy);
}
function _awgShotHtml(ready) {
  var s = _awg, h = '';
  var BUSY = { check: '애니웍스에 이미 올라간 것이 있는지 확인하는 중…', fill: '애니웍스 공수등록 화면에 넣는 중…', send: '애니웍스에 등록하는 중…', verify: '주간일지를 내려받아 올라갔는지 확인하는 중…', pull: '주간일지를 내려받는 중…' };
  if (s.busy) h += '<div class="awg-msg run"><span class="awg-spin"></span>' + BUSY[s.busy] + '</div>';
  if (s.note) h += '<div class="awg-msg ' + s.note.t + '">' + s.note.html + '</div>';
  if (s.dup && s.dup.length && (s.shot || s.busy === 'fill')) {
    h += '<div class="awg-msg warn"><b>⚠ ' + _awgLabel(s.day) + ' 에 애니웍스에 이미 ' + s.dup.length + '행(' + _awgSum(s.dup) + 'h)이 올라가 있습니다.</b> 등록하면 그 위에 더해질 수 있습니다.' +
      '<div class="awg-dup">' + s.dup.map(function (r) { return '<div>' + eH(r.orderno) + ' · ' + r.hours + 'h · ' + eH(r.job) + ' · ' + eH(r.memo) + '</div>'; }).join('') + '</div></div>';
  }
  if (s.shot && ready) {
    h += '<div class="awg-cap"><div class="awg-cap-t">애니웍스 화면에 들어간 내용 (아직 등록 전)</div>' +
      (s.shot.png ? '<img src="' + s.shot.png + '" alt="애니웍스 입력 화면">' :
        '<div class="awg-dup">' + s.shot.rows.map(function (r) { return '<div>' + eH(r.orderno) + ' · ' + eH(r.prodspec) + ' · ' + r.hours + 'h · ' + eH(r.divi) + ' · ' + eH(r.job) + ' · ' + eH(r.memo) + '</div>'; }).join('') + '</div>') + '</div>';
  }
  return h;
}

/* ─── 저장 (서버) ─── */
function _awgTouched() {
  var s = _awg; if (!s) return;
  s.dirty = true; s.saved = '';
  if (s.note && s.note.t !== 'ok') s.note = null;
  _awgSync();
  clearTimeout(s.saveT);
  s.saveT = setTimeout(function () { _awgSaveOf(s); }, 900);
}
async function _awgSaveOf(s) {
  if (!s || !s.dirty) return;
  var day = s.day, items = _awgClean(s.items.filter(_awgHasText));
  if (!items.length && !s.docs[day]) { s.dirty = false; return; }
  s.dirty = false;
  try {
    var r = await apiFetch('/api/gongsu/' + day, { method: 'PUT', body: JSON.stringify({ items: items }) });
    if (r && r.data) { s.docs[day] = r.data; if (_awg === s && s.day === day && !s.dirty) { s.saved = '저장됨'; _awgSync(); _awgWeekSync(); } }
  } catch (e) {
    s.dirty = true;
    if (_awg === s) { s.saved = '⚠ 저장 실패'; _awgSync(); }
  }
}
function _awgFlush() { var s = _awg; if (!s) return Promise.resolve(); clearTimeout(s.saveT); return _awgSaveOf(s); }
function _awgWeekSync() { var s = _awg, w = s && s.el.querySelector('.awg-wk'); if (w) w.innerHTML = _awgWeekHtml(); }

/* ─── 입력 · 누르기 ─── */
function _awgBind(el) {
  _awgDragBind(el);
  el.addEventListener('input', function (e) {
    var s = _awg, t = e.target, f = t.getAttribute && t.getAttribute('data-f'), r = t.closest && t.closest('.awg-r');
    if (s && s.view === 'hist' && t.id === 'awgHQ') { s.hist.q = t.value.trim(); _awgHistList(); return; }
    if (!s || !f || !r) return;
    var it = s.items[+r.getAttribute('data-i')]; if (!it) return;
    it[f] = t.value;
    if (f === 'memo') { var c = r.querySelector('[data-cnt]'); if (c) c.textContent = t.value.length + '/' + AWG_MEMO; }
    if (f === 'orderno') {
      var v = t.value.trim(), o = s.orders.filter(function (x) { return x.orderno === v; })[0];
      it.prodspec = o ? o.prodspec : '';
      if (o && !it.job && o.job) { it.job = o.job; var js = r.querySelector('[data-f="job"]'); if (js) js.value = o.job; }
      if (o && o.divi) { it.divi = o.divi; var ds = r.querySelector('[data-f="divi"]'); if (ds) ds.value = o.divi; }
      _awgPsSync(r, it);
    }
    _awgTouched();
  });
  el.addEventListener('change', function (e) {
    var s = _awg, t = e.target; if (!s) return;
    if (t.id === 'awgDay' && /^\d{4}-\d{2}-\d{2}$/.test(t.value)) _awgGo(t.value);
    if (t.id === 'awgCopy' && t.value) { var d = t.value; t.value = ''; _awgCopy(d); }
    if (s.view === 'hist') _awgHistChange(t);
  });
  el.addEventListener('keydown', function (e) {
    var s = _awg, t = e.target;
    // Alt+↑ · ↓ — 이 행을 한 칸 위 · 아래로 (v13.522)
    if (s && s.view !== 'hist' && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && t.closest && t.closest('.awg-r')) {
      e.preventDefault();
      var from = +t.closest('.awg-r').getAttribute('data-i');
      _awgMove(from, from + (e.key === 'ArrowUp' ? -1 : 1), t.getAttribute('data-f'));
      return;
    }
    if (!s || e.key !== 'Enter' || e.isComposing || !t.getAttribute || t.getAttribute('data-f') !== 'memo') return;
    var r = t.closest('.awg-r'), i = +r.getAttribute('data-i');
    e.preventDefault();
    if (i === s.items.length - 1) _awgAddRow(); else { var n = el.querySelector('.awg-r[data-i="' + (i + 1) + '"] [data-f="orderno"]'); if (n) n.focus(); }
  });
  el.addEventListener('click', function (e) {
    var s = _awg, t = e.target; if (!s || !t.closest) return;
    var dayBtn = t.closest('[data-awg-day]'); if (dayBtn) { _awgGo(dayBtn.getAttribute('data-awg-day')); return; }
    var b = t.closest('[data-awg]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-awg'), r = b.closest('.awg-r'), i = r ? +r.getAttribute('data-i') : -1;
    if (a === 'reload') { el.innerHTML = '<div class="awg-load">불러오는 중…</div>'; _awgLoad(); }
    else if (a === 'add') _awgAddRow();
    else if (a === 'del') { s.items.splice(i, 1); if (!s.items.length) s.items.push(_awgBlank()); s.shot = null; _awgPaint(); _awgTouched(); }
    else if (a === 'find') _awgFindOpen(i);
    else if (a === 'acct') awgAcctOpen();
    else if (a === 'fill') _awgFill();
    else if (a === 'send') _awgSend();
    else if (a === 'pull') awgPullOpen();
    else if (a === 'wipe') _awgWipe();
    else if (a === 'hist') _awgHistOpen();
    else if (a.indexOf('h-') === 0) _awgHistClick(a, b);
  });
}
/* 순서 바꾸기 (v13.522) — from 번째 행을 to 번째 자리로. 올리는 순서도 이대로라 ① 확인은 다시 */
function _awgMove(from, to, focusField) {
  var s = _awg; if (!s || s.busy) return false;
  var n = s.items.length;
  if (!(from >= 0 && from < n && to >= 0 && to < n) || from === to) return false;
  s.items.splice(to, 0, s.items.splice(from, 1)[0]);
  s.shot = null;
  _awgPaint(); _awgTouched();
  if (focusField) { var f = s.el.querySelector('.awg-r[data-i="' + to + '"] [data-f="' + focusField + '"]'); if (f) f.focus(); }
  return true;
}
/* 번호 칸(⠿)을 끌어 순서 바꾸기 — 마우스 · 손가락 모두 (pointer). 놓을 자리에 줄을 그어 보여 줌 */
function _awgDragBind(el) {
  el.addEventListener('pointerdown', function (e) {
    var s = _awg, g = e.target.closest && e.target.closest('.awg-no');
    if (!s || !g || s.busy || s.view === 'hist' || e.button > 0) return;
    var rows = Array.prototype.slice.call(el.querySelectorAll('.awg-r')), row = g.closest('.awg-r'), from = rows.indexOf(row);
    if (from < 0 || rows.length < 2) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement.blur && el.contains(document.activeElement)) document.activeElement.blur();
    var to = from, y0 = e.clientY, moved = false;
    var mark = function (on) {
      rows.forEach(function (x, i) {
        x.classList.toggle('awg-drag', on && i === from);
        x.classList.toggle('awg-drop-a', on && to < from && i === to);
        x.classList.toggle('awg-drop-b', on && to > from && i === to);
      });
      el.classList.toggle('awg-dragging', on);
    };
    var mv = function (ev) {
      if (!moved && Math.abs(ev.clientY - y0) < 4) return;
      moved = true;
      var k = 0;
      rows.forEach(function (x, i) { if (i === from) return; var b = x.getBoundingClientRect(); if (ev.clientY > b.top + b.height / 2) k++; });
      to = k; mark(true);
      ev.preventDefault();
    };
    var end = function (ev) {
      document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end);
      mark(false);
      if (moved && ev.type === 'pointerup' && _awg === s) _awgMove(from, to);
    };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  });
}
function _awgPsSync(r, it) { var p = r.querySelector('[data-ps]'); if (p) { p.innerHTML = it.prodspec ? eH(it.prodspec) : '<i>프로젝트명</i>'; p.title = it.prodspec || ''; } }
function _awgAddRow() {
  var s = _awg; if (!s || s.items.length >= AWG_MAX) return;
  s.items.push(_awgBlank());
  _awgPaint();
  var n = s.el.querySelector('.awg-r[data-i="' + (s.items.length - 1) + '"] [data-f="orderno"]'); if (n) n.focus();
}
async function _awgCopy(from) {
  var s = _awg, src = s && s.docs[from]; if (!src) return;
  return _awgPutRows(src.items, _awgLabel(from) + ' 에 쓴 ');
}
/* 가져온 행을 지금 날짜에 — 이미 쓴 것이 있으면 바꿀지 · 뒤에 붙일지 묻는다 */
async function _awgPutRows(items, label) {
  var s = _awg; if (!s) return;
  var add = items.filter(_awgHasText).map(function (it) { return Object.assign(_awgBlank(), it, { hours: +it.hours > 0 ? it.hours : '' }); }), cur = _awgRows();
  if (cur.length && !(await wmConfirm(label + add.length + '행을 가져옵니다. 지금 내용을 바꿀까요?', { ok: '바꾸기', cancel: '뒤에 붙이기' }))) add = cur.concat(add);
  if (_awg !== s) return;
  if (add.length > AWG_MAX) showToast('⚠ 한 날짜에 ' + AWG_MAX + '행까지라 뒤의 ' + (add.length - AWG_MAX) + '행은 빠졌습니다', 'warn');
  s.items = add.slice(0, AWG_MAX);
  s.shot = null; _awgPaint(); _awgTouched();
}
async function _awgWipe() {
  var s = _awg; if (!s) return;
  var doc = s.docs[s.day], sent = doc && doc.status === 'sent';
  if (!(await wmConfirm(_awgLabel(s.day) + ' 에 여기 써 둔 내용을 지울까요?' + (sent ? '\n(애니웍스에 등록한 것은 그대로 남고, 여기의 등록 기록만 사라집니다)' : ''), { ok: '지우기' }))) return;
  if (_awg !== s) return;
  clearTimeout(s.saveT); s.dirty = false;
  try { await apiFetch('/api/gongsu/' + s.day, { method: 'DELETE' }); delete s.docs[s.day]; _awgShow(s.day); }
  catch (e) { showToast('❌ 지우지 못했습니다', 'error'); }
}

/* ─── 📚 이력 (v13.513) — 날짜별로 써 둔 · 올린 공수를 모아 보고, 골라서 다른 날짜에 복사해 고쳐 올린다 ─── */
var AWG_HRANGE = [['1', '최근 1개월'], ['3', '최근 3개월'], ['6', '최근 6개월'], ['y', '올해'], ['ly', '작년']];
function _awgHRange(k) {
  var t = _awgIso(new Date()), y = +t.slice(0, 4);
  if (k === 'y') return [y + '-01-01', y + '-12-31'];
  if (k === 'ly') return [(y - 1) + '-01-01', (y - 1) + '-12-31'];
  var d = new Date(); d.setMonth(d.getMonth() - (+k || 3));
  return [_awgIso(d), _awgAdd(t, 14)];
}
async function _awgHistOpen() {
  var s = _awg; if (!s || s.busy) return;
  await _awgFlush();
  if (_awg !== s) return;
  s.view = 'hist';
  _awgHistLoad();
}
async function _awgHistLoad() {
  var s = _awg; if (!s) return;
  var h = s.hist || (s.hist = { k: '3', q: '', days: [], sel: {}, to: _awgIso(new Date()) });
  s.el.innerHTML = '<div class="awg-load">불러오는 중…</div>';
  var rg = _awgHRange(h.k);
  try {
    var r = await apiFetch('/api/gongsu?from=' + rg[0] + '&to=' + rg[1]);
    if (_awg !== s || s.view !== 'hist') return;
    h.days = ((r && r.data) || []).filter(function (d) { return (d.items || []).some(_awgHasText); }).sort(function (a, b) { return a.day < b.day ? 1 : -1; });
    h.days.forEach(function (d) { d.rows = d.items.filter(_awgHasText); });
    h.sel = {};
    _awgHistPaint();
  } catch (e) {
    if (_awg === s) s.el.innerHTML = '<div class="awg-load">불러오지 못했습니다 — ' + eH((e && e.message) || '') + ' <button class="btn btn-g btn-s" data-awg="h-reload">다시</button> <button class="btn btn-g btn-s" data-awg="h-back">← 작성으로</button></div>';
  }
}
function _awgHistMatch(d) {
  var q = _awg.hist.q.toLowerCase();
  if (!q) return d.rows.map(function (_, i) { return i; });
  var out = [];
  d.rows.forEach(function (it, i) { if ((it.orderno + ' ' + (it.prodspec || '') + ' ' + it.memo + ' ' + it.job).toLowerCase().indexOf(q) >= 0) out.push(i); });
  return out;
}
function _awgHistPaint() {
  var s = _awg, h = s.hist;
  s.el.innerHTML = '<div class="awg-top">' +
      '<button type="button" class="awg-b" data-awg="h-back" title="공수 작성 화면으로">← 작성</button><b class="awg-htitle">📚 공수 이력</b>' +
      '<select class="awg-in awg-hrange" id="awgHRange" aria-label="기간">' + AWG_HRANGE.map(function (o) { return '<option value="' + o[0] + '"' + (h.k === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<input class="awg-in awg-hq" id="awgHQ" placeholder="🔍 수주번호 · 프로젝트 · 내용" value="' + eH(h.q) + '">' +
      '<span class="awg-sp"></span><span class="awg-hint" id="awgHTot"></span></div>' +
    '<div class="awg-hsum" id="awgHSum"></div>' +
    '<div class="awg-hlist" id="awgHList"></div>' +
    '<div class="awg-act awg-hact"><span class="awg-hint" id="awgHSel"></span><span class="awg-sp"></span>' +
      '<button type="button" class="awg-b" data-awg="h-clear">선택 풀기</button>' +
      '<label class="awg-hto">넣을 날짜 <input type="date" class="awg-in" id="awgHTo" value="' + h.to + '"></label>' +
      '<button type="button" class="btn btn-p" data-awg="h-put" id="awgHPut" title="고른 행을 그 날짜의 작성 화면에 넣습니다. 고친 뒤 ① ② 로 애니웍스에 올리면 됩니다">📋 그 날짜에 복사해서 쓰기</button></div>';
  _awgHistList();
}
function _awgHistList() {
  var s = _awg, h = s.hist, box = s.el.querySelector('#awgHList'); if (!box) return;
  var nDay = 0, nRow = 0, hrs = 0, by = {}, html = '';
  h.days.forEach(function (d) {
    var idx = _awgHistMatch(d); if (!idx.length) return;
    nDay++;
    var sent = d.status === 'sent', changed = sent && _awgSig(d.rows) !== _awgSig(d.sentItems || []), all = idx.every(function (i) { return h.sel[d.day + '|' + i]; });
    html += '<div class="awg-hday" data-day="' + d.day + '"><div class="awg-hday-h"><label title="이 날짜의 행 모두 고르기"><input type="checkbox" data-hday="' + d.day + '"' + (all ? ' checked' : '') + '><b>' + d.day.slice(0, 4) + ' ' + _awgLabel(d.day) + '</b></label>' +
      (sent ? '<span class="awg-st ok">✓ 등록함' + (d.sentAt ? ' ' + _awgTime(d.sentAt) : '') + '</span>' + (d.checkedAt ? '<span class="awg-st ok">확인됨</span>' : '') + (changed ? '<span class="awg-st warn" title="애니웍스에 올린 뒤에 여기 내용을 고쳤습니다">⚠ 올린 뒤 바뀜</span>' : '') : '<span class="awg-st">✎ 작성 중</span>') +
      '<span class="awg-hint">' + d.rows.length + '행 · ' + _awgSum(d.rows) + 'h</span><span class="awg-sp"></span>' +
      '<button type="button" class="awg-b" data-awg="h-open" title="이 날짜를 작성 화면에서 열기 (고쳐서 다시 올릴 수 있음)">열기</button>' +
      '<button type="button" class="awg-b" data-awg="h-dup" title="이 날짜의 행을 「넣을 날짜」 에 복사">📋 복사</button></div>';
    idx.forEach(function (i) {
      var it = d.rows[i], k = d.day + '|' + i;
      nRow++; hrs += +it.hours || 0;
      var o = by[it.orderno] || (by[it.orderno] = { no: it.orderno, ps: it.prodspec || '', h: 0 }); o.h += +it.hours || 0; if (!o.ps && it.prodspec) o.ps = it.prodspec;
      html += '<label class="awg-hrow' + (h.sel[k] ? ' on' : '') + '"><input type="checkbox" data-hk="' + k + '"' + (h.sel[k] ? ' checked' : '') + '><b>' + eH(it.orderno || '—') + '</b><span class="awg-hps">' + eH(it.prodspec || '') + '</span><span class="awg-hh">' + (+it.hours || 0) + 'h</span><span class="awg-hj">' + eH([it.divi, it.job].filter(Boolean).join(' · ')) + '</span><span class="awg-hm">' + eH(it.memo || '') + '</span></label>';
    });
    html += '</div>';
  });
  box.innerHTML = html || '<div class="awg-load">' + (h.q ? '찾는 것이 없습니다' : '이 기간에 써 둔 공수가 없습니다') + '</div>';
  hrs = Math.round(hrs * 100) / 100;
  s.el.querySelector('#awgHTot').textContent = nDay + '일 · ' + nRow + '행 · ' + hrs + 'h';
  var top = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.h - a.h; });
  s.el.querySelector('#awgHSum').innerHTML = top.slice(0, 12).map(function (o) {
    return '<button type="button" class="awg-hchip' + (h.q === o.no ? ' on' : '') + '" data-awg="h-ord" data-no="' + eH(o.no) + '" title="' + eH(o.ps) + ' — 눌러서 이 수주만 보기"><b>' + eH(o.no || '—') + '</b> ' + (Math.round(o.h * 100) / 100) + 'h</button>';
  }).join('') + (top.length > 12 ? '<span class="awg-hint">외 ' + (top.length - 12) + '개 수주</span>' : '');
  _awgHistSel();
}
function _awgHistPicked() {
  var h = _awg.hist, out = [];
  h.days.slice().reverse().forEach(function (d) { d.rows.forEach(function (it, i) { if (h.sel[d.day + '|' + i]) out.push(it); }); });
  return out;
}
function _awgHistSel() {
  var s = _awg, p = _awgHistPicked(), el = s.el.querySelector('#awgHSel'), b = s.el.querySelector('#awgHPut');
  if (el) el.textContent = p.length ? '선택 ' + p.length + '행 · ' + _awgSum(p) + 'h' : '복사할 행을 고르세요 (날짜 앞 칸을 누르면 그 날 전부)';
  if (b) b.disabled = !p.length;
}
function _awgHistChange(t) {
  var s = _awg, h = s.hist; if (!h || !t.getAttribute) return;
  if (t.id === 'awgHRange') { h.k = t.value; _awgHistLoad(); return; }
  if (t.id === 'awgHTo') { if (/^\d{4}-\d{2}-\d{2}$/.test(t.value)) h.to = t.value; return; }
  var k = t.getAttribute('data-hk'), day = t.getAttribute('data-hday');
  if (k) {
    if (t.checked) h.sel[k] = 1; else delete h.sel[k];
    t.closest('.awg-hrow').classList.toggle('on', t.checked);
    var dd = t.closest('.awg-hday');
    dd.querySelector('[data-hday]').checked = [].every.call(dd.querySelectorAll('[data-hk]'), function (c) { return c.checked; });
    _awgHistSel();
  } else if (day) {
    [].forEach.call(t.closest('.awg-hday').querySelectorAll('[data-hk]'), function (c) {
      c.checked = t.checked;
      if (t.checked) h.sel[c.getAttribute('data-hk')] = 1; else delete h.sel[c.getAttribute('data-hk')];
      c.closest('.awg-hrow').classList.toggle('on', t.checked);
    });
    _awgHistSel();
  }
}
function _awgHistClick(a, b) {
  var s = _awg, h = s.hist, dd = b.closest('.awg-hday'), day = dd && dd.getAttribute('data-day');
  if (a === 'h-back') _awgHistBack(s.day);
  else if (a === 'h-reload') _awgHistLoad();
  else if (a === 'h-open') _awgHistBack(day);
  else if (a === 'h-clear') { h.sel = {}; _awgHistList(); }
  else if (a === 'h-ord') { var no = b.getAttribute('data-no'); h.q = h.q === no ? '' : no; s.el.querySelector('#awgHQ').value = h.q; _awgHistList(); }
  else if (a === 'h-dup') { var d = h.days.filter(function (x) { return x.day === day; })[0]; if (d) _awgHistPut(_awgHistMatch(d).map(function (i) { return d.rows[i]; }), _awgLabel(day) + ' 의 '); }
  else if (a === 'h-put') _awgHistPut(_awgHistPicked(), '고른 ');
}
/* 작성 화면으로 돌아가 그 날짜를 연다 */
async function _awgHistBack(day) {
  var s = _awg; if (!s) return;
  s.view = 'edit';
  if (!s.range || day < s.range[0] || day > s.range[1]) { s.day = day; s.el.innerHTML = '<div class="awg-load">불러오는 중…</div>'; await _awgLoad(); }
  else _awgShow(day);
}
async function _awgHistPut(items, label) {
  var s = _awg, h = s.hist; if (!s || !items.length) return;
  var to = h.to;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) { showToast('넣을 날짜를 골라 주세요', 'warn'); return; }
  await _awgHistBack(to);
  if (_awg !== s || s.view !== 'edit' || s.day !== to) return;
  await _awgPutRows(items, label + _awgLabel(to) + ' 로 ');
}

/* ─── 애니웍스: 입력 → 등록 → 확인 ─── */
function _awgValid() {
  var s = _awg, rows = _awgClean(_awgRows());
  if (!rows.length) return { err: '입력할 업무가 없습니다' };
  if (rows.length > AWG_MAX) return { err: '한 번에 ' + AWG_MAX + '행까지 등록할 수 있습니다' };
  for (var i = 0; i < rows.length; i++) {
    var it = rows[i], at = (i + 1) + '행: ';
    if (!it.orderno) return { err: at + '수주번호를 넣어 주세요', i: i, f: 'orderno' };
    if (!(it.hours > 0) || it.hours > 24) return { err: at + '작업시간을 넣어 주세요', i: i, f: 'hours' };
    if (AWG_DIVI.indexOf(it.divi) < 0) return { err: at + '사내/사외를 골라 주세요', i: i, f: 'divi' };
    if (AWG_JOB.indexOf(it.job) < 0) return { err: at + '업무구분을 골라 주세요', i: i, f: 'job' };
    if (!it.memo) return { err: at + '작업내용을 넣어 주세요', i: i, f: 'memo' };
    if (it.memo.length > AWG_MEMO) return { err: at + '작업내용은 ' + AWG_MEMO + '자까지입니다', i: i, f: 'memo' };
  }
  return { items: rows };
}
/* 내려받은 엑셀(실은 EUC-KR HTML 표) → [{day, name, orderno, hours, job, memo}] */
function _awgParseXls(b64) {
  var bin = atob(b64), u = new Uint8Array(bin.length), html, out = [];
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  try { html = new TextDecoder('euc-kr').decode(u); } catch (_) { html = new TextDecoder().decode(u); }
  var trs = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('tr'), col = null;
  [].forEach.call(trs, function (tr) {
    var c = [].map.call(tr.cells, function (x) { return x.textContent.trim(); });
    if (!col) { if (c.indexOf('일자') >= 0 && c.indexOf('이름') >= 0) col = { day: c.indexOf('일자'), name: c.indexOf('이름'), orderno: c.indexOf('수주번호'), hours: c.indexOf('시간'), job: c.indexOf('업무분장'), memo: c.indexOf('업무내용') }; return; }
    var d = String(c[col.day] || '').replace(/\D/g, '');
    if (d.length !== 8) return;
    out.push({ day: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6), name: c[col.name] || '', orderno: c[col.orderno] || '', hours: +c[col.hours] || 0, job: c[col.job] || '', memo: c[col.memo] || '' });
  });
  return out;
}
/* 그 날짜에 애니웍스에 올라가 있는 내 행 */
async function _awgMine(day) {
  var r = await _awgDesk()('download', { start: day, end: day });
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || '내려받지 못했습니다', code: r && r.code };
  var names = _awgNames(), mine = [];
  (r.files || []).forEach(function (f) {
    _awgParseXls(f.base64).forEach(function (x) { if (x.day === day && names.indexOf(x.name.replace(/\s/g, '')) >= 0) mine.push(x); });
  });
  return { ok: true, mine: mine };
}
function _awgCount(list) { var m = {}; (list || []).forEach(function (x) { var k = _awgKey(x.orderno, x.hours, x.memo); m[k] = (m[k] || 0) + 1; }); return m; }
function _awgFail(r) {
  var s = _awg; if (!s) return;
  s.note = { t: 'err', html: '❌ ' + eH((r && r.error) || '실패했습니다') };
  if (r && (r.code === 'NO_CRED' || r.code === 'LOGIN')) { _awgStatus().then(function () { if (_awg === s) _awgSync(); }); awgAcctOpen(); }
}
async function _awgFill() {
  var s = _awg, desk = _awgDesk(); if (!s || !desk || s.busy) return;
  var v = _awgValid();
  if (v.err) {
    showToast('⚠ ' + v.err, 'warn');
    var rows = [].filter.call(s.el.querySelectorAll('.awg-r'), function (r) { return _awgHasText(s.items[+r.getAttribute('data-i')]); });
    var n = rows[v.i] && rows[v.i].querySelector('[data-f="' + v.f + '"]'); if (n) n.focus();
    return;
  }
  var day = s.day;
  s.shot = null; s.note = null; s.dup = null; s.busy = 'check'; _awgSync();
  await _awgFlush();
  try {
    var before = await _awgMine(day);
    if (_awg !== s) return;
    if (!before.ok) { _awgFail(before); return; }
    s.dup = before.mine; s.busy = 'fill'; _awgSync();
    var r = await desk('fill', { date: day, items: v.items });
    if (_awg !== s) return;
    if (!r || !r.ok) { _awgFail(r); return; }
    // 애니웍스가 알려 준 프로젝트명을 채워 둔다
    var k = 0; s.items.forEach(function (it) { if (!_awgHasText(it)) return; var b = r.rows[k++]; if (b && b.prodspec) it.prodspec = b.prodspec; });
    [].forEach.call(s.el.querySelectorAll('.awg-r'), function (row) { _awgPsSync(row, s.items[+row.getAttribute('data-i')]); });
    s.shot = { png: r.png, rows: r.rows, sig: _awgSig(_awgRows()), before: before.mine };
    s.dirty = true; _awgSaveOf(s);
  } catch (e) { if (_awg === s) s.note = { t: 'err', html: '❌ ' + eH((e && e.message) || '실패했습니다') }; }
  finally { if (_awg === s) { s.busy = ''; _awgSync(); } }
}
async function _awgSend() {
  var s = _awg, desk = _awgDesk(); if (!s || !desk || s.busy) return;
  var v = _awgValid();
  if (v.err || !s.shot || s.shot.sig !== _awgSig(v.items)) { showToast('먼저 ① 웹에 입력으로 확인해 주세요', 'warn'); return; }
  var day = s.day, items = v.items, doc = s.docs[day];
  var late = new Date() > new Date(_awgDate(_awgAdd(day, 1)).getTime() + (8 * 60 + 20) * 60000);
  var msg = _awgLabel(day) + ' 업무 ' + items.length + '행 · ' + _awgSum(items) + 'h 를 애니웍스에 등록합니다.\n등록한 뒤에는 여기서 되돌릴 수 없습니다.' +
    (s.dup && s.dup.length ? '\n\n⚠ 이 날짜에 이미 ' + s.dup.length + '행이 올라가 있습니다. 그 위에 더해질 수 있습니다.' : doc && doc.status === 'sent' ? '\n\n⚠ 이 날짜는 이미 한 번 등록했습니다.' : '') +
    (late ? '\n\n마감(다음 날 08:20)이 지난 날짜라 애니웍스가 지연 경고를 띄웁니다.' : '');
  if (!(await wmConfirm(msg, { ok: '등록' }))) return;
  if (_awg !== s || s.busy) return;
  var before = _awgCount(s.shot.before);
  s.busy = 'send'; s.note = null; _awgSync();
  try {
    var r = await desk('submit');
    if (_awg !== s) return;
    s.shot = null;
    var said = r && r.messages && r.messages.length ? r.messages.join(' / ') : '';
    if (r && r.ok) await _awgMarkSent(s, day, items, said);
    else if (!r || r.code !== 'UNSURE') { _awgFail(r); return; }
    // 주간일지를 다시 내려받아 실제로 올라갔는지 본다
    s.busy = 'verify'; _awgSync();
    var after = await _awgMine(day);
    if (_awg !== s) return;
    var cnt = _awgCount(after.ok ? after.mine : []), need = _awgCount(items), found = after.ok && Object.keys(need).every(function (k) { return (cnt[k] || 0) - (before[k] || 0) >= need[k]; });
    if (found) {
      if (!(r && r.ok)) await _awgMarkSent(s, day, items, said);
      try { var c = await apiFetch('/api/gongsu/' + day + '/checked', { method: 'POST' }); if (c && c.data) s.docs[day] = c.data; } catch (_) {}
      s.note = { t: 'ok', html: '✅ <b>' + _awgLabel(day) + ' ' + items.length + '행 · ' + _awgSum(items) + 'h 등록 완료</b> — 주간일지에서도 확인했습니다.' + (said ? '<div class="awg-said">애니웍스: ' + eH(said) + '</div>' : '') };
    } else if (r && r.ok) {
      s.note = { t: 'warn', html: '✅ 등록은 눌렀습니다. 다만 주간일지 목록에서는 아직 내 행을 찾지 못했습니다' + (after.ok ? ' (이름 「' + eH(_awgNames().join(' · ')) + '」 로 찾음)' : ' (' + eH(after.error) + ')') + ' — 애니웍스에서 한 번 확인해 주세요.' + (said ? '<div class="awg-said">애니웍스: ' + eH(said) + '</div>' : '') };
    } else {
      s.note = { t: 'err', html: '❌ ' + eH(r.error) + (after.ok ? '<br>주간일지에도 올라가 있지 않습니다 — 등록되지 않은 것으로 보입니다. ① 부터 다시 해 주세요.' : '') };
    }
    if (_awg === s && s.day === day) { _awgWeekSync(); }
  } catch (e) { if (_awg === s) s.note = { t: 'err', html: '❌ ' + eH((e && e.message) || '실패했습니다') + ' — 다시 누르기 전에 애니웍스에서 올라갔는지 확인해 주세요.' }; }
  finally { if (_awg === s) { s.busy = ''; _awgSync(); } }
}
async function _awgMarkSent(s, day, items, said) {
  try {
    var r = await apiFetch('/api/gongsu/' + day + '/sent', { method: 'POST', body: JSON.stringify({ items: items, message: said }) });
    if (r && r.data) { s.docs[day] = r.data; s.dirty = false; }
    apiFetch('/api/gongsu/orders').then(function (o) { if (o && o.data && _awg === s) s.orders = o.data; }).catch(function () {});
  } catch (_) { showToast('⚠ 등록 기록을 저장하지 못했습니다 (애니웍스 등록은 그대로입니다)', 'warn'); }
}

/* ─── 수주번호 찾기 (애니웍스 팝업 조회) ─── */
function _awgFindOpen(i) {
  var s = _awg; if (!s || !_awgDesk()) return;
  if (!(s.st && s.st.hasCred)) return awgAcctOpen();
  var m = createModal({ id: 'awgFindModal', titleText: '🔍 수주번호 찾기', width: '640px', closeOnEsc: true, closeOnOverlay: true });
  var box = document.createElement('div'); box.className = 'awg awg-find-box';
  box.innerHTML = '<form class="awg-find-bar"><select class="awg-in" id="awgFindF"><option value="orderno">수주번호</option><option value="custnm">고객명</option><option value="prodspec">프로젝트명</option></select>' +
    '<input class="awg-in" id="awgFindQ" maxlength="60" placeholder="찾을 말 (비우면 전체)" value="' + eH((s.items[i] && s.items[i].orderno) || '') + '"><button class="btn btn-p" type="submit">조회</button></form>' +
    '<div class="awg-find-list" id="awgFindList"><div class="awg-load">찾을 말을 넣고 조회를 누르세요</div></div>';
  m.box.appendChild(box);
  var list = box.querySelector('#awgFindList'), rows = [];
  var run = async function () {
    list.innerHTML = '<div class="awg-load"><span class="awg-spin"></span>애니웍스에서 찾는 중…</div>';
    var r = await _awgDesk()('orders', { q: box.querySelector('#awgFindQ').value, field: box.querySelector('#awgFindF').value });
    if (!document.body.contains(list)) return;
    if (!r || !r.ok) { list.innerHTML = '<div class="awg-load">❌ ' + eH((r && r.error) || '찾지 못했습니다') + '</div>'; return; }
    rows = r.rows || [];
    list.innerHTML = rows.length ? rows.map(function (x, k) {
      var c = (x.cells && x.cells.length ? x.cells : [x.orderno, x.prodspec]);
      return '<button type="button" class="awg-find-row" data-k="' + k + '"><b>' + eH(x.orderno) + '</b><span>' + eH(c.filter(function (v) { return v && v !== x.orderno; }).join(' · ')) + '</span></button>';
    }).join('') : '<div class="awg-load">결과가 없습니다</div>';
  };
  box.querySelector('form').onsubmit = function (e) { e.preventDefault(); run(); };
  list.onclick = function (e) {
    var b = e.target.closest('.awg-find-row'), x = b && rows[+b.getAttribute('data-k')];
    if (!x || _awg !== s || !s.items[i]) return;
    s.items[i].orderno = x.orderno; s.items[i].prodspec = x.prodspec;
    if (!s.orders.some(function (o) { return o.orderno === x.orderno; })) s.orders.push({ orderno: x.orderno, prodspec: x.prodspec, divi: '', job: '', n: 0 });
    m.close(); s.shot = null; _awgPaint(); _awgTouched();
    var n = s.el.querySelector('.awg-r[data-i="' + i + '"] [data-f="hours"]'); if (n) n.focus();
  };
  var qi = box.querySelector('#awgFindQ'); qi.focus(); qi.select();
  if (qi.value) run();
}

/* ─── 애니웍스 계정 (이 PC 에만) ─── */
function awgAcctOpen() {
  var desk = _awgDesk();
  if (!desk) { showToast('애니웍스 연결은 PC 앱(업무 관리자)에서 됩니다', 'warn'); return; }
  var m = createModal({ id: 'awgAcctModal', titleText: '🔑 애니웍스 계정', width: '420px', closeOnEsc: true });
  var box = document.createElement('div'); box.className = 'awg awg-acct';
  var st = (_awg && _awg.st) || {};
  box.innerHTML = '<p class="awg-hint">애니웍스(works.animotion.co.kr)에 로그인할 아이디 · 비밀번호입니다.<br><b>이 PC 에만</b> 암호화해 저장하고, 서버나 다른 기기로 보내지 않습니다.</p>' +
    '<form><label>아이디<input class="awg-in" id="awgAcctId" maxlength="60" autocomplete="off" value="' + eH(st.id || '') + '"></label>' +
    '<label>비밀번호<input class="awg-in" id="awgAcctPw" type="password" maxlength="200" autocomplete="new-password" placeholder="' + (st.hasCred ? '바꿀 때만 다시 입력' : '') + '"></label>' +
    '<div class="awg-acct-msg" id="awgAcctMsg"></div>' +
    '<div class="awg-acct-btns">' + (st.hasCred ? '<button type="button" class="btn btn-d" id="awgAcctDel">계정 지우기</button>' : '') + '<span class="awg-sp"></span><button type="submit" class="btn btn-p">저장 · 로그인 확인</button></div></form>';
  m.box.appendChild(box);
  var msg = box.querySelector('#awgAcctMsg'), done = function () { _awgStatus().then(function () { if (_awg) _awgPaint(); }); };
  box.querySelector('form').onsubmit = async function (e) {
    e.preventDefault();
    var id = box.querySelector('#awgAcctId').value.trim(), pw = box.querySelector('#awgAcctPw').value;
    if (!id || (!pw && !st.hasCred)) { msg.textContent = '아이디 · 비밀번호를 넣어 주세요'; return; }
    msg.innerHTML = '<span class="awg-spin"></span>로그인해 보는 중…';
    if (pw) { var w = await desk('cred-set', { id: id, pw: pw }); if (!w || !w.ok) { msg.textContent = '❌ ' + ((w && w.error) || '저장하지 못했습니다'); return; } }
    var t = await desk('test');
    if (!document.body.contains(box)) return done();
    if (!t || !t.ok) { msg.textContent = '❌ ' + ((t && t.error) || '로그인하지 못했습니다'); done(); return; }
    showToast('✅ 애니웍스 연결됨 (' + id + ')', 'success'); m.close(); done();
  };
  var del = box.querySelector('#awgAcctDel');
  if (del) del.onclick = async function () { await desk('cred-clear'); showToast('애니웍스 계정을 이 PC 에서 지웠습니다'); m.close(); done(); };
  box.querySelector(st.id ? '#awgAcctPw' : '#awgAcctId').focus();
}

/* ─── 📥 주간일지 받기 → 업무일지 갱신 (PC 앱) ─── */
function awgPullOk() { return !!_awgDesk(); }
function awgPullOpen() {
  if (typeof wmGuardedModal !== 'function') return _awgPullBuild();
  return wmGuardedModal('awgPull', _awgPullBuild, 'awgPullBox');
}
function _awgPullBuild() {
  var desk = _awgDesk();
  if (!desk) { showToast('PC 앱(업무 관리자)에서 쓸 수 있습니다', 'warn'); return false; }
  if (typeof wlDenyToast === 'function' && wlDenyToast()) return false;
  var today = _awgIso(new Date()), mon = _awgMon(today);
  var m = createModal({ id: 'awgPullModal', titleText: '📥 애니웍스 주간일지 받기', width: '460px', closeOnEsc: true });
  var box = document.createElement('div'); box.id = 'awgPullBox'; box.className = 'awg awg-pull';
  box.innerHTML = '<p class="awg-hint">PC 앱이 애니웍스에서 사업부별 주간일지를 내려받아 업무일지 데이터에 넣습니다.</p>' +
    '<div class="awg-pull-r"><input type="date" class="awg-in" id="awgPullA" value="' + mon + '"><span>~</span><input type="date" class="awg-in" id="awgPullB" value="' + today + '"></div>' +
    '<div class="awg-pull-q"><button type="button" class="awg-b" data-q="0">이번 주</button><button type="button" class="awg-b" data-q="1">지난 주</button><button type="button" class="awg-b" data-q="2">최근 2주</button><button type="button" class="awg-b" data-q="m">이번 달</button></div>' +
    '<div class="awg-acct-msg" id="awgPullMsg"></div>' +
    '<div class="awg-acct-btns">' + (typeof openAnyworksModal === 'function' ? '<button type="button" class="awg-b awg-quiet" id="awgPullOld" title="사내PC 프로그램 · 클라우드 서버로 받기">예전 방식으로</button>' : '') + '<span class="awg-sp"></span><button type="button" class="btn btn-p" id="awgPullGo">받아서 업무일지 갱신</button></div>';
  m.box.appendChild(box);
  var A = box.querySelector('#awgPullA'), B = box.querySelector('#awgPullB'), msg = box.querySelector('#awgPullMsg'), go = box.querySelector('#awgPullGo');
  box.querySelector('.awg-pull-q').onclick = function (e) {
    var q = e.target.getAttribute && e.target.getAttribute('data-q'); if (q == null) return;
    if (q === 'm') { A.value = today.slice(0, 8) + '01'; B.value = today; }
    else if (q === '1') { A.value = _awgAdd(mon, -7); B.value = _awgAdd(mon, -1); }
    else if (q === '2') { A.value = _awgAdd(mon, -7); B.value = today; }
    else { A.value = mon; B.value = today; }
  };
  var old = box.querySelector('#awgPullOld'); if (old) old.onclick = function () { m.close(); openAnyworksModal(true); };
  go.onclick = async function () {
    if (!A.value || !B.value || A.value > B.value) { msg.textContent = '기간을 확인해 주세요'; return; }
    go.disabled = true; msg.innerHTML = '<span class="awg-spin"></span>애니웍스에서 내려받는 중…';
    try {
      var st = await desk('status');
      if (!st || !st.hasCred) { msg.textContent = '먼저 애니웍스 계정을 연결해 주세요'; awgAcctOpen(); return; }
      var r = await desk('download', { start: A.value, end: B.value });
      if (!document.body.contains(box)) return;
      if (!r || !r.ok) { msg.textContent = '❌ ' + ((r && r.error) || '내려받지 못했습니다'); if (r && r.code === 'LOGIN') awgAcctOpen(); return; }
      if (!r.files || !r.files.length) { msg.textContent = '그 기간에 내려받을 내용이 없습니다'; return; }
      var files = r.files.map(function (f) {
        var bin = atob(f.base64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return new File([u], f.name, { type: 'application/vnd.ms-excel' });
      });
      m.close();
      showToast('📥 ' + r.files.map(function (f) { return f.team; }).join(' · ') + ' 주간일지를 받았습니다' + (r.skipped && r.skipped.length ? ' (' + r.skipped.map(function (x) { return x.team + ' ' + x.why; }).join(', ') + ')' : ''), 'success');
      if (typeof hFiles === 'function') await hFiles(files);
    } catch (e) { if (document.body.contains(box)) msg.textContent = '❌ ' + ((e && e.message) || '실패했습니다'); }
    finally { go.disabled = false; }
  };
}

/* ─── 🔄 최근 내려받기 (v13.515) — 마지막 기록 날짜와 견줘 그 뒤 것만 받아, 묻지 않고 합치고 화면 갱신 ───
   기간: 사업부(DEPT_LIST)마다 마지막 기록 날짜 중 가장 뒤처진 날의 7일 전 ~ 오늘 (늦게 쓴 · 고친 일지를 잡으려고 겹침).
         기록이 없거나 3개월 넘게 비었으면 최근 3개월까지만 — 더 옛날은 「기간 골라 받기」.
   처음 받는 사업부(기록이 하나도 없는 곳)는 최근 3개월을 한 번 더 받는다 (한 번 받은 곳은 wm_awg_first 에 적어 둠).
   합치기는 wrAutoMerge — 추가 · 고치기만, 지우지 않음. */
var AWG_RECENT_BACK = 7, AWG_RECENT_FIRST = 92, _awgRecentBusy = false;
function _awgYmd(iso) { return String(iso).replace(/-/g, ''); }
function _awgFromYmd(s) { return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
function _awgMd(iso) { return +iso.slice(5, 7) + '/' + +iso.slice(8, 10); }
function _awgDept(team, fname) {
  var L = typeof DEPT_LIST !== 'undefined' ? DEPT_LIST : []; team = String(team || '').trim();
  for (var i = 0; i < L.length; i++) if (team && (team.indexOf(L[i]) >= 0 || L[i].indexOf(team) >= 0)) return L[i];
  return (typeof detectDept === 'function' && detectDept(fname || '')) || team;
}
/** 지금 기록 → 받을 기간 { start, end, first, last: { 사업부: 'YYYYMMDD' } } */
function awgRecentPlan(recs, today) {
  var L = typeof DEPT_LIST !== 'undefined' ? DEPT_LIST : [], last = {}, all = '';
  (recs || []).forEach(function (r) {
    if (!r.date || !/^\d{8}$/.test(r.date)) return;
    if (r.date > all) all = r.date;
    if (r.dept && L.indexOf(r.dept) >= 0 && (!last[r.dept] || r.date > last[r.dept])) last[r.dept] = r.date;
  });
  var first = _awgAdd(today, -AWG_RECENT_FIRST), ks = Object.keys(last);
  var base = ks.length ? ks.map(function (k) { return last[k]; }).sort()[0] : all;
  var start = base ? _awgAdd(_awgFromYmd(base), -AWG_RECENT_BACK) : first;
  if (start > today) start = _awgAdd(today, -AWG_RECENT_BACK);
  var capped = start < first; if (capped) start = first;
  return { start: start, end: today, first: first, last: last, lastAll: all, capped: capped };
}
function _awgFirstDone() { try { return JSON.parse(localStorage.getItem('wm_awg_first') || '[]') || []; } catch (e) { return []; } }
/* opt.silent (v13.521 자동 갱신 aw-auto.js) — 진행 창 · 알림 · 계정 창 없이 조용히. 결과를 돌려준다:
     { changed, added, updated, parts, range } · 건너뜀 { skip: 'perm'|'busy'|'cred' } · 실패 { error }
   조용히 돌 때는 내려받은 파일이 지난번과 글자 하나 안 다르면 서버 기록을 다시 읽지 않는다 (wm_awg_sig — 같은 날 · 같은 기간일 때만) */
function _awgFilesSig(files) {
  var h = 5381, n = 0;
  (files || []).forEach(function (f) { var s = (f.team || '') + '|' + (f.base64 || ''); n += s.length; for (var i = 0; i < s.length; i += 7) h = ((h << 5) + h + s.charCodeAt(i)) | 0; });
  return n + ':' + h;
}
function _awgFilesSigGet() { try { return JSON.parse(localStorage.getItem('wm_awg_sig') || 'null'); } catch (e) { return null; } }
async function awgRecentPull(opt) {
  var silent = !!(opt && opt.silent);
  var say = function (m, t) { if (!silent) showToast(m, t); };
  var desk = _awgDesk();
  if (!desk) { if (silent) return { skip: 'app' }; if (typeof openAnyworksModal === 'function') return openAnyworksModal(true); showToast('PC 앱(업무 관리자)에서 쓸 수 있습니다', 'warn'); return; }
  if (silent) { if (typeof wmCanWorklog !== 'function' || !wmCanWorklog()) return { skip: 'perm' }; }
  else if (typeof wlDenyToast === 'function' && wlDenyToast()) return;
  if (_awgRecentBusy) { say('이미 내려받는 중입니다', 'info'); return silent ? { skip: 'busy' } : undefined; }
  _awgRecentBusy = true;
  var prog = function (o) {
    if (silent || typeof wmProgress === 'undefined') return;
    if (document.getElementById('wmProgOverlay')) wmProgress.update(o);
    else wmProgress.show(Object.assign({ icon: '🔄', title: '최근 업무일지 내려받는 중', tip: '마지막 기록 뒤의 것만 받아 바뀐 것만 저장해요' }, o));
  };
  try {
    var st = await desk('status');
    if (!st || !st.hasCred) { if (silent) return { skip: 'cred' }; showToast('먼저 애니웍스 계정을 연결해 주세요', 'warn'); awgAcctOpen(); return; }
    prog({ step: '🗂 지금 기록 확인', pct: 5 });
    if (typeof wmLib === 'function') await wmLib('xlsx').catch(function () {});
    var today = _awgIso(new Date()), memo = silent ? _awgFilesSigGet() : null, existing = null, plan;
    if (memo && memo.day === today && memo.start && memo.sig) plan = { start: memo.start, end: today, first: _awgAdd(today, -AWG_RECENT_FIRST), capped: false };
    else { memo = null; existing = await wrGetAll(); plan = awgRecentPlan(existing, today); }
    var range = _awgMd(plan.start) + ' ~ ' + _awgMd(plan.end);
    prog({ sub: range, step: '🌐 애니웍스에서 내려받는 중', pct: 20 });
    var r = await desk('download', { start: plan.start, end: plan.end });
    if (!r || !r.ok) {
      var why = (r && r.error) || '내려받지 못했습니다';
      if (silent) return { error: why, code: r && r.code };
      showToast('❌ ' + why, 'error'); if (r && (r.code === 'LOGIN' || r.code === 'NO_CRED')) awgAcctOpen(); return;
    }
    var files = (r.files || []).slice(), skipped = (r.skipped || []).filter(function (x) { return x.why !== '내용 없음'; }), from = plan.start;
    var sig = _awgFilesSig(files);
    if (memo && memo.sig === sig) return { changed: 0, added: 0, updated: 0, parts: [], range: range, quick: true };
    if (!existing) existing = await wrGetAll();
    // 처음 받는 사업부 — 최근 3개월
    var has = {}, done = _awgFirstDone();
    existing.forEach(function (x) { if (x.dept) has[x.dept] = 1; });
    var fresh = (r.teams || []).filter(function (t) { return !has[_awgDept(t)] && done.indexOf(t) < 0; });
    if (existing.length && fresh.length && plan.start > plan.first) {
      prog({ sub: fresh.join(' · ') + ' — 처음 받는 사업부는 최근 3개월', step: '🌐 애니웍스에서 내려받는 중', pct: 45 });
      var r2 = await desk('download', { start: plan.first, end: _awgAdd(plan.start, -1), teams: fresh });
      if (r2 && r2.ok) { files = files.concat(r2.files || []); from = plan.first; }
    }
    try { localStorage.setItem('wm_awg_first', JSON.stringify(done.concat(fresh).slice(-30))); } catch (e) {}
    var remember = function () { if (silent) try { localStorage.setItem('wm_awg_sig', JSON.stringify({ day: today, start: plan.start, sig: sig })); } catch (e) {} };
    if (!files.length) {
      remember();
      say('받을 내용이 없습니다 (' + range + ')' + (skipped.length ? ' — ' + skipped.map(function (x) { return x.team + ' ' + x.why; }).join(', ') : ''), skipped.length ? 'warn' : 'info');
      return silent ? { changed: 0, added: 0, updated: 0, parts: [], range: range } : undefined;
    }
    prog({ step: '🔍 기존 기록과 비교', pct: 60 });
    await new Promise(function (ok) { setTimeout(ok, 30); });
    var news = [], seen = new Set();
    files.forEach(function (f) {
      var bin = atob(f.base64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var dept = _awgDept(f.team, f.name);
      parseFileBuf(u.buffer, typeof cEnc !== 'undefined' ? cEnc : 'euc-kr').forEach(function (x) {
        if (dept) x.dept = dept;
        var k = wrKey(x); if (seen.has(k)) return; seen.add(k); news.push(x);
      });
    });
    var res = wrAutoMerge(existing, news, { from: _awgYmd(from), to: _awgYmd(plan.end) });
    var diff = wrMergeDiff(existing, res.merged), changed = diff.insert.length + diff.update.length;
    if (changed) {
      prog({ sub: '추가 ' + diff.insert.length.toLocaleString() + ' · 수정 ' + diff.update.length.toLocaleString(), step: '💾 바뀐 것만 저장', pct: 75 });
      var sync = await wrSync(diff.insert, diff.update, []);
      aD = wrSortRecords(res.merged.filter(function (x) { return x.id != null; }).concat(sync.inserted));
    } else if (!silent) aD = wrSortRecords(existing.slice());
    remember();
    prog({ step: '🖥 화면 갱신', pct: 92 });
    // 조용히 돌 때는 바뀐 것이 있을 때만 화면을 다시 그린다 (보던 화면을 흔들지 않게)
    if (!silent || changed) {
      var fn = document.getElementById('fnDisp'); if (fn) fn.textContent = '애니웍스 ' + range;
      if (aD.length) applyADToUI();
    }
    var parts = Object.keys(res.by).map(function (d) {
      var b = res.by[d], s = []; if (b.added) s.push('+' + b.added); if (b.updated) s.push('수정 ' + b.updated);
      return s.length ? (d || '사업부 없음') + ' ' + s.join(' · ') : '';
    }).filter(Boolean);
    var tail = (res.missing ? ' · 애니웍스에 없는 기록 ' + res.missing + '건은 그대로 둠' : '') +
      (skipped.length ? ' · ' + skipped.map(function (x) { return x.team + ' ' + x.why; }).join(', ') : '') +
      (plan.capped ? ' · 3개월보다 옛날 것은 「기간 골라 받기」로' : '');
    say(changed ? '🔄 최근 업무일지 ' + range + ' — ' + parts.join(' / ') + tail : '✓ 이미 최신입니다 (' + range + ' · ' + news.length.toLocaleString() + '건 확인)' + tail, skipped.length ? 'warn' : 'success');
    return { range: range, added: res.added, updated: res.updated, changed: changed, parts: parts, same: res.same, missing: res.missing };
  } catch (e) { if (silent) return { error: (e && e.message) || '오류' }; showToast('❌ 최근 내려받기 실패: ' + ((e && e.message) || '오류'), 'error'); }
  finally { _awgRecentBusy = false; if (!silent && typeof wmProgress !== 'undefined') wmProgress.hide(); }
}
/* 주간 분석 툴바 단추 — PC 앱이면 「🔄 최근 받기」 로 */
(function () {
  if (!_awgDesk()) return;
  var b = document.getElementById('awRecentBtn');
  if (b) { b.innerHTML = '🔄<span class="wm-tl"> 최근 받기</span>'; b.title = '애니웍스에서 마지막 기록 뒤의 업무일지만 받아 갱신 (기간을 고르려면 ⋯ 메뉴)'; }
})();

/* 내 업무 도구 막대의 📝 공수 단추 (my-work.js 가 부름) */
function awgClick(e) {
  var b = e.target.closest && e.target.closest('[data-awg-open]');
  if (!b) return false;
  var v = b.getAttribute('data-awg-open') || '';
  if (v === 'hist') awgHistOpen(); else awgOpen(v);
  return true;
}
