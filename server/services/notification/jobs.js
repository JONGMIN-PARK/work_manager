/**
 * 스케줄 알림 작업 — 납기·브리핑·납품·주간 다이제스트·진행률/과부하 경고·액션아이템/사전검토/요소기술 리마인더.
 * app.js / scheduler 가 notification.service.js 를 통해 호출한다.
 */
var db = require('../../config/db');
var mindmapDue = require('../../lib/mindmap-due');
var myWork = require('../../lib/my-work');
var myEvents = require('../../lib/my-events');
var mwRec = require('../../lib/my-work-rec');
var krHol = require('../../../kr-holidays');
var telegramService = require('../telegram.service');
var escHtml = require('../../telegram/util/escape').escHtml;
var dispatch = require('./dispatch');

function notify(eventType, payload, targetUserIds) { return dispatch.notify(eventType, payload, targetUserIds); }
function notifyAdmins(eventType, payload, tenantId) { return dispatch.notifyAdmins(eventType, payload, tenantId); }
function notifyProjectStakeholders(eventType, payload, projectId, pre) { return dispatch.notifyProjectStakeholders(eventType, payload, projectId, pre); }

/* 날짜는 한국 기준(KST, UTC+9) — 스케줄은 UTC 로 등록돼 있어(app.js: 브리핑 23:30 UTC = KST 08:30)
 * UTC 날짜를 쓰면 브리핑이 "어제" 일정을 보냈다. DB 의 start_date/end_date 는 'YYYY-MM-DD'(VARCHAR). */
function _kstYmd(addDays) {
  var d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + (addDays || 0));
  return d.toISOString().slice(0, 10);
}
/* 'YYYY-MM-DD' 와 옛 'YYYYMMDD' 모두 허용 → UTC 자정 Date (잘못된 값은 Invalid Date) */
function _parseYmd(s) {
  var t = String(s || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(t)) return new Date(NaN);
  return new Date(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8)));
}

/** 납기 리마인더 (매일 실행) */
async function sendDeadlineReminders() {
  var today = _kstYmd(0);

  var checks = [
    { days: 3, event: 'deadline_d3' },
    { days: 1, event: 'deadline_d1' },
    { days: 0, event: 'deadline_today' }
  ];

  // 날짜 3개를 한 번에 조회(예전: 날짜별 1회) + 이해관계자를 프로젝트 수와 무관하게 3쿼리로 일괄 해석
  // (예전: 프로젝트마다 4쿼리). 발송 순서는 예전과 같이 D-3 → D-1 → 당일, 날짜 안에서는 조회 순서.
  var dateStrs = checks.map(function (c) { return _kstYmd(c.days); });
  var projects = await db.query(
    "SELECT id, name, order_no, end_date, assignees, created_by FROM projects WHERE end_date = ANY($1) AND status NOT IN ('done', 'hold')",
    [dateStrs]
  );
  var stake = await dispatch.resolveStakeholders(projects.rows.map(function (p) { return p.id; }));

  for (var i = 0; i < checks.length; i++) {
    var c = checks[i];
    var dateStr = dateStrs[i];
    var rows = projects.rows.filter(function (p) { return p.end_date === dateStr; });
    for (var j = 0; j < rows.length; j++) {
      var p = rows[j];
      var payload = { name: p.name, orderNo: p.order_no, endDate: p.end_date };
      await notifyProjectStakeholders(c.event, payload, p.id, stake.get(p.id));
    }
  }

  console.log('[Notification] Deadline reminders sent for', today);
}

