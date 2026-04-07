/**
 * 엑셀 파일 → 서버 업로드 스크립트
 *
 * 사용법:
 *   node upload.js D:\다운로드\주간일지폴더
 *   node upload.js D:\다운로드\주간일지폴더\파일.xls
 *   node upload.js .    (현재 폴더의 모든 엑셀)
 */
var path = require('path');
var fs = require('fs');
var XLSX;
try { XLSX = require('xlsx'); } catch (e) {
  console.error('xlsx 모듈이 필요합니다: npm install xlsx');
  process.exit(1);
}

// ── 설정 ──
var SETTINGS_FILE = path.join(__dirname, 'upload-settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) { return {}; }
}

function initSettings() {
  var defaults = {
    server_url: 'https://work-manager-i97q.onrender.com',
    server_email: '',
    server_password: ''
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaults, null, 2), 'utf8');
  console.log('');
  console.log('  ⚠️  upload-settings.json 파일을 먼저 편집하세요:');
  console.log('  위치: ' + SETTINGS_FILE);
  console.log('');
  console.log('  {');
  console.log('    "server_url": "https://your-server.onrender.com",');
  console.log('    "server_email": "로그인이메일",');
  console.log('    "server_password": "비밀번호"');
  console.log('  }');
  console.log('');
  process.exit(0);
}

// ── 엑셀 파싱 ──
function parseExcel(filePath) {
  var buf = fs.readFileSync(filePath);
  var wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: true });
  var ws = wb.Sheets[wb.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (rows.length < 2) return [];

  var hdr = rows[0].map(function (c) { return String(c || '').trim().toLowerCase(); });
  var colMap = {};
  var aliases = {
    date: ['날짜', '일자', 'date', '작성일'],
    name: ['이름', '성명', '작성자', 'name', '사원명'],
    orderNo: ['수주번호', '수주no', 'order', '수주'],
    hours: ['시간', '공수', 'hours', '투입시간', 'h'],
    taskType: ['업무분장', '분장', '업무유형', 'task', '구분'],
    abbr: ['약자', '약어', 'abbr', '코드'],
    content: ['업무내용', '내용', 'content', '비고', '상세']
  };
  Object.keys(aliases).forEach(function (key) {
    for (var ci = 0; ci < hdr.length; ci++) {
      for (var ai = 0; ai < aliases[key].length; ai++) {
        if (hdr[ci].indexOf(aliases[key][ai]) >= 0) { colMap[key] = ci; return; }
      }
    }
  });
  if (colMap.date === undefined || colMap.name === undefined) {
    colMap = { date: 0, name: 1, orderNo: 2, hours: 3, taskType: 4, abbr: 5, content: rows[0].length - 1 };
  }

  var records = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var date = String(r[colMap.date] || '').replace(/[-\/\.]/g, '').trim();
    var name = String(r[colMap.name] || '').trim();
    if (!date || !name || date.length < 8) continue;
    records.push({
      date: date.slice(0, 8), name: name,
      orderNo: colMap.orderNo !== undefined ? String(r[colMap.orderNo] || '').trim() : '',
      hours: parseFloat(r[colMap.hours]) || 0,
      taskType: colMap.taskType !== undefined ? String(r[colMap.taskType] || '').trim() : '',
      abbr: colMap.abbr !== undefined ? String(r[colMap.abbr] || '').trim() : '',
      content: colMap.content !== undefined ? String(r[colMap.content] || '').trim() : ''
    });
  }
  return records;
}

// ── 서버 API ──
async function login(url, email, password) {
  var resp = await fetch(url + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  });
  if (!resp.ok) throw new Error('로그인 실패 (' + resp.status + ')');
  var data = await resp.json();
  return data.data.accessToken;
}

async function getRecords(url, token) {
  var resp = await fetch(url + '/api/archives/records?limit=50000&all=true', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!resp.ok) return [];
  var data = await resp.json();
  return (data.data || []).map(function (r) {
    return { date: r.date, name: r.name, orderNo: r.order_no, hours: parseFloat(r.hours) || 0,
      taskType: r.task_type, abbr: r.abbr, content: r.content, ocmt: r.ocmt, oclient: r.oclient };
  });
}

async function upload(url, token, records) {
  var resp = await fetch(url + '/api/archives/records/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ records: records })
  });
  if (!resp.ok) { var e = await resp.json().catch(function () { return {}; }); throw new Error(e.message || resp.status); }
  return await resp.json();
}

function idKey(r) { return r.date + '|' + r.name + '|' + (r.orderNo || ''); }

function merge(existing, newRecs) {
  var byId = new Map();
  newRecs.forEach(function (r) { byId.set(idKey(r), r); });
  var updated = 0, added = 0;
  var merged = existing.map(function (r) {
    var k = idKey(r);
    if (byId.has(k)) { var n = byId.get(k); byId.delete(k); updated++; return Object.assign({}, r, n); }
    return r;
  });
  byId.forEach(function (r) { merged.push(r); added++; });
  return { merged: merged, added: added, updated: updated };
}

// ── 메인 ──
async function main() {
  var target = process.argv[2];
  if (!target) {
    console.log('');
    console.log('  사용법: node upload.js <폴더경로 또는 파일경로>');
    console.log('');
    console.log('  예시:');
    console.log('    node upload.js D:\\다운로드\\주간일지');
    console.log('    node upload.js D:\\다운로드\\주간일지_기술연구소.xls');
    console.log('    node upload.js .   (현재 폴더)');
    console.log('');
    return;
  }

  var settings = loadSettings();
  if (!settings.server_email || !settings.server_password) initSettings();

  // 파일 수집
  var files = [];
  var stat = fs.statSync(target);
  if (stat.isDirectory()) {
    fs.readdirSync(target).forEach(function (f) {
      if (/\.(xls|xlsx|csv)$/i.test(f)) files.push(path.join(target, f));
    });
  } else {
    files.push(target);
  }

  if (!files.length) { console.log('엑셀 파일이 없습니다: ' + target); return; }

  console.log('');
  console.log('📋 파일 ' + files.length + '개 발견');

  // 파싱
  var allRecords = [];
  files.forEach(function (f) {
    try {
      var recs = parseExcel(f);
      console.log('  ✓ ' + path.basename(f) + ' → ' + recs.length + '건');
      allRecords = allRecords.concat(recs);
    } catch (e) {
      console.error('  ✗ ' + path.basename(f) + ' → ' + e.message);
    }
  });

  // 중복 제거
  var seen = new Set();
  allRecords = allRecords.filter(function (r) {
    var k = r.date + '|' + r.name + '|' + r.orderNo + '|' + r.hours + '|' + r.content;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  console.log('  총 ' + allRecords.length + '건 (중복 제거 후)');
  if (!allRecords.length) return;

  // 서버 업로드
  console.log('');
  console.log('🔄 서버 업로드 중...');
  var token = await login(settings.server_url, settings.server_email, settings.server_password);
  console.log('  로그인 성공');

  var existing = await getRecords(settings.server_url, token);
  console.log('  기존 ' + existing.length + '건');

  var result = merge(existing, allRecords);
  console.log('  → 추가 ' + result.added + '건, 갱신 ' + result.updated + '건');

  await upload(settings.server_url, token, result.merged);
  console.log('');
  console.log('✅ 완료! 총 ' + result.merged.length + '건 업로드');
}

main().catch(function (e) { console.error('오류:', e.message); process.exit(1); });
