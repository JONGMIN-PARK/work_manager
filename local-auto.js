/**
 * 애니웍스 주간일지 자동 다운로드 & 서버 업로드
 *
 * 사용법:
 *   node local-auto.js                          (이번 주, 전체 사업부)
 *   node local-auto.js 20260406 20260412         (날짜 지정)
 *   node local-auto.js 20260406 20260412 기술연구소  (날짜 + 사업부 지정)
 *
 * Windows 작업 스케줄러로 매주 자동 실행:
 *   프로그램: node
 *   인수: D:\ai\work\work_manager\local-auto.js
 *   시작 위치: D:\ai\work\work_manager
 */
var path = require('path');
var fs = require('fs');
var XLSX;
try { XLSX = require('xlsx'); } catch (e) { XLSX = null; }

var engine = require('./server/services/anyworks-engine');

// ── 설정 ──
var SETTINGS_FILE = path.join(__dirname, 'local-auto-settings.json');
var SERVER_URL = process.env.SERVER_URL || 'https://work-manager-i97q.onrender.com';
var TEAMS_DEFAULT = ['기술연구소', '장비사업부', '모션사업부'];

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) { return {}; }
}

function saveSettings(data) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── 날짜 유틸 ──
function getThisWeek() {
  var d = new Date(); var dow = d.getDay() || 7;
  var mon = new Date(d); mon.setDate(d.getDate() - dow + 1);
  var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  var fmt = function (dt) { return dt.getFullYear() + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getDate()).padStart(2, '0'); };
  return { start: fmt(mon), end: fmt(sun) };
}

// ── 엑셀 파싱 (SheetJS) ──
function parseExcelBuffer(buffer) {
  if (!XLSX) {
    console.error('xlsx 모듈이 없습니다. npm install xlsx 를 실행하세요.');
    return [];
  }
  var wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  var ws = wb.Sheets[wb.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (rows.length < 2) return [];

  // 헤더 매칭
  var hdr = rows[0].map(function (c) { return String(c || '').trim().toLowerCase(); });
  var colMap = {};
  var aliases = {
    date: ['날짜', '일자', 'date', '작성일', '일시'],
    name: ['이름', '성명', '작성자', 'name', '사원명', '담당자'],
    orderNo: ['수주번호', '수주no', 'order', '수주', '프로젝트번호'],
    hours: ['시간', '공수', 'hours', '투입시간', '작업시간', 'h'],
    taskType: ['업무분장', '분장', '업무유형', 'task', 'type', '구분'],
    abbr: ['약자', '약어', 'abbr', '코드', 'code'],
    content: ['업무내용', '내용', 'content', '비고', '상세', '설명']
  };

  Object.keys(aliases).forEach(function (key) {
    for (var ci = 0; ci < hdr.length; ci++) {
      for (var ai = 0; ai < aliases[key].length; ai++) {
        if (hdr[ci].indexOf(aliases[key][ai]) >= 0) { colMap[key] = ci; return; }
      }
    }
  });

  if (colMap.date === undefined || colMap.name === undefined) {
    // 위치 기반 폴백
    colMap = { date: 0, name: 1, orderNo: 2, hours: 3, taskType: 4, abbr: 5, content: rows[0].length - 1 };
  }

  var records = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var date = String(r[colMap.date] || '').replace(/[-\/\.]/g, '').trim();
    var name = String(r[colMap.name] || '').trim();
    if (!date || !name || date.length < 8) continue;
    date = date.slice(0, 8);

    records.push({
      date: date,
      name: name,
      orderNo: colMap.orderNo !== undefined ? String(r[colMap.orderNo] || '').trim() : '',
      hours: parseFloat(r[colMap.hours]) || 0,
      taskType: colMap.taskType !== undefined ? String(r[colMap.taskType] || '').trim() : '',
      abbr: colMap.abbr !== undefined ? String(r[colMap.abbr] || '').trim() : '',
      content: colMap.content !== undefined ? String(r[colMap.content] || '').trim() : ''
    });
  }
  return records;
}

// ── 서버 API 호출 ──
async function serverLogin(settings) {
  var resp = await fetch(SERVER_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: settings.server_email, password: settings.server_password })
  });
  if (!resp.ok) throw new Error('서버 로그인 실패: ' + resp.status);
  var data = await resp.json();
  return data.data.accessToken;
}

async function uploadRecords(token, records) {
  var resp = await fetch(SERVER_URL + '/api/archives/records/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ records: records })
  });
  if (!resp.ok) {
    var err = await resp.json().catch(function () { return {}; });
    throw new Error('업로드 실패: ' + (err.message || resp.status));
  }
  return await resp.json();
}

async function getExistingRecords(token) {
  var resp = await fetch(SERVER_URL + '/api/archives/records?limit=50000&all=true', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!resp.ok) return [];
  var data = await resp.json();
  return (data.data || []).map(function (r) {
    return {
      date: r.date, name: r.name, orderNo: r.order_no,
      hours: parseFloat(r.hours) || 0, taskType: r.task_type,
      abbr: r.abbr, content: r.content, ocmt: r.ocmt, oclient: r.oclient
    };
  });
}