/** 일일 브리핑 (매일 08:30 KST 실행) */
async function sendDailyBriefing() {
  // tenant_id는 user_id 단위로 자연 격리됨 (users.tenant_id 결합). notification_prefs/telegram_links는 user_id로 필터.
  var today = _kstYmd(0);
  var todayCompact = today.replace(/-/g, '');

  // 연동된 활성 사용자 조회
  var users = await db.query(
    "SELECT tl.chat_id, tl.user_id, u.name, u.tenant_id FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.is_active = TRUE AND u.status = 'active'"
  );
  if (!users.rows.length) {
    console.log('[Notification] Daily briefing — no active linked users');
    return;
  }

  // ─── N+1 제거: 사용자 무관 쿼리는 루프 밖에서 1회만 실행 ───
  // 1) 오늘 일정 / 오늘 납기는 같은 테넌트 사용자에게 동일 → 1회 조회 후 tenant_id 로 분리
  //    (예전에는 모든 테넌트의 일정·납기가 모든 사용자에게 발송됐다)
  var evtR = await db.query(
    // 개인 일정(프로젝트 연결 없음)은 만든 사람만 — 아래 '내 일정' 조각에 나온다 (v13.252)
    "SELECT id, tenant_id, title, type FROM (" +
    "  SELECT id, tenant_id, title, type, start_date, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY start_date) AS rn " +
    "  FROM events WHERE start_date <= $1 AND end_date >= $1 AND jsonb_array_length(COALESCE(project_ids, '[]'::jsonb)) > 0" +
    ") x WHERE rn <= 5 ORDER BY tenant_id, start_date",
    [today]
  );
  var dlR = await db.query(
    // end_date 는 'YYYY-MM-DD' 로 저장된다 — 예전엔 'YYYYMMDD' 로만 비교해 오늘 납기가 한 번도 안 잡혔다(옛 형식도 함께 허용)
    "SELECT tenant_id, name, order_no FROM projects WHERE end_date = ANY($1) AND status != 'done'",
    [[today, todayCompact]]
  );
  // 2) 알림 설정: telegram/event_today 행을 한 번에 받아 user_id → is_enabled 맵
  var prefRows = await db.query(
    "SELECT user_id, is_enabled FROM notification_prefs WHERE channel = 'telegram' AND event_type = 'event_today'"
  );
  var prefMap = {};
  prefRows.rows.forEach(function(p) { prefMap[p.user_id] = p.is_enabled; });
  // 3) 사용자별 긴급 미해결 이슈 매핑 — issue_assignees(매핑 테이블) 활용으로 N+1/메모리 필터 제거
  //    user_id 매칭이 우선이고, 누락 시 assignee_name 폴백. 백필 누락 row는 결과 제외 (동명이인 제거).
  var userIds = users.rows.map(function (u) { return u.user_id; });
  var userNames = users.rows.map(function (u) { return u.name; });
  var iaR = await db.query(
    "SELECT i.id, i.title, i.tenant_id, ia.user_id, ia.assignee_name " +
    "FROM issues i " +
    "JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.tenant_id = i.tenant_id " +
    "WHERE i.status NOT IN ('resolved','closed') AND i.urgency = 'urgent' " +
    "  AND (ia.user_id = ANY($1) OR ia.assignee_name = ANY($2))",
    [userIds, userNames]
  );
  var urgentByUser = {}; // user_id → [{id, title}]
  iaR.rows.forEach(function (r) {
    // user_id 매칭이 정확 — 우선 그것으로 매핑
    if (r.user_id) {
      (urgentByUser[r.user_id] = urgentByUser[r.user_id] || []).push({ id: r.id, title: r.title });
    }
  });
  // user_id 매핑이 없는 case는 assignee_name으로 폴백 매핑
  var byName = {};
  iaR.rows.forEach(function (r) {
    if (!r.user_id && r.assignee_name) {
      // 이름 폴백은 같은 테넌트 안에서만 (다른 회사의 동명이인에게 이슈 제목이 가지 않도록)
      var nk = r.tenant_id + '|' + r.assignee_name;
      (byName[nk] = byName[nk] || []).push({ id: r.id, title: r.title });
    }
  });
  users.rows.forEach(function (u) {
    var uk = u.tenant_id + '|' + u.name;
    if ((!urgentByUser[u.user_id] || urgentByUser[u.user_id].length === 0) && byName[uk]) {
      urgentByUser[u.user_id] = byName[uk];
    }
  });

  // 공통 메시지 조각 — 일정/납기는 같은 테넌트 사용자 공통이므로 테넌트별로 미리 조립
  var typeIcons = { milestone:'◆', meeting:'🤝', deadline:'🏁', trip:'✈️', fieldService:'🔧', periodicChk:'🛠️', dayoff:'🌴', amoff:'🌅', pmoff:'🌇', etc:'📌' };
  var evtByTenant = {}, dlByTenant = {};
  evtR.rows.forEach(function (e) { (evtByTenant[e.tenant_id] = evtByTenant[e.tenant_id] || []).push(e); });
  dlR.rows.forEach(function (r) { (dlByTenant[r.tenant_id] = dlByTenant[r.tenant_id] || []).push(r); });
  function evtBlockFor(tid, skip) {
    var rows = (evtByTenant[tid] || []).filter(function (e) { return !skip[e.id]; });
    if (!tid || !rows.length) return '';
    var b = '📅 <b>오늘 일정</b>\n';
    rows.forEach(function(e) {
      b += '  ' + (typeIcons[e.type] || '📌') + ' ' + e.title + '\n';
    });
    return b + '\n';
  }
  function dlBlockFor(tid) {
    var rows = dlByTenant[tid] || [];
    if (!tid || !rows.length) return '';
    var b = '🏁 <b>오늘 납기</b>\n';
    rows.forEach(function(r) { b += '  · ' + (r.order_no || '') + ' ' + r.name + '\n'; });
    return b + '\n';
  }

  for (var i = 0; i < users.rows.length; i++) {
    var usr = users.rows[i];
    try {
      // 알림 설정 확인 (행이 존재하고 비활성인 경우만 스킵 — 기존 동작 유지)
      if (Object.prototype.hasOwnProperty.call(prefMap, usr.user_id) && !prefMap[usr.user_id]) continue;

      var msg = '';

      // 오늘 내 일정 (시각 순) — 그 다음 회사 일정 중 내 것 아닌 것 (v13.252)
      var mine = await myEventsBlock(usr, today);
      msg += mine.text;
      msg += evtBlockFor(usr.tenant_id, mine.ids);

      // 미해결 긴급 이슈 — issue_assignees 기반 사전 매핑에서 직접 조회 (최대 3건)
      var userIssues = (urgentByUser[usr.user_id] || []).slice(0, 3);
      if (userIssues.length > 0) {
        msg += '🔴 <b>긴급 이슈 ' + userIssues.length + '건</b>\n';
        userIssues.forEach(function(r) { msg += '  · ' + escHtml(r.title) + '\n'; });
        msg += '\n';
      }

      // 오늘 납기 (공통)
      msg += dlBlockFor(usr.tenant_id);

      // 내 할 일 — 지연 · 오늘 · 이번 주 (v13.248 내 업무 탭과 같은 모음)
      msg += await myWorkBlock(usr, today);

      if (!msg) {
        msg = '✨ 오늘은 특별한 일정이 없습니다. 좋은 하루 되세요!';
      }

      var fullMsg = '☀️ <b>' + usr.name + '님, 좋은 아침입니다!</b>\n\n' + msg;
      await telegramService.sendMessage(usr.chat_id, fullMsg);

    } catch (err) {
      console.error('[DailyBriefing] Error for user', usr.name, err.message);
    }
  }
  console.log('[Notification] Daily briefing sent for', today);
}

var EVT_ICONS = { milestone:'◆', meeting:'🤝', deadline:'🏁', trip:'✈️', fieldService:'🔧', periodicChk:'🛠️', dayoff:'🌴', amoff:'🌅', pmoff:'🌇', etc:'📌' };

