/**
 * Auth API integration tests
 */
var h = require('./helpers');

beforeAll(async () => { await h.createTestTenant(); });
afterAll(async () => { await h.cleanup(); });

describe('Auth API', () => {

  // 1. POST /api/auth/register — 회원가입 성공
  test('POST /api/auth/register — 회원가입 성공', async () => {
    var email = 'register-ok-' + Date.now() + '@test.com';
    var res = await h.request(h.app)
      .post('/api/auth/register')
      .send({
        email: email,
        password: 'Test1234!',
        name: 'RegisterUser',
        position: 'dev',
        phone: '010-0000-0000'
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.email).toBe(email);
    expect(res.body.data.name).toBe('RegisterUser');
    expect(res.body.data.status).toBe('pending');
    expect(res.body.message).toMatch(/승인/);
  });

  // 2. POST /api/auth/register — 중복 이메일 409
  test('POST /api/auth/register — 중복 이메일 409', async () => {
    var email = 'dup-' + Date.now() + '@test.com';

    // 첫 번째 가입
    await h.request(h.app)
      .post('/api/auth/register')
      .send({ email: email, password: 'Test1234!', name: 'First' });

    // 동일 이메일로 재가입
    var res = await h.request(h.app)
      .post('/api/auth/register')
      .send({ email: email, password: 'Test1234!', name: 'Second' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DUPLICATE');
  });

  // 3. POST /api/auth/login — 로그인 성공
  test('POST /api/auth/login — 로그인 성공 (accessToken, refreshToken 반환)', async () => {
    var email = 'login-ok-' + Date.now() + '@test.com';
    var password = 'Test1234!';

    // createTestUser로 active 상태 사용자 생성
    var t = await h.createTestUser({ email: email, password: password });

    expect(t.token).toBeTruthy();
    expect(t.refreshToken).toBeTruthy();

    // 직접 로그인 API도 확인
    var res = await h.request(h.app)
      .post('/api/auth/login')
      .send({ email: email, password: password });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe(email);
  });

  // 4. POST /api/auth/login — 잘못된 비밀번호 401
  test('POST /api/auth/login — 잘못된 비밀번호 401', async () => {
    var email = 'wrong-pw-' + Date.now() + '@test.com';
    await h.createTestUser({ email: email, password: 'Test1234!' });

    var res = await h.request(h.app)
      .post('/api/auth/login')
      .send({ email: email, password: 'WrongPass99!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('AUTH_FAILED');
  });

  // 5. POST /api/auth/login — 존재하지 않는 이메일 401
  test('POST /api/auth/login — 존재하지 않는 이메일 401', async () => {
    var res = await h.request(h.app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent-' + Date.now() + '@test.com', password: 'Test1234!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('AUTH_FAILED');
  });

  // 6. POST /api/auth/refresh — 토큰 갱신 성공
  test('POST /api/auth/refresh — 토큰 갱신 성공', async () => {
    var email = 'refresh-' + Date.now() + '@test.com';
    var t = await h.createTestUser({ email: email });

    var res = await h.request(h.app)
      .post('/api/auth/refresh')
      .send({ refreshToken: t.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
    // 토큰 로테이션: 새 refreshToken은 이전과 달라야 함
    expect(res.body.data.refreshToken).not.toBe(t.refreshToken);
  });

  // 7. GET 인증 필요 API에 토큰 없이 접근 — 401
  test('GET /api/auth/me — 토큰 없이 접근 시 401', async () => {
    var res = await h.request(h.app)
      .get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  // 8. GET 인증 필요 API에 만료/잘못된 토큰 — 401
  test('GET /api/auth/me — 잘못된 토큰으로 접근 시 401', async () => {
    var res = await h.request(h.app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.token.here');

    expect(res.status).toBe(401);
  });

});

describe('v13.357 PC 앱 구글 로그인 넘겨주기', function () {
  var h2 = require('./helpers');
  var authRouter = require('../routes/auth');
  test('한 번 쓰는 코드 → 토큰 (두 번째는 안 됨 · 모르는 코드 안 됨)', async function () {
    var html = '';
    authRouter._desktopHandoff({ setHeader: function () {}, send: function (s) { html = s; } }, JSON.stringify({ accessToken: 'AT', refreshToken: 'RT' }));
    var code = /workmanager:\/\/auth\?code=([a-f0-9]+)/.exec(html)[1];
    expect(html).toMatch(/로그인했습니다/);
    var r1 = await h2.request(h2.app).get('/api/auth/desktop-exchange?code=' + code);
    expect(r1.status).toBe(302);
    expect(decodeURIComponent(r1.headers.location)).toBe('/?googleAuth={"accessToken":"AT","refreshToken":"RT"}');
    var r2 = await h2.request(h2.app).get('/api/auth/desktop-exchange?code=' + code);
    expect(r2.headers.location).toBe('/?error=google_auth_failed');
    var r3 = await h2.request(h2.app).get('/api/auth/desktop-exchange?code=nope');
    expect(r3.headers.location).toBe('/?error=google_auth_failed');
  });
});
