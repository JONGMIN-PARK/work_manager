var express = require('express');
var router = express.Router();
var http = require('http');
var { spawn } = require('child_process');
var path = require('path');

// anyworks_api.py 서버 주소
var ANYWORKS_HOST = process.env.ANYWORKS_API_HOST || '127.0.0.1';
var ANYWORKS_PORT = parseInt(process.env.ANYWORKS_API_PORT, 10) || 5050;

// Python 프로세스 관리
var _pyProcess = null;
var _pyStarting = false;

/**
 * Python anyworks_api.py 자동 시작
 */
function ensurePythonServer() {
  return new Promise(function (resolve) {
    // 이미 실행 중이면 health check
    if (_pyProcess && !_pyProcess.killed) {
      checkHealth(function (alive) {
        if (alive) return resolve(true);
        // 죽은 프로세스 정리 후 재시작
        _pyProcess = null;
        startPython(resolve);
      });
      return;
    }
    // 혹시 외부에서 이미 띄워놨을 수도 있으니 health check 먼저
    checkHealth(function (alive) {
      if (alive) return resolve(true);
      startPython(resolve);
    });
  });
}

function checkHealth(cb) {
  var req = http.request({
    hostname: ANYWORKS_HOST, port: ANYWORKS_PORT,
    path: '/health', method: 'GET', timeout: 2000
  }, function (res) {
    var d = '';
    res.on('data', function (c) { d += c; });
    res.on('end', function () { cb(res.statusCode === 200); });
  });
  req.on('error', function () { cb(false); });
  req.on('timeout', function () { req.destroy(); cb(false); });
  req.end();
}

function startPython(resolve) {
  if (_pyStarting) {
    // 이미 시작 중이면 대기
    var wait = setInterval(function () {
      if (!_pyStarting) { clearInterval(wait); resolve(!!_pyProcess); }
    }, 300);
    return;
  }
  _pyStarting = true;

  var scriptPath = path.join(__dirname, '..', '..', 'anyworks_api.py');
  var pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  console.log('[anyworks] Python API 서버 자동 시작:', scriptPath);

  var env = Object.assign({}, process.env, { ANYWORKS_API_PORT: String(ANYWORKS_PORT) });
  _pyProcess = spawn(pythonCmd, [scriptPath], {
    env: env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  _pyProcess.stdout.on('data', function (d) {
    console.log('[anyworks-py]', d.toString().trim());
  });
  _pyProcess.stderr.on('data', function (d) {
    console.log('[anyworks-py]', d.toString().trim());
  });
  _pyProcess.on('exit', function (code) {
    console.log('[anyworks] Python 프로세스 종료 (code=' + code + ')');
    _pyProcess = null;
  });
  _pyProcess.on('error', function (err) {
    console.error('[anyworks] Python 실행 실패:', err.message);
    _pyProcess = null;
    _pyStarting = false;
    resolve(false);
  });

  // 서버가 뜰 때까지 폴링 (최대 10초)
  var attempts = 0;
  var maxAttempts = 20;
  var poll = setInterval(function () {
    attempts++;
    checkHealth(function (alive) {
      if (alive) {
        clearInterval(poll);
        _pyStarting = false;
        console.log('[anyworks] Python API 서버 준비 완료');
        resolve(true);
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
        _pyStarting = false;
        console.error('[anyworks] Python API 서버 시작 타임아웃');
        resolve(false);
      }
    });
  }, 500);
}

// Express 종료 시 Python 프로세스도 정리
process.on('exit', function () {
  if (_pyProcess && !_pyProcess.killed) {
    _pyProcess.kill();
  }
});

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

  req.setTimeout(300000);

  if (bodyStr) req.write(bodyStr);
  req.end();
}

// POST /api/anyworks/download — Python 자동 시작 후 다운로드 작업 시작
router.post('/download', async function (req, res) {
  var started = await ensurePythonServer();
  if (!started) {
    return res.status(502).json({
      error: 'PYTHON_START_FAILED',
      message: 'Python API 서버를 시작할 수 없습니다. Python과 selenium이 설치되어 있는지 확인하세요.'
    });
  }
  var body = req.body;
  proxyRequest('POST', '/download', body, function (err, status, data) {
    if (err) {
      return res.status(502).json({
        error: 'ANYWORKS_UNAVAILABLE',
        message: '애니웍스 API 서버에 연결할 수 없습니다.'
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
