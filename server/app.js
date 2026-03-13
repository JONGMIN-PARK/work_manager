var express = require('express');
var cors = require('cors');
var helmet = require('helmet');
var rateLimit = require('express-rate-limit');
var path = require('path');
var config = require('./config');

var app = express();

// ─── 프록시 신뢰 (Render, Cloud Run 등 리버스 프록시 환경) ───
app.set('trust proxy', 1);

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
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://api.anthropic.com"]
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

// ─── JSON 파싱 ───
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global string trim
app.use(function (req, res, next) {
  if (req.body && typeof req.body === 'object') {
    Object.keys(req.body).forEach(function (k) {
      if (typeof req.body[k] === 'string') req.body[k] = req.body[k].trim();
    });
  }
  next();
});

// ─── Rate Limiting ───
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

// ─── 정적 파일 서빙 (프론트엔드) ───
app.use(express.static(path.join(__dirname, '..'), {
  index: '업무일지_분석기.html',
  extensions: ['html'],
  maxAge: '1h',
  etag: true,
  lastModified: true,
  setHeaders: function (res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

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

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', loginLimiter);
app.use('/api', apiLimiter);

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
  res.sendFile(path.join(__dirname, '..', '업무일지_분석기.html'));
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
