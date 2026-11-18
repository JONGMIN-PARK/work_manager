/**
 * 🎯 내 업무 오른쪽 칸 — 📋 금주 할 일 (주간 업무) (v13.537)
 *   주간 보고서 금주 칸에서 담당(@이름)이 나인 일. ◀ ▶ 로 지난주 · 다음 주 넘겨 보기, 실적이 들어온 주는 결과(✅ · 진행률)로
 *   📁 내 프로젝트와 같은 틀(.mwj) — 접기 ▾ · 개수. 서버 GET /api/weekly-reports/mine?week=
 */
var _mww = { week: null, cache: {}, busy: {}, at: {} };   // at: 받은 시각 — 30초 지나면 다시 그릴 때 새로 받음 (v13.543)
/** 기억 비우기 — 주간 업무 저장 · 내 프로필(다른 이름) 저장 뒤 */
function mwWeekReset() { _mww.cache = {}; _mww.at = {}; _mwwRepaint(); }
var MWW_SEC = { dev: ['개발', '#2563EB'], setup: ['셋업', '#7C3AED'], cs: ['C/S', '#D97706'], etc: ['기타', '#64748B'] };
function _mwwMon(d) { var t = new Date(d + 'T00:00:00Z'); t = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000); return t.toISOString().slice(0, 10); }
function _mwwAdd(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function _mwwMd(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
function _mwwDl(s, week) {   // 기한 '12/04' · '2026-12-04' · '~12/4' → YYYY-MM-DD
  var m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s || '');
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = /(\d{1,2})\/(\d{1,2})/.exec(s || '');
  return m ? week.slice(0, 4) + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
}
function mwWeekStripHtml(today) {
  if (!_mw.data || !_mw.data.self) return '';
  var thisMon = _mwwMon(today);
  if (!_mww.week) _mww.week = thisMon;
  var w = _mww.week, d = _mww.cache[w], folded = !!_mwLS('wwfold');
  // 없거나 30초 지났으면 새로 (예전엔 페이지를 새로 고칠 때까지 처음 받은 것을 썼다 — 그사이 저장한 보고서 · 다른 이름이 안 보임)
  if ((!d || Date.now() - (_mww.at[w] || 0) > 30000) && !_mww.busy[w]) setTimeout(function () { mwWeekLoad(w); }, 0);
  var off = Math.round((Date.parse(w) - Date.parse(thisMon)) / (7 * 86400000));
  var lbl = off === 0 ? '이번 주' : off === -1 ? '지난주' : off === 1 ? '다음 주' : (off < 0 ? (-off) + '주 전' : off + '주 뒤');
  var items = d ? d.items : [], open = items.filter(function (x) { return x.status !== 'done'; }).length;
  var h = '<section class="mwj mww' + (folded ? ' is-folded' : '') + '" id="mwwStrip">' +
    '<div class="mwj-h"><button class="mwj-tri" data-mww="fold" title="접기 · 펴기">▾</button><b class="mwj-ttl" data-mww="fold">📋 금주 할 일</b>' + (d ? '<i class="mwj-n">' + open + '</i>' : '') +
      '<span class="mww-pg"><button class="mww-nav" data-mww="prev" title="지난주">◀</button><button class="mww-lbl' + (off ? ' off' : '') + '" data-mww="now" title="이번 주로">' + lbl + ' <small>' + _mwwMd(w) + '~' + _mwwMd(_mwwAdd(w, 4)) + '</small></button><button class="mww-nav" data-mww="next" title="다음 주">▶</button></span>' +
    '</div>';
  if (folded) return h + '</section>';
  if (!d) return h + '<div class="mww-e">⏳</div></section>';
  if (!items.length) return h + '<div class="mww-e">' + (d.hasReport ? lbl + ' 주간 보고서에 내 이름(@' + _mwEsc((typeof currentUser !== 'undefined' && currentUser && (currentUser.displayName || currentUser.name)) || '이름') + ')이 붙은 일이 없습니다'
    : lbl + ' 주간 보고서가 아직 없습니다') + ' · <button class="mwj-lnk" data-mww="open">주간 업무 ↗</button></div></section>';
  h += '<div class="mww-l">' + items.map(function (x) {
    var sc = MWW_SEC[x.section] || MWW_SEC.etc, done = x.status === 'done', dl = _mwwDl(x.deadline, w), dd = '';
    if (dl && !done) { var n = Math.round((Date.parse(dl) - Date.parse(today)) / 86400000); dd = '<span class="mwb-dd' + (n < 0 ? ' late' : n === 0 ? ' today' : n <= 3 ? ' soon' : '') + '">' + (n === 0 ? 'D-day' : n > 0 ? 'D-' + n : 'D+' + (-n)) + '</span>'; }
    return '<div class="mww-r' + (done ? ' is-done' : '') + '" title="' + _mwEsc([x.team, x.client, x.name].filter(Boolean).join(' · ') + (dl ? ' · 기한 ' + dl : '') + (x.members.length > 1 ? ' · 함께: ' + x.members.join(', ') : '') + (x.result ? ' · 실적 반영' : '')) + '">' +
      '<span class="mww-sec" style="--sc:' + sc[1] + '">' + sc[0] + '</span>' +
      '<span class="mww-t">' + (done ? '✅ ' : '') + (x.client ? '<b>' + _mwEsc(x.client) + '</b> ' : '') + _mwEsc(x.name) + '</span>' +
      (x.pct != null && x.pct >= 0 && !done ? '<span class="mww-p">' + x.pct + '%</span>' : '') + dd + '</div>' +
      // 할 내용 — 제목 아래 세부 줄 (v13.544)
      ((x.details || []).length ? '<ul class="mww-d' + (done ? ' is-done' : '') + '">' + x.details.map(function (t) {
        return '<li class="' + (t.sub ? 'sub' : '') + (t.status === 'done' ? ' ok' : '') + '">' + _mwEsc(String(t.text || '').replace(/^[-*•·▪◦ㄴ└>]+\s*/, '')) + '</li>';
      }).join('') + '</ul>' : '');
  }).join('') + '</div><div class="mww-f"><span>' + (d.teams.length ? _mwEsc(d.teams.join(' · ')) : '') + '</span><button class="mwj-lnk" data-mww="open">주간 업무 ↗</button></div>';
  return h + '</section>';
}
function mwWeekLoad(w) {
  if (_mww.busy[w]) return;
  _mww.busy[w] = apiFetch('/api/weekly-reports/mine?week=' + w).then(function (r) { _mww.cache[w] = (r && r.data) || { items: [], teams: [] }; _mww.at[w] = Date.now(); })
    .catch(function () { _mww.cache[w] = { items: [], teams: [], err: true }; })
    .then(function () { delete _mww.busy[w]; if (_mww.week === w) _mwwRepaint(); });
}
function _mwwRepaint() {
  var el = document.getElementById('mwwStrip'); if (!el || typeof mwToday !== 'function') return;
  var t = document.createElement('div'); t.innerHTML = mwWeekStripHtml(mwToday());
  if (t.firstElementChild) el.replaceWith(t.firstElementChild);
}
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('#mwwStrip [data-mww]'); if (!b) return;
  var a = b.getAttribute('data-mww'), today = typeof mwToday === 'function' ? mwToday() : new Date().toISOString().slice(0, 10);
  if (a === 'fold') { _mwLS('wwfold', _mwLS('wwfold') ? '' : '1'); return _mwwRepaint(); }
  if (a === 'prev' || a === 'next') { _mww.week = _mwwAdd(_mww.week || _mwwMon(today), a === 'prev' ? -7 : 7); return _mwwRepaint(); }
  if (a === 'now') { _mww.week = _mwwMon(today); delete _mww.cache[_mww.week]; return _mwwRepaint(); }   // 이번 주로 · 새로 받기
  if (a === 'open') { if (typeof setPage === 'function') setPage('weekly_report'); }
});
