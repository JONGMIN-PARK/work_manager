/**
 * A/S 자동화 스케줄러 — node-cron
 *
 * v13.55 B: SLA 임박 알림 / 미회신 알림 / 주간 요약 자동 발사
 *
 * 활성화: server/app.js 부팅 시 require('./services/scheduler.service').start()
 * 비활성화 환경변수: SCHEDULER_DISABLED=1 (테스트·로컬 개발 등)
 *
 * 시간대: Asia/Seoul 고정
 *
 * 작업:
 *   1) SLA 임박/위반 체크   — 매 시간 정각 (08:00 ~ 19:00, 월-금)
 *      - P1/P2 진행중인 ticket 중 약속 visitH/closeDays 12h 이내 임박 or 이미 초과
 *      - 담당자(assignee) + admin에게 텔레그램 알림
 *   2) 미회신 D+3 체크     — 매일 09:00
 *      - customer_wait 상태로 3일 이상 머무른 ticket → admin
 *   3) 주간 요약           — 매주 월요일 08:30
 *      - 모든 테넌트의 admin 그룹에게 as_weekly_digest 발사
 */
var db = require('../config/db');
var notificationService = require('./notification.service');

var _started = false;
var _tasks = [];

function start() {
  if (_started) return;
  if (process.env.SCHEDULER_DISABLED === '1' || process.env.SCHEDULER_DISABLED === 'true') {
    console.log('[Scheduler] disabled via SCHEDULER_DISABLED');
    return;
  }
  var cron;
  try {
    cron = require('node-cron');
  } catch (e) {
    console.warn('[Scheduler] node-cron 모듈 없음 — npm install 후 재시작 필요');
    return;
  }

  var tz = 'Asia/Seoul';

  // 1) SLA 임박/위반 — 평일 업무시간(09~18) 매 시간
  _tasks.push(cron.schedule('5 9-18 * * 1-5', function () {
    checkSlaBreaches().catch(function (e) { console.error('[Scheduler/sla]', e.message); });
  }, { timezone: tz }));

  // 2) 미회신 D+3 — 매일 09:10
  _tasks.push(cron.schedule('10 9 * * *', function () {
    checkCustomerWaitOverdue().catch(function (e) { console.error('[Scheduler/wait]', e.message); });
  }, { timezone: tz }));

  // 3) 주간 요약 — 매주 월요일 08:30
  _tasks.push(cron.schedule('30 8 * * 1', function () {
    sendWeeklyDigests().catch(function (e) { console.error('[Scheduler/digest]', e.message); });
  }, { timezone: tz }));

  // 4) DB 자동 백업 — 매일 03:00 KST (7일 보존)
  var backupModule;
  try {
    backupModule = require('../scripts/backup-db');
  } catch (e) {
    console.warn('[Scheduler/backup] backup-db 모듈 로드 실패:', e.message);
  }
  if (backupModule && backupModule.runBackup) {
    _tasks.push(cron.schedule('0 3 * * *', function () {
      backupModule.runBackup({ retentionDays: 7 }).then(function (result) {
        console.log('[Scheduler/backup] 완료: ' + result.filePath + ' (정리 ' + result.cleanedCount + '건)');
      }).catch(function (e) {
        console.error('[Scheduler/backup] 실패:', e.message);
      });
    }, { timezone: tz }));
  }

  _started = true;
  console.log('[Scheduler] ' + _tasks.length + '개 작업 등록됨 (TZ=Asia/Seoul) — SLA(평일 09~18시), 미회신(매일 09:10), 주간(월 08:30), 백업(매일 03:00)');
}

function stop() {
  _tasks.forEach(function (t) { try { t.stop(); } catch (e) {} });
  _tasks = [];
  _started = false;
}

// SLA 정책 (config.js AS_PRIORITY와 동일)
var SLA = {
  P1: { closeDays: 3, label: 'P1 긴급' },
  P2: { closeDays: 7, label: 'P2 높음' },
  P3: { closeDays: 14, label: 'P3 보통' },
  P4: { closeDays: 30, label: 'P4 낮음' }
};

