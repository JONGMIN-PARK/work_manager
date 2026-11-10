#!/usr/bin/env node
/**
 * DB 백업 결과 보고서 (v13.431) — .github/workflows/db-backup.yml 이 부른다.
 *   node backup-report.js <원본 행 수 csv> <복원 행 수 csv> <덤프 파일> <복원 오류 수> <백업 초>
 * csv 한 줄 = "테이블,행 수". 결과 JSON 을 stdout 으로 — ok=false 면 작업 실패로 처리.
 *
 * 판정: 복원본에 없는 테이블이 있거나, 행 수가 원본보다 5% 넘게(그리고 20줄 넘게) 모자라면 실패.
 * (백업하는 몇 분 사이에 새로 쌓인 몇 줄은 차이로만 적고 실패로 보지 않는다)
 */
var fs = require('fs');
var crypto = require('crypto');

function readCounts(file) {
  var out = {};
  String(fs.readFileSync(file, 'utf8')).split(/\r?\n/).forEach(function (line) {
    if (!line.trim()) return;
    var i = line.lastIndexOf(',');
    out[line.slice(0, i)] = parseInt(line.slice(i + 1), 10) || 0;
  });
  return out;
}

function sha256(file) {
  var h = crypto.createHash('sha256');
  var fd = fs.openSync(file, 'r'), buf = Buffer.alloc(1 << 20), n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}

function fmtBytes(n) {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(2) + ' GB';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
  return Math.round(n / 1024) + ' KB';
}

function judge(src, restored) {
  var missing = [], short = [], diffs = [];
  Object.keys(src).forEach(function (t) {
    if (!(t in restored)) { missing.push(t); return; }
    var a = src[t], b = restored[t];
    if (a === b) return;
    diffs.push({ table: t, source: a, restored: b });
    if (b < a * 0.95 && a - b > 20) short.push(t);
  });
  var problem = '';
  if (!Object.keys(src).length) problem = '원본 테이블을 하나도 못 읽었습니다';
  else if (missing.length) problem = '복원본에 없는 테이블: ' + missing.join(', ');
  else if (short.length) problem = '복원본 행 수가 크게 모자란 테이블: ' + short.join(', ');
  return { ok: !problem, problem: problem, missing: missing, short: short, diffs: diffs };
}

function build(srcFile, restFile, dumpFile, restoreErrors, dumpSec) {
  var src = readCounts(srcFile), restored = readCounts(restFile);
  var j = judge(src, restored);
  var bytes = fs.statSync(dumpFile).size;
  var rows = 0, restRows = 0;
  Object.keys(src).forEach(function (t) { rows += src[t]; });
  Object.keys(restored).forEach(function (t) { restRows += restored[t]; });
  var name = require('path').basename(dumpFile);
  var r = {
    ok: j.ok, problem: j.problem,
    at: new Date().toISOString(), file: name, bytes: bytes, sha256: sha256(dumpFile),
    tables: Object.keys(src).length, rows: rows, restoredRows: restRows,
    restoreErrors: parseInt(restoreErrors, 10) || 0, dumpSec: parseInt(dumpSec, 10) || 0,
    missing: j.missing, diffs: j.diffs.slice(0, 50),
    counts: src
  };
  var md = '## ' + (r.ok ? '✅ DB 백업 성공' : '❌ DB 백업 실패') + '\n\n' +
    '| 항목 | 값 |\n|---|---|\n' +
    '| 파일 | `' + name + '` (' + fmtBytes(bytes) + ') |\n' +
    '| 테이블 · 행 | ' + r.tables + '개 · ' + rows.toLocaleString('en-US') + '줄 |\n' +
    '| 시험 복원 | ' + restRows.toLocaleString('en-US') + '줄 · 오류 ' + r.restoreErrors + '건 |\n' +
    '| 걸린 시간 | ' + r.dumpSec + '초 |\n' +
    (r.problem ? '\n**문제:** ' + r.problem + '\n' : '') +
    (j.diffs.length ? '\n백업 중 바뀐 행 수: ' + j.diffs.slice(0, 10).map(function (d) { return d.table + ' ' + d.source + '→' + d.restored; }).join(' · ') + '\n' : '');
  r.summaryMd = md;
  return r;
}

if (require.main === module) {
  var a = process.argv.slice(2);
  if (a.length < 3) { console.error('사용법: backup-report.js <원본 csv> <복원 csv> <덤프> [오류 수] [초]'); process.exit(2); }
  process.stdout.write(JSON.stringify(build(a[0], a[1], a[2], a[3], a[4]), null, 1));
}

module.exports = { judge: judge, build: build, readCounts: readCounts };
