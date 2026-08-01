/**
 * 프로젝트 관리 확장 명령어 — PRD Phase 3
 * /devitems (내 개발 아이템) · /prestudy (사전검토 현황) · /actions (내 액션아이템) · /meeting <프로젝트>
 * 모두 user.tenant_id 격리.
 */
var db = require('../../config/db');
var escHtml = require('../util/escape').escHtml;

var DEV_STATUS = { backlog: '📋 백로그', todo: '📝 할 일', doing: '🔵 진행', review: '🔍 검토', done: '✅ 완료' };
var DEV_CAT = { feature: '신규', improve: '개선', change: '설계변경', refactor: '리팩토링', chore: '기타' };
var DEV_PRIO = { high: '🔴', normal: '🟡', low: '🟢' };
var PS_STATUS = { idea: '💡 아이디어', reviewing: '🔍 검토중', discussing: '🤝 업체협의', proposed: '📄 견적/제안', won: '✅ 확정', hold: '⏸ 보류', dropped: '❌ 드롭' };
var PS_CAT = { inquiry: '문의', tech: '기술검토', improve: '개선제안', idea: '아이디어', quote: '견적' };
var PS_PRIO = { high: '🔴', normal: '🟡', low: '🟢' };

function create(sendMessage) {
  /** /devitems — 내 미완료 개발 아이템 (상태별) */
  async function cmdDevItems(chatId, user) {
    var r = await db.query(
      "SELECT d.title, d.status, d.category, d.priority, p.name AS project_name " +
      "FROM project_dev_items d JOIN projects p ON p.id = d.project_id AND p.tenant_id = d.tenant_id " +
      "WHERE d.tenant_id = $1 AND d.assignee_id = $2 AND d.deleted_at IS NULL AND d.status <> 'done' " +
      "ORDER BY CASE d.status WHEN 'doing' THEN 0 WHEN 'review' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END, " +
      "CASE d.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END LIMIT 30",
      [user.tenant_id, user.user_id]
    );
    if (!r.rows.length) return sendMessage(chatId, '🧩 배정된 미완료 개발 아이템이 없습니다.');

    var byStatus = {};
    r.rows.forEach(function (row) { (byStatus[row.status] = byStatus[row.status] || []).push(row); });

    var msg = '🧩 <b>내 개발 아이템</b> (' + r.rows.length + '건)\n';
    ['doing', 'review', 'todo', 'backlog'].forEach(function (st) {
      var items = byStatus[st];
      if (!items || !items.length) return;
      msg += '\n<b>' + (DEV_STATUS[st] || st) + '</b>\n';
      items.forEach(function (it) {
        msg += (DEV_PRIO[it.priority] || '🟡') + ' ' + escHtml(it.title) +
          ' <code>[' + (DEV_CAT[it.category] || '기타') + ']</code>\n' +
          '   <i>' + escHtml(it.project_name) + '</i>\n';
      });
    });
    msg += '\n💡 /actions 액션아이템 · /prestudy 사전검토';
    return sendMessage(chatId, msg);
  }

  /** /actions — 내 미완료 회의 액션아이템 (기한순) */
  async function cmdActions(chatId, user) {
    var r = await db.query(
      "SELECT a.title, a.due_date, m.title AS meeting_title, p.name AS project_name " +
      "FROM meeting_action_items a JOIN meetings m ON m.id = a.meeting_id AND m.tenant_id = a.tenant_id " +
      "LEFT JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id " +
      "WHERE a.tenant_id = $1 AND a.assignee_id = $2 AND a.status <> 'done' " +
      "ORDER BY a.due_date NULLS LAST LIMIT 30",
      [user.tenant_id, user.user_id]
    );
    if (!r.rows.length) return sendMessage(chatId, '📌 배정된 미완료 액션아이템이 없습니다.');

    var today = new Date().toISOString().slice(0, 10);
    var msg = '📌 <b>내 액션아이템</b> (' + r.rows.length + '건)\n\n';
    r.rows.forEach(function (it) {
      var overdue = it.due_date && it.due_date < today;
      msg += '· ' + escHtml(it.title);
      if (it.due_date) msg += ' <b>' + (overdue ? '⚠️ ' : '~') + escHtml(it.due_date) + '</b>';
      msg += '\n';
      var ctx = [it.project_name, it.meeting_title].filter(Boolean).map(function (s) { return escHtml(s); }).join(' · ');
      if (ctx) msg += '   <i>' + ctx + '</i>\n';
    });
    return sendMessage(chatId, msg);
  }

  /** /prestudy [<업체>] — 사전검토 현황 (진행중 우선). 업체명 주면 해당 업체 건만. */
  async function cmdPrestudy(chatId, user, query) {
    var sql = "SELECT p.title, p.client, p.status, p.category, p.priority, p.due_date, u.name AS owner_name " +
      "FROM prestudies p LEFT JOIN users u ON u.id = p.owner_id " +
      "WHERE p.deleted_at IS NULL AND p.tenant_id = $1 AND p.status NOT IN ('won','dropped')";
    var params = [user.tenant_id];
    if (query) { sql += " AND p.client ILIKE $2"; params.push('%' + query + '%'); }
    sql += " ORDER BY CASE p.status WHEN 'proposed' THEN 0 WHEN 'discussing' THEN 1 WHEN 'reviewing' THEN 2 ELSE 3 END, " +
      "p.due_date NULLS LAST LIMIT 25";
    var r = await db.query(sql, params);

    if (!r.rows.length) {
      return sendMessage(chatId, query
        ? '🔍 "' + escHtml(query) + '" 업체의 진행중 사전검토가 없습니다.'
        : '🔍 진행중인 사전검토가 없습니다.');
    }

    var today = new Date().toISOString().slice(0, 10);
    var byStatus = {};
    r.rows.forEach(function (row) { (byStatus[row.status] = byStatus[row.status] || []).push(row); });

    var msg = '🔍 <b>사전검토</b>' + (query ? ' — ' + escHtml(query) : '') + ' (' + r.rows.length + '건)\n';
    ['proposed', 'discussing', 'reviewing', 'idea', 'hold'].forEach(function (st) {
      var items = byStatus[st];
      if (!items || !items.length) return;
      msg += '\n<b>' + (PS_STATUS[st] || st) + '</b>\n';
      items.forEach(function (it) {
        var overdue = it.due_date && it.due_date < today;
        msg += (PS_PRIO[it.priority] || '🟡') + ' ';
        if (it.client) msg += '<b>' + escHtml(it.client) + '</b> ';
        msg += escHtml(it.title) + ' <code>[' + (PS_CAT[it.category] || '기타') + ']</code>';
        if (it.due_date) msg += ' ' + (overdue ? '⚠️' : '~') + escHtml(it.due_date);
        if (it.owner_name) msg += ' <i>@' + escHtml(it.owner_name) + '</i>';
        msg += '\n';
      });
    });
    msg += '\n💡 <code>/prestudy 업체명</code> 업체별 조회';
    return sendMessage(chatId, msg);
  }

  /** /meeting [<프로젝트>] — 최근 회의 회의록 요약 + 미완료 액션 */
  async function cmdMeeting(chatId, user, query) {
    if (!query) {
      // 최근 회의 목록
      var listR = await db.query(
        "SELECT m.title, m.meet_date, p.name AS project_name, " +
        "  (SELECT COUNT(*) FROM meeting_action_items a WHERE a.meeting_id = m.id AND a.status <> 'done')::int AS open_cnt " +
        "FROM meetings m LEFT JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id " +
        "WHERE m.tenant_id = $1 ORDER BY m.meet_date DESC NULLS LAST, m.created_at DESC LIMIT 10",
        [user.tenant_id]
      );
      if (!listR.rows.length) return sendMessage(chatId, '🤝 등록된 회의가 없습니다.');
      var lmsg = '🤝 <b>최근 회의</b>\n\n';
      listR.rows.forEach(function (m) {
        lmsg += '· ' + escHtml(m.title);
        if (m.meet_date) lmsg += ' <code>' + escHtml(m.meet_date) + '</code>';
        if (m.project_name) lmsg += ' — <i>' + escHtml(m.project_name) + '</i>';
        if (m.open_cnt > 0) lmsg += ' · 📌' + m.open_cnt;
        lmsg += '\n';
      });
      lmsg += '\n💡 <code>/meeting 프로젝트명</code> 상세';
      return sendMessage(chatId, lmsg);
    }

    // 특정 프로젝트 최신 회의
    var mR = await db.query(
      "SELECT m.id, m.title, m.meet_date, m.minutes, p.name AS project_name " +
      "FROM meetings m JOIN projects p ON p.id = m.project_id AND p.tenant_id = m.tenant_id " +
      "WHERE m.tenant_id = $1 AND p.name ILIKE $2 " +
      "ORDER BY m.meet_date DESC NULLS LAST, m.created_at DESC LIMIT 1",
      [user.tenant_id, '%' + query + '%']
    );
    if (!mR.rows.length) return sendMessage(chatId, '🤝 "' + escHtml(query) + '" 프로젝트의 회의를 찾을 수 없습니다.');
    var mtg = mR.rows[0];

    var aR = await db.query(
      "SELECT title, assignee_name, due_date, status FROM meeting_action_items WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY status, sort_order, created_at",
      [mtg.id, user.tenant_id]
    );

    var msg = '🤝 <b>' + escHtml(mtg.title) + '</b>\n' +
      '<i>' + escHtml(mtg.project_name) + '</i>' + (mtg.meet_date ? ' · ' + escHtml(mtg.meet_date) : '') + '\n';
    if (mtg.minutes) {
      var min = mtg.minutes.length > 500 ? mtg.minutes.slice(0, 500) + '…' : mtg.minutes;
      msg += '\n📝 ' + escHtml(min) + '\n';
    }
    if (aR.rows.length) {
      msg += '\n<b>액션아이템</b>\n';
      aR.rows.forEach(function (a) {
        msg += (a.status === 'done' ? '✅' : '☐') + ' ' + escHtml(a.title) +
          (a.assignee_name ? ' <i>@' + escHtml(a.assignee_name) + '</i>' : '') +
          (a.due_date ? ' ~' + escHtml(a.due_date) : '') + '\n';
      });
    }
    return sendMessage(chatId, msg);
  }

  return {
    cmdDevItems: cmdDevItems,
    cmdActions: cmdActions,
    cmdPrestudy: cmdPrestudy,
    cmdMeeting: cmdMeeting
  };
}

module.exports = { create: create };
