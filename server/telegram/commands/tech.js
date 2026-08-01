/**
 * 요소기술 명령어 — PRD_요소기술_개발관리 Phase 3
 * /tech [<키워드>] · /techlog <기술명> · /mytech
 * 모두 user.tenant_id 격리.
 */
var db = require('../../config/db');
var escHtml = require('../util/escape').escHtml;
var parseJson = require('../utils').parseJson;

var T_STATUS = { research: '🔬 연구', developing: '🛠 개발', verifying: '🧪 검증', available: '✅ 사용가능', deprecated: '⚠️ 폐기예정' };
var T_CAT = { vision: '비전', motion: '모션', control: '제어', sw: 'SW', ai: 'AI', comm: '통신', mech: '기구', etc: '기타' };
var T_LOG_KIND = { dev: '🛠', test: '🧪', issue: '🔴', doc: '📄', review: '🔍', idea: '💡' };

/** TRL 1~9 → 3구간 요약 */
function trlDot(n) {
  var t = parseInt(n, 10) || 1;
  return t >= 7 ? '🟢' : (t >= 4 ? '🟡' : '🔴');
}
/** 스택 요약 (최대 4개) */
function stackSummary(stack) {
  var arr = parseJson(stack, []);
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.slice(0, 4).map(function (s) {
    return escHtml((s.name || '') + (s.version ? ' ' + s.version : ''));
  }).join(', ') + (arr.length > 4 ? ' 외 ' + (arr.length - 4) : '');
}

