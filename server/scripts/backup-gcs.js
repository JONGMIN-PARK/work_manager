#!/usr/bin/env node
/**
 * DB 백업 파일을 GCS 에 올리고 오래된 것 정리 (v13.431) — .github/workflows/db-backup.yml 이 부른다.
 *   node backup-gcs.js --file out/wm-2026-11-11T0330.dump --report out/report.json --prefix backups/db/ --keep-days 30
 * 환경변수: GCS_PROJECT_ID · GCS_BUCKET · GCS_SA_KEY (서버와 같은 값)
 *
 * 올리는 것: <prefix><이름>.dump · <prefix><이름>.json(보고서) · <prefix>latest.json(⚙️ 백업 현황이 읽음)
 * 정리: keep-days 지난 .dump/.json 삭제 — 단 가장 최근 7개는 날짜와 상관없이 남긴다.
 * 실패한 백업(ok=false)도 보고서 · latest.json 은 올린다(화면에 '실패' 로 보이게). 덤프는 올리지 않음.
 */
var fs = require('fs');
var path = require('path');
var gcs = require('../services/gcs.service');

var KEEP_MIN = 7;

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** 지울 것 고르기 (순수 함수 — 시험용) */
function pickExpired(objects, prefix, keepDays, now) {
  var dumps = objects.filter(function (o) { return o.key.indexOf(prefix) === 0 && /\.dump$/.test(o.key); })
    .sort(function (a, b) { return String(b.key).localeCompare(String(a.key)); });   // 이름에 날짜 → 최신이 앞
  var cut = (now || Date.now()) - keepDays * 86400000;
  var del = [];
  dumps.forEach(function (o, i) {
    if (i < KEEP_MIN) return;
    var t = Date.parse(o.updated || '') || 0;
    if (t && t < cut) { del.push(o.key); del.push(o.key.replace(/\.dump$/, '.json')); }
  });
  return del;
}

async function main() {
  var file = arg('file'), reportPath = arg('report'), prefix = arg('prefix', 'backups/db/');
  var keepDays = parseInt(arg('keep-days', '30'), 10) || 30;
  if (!file || !reportPath) throw new Error('--file 과 --report 가 필요합니다');
  if (!gcs.isEnabled()) throw new Error('GCS 설정(GCS_PROJECT_ID · GCS_BUCKET · GCS_SA_KEY)이 없습니다');
  if (!/\/$/.test(prefix)) prefix += '/';

  var report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  delete report.summaryMd;
  var base = path.basename(file).replace(/\.dump$/, '');
  report.key = prefix + base + '.dump';
  report.runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID ? process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID : null;

  if (report.ok) {
    console.log('올리는 중: ' + report.key + ' (' + report.bytes + ' bytes)');
    await gcs.uploadFile(report.key, file, 'application/octet-stream');
  } else {
    report.key = null;
  }
  var body = Buffer.from(JSON.stringify(report, null, 1), 'utf8');
  await gcs.uploadBuffer(prefix + base + '.json', body, 'application/json');
  // latest.json — 마지막 성공 · 마지막 실행을 따로 둔다 (실패가 이어져도 마지막 성공 시각이 보이게)
  var prev = null;
  try { prev = JSON.parse((await gcs.readText(prefix + 'latest.json')) || 'null'); } catch (e) { prev = null; }
  var brief = Object.assign({}, report);
  delete brief.counts; delete brief.diffs;
  var latest = { lastRun: brief, lastOk: report.ok ? brief : (prev && prev.lastOk) || null };
  await gcs.uploadBuffer(prefix + 'latest.json', Buffer.from(JSON.stringify(latest, null, 1), 'utf8'), 'application/json');

  var objs = await gcs.listObjects(prefix);
  var del = pickExpired(objs, prefix, keepDays);
  for (var i = 0; i < del.length; i++) await gcs.deleteObject(del[i]);
  console.log('완료 — ' + (report.ok ? '올림' : '실패 기록만') + ' · 정리 ' + (del.length / 2) + '개 · 남은 백업 ' + (objs.filter(function (o) { return /\.dump$/.test(o.key); }).length - del.length / 2) + '개');
  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  main().catch(function (e) { console.error('[backup-gcs] 실패:', e.message); process.exit(1); });
}

module.exports = { pickExpired: pickExpired };
