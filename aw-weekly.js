/* aw-weekly.js — 🌐 주간 업무를 애니웍스 「주간업무보고」 에 올리기 (v13.517)
 *   주간 업무 작성 ⋯ › 🌐 애니웍스에 올리기 → awwOpen({ left, right, weekEnd, theme, boss })
 *     left  = 지난주 실적 미리보기 HTML → 애니웍스 「금주 업무 현황」(왼쪽 편집기)
 *     right = 금주 계획 미리보기 HTML   → 애니웍스 「차주 예정 현황」(오른쪽 편집기)
 *   등록일은 작성 주차의 금요일이 기본 (바꿀 수 있음 · 애니웍스에 이미 있는 날짜는 칩으로).
 *   공수 등록처럼 두 단계 — ① 애니웍스에 넣기(PC 앱 숨은 창 편집기에 넣고 그 화면을 캡처로 보여 줌) → 확인 → ② 저 장.
 *   PC 앱 다리 wmDesktop.aw('wwrDates' | 'wwrFill' | 'wwrSave') — desktop/anyworks.js (status.v >= 3).
 *   이름: aww… / _aww… · 스타일 .aww-* (+ 공수 창의 .awg-* 를 같이 씀). 도우미 _awgDesk · _awgIso · _awgAdd · _awgMon · _awgLabel · awgAcctOpen 은 aw-gongsu.js */
