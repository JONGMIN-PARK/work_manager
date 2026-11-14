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

  // v13.501 ⬆ 새로 배포됐으면 알림을 켜 둔 기기 모두에 푸시 (운영만 · 시험은 UPDATE_PUSH=1) — 마이그레이션 · 상태 점검이 끝날 틈을 두고
  if (process.env.NODE_ENV === 'production' || process.env.UPDATE_PUSH === '1') {
    setTimeout(function () {
      try { require('./services/update-announce').announce(app.locals.buildInfo()).catch(function (e) { console.warn('[update-push]', e.message); }); } catch (e) { console.warn('[update-push]', e.message); }
    }, +(process.env.UPDATE_PUSH_DELAY || 30000)).unref();
  }

  // A/S 자동화 스케줄러 시작 (SCHEDULER_DISABLED=1 이면 스킵)
  try {
    require('./services/scheduler.service').start();
  } catch (e) {
    console.warn('[Server] 스케줄러 시작 실패:', e.message);
  }
});

// 종료 신호(Render 재배포 등) — 묶어 두던 프로젝트 변경 알림을 먼저 보낸다 (최대 5초)
process.once('SIGTERM', function () {
  var done = function () { process.exit(0); };
  setTimeout(done, 5000).unref();
  require('./services/notification/change-feed').flushAll().then(done, done);
});
