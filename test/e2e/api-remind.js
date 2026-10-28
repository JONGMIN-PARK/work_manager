// 내 일 알림 (v13.256) — 일정 추가 · 변경 · 회의 참석 · 맵 주제 담당 → 본인 제외 알림, 미리 알림 시점 10/30/60, 내일 미리보기
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
function check(name, c, x) { if (!c) { console.log('FAIL', name, JSON.stringify(x, null, 1).slice(0, 1500)); throw new Error('FAIL ' + name); } n++; console.log('✔', name); }
function kst(k) { var d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var U = {};
  (await c.query("SELECT id, email, tenant_id FROM users WHERE email IN ('admin@t.com','kim@t.com','lee@t.com')")).rows.forEach(function (r) { U[r.email.split('@')[0]] = r; });
  var tid = U.kim.tenant_id, kim = U.kim.id, lee = U.lee.id, adm = U.admin.id;
  async function clean() {
    await c.query("DELETE FROM events WHERE title LIKE '알림시험%'");
    await c.query("DELETE FROM meetings WHERE title LIKE '알림시험%'");
    await c.query("DELETE FROM mindmaps WHERE title LIKE '알림시험%'");
    await c.query("DELETE FROM my_todos WHERE title LIKE '알림시험%'");
    await c.query("DELETE FROM in_app_notifications WHERE event_type IN ('event_assigned', 'mindmap_assigned')");
    await c.query('DELETE FROM telegram_links WHERE chat_id IN (990011, 990012, 990013)');
    await c.query("DELETE FROM notification_prefs WHERE event_type = 'event_tomorrow'");
    await c.query("DELETE FROM event_reminder_sent");
  }
  await clean();
  async function inbox(uid, type) {
    await wait(400);   // 알림은 응답 뒤에 보냄
    return (await c.query('SELECT body FROM in_app_notifications WHERE user_id = $1 AND event_type = $2 ORDER BY created_at, id', [uid, type])).rows.map(function (r) { return r.body; });
  }
  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com'));
  try {
    // ── 1. 일정 추가 · 변경 ──
    var e1 = (await A('POST', '/api/events', { title: '알림시험 고객 방문', type: 'trip', startDate: kst(2), endDate: kst(2), startTime: '14:00', endTime: '15:00', location: '본사', assignees: ['김팀원'] })).d.data;
    var kb = await inbox(kim, 'event_assigned');
    check('남이 일정에 나를 넣음 → 알림 (일정 · 시각 · 장소 · 넣은 사람)', kb.length === 1 && /일정에 추가됨/.test(kb[0]) && /알림시험 고객 방문/.test(kb[0]) && /14:00~15:00/.test(kb[0]) && /본사/.test(kb[0]) && /관리자/.test(kb[0]), kb);
    check('넣은 본인은 알림 없음', (await inbox(adm, 'event_assigned')).length === 0);
    await A('PUT', '/api/events/' + e1.id, { startTime: '16:00', endTime: '17:00', version: e1.version });
    kb = await inbox(kim, 'event_assigned');
    check('시각이 바뀌면 원래 담당에게 변경 알림 (전 시각 함께)', kb.length === 2 && /일정 변경/.test(kb[1]) && /16:00/.test(kb[1]) && /전: .*14:00/.test(kb[1]), kb);
    var cur = (await c.query('SELECT version FROM events WHERE id = $1', [e1.id])).rows[0].version;
    await A('PUT', '/api/events/' + e1.id, { assignees: ['김팀원', '이팀원'], memo: '메모만', version: cur });
    var lb = await inbox(lee, 'event_assigned');
    check('담당 추가 → 새로 들어간 사람만', lb.length === 1 && /일정에 추가됨/.test(lb[0]) && (await inbox(kim, 'event_assigned')).length === 2, lb);
    await K('POST', '/api/events', { title: '알림시험 내 일정', startDate: kst(1), endDate: kst(1), assignees: ['김팀원'] });
    check('내가 나를 넣은 일정은 알림 없음', (await inbox(kim, 'event_assigned')).length === 2);

    // ── 2. 회의 참석자 ──
    var mt = await A('POST', '/api/meetings', { title: '알림시험 주간 회의', meetDate: kst(3), attendees: ['이팀원'], form: { timeStart: '10:00', timeEnd: '11:00' } });
    lb = await inbox(lee, 'event_assigned');
    check('회의 참석자로 넣음 → 일정 추가 알림', mt.s === 201 && lb.length === 2 && /알림시험 주간 회의/.test(lb[1]) && /10:00/.test(lb[1]), [mt.s, lb]);

    // ── 3. 맵 주제 담당 ──
    var mm = (await A('POST', '/api/mindmaps', { title: '알림시험 맵', scope: 'personal' })).d.data;
    var sh = await A('PUT', '/api/mindmaps/' + mm.id, { editors: [kim], version: mm.version });
    var doc = { sheets: [{ id: 's1', title: '시트', root: { id: 'r', text: '알림시험 맵', children: [
      { id: 'a', text: '도면 검토', assigneeId: kim, dueDate: kst(4), children: [] },
      { id: 'b', text: '배선', assigneeId: kim, children: [] },
      { id: 'c', text: '안 보이는 사람', assigneeId: lee, children: [] },
      { id: 'd', text: '내 것', assigneeId: adm, children: [] }
    ] } }] };
    var sv = await A('PUT', '/api/mindmaps/' + mm.id, { doc: doc, version: sh.d.data.version });
    var mk = await inbox(kim, 'mindmap_assigned');
    check('맵 주제 담당 → 맵마다 묶어서 한 번 (주제 · 마감)', sv.s === 200 && mk.length === 1 && /도면 검토/.test(mk[0]) && /배선/.test(mk[0]) && /알림시험 맵/.test(mk[0]), [sv.s, sv.d, mk]);
    check('맵을 못 보는 사람 · 본인은 알림 없음', (await inbox(lee, 'mindmap_assigned')).length === 0 && (await inbox(adm, 'mindmap_assigned')).length === 0);
    doc.sheets[0].root.children[0].text = '도면 검토 (수정)';
    await A('PUT', '/api/mindmaps/' + mm.id, { doc: doc, version: sv.d.data.version });
    check('담당이 그대로면 다시 저장해도 알림 없음', (await inbox(kim, 'mindmap_assigned')).length === 1);

    // ── 4. 미리 알림 시점 ──
    await c.query('INSERT INTO telegram_links (user_id, chat_id, is_active) VALUES ($1, 990011, TRUE) ON CONFLICT (user_id) DO UPDATE SET chat_id = 990011, is_active = TRUE, remind_lead = 30', [kim]);
    var bad = await K('PUT', '/api/telegram/prefs/lead', { minutes: 15 });
    var good = await K('PUT', '/api/telegram/prefs/lead', { minutes: 10 });
    var pr = await K('GET', '/api/telegram/prefs');
    check('미리 알림 시점 저장 (10 · 30 · 60 만)', bad.s === 400 && good.s === 200 && pr.d.remindLead === 10, [bad.s, good.s, pr.d]);
    var jobs = require(path.join(__dirname, '../../server/services/notification/jobs'));
    check('자정 넘으면 23:59 로 막음', jobs._addMin('23:40', 30) === '23:59' && jobs._addMin('09:50', 60) === '10:50');
    var tg = require(path.join(__dirname, '../../server/services/telegram.service'));
    var sent = [], origSend = tg.sendMessage;
    tg.sendMessage = async function (chat, msg) { sent.push({ chat: String(chat), msg: msg }); return { ok: true }; };
    try {
      var day = kst(1);
      var at = function (hm) { return Date.parse(day + 'T' + hm + ':00+09:00'); };
      await A('POST', '/api/events', { title: '알림시험 20분 뒤 회의', startDate: day, endDate: day, startTime: '10:20', assignees: ['김팀원'] });
      await c.query("INSERT INTO my_todos (id, user_id, tenant_id, title, due_date, due_time) VALUES ('rmt-1', $1, $2, '알림시험 견적 회신', $3, '10:45')", [kim, tid, day]);
      await jobs.sendEventSoonReminders(at('10:00'));
      check('10분 전 설정 → 20분 뒤 일정은 아직', !sent.some(function (x) { return /알림시험/.test(x.msg); }), sent);
      await jobs.sendEventSoonReminders(at('10:10'));
      check('10분 전 → 알림 ("10분 뒤 시작")', sent.length === 1 && /10분 뒤 시작/.test(sent[0].msg) && /알림시험 20분 뒤 회의/.test(sent[0].msg), sent);
      await c.query('DELETE FROM event_reminder_sent');
      sent.length = 0;
      await c.query('UPDATE telegram_links SET remind_lead = 60 WHERE user_id = $1', [kim]);
      await jobs.sendEventSoonReminders(at('10:00'));
      var s60 = sent.map(function (x) { return x.msg; }).join('\n');
      check('1시간 전 설정 → 일정 · 할 일 함께 ("20분 뒤" · "45분 뒤")', sent.length === 2 && /20분 뒤 시작/.test(s60) && /마감 10:45<\/b> \(45분 뒤\)/.test(s60), sent);

      // ── 5. 내일 미리보기 (저녁 6시) ──
      sent.length = 0;
      await c.query('INSERT INTO telegram_links (user_id, chat_id, is_active) VALUES ($1, 990012, TRUE) ON CONFLICT (user_id) DO UPDATE SET chat_id = 990012, is_active = TRUE', [adm]);
      await c.query("INSERT INTO notification_prefs (user_id, channel, event_type, is_enabled, tenant_id) VALUES ($1, 'telegram', 'event_tomorrow', FALSE, $2) ON CONFLICT (user_id, channel, event_type) DO UPDATE SET is_enabled = FALSE", [adm, tid]);
      await jobs.sendTomorrowPreview(Date.parse(kst(0) + 'T18:00:00+09:00'));
      var tk = sent.filter(function (x) { return x.chat === '990011'; });
      check('내일 미리보기 — 내일 일정 · 내일 마감', tk.length === 1 && /내일 미리보기/.test(tk[0].msg) && /10:20 알림시험 20분 뒤 회의/.test(tk[0].msg) && /10:45 알림시험 견적 회신/.test(tk[0].msg) && /알림시험 내 일정/.test(tk[0].msg), sent);
      check('끈 사람은 안 받음', !sent.some(function (x) { return x.chat === '990012'; }), sent);
    } finally {
      tg.sendMessage = origSend;
    }
    console.log('ALL PASS ' + n);
  } catch (e) {
    console.log('ERR', e.message);
    process.exitCode = 1;
  } finally {
    await clean();
    await c.query("DELETE FROM my_todos WHERE id = 'rmt-1'");
    await c.end();
  }
  process.exit(process.exitCode || 0);   // 불러온 알림 작업(jobs)의 DB 풀이 열려 있어 그냥은 안 끝남
})();
