// 텔레그램 내 업무 (v13.274) — 추천 점수 · /mywork 목록 · done · focus · /myproj · /board · /rec 시각 · ✅ 버튼 · 정해 둔 시각 추천(평일 · 한 번 · 같은 추천 안 보냄) · 웹 설정 API
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wm';
var path = require('path');
var B = 'http://localhost:3000';
var pg = require(path.join(__dirname, '../../server/node_modules/pg'));
async function login(email) {
  var r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: 'Test1234!' }) });
  return (await r.json()).data.accessToken;
}
function api(tok) {
  return async function (method, url, body) {
    var r = await fetch(B + url, { method: method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    return { s: r.status, d: j };
  };
}
var n = 0;
function check(name, c, x) { if (!c) { console.log('FAIL', name, String(JSON.stringify(x, null, 1)).slice(0, 2500)); throw new Error('FAIL ' + name); } n++; console.log('✔', name); }
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }

(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var U = {};
  (await c.query("SELECT id, email, name, role, tenant_id FROM users WHERE email IN ('admin@t.com','kim@t.com')")).rows.forEach(function (r) { U[r.email.split('@')[0]] = r; });
  var tid = U.kim.tenant_id, webKim = U.kim.id;
  var CHAT = 990031;
  await c.query("INSERT INTO users (email, password_hash, name, role, status, tenant_id) VALUES ('tgm@t.com', 'x', '텔레시험', 'member', 'active', $1) ON CONFLICT (email) DO NOTHING", [tid]);
  var TU = (await c.query("SELECT id, name, role FROM users WHERE email = 'tgm@t.com'")).rows[0];
  var kim = TU.id;
  U.kim = Object.assign({}, U.kim, { id: TU.id, name: TU.name, role: TU.role });
  async function clean() {
    await c.query("DELETE FROM my_work_marks WHERE user_id = $1 AND (item_key LIKE 'todo:tgm-%' OR project_id LIKE 'mprj-tgm%')", [kim]);
    await c.query("DELETE FROM my_todos WHERE id LIKE 'tgm-%' OR title LIKE 'TG %'");
    await c.query("DELETE FROM my_projects WHERE id LIKE 'mprj-tgm%'");
    await c.query('DELETE FROM telegram_links WHERE chat_id = $1 OR user_id = $2', [CHAT, kim]);
    await c.query('DELETE FROM my_work_categories WHERE user_id = $1', [kim]);
  }
  await clean();
  // 시드의 다른 김팀원 일은 그대로 두되, 시험 항목이 위로 오게 긴급 · 지연으로
  await c.query('INSERT INTO telegram_links (user_id, chat_id, is_active) VALUES ($1, $2, TRUE) ON CONFLICT (user_id) DO UPDATE SET chat_id = $2, is_active = TRUE', [kim, CHAT]);
  await c.query("UPDATE telegram_links SET tenant_id = $1, rec_slots = '13:30', rec_sent_date = NULL, rec_sent_slots = NULL, rec_sig = NULL WHERE user_id = $2", [tid, kim]);
  await c.query("INSERT INTO my_projects (id, tenant_id, user_id, title, start_date, end_date, status) VALUES ('mprj-tgm1', $1, $2, 'TG 프로젝트', $3, $4, 'doing')", [tid, kim, kst(-20), kst(3)]);
  await c.query("INSERT INTO my_todos (id, tenant_id, user_id, title, due_date, priority, status, waiting_for) VALUES " +
    "('tgm-late', $1, $2, 'TG 지연 견적', $3, 1, 'todo', NULL), ('tgm-today', $1, $2, 'TG 오늘 회신', $4, 3, 'todo', NULL), ('tgm-nodue', $1, $2, 'TG 마감없는 중요', NULL, 2, 'todo', NULL), " +
    "('tgm-wait', $1, $2, 'TG 기다림', $4, 1, 'waiting', '고객 답장'), ('tgm-far', $1, $2, 'TG 다음달', $5, 4, 'todo', NULL)",
    [tid, kim, kst(-30), kst(0), kst(40)]);
  await c.query("INSERT INTO my_work_marks (user_id, item_key, tenant_id, project_id) VALUES ($1, 'todo:tgm-today', $2, 'mprj-tgm1')", [kim, tid]);
  var user = { user_id: kim, tenant_id: tid, name: U.kim.name, role: U.kim.role, department_id: null };
  var sent = [], answers = [];
  var send = async function (chat, msg, opt) { sent.push({ chat: String(chat), msg: msg, kb: opt && opt.reply_markup ? JSON.parse(opt.reply_markup).inline_keyboard : null }); return { ok: true }; };
  var last = function () { return sent[sent.length - 1]; };
  var cbs = function (m) { return [].concat.apply([], (m.kb || [])).map(function (b) { return b.callback_data; }); };
  var tgMw = require(path.join(__dirname, '../../server/telegram/commands/mywork'));
  var rec = require(path.join(__dirname, '../../server/lib/my-work-rec'));
  var cmds = tgMw.create(send);
  var K = api(await login('kim@t.com'));
  try {
    // ── 1. 추천 점수 ──
    var req = { tenant: { id: tid }, user: { sub: kim, role: U.kim.role, name: U.kim.name } };
    var mine = await rec.loadMine(req, user);
    var r = rec.recommend(mine);
    var tops = r.top.map(function (x) { return x.it.id; });
    var tLate = r.top.filter(function (x) { return x.it.id === 'tgm-late'; })[0], tToday = r.top.filter(function (x) { return x.it.id === 'tgm-today'; })[0];
    check('추천 — 30일 지연 · 긴급이 맨 위권 (이유: 지연 · 긴급)', tLate && tops.indexOf('tgm-late') <= 1 && /지연 30일/.test(tLate.why.join()) && /긴급/.test(tLate.why.join()), r.top.map(function (x) { return [x.it.title, x.score, x.why]; }));
    check('추천 — 오늘 마감 + 끝나가는 프로젝트 소속', tToday && /오늘 마감/.test(tToday.why.join()) && /📁 TG 프로젝트 D-3/.test(tToday.why.join()), tToday);
    check('기다리는 일은 추천에서 빼고 따로', tops.indexOf('tgm-wait') < 0 && r.waiting.some(function (it) { return it.id === 'tgm-wait'; }));
    check('마감 없는 중요한 일 · 먼 낮은 일은 추천 안 함', tops.indexOf('tgm-nodue') < 0 && tops.indexOf('tgm-far') < 0 && r.noDue.some(function (it) { return it.id === 'tgm-nodue'; }));
    check('끝나가는 프로젝트 — D-3 · 남은 1', r.projEnding.length === 1 && r.projEnding[0].d === 3 && r.projEnding[0].open === 1, r.projEnding);

    // ── 2. /mywork ──
    await cmds.cmdMyWork(CHAT, user, '');
    var m1 = last();
    check('/mywork — 지연 · 오늘 묶음 + 번호', /🎯 <b>내 업무<\/b>/.test(m1.msg) && /⚠️ 지연/.test(m1.msg) && /📌 오늘/.test(m1.msg) && /\d+\. 🔴 ✏️ TG 지연 견적/.test(m1.msg), m1.msg);
    check('/mywork — ✅ 버튼은 항목 id 로 · 목록 · 추천 버튼', cbs(m1).some(function (d) { return /^mwd:todo:tgm-/.test(d); }) && cbs(m1).indexOf('mwl') >= 0 && cbs(m1).indexOf('mwr') >= 0, cbs(m1));
    var numLate = +(/(\d+)\. 🔴 ✏️ TG 지연 견적/.exec(m1.msg)[1]);
    await cmds.cmdMyWork(CHAT, user, '전체');
    check('/mywork 전체 — 마감 없음 · 나중에까지', /마감 없음/.test(last().msg) && /TG 마감없는 중요/.test(last().msg) && /TG 다음달/.test(last().msg));
    await cmds.cmdMyWork(CHAT, user, '지연');
    var numL2 = +(/(\d+)\. 🔴 ✏️ TG 지연 견적/.exec(last().msg)[1]);
    await cmds.cmdMyWork(CHAT, user, 'focus ' + numL2);
    check('focus 번호 → ⭐ 오늘 집중 표시', /⭐ 오늘 집중 — TG 지연 견적/.test(last().msg) &&
      (await c.query("SELECT focus_date FROM my_work_marks WHERE user_id = $1 AND item_key = 'todo:tgm-late'", [kim])).rows[0].focus_date === kst(0));
    await cmds.cmdMyWork(CHAT, user, '');
    check('집중 고른 일은 ⭐ 오늘 집중 묶음으로', /⭐ 오늘 집중<\/b>\n1\. 🔴 ✏️ TG 지연 견적/.test(last().msg), last().msg);
    await cmds.cmdMyWork(CHAT, user, 'done 1');
    check('done 번호 → 완료 (서버)', /☑️ 완료 — TG 지연 견적/.test(last().msg) && (await c.query("SELECT done_at FROM my_todos WHERE id = 'tgm-late'")).rows[0].done_at);
    await cmds.cmdMyWork(CHAT, user, 'done 99');
    check('없는 번호 → 안내', /99번을 찾을 수 없습니다/.test(last().msg));
    await cmds.cmdMyWork(CHAT, user, '아무거나');
    check('모르는 말 → 사용법', /mywork done 3/.test(last().msg));

    // ── 3. /myproj · /board ──
    await cmds.cmdMyProj(CHAT, user, '');
    check('/myproj — 기간 · D-3 · 남은 1', /TG 프로젝트/.test(last().msg) && /D-3/.test(last().msg) && /남은 1/.test(last().msg), last().msg);
    var pn = /(\d+)\. 📁 TG 프로젝트/.exec(last().msg)[1];
    await cmds.cmdMyProj(CHAT, user, pn);
    check('/myproj 번호 — 남은 항목 + ✅', /남은 항목 1/.test(last().msg) && /TG 오늘 회신/.test(last().msg) && cbs(last()).indexOf('mwd:todo:tgm-today') >= 0, last());
    await cmds.cmdBoard(CHAT, user);
    check('/board — 칸별 개수', /🗂 <b>내 보드<\/b>/.test(last().msg) && /지금 하기/.test(last().msg) && /계획하기/.test(last().msg), last().msg);

    // ── 4. ✅ 버튼 ──
    var api2 = { sendMessage: send, callApi: async function (m, b) { answers.push(b.text); return { ok: true }; } };
    await tgMw.handleCallback(api2, CHAT, user, 'mwd:todo:tgm-today', 'cb1');
    check('✅ 버튼 (id) → 완료 · 답', answers[answers.length - 1] === '✅ 완료!' && (await c.query("SELECT done_at FROM my_todos WHERE id = 'tgm-today'")).rows[0].done_at);
    await tgMw.handleCallback(api2, CHAT, user, 'mwd:todo:tgm-nope', 'cb2');
    check('✅ 없는 항목 → 알림만', /⚠️/.test(answers[answers.length - 1]));
    tgMw.remember(CHAT, [{ src: 'todo', id: 'tgm-far', title: 'TG 다음달' }]);
    await tgMw.handleCallback(api2, CHAT, user, 'mwd#1', 'cb3');
    check('✅ 번호 버튼 (긴 id 용) → 기억한 목록으로', (await c.query("SELECT done_at FROM my_todos WHERE id = 'tgm-far'")).rows[0].done_at);
    await tgMw.handleCallback(api2, CHAT, user, 'mwd#9', 'cb4');
    check('기억 밖 번호 → 다시 보라는 답', /목록이 오래/.test(answers[answers.length - 1]));
    await tgMw.handleCallback(api2, CHAT, user, 'mwp', 'cb5');
    check('📁 버튼 → 프로젝트 목록', /내 프로젝트/.test(last().msg));

    // ── 5. /rec · 시각 ──
    await c.query("UPDATE my_todos SET done_at = NULL WHERE id IN ('tgm-late', 'tgm-today', 'tgm-far')");
    await cmds.cmdRec(CHAT, user, '');
    check('/rec — 지금 하면 좋은 일 · 프로젝트 · 마감 없는 · 기다리는', /지금 하면 좋은 일/.test(last().msg) && /TG 지연 견적/.test(last().msg) && /끝나가는 프로젝트/.test(last().msg) &&
      /마감 없는 중요한 일/.test(last().msg) && /기다리는 중/.test(last().msg) && /고객 답장/.test(last().msg), last().msg);
    await cmds.cmdRec(CHAT, user, '2');
    check('/rec 2 → 10:00 · 15:30', (await c.query('SELECT rec_slots FROM telegram_links WHERE user_id = $1', [kim])).rows[0].rec_slots === '10:00,15:30');
    await cmds.cmdRec(CHAT, user, '14:00 9:30');
    check('/rec 시각 직접 (정렬)', (await c.query('SELECT rec_slots FROM telegram_links WHERE user_id = $1', [kim])).rows[0].rec_slots === '09:30,14:00');
    await cmds.cmdRec(CHAT, user, '25:00');
    check('잘못된 시각 → 안내 (안 바뀜)', /읽지 못했습니다/.test(last().msg) && (await c.query('SELECT rec_slots FROM telegram_links WHERE user_id = $1', [kim])).rows[0].rec_slots === '09:30,14:00');
    await cmds.cmdRec(CHAT, user, 'off');
    check('/rec off → 끔', (await c.query('SELECT rec_slots FROM telegram_links WHERE user_id = $1', [kim])).rows[0].rec_slots === '');
    check('parseSlots — 5분 단위 · 07~21시 · 4개까지', tgMw.parseSlots('13:33') === null && tgMw.parseSlots('06:00') === null && tgMw.parseSlots('1 2 3 4 5'.replace(/\d/g, '10:00')) === '10:00' && tgMw.parseSlots('3') === '10:00,13:30,16:30');

    // ── 6. 정해 둔 시각 추천 (작업) ──
    var tg = require(path.join(__dirname, '../../server/services/telegram.service'));
    var jobs = require(path.join(__dirname, '../../server/services/notification/jobs'));
    var hol = require(path.join(__dirname, '../../kr-holidays'));
    var origSend = tg.sendMessage;
    var jobSent = [];
    tg.sendMessage = async function (chat, msg) { jobSent.push({ chat: String(chat), msg: msg }); return { ok: true }; };
    try {
      var wd = null, we = null;
      for (var k = 0; k < 14 && (!wd || !we); k++) {
        var d = kst(k), g = new Date(d + 'T00:00:00Z').getUTCDay();
        if (!wd && g >= 1 && g <= 5 && !hol.krHolidayName(d)) wd = d;
        if (!we && (g === 0 || g === 6)) we = d;
      }
      var at = function (day, hm) { return Date.parse(day + 'T' + hm + ':00+09:00'); };
      var mineN = function () { return jobSent.filter(function (x) { return x.chat === String(CHAT); }); };
      await c.query("UPDATE telegram_links SET rec_slots = '', rec_sent_date = NULL, rec_sent_slots = NULL, rec_sig = NULL WHERE user_id = $1", [kim]);
      await jobs.sendMyWorkRecs(at(wd, '13:32'));
      check('끈 사람은 안 받음', mineN().length === 0);
      await c.query("UPDATE telegram_links SET rec_slots = '13:30,15:30' WHERE user_id = $1", [kim]);
      await jobs.sendMyWorkRecs(at(wd, '13:25'));
      check('시각 전엔 안 보냄', mineN().length === 0);
      await jobs.sendMyWorkRecs(at(wd, '13:32'));
      check('13:30 지나면 보냄 (오후 추천)', mineN().length === 1 && /오후 추천/.test(mineN()[0].msg) && /TG 지연 견적/.test(mineN()[0].msg), jobSent);
      await jobs.sendMyWorkRecs(at(wd, '13:37'));
      check('같은 시각은 한 번만', mineN().length === 1);
      await jobs.sendMyWorkRecs(at(wd, '15:31'));
      check('다음 시각에 같은 추천이면 안 보냄', mineN().length === 1);
      var row = (await c.query('SELECT rec_sent_slots FROM telegram_links WHERE user_id = $1', [kim])).rows[0];
      check('보낸 시각 기록', row.rec_sent_slots === '13:30,15:30', row);
      await c.query("UPDATE my_todos SET done_at = now() WHERE id = 'tgm-late'");
      await c.query("UPDATE telegram_links SET rec_slots = '13:30,15:30,16:30' WHERE user_id = $1", [kim]);
      await jobs.sendMyWorkRecs(at(wd, '16:31'));
      check('추천이 바뀌면 다음 시각에 보냄', mineN().length === 2 && !/TG 지연 견적/.test(mineN()[1].msg), mineN().map(function (x) { return x.msg; }));
      await c.query('UPDATE telegram_links SET rec_sent_date = NULL, rec_sent_slots = NULL, rec_sig = NULL WHERE user_id = $1', [kim]);
      await jobs.sendMyWorkRecs(at(wd, '17:40'));
      check('1시간 넘게 지난 시각은 건너뜀', mineN().length === 2);
      await jobs.sendMyWorkRecs(at(we, '13:32'));
      check('주말엔 안 보냄', mineN().length === 2);
    } finally {
      tg.sendMessage = origSend;
    }

    // ── 7. 웹 설정 API (김팀원 — 연동을 잠깐 만들어 씀) ──
    await c.query('INSERT INTO telegram_links (user_id, chat_id, is_active) VALUES ($1, 990032, TRUE) ON CONFLICT (user_id) DO UPDATE SET is_active = TRUE', [webKim]);
    var p1 = await K('PUT', '/api/telegram/prefs/rec', { slots: '10:00,13:30' });
    var g1 = await K('GET', '/api/telegram/prefs');
    check('웹 — 추천 시각 저장 · 읽기', p1.s === 200 && g1.d.recSlots === '10:00,13:30', [p1.d, g1.d]);
    check('웹 — 잘못된 시각 400', (await K('PUT', '/api/telegram/prefs/rec', { slots: '25:00' })).s === 400);
    check('웹 — 빈 값 = 끄기', (await K('PUT', '/api/telegram/prefs/rec', { slots: '' })).d.data.recSlots === '');
    var ms = await K('POST', '/api/telegram/mywork-send', { kind: 'rec' });
    check('웹 — 지금 받기: 봇 설정 없으면 503 (있으면 200)', ms.s === 503 || ms.s === 200, ms);
    await c.query('DELETE FROM telegram_links WHERE user_id = $1 AND chat_id = 990032', [webKim]);
    console.log('\nALL PASS', n);
  } catch (e) {
    console.log(e.message);
  } finally {
    await clean();
    await c.query('DELETE FROM my_work_marks WHERE user_id = $1', [kim]);
    await c.query("DELETE FROM users WHERE email = 'tgm@t.com'");
    await c.end();
    process.exit(0);
  }
})();
