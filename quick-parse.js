/* quick-parse.js — 한 줄 빠른 입력 읽기 (v13.253) — 브라우저 전역 QuickParse · 서버 require 둘 다 (UMD)
 *   "내일 14:00 !긴급 견적 회신"  → { title:'견적 회신', due:'2026-10-29', time:'14:00', priority:1 }
 *   날짜  오늘 · 내일 · 모레 · 월~일(요일) · 다음주 금 · 10/30 · 10월 30일 · 2026-10-30
 *   시각  14:00 · 14:00~15:30 · 2시 · 오후 3시 · 오후 3시 반 · 9시~10시
 *   중요도 !긴급 · !높음 · !보통 · !낮음 · !1~!4 · !! (긴급) · ! (높음)
 *   종류  #회의 #출장 #외근 #연차 #오전반차 #오후반차 #검토 #기타 (일정 만들 때)
 * 읽은 낱말은 제목에서 빠진다. 아무것도 못 읽으면 전부 제목.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuickParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var PRI = { '긴급': 1, '높음': 2, '보통': 3, '낮음': 4 };
  var KIND = { '회의': 'meeting', '미팅': 'meeting', '출장': 'trip', '외근': 'fieldService', '현장': 'fieldService', '현장출동': 'fieldService',
    '연차': 'dayoff', '휴가': 'dayoff', '오전반차': 'amoff', '오후반차': 'pmoff', '검토': 'review', '기타': 'etc', '할일': 'todo', '할': 'todo' };
  var DOW = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(t) { return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); }
  function utc(d) { return new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))); }
  function add(d, n) { var t = utc(d); t.setUTCDate(t.getUTCDate() + n); return ymd(t); }
  function valid(y, m, d) { var t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? ymd(t) : null; }
  /** 월/일 — 올해, 이미 두 달 넘게 지났으면 내년 */
  function md(m, d, today) {
    var y = +today.slice(0, 4);
    var v = valid(y, m, d);
    if (v && v < add(today, -60)) v = valid(y + 1, m, d);
    return v;
  }
  /** "오후 3시 반" 같은 것 → 'HH:MM' */
  function hm(ap, h, m) {
    h = +h; m = m == null ? 0 : m === '반' ? 30 : +m;
    if (ap === '오후' && h < 12) h += 12;
    if (ap === '오전' && h === 12) h = 0;
    if (!ap && h >= 1 && h <= 7) h += 12;   // "2시" 는 업무 시간으로 — 오후 2시
    return h <= 23 && m <= 59 ? pad(h) + ':' + pad(m) : null;
  }

  var T_HM = /^(\d{1,2}):(\d{2})(?:[~\-](\d{1,2}):(\d{2}))?$/;
  var T_KO = /^(오전|오후)?(\d{1,2})시(?:(반)|(\d{1,2})분)?(?:[~\-](오전|오후)?(\d{1,2})시(?:(반)|(\d{1,2})분)?)?$/;

  function parse(text, today) {
    today = today || ymd(new Date(Date.now() + 9 * 3600000));
    var words = String(text || '').trim().split(/\s+/).filter(Boolean);
    var out = { title: '', due: null, time: null, timeEnd: null, priority: null, kind: null };
    var keep = [], nextWeek = false, pendingAp = null;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], m;
      if (out.priority == null && (m = /^!(긴급|높음|보통|낮음|[1-4])$/.exec(w))) { out.priority = PRI[m[1]] || +m[1]; continue; }
      if (out.priority == null && w === '!!') { out.priority = 1; continue; }
      if (out.priority == null && w === '!') { out.priority = 2; continue; }
      if (out.kind == null && (m = /^#(\S+)$/.exec(w)) && KIND[m[1]]) { out.kind = KIND[m[1]]; continue; }
      if (!out.due) {
        if (w === '오늘') { out.due = today; continue; }
        if (w === '내일') { out.due = add(today, 1); continue; }
        if (w === '모레') { out.due = add(today, 2); continue; }
        if (w === '다음주' || w === '다음 주') { nextWeek = true; continue; }
        if ((m = /^([일월화수목금토])(요일)?$/.exec(w)) && (m[2] || nextWeek)) {   // 한 글자 '월' 은 제목일 수 있어 '월요일' · '다음주 월' 만
          var dow = DOW[m[1]], cur = utc(today).getUTCDay();
          if (nextWeek) {   // 다음 주(월요일 시작) 그 요일
            var mon = add(today, 7 - ((cur + 6) % 7));
            out.due = add(mon, (dow + 6) % 7);
          } else {
            out.due = add(today, (dow - cur + 7) % 7);
          }
          continue;
        }
        if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w)) && valid(+m[1], +m[2], +m[3])) { out.due = valid(+m[1], +m[2], +m[3]); continue; }
        if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(w)) && md(+m[1], +m[2], today)) { out.due = md(+m[1], +m[2], today); continue; }
        if ((m = /^(\d{1,2})월$/.exec(w)) && words[i + 1] && /^(\d{1,2})일$/.test(words[i + 1])) {
          var dd = +/^(\d{1,2})일$/.exec(words[i + 1])[1];
          if (md(+m[1], dd, today)) { out.due = md(+m[1], dd, today); i++; continue; }
        }
        if ((m = /^(\d{1,2})월(\d{1,2})일$/.exec(w)) && md(+m[1], +m[2], today)) { out.due = md(+m[1], +m[2], today); continue; }
      }
      if (!out.time) {
        if (w === '오전' || w === '오후') { pendingAp = w; continue; }
        if ((m = T_HM.exec(w)) && +m[1] <= 23 && +m[2] <= 59) {
          out.time = pad(+m[1]) + ':' + m[2];
          if (m[3] != null && +m[3] <= 23 && +m[4] <= 59) out.timeEnd = pad(+m[3]) + ':' + m[4];
          continue;
        }
        if ((m = T_KO.exec(w))) {
          var ap = m[1] || pendingAp;
          var t1 = hm(ap, m[2], m[3] || m[4]);
          if (t1) {
            if (!m[3] && !m[4] && !m[6] && words[i + 1] === '반') { t1 = t1.slice(0, 3) + '30'; i++; }   // "3시 반"
            out.time = t1;
            if (m[6]) {
              var t2 = hm(m[5] || ap, m[6], m[7] || m[8]);
              if (t2 && t2 > t1) out.timeEnd = t2;
            }
            pendingAp = null;
            continue;
          }
        }
        if (pendingAp) { keep.push(pendingAp); pendingAp = null; }
      }
      if (nextWeek && !out.due) { keep.push('다음주'); nextWeek = false; }
      keep.push(w);
    }
    if (pendingAp) keep.push(pendingAp);
    if (nextWeek && !out.due) keep.push('다음주');
    out.title = keep.join(' ').trim();
    // 중요도 표시만 있고 남은 게 없으면 ('!!') 읽지 않음 — 날짜 · 종류만 있는 것('모레 #연차')은 제목 없이 돌려줌 (부르는 쪽이 제목 확인)
    if (!out.title && !out.due && !out.time && !out.kind) out = { title: String(text || '').trim(), due: null, time: null, timeEnd: null, priority: null, kind: null };
    return out;
  }

  return { parse: parse, KIND: KIND, PRI: PRI };
});