function _awwFriday(day) { return _awgAdd(_awgMon(day), 4); }
function awwOpen(p) {
  var build = function () { return _awwBuild(p || {}); };
  if (typeof wmGuardedModal !== 'function') return build();
  return wmGuardedModal('aww', build, 'awwBox');
}
function _awwBuild(p) {
  var desk = _awgDesk();
  if (!desk) { showToast('PC 앱(업무 관리자)에서 쓸 수 있습니다', 'warn'); return false; }
  if (!p.left || !p.right) { showToast('지난주 · 금주 칸을 모두 써야 애니웍스에 올릴 수 있습니다', 'warn'); return false; }
  var today = _awgIso(new Date());
  var base = /^\d{4}-\d{2}-\d{2}$/.test(p.weekEnd || '') ? p.weekEnd : today;
  var st = { dates: null, filled: null, busy: false };
  var m = createModal({ id: 'awwModal', titleText: '🌐 애니웍스 주간업무보고에 올리기', width: '760px', closeOnEsc: true });
  var box = document.createElement('div'); box.id = 'awwBox'; box.className = 'awg aww';
  box.innerHTML =
    '<p class="awg-hint">지난주 실적 → <b>금주 업무 현황</b>(왼쪽) · 금주 계획 → <b>차주 예정 현황</b>(오른쪽) 에 지금 미리보기 모양 그대로 들어갑니다' +
      (p.theme ? ' <span class="aww-th">테마 ' + eH(p.theme) + (p.boss ? ' · 👔 보고용' : ' · 직원용') + '</span>' : '') + '</p>' +
    '<div class="aww-row"><label for="awwDate">등록일</label><input type="date" class="awg-in" id="awwDate" value="' + _awwFriday(base) + '"><span class="aww-day" id="awwDay"></span>' +
      '<span class="aww-size">왼쪽 ' + p.left.length.toLocaleString() + '자 · 오른쪽 ' + p.right.length.toLocaleString() + '자</span></div>' +
    '<div class="aww-dates" id="awwDates"><span class="awg-hint"><span class="awg-spin"></span>애니웍스의 날짜 목록을 읽는 중…</span></div>' +
    '<div id="awwMsg"></div><div id="awwCap"></div>' +
    '<div class="awg-acct-btns"><span class="awg-sp"></span>' +
      '<button type="button" class="btn btn-g" id="awwFill" disabled>① 애니웍스에 넣기</button>' +
      '<button type="button" class="btn btn-p" id="awwSave" disabled title="먼저 ① 로 넣고 화면을 확인하세요">② 저 장</button></div>';
  m.box.appendChild(box);
  var D = box.querySelector('#awwDate'), dayEl = box.querySelector('#awwDay'), datesEl = box.querySelector('#awwDates'), msg = box.querySelector('#awwMsg'), cap = box.querySelector('#awwCap'),
    bFill = box.querySelector('#awwFill'), bSave = box.querySelector('#awwSave');
  var alive = function () { return document.body.contains(box); };
  var say = function (kind, html) { msg.innerHTML = html ? '<div class="awg-msg ' + kind + '">' + html + '</div>' : ''; };
  var exists = function (d) { return !!(st.dates && st.dates.some(function (x) { return x.date === d; })); };
  function paint() {
    var d = D.value, ok = /^\d{4}-\d{2}-\d{2}$/.test(d);
    var fri = ok && _awgDate(d).getDay() === 5;
    dayEl.innerHTML = !ok ? '' : eH(_awgLabel(d)) + (fri ? '' : ' <b class="aww-warn">금요일이 아님</b>') +
      (st.dates ? (exists(d) ? ' · 애니웍스에 있는 날짜' : ' · <b class="aww-new">아직 없음 — 넣을 때 새로 등록</b>') : '');
    if (st.dates) datesEl.innerHTML = '<span class="awg-hint">애니웍스에 있는 날짜</span>' + (st.dates.length ? st.dates.map(function (x) {
      return '<button type="button" class="awg-chip' + (x.date === d ? ' on' : '') + '" data-aww-d="' + eA(x.date) + '">' + eH(_awgLabel(x.date)) + '</button>'; }).join('') : '<span class="awg-hint">— 없음</span>');
    bFill.disabled = st.busy || !ok || !st.dates;
    bSave.disabled = st.busy || !st.filled || st.filled.date !== d;
  }
  function reset() { st.filled = null; cap.innerHTML = ''; say('', ''); paint(); }
  D.onchange = reset;
  datesEl.onclick = function (e) { var b = e.target.closest && e.target.closest('[data-aww-d]'); if (!b || st.busy) return; D.value = b.getAttribute('data-aww-d'); reset(); };

  (async function () {
    try {
      var s = await desk('status');
      if (!alive()) return;
      if (!s || !s.ok) { say('err', '❌ PC 앱과 연결하지 못했습니다'); return; }
      if (!(s.v >= 3)) { datesEl.innerHTML = ''; say('warn', 'PC 앱 새 버전이 필요합니다 — 화면을 새로 고치면(F5) 업데이트됩니다'); return; }
      if (!s.hasCred) { datesEl.innerHTML = ''; say('warn', '먼저 애니웍스 계정을 연결해 주세요 — 연결한 뒤 이 창을 다시 열어 주세요'); awgAcctOpen(); return; }
      var r = await desk('wwrDates');
      if (!alive()) return;
      if (!r || !r.ok) { datesEl.innerHTML = ''; say('err', '❌ ' + eH((r && r.error) || '날짜 목록을 읽지 못했습니다')); if (r && r.code === 'LOGIN') awgAcctOpen(); return; }
      st.dates = r.dates || [];
      paint();
    } catch (e) { if (alive()) say('err', '❌ ' + eH((e && e.message) || '실패했습니다')); }
  })();

  bFill.onclick = async function () {
    var d = D.value, create = false;
    if (!exists(d)) {
      var fri = _awgDate(d).getDay() === 5;
      if (!(await wmConfirm(_awgLabel(d) + ' 주간업무보고가 애니웍스에 아직 없습니다.\n이 날짜를 새로 등록할까요? (회사가 함께 보는 목록에 날짜가 생깁니다)' + (fri ? '' : '\n\n⚠ 금요일이 아닙니다.'), { ok: '새로 등록' }))) return;
      create = true;
    }
    if (!alive()) return;
    st.busy = true; st.filled = null; cap.innerHTML = ''; paint();
    say('run', '<span class="awg-spin"></span>애니웍스 화면에 넣는 중…');
    try {
      var r = await desk('wwrFill', { date: d, left: p.left, right: p.right, create: create });
      if (!alive()) return;
      if (!r || !r.ok) { say('err', '❌ ' + eH((r && r.error) || '넣지 못했습니다')); if (r && (r.code === 'LOGIN' || r.code === 'NO_CRED')) awgAcctOpen(); return; }
      if (r.created && st.dates && !exists(d)) st.dates.unshift({ date: d, seq: r.seq });
      var had = (r.before && (r.before.left || r.before.right)) ? r.before : null;
      st.filled = { date: d, had: had };
      say(had ? 'warn' : 'ok', '애니웍스 화면에 넣었습니다 — <b>아직 저장 전</b>입니다. 아래 화면을 확인하고 ② 저 장을 눌러 주세요' + (r.created ? ' · 날짜를 새로 등록했습니다' : '') +
        (had ? '<br>⚠ 이 날짜에 이미 저장해 둔 내용(금주 ' + had.left.toLocaleString() + '자 · 차주 ' + had.right.toLocaleString() + '자)이 있습니다 — 저장하면 바뀝니다' : ''));
      cap.innerHTML = r.png ? '<div class="awg-cap"><div class="awg-cap-t">애니웍스 화면 (' + eH(_awgLabel(d)) + ') — 저장 전</div><img alt="애니웍스 주간업무보고 화면" src="' + eA(r.png) + '"></div>' : '';
    } catch (e) { if (alive()) say('err', '❌ ' + eH((e && e.message) || '실패했습니다')); }
    finally { st.busy = false; if (alive()) paint(); }
  };

  bSave.onclick = async function () {
    var f = st.filled; if (!f || f.date !== D.value) return;
    if (!(await wmConfirm(_awgLabel(f.date) + ' 애니웍스 주간업무보고에 저장합니다.' + (f.had ? '\n이미 저장해 둔 내용을 바꿉니다.' : ''), { ok: '저장' }))) return;
    if (!alive()) return;
    st.busy = true; st.filled = null; paint();
    say('run', '<span class="awg-spin"></span>저장하는 중…');
    try {
      var r = await desk('wwrSave');
      if (!alive()) return;
      if (!r || !r.ok) { say('err', '❌ ' + eH((r && r.error) || '저장하지 못했습니다')); return; }
      var said = (r.messages || []).filter(Boolean).join(' / ');
      say(r.verified ? 'ok' : 'warn', (r.verified ? '✅ 저장 완료 — 애니웍스에서 다시 열어 들어간 것을 확인했습니다' : '저장을 눌렀지만 들어간 내용을 확인하지 못했습니다 — 애니웍스에서 직접 확인해 주세요' +
        (r.saved ? ' (보낸 ' + (r.sent.left + r.sent.right).toLocaleString() + '자 · 저장된 ' + (r.saved.left + r.saved.right).toLocaleString() + '자)' : '')) + (said ? '<br><span class="awg-hint">' + eH(said.slice(0, 200)) + '</span>' : ''));
      cap.innerHTML = '';
      if (r.verified) showToast('🌐 ' + _awgLabel(r.date) + ' 주간업무보고를 애니웍스에 저장했습니다', 'success');
    } catch (e) { if (alive()) say('err', '❌ ' + eH((e && e.message) || '실패했습니다')); }
    finally { st.busy = false; if (alive()) paint(); }
  };
  paint();
}
