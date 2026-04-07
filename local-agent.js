/**
 * 애니웍스 로컬 에이전트 — 사내 PC에서 실행
 *
 * 사용법: node local-agent.js
 *
 * 웹 앱에서 localhost:5050으로 다운로드 요청을 보내면
 * 사내 네트워크에서 애니웍스에 접속하여 엑셀을 다운로드합니다.
 */
var express = require('express');
var cors = require('cors');
var engine = require('./server/services/anyworks-engine');

var PORT = process.env.LOCAL_AGENT_PORT || 5050;
var app = express();

app.use(cors());
app.use(express.json());

// 상태 확인
app.get('/health', function (req, res) {
  var hasPuppeteer = false;
  try { require('puppeteer'); hasPuppeteer = true; } catch (e) {
    try { require('puppeteer-core'); hasPuppeteer = true; } catch (e2) { /* */ }
  }
  res.json({ available: hasPuppeteer, mode: 'local-agent', port: PORT });
});

// 다운로드 시작
app.post('/download', function (req, res) {
  var body = req.body;
  var required = ['username', 'password', 'start_date', 'end_date', 'teams'];
  var missing = required.filter(function (f) { return !body[f]; });
  if (missing.length) {
    return res.status(400).json({ error: 'MISSING_FIELDS', fields: missing });
  }

  var jobId = engine.startJob({
    username: body.username,
    password: body.password,
    base_url: body.base_url || 'https://works.animotion.co.kr',
    list_url: body.list_url || 'https://works.animotion.co.kr/Sales/Week_List.asp?top_id=80&mun=6&table=WeekList',
    teams: body.teams,
    start_date: body.start_date,
    end_date: body.end_date,
    download_timeout: body.download_timeout || 15,
    page_load_timeout: body.page_load_timeout || 10
  });

  res.status(202).json({ job_id: jobId, status: 'queued' });
});

// 작업 상태 조회
app.get('/jobs/:id', function (req, res) {
  var job = engine.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  res.json({
    status: job.status,
    logs: job.logs,
    results: job.results,
    files: job.files,
    error: job.error,
    started_at: job.started_at,
    finished_at: job.finished_at
  });
});

// 작업 취소
app.post('/cancel/:id', function (req, res) {
  var job = engine.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  engine.cancelJob(req.params.id);
  res.json({ message: '취소 요청 전송' });
});

app.listen(PORT, function () {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  🌐 애니웍스 로컬 에이전트 실행 중           ║');
  console.log('  ║  포트: ' + PORT + '                                  ║');
  console.log('  ║  웹에서 자동 다운로드 버튼을 눌러주세요      ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});
