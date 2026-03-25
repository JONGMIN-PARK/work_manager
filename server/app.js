var express = require('express');
var cors = require('cors');
var helmet = require('helmet');
var compression = require('compression');
var rateLimit = require('express-rate-limit');
var path = require('path');
var config = require('./config');

var app = express();

// ─── 프록시 신뢰 (Render, Cloud Run 등 리버스 프록시 환경) ───
app.set('trust proxy', 1);

// ─── 응답 압축 ───
app.use(compression({ threshold: 512 }));

// ─── 보안 헤더 ───
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://api.anthropic.com", "https://api.telegram.org"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ─── CORS ───
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ─── Rate Limiting (before body parsing) ───
var loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: { error: 'RATE_LIMIT', message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
  standardHeaders: true,
  legacyHeaders: false
});

var apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: { error: 'RATE_LIMIT', message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', loginLimiter);
app.use('/api', apiLimiter);

// ─── JSON 파싱 ───
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── 캐시 버스팅: 서버 시작 시 빌드 버전 생성 ───
var BUILD_VERSION = Date.now().toString(36);
try {
  var execSync = require('child_process').execSync;
  BUILD_VERSION = execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '..') }).toString().trim() || BUILD_VERSION;
} catch (e) { /* git 없으면 타임스탬프 사용 */ }
console.log('[Server] Build version:', BUILD_VERSION);

// ─── 정적 파일 서빙 (프론트엔드) ───
app.use(express.static(path.join(__dirname, '..'), {
  index: false, // HTML은 별도 미들웨어에서 처리
  extensions: ['html'],
  maxAge: '30d',
  etag: true,
  lastModified: true
}));

