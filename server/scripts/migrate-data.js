/**
 * 데이터 마이그레이션 스크립트
 * IndexedDB 백업 JSON → PostgreSQL
 *
 * 사용법:
 *   node scripts/migrate-data.js --file backup.json --admin-id <admin-user-uuid>
 *
 * 백업 JSON은 기존 앱의 '데이터 백업' 기능으로 생성한 파일
 */

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
var db = require('../config/db');
var fs = require('fs');

function parseArgs() {
  var args = process.argv.slice(2);
  var opts = {};
  for (var i = 0; i < args.length; i += 2) {
    opts[args[i].replace(/^--/, '')] = args[i + 1] || '';
  }
  return opts;
}

async function migrate() {
  var args = parseArgs();
  var filePath = args.file;
  var adminId = args['admin-id'] || args.adminId;

  if (!filePath) {
    console.error('사용법: node scripts/migrate-data.js --file <backup.json> --admin-id <uuid>');
    process.exit(1);
  }

  var raw = fs.readFileSync(filePath, 'utf8');
  var backup = JSON.parse(raw);

  console.log('백업 파일 로드 완료:', filePath);
  console.log('스토어:', Object.keys(backup).join(', '));

  var counts = {};

  // 프로젝트
  if (backup.projects && backup.projects.length) {
    for (var i = 0; i < backup.projects.length; i++) {
      var p = backup.projects[i];
      await db.query(
        "INSERT INTO projects (id, order_no, name, start_date, end_date, status, progress, estimated_hours, actual_hours, assignees, dependencies, color, memo, current_phase, phases, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) ON CONFLICT (id) DO NOTHING",
        [p.id, p.orderNo || '', p.name || '', p.startDate || '', p.endDate || '', p.status || 'active', p.progress || 0, p.estimatedHours || 0, p.actualHours || 0, JSON.stringify(p.assignees || []), JSON.stringify(p.dependencies || []), p.color || '', p.memo || '', p.currentPhase || 'order', JSON.stringify(p.phases || {}), adminId, p.createdAt || new Date().toISOString()]
      );
    }
    counts.projects = backup.projects.length;
  }

  // 마일스톤
  if (backup.milestones && backup.milestones.length) {
    for (var i = 0; i < backup.milestones.length; i++) {
      var m = backup.milestones[i];
      await db.query(
        "INSERT INTO milestones (id, project_id, name, start_date, end_date, status, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING",
        [m.id, m.projectId, m.name || '', m.startDate || '', m.endDate || '', m.status || 'waiting', m.order || 0, adminId]
      );
    }
    counts.milestones = backup.milestones.length;
  }

  // 이벤트
  if (backup.events && backup.events.length) {
    for (var i = 0; i < backup.events.length; i++) {
      var e = backup.events[i];
      await db.query(
        "INSERT INTO events (id, title, type, start_date, end_date, project_ids, assignees, color, memo, repeat, repeat_until, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING",
        [e.id, e.title || '', e.type || 'etc', e.startDate || '', e.endDate || '', JSON.stringify(e.projectIds || []), JSON.stringify(e.assignees || []), e.color || '', e.memo || '', e.repeat || null, e.repeatUntil || null, adminId]
      );
    }
    counts.events = backup.events.length;
  }

  // 수주대장
  if (backup.orders && backup.orders.length) {
    for (var i = 0; i < backup.orders.length; i++) {
      var o = backup.orders[i];
      await db.query(
        "INSERT INTO orders (order_no, date, client, name, amount, manager, delivery, memo, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (order_no) DO NOTHING",
        [o.orderNo, o.date || '', o.client || '', o.name || '', o.amount || 0, o.manager || '', o.delivery || '', o.memo || '', adminId]
      );
    }
    counts.orders = backup.orders.length;
  }

  // 이슈
  if (backup.issues && backup.issues.length) {
    for (var i = 0; i < backup.issues.length; i++) {
      var iss = backup.issues[i];
      await db.query(
        "INSERT INTO issues (id, project_id, order_no, phase, dept, type, urgency, status, report_date, due_date, title, description, reporter, assignees, tags, resolution, resolved_date, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (id) DO NOTHING",
        [iss.id, iss.projectId || null, iss.orderNo || null, iss.phase || null, iss.dept || null, iss.type || null, iss.urgency || 'normal', iss.status || 'open', iss.reportDate || null, iss.dueDate || null, iss.title || '', iss.description || '', iss.reporter || null, JSON.stringify(iss.assignees || []), JSON.stringify(iss.tags || []), iss.resolution || null, iss.resolvedDate || null, adminId, iss.createdAt || new Date().toISOString()]
      );
    }
    counts.issues = backup.issues.length;
  }

  // 이슈 로그
  if (backup.issueLogs && backup.issueLogs.length) {
    for (var i = 0; i < backup.issueLogs.length; i++) {
      var il = backup.issueLogs[i];
      await db.query(
        "INSERT INTO issue_logs (id, issue_id, date, content, author, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
        [il.id, il.issueId, il.date || null, il.content || '', il.author || null, adminId]
      );
    }
    counts.issueLogs = backup.issueLogs.length;
  }

  // 체크리스트
  if (backup.checklists && backup.checklists.length) {
    for (var i = 0; i < backup.checklists.length; i++) {
      var c = backup.checklists[i];
      await db.query(
        "INSERT INTO checklists (id, project_id, phase, items, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
        [c.id, c.projectId, c.phase || null, JSON.stringify(c.items || []), adminId]
      );
    }
    counts.checklists = backup.checklists.length;
  }

  // 진척률 히스토리
  if (backup.progressHistory && backup.progressHistory.length) {
    for (var i = 0; i < backup.progressHistory.length; i++) {
      var ph = backup.progressHistory[i];
      await db.query(
        "INSERT INTO progress_history (id, project_id, date, progress, actual_hours, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
        [ph.id, ph.projectId, ph.date || '', ph.progress || 0, ph.actualHours || 0, adminId]
      );
    }
    counts.progressHistory = backup.progressHistory.length;
  }

  // 업무일지 아카이브 (weeks)
  if (backup.weeks && backup.weeks.length) {
    for (var i = 0; i < backup.weeks.length; i++) {
      var w = backup.weeks[i];
      await db.query(
        "INSERT INTO work_archives (id, label, date_range, selected_names, total_hours, data, saved_at, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING",
        [w.id, w.label || '', JSON.stringify(w.dateRange || []), JSON.stringify(w.selectedNames || []), w.totalHours || 0, JSON.stringify(w.data || []), w.savedAt || new Date().toISOString(), adminId]
      );
    }
    counts.weeks = backup.weeks.length;
  }

  // 문서 폴더
  if (backup.projectFolders && backup.projectFolders.length) {
    for (var i = 0; i < backup.projectFolders.length; i++) {
      var f = backup.projectFolders[i];
      await db.query(
        "INSERT INTO project_folders (id, project_id, parent_id, name, memo, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
        [f.id, f.projectId || null, f.parentId || null, f.name || '', f.memo || '', adminId]
      );
    }
    counts.projectFolders = backup.projectFolders.length;
  }

  // 문서 파일
  if (backup.projectFiles && backup.projectFiles.length) {
    for (var i = 0; i < backup.projectFiles.length; i++) {
      var fi = backup.projectFiles[i];
      await db.query(
        "INSERT INTO project_files (id, project_id, folder_id, name, ext, size, mime_type, text_cache, tags, memo, summary_history, version_history, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING",
        [fi.id, fi.projectId || null, fi.folderId || null, fi.name || '', fi.ext || '', fi.size || 0, fi.type || '', fi.textCache || null, JSON.stringify(fi.tags || []), fi.memo || '', JSON.stringify(fi.summaryHistory || []), JSON.stringify(fi.versionHistory || []), adminId]
      );
    }
    counts.projectFiles = backup.projectFiles.length;
  }

  console.log('\n마이그레이션 완료:');
  Object.keys(counts).forEach(function (k) {
    console.log('  ' + k + ': ' + counts[k] + '건');
  });
  process.exit(0);
}

migrate().catch(function (e) {
  console.error('마이그레이션 오류:', e);
  process.exit(1);
});
