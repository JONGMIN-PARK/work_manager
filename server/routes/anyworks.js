var express = require('express');
var router = express.Router();
var engine = require('../services/anyworks-engine');

// POST /api/anyworks/download — 다운로드 작업 시작
router.post('/download', function (req, res) {
  var body = req.body;

  // 필수 필드 검증
  var required = ['username', 'password', 'start_date', 'end_date', 'teams'];
  var missing = required.filter(function (f) { return !body[f]; });
  if (missing.length) {
    return res.status(400).json({ error: 'MISSING_FIELDS', fields: missing });
  }

  var jobId = engine.startJob({
    username: body.username,
    password: body.password,
    base_url: body.base_url || 'http://anyworks.co.kr/login',
    list_url: body.list_url || 'http://anyworks.co.kr/Main3.asp?module=weeklyreport&pg=weeklyreport/weeklyreportList',
    teams: body.teams,
    start_date: body.start_date,
    end_date: body.end_date,
    download_timeout: body.download_timeout || 15,
    page_load_timeout: body.page_load_timeout || 10
  });

  res.status(202).json({ job_id: jobId, status: 'queued' });
});

// GET /api/anyworks/jobs/:id — 작업 상태 조회
router.get('/jobs/:id', function (req, res) {
  var job = engine.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  }
  // 내부 필드 제거
  var resp = {
    status: job.status,
    logs: job.logs,
    results: job.results,
    files: job.files,
    error: job.error,
    started_at: job.started_at,
    finished_at: job.finished_at
  };
  res.json(resp);
});

// POST /api/anyworks/cancel/:id — 작업 취소
router.post('/cancel/:id', function (req, res) {
  var job = engine.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  }
  engine.cancelJob(req.params.id);
  res.json({ message: '취소 요청 전송' });
});

// GET /api/anyworks/health — 엔진 상태 확인
router.get('/health', function (req, res) {
  var hasPuppeteer = false;
  try { require('puppeteer'); hasPuppeteer = true; } catch (e) {
    try { require('puppeteer-core'); hasPuppeteer = true; } catch (e2) { /* */ }
  }
  res.json({
    available: hasPuppeteer,
    message: hasPuppeteer ? 'puppeteer 사용 가능' : 'npm install puppeteer 필요'
  });
});

module.exports = router;
