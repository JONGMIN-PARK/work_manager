/**
 * 내 업무 명령어 (v13.253 · v13.274)
 *   /todo 내일 14:00 !긴급 견적 회신     개인 할 일 (마감 · 시각 · 중요도는 한 줄에서 읽음 — quick-parse.js)
 *   /todos                              안 끝난 개인 할 일 (중요도 · 마감 순, 번호)
 *   /todo done 2                        /todos 의 2번 완료 (반복이면 다음 회차가 생김)
 *   /event 금요일 오후 3시~4시 #회의 고객 미팅    개인 일정 (#종류 없으면 기타, 시각 없으면 하루 종일)
 * v13.274 — 웹 🎯 내 업무를 텔레그램에서 그대로 조회 · 처리
 *   /mywork (/내업무) [지연 · 오늘 · 이번주 · 전체]   모든 출처(맵 · 이슈 · 회의 · 개발 · 할 일 …)를 묶음별 번호 목록 + ✅ 버튼
 *   /mywork done 3 · /mywork focus 3    번호로 완료 · ⭐ 오늘 집중
 *   /myproj (/내프로젝트) [번호]          📁 내 프로젝트 — 기간 · D-day · 진행률 · 남은 항목, 번호면 자세히
 *   /board (/보드)                      내 칸(보드)별 개수 · 위 3개
 *   /rec (/추천)                        지금 하면 좋은 일 — 점수 순 + 챙길 것 (lib/my-work-rec)
 *   /rec off · /rec 1 · /rec 2 · /rec 3 · /rec 09:30 14:00   추천 받을 시각 (평일, 기본 13:30)
 * 번호는 마지막에 본 목록 기준 (서버 메모리 6시간). ✅ 버튼은 가능하면 항목 id 를 그대로 담아 서버를 다시 켜도 동작
 */
var db = require('../../config/db');
var crypto = require('crypto');
var escHtml = require('../util/escape').escHtml;
var QuickParse = require('../../../quick-parse');
var repeatNext = require('../../lib/todo-repeat').repeatNext;
var mwDone = require('../../lib/my-work-done');
var mwRec = require('../../lib/my-work-rec');
var myWork = require('../../lib/my-work');

var PRI = { 1: '🔴', 2: '🟠', 3: '', 4: '⚪' };
var KIND_LABEL = { meeting: '🤝 회의', trip: '✈️ 출장', fieldService: '🔧 외근', dayoff: '🌴 연차', amoff: '🌅 오전반차', pmoff: '🌇 오후반차', review: '🔍 검토', etc: '📌 일정' };
var HALF = { amoff: ['09:00', '13:00'], pmoff: ['14:00', '18:00'] };
var SRC_ICON = { mindmap: '🧠', issue: '🎫', action: '📝', prestudy: '🔍', milestone: '◆', dev: '🛠', todo: '✏️' };
var PJ_STATUS = { plan: '계획', doing: '진행', hold: '보류', done: '완료' };
var REC_PRESET = { 1: '13:30', 2: '10:00,15:30', 3: '10:00,13:30,16:30' };
var SESSION_MS = 6 * 3600 * 1000;

function kstToday() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
function md(d) { return d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : ''; }
function dow(d) { return '일월화수목금토'.charAt(new Date(d + 'T00:00:00Z').getUTCDay()); }
function reqOf(user) { return { tenant: { id: user.tenant_id }, user: { sub: user.user_id, role: user.role || 'member', name: user.name || '', departmentId: user.department_id || null } }; }

/* ── 번호 기억 — 채팅마다 마지막에 보여 준 목록 ── */
var _sess = new Map();
function remember(chatId, list) {
  _sess.set(String(chatId), { list: list.map(function (it) { return { src: it.src, id: it.id, title: it.title, focus: !!it.focus }; }), at: Date.now() });
  if (_sess.size > 2000) _sess.delete(_sess.keys().next().value);
}
function recall(chatId, n) {
  var s = _sess.get(String(chatId));
  if (!s || Date.now() - s.at > SESSION_MS) return null;
  return s.list[n - 1] || null;
}

