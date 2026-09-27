/**
 * 정적 파일 노출 회귀 테스트
 * app.js 가 예전에는 저장소 루트 전체를 express.static 으로 서빙해서
 * /server/routes/auth.js, /server/package.json, /migrations/*.sql 등이 그대로 다운로드됐다.
 * 이제는 루트 바로 아래의 SPA 용 *.js / *.css 만 허용한다.
 */
var request = require('supertest');
var app = require('../app');

describe('Static file exposure', function () {
  var blocked = [
    '/server/app.js',
    '/server/package.json',
    '/server/routes/auth.js',
    '/server/config/db.js',
    '/server/.env.example',
    '/server/migrations/009_tenants.sql',
    '/migrations/001_auth.sql',
    '/package.json',
    '/CHANGELOG.md',
    '/test/calendar.test.js',
    '/tools/upload.js',
    '/web/package.json',
    '/render.yaml',
    '/docker-compose.yml',
    '/.gitignore',
    '/.env.onprem',
    '/order.js',
    '/engine.py',
    '/%2e%2e/work_manager/server/app.js',
    '/server%2fapp.js'
  ];

  blocked.forEach(function (p) {
    it('404 for ' + p, async function () {
      var res = await request(app).get(p);
      expect(res.status).toBe(404);
      // 서버 소스 조각이 응답에 섞여 나오지 않아야 한다
      expect(res.text || '').not.toMatch(/require\(|DATABASE_URL|CREATE TABLE/);
    });
  });

  // 확장자 없는 경로는 SPA 폴백(HTML)을 받는다 — 파일 내용이 아닌지만 확인
  ['/Dockerfile', '/server', '/server/', '/migrations/'].forEach(function (p) {
    it('no file content for ' + p, async function () {
      var res = await request(app).get(p);
      expect(res.text || '').not.toMatch(/FROM node|require\(|CREATE TABLE/);
    });
  });

  it('200 for / (SPA HTML)', async function () {
    var res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  ['/auth.js', '/style.css', '/calendar.js', '/config.js', '/as-core.js'].forEach(function (p) {
    it('200 for ' + p, async function () {
      var res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(p.endsWith('.css') ? /text\/css/ : /javascript/);
    });
  });

  it('HEAD works for allowed asset', async function () {
    var res = await request(app).head('/auth.js');
    expect(res.status).toBe(200);
  });

  it('every <script src> / <link href> local asset in the SPA HTML is served', async function () {
    var fs = require('fs');
    var path = require('path');
    var html = fs.readFileSync(path.join(__dirname, '..', '..', '업무일지_분석기.html'), 'utf8');
    var re = /<(?:script[^>]+src|link[^>]+href)="([^"#]+)"/g;
    var m, local = [];
    while ((m = re.exec(html))) {
      var u = m[1];
      if (/^(https?:)?\/\//.test(u) || u.indexOf('$') >= 0 || u.indexOf("'") >= 0) continue;
      local.push('/' + u.split('?')[0].replace(/^\.?\//, ''));
    }
    expect(local.length).toBeGreaterThan(10);
    for (var i = 0; i < local.length; i++) {
      var res = await request(app).get(local[i]);
      if (res.status !== 200) throw new Error('asset not served: ' + local[i] + ' → ' + res.status);
    }
  });
});