// ── 중복 제거 & 병합 ──
function wrIdKey(r) { return r.date + '|' + r.name + '|' + (r.orderNo || '') + '|' + (r.hours || '') + '|' + (r.content || '').trim(); }

function mergeRecords(existing, newRecs) {
  var newById = new Map();
  newRecs.forEach(function (r) { var k = wrIdKey(r); if (!newById.has(k)) newById.set(k, r); });
  var updated = 0, added = 0;
  var merged = existing.map(function (r) {
    var ik = wrIdKey(r);
    if (newById.has(ik)) { var nr = newById.get(ik); newById.delete(ik); updated++; return Object.assign({}, r, nr); }
    return r;
  });
  newById.forEach(function (r) { merged.push(r); added++; });
  return { merged: merged, added: added, updated: updated };
}

// ── 메인 ──
async function main() {
  var args = process.argv.slice(2);
  var week = getThisWeek();
  var startDate = args[0] || week.start;
  var endDate = args[1] || week.end;
  var teams = args.length > 2 ? args.slice(2) : TEAMS_DEFAULT;

  var settings = loadSettings();

  // 초기 설정 안내
  if (!settings.anyworks_id || !settings.anyworks_pw) {
    console.log('');
    console.log('  ⚠️  초기 설정이 필요합니다.');
    console.log('  local-auto-settings.json 파일을 편집하세요:');
    console.log('');
    saveSettings({
      anyworks_id: '애니웍스_아이디',
      anyworks_pw: '애니웍스_비밀번호',
      server_email: '서버_로그인_이메일',
      server_password: '서버_로그인_비밀번호',
      server_url: SERVER_URL
    });
    console.log('  파일 위치: ' + SETTINGS_FILE);
    console.log('');
    return;
  }

  if (settings.server_url) SERVER_URL = settings.server_url;

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  📋 애니웍스 → 서버 자동 업로드');
  console.log('  기간: ' + startDate + ' ~ ' + endDate);
  console.log('  팀: ' + teams.join(', '));
  console.log('  서버: ' + SERVER_URL);
  console.log('═══════════════════════════════════════════');
  console.log('');

  // STEP 1. 애니웍스에서 다운로드
  console.log('[STEP 1] 애니웍스 다운로드...');
  var jobId = engine.startJob({
    username: settings.anyworks_id,
    password: settings.anyworks_pw,
    base_url: 'https://works.animotion.co.kr',
    list_url: 'https://works.animotion.co.kr/Sales/Week_List.asp?top_id=80&mun=6&table=WeekList',
    teams: teams,
    start_date: startDate,
    end_date: endDate,
    download_timeout: 20
  });

  // 완료 대기
  var job;
  while (true) {
    await new Promise(function (r) { setTimeout(r, 2000); });
    job = engine.getJob(jobId);
    if (!job || job.status === 'done' || job.status === 'error') break;
    // 최신 로그 출력
    if (job.logs.length > 0) {
      var last = job.logs[job.logs.length - 1];
      process.stdout.write('\r  ' + last.msg.slice(0, 80).padEnd(80));
    }
  }
  console.log('');

  if (!job || job.status === 'error') {
    console.error('❌ 다운로드 실패:', job ? job.error : '알 수 없는 오류');
    return;
  }

  if (!job.files || !job.files.length) {
    console.log('⚠️  다운로드된 파일이 없습니다.');
    return;
  }

  console.log('✅ ' + job.files.length + '개 파일 다운로드 완료');

  // STEP 2. 엑셀 파싱
  console.log('');
  console.log('[STEP 2] 엑셀 파싱...');
  var allRecords = [];
  job.files.forEach(function (f) {
    try {
      var buf = Buffer.from(f.base64, 'base64');
      var records = parseExcelBuffer(buf);
      console.log('  ' + f.name + ': ' + records.length + '건');
      allRecords = allRecords.concat(records);
    } catch (e) {
      console.error('  ' + f.name + ' 파싱 실패:', e.message);
    }
  });

  // 중복 제거
  var seen = new Set();
  allRecords = allRecords.filter(function (r) {
    var k = r.date + '|' + r.name + '|' + r.orderNo + '|' + r.hours + '|' + r.content;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  console.log('  총 ' + allRecords.length + '건 (중복 제거 후)');

  if (!allRecords.length) {
    console.log('⚠️  파싱된 레코드가 없습니다.');
    return;
  }

  // STEP 3. 서버 업로드
  console.log('');
  console.log('[STEP 3] 서버 업로드...');
  try {
    var token = await serverLogin(settings);
    console.log('  서버 로그인 성공');

    var existing = await getExistingRecords(token);
    console.log('  기존 레코드: ' + existing.length + '건');

    var result = mergeRecords(existing, allRecords);
    console.log('  병합 결과: 추가 ' + result.added + '건, 갱신 ' + result.updated + '건, 총 ' + result.merged.length + '건');

    await uploadRecords(token, result.merged);
    console.log('  ✅ 서버 업로드 완료!');
  } catch (e) {
    console.error('  ❌ 서버 업로드 실패:', e.message);
  }

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  완료!');
  console.log('═══════════════════════════════════════════');
}

main().catch(function (e) { console.error('오류:', e); process.exit(1); });
