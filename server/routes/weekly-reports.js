var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var parser = require('../services/weekly-report-parser');
var notificationService = require('../services/notification.service');
var httpErr = require('../lib/http-errors');
var changeDiff = require('../lib/change-diff');

var WR_MAX_CHANGES = 20;

/**
 * 주간업무보고 업로드 알림 — 테넌트 관리자/팀장 + 보고서에 언급된 멤버에게 발송.
 * 응답을 막지 않도록 fire-and-forget. (테넌트 격리: 수신자 모두 같은 tenant)
 */
async function notifyWeeklyReportUploads(tenantId, savedReports, uploaderName) {
  try {
    // 테넌트 활성 사용자 이름→id 맵 (멤버 매칭) + 관리자/팀장 id
    var uR = await db.query(
      "SELECT id, name, role FROM users WHERE tenant_id = $1 AND status = 'active'",
      [tenantId]
    );
    var nameToId = {};
    var adminIds = [];
    uR.rows.forEach(function (u) {
      if (u.name) nameToId[u.name] = u.id;
      if (u.role === 'admin' || u.role === 'manager' || u.role === 'executive') adminIds.push(u.id);
    });

    for (var i = 0; i < savedReports.length; i++) {
      var rep = savedReports[i];
      var parsed = rep.parsed || {};
      var stats = (parsed.stats && parsed.stats.cur) || {};
      var byStatus = stats.byStatus || {};
      var memberNames = Object.keys((stats.byMember) || {});

      var recipients = {};
      adminIds.forEach(function (id) { recipients[id] = true; });
      memberNames.forEach(function (nm) { if (nameToId[nm]) recipients[nameToId[nm]] = true; });
      var ids = Object.keys(recipients);
      if (!ids.length) continue;

      // v13.215: 이전 저장본(같은 이름 덮어쓰기, 없으면 같은 팀·주차의 최신 버전)과 업무 단위 비교
      var first = !rep.prevItems;
      var changes = changeDiff.diffWeeklyItems(rep.prevItems || [], (parsed.cur && parsed.cur.items) || []);
      if (!first && !changes.length) continue; // 내용 그대로 다시 저장 — 알림 생략

      await notificationService.notify('weekly_report_uploaded', {
        team: (parsed.meta && parsed.meta.team) || rep.team || null,
        weekLabel: (parsed.meta && parsed.meta.weekLabel) || rep.week_label || null,
        count: stats.total || 0,
        done: byStatus.done != null ? byStatus.done : null,
        uploader: uploaderName || null,
        first: first,
        changes: changes.slice(0, WR_MAX_CHANGES),
        more: Math.max(0, changes.length - WR_MAX_CHANGES)
      }, ids);
    }
  } catch (e) {
    console.error('[weekly-reports/notify]', e.message);
  }
}

router.use(auth.authenticate);
router.use(tenant.tenantScope);
router.use(auth.requireRole('admin'));

// 저장 시각 — ISO 또는 예전 도구가 쓰던 '2026. 4. 24. 오후 3:12:05'(ko-KR). 못 읽으면 지금
function parseSavedAt(v) {
  if (v) {
    var d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
    var m = String(v).match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(오전|오후)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      var h = parseInt(m[5], 10);
      if (m[4]) h = h % 12 + (m[4] === '오후' ? 12 : 0);
      var p2 = function (n) { return String(n).padStart(2, '0'); };
      var k = new Date(m[1] + '-' + p2(m[2]) + '-' + p2(m[3]) + 'T' + p2(h) + ':' + m[6] + ':' + (m[7] || '00') + '+09:00');
      if (!isNaN(k.getTime())) return k.toISOString();
    }
  }
  return new Date().toISOString();
}

var INSERT_SQL = 'INSERT INTO weekly_reports ' +
  '(tenant_id, name, team, week_label, week_start, week_end, saved_at, last_text, cur_text, parsed, uploaded_by) ' +
  'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ';