/** 오늘 걸리는 내 일정 (반복 회차 포함) — [{ ev, time }] 시각 순, 하루 종일이 먼저 */
async function myEventsToday(usr, today) {
  var req = { tenant: { id: usr.tenant_id }, user: { sub: usr.user_id, role: 'member' } };
  var rows = await myEvents.eventsFor(req, { id: usr.user_id, name: usr.name }, today, today);
  var out = [];
  rows.forEach(function (ev) {
    var occ = myEvents.occurrences(ev, today, today)[0];
    if (!occ) return;
    out.push({ ev: ev, time: occ.date === today ? (ev.start_time || '') : '' });
  });
  return out.sort(function (a, b) { return a.time.localeCompare(b.time); });
}

/** 브리핑용 '오늘 내 일정' 조각 — { text, ids } (ids 는 회사 일정 조각에서 뺄 것) */
async function myEventsBlock(usr, today) {
  try {
    var list = await myEventsToday(usr, today);
    var ids = {};
    if (!list.length) return { text: '', ids: ids };
    var b = '📅 <b>오늘 내 일정</b>\n';
    list.slice(0, 8).forEach(function (x) {
      ids[x.ev.id] = true;
      var t = x.time ? x.time + (x.ev.end_time && x.ev.start_date === x.ev.end_date ? '~' + x.ev.end_time : '') + ' ' : '';
      b += '  ' + (EVT_ICONS[x.ev.type] || '📌') + ' ' + escHtml(t + (x.ev.title || '일정')) + '\n';
    });
    if (list.length > 8) b += '  … 외 ' + (list.length - 8) + '건\n';
    return { text: b + '\n', ids: ids };
  } catch (e) {
    console.error('[DailyBriefing/myEvents]', usr.user_id, e.message);
    return { text: '', ids: {} };
  }
}