// ────────────────────────────────────────────────────────────
// 1) SLA 임박/초과 체크
// ────────────────────────────────────────────────────────────
async function checkSlaBreaches() {
  // 임박 기준 = closeDays의 80% 시점에서 알림 (P1: 2.4일, P2: 5.6일)
  // 이미 12시간 안에 알린 ticket은 중복 안 보냄 (audit_logs 기반 dedup)
  var r = await db.query(
    "SELECT id, tenant_id, ticket_no, priority, customer_name, equipment_model, received_at, status, " +
    "  EXTRACT(EPOCH FROM (NOW() - received_at))/3600.0 AS elapsed_h " +
    "FROM as_tickets " +
    "WHERE deleted_at IS NULL AND status NOT IN ('closed','cancelled') AND priority IN ('P1','P2') " +
    "  AND ( " +
    "    (priority='P1' AND received_at < NOW() - INTERVAL '57.6 hours') " +   // 2.4d = 57.6h (80%)
    "    OR (priority='P2' AND received_at < NOW() - INTERVAL '134.4 hours') " +  // 5.6d (80%)
    "  )"
  );
  if (!r.rows.length) return;

  for (var i = 0; i < r.rows.length; i++) {
    var t = r.rows[i];
    // 중복 방지: 최근 12시간 안에 같은 ticket에 대해 알림 보낸 적 있나
    var dedup = await db.query(
      "SELECT 1 FROM audit_logs WHERE action = 'as.sla_alert' AND target_id = $1 AND created_at > NOW() - INTERVAL '12 hours' LIMIT 1",
      [t.id]
    );
    if (dedup.rows.length) continue;

    var sla = SLA[t.priority] || {};
    var elapsedH = Math.round(Number(t.elapsed_h));
    var slaH = sla.closeDays * 24;

    // 수신자: assignee + tenant admin
    var asgR = await db.query(
      "SELECT DISTINCT assignee_id FROM as_assignments WHERE ticket_id = $1 AND tenant_id = $2 AND assignee_id IS NOT NULL AND status NOT IN ('completed','cancelled')",
      [t.id, t.tenant_id]
    );
    var admR = await db.query(
      "SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' AND status = 'active'",
      [t.tenant_id]
    );
    var targets = {};
    asgR.rows.forEach(function (u) { targets[u.assignee_id] = true; });
    admR.rows.forEach(function (u) { targets[u.id] = true; });
    var ids = Object.keys(targets);
    if (!ids.length) continue;

    try {
      await notificationService.notify('as_sla_breach', {
        ticketNo: t.ticket_no,
        priority: t.priority,
        customerName: t.customer_name,
        elapsedH: elapsedH,
        slaH: slaH
      }, ids);
      // audit
      await db.query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, tenant_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [null, 'as.sla_alert', 'as_ticket', t.id, JSON.stringify({ priority: t.priority, elapsedH: elapsedH, targets: ids.length }), t.tenant_id]
      );
    } catch (e) {
      console.error('[Scheduler/sla]', t.ticket_no, e.message);
    }
  }
  console.log('[Scheduler/sla] checked ' + r.rows.length + ' tickets');
}

// ────────────────────────────────────────────────────────────
// 2) 미회신 D+3 (customer_wait 상태로 3일 이상)
// ────────────────────────────────────────────────────────────
async function checkCustomerWaitOverdue() {
  var r = await db.query(
    "SELECT id, tenant_id, ticket_no, customer_name, updated_at " +
    "FROM as_tickets " +
    "WHERE deleted_at IS NULL AND status = 'customer_wait' " +
    "  AND updated_at < NOW() - INTERVAL '3 days'"
  );
  for (var i = 0; i < r.rows.length; i++) {
    var t = r.rows[i];
    var dedup = await db.query(
      "SELECT 1 FROM audit_logs WHERE action = 'as.customer_wait_alert' AND target_id = $1 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1",
      [t.id]
    );
    if (dedup.rows.length) continue;
    var admR = await db.query(
      "SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' AND status = 'active'",
      [t.tenant_id]
    );
    var ids = admR.rows.map(function (u) { return u.id; });
    if (!ids.length) continue;
    try {
      await notificationService.notify('as_customer_wait', {
        ticketNo: t.ticket_no,
        customerName: t.customer_name
      }, ids);
      await db.query(
        "INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, tenant_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [null, 'as.customer_wait_alert', 'as_ticket', t.id, JSON.stringify({ ticketNo: t.ticket_no }), t.tenant_id]
      );
    } catch (e) {
      console.error('[Scheduler/wait]', t.ticket_no, e.message);
    }
  }
  console.log('[Scheduler/wait] checked ' + r.rows.length + ' overdue tickets');
}

// ────────────────────────────────────────────────────────────
// 3) 주간 요약 — 테넌트별 admin에게 텔레그램 발사
// ────────────────────────────────────────────────────────────
async function sendWeeklyDigests() {
  var tenants = await db.query("SELECT DISTINCT id FROM tenants WHERE status IS NULL OR status='active'");
  for (var i = 0; i < tenants.rows.length; i++) {
    var tid = tenants.rows[i].id;
    try {
      var content = await buildWeeklyDigestText(tid);
      var admR = await db.query("SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' AND status = 'active'", [tid]);
      var ids = admR.rows.map(function (u) { return u.id; });
      if (!ids.length) continue;
      await notificationService.notify('as_weekly_digest', { content: content }, ids);
      console.log('[Scheduler/digest] tenant=' + tid + ' sent to ' + ids.length + ' admins');
    } catch (e) {
      console.error('[Scheduler/digest] tenant=' + tid, e.message);
    }
  }
}

