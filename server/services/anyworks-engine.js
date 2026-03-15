/**
 * 애니웍스 주간일지 다운로드 엔진 (Node.js / Puppeteer)
 * - engine.py의 Node.js 포팅
 * - Python/Selenium 의존성 없음
 */
var path = require('path');
var fs = require('fs');
var os = require('os');

var puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  // puppeteer-core + 시스템 Chrome 폴백
  try {
    puppeteer = require('puppeteer-core');
  } catch (e2) {
    puppeteer = null;
  }
}

// ── 작업 저장소 ──
var _jobs = {};

function getJob(id) { return _jobs[id] || null; }

function ts() {
  var d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

/**
 * 다운로드 작업 시작
 */
function startJob(config) {
  var jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var job = {
    status: 'queued',
    logs: [],
    results: null,
    files: [],
    error: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    _cancelled: false
  };
  _jobs[jobId] = job;

  // 비동기 실행
  runEngine(jobId, config).catch(function (err) {
    job.status = 'error';
    job.error = err.message;
    job.finished_at = new Date().toISOString();
  });

  return jobId;
}

function cancelJob(id) {
  var job = _jobs[id];
  if (job) {
    job._cancelled = true;
    addLog(job, '사용자 취소 요청', 'WARN');
  }
}

function addLog(job, msg, level) {
  level = level || 'INFO';
  var line = '[' + ts() + '] [' + level + '] ' + msg;
  job.logs.push({ ts: new Date().toISOString(), level: level, msg: line });
}

function checkCancel(job) {
  if (job._cancelled) throw new Error('사용자가 취소했습니다');
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/**
 * 시스템에 설치된 Chrome 경로 찾기
 */
function findChromePath() {
  var candidates = [];
  if (process.platform === 'win32') {
    candidates = [
      process.env['PROGRAMFILES'] + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
      os.homedir() + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
    ];
  } else if (process.platform === 'darwin') {
    candidates = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  } else {
    candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
  }
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) return candidates[i];
    } catch (e) { /* skip */ }
  }
  return null;
}

/**
 * 메인 엔진 실행
 */