var LEADS = [10, 30, 60];
function leadOf(v) { v = parseInt(v, 10); return LEADS.indexOf(v) >= 0 ? v : 30; }
/** 'HH:MM' + 분 — 자정을 넘으면 '23:59' 로 막는다 (다음 날 일정은 그날 알림) */
function addMin(hm, m) {
  var t = (+hm.slice(0, 2)) * 60 + (+hm.slice(3, 5)) + m;
  if (t >= 24 * 60) return '23:59';
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

/** 시각 있는 일정 미리 알림 (5분마다) — 사람마다 10 · 30 · 60분 전 (telegram_links.remind_lead, v13.256)
 *  대상: 만든 사람(개인 일정) · 담당에 이름 있는 사람. 회차마다 한 번 */
async function sendEventSoonReminders(nowMs) {
  // 보낸 기록은 일주일만 둠 (한 시간에 한 번 정리)
  if (new Date().getUTCMinutes() < 5) await db.query("DELETE FROM event_reminder_sent WHERE sent_at < now() - interval '7 days'").catch(function () {});
  var now = new Date((nowMs || Date.now()) + 9 * 3600 * 1000);   // KST
  var today = now.toISOString().slice(0, 10);
  var hm = now.toISOString().slice(11, 16);
  if (hm === '23:59') return;
  var until = addMin(hm, Math.max.apply(null, LEADS));
  await sendTodoSoonReminders(today, hm, until).catch(function (e) { console.error('[TodoSoon]', e.message); });
  var evR = await db.query(
    "SELECT * FROM events WHERE start_time IS NOT NULL AND start_time > $1 AND start_time <= $2 AND start_date <= $3 " +
    "AND (start_date = $3 OR (repeat IN ('weekly','biweekly','monthly') AND (COALESCE(repeat_until, '') = '' OR repeat_until >= $3)))",
    [hm, until, today]
  );
  if (!evR.rows.length) return;
  var users = await db.query(
    "SELECT tl.chat_id, tl.user_id, tl.remind_lead, u.name, u.tenant_id FROM telegram_links tl JOIN users u ON u.id = tl.user_id " +
    "WHERE tl.is_active = TRUE AND u.status = 'active' AND u.tenant_id = ANY($1)",
    [evR.rows.map(function (e) { return e.tenant_id; })]
  );
  if (!users.rows.length) return;
  var off = await db.query("SELECT user_id FROM notification_prefs WHERE channel = 'telegram' AND event_type = 'event_soon' AND is_enabled = FALSE");
  var offMap = {};
  off.rows.forEach(function (r) { offMap[r.user_id] = true; });
  var sent = 0;
  for (var i = 0; i < evR.rows.length; i++) {
    var ev = evR.rows[i];
    var occ = myEvents.occurrences(ev, today, today)[0];
    if (!occ || occ.date !== today) continue;   // 오늘 시작하는 회차만
    var names = Array.isArray(ev.assignees) ? ev.assignees : [];
    var personal = !(Array.isArray(ev.project_ids) && ev.project_ids.length);
    var targets = users.rows.filter(function (u) {
      if (u.tenant_id !== ev.tenant_id || offMap[u.user_id]) return false;
      if (ev.start_time > addMin(hm, leadOf(u.remind_lead))) return false;   // 이 사람에겐 아직 이름
      return names.indexOf(u.name) >= 0 || (u.user_id === ev.created_by && (personal || !names.length));
    });
    for (var j = 0; j < targets.length; j++) {
      var u = targets[j];
      try {
        var ins = await db.query('INSERT INTO event_reminder_sent (event_id, occur_date, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING event_id', [ev.id, today, u.user_id]);
        if (!ins.rows.length) continue;
        var msg = '⏰ <b>' + leftText(hm, ev.start_time) + ' 시작</b> — ' + ev.start_time + (ev.end_time && ev.start_date === ev.end_date ? '~' + ev.end_time : '') + '\n' +
          (EVT_ICONS[ev.type] || '📌') + ' ' + escHtml(ev.title || '일정') + (ev.memo ? '\n<i>' + escHtml(String(ev.memo).slice(0, 200)) + '</i>' : '');
        await telegramService.sendMessage(u.chat_id, msg);
        sent++;
      } catch (e) {
        console.error('[EventSoon]', ev.id, u.user_id, e.message);
      }
    }
  }
  if (sent) console.log('[Notification] Event soon reminders sent:', sent);
}

/** 마감 시각 있는 개인 할 일 30분 전 알림 (v13.253) — sendEventSoonReminders 가 같이 부름 */
async function sendTodoSoonReminders(today, hm, until) {
  var r = await db.query(
    "SELECT t.id, t.title, t.due_time, t.priority, t.user_id, tl.chat_id, tl.remind_lead FROM my_todos t " +
    "JOIN telegram_links tl ON tl.user_id = t.user_id AND tl.is_active = TRUE JOIN users u ON u.id = t.user_id AND u.status = 'active' " +
    "WHERE t.done_at IS NULL AND t.deleted_at IS NULL AND t.due_date = $1 AND t.due_time > $2 AND t.due_time <= $3 " +
    "AND NOT EXISTS (SELECT 1 FROM notification_prefs np WHERE np.user_id = t.user_id AND np.channel = 'telegram' AND np.event_type = 'event_soon' AND np.is_enabled = FALSE)",
    [today, hm, until]);
  for (var i = 0; i < r.rows.length; i++) {
    var t = r.rows[i];
    if (t.due_time > addMin(hm, leadOf(t.remind_lead))) continue;
    try {
      var ins = await db.query('INSERT INTO event_reminder_sent (event_id, occur_date, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING event_id', ['todo:' + t.id, today, t.user_id]);
      if (!ins.rows.length) continue;
      await telegramService.sendMessage(t.chat_id, '⏰ <b>마감 ' + t.due_time + '</b> (' + leftText(hm, t.due_time) + ') — ✏️ ' + escHtml(t.title) + ({ 1: ' 🔴 긴급', 2: ' 🟠 높음' }[t.priority] || ''));
    } catch (e) {
      console.error('[TodoSoon]', t.id, e.message);
    }
  }
}

function leftText(hm, at) {
  var d = ((+at.slice(0, 2)) * 60 + (+at.slice(3, 5))) - ((+hm.slice(0, 2)) * 60 + (+hm.slice(3, 5)));
  return d >= 60 ? Math.floor(d / 60) + '시간' + (d % 60 ? ' ' + d % 60 + '분' : '') + ' 뒤' : Math.max(d, 1) + '분 뒤';
}

/** 저녁 6시 '내일 미리보기' (v13.256) — 내일 내 일정 + 내일 마감인 일. 둘 다 없으면 안 보냄. 끄기: event_tomorrow */
async function sendTomorrowPreview(nowMs) {
  var tomorrow = new Date((nowMs || Date.now()) + 9 * 3600 * 1000 + 86400000).toISOString().slice(0, 10);
  var users = await db.query(
    "SELECT tl.chat_id, tl.user_id, u.name, u.tenant_id FROM telegram_links tl JOIN users u ON u.id = tl.user_id " +
    "WHERE tl.is_active = TRUE AND u.status = 'active' " +
    "AND NOT EXISTS (SELECT 1 FROM notification_prefs np WHERE np.user_id = tl.user_id AND np.channel = 'telegram' AND np.event_type = 'event_tomorrow' AND np.is_enabled = FALSE)");
  var t = new Date(tomorrow + 'T00:00:00Z');
  var label = (t.getUTCMonth() + 1) + '/' + t.getUTCDate() + ' (' + '일월화수목금토'.charAt(t.getUTCDay()) + ')';
  var sent = 0;
  for (var i = 0; i < users.rows.length; i++) {
    var usr = users.rows[i];
    try {
      var evs = await myEventsToday(usr, tomorrow);
      var req = { tenant: { id: usr.tenant_id }, user: { sub: usr.user_id, role: 'member' } };
      var due = (await myWork.collect(req, [{ id: usr.user_id, name: usr.name }])).filter(function (it) { return !it.done && it.due === tomorrow; })
        .sort(function (a, b) { return (a.pri - b.pri) || ((a.dueTime || '') < (b.dueTime || '') ? -1 : 1); });
      if (!evs.length && !due.length) continue;
      var msg = '🌙 <b>내일 미리보기</b> — ' + label + '\n';
      if (evs.length) {
        msg += '\n📅 <b>일정 ' + evs.length + '</b>\n';
        evs.slice(0, 8).forEach(function (x) {
          var tm = x.time ? x.time + (x.ev.end_time && x.ev.start_date === x.ev.end_date ? '~' + x.ev.end_time : '') + ' ' : '';
          msg += '  ' + (EVT_ICONS[x.ev.type] || '📌') + ' ' + escHtml(tm + (x.ev.title || '일정')) + (x.ev.location ? ' <i>@' + escHtml(x.ev.location) + '</i>' : '') + '\n';
        });
        if (evs.length > 8) msg += '  … 외 ' + (evs.length - 8) + '건\n';
      }
      if (due.length) {
        msg += '\n📋 <b>마감 ' + due.length + '</b>\n';
        due.slice(0, 8).forEach(function (it) {
          msg += '  · ' + (it.dueTime ? it.dueTime + ' ' : '') + escHtml(it.title) + ({ 1: ' 🔴', 2: ' 🟠' }[it.pri] || '') + (it.ctx ? ' <i>(' + escHtml(it.ctx.slice(0, 30)) + ')</i>' : '') + '\n';
        });
        if (due.length > 8) msg += '  … 외 ' + (due.length - 8) + '건\n';
      }
      await telegramService.sendMessage(usr.chat_id, msg.replace(/\n$/, ''));
      sent++;
    } catch (e) {
      console.error('[TomorrowPreview]', usr.user_id, e.message);
    }
  }
  if (sent) console.log('[Notification] Tomorrow preview sent:', sent);
}

/** 브리핑용 '내 할 일' 조각 — 지연 · 오늘 마감 위주로 5건, 실패해도 브리핑은 보냄 */
async function myWorkBlock(usr, today) {
  try {
    var req = { tenant: { id: usr.tenant_id }, user: { sub: usr.user_id, role: 'member' } };
    var all = (await myWork.collect(req, [{ id: usr.user_id, name: usr.name }])).filter(function (it) { return !it.done; });
    // ⭐ 오늘 집중 (v13.253) — 어제 고른 것도 안 끝났으면 남김
    var mk = await db.query('SELECT item_key FROM my_work_marks WHERE user_id = $1 AND focus_date IS NOT NULL', [usr.user_id]);
    var focusKey = {};
    mk.rows.forEach(function (r) { focusKey[r.item_key] = true; });
    var focus = all.filter(function (it) { return focusKey[it.src + ':' + it.id]; });
    var items = all.filter(function (it) { return it.due && !focusKey[it.src + ':' + it.id]; });
    var weekEnd = myWork.daysBetween(today, myWork.mondayOf(today)) + 6;   // 오늘부터 이번 주 일요일까지 남은 날
    var late = [], todays = [], week = 0, hot = 0;
    items.forEach(function (it) {
      var d = myWork.daysBetween(today, it.due);
      if (d < 0) late.push({ it: it, d: -d });
      else if (d === 0) todays.push({ it: it, d: 0 });
      else if (d <= weekEnd) { week++; if (it.pri <= 2) hot++; }
    });
    if (!focus.length && !late.length && !todays.length && !week) return '';
    // 중요도 먼저, 같으면 오래 밀린 것부터
    late.sort(function (a, b) { return (a.it.pri - b.it.pri) || (b.d - a.d); });
    todays.sort(function (a, b) { return (a.it.pri - b.it.pri) || ((a.it.dueTime || '') < (b.it.dueTime || '') ? -1 : 1); });
    var PRI_MARK = { 1: ' 🔴', 2: ' 🟠' };
    var line = function (it) { return escHtml(it.title) + (PRI_MARK[it.pri] || '') + (it.ctx ? ' <i>(' + escHtml(it.ctx.slice(0, 30)) + ')</i>' : ''); };
    var b = '📋 <b>내 할 일</b> — ' + [focus.length ? '집중 ' + focus.length : '', late.length ? '지연 ' + late.length : '', todays.length ? '오늘 ' + todays.length : '', week ? '이번 주 ' + week + (hot ? ' (중요 ' + hot + ')' : '') : ''].filter(Boolean).join(' · ') + '\n';
    focus.sort(function (a, b) { return a.pri - b.pri; }).slice(0, 5).forEach(function (it) { b += '  ⭐ ' + line(it) + '\n'; });
    late.concat(todays).slice(0, 5).forEach(function (x) {
      b += '  ' + (x.d ? '⚠️ 지연 ' + x.d + '일' : '· 오늘' + (x.it.dueTime ? ' ' + x.it.dueTime : '')) + ' — ' + line(x.it) + '\n';
    });
    if (late.length + todays.length > 5) b += '  … 외 ' + (late.length + todays.length - 5) + '건 — 웹의 🎯 내 업무에서\n';
    return b + '\n';
  } catch (e) {
    console.error('[DailyBriefing/myWork]', usr.user_id, e.message);
    return '';
  }
}

/** 💡 내 업무 추천 (v13.274) — 5분마다 돌며, 사람마다 정해 둔 시각(telegram_links.rec_slots, 기본 13:30)이 지났고 오늘 아직 안 보낸 칸이면 보냄.
 *  평일만 · 공휴일 빼고. 서버가 잠깐 꺼졌어도 1시간 안이면 보냄. 같은 날 같은 추천(sig)이면 다시 안 보냄. 챙길 게 없으면 안 보냄 */
async function sendMyWorkRecs(nowMs) {
  var now = new Date((nowMs || Date.now()) + 9 * 3600 * 1000);
  var today = now.toISOString().slice(0, 10), hm = now.toISOString().slice(11, 16);
  var wd = now.getUTCDay();
  if (wd === 0 || wd === 6 || krHol.krHolidayName(today)) return 0;
  var mins = function (t) { return (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)); };
  var users = await db.query(
    "SELECT tl.chat_id, tl.user_id, tl.rec_slots, tl.rec_sent_date, tl.rec_sent_slots, tl.rec_sig, u.name, u.role, u.department_id, u.tenant_id " +
    "FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.is_active = TRUE AND u.status = 'active' AND COALESCE(tl.rec_slots, '') <> ''");
  var tgMw = require('../../telegram/commands/mywork');
  var sent = 0;
  for (var i = 0; i < users.rows.length; i++) {
    var usr = users.rows[i];
    try {
      var done = usr.rec_sent_date === today ? String(usr.rec_sent_slots || '').split(',').filter(Boolean) : [];
      var due = String(usr.rec_slots).split(',').filter(function (s) { return /^\d{2}:\d{2}$/.test(s) && s <= hm && done.indexOf(s) < 0 && mins(hm) - mins(s) < 60; });
      if (!due.length) continue;
      // 먼저 '보냄' 표시 — 보내다 실패해도 5분마다 거듭 시도하지 않게
      await db.query('UPDATE telegram_links SET rec_sent_date = $1, rec_sent_slots = $2 WHERE user_id = $3 AND chat_id = $4', [today, done.concat(due).join(','), usr.user_id, usr.chat_id]);
      var req = { tenant: { id: usr.tenant_id }, user: { sub: usr.user_id, role: usr.role || 'member', name: usr.name, departmentId: usr.department_id || null } };
      var mine = await mwRec.loadMine(req, { name: usr.name });
      var out = tgMw.recMessage(mine, mwRec.recommend(mine), hm < '12:00' ? '오전 추천 — 지금 하면 좋은 일' : '오후 추천 — 지금 하면 좋은 일');
      if (!out) continue;
      if (usr.rec_sent_date === today && usr.rec_sig === out.sig) continue;   // 아까와 같은 추천
      await telegramService.sendMessage(usr.chat_id, out.text, { reply_markup: out.markup });
      tgMw.remember(usr.chat_id, out.list);
      await db.query('UPDATE telegram_links SET rec_sig = $1 WHERE user_id = $2 AND chat_id = $3', [out.sig, usr.user_id, usr.chat_id]);
      sent++;
    } catch (e) {
      console.error('[MyWorkRec]', usr.user_id, e.message);
    }
  }
  if (sent) console.log('[Notification] My-work recommendations sent:', sent);
  return sent;
}

