/**
 * 개인 달력 구독(.ics) 만들기 (v13.252) — 보내기만 (구글 · 아웃룩 · 애플 달력이 몇 시간마다 가져감)
 *   할 일(마감 있는 것) → 마감일 하루 종일
 *   일정 → 시각이 있으면 그 시각(UTC 로 바꿔 씀, KST = UTC+9), 없으면 하루 종일. 반복은 RRULE
 */
var myEvents = require('./my-events');

var SRC_ICON = { mindmap: '🧠', issue: '🎫', action: '📝', prestudy: '🔍', milestone: '◆', dev: '🛠', todo: '✏️' };
var EVT_ICON = { milestone: '◆', meeting: '🤝', deadline: '🏁', trip: '✈️', fieldService: '🔧', periodicChk: '🛠️', dayoff: '🌴', amoff: '🌅', pmoff: '🌇', etc: '📌' };

function esc(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function dateOnly(d) { return d.replace(/-/g, ''); }
/** KST 'YYYY-MM-DD' + 'HH:MM' → UTC 'YYYYMMDDTHHMMSSZ' */
function kstToUtc(d, t) {
  var u = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), +t.slice(0, 2) - 9, +t.slice(3, 5)));
  return u.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

/** 한 줄 75 바이트 넘으면 접기 (RFC 5545 3.1) — UTF-8 글자 중간에서 자르지 않음 */
function fold(line) {
  var out = [], cur = '', bytes = 0;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    var cp = line.codePointAt(i);
    if (cp > 0xffff) { ch = line.slice(i, i + 2); i++; }
    var n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function rrule(ev) {
  var f = { weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY' }[ev.repeat];
  if (!f) return null;
  if (ev.repeat_until) f += ';UNTIL=' + (ev.start_time ? kstToUtc(ev.repeat_until, '23:59') : dateOnly(ev.repeat_until));
  return 'RRULE:' + f;
}

/**
 * @param {string} name     달력 이름
 * @param {Array} items     my-work collect 결과
 * @param {Array} events    my-events eventsFor 결과
 * @param {string} host     UID 뒤에 붙일 이름
 */
function build(name, items, events, host) {
  var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorkManager//MyWork//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc(name), 'X-WR-TIMEZONE:Asia/Seoul', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  var now = stamp();
  items.forEach(function (it) {
    if (it.done || !it.due) return;
    L.push('BEGIN:VEVENT', 'UID:' + esc(it.src + '-' + it.id + '@' + host), 'DTSTAMP:' + now,
      'DTSTART;VALUE=DATE:' + dateOnly(it.due), 'DTEND;VALUE=DATE:' + dateOnly(myEvents.addDays(it.due, 1)),
      'SUMMARY:' + esc((SRC_ICON[it.src] || '•') + ' ' + it.title + (it.urgent ? ' (긴급)' : '')),
      'TRANSP:TRANSPARENT');
    if (it.ctx) L.push('DESCRIPTION:' + esc(it.ctx + (it.progress != null ? ' · 진행 ' + it.progress + '%' : '')));
    L.push('END:VEVENT');
  });
  events.forEach(function (ev) {
    var s = ev.start_date, e = ev.end_date && ev.end_date >= s ? ev.end_date : s;
    if (!s) return;
    L.push('BEGIN:VEVENT', 'UID:' + esc('evt-' + ev.id + '@' + host), 'DTSTAMP:' + now);
    if (ev.start_time) {
      var et = ev.end_time;
      var endD = e, endT = et;
      if (!endT || (endD === s && endT <= ev.start_time)) {   // 끝 시각이 없거나 앞서면 1시간
        var h = Math.min(23, +ev.start_time.slice(0, 2) + 1);
        endD = s; endT = (h < 10 ? '0' : '') + h + ev.start_time.slice(2);
        if (endT <= ev.start_time) endT = '23:59';
      }
      L.push('DTSTART:' + kstToUtc(s, ev.start_time), 'DTEND:' + kstToUtc(endD, endT));
    } else {
      L.push('DTSTART;VALUE=DATE:' + dateOnly(s), 'DTEND;VALUE=DATE:' + dateOnly(myEvents.addDays(e, 1)));
    }
    var rr = rrule(ev);
    if (rr) L.push(rr);
    L.push('SUMMARY:' + esc((EVT_ICON[ev.type] || '📌') + ' ' + (ev.title || '일정')));
    if (ev.memo) L.push('DESCRIPTION:' + esc(ev.memo));
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

module.exports = { build: build, kstToUtc: kstToUtc, fold: fold };