async function runEngine(jobId, config) {
  var job = _jobs[jobId];
  job.status = 'running';

  var teams = config.teams || [];
  var results = {};
  var downloadDir = path.join(os.tmpdir(), 'anyworks_' + jobId);
  fs.mkdirSync(downloadDir, { recursive: true });

  addLog(job, '==================================================');
  addLog(job, '주간일지 자동 다운로드');
  addLog(job, '기간  : ' + config.start_date + ' ~ ' + config.end_date);
  addLog(job, '팀    : ' + teams.join(', '));
  addLog(job, '==================================================');

  if (!puppeteer) {
    addLog(job, 'puppeteer 모듈이 없습니다. npm install puppeteer 를 실행하세요.', 'ERROR');
    job.status = 'error';
    job.error = 'puppeteer 미설치';
    job.finished_at = new Date().toISOString();
    return;
  }

  var browser = null;
  var t0 = Date.now();

  try {
    // ── 브라우저 시작 ──
    addLog(job, '');
    addLog(job, 'Chrome 브라우저 초기화...');

    var launchOpts = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    };

    // puppeteer-core 사용 시 executablePath 필요
    if (!puppeteer.executablePath || !fs.existsSync(puppeteer.executablePath())) {
      var chromePath = findChromePath();
      if (chromePath) {
        launchOpts.executablePath = chromePath;
        addLog(job, 'Chrome 경로: ' + chromePath);
      }
    }

    browser = await puppeteer.launch(launchOpts);
    var page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // 다운로드 경로 설정
    var client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir
    });

    addLog(job, 'Chrome 준비 완료');
    checkCancel(job);

    // ── STEP 1. 로그인 ──
    addLog(job, '');
    addLog(job, '[STEP 1] 로그인');
    addLog(job, '로그인 페이지 접속...');

    var baseUrl = config.base_url || 'http://anyworks.co.kr/login';
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    checkCancel(job);

    // 아이디 입력 필드 찾기
    var uidSelector = "input[type='text'][name*='id'], input[type='text'][name*='user'], input[type='text'][id*='id'], input[type='text'][placeholder*='아이디']";
    try {
      await page.waitForSelector(uidSelector, { timeout: 10000 });
    } catch (e) {
      addLog(job, '아이디 입력 필드를 찾을 수 없습니다', 'ERROR');
      throw new Error('로그인 페이지 로드 실패');
    }

    await page.type(uidSelector, config.username);
    await page.type("input[type='password']", config.password);
    addLog(job, '아이디/비밀번호 입력 완료');

    // 로그인 버튼 클릭
    var loginBtnSelector = 'body > div.container > div.main > div.login-container > form > button';
    try {
      await page.waitForSelector(loginBtnSelector, { timeout: 5000 });
      await page.click(loginBtnSelector);
      addLog(job, '로그인 버튼 클릭');
    } catch (e) {
      addLog(job, '로그인 버튼을 찾을 수 없습니다', 'ERROR');
      throw new Error('로그인 버튼 미발견');
    }

    // 메인 페이지 도달 대기
    try {
      await page.waitForFunction(
        function () { return location.href.indexOf('Main3.asp') >= 0 || location.href.toLowerCase().indexOf('main') >= 0; },
        { timeout: 15000 }
      );
      addLog(job, '로그인 성공 → ' + page.url());
    } catch (e) {
      addLog(job, '메인 페이지 도달 실패', 'ERROR');
      throw new Error('로그인 실패');
    }
    checkCancel(job);

    // ── STEP 2. 주간일지 페이지 이동 ──
    addLog(job, '');
    addLog(job, '[STEP 2] 주간일지 페이지 이동');
    addLog(job, '주간일지 페이지 이동 (iframe src 교체)...');

    var listUrl = config.list_url || 'http://anyworks.co.kr/Main3.asp?module=weeklyreport&pg=weeklyreport/weeklyreportList';
    await page.evaluate(function (url) {
      var iframes = document.getElementsByTagName('iframe');
      if (iframes.length > 0) iframes[0].src = url;
    }, listUrl);

    await sleep(2000);
    checkCancel(job);

    // iframe으로 전환
    var frames = page.frames();
    var listFrame = null;
    for (var fi = 0; fi < frames.length; fi++) {
      if (frames[fi] !== page.mainFrame()) {
        listFrame = frames[fi];
        break;
      }
    }
    if (!listFrame) {
      addLog(job, 'Main3.asp에 iframe 없음', 'ERROR');
      throw new Error('iframe 미발견');
    }

    // TeamName 드롭다운 대기
    try {
      await listFrame.waitForSelector('select[name="TeamName"]', { timeout: 8000 });
      addLog(job, '주간일지 페이지 로드 성공');
    } catch (e) {
      addLog(job, 'TeamName 드롭다운 미발견', 'ERROR');
      throw new Error('주간일지 페이지 로드 실패');
    }

    // ── STEP 3. 팀별 다운로드 ──
    addLog(job, '');
    addLog(job, '[STEP 3] 팀별 엑셀 다운로드');

    for (var ti = 0; ti < teams.length; ti++) {
      var team = teams[ti];
      checkCancel(job);

      addLog(job, '────────────────────────────────────────');
      addLog(job, '[' + team + '] 처리 시작');
      var teamStart = Date.now();

      try {
        // 사업부 선택
        try {
          await listFrame.select('select[name="TeamName"]', team);
          addLog(job, '  사업부 선택: ' + team);
        } catch (e) {
          // value가 아닌 text로 선택 시도
          var selected = await listFrame.evaluate(function (teamName) {
            var sel = document.querySelector('select[name="TeamName"]');
            if (!sel) return false;
            for (var i = 0; i < sel.options.length; i++) {
              if (sel.options[i].text.indexOf(teamName) >= 0 || sel.options[i].value.indexOf(teamName) >= 0) {
                sel.selectedIndex = i;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }
            return false;
          }, team);
          if (!selected) {
            addLog(job, '  \'' + team + '\' 선택 실패', 'ERROR');
            results[team] = '⚠ SKIP/FAIL';
            continue;
          }
          addLog(job, '  사업부 선택: ' + team);
        }

        // 날짜 설정
        await listFrame.evaluate(function (startDate, endDate) {
          function setField(id, val) {
            var el = document.getElementById(id);
            if (!el) return;
            el.removeAttribute('readonly');
            el.removeAttribute('disabled');
            el.value = val;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          setField('dsc1', startDate);
          setField('dsc2', endDate);
        }, config.start_date, config.end_date);
        addLog(job, '  날짜: ' + config.start_date + ' ~ ' + config.end_date);

        // 검색 버튼 클릭
        try {
          await listFrame.click("input[onclick='dosearchok()']");
          addLog(job, '  검색 버튼 클릭');
        } catch (e) {
          await listFrame.evaluate(function () { dosearchok(); });
          addLog(job, '  검색 버튼 못 찾음 → JS dosearchok() 호출', 'WARN');
        }

        await sleep(1500);
        await listFrame.waitForFunction(function () { return document.readyState === 'complete'; }, { timeout: 10000 });

        // 행 수 확인
        var rowCount = await listFrame.evaluate(function () {
          var rows = document.querySelectorAll('table tbody tr');
          if (!rows.length) rows = document.querySelectorAll('table tr');
          return rows.length;
        });
        addLog(job, '  검색 결과: ' + rowCount + '행');

        if (rowCount <= 1) {
          addLog(job, '[' + team + '] 데이터 없음 → 스킵');
          results[team] = '⚠ SKIP/FAIL';
          continue;
        }

        // 다운로드 전 파일 목록 스냅샷
        var beforeFiles = new Set(fs.readdirSync(downloadDir));

        // 엑셀 다운로드 버튼 클릭
        var pagesBefore = (await browser.pages()).length;
        try {
          await listFrame.click("input[onclick='doExcel()']");
          addLog(job, '  엑셀 버튼 클릭');
        } catch (e) {
          await listFrame.evaluate(function () { doExcel(); });
          addLog(job, '  엑셀 버튼 못 찾음 → JS doExcel() 호출', 'WARN');
        }

        await sleep(1500);

        // 새 창/탭 처리
        var allPages = await browser.pages();
        if (allPages.length > pagesBefore) {
          addLog(job, '  새 탭 ' + (allPages.length - pagesBefore) + '개 처리');
          for (var pi = allPages.length - 1; pi >= pagesBefore; pi--) {
            await sleep(500);
            await allPages[pi].close().catch(function () {});
          }
        }

        // 파일 다운로드 대기 (최대 15초)
        addLog(job, '  파일 감시 중...');
        var downloadTimeout = (config.download_timeout || 15) * 1000;
        var waitStart = Date.now();
        var newFile = null;
        while (Date.now() - waitStart < downloadTimeout) {
          checkCancel(job);
          var currentFiles = fs.readdirSync(downloadDir);
          // .crdownload 등 임시파일 체크
          var hasTemp = currentFiles.some(function (f) {
            return f.endsWith('.crdownload') || f.endsWith('.tmp');
          });
          if (!hasTemp) {
            for (var ci = 0; ci < currentFiles.length; ci++) {
              if (!beforeFiles.has(currentFiles[ci]) &&
                  (currentFiles[ci].endsWith('.xls') || currentFiles[ci].endsWith('.xlsx') || currentFiles[ci].endsWith('.csv'))) {
                newFile = currentFiles[ci];
                break;
              }
            }
          }
          if (newFile) break;
          await sleep(300);
        }

        var elapsed = ((Date.now() - waitStart) / 1000).toFixed(1);
        if (newFile) {
          var filePath = path.join(downloadDir, newFile);
          var fileSize = fs.statSync(filePath).size;

          // 파일명 변경
          var ext = path.extname(newFile);
          var now = new Date();
          var tsStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') +
                      String(now.getDate()).padStart(2, '0') + '_' +
                      String(now.getHours()).padStart(2, '0') +
                      String(now.getMinutes()).padStart(2, '0') +
                      String(now.getSeconds()).padStart(2, '0');
          var destName = '주간일지_' + team + '_' + config.start_date + '_' + config.end_date + '_' + tsStr + ext;
          var destPath = path.join(downloadDir, destName);
          fs.renameSync(filePath, destPath);

          addLog(job, '  파일 감지 (' + elapsed + '초): ' + destName);
          addLog(job, '[' + team + '] ✓ ' + destName + ' (' + fileSize.toLocaleString() + ' bytes) [' + ((Date.now() - teamStart) / 1000).toFixed(1) + '초]');

          // base64로 변환하여 결과에 포함
          var fileData = fs.readFileSync(destPath);
          job.files.push({
            name: destName,
            size: fileSize,
            base64: fileData.toString('base64')
          });

          results[team] = '✓ OK';
        } else {
          addLog(job, '  파일 미발견 (' + elapsed + '초)', 'WARN');
          addLog(job, '[' + team + '] ⚠ 다운로드 실패 [' + ((Date.now() - teamStart) / 1000).toFixed(1) + '초]', 'WARN');
          results[team] = '⚠ SKIP/FAIL';
        }

      } catch (e) {
        if (e.message === '사용자가 취소했습니다') {
          results[team] = '취소됨';
          throw e;
        }
        addLog(job, '[' + team + '] 예외 발생: ' + e.message, 'ERROR');
        results[team] = '✗ ERROR: ' + e.message;
      }
    }

    job.results = results;
    job.status = 'done';

  } catch (e) {
    if (e.message === '사용자가 취소했습니다') {
      addLog(job, '작업이 취소되었습니다.', 'WARN');
      job.results = results;
      job.status = 'done';
    } else {
      addLog(job, '전체 오류: ' + e.message, 'ERROR');
      job.status = 'error';
      job.error = e.message;
      job.results = results;
    }
  } finally {
    if (browser) {
      await browser.close().catch(function () {});
      addLog(job, 'Chrome 종료');
    }

    var totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
    addLog(job, '');
    addLog(job, '총 소요시간: ' + totalElapsed + '초');
    addLog(job, '==================================================');
    job.finished_at = new Date().toISOString();

    // 임시 폴더 정리
    try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

module.exports = { startJob: startJob, getJob: getJob, cancelJob: cancelJob };