function dueText(it, today) {
  if (!it.due) return '';
  var d = myWork.daysBetween(today, it.due);
  if (d < 0) return '⚠️ 지연 ' + (-d) + '일';
  if (d === 0) return '오늘' + (it.dueTime ? ' ' + it.dueTime : '');
  if (d === 1) return '내일' + (it.dueTime ? ' ' + it.dueTime : '');
  return md(it.due) + '(' + dow(it.due) + ')';
}
function itemLine(n, it, today, why) {
  var dt = why ? why : dueText(it, today);
  return n + '. ' + (PRI[it.pri] ? PRI[it.pri] + ' ' : '') + (SRC_ICON[it.src] || '•') + ' ' + escHtml(it.title) + (dt ? ' — ' + escHtml(dt) : '') +
    (it.ctx ? ' <i>(' + escHtml(String(it.ctx).slice(0, 28)) + ')</i>' : '') + '\n';
}
/** ✅ 버튼 — 텔레그램 콜백 데이터는 64바이트까지라 길면 번호로 */
function doneButtons(list, max) {
  var rows = [], row = [];
  list.slice(0, max || 10).forEach(function (it, i) {
    if (mwDone.DONE_SRC.indexOf(it.src) < 0) return;   // 사전검토 · 마일스톤은 웹에서 (끝내는 방법이 여럿)
    var d = 'mwd:' + it.src + ':' + it.id;
    row.push({ text: '✅ ' + (i + 1), callback_data: Buffer.byteLength(d) <= 64 ? d : 'mwd#' + (i + 1) });
    if (row.length === 5) { rows.push(row); row = []; }
  });
  if (row.length) rows.push(row);
  rows.push([{ text: '📋 내 업무', callback_data: 'mwl' }, { text: '💡 추천', callback_data: 'mwr' }, { text: '📁 프로젝트', callback_data: 'mwp' }]);
  return JSON.stringify({ inline_keyboard: rows });
}
/** 웹과 같은 묶음 — focus · late · today · week · next · later · nodue */
function groupOf(it, today) {
  if (it.focus) return 'focus';
  if (!it.due) return 'nodue';
  var d = myWork.daysBetween(today, it.due);
  if (d < 0) return 'late';
  if (d === 0) return 'today';
  var toSun = 6 - ((new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7);
  if (d <= toSun) return 'week';
  if (d <= toSun + 7) return 'next';
  return 'later';
}
var GROUPS = [['focus', '⭐ 오늘 집중'], ['late', '⚠️ 지연'], ['today', '📌 오늘'], ['week', '🗓 이번 주'], ['next', '다음 주'], ['later', '나중에'], ['nodue', '마감 없음']];
var VIEW = { '': ['focus', 'late', 'today', 'week'], late: ['late'], '지연': ['late'], today: ['focus', 'today'], '오늘': ['focus', 'today'], week: ['focus', 'late', 'today', 'week'], '이번주': ['focus', 'late', 'today', 'week'],
  all: ['focus', 'late', 'today', 'week', 'next', 'later', 'nodue'], '전체': ['focus', 'late', 'today', 'week', 'next', 'later', 'nodue'] };
function sortItems(a, b) { return (a.pri - b.pri) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || ((a.dueTime || '') < (b.dueTime || '') ? -1 : 1); }

/** 진행률 — 직접 · 연계 값, 없으면 할 일 완료 비율 */
function projProgress(p, open) {
  if (p.progress != null) return p.progress;
  var done = p.todoDone || 0;
  return done + open ? Math.round(done / (done + open) * 100) : null;
}
function projDday(p, today) {
  if (p.status === 'done') return '완료';
  if (p.start && p.start > today) return md(p.start) + ' 시작';
  if (!p.end) return '';
  var d = myWork.daysBetween(today, p.end);
  return d < 0 ? (-d) + '일 지남' : d === 0 ? 'D-day' : 'D-' + d;
}

/** 추천 글 — 보낼 것이 없으면 null. 작업(jobs)에서도 씀 */
function recMessage(mine, rec, title) {
  var today = mine.today;
  if (!rec.top.length && !rec.projEnding.length && !rec.noDue.length) return null;
  var now = new Date(Date.now() + 9 * 3600000);
  var msg = '💡 <b>' + (title || '지금 하면 좋은 일') + '</b> — ' + md(today) + ' (' + dow(today) + ') ' + now.toISOString().slice(11, 16) + '\n';
  var list = rec.top.map(function (x) { return x.it; });
  if (rec.top.length) {
    msg += '\n';
    rec.top.forEach(function (x, i) { msg += itemLine(i + 1, x.it, today, x.why.join(' · ')); });
    if (rec.more) msg += '  … 외 ' + rec.more + '건 — /mywork\n';
  } else msg += '\n🎉 급한 일은 없습니다.\n';
  if (rec.projEnding.length) {
    msg += '\n📁 <b>끝나가는 프로젝트</b>\n';
    rec.projEnding.slice(0, 3).forEach(function (x) {
      msg += '  · ' + escHtml((x.p.icon ? x.p.icon + ' ' : '') + x.p.title) + ' — ' + (x.d < 0 ? '기간 ' + (-x.d) + '일 지남' : x.d === 0 ? '오늘 끝' : 'D-' + x.d) + (x.open ? ' · 남은 ' + x.open : '') +
        (x.d < 0 ? ' → 기간을 늘리거나 완료로' : '') + '\n';
    });
  }
  if (rec.noDue.length) {
    msg += '\n📌 <b>마감 없는 중요한 일 ' + rec.noDue.length + '</b> — 마감을 정해 두면 놓치지 않아요\n';
    rec.noDue.slice(0, 3).forEach(function (it) { msg += '  · ' + (PRI[it.pri] ? PRI[it.pri] + ' ' : '') + escHtml(it.title) + '\n'; });
  }
  if (rec.waiting.length) {
    msg += '\n⏳ <b>기다리는 중 ' + rec.waiting.length + '</b> — 받았는지 확인해 보세요\n';
    rec.waiting.slice(0, 3).forEach(function (it) { msg += '  · ' + escHtml(it.title) + (it.waitingFor ? ' <i>(' + escHtml(it.waitingFor) + ')</i>' : '') + '\n'; });
  }
  if (rec.noFocus && list.length) msg += '\n⭐ 오늘 집중을 아직 안 골랐어요 — <code>/mywork focus 1</code>\n';
  msg += '\n✅ 버튼으로 바로 완료 · <code>/rec off</code> 끄기';
  var sig = list.map(function (it) { return it.src + ':' + it.id; }).concat(rec.projEnding.map(function (x) { return 'p:' + x.p.id + ':' + x.d; })).join('|');
  return { text: msg, list: list, markup: doneButtons(list, 5), sig: crypto.createHash('md5').update(sig).digest('hex') };
}

function parseSlots(arg) {
  var a = String(arg || '').trim().toLowerCase();
  if (/^(off|끄기|끔|0)$/.test(a)) return '';
  if (/^(on|켜기|켬)$/.test(a)) return REC_PRESET[1];
  if (REC_PRESET[a]) return REC_PRESET[a];
  var ts = a.split(/[\s,]+/).filter(Boolean), out = [];
  for (var i = 0; i < ts.length; i++) {
    var m = /^(\d{1,2}):?(\d{2})$/.exec(ts[i]);
    if (!m || +m[1] < 7 || +m[1] > 21 || +m[2] > 59 || +m[2] % 5) return null;
    var s = (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2];
    if (out.indexOf(s) < 0) out.push(s);
  }
  return out.length && out.length <= 4 ? out.sort().join(',') : null;
}
function slotsText(s) { return s ? s.split(',').join(' · ') + ' (평일)' : '꺼짐'; }

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
      return sendMessage(chatId, '✏️ <b>할 일 등록</b>\n<code>/todo 내일 14:00 !긴급 견적 회신</code>\n\n날짜: 오늘 · 내일 · 모레 · 금요일 · 다음주 월 · 10/30\n시각: 14:00 · 오후 3시\n중요도: !긴급 !높음 !낮음\n\n/todos — 목록 · <code>/todo done 2</code> — 완료 · /mywork — 내 업무 전체');
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
    return sendMessage(chatId, msg + '\n완료: <code>/todo done 번호</code> · 맵 · 이슈 · 회의까지 모두: /mywork');
  }

  async function cmdTodoDone(chatId, user, n) {
    var rows = await openTodos(user);
    var t = rows[n - 1];
    if (!t) return sendMessage(chatId, '❓ ' + n + '번 할 일이 없습니다. /todos 로 번호를 확인하세요.');
    await db.query('UPDATE my_todos SET done_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2', [t.id, user.user_id]);
    var next = '';
    if (t.repeat) {
      var nx = await repeatNext({ tenant: { id: user.tenant_id }, user: { sub: user.user_id } }, t.id);   // 웹과 같은 규칙 — 다음 회차 행
      if (nx) next = '\n🔁 다음 회차: ' + md(nx.due_date);
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

  /* ═══ /mywork — 내 업무 전체 (v13.274) ═══ */
  async function cmdMyWork(chatId, user, text) {
    var arg = String(text || '').trim().toLowerCase();
    var dm = /^(done|완료)\s+(\d+)$/.exec(arg);
    if (dm) return doneByNum(chatId, user, +dm[2]);
    var fm = /^(focus|집중)\s+(\d+)$/.exec(arg);
    if (fm) return focusByNum(chatId, user, +fm[2]);
    var view = VIEW[arg];
    if (!view) return sendMessage(chatId, '🎯 <b>내 업무</b>\n/mywork — 집중 · 지연 · 오늘 · 이번 주\n<code>/mywork 지연</code> · <code>/mywork 오늘</code> · <code>/mywork 전체</code>\n<code>/mywork done 3</code> 완료 · <code>/mywork focus 3</code> ⭐ 오늘 집중');
    var mine = await mwRec.loadMine(reqOf(user), user);
    var today = mine.today, by = {};
    mine.items.forEach(function (it) { var g = groupOf(it, today); (by[g] = by[g] || []).push(it); });
    Object.keys(by).forEach(function (g) { by[g].sort(sortItems); });
    var n = function (g) { return (by[g] || []).length; };
    var msg = '🎯 <b>내 업무</b> — 남은 ' + mine.items.length + (n('late') ? ' · 지연 ' + n('late') : '') + ' · 오늘 ' + n('today') + '\n';
    var list = [], cap = 25, cut = 0;
    GROUPS.forEach(function (g) {
      if (view.indexOf(g[0]) < 0 || !n(g[0])) return;
      msg += '\n<b>' + g[1] + '</b>\n';
      by[g[0]].forEach(function (it) {
        if (list.length >= cap) { cut++; return; }
        list.push(it);
        msg += itemLine(list.length, it, today);
      });
    });
    if (!list.length) msg += '\n🎉 ' + (arg ? '해당하는 일이 없습니다.' : '급한 일이 없습니다.') + '\n';
    if (cut) msg += '  … 외 ' + cut + '건 — 웹 🎯 내 업무에서\n';
    if (!arg) {
      var rest = [['next', '다음 주'], ['later', '나중'], ['nodue', '마감 없음']].filter(function (x) { return n(x[0]); }).map(function (x) { return x[1] + ' ' + n(x[0]); });
      if (rest.length) msg += '\n그 밖에 — ' + rest.join(' · ') + ' (<code>/mywork 전체</code>)\n';
    }
    msg += '\n완료: ✅ 버튼 · <code>/mywork done 번호</code> · 집중: <code>/mywork focus 번호</code>';
    remember(chatId, list);
    return sendMessage(chatId, msg, { reply_markup: doneButtons(list, 10) });
  }

  async function finishDone(chatId, user, src, id) {
    var r = await mwDone.setDone(reqOf(user), src, id, { id: user.user_id, name: user.name }, true);
    if (r.err) return { ok: false, msg: r.err[2] || '처리하지 못했습니다' };
    var next = r.data.nextRow ? '\n🔁 다음 회차: ' + md(r.data.nextRow.due_date) : '';
    await sendMessage(chatId, '☑️ 완료 — ' + escHtml(r.data.title || '') + (src !== 'todo' ? ' <i>(원래 화면에도 반영)</i>' : '') + next);
    return { ok: true };
  }
  async function doneByNum(chatId, user, n) {
    var it = recall(chatId, n);
    if (!it) return sendMessage(chatId, '❓ ' + n + '번을 찾을 수 없습니다. /mywork 로 목록을 다시 보세요.');
    if (mwDone.DONE_SRC.indexOf(it.src) < 0) return sendMessage(chatId, '🔍 사전검토 · 마일스톤은 웹에서 끝내 주세요 (확정 · 보류 · 드롭 등 고를 것이 있어서).');
    var r = await finishDone(chatId, user, it.src, it.id);
    if (!r.ok) return sendMessage(chatId, '⚠️ ' + escHtml(r.msg));
  }
  async function focusByNum(chatId, user, n) {
    var it = recall(chatId, n);
    if (!it) return sendMessage(chatId, '❓ ' + n + '번을 찾을 수 없습니다. /mywork 로 목록을 다시 보세요.');
    var on = !it.focus;
    await db.query('INSERT INTO my_work_marks (user_id, item_key, tenant_id, focus_date) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, item_key) DO UPDATE SET focus_date = EXCLUDED.focus_date, updated_at = now()',
      [user.user_id, it.src + ':' + it.id, user.tenant_id, on ? kstToday() : null]);
    it.focus = on;
    return sendMessage(chatId, (on ? '⭐ 오늘 집중 — ' : '☆ 집중 풀기 — ') + escHtml(it.title));
  }

  /* ═══ /myproj — 📁 내 프로젝트 ═══ */
  async function cmdMyProj(chatId, user, text) {
    var arg = String(text || '').trim();
    var mine = await mwRec.loadMine(reqOf(user), user);
    var today = mine.today;
    var projs = mine.projs.filter(function (p) { return p.status !== 'done'; });
    var openOf = function (p) { return mine.items.filter(function (it) { return mwRec.projOf(it, mine.projs) === p; }); };
    if (!projs.length) return sendMessage(chatId, '📁 진행 중인 내 프로젝트가 없습니다.\n웹 🎯 내 업무 → <b>＋ 프로젝트</b> 로 만들거나, 맡은 프로젝트를 🔗 연계 후보에서 연결하세요.');
    if (!arg) {
      var msg = '📁 <b>내 프로젝트 ' + projs.length + '</b>\n\n';
      projs.forEach(function (p, i) {
        var open = openOf(p).length, pr = projProgress(p, open), dd = projDday(p, today);
        msg += (i + 1) + '. ' + escHtml((p.icon || '📁') + ' ' + p.title) + (p.link ? ' 🔗' : '') + (p.status !== 'doing' ? ' <i>[' + PJ_STATUS[p.status] + ']</i>' : '') + '\n' +
          '    ' + (p.start || p.end ? md(p.start) + '~' + md(p.end) : '기간 없음') + (dd ? ' · ' + dd : '') + (pr != null ? ' · ' + pr + '%' : '') + ' · 남은 ' + open + '\n';
      });
      return sendMessage(chatId, msg + '\n자세히: <code>/myproj 번호</code>', { reply_markup: doneButtons([], 0) });
    }
    var k = parseInt(arg, 10);
    var p = !isNaN(k) ? projs[k - 1] : projs.filter(function (x) { return x.title.indexOf(arg) >= 0; })[0];
    if (!p) return sendMessage(chatId, '❓ 그 프로젝트를 찾을 수 없습니다. /myproj 로 번호를 확인하세요.');
    var its = openOf(p).sort(sortItems), pr2 = projProgress(p, its.length), dd2 = projDday(p, today);
    var m = '📁 <b>' + escHtml((p.icon || '') + ' ' + p.title) + '</b>' + (p.status !== 'doing' ? ' <i>[' + PJ_STATUS[p.status] + ']</i>' : '') + '\n' +
      '📅 ' + (p.start || p.end ? (p.start || '?') + ' ~ ' + (p.end || '?') : '기간 없음') + (dd2 ? ' · ' + dd2 : '') + '\n' +
      (pr2 != null ? '📈 진행 ' + pr2 + '%\n' : '') +
      (p.link ? (p.linkInfo && !p.linkInfo.locked ? '🔗 프로젝트 관리: ' + escHtml(p.linkInfo.name) + '\n' : '🔒 연결한 프로젝트를 볼 수 없습니다\n') : '') +
      (p.memo ? '📝 ' + escHtml(p.memo.split('\n')[0].slice(0, 120)) + '\n' : '');
    m += '\n<b>남은 항목 ' + its.length + '</b>\n';
    its.slice(0, 20).forEach(function (it, i) { m += itemLine(i + 1, it, today); });
    if (!its.length) m += '  없음\n';
    var ms = p.linkInfo && p.linkInfo.ms ? p.linkInfo.ms.filter(function (x) { return x.status !== 'done' && x.due; }).slice(0, 5) : [];
    if (ms.length) {
      m += '\n<b>◆ 다가오는 마일스톤</b>\n';
      ms.forEach(function (x) { m += '  · ' + escHtml(x.name) + ' — ' + md(x.due) + (x.due < today ? ' ⚠️' : '') + '\n'; });
    }
    remember(chatId, its.slice(0, 20));
    return sendMessage(chatId, m + (its.length ? '\n완료: ✅ 버튼 · <code>/mywork done 번호</code>' : ''), { reply_markup: doneButtons(its, 10) });
  }

  /* ═══ /board — 내 칸 ═══ */
  async function cmdBoard(chatId, user) {
    var mine = await mwRec.loadMine(reqOf(user), user);
    var today = mine.today, by = {}, list = [];
    mine.items.forEach(function (it) { var c = mwRec.colOf(it, mine.cats, today); (by[c.id] = by[c.id] || []).push(it); });
    var cols = mine.cats.slice();
    if (by.none) cols.push({ id: 'none', name: '분류 안 됨', icon: '📥' });
    var msg = '🗂 <b>내 보드</b> — 남은 ' + mine.items.length + '\n';
    cols.forEach(function (c) {
      var its = (by[c.id] || []).sort(function (a, b) { return (b.focus ? 1 : 0) - (a.focus ? 1 : 0) || sortItems(a, b); });
      msg += '\n<b>' + escHtml((c.icon ? c.icon + ' ' : '') + c.name) + '</b> ' + its.length + '\n';
      its.slice(0, 3).forEach(function (it) { list.push(it); msg += itemLine(list.length, it, today); });
      if (its.length > 3) msg += '    … 외 ' + (its.length - 3) + '\n';
    });
    remember(chatId, list);
    return sendMessage(chatId, msg + '\n완료: <code>/mywork done 번호</code> · 칸 옮기기는 웹 보드에서', { reply_markup: doneButtons(list, 0) });
  }

  /* ═══ /rec — 추천 · 받을 시각 ═══ */
  async function cmdRec(chatId, user, text) {
    var arg = String(text || '').trim();
    if (arg) {
      if (/^(set|설정|시각)$/i.test(arg)) {
        var cur = await db.query('SELECT rec_slots FROM telegram_links WHERE user_id = $1 AND chat_id = $2 AND is_active = TRUE', [user.user_id, chatId]);
        return sendMessage(chatId, '💡 추천 받는 시각: <b>' + slotsText(cur.rows.length ? cur.rows[0].rec_slots : '') + '</b>\n\n<code>/rec 1</code> 13:30 · <code>/rec 2</code> 10:00 · 15:30 · <code>/rec 3</code> 10:00 · 13:30 · 16:30\n<code>/rec 09:30 14:00</code> 직접 (07:00~21:55, 5분 단위, 4개까지) · <code>/rec off</code> 끄기');
      }
      var slots = parseSlots(arg);
      if (slots === null) return sendMessage(chatId, '❓ 시각을 읽지 못했습니다. 예: <code>/rec 09:30 14:00</code> · <code>/rec 2</code> · <code>/rec off</code>');
      await db.query('UPDATE telegram_links SET rec_slots = $1 WHERE user_id = $2 AND chat_id = $3', [slots, user.user_id, chatId]);
      return sendMessage(chatId, slots ? '💡 추천을 <b>' + slotsText(slots) + '</b> 에 보내 드립니다. 같은 날 같은 추천은 다시 보내지 않아요.' : '🔕 추천 알림을 껐습니다. 다시 켜기: <code>/rec 1</code>');
    }
    var mine = await mwRec.loadMine(reqOf(user), user);
    var out = recMessage(mine, mwRec.recommend(mine));
    if (!out) return sendMessage(chatId, '🎉 지금 챙길 일이 없습니다. 남은 일 ' + mine.items.length + '건 — /mywork');
    remember(chatId, out.list);
    return sendMessage(chatId, out.text, { reply_markup: out.markup });
  }

  return { cmdTodo: cmdTodo, cmdTodos: cmdTodos, cmdEvent: cmdEvent, cmdMyWork: cmdMyWork, cmdMyProj: cmdMyProj, cmdBoard: cmdBoard, cmdRec: cmdRec, finishDone: finishDone };
}

/** 인라인 버튼 — mwd:<src>:<id> · mwd#<번호> 완료, mwl 내 업무, mwr 추천, mwp 프로젝트 (routes/telegram.js 에서 부름) */
async function handleCallback(api, chatId, user, data, callbackId) {
  var cmds = create(api.sendMessage);
  var answer = function (t) { return api.callApi('answerCallbackQuery', { callback_query_id: callbackId, text: t || '' }); };
  if (data === 'mwl') { await answer(); return cmds.cmdMyWork(chatId, user, ''); }
  if (data === 'mwr') { await answer(); return cmds.cmdRec(chatId, user, ''); }
  if (data === 'mwp') { await answer(); return cmds.cmdMyProj(chatId, user, ''); }
  var src, id;
  if (data.indexOf('mwd#') === 0) {
    var it = recall(chatId, parseInt(data.slice(4), 10));
    if (!it) return answer('목록이 오래되었습니다 — /mywork 로 다시 보세요');
    src = it.src; id = it.id;
  } else {
    var rest = data.slice(4), i = rest.indexOf(':');
    src = rest.slice(0, i); id = rest.slice(i + 1);
  }
  if (!src || !id) return answer('잘못된 버튼');
  var r = await cmds.finishDone(chatId, user, src, id);
  return answer(r.ok ? '✅ 완료!' : '⚠️ ' + r.msg);
}

module.exports = { create: create, handleCallback: handleCallback, recMessage: recMessage, remember: remember, parseSlots: parseSlots };
