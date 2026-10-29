/**
 * 내 업무 명령어 (v13.253): /todo · /todos · /event
 *   /todo 내일 14:00 !긴급 견적 회신     개인 할 일 (마감 · 시각 · 중요도는 한 줄에서 읽음 — quick-parse.js)
 *   /todos                              안 끝난 개인 할 일 (중요도 · 마감 순, 번호)
 *   /todo done 2                        /todos 의 2번 완료 (반복이면 다음 회차가 생김)
 *   /event 금요일 오후 3시~4시 #회의 고객 미팅    개인 일정 (#종류 없으면 기타, 시각 없으면 하루 종일)
 */
var db = require('../../config/db');
var crypto = require('crypto');
var escHtml = require('../util/escape').escHtml;
var QuickParse = require('../../../quick-parse');
var repeatNext = require('../../lib/todo-repeat').repeatNext;

var PRI = { 1: '🔴', 2: '🟠', 3: '', 4: '⚪' };
var KIND_LABEL = { meeting: '🤝 회의', trip: '✈️ 출장', fieldService: '🔧 외근', dayoff: '🌴 연차', amoff: '🌅 오전반차', pmoff: '🌇 오후반차', review: '🔍 검토', etc: '📌 일정' };
var HALF = { amoff: ['09:00', '13:00'], pmoff: ['14:00', '18:00'] };

function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
function md(d) { return d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }

async function openTodos(user) {
  var r = await db.query(
    'SELECT id, title, due_date, due_time, priority, repeat FROM my_todos WHERE user_id = $1 AND tenant_id = $2 AND done_at IS NULL AND deleted_at IS NULL ' +
    "ORDER BY priority, COALESCE(NULLIF(due_date, ''), '9999'), due_time NULLS LAST, created_at LIMIT 30",
    [user.user_id, user.tenant_id]);
  return r.rows;
}

