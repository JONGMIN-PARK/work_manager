// 내 업무 달력 API — 일정 시각 · 내 일정 모으기/권한 · 반복 회차 · 끌어 마감 바꾸기 · .ics 구독 · 브리핑 '오늘 내 일정' · 30분 전 알림 (v13.252)
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

(async function () {
  var c = new pg.Client(process.env.DATABASE_URL); await c.connect();
  var U = {};
  (await c.query("SELECT id, email, tenant_id FROM users WHERE email IN ('admin@t.com','kim@t.com','lee@t.com')")).rows.forEach(function (r) { U[r.email.split('@')[0]] = r; });
  var tid = U.kim.tenant_id, kim = U.kim.id, lee = U.lee.id, adm = U.admin.id;
  await c.query("DELETE FROM events WHERE title LIKE '달력%'");
  await c.query("DELETE FROM my_todos WHERE title LIKE '달력%'");
  await c.query("DELETE FROM mindmaps WHERE title LIKE '달력%'");
  await c.query("DELETE FROM issues WHERE id LIKE 'cal-%'");
  await c.query("DELETE FROM meetings WHERE id LIKE 'cal-%'");
  await c.query("DELETE FROM milestones WHERE id LIKE 'cal-%'");
  await c.query("DELETE FROM projects WHERE id LIKE 'cal-%'");
  await c.query('DELETE FROM calendar_feeds');
  await c.query('DELETE FROM event_reminder_sent');
  await c.query("DELETE FROM edit_locks WHERE resource_type = 'mindmap'");
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('cal-p1', '달력 프로젝트', 'active', 'tenant', $1, $2)", [adm, tid]);
  await c.query("INSERT INTO projects (id, name, status, visibility, owner_id, tenant_id) VALUES ('cal-p2', '달력 비공개', 'active', 'private', $1, $2)", [adm, tid]);

  var A = api(await login('admin@t.com')), K = api(await login('kim@t.com')), L = api(await login('lee@t.com'));

  // ── 1. 일정 시각 저장 ──
  var e1 = await K('POST', '/api/events', { title: '달력 개인 회의', type: 'meeting', startDate: kst(0), endDate: kst(0), startTime: '9:05', endTime: '10:30', projectIds: [] });
  check('시각 저장 — 9:05 → 09:05', e1.s === 201 && e1.d.data.start_time === '09:05' && e1.d.data.end_time === '10:30', e1.d);
  var e2 = await K('POST', '/api/events', { title: '달력 종일', startDate: kst(1), endDate: kst(2), startTime: '25:00', projectIds: [] });
  check('이상한 시각은 하루 종일', e2.d.data.start_time === null && e2.d.data.end_time === null, e2.d);
  var up = await K('PUT', '/api/events/' + e2.d.data.id, { startTime: '14:00', endTime: '15:00', version: e2.d.data.version });
  check('수정으로 시각 넣기', up.s === 200 && up.d.data.start_time === '14:00', up.d);
  up = await K('PUT', '/api/events/' + e2.d.data.id, { startTime: '', endTime: '' });
  check('시각 비우면 하루 종일로', up.d.data.start_time === null, up.d);
  var e3 = await A('POST', '/api/events', { title: '달력 프로젝트 점검', type: 'periodicChk', startDate: kst(-14), endDate: kst(-14), startTime: '13:00', repeat: 'weekly', projectIds: ['cal-p1'], assignees: ['김팀원'] });
  var e4 = await A('POST', '/api/events', { title: '달력 관리자 개인', startDate: kst(0), endDate: kst(0), projectIds: [] });
  var e5 = await A('POST', '/api/events', { title: '달력 비공개 회의', startDate: kst(0), endDate: kst(0), projectIds: ['cal-p2'], assignees: ['김팀원'] });

  // ── 2. 내 일정 모으기 ──
  var r = await K('GET', '/api/my-work/events?from=' + kst(-3) + '&to=' + kst(10));
  var titles = r.d.data.map(function (x) { return x.title; });
  check('김 — 만든 일정 · 담당 일정(반복 원본 포함)', titles.indexOf('달력 개인 회의') >= 0 && titles.indexOf('달력 종일') >= 0 && titles.indexOf('달력 프로젝트 점검') >= 0, titles);
  check('김 — 남의 개인 일정은 없음', titles.indexOf('달력 관리자 개인') < 0, titles);
  check('담당이면 비공개 프로젝트 일정도 본인에겐 보임', titles.indexOf('달력 비공개 회의') >= 0, titles);
  var mine = r.d.data.filter(function (x) { return x.title === '달력 개인 회의'; })[0];
  var proj = r.d.data.filter(function (x) { return x.title === '달력 프로젝트 점검'; })[0];
  check('수정 가능 표시 — 내가 만든 것 O, 남이 만든 프로젝트 일정 X', mine.can_modify === true && proj.can_modify === false, [mine.can_modify, proj.can_modify]);
  check('반복 일정은 시작이 범위 앞이어도 나옴', proj.start_date === kst(-14));
  r = await K('GET', '/api/my-work/events?from=' + kst(30) + '&to=' + kst(40));
  check('반복 아닌 지난 일정은 범위 밖이면 없음', !r.d.data.some(function (x) { return x.title === '달력 개인 회의'; }) && r.d.data.some(function (x) { return x.title === '달력 프로젝트 점검'; }), r.d.data.map(function (x) { return x.title; }));
  r = await A('GET', '/api/my-work/events?userId=' + kim + '&from=' + kst(-3) + '&to=' + kst(10));
  titles = r.d.data.map(function (x) { return x.title; });
  check('관리자가 김 달력 — 프로젝트 일정만, 김 개인 일정은 안 보임', titles.indexOf('달력 프로젝트 점검') >= 0 && titles.indexOf('달력 개인 회의') < 0, titles);
  check('팀원은 남의 달력 못 봄', (await L('GET', '/api/my-work/events?userId=' + kim)).s === 403);
  check('기간 너무 길면 400', (await K('GET', '/api/my-work/events?from=2020-01-01&to=2026-01-01')).s === 400);

  // 회의 → 일정: 시각 · 참석자도 따라감
  var mt = await A('POST', '/api/meetings', { title: '달력 주간회의', projectId: 'cal-p1', meetDate: kst(2), attendees: ['김팀원'], form: { timeStart: '15:00', timeEnd: '16:00' } });
  var mev = (await c.query('SELECT start_time, end_time, assignees FROM events WHERE id = $1', [mt.d.data.event_id])).rows[0];
  check('회의 시각 · 참석자 → 일정', mt.s === 201 && mev.start_time === '15:00' && mev.end_time === '16:00' && JSON.stringify(mev.assignees) === '["김팀원"]', [mt.s, mev]);
  r = await K('GET', '/api/my-work/events?from=' + kst(0) + '&to=' + kst(7));
  check('참석자 김 달력에 회의', r.d.data.some(function (x) { return x.title === '달력 주간회의' && x.start_time === '15:00'; }));
  await A('PUT', '/api/meetings/' + mt.d.data.id, { form: { timeStart: '', timeEnd: '' }, attendees: [] });
  mev = (await c.query('SELECT start_time, assignees FROM events WHERE id = $1', [mt.d.data.event_id])).rows[0];
  check('회의 시각 지우면 일정도 하루 종일', mev.start_time === null && JSON.stringify(mev.assignees) === '[]', mev);
  await c.query('DELETE FROM meetings WHERE id = $1', [mt.d.data.id]);
  await c.query('DELETE FROM events WHERE id = $1', [mt.d.data.event_id]);

  var myEvents = require(path.join(__dirname, '../../server/lib/my-events'));
  var occ = myEvents.occurrences({ start_date: '2026-01-31', end_date: '2026-01-31', repeat: 'monthly' }, '2026-02-01', '2026-04-30');
  check('매월 31일 반복 → 2월 말일 · 3/31 · 4/30', JSON.stringify(occ.map(function (o) { return o.date; })) === '["2026-02-28","2026-03-31","2026-04-30"]', occ);
  occ = myEvents.occurrences({ start_date: '2026-01-05', end_date: '2026-01-06', repeat: 'biweekly', repeat_until: '2026-02-03' }, '2026-01-01', '2026-03-01');
  check('격주 반복 · 종료일 · 이틀짜리', JSON.stringify(occ) === '[{"date":"2026-01-05","end":"2026-01-06"},{"date":"2026-01-19","end":"2026-01-20"},{"date":"2026-02-02","end":"2026-02-03"}]', occ);

  // ── 3. 끌어서 마감 바꾸기 ──
  var td = (await K('POST', '/api/my-work/todos', { title: '달력 할 일', dueDate: kst(1) })).d.data;
  var mv = await K('PUT', '/api/my-work/due', { src: 'todo', id: td.id, due: kst(3) });
  check('개인 할 일 마감 옮김', mv.s === 200 && (await c.query('SELECT due_date FROM my_todos WHERE id = $1', [td.id])).rows[0].due_date === kst(3), mv.d);
  await c.query("INSERT INTO issues (id, project_id, title, status, urgency, due_date, assignees, tenant_id) VALUES ('cal-i1', 'cal-p1', '달력 이슈', 'open', 'normal', $1, '[\"김팀원\"]', $2)", [kst(2), tid]);
  mv = await K('PUT', '/api/my-work/due', { src: 'issue', id: 'cal-i1', due: kst(5) });
  check('이슈 마감 옮김 (원래 자리)', mv.s === 200 && (await c.query("SELECT due_date FROM issues WHERE id = 'cal-i1'")).rows[0].due_date === kst(5), mv.d);
  await c.query("INSERT INTO meetings (id, project_id, title, meet_date, tenant_id) VALUES ('cal-m1', 'cal-p1', '달력회의', $1, $2)", [kst(0), tid]);
  await c.query("INSERT INTO meeting_action_items (id, meeting_id, title, assignee_id, assignee_name, due_date, status, tenant_id) VALUES ('cal-a1', 'cal-m1', '달력 액션', $1, '김팀원', $2, 'open', $3)", [kim, kst(1), tid]);
  mv = await K('PUT', '/api/my-work/due', { src: 'action', id: 'cal-a1', due: null });
  check('회의 액션 마감 없앰', mv.s === 200 && (await c.query("SELECT due_date FROM meeting_action_items WHERE id = 'cal-a1'")).rows[0].due_date === null, mv.d);
  var doc = { sheets: [{ id: 's1', title: '시트', root: { id: 'r', text: '달력 맵', children: [{ id: 'n1', text: '달력 주제', assigneeId: kim, dueDate: kst(1), children: [] }] } }] };
  await c.query("INSERT INTO mindmaps (id, tenant_id, title, scope, owner_id, doc, node_count, version) VALUES ('mm-cal1', $1, '달력 맵', 'org', $2, $3, 2, 1)", [tid, adm, JSON.stringify(doc)]);
  mv = await K('PUT', '/api/my-work/due', { src: 'mindmap', id: 'mm-cal1:n1', due: kst(4) });
  var d1 = (await c.query("SELECT doc, version FROM mindmaps WHERE id = 'mm-cal1'")).rows[0];
  check('맵 주제 마감 옮김 · 버전 올라감', mv.s === 200 && d1.doc.sheets[0].root.children[0].dueDate === kst(4) && d1.version === 2, d1);
  await c.query("INSERT INTO edit_locks (resource_type, resource_id, user_id, user_name, tenant_id, expires_at) VALUES ('mindmap', 'mm-cal1', $1, '관리자', $2, now() + interval '5 minutes')", [adm, tid]);
  mv = await K('PUT', '/api/my-work/due', { src: 'mindmap', id: 'mm-cal1:n1', due: kst(6) });
  check('맵 편집 중이면 409 LOCKED + 누가', mv.s === 409 && mv.d.error === 'LOCKED' && /관리자/.test(mv.d.message), mv.d);
  await c.query("DELETE FROM edit_locks WHERE resource_type = 'mindmap'");
  await c.query("INSERT INTO milestones (id, project_id, name, end_date, status, tenant_id) VALUES ('cal-ms1', 'cal-p1', '달력 마일스톤', $1, 'active', $2)", [kst(3), tid]);
  check('마일스톤은 여기서 못 바꿈 (400)', (await K('PUT', '/api/my-work/due', { src: 'milestone', id: 'cal-ms1', due: kst(4) })).s === 400);
  check('남의 일은 못 바꿈 (403)', (await L('PUT', '/api/my-work/due', { src: 'issue', id: 'cal-i1', userId: kim, due: kst(4) })).s === 403);
  check('담당 아닌 이슈는 404', (await L('PUT', '/api/my-work/due', { src: 'issue', id: 'cal-i1', due: kst(4) })).s === 404);
  check('날짜 형식 틀리면 400', (await K('PUT', '/api/my-work/due', { src: 'todo', id: td.id, due: '2026/1/1' })).s === 400);
  check('관리자는 남의 마감도 옮김', (await A('PUT', '/api/my-work/due', { src: 'issue', id: 'cal-i1', userId: kim, due: kst(6) })).s === 200);

  // ── 4. .ics 구독 ──
  check('처음엔 구독 주소 없음', (await K('GET', '/api/my-work/feed')).d.data === null);
  var f1 = (await K('POST', '/api/my-work/feed')).d.data;
  check('구독 주소 만듦', /^http:\/\/localhost:3000\/api\/ics\/[a-f0-9]{48}\.ics$/.test(f1.url), f1);
  var res = await fetch(f1.url.replace('http://localhost:3000', B));
  var body = await res.text();
  check('.ics — text/calendar · 달력 이름', res.status === 200 && /text\/calendar/.test(res.headers.get('content-type')) && /BEGIN:VCALENDAR/.test(body) && /X-WR-CALNAME:내 업무 · 김팀원/.test(body), body.slice(0, 300));
  var unf = body.replace(/\r\n /g, '');
  check('.ics — 할 일은 마감일 하루 종일', unf.indexOf('SUMMARY:✏️ 달력 할 일') >= 0 && unf.indexOf('DTSTART;VALUE=DATE:' + kst(3).replace(/-/g, '')) >= 0, unf);
  check('.ics — 시각 일정은 UTC 로 (09:05 KST = 00:05Z)', unf.indexOf('DTSTART:' + kst(0).replace(/-/g, '') + 'T000500Z') >= 0 && unf.indexOf('DTEND:' + kst(0).replace(/-/g, '') + 'T013000Z') >= 0, unf);
  check('.ics — 반복은 RRULE', /RRULE:FREQ=WEEKLY/.test(unf));
  check('.ics — 남의 개인 일정 없음', unf.indexOf('달력 관리자 개인') < 0);
  check('.ics — 줄 75바이트 이하 · CRLF', body.split('\r\n').every(function (l) { return Buffer.byteLength(l, 'utf8') <= 75; }) && body.indexOf('\n') === body.indexOf('\r\n') + 1);
  check('마지막 사용 시각 기록', !!(await c.query('SELECT last_used_at FROM calendar_feeds WHERE user_id = $1', [kim])).rows[0].last_used_at);
  var f2 = (await K('POST', '/api/my-work/feed')).d.data;
  check('새 주소 → 옛 주소 404', f2.url !== f1.url && (await fetch(f1.url)).status === 404 && (await fetch(f2.url)).status === 200);
  check('엉뚱한 토큰 404', (await fetch(B + '/api/ics/zzz.ics')).status === 404 && (await fetch(B + '/api/ics/' + 'a'.repeat(48) + '.ics')).status === 404);
  await c.query("UPDATE users SET status = 'inactive' WHERE id = $1", [kim]);
  var inact = (await fetch(f2.url)).status;
  await c.query("UPDATE users SET status = 'active' WHERE id = $1", [kim]);
  check('비활성 사용자 구독은 끊김', inact === 404);
  await K('DELETE', '/api/my-work/feed');
  check('구독 끄면 404', (await fetch(f2.url)).status === 404 && (await K('GET', '/api/my-work/feed')).d.data === null);

  // ── 5. 아침 브리핑 · 30분 전 알림 ──
  var jobs = require(path.join(__dirname, '../../server/services/notification/jobs'));
  var blk = await jobs._myEventsBlock({ user_id: kim, name: '김팀원', tenant_id: tid }, kst(0));
  check('브리핑 — 오늘 내 일정 · 시각', /오늘 내 일정/.test(blk.text) && /09:05~10:30 달력 개인 회의/.test(blk.text) && blk.ids[e1.d.data.id], blk);
  check('브리핑 — 남의 개인 일정 없음', blk.text.indexOf('달력 관리자 개인') < 0);
  var tg = require(path.join(__dirname, '../../server/services/telegram.service'));
  var sent = [], origSend = tg.sendMessage;
  tg.sendMessage = async function (chat, msg) { sent.push({ chat: String(chat), msg: msg }); return { ok: true }; };
  try {
    var nowK = new Date(Date.now() + 9 * 3600 * 1000);
    var soon = new Date(nowK.getTime() + 12 * 60000);
    if (soon.toISOString().slice(0, 10) === kst(0)) {
      var hm = soon.toISOString().slice(11, 16);
      await c.query('DELETE FROM telegram_links WHERE chat_id IN (990001, 990002)');
      await c.query("DELETE FROM notification_prefs WHERE user_id = $1 AND event_type = 'event_soon'", [kim]);   // 앞 실행이 중간에 멈춰 남긴 '알림 끔' 정리
      await c.query('INSERT INTO telegram_links (user_id, chat_id, is_active) VALUES ($1, 990001, TRUE) ON CONFLICT (user_id) DO UPDATE SET chat_id = 990001, is_active = TRUE', [kim]);
      await c.query('INSERT INTO telegram_links (user_id, chat_id, is_active) VALUES ($1, 990002, TRUE) ON CONFLICT (user_id) DO UPDATE SET chat_id = 990002, is_active = TRUE', [lee]);
      var s1 = (await A('POST', '/api/events', { title: '달력 곧 회의', type: 'meeting', startDate: kst(0), endDate: kst(0), startTime: hm, projectIds: ['cal-p1'], assignees: ['김팀원'] })).d.data;
      await A('POST', '/api/events', { title: '달력 먼 회의', startDate: kst(0), endDate: kst(0), startTime: new Date(nowK.getTime() + 50 * 60000).toISOString().slice(11, 16), projectIds: ['cal-p1'], assignees: ['김팀원'] });
      await A('POST', '/api/events', { title: '달력 지난주 반복', startDate: kst(-7), endDate: kst(-7), startTime: hm, repeat: 'weekly', projectIds: ['cal-p1'], assignees: ['이팀원'] });
      await jobs.sendEventSoonReminders();
      // 앞에서 만든 09:05 일정은 돌리는 시각에 따라 30분 안에 들 수 있어 셈에서 뺌
      var toKim = sent.filter(function (x) { return x.chat === '990001' && !/달력 개인 회의/.test(x.msg); }), toLee = sent.filter(function (x) { return x.chat === '990002'; });
      check('30분 안 일정 → 담당에게 한 번', toKim.length === 1 && /분 뒤 시작/.test(toKim[0].msg) && /달력 곧 회의/.test(toKim[0].msg), sent);
      check('50분 뒤 일정은 아직', !sent.some(function (x) { return /달력 먼 회의/.test(x.msg); }));
      check('반복 회차(오늘)도 알림', toLee.length === 1 && /달력 지난주 반복/.test(toLee[0].msg), sent);
      var n1 = sent.length;
      await jobs.sendEventSoonReminders();
      check('두 번 돌려도 한 번만', sent.length === n1, sent);
      await c.query("DELETE FROM event_reminder_sent WHERE event_id = $1", [s1.id]);
      await c.query("INSERT INTO notification_prefs (user_id, channel, event_type, is_enabled, tenant_id) VALUES ($1, 'telegram', 'event_soon', FALSE, $2)", [kim, tid]);
      await jobs.sendEventSoonReminders();
      check('알림 끈 사람은 안 받음', sent.length === n1, sent);
      await c.query("DELETE FROM notification_prefs WHERE user_id = $1 AND event_type = 'event_soon'", [kim]);
      await c.query('DELETE FROM telegram_links WHERE chat_id IN (990001, 990002)');
    } else {
      console.log('· 자정 가까워 30분 전 알림 시험은 건너뜀');
    }
  } finally {
    tg.sendMessage = origSend;
    // 다른 시험(업무 부하 개수 등)에 섞이지 않게 만든 것 모두 지움
    await c.query("DELETE FROM mindmaps WHERE title LIKE '달력%'");
    await c.query("DELETE FROM events WHERE title LIKE '달력%'");
    await c.query("DELETE FROM my_todos WHERE title LIKE '달력%'");
    await c.query("DELETE FROM issues WHERE id LIKE 'cal-%'");
    await c.query("DELETE FROM meetings WHERE id LIKE 'cal-%'");
    await c.query("DELETE FROM milestones WHERE id LIKE 'cal-%'");
    await c.query("DELETE FROM projects WHERE id LIKE 'cal-%'");
    await c.query('DELETE FROM calendar_feeds');
  }
  await c.end();
  console.log('\nALL PASS ' + n);
  process.exit(0);
})().catch(function (e) { console.log('ERR', e.message, e.stack); process.exit(1); });