/** 수주 납품 리마인더 (매일 실행) */
async function sendOrderDeliveryReminders() {
  var checks = [
    { days: 7, event: 'order_delivery_d7' },
    { days: 3, event: 'order_delivery_d3' }
  ];

  for (var i = 0; i < checks.length; i++) {
    var c = checks[i];
    var targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + c.days);
    // Try multiple date formats
    var dateISO = targetDate.toISOString().slice(0, 10);
    var dateCompact = dateISO.replace(/-/g, '');

    var orders = await db.query(
      "SELECT order_no, client, name, delivery, manager, tenant_id FROM orders WHERE delivery = $1 OR delivery = $2",
      [dateISO, dateCompact]
    );

    // 담당자(이름, 테넌트) → user id 를 한 번에 조회 (예전: 수주마다 1회)
    var mgrOrders = orders.rows.filter(function (o) { return o.manager; });
    var mgrMap = {};
    if (mgrOrders.length) {
      var uR = await db.query(
        "SELECT DISTINCT ON (u.tenant_id, u.name) u.id, u.name, u.tenant_id FROM users u " +
        "JOIN unnest($1::text[], $2::uuid[]) AS k(name, tenant_id) ON u.name = k.name AND u.tenant_id = k.tenant_id " +
        "WHERE u.status = 'active' ORDER BY u.tenant_id, u.name",
        [mgrOrders.map(function (o) { return o.manager; }), mgrOrders.map(function (o) { return o.tenant_id; })]
      );
      uR.rows.forEach(function (u) { mgrMap[u.tenant_id + '|' + u.name] = u.id; });
    }

    for (var j = 0; j < orders.rows.length; j++) {
      var o = orders.rows[j];
      // manager가 있으면 해당 사용자에게, 없으면 관리자에게
      if (o.manager) {
        var mgrId = mgrMap[o.tenant_id + '|' + o.manager];
        if (mgrId) {
          await notify(c.event, { orderNo: o.order_no, client: o.client || o.name, delivery: o.delivery }, [mgrId]);
        }
      } else {
        await notifyAdmins(c.event, { orderNo: o.order_no, client: o.client || o.name, delivery: o.delivery }, o.tenant_id);
      }
    }
  }
  console.log('[Notification] Order delivery reminders sent');
}

