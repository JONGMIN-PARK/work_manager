/**
 * 주간업무보고 명령어 모듈: /wr, /wr-stats, /wr-me
 *
 * 웹 admin(weekly-report-admin)으로 적재된 팀 주간업무보고(weekly_reports 테이블)를
 * 텔레그램에서 조회한다. parsed JSONB 구조:
 *   { meta, cur: {sections, items}, last: {...}, stats: {cur, last} }
 *   item = { section, sectionLabel, client, name, deadline, pct, members, status, details }
 *   stats.cur = { total, byStatus:{done,in_progress,none}, byMember, byClient, bySection, avgPct }
 *
 * 개인 work_records 기반 /weekly-report(analysis.js)와는 별개 — 이쪽은 "팀 보고서" 데이터.
 */
var db = require('../../config/db');
var escHtml = require('../util/escape').escHtml;
var parseJson = require('../utils').parseJson;
var textBar = require('../utils').textBar;

/** 항목 상태 아이콘 */
var STATUS_ICON = { done: '✅', in_progress: '🔵', none: '⬜' };
/** 섹션 라벨(폴백) */
var SECTION_LABEL = { dev: '개발', setup: '셋업', cs: 'C/S', etc: '기타' };

/** parsed.stats.cur 안전 추출 */
function curStats(parsed) {
  var s = (parsed && parsed.stats && parsed.stats.cur) || {};
  return {
    total: s.total || 0,
    byStatus: s.byStatus || { done: 0, in_progress: 0, none: 0 },
    byMember: s.byMember || {},
    byClient: s.byClient || {},
    avgPct: (typeof s.avgPct === 'number') ? s.avgPct : null
  };
}

/** 완료율(%) — done / total */
function completionRate(st) {
  return st.total ? Math.round((st.byStatus.done || 0) / st.total * 1000) / 10 : 0;
}