var UPSERT_SET = 'ON CONFLICT (tenant_id, name) DO UPDATE SET ' +
  '  team = EXCLUDED.team, week_label = EXCLUDED.week_label, ' +
  '  week_start = EXCLUDED.week_start, week_end = EXCLUDED.week_end, ' +
  '  saved_at = EXCLUDED.saved_at, last_text = EXCLUDED.last_text, ' +
  '  cur_text = EXCLUDED.cur_text, parsed = EXCLUDED.parsed, ' +
  '  uploaded_by = EXCLUDED.uploaded_by, updated_at = now(), version = weekly_reports.version + 1 ';
var RETURNING = 'RETURNING id, name, team, week_label, week_start, week_end, saved_at, updated_at, version';

function rowParams(req, name, p, parsed) {
  var meta = parsed.meta || {};
  return [
    req.tenant.id, name, meta.team || null, meta.weekLabel || null,
    meta.weekStart || null, meta.weekEnd || null, parseSavedAt(p.savedAt),
    p.lastText || '', p.curText || '', JSON.stringify(parsed),
    req.user.sub || null,
  ];
}

/**
 * 새 버전 저장 — 이름(팀_주차_기간_R{n})을 서버가 정한다. 예전엔 next-name 으로 이름을 받은 뒤 따로 저장해
 * 두 사람이 거의 동시에 저장하면 같은 R 번호로 서로 덮어썼다. 이제 비어 있는 번호에만 넣고, 겹치면 다음 번호로.
 */
async function insertNewVersion(req, p) {
  var a = p.autoName || {};
  var team = String(a.team || '').trim();
  var np = parser.namePrefix(team, a.weekStart, a.weekEnd);
  if (!team || !np) return { error: 'team · weekStart · weekEnd(YYYY-MM-DD) 가 필요합니다.' };
  var ex = await db.query(
    'SELECT name FROM weekly_reports WHERE tenant_id = $1 AND team = $2 AND week_start = $3',
    [req.tenant.id, team, a.weekStart]
  );
  var maxR = 0;
  ex.rows.forEach(function (row) {
    var m = String(row.name).match(/_R(\d+)\b/);
    if (m) maxR = Math.max(maxR, parseInt(m[1], 10));
  });
  for (var n = maxR + 1; n <= maxR + 20; n++) {
    var name = np.prefix + '_R' + n;
    var parsed = parser.buildParsed({ name: name, lastText: p.lastText, curText: p.curText });
    var ins = await db.query(INSERT_SQL + 'ON CONFLICT (tenant_id, name) DO NOTHING ' + RETURNING, rowParams(req, name, p, parsed));
    if (ins.rows.length) return { row: ins.rows[0], parsed: parsed };
  }
  return { error: '저장할 이름을 정하지 못했습니다. 다시 시도해 주세요.' };
}