/** 주간 다이제스트 (매주 월요일 실행) */
async function sendWeeklyDigest() {
  // tenant_id는 user_id 단위로 자연 격리됨 (users.tenant_id 결합).
  // 지난주 범위
  var now = new Date();
  var day = now.getDay();
  var lastMon = new Date(now);
  lastMon.setDate(now.getDate() - (day === 0 ? 13 : day + 6));
  var lastSun = new Date(lastMon);
  lastSun.setDate(lastMon.getDate() + 6);

  function fmt(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  var start = fmt(lastMon);
  var end = fmt(lastSun);

  // 테넌트별 통계 — 예전에는 전 테넌트 합산치가 모든 사용자에게 발송됐다
  async function buildDigest(tid) {
    // 팀 통계
    var totalR = await db.query(
      'SELECT COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT name) as people FROM work_records WHERE date >= $1 AND date <= $2 AND tenant_id = $3',
      [start, end, tid]
    );
    var t = totalR.rows[0];

    // 이슈 통계
    var newIssues = await db.query("SELECT COUNT(*) as cnt FROM issues WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '7 days') AND tenant_id = $2", [lastMon.toISOString().slice(0,10), tid]);
    var resolvedIssues = await db.query("SELECT COUNT(*) as cnt FROM issues WHERE resolved_date >= $1 AND resolved_date <= $2 AND tenant_id = $3", [start, end, tid]);

    // 지연 프로젝트
    var delayed = await db.query("SELECT COUNT(*) as cnt FROM projects WHERE status = 'delayed' AND tenant_id = $1", [tid]);

    // 요소기술 — 지난주 개발일지 활동 (모듈 미적용 시 조용히 스킵)
    var techLine = '';
    try {
      var techR = await db.query(
        "SELECT COUNT(DISTINCT tech_id)::int AS techs, COUNT(*)::int AS logs, COALESCE(SUM(hours),0) AS hours " +
        "FROM tech_logs WHERE deleted_at IS NULL AND created_at >= $1::date AND created_at < ($1::date + INTERVAL '7 days') AND tenant_id = $2",
        [lastMon.toISOString().slice(0, 10), tid]
      );
      var tg = techR.rows[0];
      if (tg && tg.logs > 0) {
        techLine = '🧪 요소기술: <b>' + tg.techs + '건</b> 진행 (일지 ' + tg.logs + '건 · ' +
          Math.round(parseFloat(tg.hours) * 10) / 10 + 'h)\n';
      }
    } catch (e) {
      if (e.code !== '42P01') console.error('[WeeklyDigest/tech]', e.message);
    }

    var content = '⏱ 팀 총 투입: <b>' + Math.round(parseFloat(t.hours) * 10) / 10 + 'h</b> (' + t.people + '명)\n';
    content += techLine;
    content += '✅ 해결 이슈: <b>' + resolvedIssues.rows[0].cnt + '건</b>\n';
    content += '🔴 신규 이슈: <b>' + newIssues.rows[0].cnt + '건</b>\n';
    if (parseInt(delayed.rows[0].cnt) > 0) {
      content += '⚠️ 지연 프로젝트: <b>' + delayed.rows[0].cnt + '건</b>\n';
    }
    return content;
  }
  var digestCache = {};

  // 모든 연동 사용자에게 발송
  var users = await db.query(
    "SELECT tl.chat_id, tl.user_id, u.name, u.tenant_id FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.is_active = TRUE AND u.status = 'active'"
  );

  // 알림 설정을 한 번에 조회 (예전: 사용자마다 1회). 사용자당 첫 행 기준 — 예전 rows[0] 과 동일.
  var digestPref = {};
  if (users.rows.length) {
    var prefAll = await db.query(
      "SELECT user_id, is_enabled FROM notification_prefs WHERE user_id = ANY($1) AND channel = 'telegram' AND event_type = 'weekly_digest'",
      [users.rows.map(function (u) { return u.user_id; })]
    );
    prefAll.rows.forEach(function (p) {
      if (!Object.prototype.hasOwnProperty.call(digestPref, p.user_id)) digestPref[p.user_id] = p.is_enabled;
    });
  }

  for (var i = 0; i < users.rows.length; i++) {
    var usr = users.rows[i];
    try {
      if (Object.prototype.hasOwnProperty.call(digestPref, usr.user_id) && !digestPref[usr.user_id]) continue;
      if (!usr.tenant_id) continue;
      if (!digestCache[usr.tenant_id]) digestCache[usr.tenant_id] = await buildDigest(usr.tenant_id);
      var content = digestCache[usr.tenant_id];

      var msg = '📊 <b>주간 다이제스트</b>\n' +
        '<code>' + lastMon.toLocaleDateString('ko') + ' ~ ' + lastSun.toLocaleDateString('ko') + '</code>\n\n' + content;
      await telegramService.sendMessage(usr.chat_id, msg);
    } catch (err) {
      console.error('[WeeklyDigest] Error for user', usr.name, err.message);
    }
  }
  console.log('[Notification] Weekly digest sent');
}

/** 진행률 경고 (매일 실행) — 기대 진행률보다 20%p 이상 뒤처진 프로젝트 */
async function sendProgressWarnings() {
  var today = new Date();
  var projects = await db.query(
    "SELECT id, name, order_no, start_date, end_date, progress FROM projects WHERE status = 'active' AND start_date IS NOT NULL AND end_date IS NOT NULL"
  );

  // 1) 경고 대상 선별 (순수 계산) → 2) 이해관계자 일괄 해석(3쿼리) → 3) 발송.
  //    예전에는 대상 프로젝트마다 이해관계자 4쿼리.
  var flagged = [];
  for (var i = 0; i < projects.rows.length; i++) {
    var p = projects.rows[i];
    try {
      // 예전엔 'YYYYMMDD' 로 가정해 잘라서 'YYYY-MM-DD' 저장값이 Invalid Date → 경고가 한 번도 안 나갔다
      var startD = _parseYmd(p.start_date);
      var endD = _parseYmd(p.end_date);
      if (isNaN(startD) || isNaN(endD)) continue;
      var totalDays = Math.max((endD - startD) / 86400000, 1);
      var elapsed = Math.max((today - startD) / 86400000, 0);
      var expected = Math.min(Math.round(elapsed / totalDays * 100), 100);
      var actual = p.progress || 0;

      if (expected - actual >= 20) flagged.push({ p: p, actual: actual, expected: expected });
    } catch (_) { /* skip */ }
  }
  var stake = new Map();
  try {
    stake = await dispatch.resolveStakeholders(flagged.map(function (f) { return f.p.id; }));
  } catch (e) { console.error('[ProgressWarning] stakeholder lookup error:', e.message); }
  for (var k = 0; k < flagged.length; k++) {
    var f = flagged[k];
    try {
      await notifyProjectStakeholders('progress_warning', {
        name: f.p.name, orderNo: f.p.order_no, progress: f.actual, expected: f.expected
      }, f.p.id, stake.get(f.p.id));
    } catch (_) { /* skip */ }
  }
  console.log('[Notification] Progress warnings sent');
}

/** 과부하 경고 (매일 18:00 실행) — 금주 일평균 9h 초과 */
async function sendOverloadWarnings() {
  var now = new Date();
  var day = now.getDay();
  var diffMon = day === 0 ? -6 : 1 - day;
  var mon = new Date(now);
  mon.setDate(now.getDate() + diffMon);
  function fmt(d) { return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  var start = fmt(mon);
  var end = fmt(now);

  // 테넌트별로 집계·발송한다 — 다른 테넌트 관리자에게 이름/근무시간이 새지 않도록
  var r = await db.query(
    'SELECT tenant_id, name, COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT date) as days FROM work_records WHERE date >= $1 AND date <= $2 GROUP BY tenant_id, name HAVING COUNT(DISTINCT date) >= 3',
    [start, end]
  );

  var byTenant = {};
  r.rows.forEach(function (row) {
    if (!row.tenant_id) return;  // 테넌트 없는 레코드는 수신 대상을 특정할 수 없음
    if (!(row.days > 0 && parseFloat(row.hours) / row.days > 9)) return;
    (byTenant[row.tenant_id] = byTenant[row.tenant_id] || []).push(row);
  });

  var tenantKeys = Object.keys(byTenant);
  for (var t = 0; t < tenantKeys.length; t++) {
    var overloaded = byTenant[tenantKeys[t]];
    var msg = '⚠️ <b>과부하 경고</b>\n\n';
    overloaded.forEach(function (row) {
      var avg = Math.round(parseFloat(row.hours) / row.days * 10) / 10;
      msg += '· ' + row.name + ' — 일평균 <b>' + avg + 'h</b> (' + row.days + '일간 ' + Math.round(parseFloat(row.hours) * 10) / 10 + 'h)\n';
    });

    // 같은 테넌트 관리자에게 알림
    var admins = await db.query("SELECT id FROM users WHERE role IN ('admin','manager') AND status = 'active' AND tenant_id = $1", [tenantKeys[t]]);
    var adminIds = admins.rows.map(function (a) { return a.id; });

    // 관리자들의 텔레그램 연동을 한 번에 조회 (예전: 관리자마다 1회). 사용자당 첫 행 — 예전 rows[0] 과 동일.
    var chatByUser = {};
    if (adminIds.length) {
      var linkR = await db.query('SELECT user_id, chat_id FROM telegram_links WHERE user_id = ANY($1) AND is_active = TRUE', [adminIds]);
      linkR.rows.forEach(function (l) { if (!chatByUser[l.user_id]) chatByUser[l.user_id] = l.chat_id; });
    }
    for (var i = 0; i < adminIds.length; i++) {
      if (chatByUser[adminIds[i]]) {
        await telegramService.sendMessage(chatByUser[adminIds[i]], msg);
      }
    }
  }
  console.log('[Notification] Overload warnings sent');
}

/** 회의 액션아이템 기한 D-1 리마인더 (매일 실행) */
async function sendActionItemReminders() {
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var dateStr = tomorrow.toISOString().slice(0, 10);

  var r = await db.query(
    "SELECT a.id, a.title, a.assignee_id, a.due_date, m.title AS meeting_title " +
    "FROM meeting_action_items a JOIN meetings m ON m.id = a.meeting_id AND m.tenant_id = a.tenant_id " +
    "WHERE a.status <> 'done' AND a.assignee_id IS NOT NULL AND a.due_date = $1",
    [dateStr]
  );
  for (var i = 0; i < r.rows.length; i++) {
    var a = r.rows[i];
    try {
      await notify('action_item_due', {
        actionId: a.id, title: a.title, meetingTitle: a.meeting_title, dueDate: a.due_date
      }, [a.assignee_id]);
    } catch (e) {
      console.error('[ActionReminder]', a.id, e.message);
    }
  }
  console.log('[Notification] Action item D-1 reminders checked:', r.rows.length);
}

/**
 * 마인드맵 주제 마감 알림 (매일 실행) — 담당(assigneeId)이 있는 주제의 마감 오늘 · 내일 · 지연(1·3·7·14일째)을
 * 사람마다 한 통으로 묶어 보냄. 계산은 lib/mindmap-due (순수).
 */
async function sendMindmapDueReminders() {
  var today = _kstYmd(0);
  var r = await db.query('SELECT id, title, doc FROM mindmaps WHERE deleted_at IS NULL');
  var by = mindmapDue.groupDueByUser(r.rows, today);
  var users = Object.keys(by);
  for (var i = 0; i < users.length; i++) {
    try {
      await notify('mindmap_due', { items: by[users[i]], today: today }, [users[i]]);
    } catch (e) {
      console.error('[MindmapDue]', users[i], e.message);
    }
  }
  console.log('[Notification] Mindmap due reminders:', users.length, 'users');
}

/** 사전검토 회신기한 D-1 리마인더 (매일 실행) */
async function sendPrestudyReminders() {
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var dateStr = tomorrow.toISOString().slice(0, 10);

  var r = await db.query(
    "SELECT id, title, client, owner_id, due_date FROM prestudies " +
    "WHERE deleted_at IS NULL AND owner_id IS NOT NULL AND due_date = $1 " +
    "  AND status NOT IN ('won','dropped')",
    [dateStr]
  );
  for (var i = 0; i < r.rows.length; i++) {
    var p = r.rows[i];
    try {
      await notify('prestudy_due', { prestudyId: p.id, title: p.title, client: p.client, dueDate: p.due_date }, [p.owner_id]);
    } catch (e) {
      console.error('[PrestudyReminder]', p.id, e.message);
    }
  }
  console.log('[Notification] Prestudy D-1 reminders checked:', r.rows.length);
}

/**
 * 요소기술 일지 미작성 리마인더 (주 1회 실행)
 * 진행중(developing/verifying)인데 STALE_DAYS 이상 개발일지가 없는 기술 → 담당자.
 * 일지가 한 건도 없으면 기술 생성일 기준으로 판단한다.
 */
async function sendTechStaleReminders() {
  var STALE_DAYS = 30;
  var r = await db.query(
    "SELECT t.id, t.code, t.name, t.owner_id, " +
    "  GREATEST(0, EXTRACT(DAY FROM (NOW() - COALESCE(l.last_at, t.created_at)))::int) AS days " +
    "FROM tech_assets t " +
    "LEFT JOIN (SELECT tech_id, MAX(created_at) AS last_at FROM tech_logs WHERE deleted_at IS NULL GROUP BY tech_id) l " +
    "  ON l.tech_id = t.id " +
    "WHERE t.deleted_at IS NULL AND t.owner_id IS NOT NULL " +
    "  AND t.status IN ('developing','verifying') " +
    "  AND COALESCE(l.last_at, t.created_at) < NOW() - INTERVAL '" + STALE_DAYS + " days'"
  );
  for (var i = 0; i < r.rows.length; i++) {
    var t = r.rows[i];
    try {
      await notify('tech_stale', { code: t.code, name: t.name, days: t.days }, [t.owner_id]);
    } catch (e) {
      console.error('[TechStale]', t.id, e.message);
    }
  }
  console.log('[Notification] Tech stale reminders checked:', r.rows.length);
}

module.exports = {
  sendDeadlineReminders: sendDeadlineReminders,
  sendDailyBriefing: sendDailyBriefing,
  sendOrderDeliveryReminders: sendOrderDeliveryReminders,
  sendWeeklyDigest: sendWeeklyDigest,
  sendProgressWarnings: sendProgressWarnings,
  sendOverloadWarnings: sendOverloadWarnings,
  sendActionItemReminders: sendActionItemReminders,
  sendPrestudyReminders: sendPrestudyReminders,
  sendMindmapDueReminders: sendMindmapDueReminders,
  sendTechStaleReminders: sendTechStaleReminders,
  sendEventSoonReminders: sendEventSoonReminders,
  sendTomorrowPreview: sendTomorrowPreview,
  sendMyWorkRecs: sendMyWorkRecs,
  _addMin: addMin,   // 테스트용
  _myEventsBlock: myEventsBlock,   // 테스트용
  _myWorkBlock: myWorkBlock,   // 테스트용
  _kstYmd: _kstYmd,     // 테스트용
  _parseYmd: _parseYmd
};
