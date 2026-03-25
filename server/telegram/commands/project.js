/**
 * 프로젝트 명령어 모듈: /project, /checklist
 */
var db = require('../../config/db');

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
        msg += statusIcon + ' ' + r.name;
        if (r.order_no) msg += ' <code>[' + r.order_no + ']</code>';
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
    if (pR.rows.length === 0) return sendMessage(chatId, '❌ "' + query + '" 프로젝트를 찾을 수 없습니다.');

    var p = pR.rows[0];
    var statusMap = { waiting: '⏳ 대기', active: '🔵 진행중', delayed: '⚠️ 지연', done: '✅ 완료', hold: '⏸ 보류' };
    var pct = p.progress || 0;

    var msg = '📁 <b>' + p.name + '</b>\n\n';
    if (p.order_no) msg += '📋 수주: <code>' + p.order_no + '</code>\n';
    msg += '📊 상태: ' + (statusMap[p.status] || p.status) + '\n';
    msg += '📈 진행률: <code>' + textBar(pct, 100, 14) + '</code> <b>' + pct + '%</b>\n';
    if (p.start_date) msg += '📅 기간: ' + p.start_date + ' ~ ' + (p.end_date || '?') + '\n';

    // 담당자
    var assignees = [];
    try { assignees = typeof p.assignees === 'string' ? JSON.parse(p.assignees) : (p.assignees || []); } catch (_) {}
    if (assignees.length > 0) msg += '👤 담당: ' + assignees.join(', ') + '\n';

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
        msg += icon + ' ' + m.name;
        if (m.end_date) msg += ' (~ ' + m.end_date + ')';
        msg += '\n';
      });
    }

    if (p.memo) msg += '\n📝 ' + p.memo.slice(0, 200);

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
        msg += (i + 1) + '. ' + (r.name || '(프로젝트 없음)') + ' (' + r.cl_count + '개)\n';
      });
      msg += '\n💡 상세: /checklist 프로젝트명';
      return sendMessage(chatId, msg);
    }

    var clR = await db.query(
      'SELECT c.*, p.name as project_name FROM checklists c LEFT JOIN projects p ON p.id = c.project_id WHERE p.name ILIKE $1 ORDER BY c.phase',
      ['%' + query + '%']
    );

    if (clR.rows.length === 0) {
      return sendMessage(chatId, '❌ "' + query + '" 체크리스트를 찾을 수 없습니다.');
    }

    var msg = '📋 <b>' + (clR.rows[0].project_name || query) + ' 체크리스트</b>\n\n';

    clR.rows.forEach(function (cl) {
      var items = [];
      try { items = typeof cl.items === 'string' ? JSON.parse(cl.items) : (cl.items || []); } catch (_) {}
      var doneCount = items.filter(function (item) { return item.done === true; }).length;
      var totalCount = items.length;
      var pct = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;

      msg += '<b>' + (cl.phase || '기타') + '</b> (' + pct + '%)\n';
      items.forEach(function (item) {
        var icon = item.done === true ? '✅' : '⬜';
        msg += icon + ' ' + (item.title || item.text || item.name || '(항목)') + '\n';
      });
      msg += '\n';
    });

    return sendMessage(chatId, msg);
  }

  return {
    cmdProject: cmdProject,
    cmdChecklist: cmdChecklist
  };
}

module.exports = { create: create };