// ─── POST /api/weekly-reports — JSON 업로드 (단건 또는 배열) ───
//   { name, lastText, curText, savedAt }             같은 이름이면 덮어씀 (파일 업로드)
//   { name, baseVersion, ... }                      작성 화면 덮어쓰기 — 그 사이 누가 저장했으면 409
//   { autoName: { team, weekStart, weekEnd }, ... }  작성 화면 새 버전 — R 번호는 서버가 정함
router.post('/', async function (req, res) {
  try {
    var payloads = Array.isArray(req.body) ? req.body : [req.body];
    var saved = [];
    var savedForNotify = [];
    for (var i = 0; i < payloads.length; i++) {
      var p = payloads[i];
      if (!p || (!p.name && !p.autoName)) {
        return res.status(400).json({ error: 'VALIDATION', message: 'name 필드는 필수입니다.' });
      }
      var row = null, parsed;
      if (p.autoName) {
        var nv = await insertNewVersion(req, p);
        if (nv.error) return res.status(400).json({ error: 'VALIDATION', message: nv.error });
        row = nv.row; parsed = nv.parsed;
      } else {
        parsed = parser.buildParsed(p);
      }
      var meta = parsed.meta || {};
      var name = row ? row.name : p.name;

      // 알림 비교용 이전 저장본 — 같은 이름(덮어쓰기) 우선, 없으면 같은 팀·주차의 가장 최근 버전 (방금 넣은 새 버전은 빼고)
      var prevR = await db.query(
        "SELECT parsed->'cur'->'items' AS items FROM weekly_reports " +
        'WHERE tenant_id = $1 AND ($5::uuid IS NULL OR id <> $5) ' +
        '  AND (name = $2 OR ($3::text IS NOT NULL AND team = $3 AND week_start = $4)) ' +
        'ORDER BY (name = $2) DESC, updated_at DESC NULLS LAST LIMIT 1',
        [req.tenant.id, name, meta.team || null, meta.weekStart || null, row ? row.id : null]
      );

      if (!row) {
        var base = p.baseVersion != null ? parseInt(p.baseVersion, 10) : NaN;
        var guarded = !isNaN(base);
        var r = await db.query(
          INSERT_SQL + UPSERT_SET + (guarded ? 'WHERE weekly_reports.version = $12 ' : '') + RETURNING,
          rowParams(req, name, p, parsed).concat(guarded ? [base] : [])
        );
        if (!r.rows.length) {
          // 불러온 뒤 다른 사람이 저장함 — 덮어쓰지 않고 알린다
          var cur = await db.query(
            'SELECT w.version, w.updated_at, u.name AS by_name FROM weekly_reports w LEFT JOIN users u ON u.id = w.uploaded_by ' +
            'WHERE w.tenant_id = $1 AND w.name = $2',
            [req.tenant.id, name]
          );
          var c = cur.rows[0] || {};
          return res.status(409).json({
            error: 'CONFLICT',
            message: (c.by_name || '다른 사용자') + ' 님이 그 사이 이 보고서를 저장했습니다.',
            data: { version: c.version || null, updated_at: c.updated_at || null, by: c.by_name || null },
          });
        }
        row = r.rows[0];
      }
      saved.push(row);
      savedForNotify.push({
        team: row.team || meta.team || null,
        week_label: row.week_label || meta.weekLabel || null,
        parsed: parsed,
        prevItems: prevR.rows.length ? (prevR.rows[0].items || []) : null
      });
    }
    res.status(201).json({ data: saved, count: saved.length });

    // 업로드 알림 (응답 후 fire-and-forget)
    notifyWeeklyReportUploads(req.tenant.id, savedForNotify, req.user && req.user.name)
      .catch(function (e) { console.error('[weekly-reports/notify]', e.message); });
  } catch (e) {
    httpErr.serverError(res, '[weekly-reports/upload]', e, '서버 오류가 발생했습니다.');
  }
});

// ─── GET /api/weekly-reports — 목록 (메타만) ───
router.get('/', async function (req, res) {
  try {
    var where = ['tenant_id = $1'];
    var params = [req.tenant.id];
    var idx = 2;
    if (req.query.team) { where.push('team = $' + idx++); params.push(req.query.team); }
    if (req.query.from) { where.push('week_start >= $' + idx++); params.push(req.query.from); }
    if (req.query.to)   { where.push('week_start <= $' + idx++); params.push(req.query.to); }
    var limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    var sql =
      'SELECT id, name, team, week_label, week_start, week_end, saved_at, ' +
      '       parsed->\'stats\' AS stats, updated_at, created_at, version ' +
      'FROM weekly_reports WHERE ' + where.join(' AND ') +
      // name DESC 는 _R9 를 _R10 보다 앞에 둬서 '가장 최근 버전'이 어긋났다 → 저장 시각 순
      ' ORDER BY week_start DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT $' + idx;
    params.push(limit);
    var r = await db.query(sql, params);
    res.json({ data: r.rows });
  } catch (e) {
    httpErr.serverError(res, '[weekly-reports/list]', e);
  }
});