function create(sendMessage) {
  async function cmdTodo(chatId, user, text) {
    var arg = String(text || '').trim();
    if (!arg) {
      return sendMessage(chatId, '✏️ <b>할 일 등록</b>\n<code>/todo 내일 14:00 !긴급 견적 회신</code>\n\n날짜: 오늘 · 내일 · 모레 · 금요일 · 다음주 월 · 10/30\n시각: 14:00 · 오후 3시\n중요도: !긴급 !높음 !낮음\n\n/todos — 목록 · <code>/todo done 2</code> — 완료');
    }
    var dm = /^(done|완료)\s+(\d+)$/.exec(arg);
    if (dm) return cmdTodoDone(chatId, user, +dm[2]);
    var q = QuickParse.parse(arg, kstToday());
    var title = q.title.slice(0, 500);
    if (!title) return sendMessage(chatId, '✏️ 할 일 내용을 적어 주세요. 예: <code>/todo 내일 견적 회신</code>');
    var cnt = await db.query('SELECT COUNT(*)::int AS n FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND done_at IS NULL AND deleted_at IS NULL', [user.tenant_id, user.user_id]);
    if (cnt.rows[0].n >= 300) return sendMessage(chatId, '⚠️ 끝나지 않은 개인 할 일은 300개까지입니다.');
    await db.query('INSERT INTO my_todos (id, tenant_id, user_id, title, due_date, due_time, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['todo-' + crypto.randomUUID().slice(0, 12), user.tenant_id, user.user_id, title, q.due, q.due ? q.time : null, q.priority || 3]);
    return sendMessage(chatId, '✅ 할 일 추가 — ' + escHtml(title) +
      (q.due ? '\n📅 ' + md(q.due) + (q.time ? ' ' + q.time : '') : '') + (q.priority && q.priority !== 3 ? '\n' + PRI[q.priority] + ' ' + ['', '긴급', '높음', '', '낮음'][q.priority] : '') +
      (q.time && !q.due ? '\n💡 시각은 날짜와 같이 적어야 마감 시각이 됩니다 (예: 오늘 15:00)' : ''));
  }

  async function cmdTodos(chatId, user) {
    var rows = await openTodos(user);
    if (!rows.length) return sendMessage(chatId, '🎉 남은 개인 할 일이 없습니다.\n<code>/todo 내일 견적 회신</code> 으로 추가하세요.');
    var today = kstToday();
    var msg = '✏️ <b>개인 할 일 ' + rows.length + '건</b>\n';
    rows.forEach(function (t, i) {
      var late = t.due_date && t.due_date < today;
      msg += (i + 1) + '. ' + (PRI[t.priority] ? PRI[t.priority] + ' ' : '') + escHtml(t.title) +
        (t.due_date ? ' — ' + (late ? '⚠️ ' : '') + (t.due_date === today ? '오늘' : md(t.due_date)) + (t.due_time ? ' ' + t.due_time : '') : '') + (t.repeat ? ' 🔁' : '') + '\n';
    });
    return sendMessage(chatId, msg + '\n완료: <code>/todo done 번호</code>');
  }

  async function cmdTodoDone(chatId, user, n) {
    var rows = await openTodos(user);
    var t = rows[n - 1];
    if (!t) return sendMessage(chatId, '❓ ' + n + '번 할 일이 없습니다. /todos 로 번호를 확인하세요.');
    await db.query('UPDATE my_todos SET done_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2', [t.id, user.user_id]);
    var next = '';
    if (t.repeat) {
      var nid = await repeatNext({ tenant: { id: user.tenant_id }, user: { sub: user.user_id } }, t.id);   // 웹과 같은 규칙
      if (nid) {
        var nr = await db.query('SELECT due_date FROM my_todos WHERE id = $1', [nid]);
        next = '\n🔁 다음 회차: ' + md(nr.rows[0] && nr.rows[0].due_date);
      }
    }
    return sendMessage(chatId, '☑️ 완료 — ' + escHtml(t.title) + next);
  }

  async function cmdEvent(chatId, user, text) {
    var arg = String(text || '').trim();
    if (!arg) {
      return sendMessage(chatId, '📅 <b>개인 일정 등록</b>\n<code>/event 금요일 오후 3시~4시 #회의 고객 미팅</code>\n\n종류: #회의 #출장 #외근 #연차 #오전반차 #오후반차 #검토\n시각이 없으면 하루 종일 · 날짜가 없으면 오늘');
    }
    var q = QuickParse.parse(arg, kstToday());
    var kind = q.kind && q.kind !== 'todo' ? q.kind : 'etc';
    var date = q.due || kstToday();
    var t1 = q.time, t2 = q.timeEnd;
    if (HALF[kind]) { t1 = HALF[kind][0]; t2 = HALF[kind][1]; }
    if (kind === 'dayoff') { t1 = null; t2 = null; }
    var title = q.title || (KIND_LABEL[kind] || '일정').replace(/^\S+\s/, '');
    await db.query(
      "INSERT INTO events (id, title, type, start_date, end_date, start_time, end_time, project_ids, assignees, created_by, tenant_id) VALUES ($1,$2,$3,$4,$4,$5,$6,'[]','[]',$7,$8)",
      ['evt-' + crypto.randomUUID().slice(0, 12), title.slice(0, 255), kind, date, t1, t1 ? t2 : null, user.user_id, user.tenant_id]);
    return sendMessage(chatId, '✅ 일정 추가 — ' + (KIND_LABEL[kind] || '📌') + ' ' + escHtml(title) + '\n📅 ' + md(date) + (t1 ? ' ' + t1 + (t2 ? '~' + t2 : '') : ' 하루 종일') +
      (t1 ? '\n⏰ 30분 전에 알려 드립니다' : ''));
  }

  return { cmdTodo: cmdTodo, cmdTodos: cmdTodos, cmdEvent: cmdEvent };
}

module.exports = { create: create };