async function buildWeeklyDigestText(tenantId) {
  var now = new Date();
  var weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  var twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  var BASE = "tenant_id = $1 AND deleted_at IS NULL";

  var SLA_BREACH_EXPR =
    "CASE " +
    "  WHEN status NOT IN ('closed','cancelled') AND priority='P1' AND received_at < NOW() - INTERVAL '3 days' THEN 1 " +
    "  WHEN status NOT IN ('closed','cancelled') AND priority='P2' AND received_at < NOW() - INTERVAL '7 days' THEN 1 " +
    "  WHEN status NOT IN ('closed','cancelled') AND priority='P3' AND received_at < NOW() - INTERVAL '14 days' THEN 1 " +
    "  WHEN status NOT IN ('closed','cancelled') AND priority='P4' AND received_at < NOW() - INTERVAL '30 days' THEN 1 " +
    "  ELSE 0 END";

  var [curR, prevR, topCatR, topCustR, openCritR] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS new_count, " +
      "COUNT(*) FILTER (WHERE status='closed')::int AS closed_count, " +
      "COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - received_at))/3600.0) FILTER (WHERE status='closed' AND closed_at IS NOT NULL),0)::numeric(10,2) AS mttr_h, " +
      "COALESCE(SUM(" + SLA_BREACH_EXPR + "),0)::int AS sla_breach " +
      "FROM as_tickets WHERE " + BASE + " AND received_at >= $2 AND received_at <= $3",
      [tenantId, weekAgo.toISOString(), now.toISOString()]),
    db.query("SELECT COUNT(*)::int AS new_count, " +
      "COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - received_at))/3600.0) FILTER (WHERE status='closed' AND closed_at IS NOT NULL),0)::numeric(10,2) AS mttr_h " +
      "FROM as_tickets WHERE " + BASE + " AND received_at >= $2 AND received_at <= $3",
      [tenantId, twoWeeksAgo.toISOString(), weekAgo.toISOString()]),
    db.query("SELECT category, COUNT(*)::int AS c FROM as_tickets " +
      "WHERE " + BASE + " AND received_at >= $2 AND category IS NOT NULL GROUP BY category ORDER BY c DESC LIMIT 3",
      [tenantId, weekAgo.toISOString()]),
    db.query("SELECT customer_name, COUNT(*)::int AS c FROM as_tickets " +
      "WHERE " + BASE + " AND received_at >= $2 AND customer_name <> '' GROUP BY customer_name ORDER BY c DESC LIMIT 3",
      [tenantId, weekAgo.toISOString()]),
    db.query("SELECT ticket_no, priority, customer_name FROM as_tickets " +
      "WHERE " + BASE + " AND status NOT IN ('closed','cancelled') AND priority IN ('P1','P2') ORDER BY received_at ASC LIMIT 5",
      [tenantId])
  ]);

  var c = curR.rows[0] || {};
  var pr = prevR.rows[0] || {};
  var dPct = pr.new_count ? Math.round(((c.new_count - pr.new_count) / pr.new_count) * 1000) / 10 : null;

  var lines = [];
  lines.push('📊 <b>A/S 주간 요약</b> (' + weekAgo.toISOString().slice(0, 10) + ' ~ ' + now.toISOString().slice(0, 10) + ')');
  lines.push('');
  lines.push('🆕 신규 ' + (c.new_count || 0) + '건' + (dPct != null ? ' (전주 대비 ' + (dPct > 0 ? '+' : '') + dPct + '%)' : ''));
  lines.push('✅ 종결 ' + (c.closed_count || 0) + '건');
  if (c.mttr_h) lines.push('⏱️ 평균 처리 ' + Number(c.mttr_h).toFixed(1) + 'h' + (pr.mttr_h ? ' (전주 ' + Number(pr.mttr_h).toFixed(1) + 'h)' : ''));
  lines.push('🚨 SLA 위반 ' + (c.sla_breach || 0) + '건');

  if (topCatR.rows.length) {
    lines.push('');
    lines.push('<b>📌 주요 카테고리</b>');
    topCatR.rows.forEach(function (r) { lines.push('  • ' + (r.category || '-') + ' ' + r.c + '건'); });
  }
  if (topCustR.rows.length) {
    lines.push('');
    lines.push('<b>🎯 최다 발생 고객</b>');
    topCustR.rows.forEach(function (r) { lines.push('  • ' + r.customer_name + ' ' + r.c + '건'); });
  }
  if (openCritR.rows.length) {
    lines.push('');
    lines.push('<b>🔴 P1/P2 미해결 (최대 5건)</b>');
    openCritR.rows.forEach(function (r) {
      lines.push('  • [' + r.ticket_no + '] ' + r.priority + ' · ' + (r.customer_name || '-'));
    });
  }
  return lines.join('\n');
}

module.exports = { start: start, stop: stop, checkSlaBreaches: checkSlaBreaches, checkCustomerWaitOverdue: checkCustomerWaitOverdue, sendWeeklyDigests: sendWeeklyDigests };
