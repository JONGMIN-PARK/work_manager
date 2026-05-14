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
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      // PDF 미리보기(iframe blob:) 허용 — A/S 보고서 PDF
      frameSrc: ["'self'", "blob:", "data:"],
      objectSrc: ["'self'", "blob:", "data:"],
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
app.use('/api/v1/auth/login', loginLimiter);
app.use('/api/v1/auth/register', loginLimiter);
app.use('/api', apiLimiter);

// ─── Stripe Webhook (raw body 필요 — JSON 파싱 전에 등록) ───
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use('/api/v1/billing/webhook', express.raw({ type: 'application/json' }));

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
  etag: true,
  lastModified: true,
  setHeaders: function (res, filePath) {
    // JS/CSS: 짧은 캐시 + 반드시 재검증 (배포 즉시 반영)
    if (/\.(js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      // 이미지, 폰트 등 정적 에셋: 장기 캐시
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
  }
}));

// ─── HTML: 요청마다 읽어서 ?v= 치환 (배포 즉시 반영) ───
var fs = require('fs');
var htmlPath = path.join(__dirname, '..', '업무일지_분석기.html');

function loadHtml() {
  try {
    return fs.readFileSync(htmlPath, 'utf8').replace(/\?v=\d+[a-f0-9]*"/gi, '?v=' + BUILD_VERSION + '"');
  } catch (e) {
    console.error('[Server] HTML 로드 실패:', e.message);
    return null;
  }
}

// 프로덕션: 캐시, 개발: 매번 읽기
var cachedHtml = loadHtml();

app.get(['/', '/index', '/index.html'], function (req, res) {
  var html = process.env.NODE_ENV === 'production' ? cachedHtml : loadHtml();
  if (!html) return res.status(500).send('HTML 로드 실패');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(html);
});

// ─── API 라우트 ───
var authRoutes = require('./routes/auth');
var userRoutes = require('./routes/users');
var projectRoutes = require('./routes/projects');
var orderRoutes = require('./routes/orders');
var issueRoutes = require('./routes/issues');
var asTicketRoutes = require('./routes/as-tickets');
var asStatsRoutes = require('./routes/as-stats');
var asMastersRoutes = require('./routes/as-masters');
var asCategoryRoutes = require('./routes/as-categories');
var eventRoutes = require('./routes/events');
var milestoneRoutes = require('./routes/milestones');
var checklistRoutes = require('./routes/checklists');
var progressRoutes = require('./routes/progress');
var archiveRoutes = require('./routes/archives');
var bootstrapRoutes = require('./routes/bootstrap');
var documentRoutes = require('./routes/documents');
var lockRoutes = require('./routes/locks');
var departmentRoutes = require('./routes/departments');
var profileRoutes = require('./routes/profile');
var auditRoutes = require('./routes/audit');
var anyworksRoutes = require('./routes/anyworks');
var statsRoutes = require('./routes/stats');
var telegramRoutes = require('./routes/telegram');
var aiRoutes = require('./routes/ai');
var settingsRoutes = require('./routes/settings');
var tenantRoutes = require('./routes/tenants');
var billingRoutes = require('./routes/billing');
var ssoRoutes = require('./routes/sso');
var customFieldRoutes = require('./routes/custom-fields');
var workflowRoutes = require('./routes/workflows');
var whiteLabelRoutes = require('./routes/white-label');
var licenseRoutes = require('./routes/license');
var dataExportRoutes = require('./routes/data-export');
var notificationRoutes = require('./routes/notifications');
var weeklyReportRoutes = require('./routes/weekly-reports');
var v1Router = require('./routes/v1');
var apiDocsRoutes = require('./routes/api-docs');

// ─── 기존 /api/* 라우트 (하위 호환) ───
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/as-tickets', asTicketRoutes);
app.use('/api/as-stats', asStatsRoutes);
app.use('/api/as-masters', asMastersRoutes);
app.use('/api/as-categories', asCategoryRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/milestones', milestoneRoutes);
app.use('/api/checklists', checklistRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/archives', archiveRoutes);
app.use('/api/bootstrap', bootstrapRoutes);
app.use('/api/docs', documentRoutes);
app.use('/api/locks', lockRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/anyworks', anyworksRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/sso', ssoRoutes);
app.use('/api/custom-fields', customFieldRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/white-label', whiteLabelRoutes);
app.use('/api/license', licenseRoutes);
app.use('/api/data-export', dataExportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/weekly-reports', weeklyReportRoutes);

// ─── API v1 (버전 관리) ───
app.use('/api/v1', v1Router);

// ─── OpenAPI 문서 ───
app.use('/api/api-docs', apiDocsRoutes);

// ─── 텔레그램 Webhook 자동 등록 ───
var telegramService = require('./services/telegram.service');
if (telegramService.isConfigured()) {
  telegramService.setWebhook().catch(function (e) {
    console.error('[Telegram] Webhook 등록 실패:', e.message);
  });
}

// ─── 스케줄러 등록 ───
var notificationService = require('./services/notification.service');
var scheduler = require('./telegram/scheduler');
if (telegramService.isConfigured()) {
  scheduler.scheduleDaily(0, 0, function () { return notificationService.sendDeadlineReminders(); }, 'Deadline reminder');
  scheduler.scheduleDaily(23, 30, function () { return notificationService.sendDailyBriefing(); }, 'Daily briefing');
  scheduler.scheduleDaily(0, 10, function () { return notificationService.sendOrderDeliveryReminders(); }, 'Order delivery reminder');
  scheduler.scheduleWeekly(1, 0, 30, function () { return notificationService.sendWeeklyDigest(); }, 'Weekly digest');
  scheduler.scheduleDaily(8, 0, function () { return notificationService.sendProgressWarnings(); }, 'Progress warning');
  scheduler.scheduleDaily(9, 0, function () { return notificationService.sendOverloadWarnings(); }, 'Overload warning');
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
