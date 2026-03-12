#!/usr/bin/env node
/**
 * DB 백업 스크립트
 * 사용법: node scripts/backup-db.js [--output ./backups]
 *
 * 주요 테이블 데이터를 JSON으로 내보냅니다.
 * pg_dump 사용 가능하면 pg_dump를 권장하지만,
 * 이 스크립트는 pg_dump 없이도 동작합니다.
 */

var path = require('path');
var fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

var db = require('../config/db');

var args = process.argv.slice(2);
var outIdx = args.indexOf('--output');
var outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : path.join(__dirname, '..', 'backups');

var TABLES = [
  'departments',
  'users',
  'projects',
  'project_members',
  'milestones',
  'events',
  'orders',
  'checklists',
  'issues',
  'issue_logs',
  'progress_history',
  'work_archives',
  'work_records',
  'project_folders',
  'project_files',
  'audit_logs'
];

async function main() {
  console.log('[backup] 시작...');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  var backup = {};

  for (var i = 0; i < TABLES.length; i++) {
    var table = TABLES[i];
    try {
      var r = await db.query('SELECT * FROM ' + table);
      backup[table] = r.rows;
      console.log('  ' + table + ': ' + r.rows.length + ' rows');
    } catch (e) {
      console.warn('  ' + table + ': 스킵 (' + e.message + ')');
      backup[table] = [];
    }
  }

  var filePath = path.join(outDir, 'backup_' + timestamp + '.json');
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf8');
  console.log('[backup] 완료: ' + filePath);

  // 오래된 백업 정리 (30일 이상)
  var files = fs.readdirSync(outDir).filter(function (f) { return f.startsWith('backup_') && f.endsWith('.json'); });
  var now = Date.now();
  var maxAge = 30 * 24 * 60 * 60 * 1000;
  files.forEach(function (f) {
    var fp = path.join(outDir, f);
    var stat = fs.statSync(fp);
    if (now - stat.mtimeMs > maxAge) {
      fs.unlinkSync(fp);
      console.log('  [cleanup] 삭제:', f);
    }
  });

  process.exit(0);
}

main().catch(function (e) {
  console.error('[backup] 실패:', e);
  process.exit(1);
});