// ─── HTML 캐시: 시작 시 한 번만 읽고 ?v= 치환 ───
var fs = require('fs');
var htmlPath = path.join(__dirname, '..', '업무일지_분석기.html');
var cachedHtml;
try {
  cachedHtml = fs.readFileSync(htmlPath, 'utf8').replace(/\?v=\d+"/g, '?v=' + BUILD_VERSION + '"');
} catch (e) {
  console.error('[Server] HTML 로드 실패:', e.message);
}

app.get(['/', '/index', '/index.html'], function (req, res) {
  if (!cachedHtml) return res.status(500).send('HTML 로드 실패');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(cachedHtml);
});

// ─── API 라우트 ───
var authRoutes = require('./routes/auth');
var userRoutes = require('./routes/users');
var projectRoutes = require('./routes/projects');
var orderRoutes = require('./routes/orders');
var issueRoutes = require('./routes/issues');
var eventRoutes = require('./routes/events');
var milestoneRoutes = require('./routes/milestones');
var checklistRoutes = require('./routes/checklists');
var progressRoutes = require('./routes/progress');
var archiveRoutes = require('./routes/archives');
var documentRoutes = require('./routes/documents');
var lockRoutes = require('./routes/locks');
var departmentRoutes = require('./routes/departments');
var profileRoutes = require('./routes/profile');
var auditRoutes = require('./routes/audit');
var anyworksRoutes = require('./routes/anyworks');
var statsRoutes = require('./routes/stats');
var telegramRoutes = require('./routes/telegram');
var aiRoutes = require('./routes/ai');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/milestones', milestoneRoutes);
app.use('/api/checklists', checklistRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/archives', archiveRoutes);
app.use('/api/docs', documentRoutes);
app.use('/api/locks', lockRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/anyworks', anyworksRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/ai', aiRoutes);

// ─── 텔레그램 Webhook 자동 등록 ───
var telegramService = require('./services/telegram.service');
if (telegramService.isConfigured()) {
  telegramService.setWebhook().catch(function (e) {
    console.error('[Telegram] Webhook 등록 실패:', e.message);
  });
}

// ─── 납기 리마인더 스케줄러 (매일 KST 09:00 = UTC 00:00) ───
var notificationService = require('./services/notification.service');
function scheduleDeadlineReminder() {
  var now = new Date();
  var next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  var delay = next.getTime() - now.getTime();
  setTimeout(function () {
    notificationService.sendDeadlineReminders().catch(function (e) {
      console.error('[Scheduler] Deadline reminder error:', e.message);
    });
    // 24시간 뒤 다시 실행
    setInterval(function () {
      notificationService.sendDeadlineReminders().catch(function (e) {
        console.error('[Scheduler] Deadline reminder error:', e.message);
      });
    }, 24 * 60 * 60 * 1000);
  }, delay);
  console.log('[Scheduler] Deadline reminder scheduled, next run in', Math.round(delay / 60000), 'min');
}
// ─── 일일 브리핑 스케줄러 (매일 KST 08:30 = UTC 23:30 전일) ───
function scheduleDailyBriefing() {
  var now = new Date();
  var next = new Date(now);
  next.setUTCHours(23, 30, 0, 0); // KST 08:30 = UTC 23:30 (전일)
  if (next <= now) next.setDate(next.getDate() + 1);
  var delay = next.getTime() - now.getTime();
  setTimeout(function () {
    notificationService.sendDailyBriefing().catch(function (e) {
      console.error('[Scheduler] Daily briefing error:', e.message);
    });
    setInterval(function () {
      notificationService.sendDailyBriefing().catch(function (e) {
        console.error('[Scheduler] Daily briefing error:', e.message);
      });
    }, 24 * 60 * 60 * 1000);
  }, delay);
  console.log('[Scheduler] Daily briefing scheduled, next run in', Math.round(delay / 60000), 'min');
}

// ─── 수주 납품 리마인더 (매일 KST 09:10 = UTC 00:10) ───
function scheduleOrderReminder() {
  var now = new Date();
  var next = new Date(now);
  next.setUTCHours(0, 10, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  var delay = next.getTime() - now.getTime();
  setTimeout(function () {
    notificationService.sendOrderDeliveryReminders().catch(function (e) {
      console.error('[Scheduler] Order reminder error:', e.message);
    });
    setInterval(function () {
      notificationService.sendOrderDeliveryReminders().catch(function (e) {
        console.error('[Scheduler] Order reminder error:', e.message);
      });
    }, 24 * 60 * 60 * 1000);
  }, delay);
  console.log('[Scheduler] Order delivery reminder scheduled');
}

// ─── 주간 다이제스트 (매주 월요일 KST 09:30 = UTC 00:30) ───
function scheduleWeeklyDigest() {
  function getNextMonday() {
    var now = new Date();
    var day = now.getDay();
    var diff = day === 0 ? 1 : day === 1 ? (now.getUTCHours() < 1 ? 0 : 7) : 8 - day;
    var next = new Date(now);
    next.setDate(now.getDate() + diff);
    next.setUTCHours(0, 30, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 7);
    return next;
  }
  var next = getNextMonday();
  var delay = next.getTime() - Date.now();
  setTimeout(function () {
    notificationService.sendWeeklyDigest().catch(function (e) {
      console.error('[Scheduler] Weekly digest error:', e.message);
    });
    setInterval(function () {
      notificationService.sendWeeklyDigest().catch(function (e) {
        console.error('[Scheduler] Weekly digest error:', e.message);
      });
    }, 7 * 24 * 60 * 60 * 1000);
  }, delay);
  console.log('[Scheduler] Weekly digest scheduled, next Monday');
}

// ─── 진행률 경고 (매일 KST 17:00 = UTC 08:00) ───
function scheduleProgressWarning() {
  var now = new Date();
  var next = new Date(now);
  next.setUTCHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  var delay = next.getTime() - now.getTime();
  setTimeout(function () {
    notificationService.sendProgressWarnings().catch(function (e) {
      console.error('[Scheduler] Progress warning error:', e.message);
    });
    setInterval(function () {
      notificationService.sendProgressWarnings().catch(function (e) {
        console.error('[Scheduler] Progress warning error:', e.message);
      });
    }, 24 * 60 * 60 * 1000);
  }, delay);
  console.log('[Scheduler] Progress warning scheduled');
}

// ─── 과부하 경고 (매일 KST 18:00 = UTC 09:00) ───
function scheduleOverloadWarning() {
  var now = new Date();
  var next = new Date(now);
  next.setUTCHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  var delay = next.getTime() - now.getTime();
  setTimeout(function () {
    notificationService.sendOverloadWarnings().catch(function (e) {
      console.error('[Scheduler] Overload warning error:', e.message);
    });
    setInterval(function () {
      notificationService.sendOverloadWarnings().catch(function (e) {
        console.error('[Scheduler] Overload warning error:', e.message);
      });
    }, 24 * 60 * 60 * 1000);
  }, delay);
  console.log('[Scheduler] Overload warning scheduled');
}

if (telegramService.isConfigured()) {
  scheduleDeadlineReminder();
  scheduleDailyBriefing();
  scheduleOrderReminder();
  scheduleWeeklyDigest();
  scheduleProgressWarning();
  scheduleOverloadWarning();
}

// ─── 헬스 체크 ───
app.get('/health', async function (req, res) {
  var dbOk = false;
  try {
    var db = require('./config/db');
    var r = await db.query('SELECT 1');
    dbOk = r.rows.length > 0;
  } catch (e) { /* db down */ }
  var ok = dbOk;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services: { database: dbOk ? 'ok' : 'down' }
  });
});

// ─── SPA 폴백 (API 외 모든 요청 → 메인 HTML) ───
app.get('*', function (req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'NOT_FOUND', message: '존재하지 않는 API입니다.' });
  }
  if (!cachedHtml) return res.status(500).send('HTML 로드 실패');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(cachedHtml);
});

// ─── 글로벌 에러 핸들러 ───
app.use(function (err, req, res, next) {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({
    error: 'SERVER_ERROR',
    message: config.env === 'production' ? '서버 오류가 발생했습니다.' : err.message
  });
});

module.exports = app;
