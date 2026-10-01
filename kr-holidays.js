/**
 * kr-holidays.js — 대한민국 공휴일 (대체공휴일 포함) — v13.214
 *
 * 외부 API(date.nager.at)는 한국 대체공휴일이 들쭉날쭉하다(2025 5/6·10/8 누락, 2026 3·1절을 3/2 로 옮겨 적음,
 * 2027 설날 하루 어긋남) → 규칙 + 음력 명절 표로 직접 계산한다. 순수 함수, DOM 없음.
 *
 * 규칙 (「관공서의 공휴일에 관한 규정」, 2023·2025 개정 반영)
 *  - 고정: 1/1 · 3/1 · 5/5 · 6/6 · 8/15 · 10/3 · 10/9 · 12/25, 2026년부터 5/1 노동절 · 7/17 제헌절
 *  - 음력: 설날(전날·당일·다음날) · 부처님오신날 · 추석(전날·당일·다음날) — 아래 LUNAR 표
 *  - 선거일·임시공휴일 — 아래 EXTRA 표 (정부 지정 시 추가)
 *  - 대체공휴일: 설·추석 연휴가 일요일 또는 다른 공휴일과 겹치면 연휴 다음 첫 평일.
 *    3·1절·어린이날·광복절·개천절·한글날·부처님오신날·성탄절(·노동절·제헌절)은 토/일 또는 다른 공휴일과 겹치면 다음 첫 평일.
 *    신정·현충일·선거일·임시공휴일은 대체 없음.
 *
 * 사용: krHolidayName('2026-08-17') → '광복절 대체공휴일' | ''   krHolidaysOfYear(2026) → { 'YYYY-MM-DD': '이름' }
 *       krHolidayCovered(2031) → false (음력 표 밖 — 고정 공휴일만 계산됨)
 */
(function (global) {
  // 음력 명절 양력 날짜 (설날·추석은 당일) — 한국천문연구원 월력요항 기준
  var LUNAR = {
    2024: { seol: '02-10', buddha: '05-15', chuseok: '09-17' },
    2025: { seol: '01-29', buddha: '05-05', chuseok: '10-06' },
    2026: { seol: '02-17', buddha: '05-24', chuseok: '09-25' },
    2027: { seol: '02-07', buddha: '05-13', chuseok: '09-15' },
    2028: { seol: '01-26', buddha: '05-02', chuseok: '10-03' },
    2029: { seol: '02-13', buddha: '05-20', chuseok: '09-22' },
    2030: { seol: '02-03', buddha: '05-09', chuseok: '09-12' }
  };
  // 선거일·임시공휴일 (대체공휴일 없음)
  var EXTRA = {
    '2024-04-10': '국회의원 선거일',
    '2024-10-01': '임시공휴일(국군의 날)',
    '2025-01-27': '임시공휴일',
    '2025-06-03': '대통령 선거일',
    '2026-06-03': '지방선거일',
    '2028-04-12': '국회의원 선거일',
    '2030-06-05': '지방선거일'
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function dow(s) { return parse(s).getDay(); }

  var _cache = {};

  function krHolidaysOfYear(year) {
    year = +year;
    if (_cache[year]) return _cache[year];
    var y = String(year);
    // entries: { date, name, sub: 'none' | 'weekend' | 'sunday', group? }
    var entries = [];
    function add(md, name, sub, group) { entries.push({ date: y + '-' + md, name: name, sub: sub, group: group || null }); }

    add('01-01', '신정', 'none');
    add('03-01', '3·1절', 'weekend');
    if (year >= 2026) add('05-01', '노동절', 'weekend');
    add('05-05', '어린이날', 'weekend');
    add('06-06', '현충일', 'none');
    if (year >= 2026) add('07-17', '제헌절', 'weekend');
    add('08-15', '광복절', 'weekend');
    add('10-03', '개천절', 'weekend');
    add('10-09', '한글날', 'weekend');
    add('12-25', '성탄절', 'weekend');

    var L = LUNAR[year];
    if (L) {
      [['seol', '설날'], ['chuseok', '추석']].forEach(function (pair) {
        var day = y + '-' + L[pair[0]];
        [-1, 0, 1].forEach(function (k) {
          entries.push({ date: addDays(day, k), name: k === 0 ? pair[1] : pair[1] + ' 연휴', sub: 'sunday', group: pair[0] });
        });
      });
      add(L.buddha, '부처님오신날', 'weekend');
    }
    Object.keys(EXTRA).forEach(function (d) {
      if (d.slice(0, 4) === y) entries.push({ date: d, name: EXTRA[d], sub: 'none', group: null });
    });

    // 날짜별 묶기 (연휴가 해를 넘겨도 그 해에 속한 날짜만 남긴다 — 설 전날이 12/31 인 경우는 없음)
    var byDate = {};
    entries.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    var out = {};
    Object.keys(byDate).forEach(function (d) { out[d] = byDate[d].map(function (e) { return e.name; }).join(' · '); });

    // 대체공휴일 — 날짜순으로, 잃은 날 수만큼 "기준일 다음 첫 평일(공휴일·이미 정한 대체일 제외)"
    var groupEnd = {};
    entries.forEach(function (e) { if (e.group && (!groupEnd[e.group] || e.date > groupEnd[e.group])) groupEnd[e.group] = e.date; });
    var lost = [];   // { after: 기준일, name }
    Object.keys(byDate).sort().forEach(function (d) {
      var list = byDate[d], wd = dow(d);
      var eligible = list.filter(function (e) {
        if (e.sub === 'none') return false;
        if (e.sub === 'sunday') return wd === 0 || list.length > 1;
        return wd === 0 || wd === 6 || list.length > 1;
      });
      if (!eligible.length) return;
      // 주말이면 대상마다 하루, 평일 겹침이면 (겹친 개수 - 1)일
      var n = (wd === 0 || wd === 6) ? eligible.length : list.length - 1;
      var base = eligible[0];
      var after = base.group ? groupEnd[base.group] : d;
      var nm = base.group ? (base.group === 'seol' ? '설날' : '추석') : base.name;
      for (var i = 0; i < n; i++) lost.push({ after: after, name: nm });
    });
    lost.sort(function (a, b) { return a.after < b.after ? -1 : a.after > b.after ? 1 : 0; });
    lost.forEach(function (l) {
      var c = addDays(l.after, 1);
      while (dow(c) === 0 || dow(c) === 6 || out[c]) c = addDays(c, 1);
      out[c] = l.name + ' 대체공휴일';
    });

    _cache[year] = out;
    return out;
  }

  function krHolidayName(dateStr) {
    if (!dateStr || dateStr.length < 10) return '';
    return krHolidaysOfYear(+dateStr.slice(0, 4))[dateStr.slice(0, 10)] || '';
  }
  function krHolidayCovered(year) { return !!LUNAR[+year]; }

  global.krHolidaysOfYear = krHolidaysOfYear;
  global.krHolidayName = krHolidayName;
  global.krHolidayCovered = krHolidayCovered;
  if (typeof module !== 'undefined' && module.exports) module.exports = { krHolidaysOfYear: krHolidaysOfYear, krHolidayName: krHolidayName, krHolidayCovered: krHolidayCovered };
})(typeof window !== 'undefined' ? window : globalThis);