// ─── GET /api/weekly-reports/next-name — 팀/주차 기반 자동 파일명 (다음 R 버전) ───
router.get('/next-name', async function (req, res) {
  try {
    var team = req.query.team || '';
    var weekStart = req.query.weekStart;
    var weekEnd = req.query.weekEnd;
    if (!team || !weekStart || !weekEnd) {
      return res.status(400).json({ error: 'VALIDATION', message: 'team/weekStart/weekEnd 필요' });
    }
    // ISO 주차 — 공용 파서와 같은 계산 (예전엔 해를 시작일 기준으로 붙여 2024-12-30 주가 24W01 이 됐다)
    var np = parser.namePrefix(team, weekStart, weekEnd);
    if (!np) return res.status(400).json({ error: 'VALIDATION', message: 'weekStart/weekEnd 형식: YYYY-MM-DD' });
    var weekLabel = np.weekLabel, prefix = np.prefix;

    var r = await db.query(
      "SELECT name FROM weekly_reports WHERE tenant_id = $1 AND team = $2 AND week_start = $3",
      [req.tenant.id, team, weekStart]
    );
    var maxR = 0;
    r.rows.forEach(function (row) {
      var m = String(row.name).match(/_R(\d+)\b/);
      if (m) { var n = parseInt(m[1], 10); if (n > maxR) maxR = n; }
    });
    var nextR = maxR + 1;
    res.json({
      data: {
        weekLabel: weekLabel,
        prefix: prefix,
        currentMaxR: maxR,
        nextR: nextR,
        nextName: prefix + '_R' + nextR,
        existing: r.rows.map(function (x) { return x.name; })
      }
    });
  } catch (e) {
    httpErr.serverError(res, '[weekly-reports/next-name]', e);
  }
});

// ─── GET /api/weekly-reports/search — 항목 단위 검색 ───
router.get('/search', async function (req, res) {
  try {
    var q = req.query;
    var where = ['tenant_id = $1'];
    var params = [req.tenant.id];
    var idx = 2;
    if (q.team)   { where.push('team = $' + idx++); params.push(q.team); }
    if (q.from)   { where.push('week_start >= $' + idx++); params.push(q.from); }
    if (q.to)     { where.push('week_start <= $' + idx++); params.push(q.to); }
    if (q.q) {
      where.push('(cur_text ILIKE $' + idx + ' OR last_text ILIKE $' + idx + ')');
      params.push('%' + q.q + '%');
      idx++;
    }
    var pane = q.pane === 'last' ? 'last' : 'cur';
    var sql =
      'SELECT id, name, team, week_label, week_start, week_end, ' +
      '       parsed->$' + idx + '->\'items\' AS items ' +
      'FROM weekly_reports WHERE ' + where.join(' AND ') +
      ' ORDER BY week_start DESC NULLS LAST, name DESC';
    params.push(pane);
    var r = await db.query(sql, params);

    // 항목 단위로 펼치기 + 클라이언트 사이드 필터(소량 데이터)
    var assignee = q.assignee || '';
    var status = q.status || '';
    var client = q.client || '';
    var section = q.section || '';
    var keyword = (q.q || '').toLowerCase();

    var matches = [];
    for (var i = 0; i < r.rows.length; i++) {
      var row = r.rows[i];
      var items = row.items || [];
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (assignee && (it.members || []).indexOf(assignee) < 0) continue;
        if (status && it.status !== status) continue;
        if (client && it.client !== client) continue;
        if (section && it.section !== section) continue;
        if (keyword) {
          var hay = ((it.client || '') + ' ' + (it.name || '') + ' ' +
            (it.details || []).map(function (d) { return d.text; }).join(' ')).toLowerCase();
          if (hay.indexOf(keyword) < 0) continue;
        }
        matches.push({
          report_id: row.id,
          name: row.name,
          team: row.team,
          week_label: row.week_label,
          week_start: row.week_start,
          week_end: row.week_end,
          item: it,
        });
      }
    }
    res.json({ data: matches, total: matches.length });
  } catch (e) {
    httpErr.serverError(res, '[weekly-reports/search]', e);
  }
});

