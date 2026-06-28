/**
 * 프로젝트 명령어 모듈: /project, /checklist
 */
var db = require('../../config/db');
var escHtml = require('../util/escape').escHtml;

/** 텍스트 바 차트 생성 */
function textBar(value, max, width) {
  width = width || 16;
  var filled = max > 0 ? Math.round(value / max * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function create(sendMessage) {
  /** 봇 명령어: /project <이름> — 프로젝트 현황 */
  async function cmdProject(chatId, user, query) {
    if (!query) {
      // 프로젝트 목록 표시
      var listR = await db.query(
        "SELECT name, status, progress, order_no FROM projects WHERE status NOT IN ('done') ORDER BY CASE status WHEN 'delayed' THEN 0 WHEN 'active' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END, name LIMIT 15"
      );
      if (listR.rows.length === 0) return sendMessage(chatId, '📁 진행중인 프로젝트가 없습니다.');

      var msg = '📁 <b>진행중 프로젝트</b>\n\n';
      listR.rows.forEach(function (r, i) {
        var statusIcon = r.status === 'delayed' ? '⚠️' : r.status === 'active' ? '🔵' : '⏳';
        var pct = r.progress || 0;
        msg += statusIcon + ' ' + escHtml(r.name);
        if (r.order_no) msg += ' <code>[' + escHtml(r.order_no) + ']</code>';
        msg += '\n   <code>' + textBar(pct, 100, 10) + '</code> ' + pct + '%\n';
      });
      msg += '\n💡 /checklist 이름 체크리스트 · /overdue 지연 현황';
      return sendMessage(chatId, msg);
    }

    // 이름 검색
    var pR = await db.query(
      "SELECT * FROM projects WHERE name ILIKE $1 OR order_no ILIKE $1 LIMIT 1",
      ['%' + query + '%']
    );
    if (pR.rows.length === 0) return sendMessage(chatId, '❌ "' + escHtml(query) + '" 프로젝트를 찾을 수 없습니다.');

    var p = pR.rows[0];
    var statusMap = { waiting: '⏳ 대기', active: '🔵 진행중', delayed: '⚠️ 지연', done: '✅ 완료', hold: '⏸ 보류' };
    var pct = p.progress || 0;

    var msg = '📁 <b>' + escHtml(p.name) + '</b>\n\n';
    if (p.order_no) msg += '📋 수주: <code>' + escHtml(p.order_no) + '</code>\n';
    msg += '📊 상태: ' + (statusMap[p.status] || escHtml(p.status)) + '\n';
    msg += '📈 진행률: <code>' + textBar(pct, 100, 14) + '</code> <b>' + pct + '%</b>\n';
    if (p.start_date) msg += '📅 기간: ' + p.start_date + ' ~ ' + (p.end_date || '?') + '\n';

    // 담당자
    var assignees = [];
    try { assignees = typeof p.assignees === 'string' ? JSON.parse(p.assignees) : (p.assignees || []); } catch (_) {}
    if (assignees.length > 0) msg += '👤 담당: ' + escHtml(assignees.join(', ')) + '\n';

    // 투입시간
    if (p.order_no) {
      var hoursR = await db.query(
        'SELECT COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT name) as people FROM work_records WHERE order_no = $1',
        [p.order_no]
      );
      if (hoursR.rows[0]) {
        msg += '⏱ 투입: <b>' + Math.round(parseFloat(hoursR.rows[0].hours) * 10) / 10 + 'h</b> (' + hoursR.rows[0].people + '명)\n';
      }
    }

    // 미해결 이슈
    var issueR = await db.query(
      "SELECT COUNT(*) as cnt FROM issues WHERE project_id = $1 AND status NOT IN ('resolved','closed')",
      [p.id]
    );
    var issueCnt = parseInt(issueR.rows[0].cnt);
    if (issueCnt > 0) msg += '🔴 미해결 이슈: <b>' + issueCnt + '건</b>\n';

    // 마일스톤
    var msR = await db.query(
      "SELECT name, status, end_date FROM milestones WHERE project_id = $1 ORDER BY sort_order LIMIT 8",
      [p.id]
    );
    if (msR.rows.length > 0) {
      msg += '\n<b>마일스톤</b>\n';
      msR.rows.forEach(function (m) {
        var icon = m.status === 'done' ? '✅' : m.status === 'active' ? '🔵' : '⬜';
        msg += icon + ' ' + escHtml(m.name);
        if (m.end_date) msg += ' (~ ' + m.end_date + ')';
        msg += '\n';
      });
    }

    if (p.memo) msg += '\n📝 ' + escHtml(p.memo.slice(0, 200));

    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /checklist — 체크리스트 조회 */
  async function cmdChecklist(chatId, user, query) {
    if (!query) {
      // 체크리스트가 있는 프로젝트 목록
      var listR = await db.query(
        'SELECT DISTINCT p.name, p.id, COUNT(c.id) as cl_count FROM checklists c LEFT JOIN projects p ON p.id = c.project_id GROUP BY p.id, p.name ORDER BY p.name LIMIT 15'
      );
      if (listR.rows.length === 0) {
        return sendMessage(chatId, '📋 등록된 체크리스트가 없습니다.');
      }
      var msg = '📋 <b>체크리스트 프로젝트</b>\n\n';
      listR.rows.forEach(function (r, i) {
        msg += (i + 1) + '. ' + escHtml(r.name || '(프로젝트 없음)') + ' (' + r.cl_count + '개)\n';
      });
      msg += '\n💡 상세: /checklist 프로젝트명';
      return sendMessage(chatId, msg);
    }

    var clR = await db.query(
      'SELECT c.*, p.name as project_name FROM checklists c LEFT JOIN projects p ON p.id = c.project_id WHERE p.name ILIKE $1 ORDER BY c.phase',
      ['%' + query + '%']
    );

    if (clR.rows.length === 0) {
      return sendMessage(chatId, '❌ "' + escHtml(query) + '" 체크리스트를 찾을 수 없습니다.');
    }

    var msg = '📋 <b>' + escHtml(clR.rows[0].project_name || query) + ' 체크리스트</b>\n\n';

    clR.rows.forEach(function (cl) {
      var items = [];
      try { items = typeof cl.items === 'string' ? JSON.parse(cl.items) : (cl.items || []); } catch (_) {}
      var doneCount = items.filter(function (item) { return item.done === true; }).length;
      var totalCount = items.length;
      var pct = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;

      msg += '<b>' + escHtml(cl.phase || '기타') + '</b> (' + pct + '%)\n';
      items.forEach(function (item) {
        var icon = item.done === true ? '✅' : '⬜';
        msg += icon + ' ' + escHtml(item.title || item.text || item.name || '(항목)') + '\n';
      });
      msg += '\n';
    });

    return sendMessage(chatId, msg);
  }

  /** 봇 명령어: /progress <프로젝트> — 마일스톤 진척률 + 담당자별 실작업/할당 달성률 (v13.164~165 연동) */
  async function cmdProgress(chatId, user, query) {
    if (!query) {
      // 진척 보고가 있는 진행중 프로젝트 목록 (reported_hours 또는 progress 보유)
      var listR = await db.query(
        "SELECT p.name, p.order_no, p.progress, " +
        "  COALESCE(SUM(m.reported_hours),0) AS reported " +
        "FROM projects p JOIN milestones m ON m.project_id = p.id AND m.tenant_id = p.tenant_id " +
        "WHERE p.tenant_id = $1 AND p.status NOT IN ('done') " +
        "GROUP BY p.id, p.name, p.order_no, p.progress " +
        "ORDER BY reported DESC, p.progress DESC LIMIT 12",
        [user.tenant_id]
      );
      if (listR.rows.length === 0) return sendMessage(chatId, '📈 진척 보고가 있는 프로젝트가 없습니다.');

      var msg = '📈 <b>프로젝트 진척률</b>\n\n';
      listR.rows.forEach(function (r) {
        var pct = r.progress || 0;
        msg += escHtml(r.name);
        if (r.order_no) msg += ' <code>[' + escHtml(r.order_no) + ']</code>';
        msg += '\n   <code>' + textBar(pct, 100, 10) + '</code> ' + pct + '%';
        if (parseFloat(r.reported) > 0) msg += ' · 실작업 ' + Math.round(parseFloat(r.reported) * 10) / 10 + 'h';
        msg += '\n';
      });
      msg += '\n💡 상세: <code>/progress 프로젝트명</code>';
      return sendMessage(chatId, msg);
    }

    var pR = await db.query(
      "SELECT id, name, order_no, progress FROM projects WHERE tenant_id = $1 AND (name ILIKE $2 OR order_no ILIKE $2) ORDER BY (status='done') LIMIT 1",
      [user.tenant_id, '%' + query + '%']
    );
    if (pR.rows.length === 0) return sendMessage(chatId, '❌ "' + escHtml(query) + '" 프로젝트를 찾을 수 없습니다.');
    var p = pR.rows[0];

    // 마일스톤 + 담당자 할당시간(assignee_targets)
    var msR = await db.query(
      "SELECT id, name, status, progress, reported_hours, assignee_targets, end_date " +
      "FROM milestones WHERE project_id = $1 AND tenant_id = $2 ORDER BY sort_order, end_date",
      [p.id, user.tenant_id]
    );
    if (msR.rows.length === 0) return sendMessage(chatId, '📈 "' + escHtml(p.name) + '" 프로젝트에 마일스톤이 없습니다.');

    // 담당자별 실작업시간(로그 hours 합) — 마일스톤별
    var logR = await db.query(
      "SELECT milestone_id, author_name, COALESCE(SUM(hours),0) AS h " +
      "FROM milestone_progress_logs WHERE project_id = $1 AND tenant_id = $2 AND deleted_at IS NULL " +
      "GROUP BY milestone_id, author_name",
      [p.id, user.tenant_id]
    );
    var actualByMs = {}; // ms_id → { name: hours }
    logR.rows.forEach(function (r) {
      if (!actualByMs[r.milestone_id]) actualByMs[r.milestone_id] = {};
      if (r.author_name) actualByMs[r.milestone_id][r.author_name] = parseFloat(r.h);
    });

    function statusIcon(st) { return st === 'done' ? '✅' : st === 'active' ? '🔵' : '⬜'; }
    function parseTargets(v) { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch (_) { return {}; } }

    var totalReported = 0, totalTarget = 0;
    var pct = p.progress || 0;
    var body = '';

    msR.rows.forEach(function (m) {
      var targets = parseTargets(m.assignee_targets);
      var actual = actualByMs[m.id] || {};
      var msTarget = Object.keys(targets).reduce(function (s, k) { return s + (parseFloat(targets[k]) || 0); }, 0);
      var msReported = parseFloat(m.reported_hours) || 0;
      totalReported += msReported;
      totalTarget += msTarget;
      var msRate = msTarget > 0 ? Math.round(msReported / msTarget * 1000) / 10 : null;

      body += '\n' + statusIcon(m.status) + ' <b>' + escHtml(m.name) + '</b> ' + (m.progress || 0) + '%';
      if (m.end_date) body += ' (~ ' + escHtml(m.end_date) + ')';
      body += '\n';
      body += '   실작업 ' + (Math.round(msReported * 10) / 10) + 'h';
      if (msTarget > 0) body += ' / 할당 ' + (Math.round(msTarget * 10) / 10) + 'h' + (msRate != null ? ' (' + msRate + '%)' : '');
      body += '\n';

      // 담당자별 (할당 또는 실작업이 있는 사람)
      var names = {};
      Object.keys(targets).forEach(function (k) { names[k] = true; });
      Object.keys(actual).forEach(function (k) { names[k] = true; });
      var nameList = Object.keys(names);
      if (nameList.length > 0) {
        var perLines = nameList.map(function (nm) {
          var a = actual[nm] || 0;
          var tg = parseFloat(targets[nm]) || 0;
          var over = tg > 0 && a > tg;
          var seg = escHtml(nm) + ' ' + (Math.round(a * 10) / 10) + (tg > 0 ? '/' + (Math.round(tg * 10) / 10) : '') + 'h';
          return over ? '⚠️' + seg : seg;
        });
        body += '   <code>' + perLines.join(' · ') + '</code>\n';
      }
    });

    var totalRate = totalTarget > 0 ? Math.round(totalReported / totalTarget * 1000) / 10 : null;
    var msg = '📈 <b>' + escHtml(p.name) + ' 진척률</b>\n';
    if (p.order_no) msg += '<code>[' + escHtml(p.order_no) + ']</code>\n';
    msg += '전체: <code>' + textBar(pct, 100, 12) + '</code> <b>' + pct + '%</b>\n';
    msg += '투입 실작업 ' + (Math.round(totalReported * 10) / 10) + 'h';
    if (totalTarget > 0) msg += ' / 할당 ' + (Math.round(totalTarget * 10) / 10) + 'h' + (totalRate != null ? ' (' + totalRate + '%)' : '');
    msg += '\n' + body;

    if (msg.length > 3900) msg = msg.slice(0, 3850) + '\n…(생략) — 웹에서 전체 확인';
    return sendMessage(chatId, msg);
  }

  return {
    cmdProject: cmdProject,
    cmdChecklist: cmdChecklist,
    cmdProgress: cmdProgress
  };
}

module.exports = { create: create };
