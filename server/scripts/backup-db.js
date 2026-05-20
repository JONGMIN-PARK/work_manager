#!/usr/bin/env node
/**
 * DB 백업 스크립트
 * - CLI: `node scripts/backup-db.js [--output ./backups]`
 * - 모듈: `require('./backup-db').runBackup({ outDir, retentionDays })`
 *   → Promise<{ filePath, tableRows, cleanedCount, retentionDays }>
 *
 * 주요 테이블 데이터를 JSON으로 내보냅니다.
 * pg_dump 사용 가능하면 pg_dump를 권장하지만,
 * 이 스크립트는 pg_dump 없이도 동작합니다.
 */

var path = require('path');
var fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

var db = require('../config/db');

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

/**
 * 백업 실행 — 모듈/CLI 공용 진입점
 * @param {{ outDir?: string, retentionDays?: number }} [opts]
 * @returns {Promise<{ filePath: string, tableRows: Object, cleanedCount: number, retentionDays: number }>}
 */
async function runBackup(opts) {
  opts = opts || {};
  var outDir = opts.outDir || path.join(__dirname, '..', 'backups');
  var retentionDays = (opts.retentionDays != null) ? opts.retentionDays : 30;

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  var backup = {};
  var tableRows = {};

  for (var i = 0; i < TABLES.length; i++) {
    var table = TABLES[i];
    try {
      var r = await db.query('SELECT * FROM ' + table);
      backup[table] = r.rows;
      tableRows[table] = r.rows.length;
    } catch (e) {
      backup[table] = [];
      tableRows[table] = -1; // -1 = 스킵 (테이블 없음/권한 등)
    }
  }

  var filePath = path.join(outDir, 'backup_' + timestamp + '.json');
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf8');

  // 보존 기간 초과 백업 정리
  var cleanedCount = 0;
  var files = fs.readdirSync(outDir).filter(function (f) { return f.startsWith('backup_') && f.endsWith('.json'); });
  var now = Date.now();
  var maxAge = retentionDays * 24 * 60 * 60 * 1000;
  files.forEach(function (f) {
    var fp = path.join(outDir, f);
    try {
      var stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(fp);
        cleanedCount++;
      }
    } catch (_) { /* ignore */ }
  });

  return { filePath: filePath, tableRows: tableRows, cleanedCount: cleanedCount, retentionDays: retentionDays };
}

// CLI 모드
if (require.main === module) {
  var args = process.argv.slice(2);
  var outIdx = args.indexOf('--output');
  var outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : undefined;

  console.log('[backup] 시작...');
  runBackup({ outDir: outDir }).then(function (result) {
    Object.keys(result.tableRows).forEach(function (t) {
      var n = result.tableRows[t];
      if (n < 0) {
        console.warn('  ' + t + ': 스킵');
      } else {
        console.log('  ' + t + ': ' + n + ' rows');
      }
    });
    console.log('[backup] 완료: ' + result.filePath);
    if (result.cleanedCount > 0) {
      console.log('  [cleanup] 삭제: ' + result.cleanedCount + '개 (보존 ' + result.retentionDays + '일)');
    }
    process.exit(0);
  }).catch(function (e) {
    console.error('[backup] 실패:', e);
    process.exit(1);
  });
}

module.exports = { runBackup: runBackup, TABLES: TABLES };