// ─── GET /api/weekly-reports/stats — 집계 ───
router.get('/stats', async function (req, res) {
  try {
    var q = req.query;
    var where = ['tenant_id = $1'];
    var params = [req.tenant.id];
    var idx = 2;
    if (q.team) { where.push('team = $' + idx++); params.push(q.team); }
    if (q.from) { where.push('week_start >= $' + idx++); params.push(q.from); }
    if (q.to)   { where.push('week_start <= $' + idx++); params.push(q.to); }

    var sql =
      'SELECT id, name, team, week_label, week_start, week_end, parsed->\'stats\' AS stats ' +
      'FROM weekly_reports WHERE ' + where.join(' AND ') +
      ' ORDER BY week_start ASC NULLS LAST, name ASC';
    var r = await db.query(sql, params);

    var weekly = [];
    var totalByMember = {};
    var totalByClient = {};
    var totalByStatus = { done: 0, in_progress: 0, none: 0 };
    var totalItems = 0;

    for (var i = 0; i < r.rows.length; i++) {
      var row = r.rows[i];
      var s = (row.stats && row.stats.cur) || { byStatus: {}, byMember: {}, byClient: {}, total: 0, avgPct: null };
      var done = s.byStatus && s.byStatus.done || 0;
      var inP = s.byStatus && s.byStatus.in_progress || 0;
      var total = s.total || 0;
      weekly.push({
        report_id: row.id,
        week_label: row.week_label,
        week_start: row.week_start,
        team: row.team,
        total: total,
        done: done,
        in_progress: inP,
        completion_rate: total ? Math.round((done / total) * 1000) / 10 : 0,
        avg_pct: s.avgPct,
      });
      totalItems += total;
      totalByStatus.done += done;
      totalByStatus.in_progress += inP;
      totalByStatus.none += s.byStatus && s.byStatus.none || 0;
      var bm = s.byMember || {};
      Object.keys(bm).forEach(function (k) { totalByMember[k] = (totalByMember[k] || 0) + bm[k]; });
      var bc = s.byClient || {};
      Object.keys(bc).forEach(function (k) { totalByClient[k] = (totalByClient[k] || 0) + bc[k]; });
    }

    function toRanked(obj) {
      return Object.keys(obj)
        .map(function (k) { return { key: k, count: obj[k] }; })
        .sort(function (a, b) { return b.count - a.count; });
    }

    res.json({
      data: {
        weekly: weekly,
        totals: {
          weeks: weekly.length,
          items: totalItems,
          byStatus: totalByStatus,
          completion_rate: totalItems ? Math.round((totalByStatus.done / totalItems) * 1000) / 10 : 0,
        },
        byMember: toRanked(totalByMember),
        byClient: toRanked(totalByClient),
      }
    });
  } catch (e) {
    httpErr.serverError(res, '[weekly-reports/stats]', e);
  }
});

// ─── GET /api/weekly-reports/:id — 상세 ───
router.get('/:id', async function (req, res) {
  try {
    var r = await db.query(
      'SELECT * FROM weekly_reports WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '없습니다.' });
    res.json({ data: r.rows[0] });
  } catch (e) {
    httpErr.serverError(res, '[weekly-reports/get]', e);
  }
});

// ─── DELETE /api/weekly-reports/:id ───
router.delete('/:id', async function (req, res) {
  try {
    var r = await db.query(
      'DELETE FROM weekly_reports WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [req.params.id, req.tenant.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '없습니다.' });
    res.json({ data: { id: r.rows[0].id }, message: '삭제되었습니다.' });
  } catch (e) {
    httpErr.serverError(res, '[weekly-reports/delete]', e);
  }
});

module.exports = router;