function create(sendMessage) {
  /**
   * /tech            — 사용가능·진행중 기술 카탈로그 요약 (상태별)
   * /tech <키워드>    — 기술명·코드·스택 검색 ("opencv 쓰는 기술 뭐 있지?")
   */
  async function cmdTech(chatId, user, query) {
    var sql = "SELECT t.code, t.name, t.category, t.status, t.trl, t.tech_version, t.stack, t.progress, " +
      "  u.name AS owner_name " +
      "FROM tech_assets t LEFT JOIN users u ON u.id = t.owner_id " +
      "WHERE t.deleted_at IS NULL AND t.tenant_id = $1";
    var params = [user.tenant_id];
    if (query) {
      // 이름·코드·요약·스택(JSONB 텍스트) 전반 검색
      sql += " AND (t.name ILIKE $2 OR t.code ILIKE $2 OR t.summary ILIKE $2 OR t.stack::text ILIKE $2)";
      params.push('%' + query + '%');
    } else {
      sql += " AND t.status <> 'deprecated'";
    }
    sql += " ORDER BY CASE t.status WHEN 'available' THEN 0 WHEN 'verifying' THEN 1 WHEN 'developing' THEN 2 " +
      "WHEN 'research' THEN 3 ELSE 4 END, t.name LIMIT 30";
    var r = await db.query(sql, params);

    if (!r.rows.length) {
      return sendMessage(chatId, query
        ? '🧪 "' + escHtml(query) + '" 로 찾은 요소기술이 없습니다.'
        : '🧪 등록된 요소기술이 없습니다.');
    }

    var byStatus = {};
    r.rows.forEach(function (row) { (byStatus[row.status] = byStatus[row.status] || []).push(row); });

    var msg = '🧪 <b>요소기술</b>' + (query ? ' — "' + escHtml(query) + '"' : '') + ' (' + r.rows.length + '건)\n';
    ['available', 'verifying', 'developing', 'research', 'deprecated'].forEach(function (st) {
      var items = byStatus[st];
      if (!items || !items.length) return;
      msg += '\n<b>' + (T_STATUS[st] || st) + '</b>\n';
      items.forEach(function (t) {
        msg += trlDot(t.trl) + ' ';
        if (t.code) msg += '<code>' + escHtml(t.code) + '</code> ';
        msg += '<b>' + escHtml(t.name) + '</b>';
        if (t.tech_version) msg += ' ' + escHtml(t.tech_version);
        msg += ' <i>' + (T_CAT[t.category] || '기타') + '</i>\n';
        var sk = stackSummary(t.stack);
        if (sk) msg += '   <code>' + sk + '</code>\n';
      });
    });
    msg += '\n💡 <code>/tech opencv</code> 스택 검색 · /techlog 기술명 · /mytech';
    return sendMessage(chatId, msg);
  }

  /** /techlog <기술명> — 최근 개발일지 */
  async function cmdTechLog(chatId, user, query) {
    if (!query) return sendMessage(chatId, '📓 사용법: <code>/techlog 기술명</code>');

    var tR = await db.query(
      "SELECT id, code, name, status, progress, total_hours FROM tech_assets " +
      "WHERE deleted_at IS NULL AND tenant_id = $1 AND (name ILIKE $2 OR code ILIKE $2) " +
      "ORDER BY name LIMIT 1",
      [user.tenant_id, '%' + query + '%']
    );
    if (!tR.rows.length) return sendMessage(chatId, '🧪 "' + escHtml(query) + '" 기술을 찾을 수 없습니다.');
    var t = tR.rows[0];

    var lR = await db.query(
      "SELECT log_date, kind, author_name, progress, hours, content FROM tech_logs " +
      "WHERE tech_id = $1 AND tenant_id = $2 AND deleted_at IS NULL " +
      "ORDER BY log_date DESC NULLS LAST, created_at DESC LIMIT 8",
      [t.id, user.tenant_id]
    );

    var msg = '📓 <b>' + escHtml(t.name) + '</b>';
    if (t.code) msg += ' <code>' + escHtml(t.code) + '</code>';
    msg += '\n' + (T_STATUS[t.status] || t.status) + ' · 진척 ' + (t.progress || 0) + '%' +
      (parseFloat(t.total_hours) > 0 ? ' · 누적 ' + (Math.round(parseFloat(t.total_hours) * 10) / 10) + 'h' : '') + '\n';

    if (!lR.rows.length) {
      msg += '\n아직 개발일지가 없습니다.';
      return sendMessage(chatId, msg);
    }

    lR.rows.forEach(function (lg) {
      msg += '\n' + (T_LOG_KIND[lg.kind] || '🛠') + ' <b>' + escHtml(lg.log_date || '') + '</b>';
      if (lg.author_name) msg += ' · ' + escHtml(lg.author_name);
      if (lg.progress) msg += ' · ' + lg.progress + '%';
      if (parseFloat(lg.hours) > 0) msg += ' · ' + (Math.round(parseFloat(lg.hours) * 10) / 10) + 'h';
      msg += '\n';
      if (lg.content) {
        var body = String(lg.content);
        if (body.length > 200) body = body.slice(0, 200) + '…';
        msg += escHtml(body) + '\n';
      }
    });

    if (msg.length > 3900) msg = msg.slice(0, 3850) + '\n…(생략) — 웹에서 전체 확인';
    return sendMessage(chatId, msg);
  }

  /** /mytech — 내가 담당인 요소기술 + 진척률 */
  async function cmdMyTech(chatId, user) {
    var r = await db.query(
      "SELECT t.code, t.name, t.status, t.trl, t.progress, t.total_hours, " +
      "  (SELECT MAX(log_date) FROM tech_logs l WHERE l.tech_id = t.id AND l.deleted_at IS NULL) AS last_log " +
      "FROM tech_assets t " +
      "WHERE t.deleted_at IS NULL AND t.tenant_id = $1 AND t.owner_id = $2 AND t.status <> 'deprecated' " +
      "ORDER BY CASE t.status WHEN 'developing' THEN 0 WHEN 'verifying' THEN 1 WHEN 'research' THEN 2 ELSE 3 END, t.name LIMIT 25",
      [user.tenant_id, user.user_id]
    );
    if (!r.rows.length) return sendMessage(chatId, '🧪 담당인 요소기술이 없습니다.');

    var msg = '🧪 <b>내 요소기술</b> (' + r.rows.length + '건)\n\n';
    r.rows.forEach(function (t) {
      msg += trlDot(t.trl) + ' ';
      if (t.code) msg += '<code>' + escHtml(t.code) + '</code> ';
      msg += '<b>' + escHtml(t.name) + '</b> — ' + (T_STATUS[t.status] || t.status) + '\n';
      msg += '   진척 ' + (t.progress || 0) + '%';
      if (parseFloat(t.total_hours) > 0) msg += ' · ' + (Math.round(parseFloat(t.total_hours) * 10) / 10) + 'h';
      msg += t.last_log ? ' · 최근일지 ' + escHtml(t.last_log) : ' · <i>일지 없음</i>';
      msg += '\n';
    });
    msg += '\n💡 <code>/techlog 기술명</code> 개발일지 확인';
    return sendMessage(chatId, msg);
  }

  return {
    cmdTech: cmdTech,
    cmdTechLog: cmdTechLog,
    cmdMyTech: cmdMyTech
  };
}

module.exports = { create: create };
