var express = require('express');
var router = express.Router();
var http = require('http');

// anyworks_api.py 서버 주소
var ANYWORKS_HOST = process.env.ANYWORKS_API_HOST || '127.0.0.1';
var ANYWORKS_PORT = parseInt(process.env.ANYWORKS_API_PORT, 10) || 5050;

/**
 * Python anyworks_api.py로 프록시 요청
 */
function proxyRequest(method, path, body, callback) {
  var bodyStr = body ? JSON.stringify(body) : '';
  var options = {
    hostname: ANYWORKS_HOST,
    port: ANYWORKS_PORT,
    path: path,
    method: method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (bodyStr) {
    options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }

  var req = http.request(options, function (res) {
    var chunks = [];
    res.on('data', function (chunk) { chunks.push(chunk); });
    res.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf-8');
      try {
        callback(null, res.statusCode, JSON.parse(raw));
      } catch (e) {
        callback(null, res.statusCode, { raw: raw });
      }
    });
  });

  req.on('error', function (err) {
    callback(err, 0, null);
  });

  // 5분 타임아웃 (다운로드 시간 고려)
  req.setTimeout(300000);

  if (bodyStr) req.write(bodyStr);
  req.end();
}

// POST /api/anyworks/download — 다운로드 작업 시작
router.post('/download', function (req, res) {
  var body = req.body;
  proxyRequest('POST', '/download', body, function (err, status, data) {
    if (err) {
      return res.status(502).json({
        error: 'ANYWORKS_UNAVAILABLE',
        message: '애니웍스 API 서버에 연결할 수 없습니다. anyworks_api.py가 실행 중인지 확인하세요.'
      });
    }
    res.status(status).json(data);
  });
});

// GET /api/anyworks/jobs/:id — 작업 상태 조회
router.get('/jobs/:id', function (req, res) {
  proxyRequest('GET', '/jobs/' + req.params.id, null, function (err, status, data) {
    if (err) {
      return res.status(502).json({
        error: 'ANYWORKS_UNAVAILABLE',
        message: '애니웍스 API 서버에 연결할 수 없습니다.'
      });
    }
    res.status(status).json(data);
  });
});

// POST /api/anyworks/cancel/:id — 작업 취소
router.post('/cancel/:id', function (req, res) {
  proxyRequest('POST', '/cancel/' + req.params.id, null, function (err, status, data) {
    if (err) {
      return res.status(502).json({
        error: 'ANYWORKS_UNAVAILABLE',
        message: '애니웍스 API 서버에 연결할 수 없습니다.'
      });
    }
    res.status(status).json(data);
  });
});

// GET /api/anyworks/health — Python API 서버 상태 확인
router.get('/health', function (req, res) {
  proxyRequest('GET', '/health', null, function (err, status, data) {
    if (err) {
      return res.json({ available: false, message: 'anyworks_api.py 미실행' });
    }
    res.json({ available: true, data: data });
  });
});

module.exports = router;
