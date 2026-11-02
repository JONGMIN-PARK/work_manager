/**
 * 회의록 양식·미리 보기·메일 (v13.198)
 */
var h = require('./helpers');
var minutes = require('../lib/meeting-minutes');
var emailService = require('../services/email.service');

describe('회의록 문서 (lib/meeting-minutes)', function () {
  test('양식 칸·안건·액션을 표로, 값은 이스케이프', function () {
    var doc = minutes.renderMinutes({
      title: '설계 <검토>', meet_date: '2026-09-30', attendees: ['박설계', '김전장'],
      agenda: [{ text: '축 구성 확정', done: true }, '레거시 문자열 안건'],
      minutes: '1줄\n2줄', form: { timeStart: '10:00', timeEnd: '11:30', place: '3층 회의실', writer: '박설계', decisions: 'X축 볼스크류 L10', nextDate: '2026-10-07', nextNote: '전장 검토' },
      action_items: [{ title: '드라이브 선정', assignee_name: '김전장', due_date: '2026-10-02', status: 'open' }]
    }, { projectName: '광 정렬기 #3', orderNo: 'A-31', message: '공유드립니다' });
    expect(doc.subject).toBe('[회의록] 설계 <검토> (2026-09-30)');
    expect(doc.html).toContain('설계 &lt;검토&gt;');
    expect(doc.html).not.toContain('<검토>');
    expect(doc.html).toContain('2026-09-30 10:00 ~ 11:30');
    expect(doc.html).toContain('3층 회의실');
    expect(doc.html).toContain('1줄<br>2줄');
    expect(doc.html).toContain('축 구성 확정 <span style="color:#10b981;white-space:nowrap;font-weight:400">(완료)</span>');
    expect(doc.html).toContain('레거시 문자열 안건');
    expect(doc.html).toContain('드라이브 선정');
    expect(doc.html).toContain('광 정렬기 #3 <span style="color:#64748b;white-space:nowrap">(A-31)</span>');
    // v13.200 양식: 절 제목, 참석자 칩, 액션 담당·기한·상태는 줄바꿈 없음
    ['1. 회의 개요', '2. 안건 및 논의', '3. 결정 사항', '4. 액션 아이템', '5. 다음 회의', '기타 논의', '참석 인원'].forEach(function (t) { expect(doc.html).toContain(t); });
    expect(doc.html).toMatch(/white-space:nowrap">김전장<\/td>/);
    expect(doc.docNo).toMatch(/^MTG-20260930-/);
    expect(doc.html).toContain('공유드립니다');
  });
  test('안건별 논의·결과가 있으면 표, 결재란은 선택', function () {
    var d = minutes.renderMinutes({ id: 'mtg-abcd1234', title: 'T', meet_date: '2026-09-30', agenda: [{ text: 'A', note: '논의1', result: '결과1' }, { text: 'B' }] }, { sign: true });
    expect(d.html).toContain('<th style="background:#f1f5f9;color:#334155;padding:6px 8px;border:1px solid #cbd5e1;text-align:left;white-space:nowrap;font-weight:700">논의 내용</th>');
    expect(d.html).toContain('논의1');
    expect(d.html).toContain('결과1');
    expect(d.html).toContain('>승인</th>');
    expect(d.docNo).toBe('MTG-20260930-1234');
    expect(minutes.renderMinutes({ title: 'T' }, {}).html).not.toContain('승인');
  });
  test('메일 주소 검사', function () {
    expect(minutes.isEmail('a.b@c.co.kr')).toBe(true);
    ['a@b', 'a b@c.com', 'a@b.com\r\nBcc: x@y.com', '<a@b.com>', ''].forEach(function (e) { expect(minutes.isEmail(e)).toBe(false); });
  });
});

describe('회의록 API', function () {
  var admin, member, outsider, projId, mid;
  beforeAll(async function () {
    await h.createTestTenant('mtg-' + Date.now());
    admin = await h.createTestUser({ role: 'admin', email: 'mtg-admin@test.com', name: '박설계' });
    member = await h.createTestUser({ role: 'member', email: 'mtg-member@test.com', name: '김전장' });
    outsider = await h.createTestUser({ role: 'member', email: 'mtg-out@test.com', name: '외부인' });
    var p = await h.request(h.app).post('/api/projects').set('Authorization', 'Bearer ' + admin.token).send({ name: '회의 프로젝트', status: 'active', visibility: 'private' });
    projId = p.body.data.id;
  });
  afterAll(async function () { await h.cleanup(); });
  function as(u) { return { post: function (url, b) { return h.request(h.app).post(url).set('Authorization', 'Bearer ' + u.token).send(b || {}); }, put: function (url, b) { return h.request(h.app).put(url).set('Authorization', 'Bearer ' + u.token).send(b || {}); }, get: function (url) { return h.request(h.app).get(url).set('Authorization', 'Bearer ' + u.token); } }; }

  test('양식 칸 저장 — 알려진 키만, 빈 값 제외', async function () {
    var c = await as(admin).post('/api/meetings', { projectId: projId, title: '킥오프', meetDate: '2026-09-30', attendees: ['박설계', '김전장', '없는사람'], form: { writer: '박설계' } });
    expect(c.status).toBe(201);
    mid = c.body.data.id;
    expect(c.body.data.form).toEqual({ writer: '박설계' });
    var u = await as(admin).put('/api/meetings/' + mid, { minutes: '논의', form: { place: '회의실', decisions: '결정', timeStart: '10:00', hack: 'x', nextNote: '' } });
    expect(u.status).toBe(200);
    expect(u.body.data.form).toEqual({ place: '회의실', decisions: '결정', timeStart: '10:00' });
    var done = await as(admin).put('/api/meetings/' + mid, { form: { place: '회의실', completedAt: '2026-09-29T05:00:00.000Z', completedBy: '박설계' } });
    expect(done.body.data.form).toEqual({ place: '회의실', completedAt: '2026-09-29T05:00:00.000Z', completedBy: '박설계' });   // 작성 완료 표시 (v13.201)
    await as(admin).put('/api/meetings/' + mid, { form: { place: '회의실', decisions: '결정', timeStart: '10:00' } });
  });

  test('미리 보기·받는 사람 — 프로젝트 권한 필요, 주소는 가림', async function () {
    var r = await as(admin).post('/api/meetings/' + mid + '/render');
    expect(r.status).toBe(200);
    expect(r.body.data.html).toContain('회의실');
    expect(r.body.data.html).toContain('회의 프로젝트');
    var denied = await as(outsider).post('/api/meetings/' + mid + '/render');
    expect(denied.status).toBe(403);
    var deniedRc = await as(outsider).get('/api/meetings/' + mid + '/mail-recipients');   // 주소는 권한 있는 사람에게만
    expect(deniedRc.status).toBe(403);
    expect(typeof r.body.data.smtp).toBe('boolean');
    var rc = await as(admin).get('/api/meetings/' + mid + '/mail-recipients');
    expect(rc.body.data).toEqual([
      { name: '박설계', hasEmail: true, masked: 'mt***@test.com', email: 'mtg-admin@test.com' },
      { name: '김전장', hasEmail: true, masked: 'mt***@test.com', email: 'mtg-member@test.com' },
      { name: '없는사람', hasEmail: false, masked: null, email: null }
    ]);
  });

  test('메일: 주소 검사, 받는 사람은 숨은 참조, 발송 기록', async function () {
    var bad = await as(admin).post('/api/meetings/' + mid + '/mail', { emails: ['x@y.com\r\nBcc: z@w.com'] });
    expect(bad.status).toBe(400);
    var none = await as(admin).post('/api/meetings/' + mid + '/mail', { attendees: ['외부인'] });   // 참석자가 아닌 이름은 무시
    expect(none.status).toBe(400);
    var cfg = require('../config');
    var saved = { user: cfg.smtp.user, pass: cfg.smtp.pass };
    var off0 = await as(admin).post('/api/meetings/' + mid + '/mail', { emails: ['a@b.com'] });
    if (!saved.user || !saved.pass) expect(off0.status).toBe(503);   // SMTP 계정 없음 → 발송 전에 안내
    cfg.smtp.user = 'bot@test.com'; cfg.smtp.pass = 'x';
    var spy = jest.spyOn(emailService, 'sendMail').mockResolvedValue(true);
    var ok = await as(admin).post('/api/meetings/' + mid + '/mail', { attendees: ['김전장'], emails: ['partner@vendor.com', 'PARTNER@vendor.com'], message: '공유' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.sent).toBe(2);
    // 백그라운드 알림 메일도 같은 sendMail 을 거치므로(순서가 매번 다름) 회의록 메일만 골라 본다
    var args = spy.mock.calls.filter(function (c) { return String(c[1] || '').indexOf('[회의록]') === 0; })[0];
    expect(args[0]).toBe('mtg-admin@test.com');                   // 보낸 사람 본인이 To
    expect(args[3].bcc.sort()).toEqual(['mtg-member@test.com', 'partner@vendor.com']);
    expect(args[3].replyTo).toBe('mtg-admin@test.com');
    expect(args[1]).toContain('[회의록] 킥오프');
    spy.mockResolvedValue(false);                                   // SMTP 미설정
    var off = await as(admin).post('/api/meetings/' + mid + '/mail', { emails: ['a@b.com'] });
    expect(off.status).toBe(503);
    spy.mockRestore();
    cfg.smtp.user = saved.user; cfg.smtp.pass = saved.pass;
    var r = await as(admin).post('/api/meetings/' + mid + '/render');
    expect(r.body.data.mailedTo.length).toBe(2);
    expect(r.body.data.mailedByName).toBe('박설계');
  });

  test('회의·액션 수정은 프로젝트 편집 권한 필요 (v13.202)', async function () {
    function del(u, url) { return h.request(h.app).delete(url).set('Authorization', 'Bearer ' + u.token); }
    expect((await as(outsider).get('/api/meetings/' + mid)).status).toBe(403);
    expect((await as(outsider).put('/api/meetings/' + mid, { title: '탈취' })).status).toBe(403);
    expect((await del(outsider, '/api/meetings/' + mid)).status).toBe(403);
    expect((await as(outsider).post('/api/meetings', { projectId: projId, title: '끼어들기' })).status).toBe(403);
    expect((await as(outsider).post('/api/meetings/' + mid + '/actions', { title: 'x' })).status).toBe(403);
    var a = await as(admin).post('/api/meetings/' + mid + '/actions', { title: '도면 검토' });
    expect(a.status).toBe(201);
    var aid = a.body.data.id;
    expect((await as(outsider).put('/api/meetings/' + mid + '/actions/' + aid, { status: 'done' })).status).toBe(403);
    expect((await as(outsider).post('/api/meetings/' + mid + '/actions/' + aid + '/convert', { target: 'issue' })).status).toBe(403);
    expect((await del(outsider, '/api/meetings/' + mid + '/actions/' + aid)).status).toBe(403);
    expect((await del(admin, '/api/meetings/' + mid + '/actions/' + aid)).status).toBe(200);
    expect((await as(admin).get('/api/meetings/' + mid)).body.data.title).toBe('킥오프');
    expect((await as(admin).get('/api/meetings/nope')).status).toBe(404);
    // 목록은 편집 가능 여부를 함께 알려 준다 (v13.204)
    expect((await as(admin).get('/api/meetings?projectId=' + projId)).body.canEdit).toBe(true);
    var ol = await as(outsider).get('/api/meetings?projectId=' + projId);
    expect(ol.body.canEdit).toBe(false);
    expect(ol.body.data).toEqual([]);
  });

  test('동시 편집 — version 이 어긋나면 409 + 최신 회의, 안 보내면 예전처럼 저장', async function () {
    var v0 = (await as(admin).get('/api/meetings/' + mid)).body.data.version;
    var first = await as(admin).put('/api/meetings/' + mid, { minutes: 'A가 저장', version: v0 });
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(v0 + 1);
    var stale = await as(admin).put('/api/meetings/' + mid, { minutes: 'B가 덮어쓰기', version: v0 });
    expect(stale.status).toBe(409);
    expect(stale.body.data.minutes).toBe('A가 저장');
    expect(Array.isArray(stale.body.data.action_items)).toBe(true);
    var retry = await as(admin).put('/api/meetings/' + mid, { minutes: 'B가 확인 후 저장', version: stale.body.data.version });
    expect(retry.status).toBe(200);
    var legacy = await as(admin).put('/api/meetings/' + mid, { minutes: '논의' });
    expect(legacy.status).toBe(200);
  });

  test('메일 앱 공유 기록 — 올바른 주소만, 방법 표시', async function () {
    var r = await as(admin).post('/api/meetings/' + mid + '/mail-log', { to: ['a@b.com', 'bad', 'c@d.co.kr'], method: 'eml' });
    expect(r.status).toBe(200);
    var d = await as(admin).post('/api/meetings/' + mid + '/render');
    expect(d.body.data.mailedTo).toEqual(['a@b.com', 'c@d.co.kr']);
    expect(d.body.data.mailedByName).toBe('박설계 (Outlook 초안)');
    var no = await as(outsider).post('/api/meetings/' + mid + '/mail-log', { to: ['a@b.com'] });
    expect(no.status).toBe(403);
  });
});

/* v13.320 — 노트 출력과 같은 모양 · 머리글 · 결재란 칸 · 묶음 */
describe('회의록 모양 · 묶음 (v13.320)', function () {
  var M = { id: 'mtg-x1y2', title: '설계 검토', meet_date: '2026-10-01', attendees: ['가'], form: { decisions: '결정 A' }, action_items: [{ title: '할 일', status: 'open' }] };
  test('기본 모양은 예전 글자 그대로 · 공문 · 간결 · 결재란 칸 · 문서 번호 끄기', function () {
    var basic = minutes.renderMinutes(M, {}).html;
    expect(basic).toContain('border-left:4px solid #3b82f6');
    expect(minutes.renderMinutes(M, { theme: 'basic', accent: 'teal' }).html).toContain('border-left:4px solid #0f766e');
    var formal = minutes.renderMinutes(M, { theme: 'formal' }).html;
    expect(formal).toContain('■ 1. 회의 개요');
    expect(formal).toContain("font-family:'Batang'");
    expect(minutes.renderMinutes(M, { theme: 'clean' }).html).toContain('border-bottom:2px solid #2563eb');
    var s = minutes.renderMinutes(M, { signs: ['담당', '<b>팀장</b>', '부서장', '', '대표', '이사', '사장', '회장'] }).html;
    expect(s).toContain('>담당</th>'); expect(s).toContain('&lt;b&gt;팀장'); expect(s).not.toContain('>회장<');
    expect(minutes.renderMinutes(M, { docNo: false }).html).not.toContain('문서번호');
    expect(minutes.renderMinutes(M, { theme: 'nope' }).html).toBe(basic);
  });
  test('회사 머리글 — 켤 때만 · 이름 이스케이프', function () {
    var h1 = minutes.renderMinutes(M, { header: true, company: '<회사>', logo: 'data:image/png;base64,AAAA' }).html;
    expect(h1).toContain('&lt;회사&gt;'); expect(h1).toContain('<img src="data:image/png;base64,AAAA"');
    expect(minutes.renderMinutes(M, { header: false, company: 'X사', logo: 'data:image/png;base64,AAAA' }).html).not.toContain('<img');
  });
  test('묶음 — 표지 · 목차 · 쪽 나눔 · 결재란은 표지에만', function () {
    var list = [{ m: M, projectName: 'P1' }, { m: Object.assign({}, M, { id: 'mtg-2', title: '둘째', meet_date: '2026-10-08', action_items: [] }), projectName: 'P1' }];
    var b = minutes.renderBundle(list, { signs: ['작성', '승인'], title: 'P1 회의록 모음' });
    expect(b.subject).toBe('P1 회의록 모음');
    expect(b.html).toContain('목차'); expect(b.html).toContain('2026-10-01 ~ 2026-10-08');
    expect((b.html.match(/class="pg-brk"/g) || []).length).toBe(2);
    expect((b.html.match(/>승인</g) || []).length).toBe(1);
    var c = minutes.renderBundle(list, { perPage: false, toc: false });
    expect((c.html.match(/class="pg-brk"/g) || []).length).toBe(0);
    expect(c.html).not.toContain('목차');
  });
});

describe('회의록 묶음 API (v13.320)', function () {
  var admin, member, p1, p2, m1, m2, m3;
  function as(u) { return { post: function (url, b) { return h.request(h.app).post(url).set('Authorization', 'Bearer ' + u.token).send(b || {}); } }; }
  beforeAll(async function () {
    await h.createTestTenant('mtgb-' + Date.now());
    admin = await h.createTestUser({ role: 'admin', email: 'mtgb-admin@test.com', name: '관리자' });
    member = await h.createTestUser({ role: 'member', email: 'mtgb-mem@test.com', name: '팀원' });
    p1 = (await h.request(h.app).post('/api/projects').set('Authorization', 'Bearer ' + member.token).send({ name: '공개 장비', status: 'active', visibility: 'tenant' })).body.data.id;
    p2 = (await h.request(h.app).post('/api/projects').set('Authorization', 'Bearer ' + admin.token).send({ name: '비공개 장비', status: 'active', visibility: 'private' })).body.data.id;
    m1 = (await as(member).post('/api/meetings', { projectId: p1, title: '둘째 회의', meetDate: '2026-10-08' })).body.data.id;
    m2 = (await as(member).post('/api/meetings', { projectId: p1, title: '첫 회의', meetDate: '2026-10-01' })).body.data.id;
    m3 = (await as(admin).post('/api/meetings', { projectId: p2, title: '비밀 회의', meetDate: '2026-10-02' })).body.data.id;
    await h.db.query("INSERT INTO doc_print_settings (tenant_id, company, logo) VALUES ($1, '(주)묶음', 'data:image/png;base64,AAAA') ON CONFLICT (tenant_id) DO UPDATE SET company = EXCLUDED.company, logo = EXCLUDED.logo", [h.TEST_TENANT_ID]);
  });
  afterAll(async function () { await h.cleanup(); });
  test('날짜 순 · 볼 수 없는 회의는 빼고 알림 · 머리글', async function () {
    var r = await as(member).post('/api/meetings/bundle', { ids: [m1, m3, m2, m1, 'nope'], header: true, theme: 'formal' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ count: 2, skipped: 2, subject: '공개 장비 회의록 모음' });
    var html = r.body.data.html;
    expect(html.indexOf('첫 회의')).toBeLessThan(html.indexOf('둘째 회의'));
    expect(html).not.toContain('비밀 회의');
    expect(html).toContain('(주)묶음');
    expect(html).toContain('■ 목차');
  });
  test('하나도 못 보면 403 · 비면 400 · 40건 넘으면 400', async function () {
    expect((await as(member).post('/api/meetings/bundle', { ids: [m3] })).status).toBe(403);
    expect((await as(member).post('/api/meetings/bundle', { ids: [] })).status).toBe(400);
    var many = []; for (var i = 0; i < 41; i++) many.push('x' + i);
    expect((await as(member).post('/api/meetings/bundle', { ids: many })).status).toBe(400);
  });
  test('미리 보기 — 모양 · 머리글 · 메일용은 로고 뺌', async function () {
    var r = await as(member).post('/api/meetings/' + m2 + '/render', { theme: 'clean', header: true, signs: ['담당', '팀장'] });
    expect(r.body.data.html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(r.body.data.html).toContain('>팀장</th>');
    var mail = await as(member).post('/api/meetings/' + m2 + '/render', { header: true, mail: true });
    expect(mail.body.data.html).toContain('(주)묶음');
    expect(mail.body.data.html).not.toContain('<img');
  });
});
