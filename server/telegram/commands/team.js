/**
 * 팀 명령어 모듈: /team
 */
var db = require('../../config/db');

/** 텍스트 바 차트 생성 */
function textBar(value, max, width) {
  width = width || 16;
  var filled = max > 0 ? Math.round(value / max * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** 금주 월~일 날짜 범위 계산 (YYYYMMDD) */
function getWeekRange() {
  var now = new Date();
  var day = now.getDay();
  var diffMon = day === 0 ? -6 : 1 - day;
  var mon = new Date(now);
  mon.setDate(now.getDate() + diffMon);
  var sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  function fmt(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  return { start: fmt(mon), end: fmt(sun), monStr: mon.toLocaleDateString('ko'), sunStr: sun.toLocaleDateString('ko') };
}

function create(sendMessage) {
  /** 봇 명령어: /team — 팀원별 금주 투입시간 (관리자/팀장) */
  async function cmdTeam(chatId, user) {
    if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'executive') {
      return sendMessage(chatId, '🔒 관리자/팀장만 사용 가능합니다.');
    }

    var w = getWeekRange();

    var r = await db.query(
      'SELECT name, COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT date) as days, COUNT(DISTINCT order_no) as orders FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY name ORDER BY hours DESC',
      [w.start, w.end]
    );

    if (r.rows.length === 0) return sendMessage(chatId, '📊 금주 업무 기록이 없습니다.');

    var maxH = parseFloat(r.rows[0].hours);
    var totalH = r.rows.reduce(function (s, row) { return s + parseFloat(row.hours); }, 0);

    var msg = '👥 <b>팀원별 금주 투입</b>\n';
    msg += '<code>' + w.monStr + ' ~ ' + w.sunStr + '</code>\n';
    msg += '총 <b>' + r.rows.length + '명</b> / <b>' + Math.round(totalH * 10) / 10 + 'h</b>\n\n';

    r.rows.forEach(function (row, i) {
      var h = parseFloat(row.hours);
      var avgD = row.days > 0 ? Math.round(h / row.days * 10) / 10 : 0;
      var warn = avgD > 9 ? ' ⚠️' : '';
      msg += '<code>' + textBar(h, maxH, 10) + '</code> ' + row.name + ' <b>' + Math.round(h * 10) / 10 + 'h</b>';
      msg += ' (' + row.days + '일, 평균 ' + avgD + 'h)' + warn + '\n';
    });

    // 과부하/저투입 알림
    var overload = r.rows.filter(function (row) { return row.days > 0 && parseFloat(row.hours) / row.days > 9; });
    var underload = r.rows.filter(function (row) { return row.days >= 3 && parseFloat(row.hours) / row.days < 4; });

    if (overload.length > 0) {
      msg += '\n⚠️ <b>과부하 주의</b>: ' + overload.map(function (r) { return r.name; }).join(', ');
    }
    if (underload.length > 0) {
      msg += '\n💡 <b>저투입</b>: ' + underload.map(function (r) { return r.name; }).join(', ');
    }

    return sendMessage(chatId, msg);
  }

  return { cmdTeam: cmdTeam };
}

module.exports = { create: create };
