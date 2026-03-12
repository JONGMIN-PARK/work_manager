var app = require('./app');
var config = require('./config');

var PORT = config.port;

// DB 연결 정보 디버그 (비밀번호 마스킹)
var dbUrl = process.env.DATABASE_URL || '(미설정)';
var masked = dbUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
console.log('[Server] DATABASE_URL:', masked);

app.listen(PORT, '0.0.0.0', function () {
  console.log('[Server] 업무 관리자 API 서버 시작');
  console.log('[Server] 환경: ' + config.env);
  console.log('[Server] 포트: ' + PORT);
  console.log('[Server] http://localhost:' + PORT);
});
