/**
 * 텔레그램 업무 창구 (v13.301~305) — 실제 DB · 텔레그램 API 는 가짜(fetch)
 *  ① 고친 것: 보낸 사람(from.id)으로 사람 확인 · 그룹방 /start 계정 코드 거부 · 웹훅 비밀값 · 버튼 권한 · /log 회사 · 한국 날짜
 *  ② 답장 → 대응 이력 · 쪽지
 *  ③ 말로 등록 → 미리보기 → ✅ 한 번만 등록
 *  ④ 그룹방 연결 코드 → 프로젝트방
 *  ⑤ A/S 배정 버튼 · ⑥ 메뉴 · 방해 금지
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_BOT_USERNAME = 'wm_test_bot';
delete process.env.GEMINI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.AI_PROVIDER;

var sent = [];
var mid = 1000;
global.fetch = jest.fn(async function (url, opts) {
  var body = {};
  try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_) {}
  var method = String(url).split('/').pop();
  sent.push({ method: method, body: body });
  return {
    ok: true, status: 200,
    json: async function () { return { ok: true, result: { message_id: ++mid, chat: { id: body.chat_id } } }; },
    arrayBuffer: async function () { return new ArrayBuffer(0); }
  };
});

var cfg = require('../config');   // jest.setup 이 먼저 읽어 둔 설정 — 직접 넣는다
cfg.telegram.botToken = 'test-token';
cfg.telegram.botUsername = 'wm_test_bot';
cfg.ai.geminiKey = ''; cfg.ai.anthropicKey = ''; cfg.ai.provider = '';
var h = require('./helpers');
var db = h.db;
var T = h.TEST_TENANT_ID;
var S = Date.now();
var tg = require('../services/telegram.service');
var tgRoute = require('../routes/telegram');
var ns = require('../services/notification.service');
var aiUsage = require('../lib/ai-usage');
var compose = require('../telegram/compose');

var owner, viewer, admin;
var CH_OWNER = 700000000 + (S % 1000000), CH_VIEWER = CH_OWNER + 1, CH_ADMIN = CH_OWNER + 2;
var GROUP = -1000000000 - (S % 1000000);
var P = 'tg-p-' + S, ISS = 'tg-iss-' + S;

function texts(chatId) { return sent.filter(function (x) { return x.method === 'sendMessage' && (!chatId || String(x.body.chat_id) === String(chatId)); }).map(function (x) { return x.body.text; }); }
function last(chatId) { var t = texts(chatId); return t[t.length - 1] || ''; }
function msg(o) {
  return { message: Object.assign({ message_id: ++mid, date: 0 }, o, { chat: o.chat, from: o.from }) };
}
function priv(chatId, text, extra) { return msg(Object.assign({ chat: { id: chatId, type: 'private' }, from: { id: chatId, is_bot: false }, text: text }, extra || {})); }
function grp(fromId, text) { return msg({ chat: { id: GROUP, type: 'group', title: '설비팀 방' }, from: { id: fromId, is_bot: false }, text: text }); }
function cb(fromId, chatId, data, messageId) {
  return { id: 'cb' + (++mid), data: data, from: { id: fromId }, message: { message_id: messageId || ++mid, chat: { id: chatId, type: chatId > 0 ? 'private' : 'group' } } };
}
function answers() { return sent.filter(function (x) { return x.method === 'answerCallbackQuery'; }).map(function (x) { return x.body.text; }); }

beforeAll(async function () {
  await h.cleanup();
  await h.createTestTenant('tg-' + S);
  owner = await h.createTestUser({ email: 'tg-owner-' + S + '@test.com', name: '소유자' + S, role: 'member' });
  viewer = await h.createTestUser({ email: 'tg-viewer-' + S + '@test.com', name: '구경꾼' + S, role: 'member' });
  admin = await h.createTestUser({ email: 'tg-admin-' + S + '@test.com', name: '관리자' + S, role: 'admin' });
  await db.query("INSERT INTO projects (id, tenant_id, name, owner_id, visibility) VALUES ($1,$2,'설비 A',$3,'tenant')", [P, T, owner.user.id]);
  await db.query("INSERT INTO issues (id, tenant_id, project_id, title, status, urgency, reporter_id, assignees, created_by) VALUES ($1,$2,$3,'모터 소음','open','normal',$4,$5,$4)",
    [ISS, T, P, owner.user.id, JSON.stringify([owner.user.name])]);
  for (var x of [[owner, CH_OWNER], [viewer, CH_VIEWER], [admin, CH_ADMIN]]) {
    await db.query('INSERT INTO telegram_links (user_id, chat_id, tenant_id, is_active) VALUES ($1,$2,$3,TRUE)', [x[0].user.id, x[1], T]);
  }
});

afterAll(async function () {
  var ids = [owner, viewer, admin].filter(Boolean).map(function (u) { return u.user.id; });
  for (var t of ['telegram_refs', 'telegram_group_links', 'my_todos', 'issue_logs', 'messages', 'notification_logs', 'in_app_notifications', 'ai_query_usage', 'telegram_votes']) {
    await db.query('DELETE FROM ' + t + ' WHERE tenant_id = $1', [T]).catch(function () {});
  }
  await db.query('DELETE FROM telegram_links WHERE user_id = ANY($1)', [ids]).catch(function () {});
  await db.query('DELETE FROM telegram_auth_codes WHERE user_id = ANY($1)', [ids]).catch(function () {});
  await h.cleanup();
});

beforeEach(function () { sent = []; aiUsage._resetHourly(); });

describe('① 사람 확인 · 그룹방 · 비밀값', function () {
  test('1:1 대화 — 보낸 사람으로 찾음, 연동 안 한 사람은 안내', async function () {
    await tg.handleUpdate(priv(CH_OWNER, '/menu'));
    expect(last(CH_OWNER)).toMatch(/메뉴/);
    await tg.handleUpdate(priv(123, '/menu'));
    expect(last(123)).toMatch(/계정 연동이 필요/);
  });

  test('그룹방에서 /start 계정 코드는 거부 (방 전체가 한 사람 계정이 되던 것)', async function () {
    await db.query("INSERT INTO telegram_auth_codes (code, user_id, tenant_id, expires_at) VALUES ('Z' || substr(md5(random()::text),1,7), $1, $2, NOW() + INTERVAL '5 minutes')", [viewer.user.id, T]);
    await tg.handleUpdate(grp(CH_VIEWER, '/start ABCD2345'));
    expect(last(GROUP)).toMatch(/1:1 대화에서만/);
    var r = await db.query('SELECT 1 FROM telegram_links WHERE chat_id = $1', [GROUP]);
    expect(r.rows.length).toBe(0);
  });

  test('그룹방 명령 — @봇이름 붙어도 알아듣고, 연동 안 한 사람은 막음', async function () {
    await tg.handleUpdate(grp(CH_OWNER, '/help@wm_test_bot'));
    expect(last(GROUP)).toMatch(/그룹방에서 쓰는 명령/);
    await tg.handleUpdate(grp(55, '/issues'));
    expect(last(GROUP)).toMatch(/연동한 사람만/);
  });

  test('웹훅 비밀값 — 등록 뒤에는 헤더가 맞아야 받음', async function () {
    process.env.TELEGRAM_WEBHOOK_URL = 'https://example.test/api/telegram/webhook';
    require('../config').telegram.webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    await tg.setWebhook();
    var setCall = sent.filter(function (x) { return x.method === 'setWebhook'; })[0];
    expect(setCall.body.secret_token).toBe(tg.webhookSecret());
    expect(tg.secretActive()).toBe(true);
    var bad = await h.request(h.app).post('/api/telegram/webhook').send({});
    expect(bad.status).toBe(403);
    var ok = await h.request(h.app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', tg.webhookSecret()).send({});
    expect(ok.status).toBe(200);
  });
});

describe('① 버튼 권한 · 알림', function () {
  test('볼 수만 있는 사람은 이슈를 해결 처리 못 함', async function () {
    await tgRoute.handleCallbackQuery(cb(CH_VIEWER, CH_VIEWER, 'issue_resolve:' + ISS));
    expect(answers().join()).toMatch(/권한이 없습니다/);
    var r = await db.query('SELECT status FROM issues WHERE id = $1', [ISS]);
    expect(r.rows[0].status).toBe('open');
  });

  test('없는 이슈는 "찾을 수 없습니다" (예전엔 "해결 완료!")', async function () {
    await tgRoute.handleCallbackQuery(cb(CH_OWNER, CH_OWNER, 'issue_resolve:nope-' + S));
    expect(answers().join()).toMatch(/찾을 수 없습니다/);
  });

  test('담당자는 대응 시작 → 두 번째는 "이미"', async function () {
    await tgRoute.handleCallbackQuery(cb(CH_OWNER, CH_OWNER, 'issue_start:' + ISS));
    var r = await db.query('SELECT status FROM issues WHERE id = $1', [ISS]);
    expect(r.rows[0].status).toBe('inProgress');
    sent = [];
    await tgRoute.handleCallbackQuery(cb(CH_OWNER, CH_OWNER, 'issue_start:' + ISS));
    expect(answers().join()).toMatch(/이미/);
  });
});

describe('② 답장으로 일하기', function () {
  test('이슈 알림에 답장 → 대응 이력', async function () {
    await ns.notify('issue_assigned', { title: '모터 소음', urgency: 'normal', assignee: owner.user.name, issueId: ISS, replyRef: { kind: 'issue', id: ISS } }, [owner.user.id]);
    var note = sent.filter(function (x) { return x.method === 'sendMessage' && String(x.body.chat_id) === String(CH_OWNER); })[0];
    expect(note.body.text).toMatch(/답장하면 이 이슈의 대응 이력/);
    var ref = await db.query("SELECT message_id FROM telegram_refs WHERE kind = 'issue' AND ref_id = $1 AND user_id = $2", [ISS, owner.user.id]);
    expect(ref.rows.length).toBe(1);
    await tg.handleUpdate(priv(CH_OWNER, '베어링 교체 예정', { reply_to_message: { message_id: +ref.rows[0].message_id, from: { id: 1, is_bot: true } } }));
    var logs = await db.query('SELECT content, author_id FROM issue_logs WHERE issue_id = $1', [ISS]);
    expect(logs.rows.map(function (x) { return x.content; })).toContain('베어링 교체 예정');
    expect(last(CH_OWNER)).toMatch(/대응 이력에 남겼습니다/);
  });

  test('다른 사람 알림에 답장은 거부', async function () {
    var ref = await db.query("SELECT message_id FROM telegram_refs WHERE kind = 'issue' AND ref_id = $1", [ISS]);
    await db.query('UPDATE telegram_refs SET chat_id = $1 WHERE kind = $2 AND ref_id = $3', [CH_VIEWER, 'issue', ISS]);
    await tg.handleUpdate(priv(CH_VIEWER, '끼어들기', { reply_to_message: { message_id: +ref.rows[0].message_id, from: { id: 1, is_bot: true } } }));
    expect(last(CH_VIEWER)).toMatch(/알림을 받은 사람만/);
  });

  test('쪽지 알림에 답장 → 보낸 사람에게 쪽지', async function () {
    var out = await require('../routes/messages').sendSiteMessage(require('../telegram/actions').asReq({ user_id: admin.user.id, tenant_id: T, role: 'admin', name: admin.user.name }), { toUserId: owner.user.id, body: '점검 언제?' });
    expect(out.status).toBe(201);
    await new Promise(function (r) { setTimeout(r, 300); });   // 알림은 기다리지 않고 나감
    var ref = await db.query("SELECT message_id FROM telegram_refs WHERE kind = 'message' AND user_id = $1 ORDER BY id DESC LIMIT 1", [owner.user.id]);
    expect(ref.rows.length).toBe(1);
    await tg.handleUpdate(priv(CH_OWNER, '내일 오전요', { reply_to_message: { message_id: +ref.rows[0].message_id, from: { id: 1, is_bot: true } } }));
    var m = await db.query('SELECT from_user_id, to_user_id, body FROM messages WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1', [T]);
    expect(m.rows[0]).toMatchObject({ from_user_id: owner.user.id, to_user_id: admin.user.id, body: '내일 오전요' });
  });
});

describe('②-2 사진 · 피드백 답장', function () {
  test('이슈 알림에 사진 답장 → 대응 이력 + 첨부 표시 (저장소 없으면 안내)', async function () {
    var ref = await db.query("SELECT message_id, chat_id FROM telegram_refs WHERE kind = 'issue' AND ref_id = $1 ORDER BY id DESC LIMIT 1", [ISS]);
    await db.query('UPDATE telegram_refs SET chat_id = $1 WHERE kind = $2 AND ref_id = $3', [CH_OWNER, 'issue', ISS]);
    await tg.handleUpdate(priv(CH_OWNER, undefined, { caption: '교체 후 사진', photo: [{ file_id: 'f1', file_size: 10 }], reply_to_message: { message_id: +ref.rows[0].message_id, from: { id: 1, is_bot: true } } }));
    var logs = await db.query("SELECT content, attachment_note FROM issue_logs WHERE issue_id = $1 AND content = '교체 후 사진'", [ISS]);
    expect(logs.rows.length).toBe(1);
    expect(logs.rows[0].attachment_note).toMatch(/사진/);
  });

  test('피드백 알림에 답장 → 그 피드백에 답글, 원래 작성자에게 알림', async function () {
    var out = await require('../routes/comments').createComment(require('../telegram/actions').asReq({ user_id: admin.user.id, tenant_id: T, role: 'admin', name: admin.user.name }),
      { targetType: 'project', targetId: P, body: '납기 확인 부탁', recipientIds: [owner.user.id], sendEmail: false });
    expect(out.status).toBe(201);
    await new Promise(function (r) { setTimeout(r, 400); });
    var ref = await db.query("SELECT message_id FROM telegram_refs WHERE kind = 'comment' AND ref_id = $1", [out.body.data.id]);
    expect(ref.rows.length).toBe(1);
    sent = [];
    await tg.handleUpdate(priv(CH_OWNER, '이번 주 금요일입니다', { reply_to_message: { message_id: +ref.rows[0].message_id, from: { id: 1, is_bot: true } } }));
    var c = await db.query('SELECT parent_id, author_id FROM comments WHERE tenant_id = $1 AND body = $2', [T, '이번 주 금요일입니다']);
    expect(c.rows[0]).toMatchObject({ parent_id: out.body.data.id, author_id: owner.user.id });
    await new Promise(function (r) { setTimeout(r, 400); });
    expect(texts(CH_ADMIN).join()).toMatch(/이번 주 금요일입니다/);
  });
});

describe('③ 말로 등록', function () {
  test('구분: 등록 vs 질문', function () {
    expect(compose.classify('내일 3시 SK 미팅')).toBe('entry');
    expect(compose.classify('B2024-001 배선 작업 3시간')).toBe('entry');
    expect(compose.classify('금요일까지 견적서 보내기 !긴급')).toBe('entry');
    expect(compose.classify('이번 주 누가 제일 바빠?')).toBe('question');
    expect(compose.classify('내일 회의 몇 시야')).toBe('question');
    expect(compose.classify('내일 회의 일정 등록해줘')).toBe('entry');
  });

  test('AI 결과 검사 — 이상한 값은 버림', function () {
    expect(compose.cleanPlan({ kind: 'worklog', hours: 3, abbr: 'd', orderNo: 'B2024-001', content: '배선' }, 'x')).toMatchObject({ kind: 'worklog', log: { hours: 3, abbr: 'D', orderNo: 'B2024-001' } });
    expect(compose.cleanPlan({ kind: 'worklog', hours: 99, abbr: 'D' }, 'x').kind).toBe('todo');
    expect(compose.cleanPlan({ kind: 'drop table' }, 'x')).toBeNull();
    expect(compose.cleanPlan({ kind: 'todo', orderNo: "x'; --" , hours: 2, abbr: 'Q' }, 'x').log).toBeUndefined();
  });

  test('미리보기 → ✅ 한 번만 등록 (두 번 눌러도 1건)', async function () {
    await tg.handleUpdate(priv(CH_OWNER, '금요일까지 견적서 보내기 !긴급'));
    var pv = sent.filter(function (x) { return x.method === 'sendMessage' && /이렇게 등록할까요/.test(x.body.text); })[0];
    expect(pv).toBeTruthy();
    var kb = JSON.parse(pv.body.reply_markup).inline_keyboard;
    var okData = kb[0][0].callback_data;
    expect(okData).toMatch(/^cp:ok:/);
    await tgRoute.handleCallbackQuery(cb(CH_OWNER, CH_OWNER, okData, 4242));
    await tgRoute.handleCallbackQuery(cb(CH_OWNER, CH_OWNER, okData, 4242));
    var r = await db.query("SELECT title, priority FROM my_todos WHERE tenant_id = $1 AND user_id = $2 AND title LIKE '%견적서%'", [T, owner.user.id]);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].priority).toBe(1);
    expect(answers().join()).toMatch(/이미 처리/);
  });

  test('다른 사람은 내 미리보기를 등록 못 함', async function () {
    await tg.handleUpdate(priv(CH_OWNER, '모레 10시 #회의 고객 미팅'));
    var pv = sent.filter(function (x) { return /이렇게 등록할까요/.test(x.body.text || ''); })[0];
    var okData = JSON.parse(pv.body.reply_markup).inline_keyboard[0][0].callback_data;
    await tgRoute.handleCallbackQuery(cb(CH_VIEWER, CH_OWNER, okData, 4343));
    var e = await db.query("SELECT 1 FROM events WHERE tenant_id = $1 AND title = '고객 미팅'", [T]);
    expect(e.rows.length).toBe(0);
  });
});

describe('/log — 회사 · 한국 날짜', function () {
  test('tenant_id 가 들어가고 수주번호 아닌 낱말은 내용으로', async function () {
    await tg.handleUpdate(priv(CH_OWNER, '2h D 2차 배선'));
    var r = await db.query('SELECT tenant_id, order_no, content, date FROM work_records WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [owner.user.id]);
    expect(r.rows[0].tenant_id).toBe(T);
    expect(r.rows[0].order_no).toBeNull();
    expect(r.rows[0].content).toBe('2차 배선');
    expect(r.rows[0].date).toBe(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, ''));
  });
});

describe('④ 그룹방 = 프로젝트방', function () {
  test('웹 코드 → 그룹에서 /start@봇 코드 → 연결, 볼 수만 있는 사람은 코드 못 만듦', async function () {
    var no = await h.request(h.app).post('/api/telegram/group-code').set('Authorization', 'Bearer ' + viewer.token).send({ projectId: P });
    expect(no.status).toBe(403);
    var r = await h.request(h.app).post('/api/telegram/group-code').set('Authorization', 'Bearer ' + owner.token).send({ projectId: P });
    expect(r.status).toBe(200);
    expect(r.body.data.link).toBe('https://t.me/wm_test_bot?startgroup=' + r.body.data.code);
    await tg.handleUpdate(grp(CH_OWNER, '/start@wm_test_bot ' + r.body.data.code));
    expect(last(GROUP)).toMatch(/프로젝트방 연결 완료/);
    var g = await db.query('SELECT link_type, link_id, tenant_id, title FROM telegram_group_links WHERE chat_id = $1', [GROUP]);
    expect(g.rows[0]).toMatchObject({ link_type: 'project', link_id: P, tenant_id: T, title: '설비팀 방' });
    // 코드는 한 번만
    await tg.handleUpdate(grp(CH_OWNER, '/linkgroup ' + r.body.data.code));
    expect(last(GROUP)).toMatch(/맞지 않거나/);
    var list = await h.request(h.app).get('/api/telegram/groups?projectId=' + P).set('Authorization', 'Bearer ' + viewer.token);
    expect(list.body.data.length).toBe(1);
    expect(list.body.canEdit).toBe(false);
  });

  test('그룹방 /issues — 이 프로젝트 열린 이슈', async function () {
    await tg.handleUpdate(grp(CH_VIEWER, '/issues'));
    expect(last(GROUP)).toMatch(/모터 소음/);
  });

  test('그룹방 투표 — 누른 사람으로 집계', async function () {
    await tg.handleUpdate(grp(CH_OWNER, '/vote 점심\n짜장\n짬뽕'));
    var v = await db.query('SELECT id FROM telegram_votes WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1', [T]);
    await tgRoute.handleCallbackQuery(cb(CH_VIEWER, GROUP, 'vote:' + v.rows[0].id + ':1'));
    await tgRoute.handleCallbackQuery(cb(CH_OWNER, GROUP, 'vote:' + v.rows[0].id + ':1'));
    var c = await db.query('SELECT COUNT(*)::int AS n FROM telegram_vote_responses WHERE vote_id = $1', [v.rows[0].id]);
    expect(c.rows[0].n).toBe(2);
    await db.query('DELETE FROM telegram_vote_responses WHERE vote_id = $1', [v.rows[0].id]);
  });
});

describe('⑥ 메뉴 · 방해 금지 · AI 한도', function () {
  test('메뉴 버튼 → 명령 실행', async function () {
    await tgRoute.handleCallbackQuery(cb(CH_OWNER, CH_OWNER, 'mn:todos'));
    expect(last(CH_OWNER)).toMatch(/할 일/);
  });

  test('방해 금지 시간 판정 (자정 넘김 포함)', function () {
    var at = function (hh, mm) { return Date.UTC(2026, 10, 2, hh - 9, mm); };   // KST → UTC
    var inQ = require('../services/notification/dispatch').inQuiet;
    expect(inQ('22:00', '07:00', at(23, 30))).toBe(true);
    expect(inQ('22:00', '07:00', at(6, 59))).toBe(true);
    expect(inQ('22:00', '07:00', at(12, 0))).toBe(false);
    expect(inQ('13:00', '14:00', at(13, 30))).toBe(true);
    expect(inQ('', '', at(13, 30))).toBe(false);
  });

  test('방해 금지 설정 → 알림이 소리 없이', async function () {
    var r = await h.request(h.app).put('/api/telegram/prefs/quiet').set('Authorization', 'Bearer ' + admin.token).send({ start: '00:00', end: '23:59' });
    expect(r.status).toBe(200);
    var bad = await h.request(h.app).put('/api/telegram/prefs/quiet').set('Authorization', 'Bearer ' + admin.token).send({ start: '25:00', end: '07:00' });
    expect(bad.status).toBe(400);
    await ns.notify('message_received', { fromName: 'x', body: 'y' }, [admin.user.id]);
    var m = sent.filter(function (x) { return x.method === 'sendMessage' && String(x.body.chat_id) === String(CH_ADMIN); })[0];
    expect(m.body.disable_notification).toBe(true);
    await h.request(h.app).put('/api/telegram/prefs/quiet').set('Authorization', 'Bearer ' + admin.token).send({ start: '', end: '' });
  });

  test('텔레그램 AI 질문도 시간당 한도', async function () {
    for (var i = 0; i < aiUsage.HOURLY; i++) aiUsage.takeHourly(viewer.user.id);
    await tg.handleUpdate(priv(CH_VIEWER, '이번 주 누가 제일 바빠?'));
    expect(last(CH_VIEWER)).toMatch(/한 시간에/);
  });
});

describe('⑤ A/S 배정 버튼', function () {
  test('담당자만 작업 시작', async function () {
    var tid = 'tg-as-' + S, aid = 'tg-asg-' + S;
    await db.query("INSERT INTO as_tickets (id, tenant_id, ticket_no, status, priority, customer_name, issue_summary, created_by) VALUES ($1,$2,$3,'assigned','P2','고객','소음',$4)", [tid, T, 'AS-' + S, owner.user.id]);
    await db.query("INSERT INTO as_assignments (id, ticket_id, tenant_id, dept, role, assignee_id, status, created_by) VALUES ($1,$2,$3,'cs','primary',$4,'pending',$4)", [aid, tid, T, owner.user.id]);
    await tgRoute.handleCallbackQuery(cb(CH_VIEWER, CH_VIEWER, 'asg_start:' + aid));
    expect(answers().join()).toMatch(/담당자만/);
    await tgRoute.handleCallbackQuery(cb(CH_OWNER, CH_OWNER, 'asg_start:' + aid));
    var a = await db.query('SELECT status, started_at FROM as_assignments WHERE id = $1', [aid]);
    expect(a.rows[0].status).toBe('in_progress');
    expect(a.rows[0].started_at).toBeTruthy();
    var t = await db.query('SELECT status FROM as_tickets WHERE id = $1', [tid]);
    expect(t.rows[0].status).toBe('in_progress');
    await db.query('DELETE FROM as_assignments WHERE id = $1', [aid]);
    await db.query('DELETE FROM as_tickets WHERE id = $1', [tid]);
  });
});
