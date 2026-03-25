/**
 * 분석 명령어 모듈: /summary, /report, /weekly-report, /overdue
 */
var db = require('../../config/db');

/** 업무분장 코드 매핑 */
var AM = { A: 'A(CS현장)', B: 'B(수주)', D: 'D(개발)', G: 'G(공통)', M: 'M(양산)', R: 'R(제안)', S: 'S(영업지원)' };

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

/** 이번 달 날짜 범위 */
function getMonthRange() {
  var now = new Date();
  var y = now.getFullYear();
  var m = ('0' + (now.getMonth() + 1)).slice(-2);
  return { start: y + m + '01', end: y + m + '31', label: y + '년 ' + parseInt(m) + '월' };
}

function create(sendMessage) {
  /** 봇 명령어: /summary — 금주 업무시간 요약 */
  async function cmdSummary(chatId, user) {
    var w = getWeekRange();

    // 내 금주 업무분장별 시간
    var abbrR = await db.query(
      'SELECT abbr, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY abbr ORDER BY hours DESC',
      [user.name, w.start, w.end]
    );
    // 일별 시간
    var dailyR = await db.query(
      'SELECT date, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY date ORDER BY date',
      [user.name, w.start, w.end]
    );
    // 수주별 시간 (상위 5)
    var orderR = await db.query(
      'SELECT order_no, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY order_no ORDER BY hours DESC LIMIT 5',
      [user.name, w.start, w.end]
    );

    var totalHours = abbrR.rows.reduce(function (s, r) { return s + parseFloat(r.hours); }, 0);
    var maxAbbr = abbrR.rows.length > 0 ? parseFloat(abbrR.rows[0].hours) : 1;
    var workDays = dailyR.rows.length;

    var msg = '📊 <b>금주 업무 요약</b>\n';
    msg += '<code>' + w.monStr + ' ~ ' + w.sunStr + '</code>\n\n';
    msg += '⏱ 총 <b>' + Math.round(totalHours * 10) / 10 + 'h</b> / ' + workDays + '일\n';
    if (workDays > 0) msg += '📈 일평균 <b>' + Math.round(totalHours / workDays * 10) / 10 + 'h</b>\n';
    msg += '\n';

    // 업무분장별 바 차트
    if (abbrR.rows.length > 0) {
      msg += '<b>업무분장별</b>\n';
      abbrR.rows.forEach(function (r) {
        var h = parseFloat(r.hours);
        var pct = totalHours > 0 ? Math.round(h / totalHours * 100) : 0;
        msg += '<code>' + textBar(h, maxAbbr, 12) + '</code> ' + (AM[r.abbr] || r.abbr) + ' <b>' + Math.round(h * 10) / 10 + 'h</b> (' + pct + '%)\n';
      });
      msg += '\n';
    }

    // 일별 근무시간
    if (dailyR.rows.length > 0) {
      var dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      var maxDay = Math.max.apply(null, dailyR.rows.map(function (r) { return parseFloat(r.hours); }));
      msg += '<b>일별 근무</b>\n';
      dailyR.rows.forEach(function (r) {
        var h = parseFloat(r.hours);
        var d = new Date(r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6, 8));
        var dayName = dayNames[d.getDay()];
        var warn = h > 9 ? ' ⚠️' : '';
        msg += '<code>' + textBar(h, maxDay, 10) + '</code> ' + dayName + ' <b>' + Math.round(h * 10) / 10 + 'h</b>' + warn + '\n';
      });
      msg += '\n';
    }

    // 주요 수주
    if (orderR.rows.length > 0) {
      msg += '<b>주요 수주 (Top5)</b>\n';
      orderR.rows.forEach(function (r, i) {
        msg += (i + 1) + '. ' + (r.order_no || '(미지정)') + ' — <b>' + Math.round(parseFloat(r.hours) * 10) / 10 + 'h</b>\n';
      });
    }

    msg += '\n💡 /my-stats 개인통계 · /report 월간 · /weekly-report 보고서';
    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /report — 월간 리포트 */
  async function cmdReport(chatId, user) {
    var m = getMonthRange();

    // 총계
    var totalR = await db.query(
      'SELECT COALESCE(SUM(hours),0) as hours, COUNT(*) as records, COUNT(DISTINCT name) as people, COUNT(DISTINCT order_no) as orders, COUNT(DISTINCT date) as days FROM work_records WHERE date >= $1 AND date <= $2',
      [m.start, m.end]
    );
    var t = totalR.rows[0];

    // 업무분장별
    var abbrR = await db.query(
      'SELECT abbr, COALESCE(SUM(hours),0) as hours FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY abbr ORDER BY hours DESC',
      [m.start, m.end]
    );

    // 인원별 (Top 10)
    var peopleR = await db.query(
      'SELECT name, COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT date) as days FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY name ORDER BY hours DESC LIMIT 10',
      [m.start, m.end]
    );

    // 프로젝트 현황
    var projR = await db.query(
      "SELECT status, COUNT(*) as cnt FROM projects WHERE status != 'done' GROUP BY status"
    );

    // 이슈 현황
    var issueR = await db.query(
      "SELECT status, COUNT(*) as cnt FROM issues GROUP BY status"
    );

    var totalHours = parseFloat(t.hours);
    var maxAbbr = abbrR.rows.length > 0 ? parseFloat(abbrR.rows[0].hours) : 1;
    var maxPeople = peopleR.rows.length > 0 ? parseFloat(peopleR.rows[0].hours) : 1;

    var msg = '📊 <b>' + m.label + ' 리포트</b>\n\n';

    // 핵심 수치
    msg += '<b>핵심 수치</b>\n';
    msg += '⏱ 총 투입: <b>' + Math.round(totalHours * 10) / 10 + 'h</b>\n';
    msg += '👥 참여 인원: <b>' + t.people + '명</b>\n';
    msg += '📋 수주 수: <b>' + t.orders + '건</b>\n';
    msg += '📅 근무일수: <b>' + t.days + '일</b>\n';
    if (t.people > 0) msg += '📈 인당 평균: <b>' + Math.round(totalHours / t.people * 10) / 10 + 'h</b>\n';
    msg += '\n';

    // 업무분장 분포
    if (abbrR.rows.length > 0) {
      msg += '<b>업무분장 분포</b>\n';
      abbrR.rows.forEach(function (r) {
        var h = parseFloat(r.hours);
        var pct = totalHours > 0 ? Math.round(h / totalHours * 100) : 0;
        msg += '<code>' + textBar(h, maxAbbr, 10) + '</code> ' + (AM[r.abbr] || r.abbr) + ' ' + Math.round(h * 10) / 10 + 'h (' + pct + '%)\n';
      });
      msg += '\n';
    }

    // 인원별 투입 Top10
    if (peopleR.rows.length > 0) {
      msg += '<b>인원별 투입 (Top10)</b>\n';
      peopleR.rows.forEach(function (r, i) {
        var h = parseFloat(r.hours);
        var avgD = r.days > 0 ? Math.round(h / r.days * 10) / 10 : 0;
        msg += '<code>' + textBar(h, maxPeople, 8) + '</code> ' + r.name + ' ' + Math.round(h * 10) / 10 + 'h (일평균 ' + avgD + 'h)\n';
      });
      msg += '\n';
    }

    // 프로젝트 현황
    if (projR.rows.length > 0) {
      var statusMap = { waiting: '⏳대기', active: '🔵진행', delayed: '⚠️지연', hold: '⏸보류' };
      msg += '<b>프로젝트 현황</b>\n';
      projR.rows.forEach(function (r) {
        msg += (statusMap[r.status] || r.status) + ': <b>' + r.cnt + '</b>  ';
      });
      msg += '\n\n';
    }

    // 이슈 현황
    if (issueR.rows.length > 0) {
      var issueMap = { open: '🟠접수', inProgress: '🔵대응중', resolved: '✅해결', closed: '⬜종결', hold: '⏸보류' };
      msg += '<b>이슈 현황</b>\n';
      issueR.rows.forEach(function (r) {
        msg += (issueMap[r.status] || r.status) + ': <b>' + r.cnt + '</b>  ';
      });
      msg += '\n';
    }

    msg += '\n💡 /weekly-report 보고서 · /team 팀원 현황 · /overdue 지연';
    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /weekly-report — 주간보고 자동 생성 */
  async function cmdWeeklyReport(chatId, user) {
    var w = getWeekRange();
    var records = await db.query(
      'SELECT abbr, order_no, content, hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 ORDER BY date, abbr',
      [user.name, w.start, w.end]
    );

    if (records.rows.length === 0) return sendMessage(chatId, '📝 금주 업무 기록이 없습니다.');

    var totalHours = 0;
    var byAbbr = {};
    var byOrder = {};
    records.rows.forEach(function(r) {
      totalHours += parseFloat(r.hours);
      if (!byAbbr[r.abbr]) byAbbr[r.abbr] = { hours: 0, items: [] };
      byAbbr[r.abbr].hours += parseFloat(r.hours);
      var contentStr = r.content || '';
      if (contentStr && byAbbr[r.abbr].items.indexOf(contentStr) === -1) byAbbr[r.abbr].items.push(contentStr);
      if (r.order_no) {
        if (!byOrder[r.order_no]) byOrder[r.order_no] = 0;
        byOrder[r.order_no] += parseFloat(r.hours);
      }
    });

    var issues = await db.query(
      "SELECT title, status FROM issues WHERE assignees::text LIKE $1 AND status NOT IN ('resolved','closed') LIMIT 5",
      ['%' + user.name + '%']
    );

    var wrMsg = '📝 <b>주간 업무 보고</b>\n';
    wrMsg += '<code>' + w.monStr + ' ~ ' + w.sunStr + '</code>\n';
    wrMsg += '작성자: ' + user.name + '\n\n';

    wrMsg += '<b>1. 금주 실적</b> (총 ' + Math.round(totalHours * 10) / 10 + 'h)\n';
    Object.keys(byAbbr).sort().forEach(function(a) {
      var info = byAbbr[a];
      wrMsg += '\n<b>' + (AM[a] || a) + '</b> — ' + Math.round(info.hours * 10) / 10 + 'h\n';
      info.items.slice(0, 5).forEach(function(item) {
        wrMsg += '  · ' + item + '\n';
      });
    });

    if (Object.keys(byOrder).length > 0) {
      wrMsg += '\n<b>2. 수주별 투입</b>\n';
      Object.entries(byOrder).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(entry) {
        wrMsg += '  · ' + entry[0] + ': ' + Math.round(entry[1] * 10) / 10 + 'h\n';
      });
    }

    if (issues.rows.length > 0) {
      wrMsg += '\n<b>3. 진행중 이슈</b>\n';
      issues.rows.forEach(function(r) {
        wrMsg += '  · ' + r.title + ' [' + r.status + ']\n';
      });
    }

    wrMsg += '\n<b>4. 차주 계획</b>\n  · (텔레그램에서 추가 입력 가능)\n';

    return sendMessage(chatId, wrMsg);
  }

  /** 봇 명령어: /overdue — 지연 프로젝트 + 긴급 미해결 이슈 */
  async function cmdOverdue(chatId, user) {
    // 지연 프로젝트
    var delayedR = await db.query(
      "SELECT name, order_no, end_date, progress FROM projects WHERE status = 'delayed' ORDER BY end_date LIMIT 10"
    );

    // 납기 지난 프로젝트
    var overdueR = await db.query(
      "SELECT name, order_no, end_date, progress FROM projects WHERE status NOT IN ('done','hold') AND end_date < $1 ORDER BY end_date LIMIT 10",
      [new Date().toISOString().slice(0, 10).replace(/-/g, '')]
    );

    // 긴급 미해결 이슈
    var urgentR = await db.query(
      "SELECT title, urgency, due_date, assignees FROM issues WHERE status NOT IN ('resolved','closed') AND urgency = 'urgent' ORDER BY due_date LIMIT 10"
    );

    // 기한 초과 이슈
    var overIssueR = await db.query(
      "SELECT title, urgency, due_date, assignees FROM issues WHERE status NOT IN ('resolved','closed') AND due_date IS NOT NULL AND due_date < $1 ORDER BY due_date LIMIT 10",
      [new Date().toISOString().slice(0, 10)]
    );

    var msg = '🚨 <b>지연/긴급 현황</b>\n\n';
    var hasContent = false;

    if (delayedR.rows.length > 0) {
      hasContent = true;
      msg += '⚠️ <b>지연 프로젝트 (' + delayedR.rows.length + ')</b>\n';
      delayedR.rows.forEach(function (r) {
        msg += '· ' + r.name;
        if (r.order_no) msg += ' [' + r.order_no + ']';
        msg += ' — ' + (r.progress || 0) + '%';
        if (r.end_date) msg += ', 납기 ' + r.end_date;
        msg += '\n';
      });
      msg += '\n';
    }

    if (overdueR.rows.length > 0) {
      hasContent = true;
      var today = new Date();
      msg += '🔴 <b>납기 초과 (' + overdueR.rows.length + ')</b>\n';
      overdueR.rows.forEach(function (r) {
        var endD = new Date(r.end_date.slice(0, 4) + '-' + r.end_date.slice(4, 6) + '-' + r.end_date.slice(6, 8));
        var diffDays = Math.floor((today - endD) / 86400000);
        msg += '· ' + r.name;
        if (r.order_no) msg += ' [' + r.order_no + ']';
        msg += ' — <b>+' + diffDays + '일</b> 초과\n';
      });
      msg += '\n';
    }

    if (urgentR.rows.length > 0) {
      hasContent = true;
      msg += '🔴 <b>긴급 이슈 (' + urgentR.rows.length + ')</b>\n';
      urgentR.rows.forEach(function (r) {
        var assignees = [];
        try { assignees = typeof r.assignees === 'string' ? JSON.parse(r.assignees) : (r.assignees || []); } catch (_) {}
        msg += '· ' + r.title;
        if (r.due_date) msg += ' (~ ' + r.due_date + ')';
        if (assignees.length > 0) msg += ' 👤' + assignees.join(',');
        msg += '\n';
      });
      msg += '\n';
    }

    if (overIssueR.rows.length > 0) {
      hasContent = true;
      msg += '⏰ <b>기한 초과 이슈 (' + overIssueR.rows.length + ')</b>\n';
      overIssueR.rows.forEach(function (r) {
        msg += '· ' + r.title + ' (기한 ' + r.due_date + ')\n';
      });
    }

    if (!hasContent) {
      msg += '✅ 지연 프로젝트 및 긴급 이슈가 없습니다!';
    }

    return sendMessage(chatId, msg);
  }

  return {
    cmdSummary: cmdSummary,
    cmdReport: cmdReport,
    cmdWeeklyReport: cmdWeeklyReport,
    cmdOverdue: cmdOverdue
  };
}

module.exports = { create: create };
