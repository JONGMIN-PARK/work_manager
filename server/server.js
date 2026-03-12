var app = require('./app');
var config = require('./config');

var PORT = config.port;

app.listen(PORT, function () {
  console.log('[Server] 업무 관리자 API 서버 시작');
  console.log('[Server] 환경: ' + config.env);
  console.log('[Server] 포트: ' + PORT);
  console.log('[Server] http://localhost:' + PORT);
});