function create(sendMessage) {
  /**
   * /wr            — 최신 주차 팀별 주간업무보고 요약
   * /wr <팀명>      — 특정 팀 최신 보고서 상세
   */
  async function cmdWeekly(chatId, user, arg) {
    if (arg) return cmdWeeklyTeam(chatId, user, arg);

    // 가장 최근 주차(week_start)의 팀별 최신 보고서 (테넌트별 1주차)
    var r = await db.query(
      "SELECT DISTINCT ON (team) id, name, team, week_label, week_start, week_end, parsed " +
      "FROM weekly_reports WHERE tenant_id = $1 AND week_start = (" +
      "  SELECT MAX(week_start) FROM weekly_reports WHERE tenant_id = $1" +
      ") ORDER BY team, updated_at DESC",
      [user.tenant_id]
    );

    if (r.rows.length === 0) {
      return sendMessage(chatId, '📋 적재된 주간업무보고가 없습니다.\n웹 → 주간업무보고에서 보고서를 업로드하세요.');
    }

    var weekLabel = r.rows[0].week_label || '';
    var msg = '📋 <b>주간업무보고</b> ' + (weekLabel ? '<code>' + escHtml(weekLabel) + '</code>' : '') + '\n\n';

    var teamCount = 0, totalItems = 0, totalDone = 0;
    r.rows.forEach(function (row) {
      var p = parseJson(row.parsed, {});
      var st = curStats(p);
      teamCount++;
      totalItems += st.total;
      totalDone += (st.byStatus.done || 0);
      var rate = completionRate(st);
      msg += '<b>' + escHtml(row.team || '(미지정)') + '</b> — ' + st.total + '건\n';
      msg += '  ✅ ' + (st.byStatus.done || 0) + ' · 🔵 ' + (st.byStatus.in_progress || 0) +
        ' · ⬜ ' + (st.byStatus.none || 0) + '  (' + rate + '%)\n';
      msg += '  <code>' + textBar(st.byStatus.done || 0, st.total || 1, 12) + '</code>\n';
    });

    var allRate = totalItems ? Math.round(totalDone / totalItems * 1000) / 10 : 0;
    msg += '\n📊 전체 ' + teamCount + '팀 · ' + totalItems + '건 · 완료율 <b>' + allRate + '%</b>\n';
    msg += '\n💡 <code>/wr 팀명</code> 상세 · /wr-stats 추이 · /wr-me 내 항목';
    return sendMessage(chatId, msg);
  }

  /** /wr <팀명> — 특정 팀 최신 보고서 상세 (섹션별 항목) */
  async function cmdWeeklyTeam(chatId, user, teamArg) {
    var r = await db.query(
      "SELECT id, name, team, week_label, week_start, week_end, parsed " +
      "FROM weekly_reports WHERE tenant_id = $1 AND team ILIKE $2 " +
      "ORDER BY week_start DESC NULLS LAST, updated_at DESC LIMIT 1",
      [user.tenant_id, '%' + teamArg + '%']
    );

    if (r.rows.length === 0) {
      return sendMessage(chatId, '📋 "' + escHtml(teamArg) + '" 팀의 주간업무보고를 찾을 수 없습니다.\n/wr 로 팀 목록을 확인하세요.');
    }

    var row = r.rows[0];
    var p = parseJson(row.parsed, {});
    var sections = (p.cur && p.cur.sections) || [];
    var st = curStats(p);

    var msg = '📋 <b>' + escHtml(row.team || '(미지정)') + ' 주간업무보고</b>\n';
    msg += '<code>' + escHtml(row.week_label || '') + '</code>\n';
    msg += '✅ ' + (st.byStatus.done || 0) + ' · 🔵 ' + (st.byStatus.in_progress || 0) +
      ' · ⬜ ' + (st.byStatus.none || 0) + ' / 총 ' + st.total + '건 (' + completionRate(st) + '%)\n';

    if (sections.length === 0) {
      msg += '\n(항목이 없습니다.)';
      return sendMessage(chatId, msg);
    }

    sections.forEach(function (sec) {
      var items = sec.items || [];
      if (items.length === 0) return;
      msg += '\n<b>[' + escHtml(sec.label || SECTION_LABEL[sec.type] || sec.type) + ']</b>\n';
      items.forEach(function (it) {
        var icon = STATUS_ICON[it.status] || '⬜';
        var line = icon + ' ';
        if (it.client) line += '<b>' + escHtml(it.client) + '</b> ';
        line += escHtml(it.name || '');
        if (typeof it.pct === 'number' && it.pct >= 0) line += ' ' + it.pct + '%';
        if (it.deadline) line += ' (' + escHtml(it.deadline) + ')';
        var mem = it.members || [];
        if (mem.length) line += ' 👤' + escHtml(mem.join(','));
        msg += '  ' + line + '\n';
      });
    });

    // 텔레그램 메시지 길이 제한(4096) 방어
    if (msg.length > 3900) msg = msg.slice(0, 3850) + '\n…(생략) — 웹에서 전체 확인';
    return sendMessage(chatId, msg);
  }

  /** /wr-stats — 최근 주차별 완료율 추이 + 인원 Top */
  async function cmdWeeklyStats(chatId, user) {
    // 최근 8주차 (week_label 기준, 팀 합산)
    var r = await db.query(
      "SELECT week_label, week_start, parsed->'stats'->'cur' AS stats " +
      "FROM weekly_reports WHERE tenant_id = $1 AND week_start IS NOT NULL " +
      "ORDER BY week_start DESC, updated_at DESC LIMIT 40",
      [user.tenant_id]
    );

    if (r.rows.length === 0) {
      return sendMessage(chatId, '📊 집계할 주간업무보고가 없습니다.');
    }

    // 주차별 합산
    var byWeek = {}; // week_label → { order, total, done, members:{} }
    r.rows.forEach(function (row) {
      var s = parseJson(row.stats, {});
      var wl = row.week_label || row.week_start || '?';
      if (!byWeek[wl]) byWeek[wl] = { ws: row.week_start, total: 0, done: 0, members: {} };
      var bs = s.byStatus || {};
      byWeek[wl].total += s.total || 0;
      byWeek[wl].done += bs.done || 0;
      var bm = s.byMember || {};
      Object.keys(bm).forEach(function (k) { byWeek[wl].members[k] = (byWeek[wl].members[k] || 0) + bm[k]; });
    });

    var weeks = Object.keys(byWeek).map(function (wl) {
      return { label: wl, ws: byWeek[wl].ws, total: byWeek[wl].total, done: byWeek[wl].done, members: byWeek[wl].members };
    }).sort(function (a, b) { return String(b.ws).localeCompare(String(a.ws)); }).slice(0, 8);

    var msg = '📊 <b>주간업무보고 추이</b> (최근 ' + weeks.length + '주)\n\n';
    msg += '<b>주차별 완료율</b>\n';
    weeks.slice().reverse().forEach(function (w) {
      var rate = w.total ? Math.round(w.done / w.total * 1000) / 10 : 0;
      msg += '<code>' + textBar(w.done, w.total || 1, 10) + '</code> ' + escHtml(w.label) +
        ' ' + w.done + '/' + w.total + ' (' + rate + '%)\n';
    });

    // 최신 주차 인원별 Top
    var latest = weeks[0];
    if (latest && latest.members && Object.keys(latest.members).length) {
      var ranked = Object.keys(latest.members)
        .map(function (k) { return { name: k, c: latest.members[k] }; })
        .sort(function (a, b) { return b.c - a.c; }).slice(0, 8);
      var maxC = ranked[0].c;
      msg += '\n<b>인원별 항목 (' + escHtml(latest.label) + ')</b>\n';
      ranked.forEach(function (m) {
        msg += '<code>' + textBar(m.c, maxC, 8) + '</code> ' + escHtml(m.name) + ' ' + m.c + '건\n';
      });
    }

    msg += '\n💡 /wr 팀별 현황 · /wr-me 내 항목';
    return sendMessage(chatId, msg);
  }

  /** /wr-me — 최신 주차 보고서에서 내 이름이 들어간 항목 */
  async function cmdWeeklyMine(chatId, user) {
    var r = await db.query(
      "SELECT team, week_label, week_start, parsed FROM weekly_reports " +
      "WHERE tenant_id = $1 AND week_start = (" +
      "  SELECT MAX(week_start) FROM weekly_reports WHERE tenant_id = $1" +
      ") ORDER BY team",
      [user.tenant_id]
    );

    if (r.rows.length === 0) {
      return sendMessage(chatId, '📋 적재된 주간업무보고가 없습니다.');
    }

    var weekLabel = r.rows[0].week_label || '';
    var mine = []; // {team, item}
    r.rows.forEach(function (row) {
      var p = parseJson(row.parsed, {});
      var items = (p.cur && p.cur.items) || [];
      items.forEach(function (it) {
        var mem = it.members || [];
        if (mem.indexOf(user.name) >= 0) mine.push({ team: row.team, item: it });
      });
    });

    if (mine.length === 0) {
      return sendMessage(chatId, '📋 <b>' + escHtml(weekLabel) + '</b> 주간업무보고에서\n' +
        escHtml(user.name) + '님의 담당 항목이 없습니다.');
    }

    var done = mine.filter(function (m) { return m.item.status === 'done'; }).length;
    var msg = '📋 <b>' + escHtml(user.name) + '님 주간업무보고</b>\n';
    msg += '<code>' + escHtml(weekLabel) + '</code> — ' + mine.length + '건 (완료 ' + done + ')\n\n';

    mine.forEach(function (m) {
      var it = m.item;
      var icon = STATUS_ICON[it.status] || '⬜';
      var line = icon + ' ';
      if (it.client) line += '<b>' + escHtml(it.client) + '</b> ';
      line += escHtml(it.name || '');
      if (typeof it.pct === 'number' && it.pct >= 0) line += ' ' + it.pct + '%';
      if (it.deadline) line += ' (' + escHtml(it.deadline) + ')';
      msg += line + '\n';
    });

    if (msg.length > 3900) msg = msg.slice(0, 3850) + '\n…(생략)';
    return sendMessage(chatId, msg);
  }

  return {
    cmdWeekly: cmdWeekly,
    cmdWeeklyStats: cmdWeeklyStats,
    cmdWeeklyMine: cmdWeeklyMine
  };
}

module.exports = { create: create };
