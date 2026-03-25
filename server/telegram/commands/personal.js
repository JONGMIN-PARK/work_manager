/**
 * 개인 명령어 모듈: /my, /issues, /tasks, /done, /log, /my-stats
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

/** 이번 달 날짜 범위 */
function getMonthRange() {
  var now = new Date();
  var y = now.getFullYear();
  var m = ('0' + (now.getMonth() + 1)).slice(-2);
  return { start: y + m + '01', end: y + m + '31', label: y + '년 ' + parseInt(m) + '월' };
}

function create(sendMessage) {
  /** 봇 명령어: /my — 오늘 할 일 요약 */
  async function cmdMy(chatId, user) {
    var today = new Date().toISOString().slice(0, 10);
    // 미해결 이슈
    var issues = await db.query(
      "SELECT title, urgency, status FROM issues WHERE assignees::text LIKE $1 AND status NOT IN ('resolved','closed') ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END LIMIT 5",
      ['%' + user.name + '%']
    );
    // 임박 납기 (7일 이내)
    var deadlines = await db.query(
      "SELECT name, order_no, end_date FROM projects WHERE (assignees::text LIKE $1 OR created_by = $2) AND end_date BETWEEN $3 AND ($3::date + INTERVAL '7 days')::text AND status != 'done' ORDER BY end_date LIMIT 5",
      ['%' + user.name + '%', user.user_id, today]
    );

    var msg = '📋 <b>' + user.name + '님의 현황</b>\n\n';

    if (issues.rows.length > 0) {
      msg += '🔴 <b>미해결 이슈</b>\n';
      issues.rows.forEach(function (r) {
        var icon = r.urgency === 'urgent' ? '🔴' : r.urgency === 'normal' ? '🟡' : '🟢';
        msg += icon + ' ' + r.title + ' [' + r.status + ']\n';
      });
      msg += '\n';
    } else {
      msg += '✅ 미해결 이슈 없음\n\n';
    }

    if (deadlines.rows.length > 0) {
      msg += '⏰ <b>임박 납기 (7일 이내)</b>\n';
      deadlines.rows.forEach(function (r) {
        msg += '· ' + (r.order_no || '') + ' ' + r.name + ' → ' + r.end_date + '\n';
      });
    } else {
      msg += '📅 임박 납기 없음\n';
    }

    msg += '\n💡 /issues 상세 이슈 · /today 오늘 전체 · /summary 주간 요약';
    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /issues — 미해결 이슈 목록 */
  async function cmdIssues(chatId, user) {
    var issues = await db.query(
      "SELECT title, urgency, status, due_date FROM issues WHERE assignees::text LIKE $1 AND status NOT IN ('resolved','closed') ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END LIMIT 10",
      ['%' + user.name + '%']
    );

    if (issues.rows.length === 0) {
      return sendMessage(chatId, '✅ 배정된 미해결 이슈가 없습니다.');
    }

    var msg = '📌 <b>미해결 이슈 (' + issues.rows.length + '건)</b>\n\n';
    issues.rows.forEach(function (r, i) {
      var icon = r.urgency === 'urgent' ? '🔴' : r.urgency === 'normal' ? '🟡' : '🟢';
      msg += (i + 1) + '. ' + icon + ' ' + r.title;
      if (r.due_date) msg += ' (~ ' + r.due_date + ')';
      msg += '\n';
    });

    msg += '\n💡 /done 작업완료 · /today 오늘 브리핑 · /overdue 지연 현황';
    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /tasks — 미완료 작업 목록 */
  async function cmdTasks(chatId, user) {
    var checklistsR = await db.query(
      'SELECT c.id, c.project_id, c.phase, c.items, p.name as project_name FROM checklists c LEFT JOIN projects p ON p.id = c.project_id WHERE p.assignees::text LIKE $1 OR c.created_by = $2 ORDER BY p.name',
      ['%' + user.name + '%', user.user_id]
    );

    var taskNum = 0;
    var grouped = {};

    checklistsR.rows.forEach(function (cl) {
      var items = [];
      try { items = typeof cl.items === 'string' ? JSON.parse(cl.items) : (cl.items || []); } catch (_) {}
      items.forEach(function (item) {
        if (item.done === true) return;
        taskNum++;
        var projName = cl.project_name || '(프로젝트 없음)';
        if (!grouped[projName]) grouped[projName] = [];
        grouped[projName].push({
          num: taskNum,
          title: item.title || item.text || item.name || '(제목없음)'
        });
      });
    });

    if (taskNum === 0) {
      return sendMessage(chatId, '✅ 미완료 작업이 없습니다!');
    }

    var msg = '📋 <b>미완료 작업 (' + taskNum + '건)</b>\n\n';
    var projNames = Object.keys(grouped);
    projNames.forEach(function (projName) {
      msg += '<b>' + projName + '</b>\n';
      grouped[projName].forEach(function (t) {
        msg += '⬜ ' + t.num + '. ' + t.title + '\n';
      });
      msg += '\n';
    });

    msg += '💡 /done 번호 로 완료 · /checklist 프로젝트명 상세';
    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /done <번호> — 작업 완료 처리 */
  async function cmdDone(chatId, user, itemNumber) {
    if (!itemNumber || isNaN(itemNumber)) {
      return sendMessage(chatId, '사용법: /done <번호>\n\n/tasks 에서 번호를 확인하세요.');
    }

    var checklistsR = await db.query(
      'SELECT c.id, c.project_id, c.phase, c.items, p.name as project_name FROM checklists c LEFT JOIN projects p ON p.id = c.project_id WHERE p.assignees::text LIKE $1 OR c.created_by = $2 ORDER BY p.name',
      ['%' + user.name + '%', user.user_id]
    );

    var taskNum = 0;
    var targetCl = null;
    var targetItemIdx = -1;
    var targetTitle = '';

    checklistsR.rows.forEach(function (cl) {
      var items = [];
      try { items = typeof cl.items === 'string' ? JSON.parse(cl.items) : (cl.items || []); } catch (_) {}
      items.forEach(function (item, idx) {
        if (item.done === true) return;
        taskNum++;
        if (taskNum === itemNumber) {
          targetCl = cl;
          targetItemIdx = idx;
          targetTitle = item.title || item.text || item.name || '(제목없음)';
        }
      });
    });

    if (!targetCl || targetItemIdx < 0) {
      return sendMessage(chatId, '❌ 유효하지 않은 번호입니다.');
    }

    var items = [];
    try { items = typeof targetCl.items === 'string' ? JSON.parse(targetCl.items) : (targetCl.items || []); } catch (_) {}
    items[targetItemIdx].done = true;

    await db.query(
      'UPDATE checklists SET items = $1, version = version + 1 WHERE id = $2',
      [JSON.stringify(items), targetCl.id]
    );

    return sendMessage(chatId, '✅ 완료: ' + targetTitle);
  }

  /** 봇 명령어: /log — 업무일지 빠른 등록 */
  async function cmdLog(chatId, user, text) {
    var match = text.match(/^\/?(log\s+)?(\d+\.?\d*)\s*h\s+([ABDGMRS])\s*([\w-]*\d[\w-]*)?\s*(.*)/i);
    if (!match) return sendMessage(chatId, '❌ 형식: 8h D B2024-001 업무내용\n예: 4.5h A 현장점검');
    var hours = parseFloat(match[2]);
    var abbr = match[3].toUpperCase();
    var orderNo = (match[4] || '').trim() || null;
    var content = (match[5] || '').trim() || '(내용 없음)';

    var today = new Date();
    var dateStr = today.getFullYear() + ('0' + (today.getMonth() + 1)).slice(-2) + ('0' + today.getDate()).slice(-2);
    var dateDisplay = today.toISOString().slice(0, 10);

    await db.query(
      'INSERT INTO work_records (date, name, hours, abbr, order_no, content, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [dateStr, user.name, hours, abbr, orderNo, content, user.user_id]
    );

    var totalR = await db.query(
      'SELECT COALESCE(SUM(hours),0) as total FROM work_records WHERE name = $1 AND date = $2',
      [user.name, dateStr]
    );
    var total = parseFloat(totalR.rows[0].total);

    var logMsg = '✅ 업무 등록 완료\n' +
      user.name + ' | ' + dateDisplay + ' | ' + (AM[abbr] || abbr) + ' ' + hours + 'h\n' +
      (orderNo ? orderNo + ' | ' : '') + content + '\n\n' +
      '📊 오늘 합계: ' + Math.round(total * 10) / 10 + 'h' +
      '\n💡 /summary 금주 합계 · /my-stats 월간 통계';

    return sendMessage(chatId, logMsg);
  }

  /** 봇 명령어: /my-stats — 내 월간 통계 */
  async function cmdMyStats(chatId, user) {
    var m = getMonthRange();

    // 업무분장별 시간
    var abbrR = await db.query(
      'SELECT abbr, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY abbr ORDER BY hours DESC',
      [user.name, m.start, m.end]
    );

    // 주간별 시간
    var weeklyR = await db.query(
      'SELECT SUBSTRING(date,1,6) as ym, CEIL((CAST(SUBSTRING(date,7,2) AS INTEGER))::numeric / 7) as wk, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3 GROUP BY ym, wk ORDER BY wk',
      [user.name, m.start, m.end]
    );

    // 관여 수주 수
    var orderCntR = await db.query(
      'SELECT COUNT(DISTINCT order_no) as cnt FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3',
      [user.name, m.start, m.end]
    );

    // 일별 근무일 수
    var daysCntR = await db.query(
      'SELECT COUNT(DISTINCT date) as days, COALESCE(SUM(hours),0) as hours FROM work_records WHERE name = $1 AND date >= $2 AND date <= $3',
      [user.name, m.start, m.end]
    );

    var totalHours = parseFloat(daysCntR.rows[0].hours);
    var workDays = parseInt(daysCntR.rows[0].days);
    var dailyAvg = workDays > 0 ? Math.round(totalHours / workDays * 10) / 10 : 0;
    var orderCnt = parseInt(orderCntR.rows[0].cnt);
    var maxAbbr = abbrR.rows.length > 0 ? parseFloat(abbrR.rows[0].hours) : 1;

    var msg = '📊 <b>' + user.name + '님 ' + m.label + ' 통계</b>\n\n';
    msg += '⏱ 총 투입: <b>' + Math.round(totalHours * 10) / 10 + 'h</b>\n';
    msg += '📅 근무일: <b>' + workDays + '일</b>\n';
    msg += '📈 일평균: <b>' + dailyAvg + 'h</b>\n';
    msg += '📋 수주 수: <b>' + orderCnt + '건</b>\n\n';

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

    // 주간별
    if (weeklyR.rows.length > 0) {
      var maxWk = Math.max.apply(null, weeklyR.rows.map(function (r) { return parseFloat(r.hours); }));
      msg += '<b>주간별</b>\n';
      weeklyR.rows.forEach(function (r) {
        var h = parseFloat(r.hours);
        msg += '<code>' + textBar(h, maxWk, 10) + '</code> ' + r.wk + '주차 <b>' + Math.round(h * 10) / 10 + 'h</b>\n';
      });
    }

    return sendMessage(chatId, msg);
  }

  return {
    cmdMy: cmdMy,
    cmdIssues: cmdIssues,
    cmdTasks: cmdTasks,
    cmdDone: cmdDone,
    cmdLog: cmdLog,
    cmdMyStats: cmdMyStats
  };
}

module.exports = { create: create };
