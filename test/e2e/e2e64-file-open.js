// v13.322 업무 관리 › 주간 분석 › 파일 열기 — xls 를 골랐는데 "지원하지 않는 파일 형식" 이 뜨던 문제
//   원인: 고른 직후 input.value='' 로 비우는데, hFiles 가 엑셀 도구(xlsx)를 기다린 뒤에 FileList 를 읽어서 빈 목록
var path = require('path');
var fs = require('fs');
var os = require('os');
var puppeteer = require(path.join(__dirname, '../../server/node_modules/puppeteer'));
(async function () {
  var ok = 0, fail = 0, errs = [], toasts = [];
  function check(v, m) { if (v) { ok++; console.log('✔', m); } else { fail++; console.log('FAIL', m); } }
  var xls = path.join(os.tmpdir(), 'e2e64-업무일지.xls');
  fs.writeFileSync(xls, '<html><head><meta charset="utf-8"></head><body><table><tr><td>이름</td><td>날짜</td><td>내용</td></tr><tr><td>관리자</td><td>2026-11-02</td><td>시험</td></tr></table></body></html>');
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: path.join(os.tmpdir(), 'wm-e2e-chrome-fo' + Date.now()) });
  var p = (await b.pages())[0] || await b.newPage();
  p.on('pageerror', function (e) { errs.push(e.message); });
  p.on('dialog', function (d) { d.accept(); });
  try {
    await p.setViewport({ width: 1400, height: 900 });
    await p.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
    await p.waitForSelector('#loginEmail', { visible: true });
    await p.type('#loginEmail', 'admin@t.com'); await p.type('#loginPw', 'Test1234!');
    await p.keyboard.press('Enter');
    await p.waitForFunction(function () { return typeof currentUser !== 'undefined' && currentUser && currentUser.id && !document.getElementById('initLoading'); }, { timeout: 60000 });
    // 엑셀 도구를 처음 받는 상황 흉내 — 받는 데 시간이 걸림 · 토스트 기록
    await p.evaluate(function () {
      var orig = wmLib; window.wmLib = function (n) { return new Promise(function (r) { setTimeout(r, 400); }).then(function () { return orig(n); }); };
      var t = showToast; window.showToast = function (m, k) { (window.__toasts = window.__toasts || []).push(m); return t.apply(this, arguments); };
      window.showDeptSelectModal = function () { return Promise.resolve(''); };
    });
    var inp = await p.$('#fileInput');
    await inp.uploadFile(xls);
    await p.waitForFunction(function (n) { var d = document.getElementById('fnDisp'); return d && d.textContent.indexOf(n) >= 0; }, { timeout: 8000 }, path.basename(xls)).catch(function () {});
    toasts = await p.evaluate(function () { return window.__toasts || []; });
    check(!toasts.some(function (t) { return /지원하지 않는 파일 형식/.test(t); }), 'xls 를 고르면 "지원하지 않는 파일 형식" 이 뜨지 않음');
    check(await p.evaluate(function (n) { return (document.getElementById('fnDisp') || {}).textContent.indexOf(n) >= 0; }, path.basename(xls)), '파일을 읽기 시작 (파일 이름 표시)');
    check(await p.evaluate(function () { return document.getElementById('fileInput').value === ''; }), '같은 파일을 다시 고를 수 있게 칸은 비움');
  } catch (e) { fail++; console.log('FAIL 예외', e.message); }
  check(!errs.length, '페이지 오류 없음' + (errs.length ? ' — ' + errs.join(' | ') : ''));
  await b.close();
  console.log('토스트:', toasts.join(' / '));
  console.log('\n' + ok + ' 통과 · ' + fail + ' 실패' + (fail ? '' : ' — ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
