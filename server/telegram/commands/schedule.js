/**
 * 일정/수주 명령어 모듈: /calendar, /today, /orders, /order, /deliveries
 */
var db = require('../../config/db');

function create(sendMessage) {
  /** 봇 명령어: /calendar — 일정 조회 */
  async function cmdCalendar(chatId, user, days) {
    days = days || 7;
    var today = new Date();
    var todayStr = today.toISOString().slice(0, 10);
    var endDate = new Date(today);
    endDate.setDate(today.getDate() + days - 1);
    var endStr = endDate.toISOString().slice(0, 10);

    var eventsR = await db.query(
      'SELECT id, title, type, start_date, end_date, assignees, memo FROM events WHERE start_date <= $1 AND end_date >= $2 ORDER BY start_date, end_date LIMIT 20',
      [endStr, todayStr]
    );

    if (eventsR.rows.length === 0) {
      return sendMessage(chatId, '📅 등록된 일정이 없습니다.');
    }

    var typeIcons = {
      milestone: '◆', meeting: '🤝', deadline: '🏁', trip: '✈️',
      fieldService: '🔧', periodicChk: '🛠️', dayoff: '🌴',
      amoff: '🌅', pmoff: '🌇', etc: '📌'
    };
    var dayNames = ['일', '월', '화', '수', '목', '금', '토'];

    // Group events by date
    var grouped = {};
    eventsR.rows.forEach(function (ev) {
      var startD = new Date(ev.start_date);
      var endD = new Date(ev.end_date);
      var cursor = new Date(Math.max(startD.getTime(), today.getTime()));
      var limit = new Date(Math.min(endD.getTime(), endDate.getTime()));
      while (cursor <= limit) {
        var dateKey = cursor.toISOString().slice(0, 10);
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(ev);
        cursor.setDate(cursor.getDate() + 1);
      }
    });

    var msg = '📅 <b>일정 (' + days + '일)</b>\n\n';
    var sortedDates = Object.keys(grouped).sort();
    sortedDates.forEach(function (dateKey) {
      var d = new Date(dateKey);
      var dayName = dayNames[d.getDay()];
      msg += '<b>' + dateKey.slice(5) + ' (' + dayName + ')</b>\n';
      grouped[dateKey].forEach(function (ev) {
        var icon = typeIcons[ev.type] || '📌';
        msg += icon + ' ' + ev.title + '\n';
      });
      msg += '\n';
    });

    msg += '💡 /today 오늘만 · /calendar 14 2주일치';
    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /today — 오늘 브리핑 */
  async function cmdToday(chatId, user) {
    var today = new Date().toISOString().slice(0, 10);
    var todayCompact = today.replace(/-/g, '');

    // 오늘 일정
    var eventsR = await db.query(
      'SELECT title, type FROM events WHERE start_date <= $1 AND end_date >= $1 ORDER BY start_date',
      [today]
    );

    // 긴급 미해결 이슈
    var issuesR = await db.query(
      "SELECT title, urgency, status FROM issues WHERE assignees::text LIKE $1 AND status NOT IN ('resolved','closed') ORDER BY CASE urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END LIMIT 3",
      ['%' + user.name + '%']
    );

    // 오늘 납기 프로젝트
    var deadlinesR = await db.query(
      "SELECT name, order_no FROM projects WHERE end_date = $1 AND status != 'done'",
      [todayCompact]
    );

    var hasContent = eventsR.rows.length > 0 || issuesR.rows.length > 0 || deadlinesR.rows.length > 0;

    if (!hasContent) {
      return sendMessage(chatId, '✨ 오늘은 특별한 일정이 없습니다. 좋은 하루 되세요!');
    }

    var typeIcons = {
      milestone: '◆', meeting: '🤝', deadline: '🏁', trip: '✈️',
      fieldService: '🔧', periodicChk: '🛠️', dayoff: '🌴',
      amoff: '🌅', pmoff: '🌇', etc: '📌'
    };

    var msg = '☀️ <b>' + user.name + '님, 오늘 브리핑</b>\n\n';

    if (eventsR.rows.length > 0) {
      msg += '📅 <b>오늘 일정</b>\n';
      eventsR.rows.forEach(function (r) {
        var icon = typeIcons[r.type] || '📌';
        msg += icon + ' ' + r.title + '\n';
      });
      msg += '\n';
    }

    if (issuesR.rows.length > 0) {
      msg += '🔴 <b>긴급 이슈</b>\n';
      issuesR.rows.forEach(function (r) {
        var icon = r.urgency === 'urgent' ? '🔴' : r.urgency === 'normal' ? '🟡' : '🟢';
        msg += icon + ' ' + r.title + ' [' + r.status + ']\n';
      });
      msg += '\n';
    }

    if (deadlinesR.rows.length > 0) {
      msg += '🏁 <b>오늘 납기</b>\n';
      deadlinesR.rows.forEach(function (r) {
        msg += '· ' + (r.order_no || '') + ' ' + r.name + '\n';
      });
    }

    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /orders — 수주 목록 */
  async function cmdOrders(chatId, user) {
    var ordersR = await db.query(
      'SELECT order_no, client, name, amount, manager, delivery, memo FROM orders ORDER BY delivery DESC NULLS LAST LIMIT 15'
    );

    if (ordersR.rows.length === 0) {
      return sendMessage(chatId, '📦 등록된 수주가 없습니다.');
    }

    var today = new Date();
    var msg = '📦 <b>수주 목록</b>\n\n';
    ordersR.rows.forEach(function (r, i) {
      msg += '<b>' + (i + 1) + '.</b> ';
      if (r.order_no) msg += '<code>' + r.order_no + '</code> ';
      msg += (r.name || r.client || '(미지정)');
      if (r.amount) {
        var amountStr = Number(r.amount).toLocaleString();
        msg += ' — ' + amountStr + '천원';
      }
      if (r.delivery) {
        msg += '\n   📅 납품: ' + r.delivery;
        var delivDate = new Date(r.delivery.slice(0, 4) + '-' + r.delivery.slice(4, 6) + '-' + r.delivery.slice(6, 8));
        if (isNaN(delivDate.getTime())) {
          delivDate = new Date(r.delivery);
        }
        var diffDays = Math.ceil((delivDate - today) / 86400000);
        if (diffDays >= 0 && diffDays <= 7) msg += ' ⚠️';
      }
      msg += '\n';
    });

    msg += '\n💡 /order 번호 상세 · /deliveries 납품 예정';
    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /order <검색어> — 수주 상세 */
  async function cmdOrder(chatId, user, query) {
    if (!query) return cmdOrders(chatId, user);

    var orderR = await db.query(
      'SELECT * FROM orders WHERE order_no ILIKE $1 OR client ILIKE $1 OR name ILIKE $1 LIMIT 1',
      ['%' + query + '%']
    );

    if (orderR.rows.length === 0) {
      return sendMessage(chatId, '❌ 수주를 찾을 수 없습니다.');
    }

    var o = orderR.rows[0];
    var msg = '📦 <b>수주 상세</b>\n\n';
    if (o.order_no) msg += '📋 수주번호: <code>' + o.order_no + '</code>\n';
    if (o.client) msg += '🏢 고객: ' + o.client + '\n';
    if (o.name) msg += '📁 건명: ' + o.name + '\n';
    if (o.amount) {
      var amountStr = Number(o.amount).toLocaleString();
      msg += '💰 금액: ' + amountStr + '천원\n';
    }
    if (o.manager) msg += '👤 담당: ' + o.manager + '\n';
    if (o.delivery) msg += '📅 납품: ' + o.delivery + '\n';
    if (o.memo) msg += '📝 메모: ' + o.memo.slice(0, 200) + '\n';

    // 투입 시간 조회
    if (o.order_no) {
      var workR = await db.query(
        'SELECT COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT name) as people FROM work_records WHERE order_no = $1',
        [o.order_no]
      );
      if (workR.rows[0]) {
        msg += '\n⏱ 투입: <b>' + Math.round(parseFloat(workR.rows[0].hours) * 10) / 10 + 'h</b> (' + workR.rows[0].people + '명)';
      }
    }

    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /deliveries — 이번 달 납품 예정 */
  async function cmdDeliveries(chatId, user) {
    var now = new Date();
    var y = now.getFullYear();
    var m = ('0' + (now.getMonth() + 1)).slice(-2);
    var startYMD = y + '-' + m + '-01';
    var endYMD = y + '-' + m + '-31';
    var startCompact = y + m + '01';
    var endCompact = y + m + '31';

    // Try both date formats
    var ordersR = await db.query(
      'SELECT order_no, client, name, delivery, manager FROM orders WHERE (delivery >= $1 AND delivery <= $2) OR (delivery >= $3 AND delivery <= $4) ORDER BY delivery',
      [startYMD, endYMD, startCompact, endCompact]
    );

    if (ordersR.rows.length === 0) {
      return sendMessage(chatId, '📦 이번 달 납품 예정이 없습니다.');
    }

    var today = new Date();
    var msg = '📦 <b>' + y + '년 ' + parseInt(m) + '월 납품 예정</b>\n\n';
    ordersR.rows.forEach(function (r, i) {
      msg += '<b>' + (i + 1) + '.</b> ';
      if (r.order_no) msg += '<code>' + r.order_no + '</code> ';
      msg += (r.name || r.client || '(미지정)');
      if (r.delivery) {
        msg += '\n   📅 ' + r.delivery;
        var delivDate = new Date(r.delivery.slice(0, 4) + '-' + r.delivery.slice(4, 6) + '-' + r.delivery.slice(6, 8));
        if (isNaN(delivDate.getTime())) {
          delivDate = new Date(r.delivery);
        }
        var diffDays = Math.ceil((delivDate - today) / 86400000);
        if (diffDays < 0) {
          msg += ' (지남)';
        } else if (diffDays === 0) {
          msg += ' (오늘!)';
        } else {
          msg += ' (D-' + diffDays + ')';
        }
      }
      if (r.manager) msg += ' 👤' + r.manager;
      msg += '\n';
    });

    return sendMessage(chatId, msg);
  }

  return {
    cmdCalendar: cmdCalendar,
    cmdToday: cmdToday,
    cmdOrders: cmdOrders,
    cmdOrder: cmdOrder,
    cmdDeliveries: cmdDeliveries
  };
}

module.exports = { create: create };
