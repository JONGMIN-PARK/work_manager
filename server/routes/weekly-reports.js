var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var parser = require('../services/weekly-report-parser');

router.use(auth.authenticate);
router.use(tenant.tenantScope);
router.use(auth.requireRole('admin'));

// ─── POST /api/weekly-reports — JSON 업로드 (단건 또는 배열) ───
router.post('/', async function (req, res) {
  try {
    var payloads = Array.isArray(req.body) ? req.body : [req.body];
    var saved = [];
    for (var i = 0; i < payloads.length; i++) {
      var p = payloads[i];
      if (!p || !p.name) {
        return res.status(400).json({ error: 'VALIDATION', message: 'name 필드는 필수입니다.' });
      }
      var parsed = parser.buildParsed(p);
      var meta = parsed.meta || {};
      var savedAt = null;
      if (p.savedAt) {
        var d = new Date(p.savedAt);
        if (!isNaN(d.getTime())) savedAt = d.toISOString();
      }

      var r = await db.query(
        'INSERT INTO weekly_reports ' +
        '(tenant_id, name, team, week_label, week_start, week_end, saved_at, last_text, cur_text, parsed, uploaded_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ' +
        'ON CONFLICT (tenant_id, name) DO UPDATE SET ' +
        '  team = EXCLUDED.team, week_label = EXCLUDED.week_label, ' +
        '  week_start = EXCLUDED.week_start, week_end = EXCLUDED.week_end, ' +
        '  saved_at = EXCLUDED.saved_at, last_text = EXCLUDED.last_text, ' +
        '  cur_text = EXCLUDED.cur_text, parsed = EXCLUDED.parsed, ' +
        '  uploaded_by = EXCLUDED.uploaded_by, updated_at = now() ' +
        'RETURNING id, name, week_label, week_start, week_end, saved_at, updated_at',
        [
          req.tenant.id, p.name, meta.team || null, meta.weekLabel || null,
          meta.weekStart || null, meta.weekEnd || null, savedAt,
          p.lastText || '', p.curText || '', JSON.stringify(parsed),
          req.user.sub || null,
        ]
      );
      saved.push(r.rows[0]);
    }
    res.status(201).json({ data: saved, count: saved.length });
  } catch (e) {
    console.error('[weekly-reports/upload]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message || '서버 오류' });
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
      '       parsed->\'stats\' AS stats, updated_at, created_at ' +
      'FROM weekly_reports WHERE ' + where.join(' AND ') +
      ' ORDER BY week_start DESC NULLS LAST, name DESC LIMIT $' + idx;
    params.push(limit);
    var r = await db.query(sql, params);
    res.json({ data: r.rows });
  } catch (e) {
    console.error('[weekly-reports/list]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[weekly-reports/search]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[weekly-reports/stats]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[weekly-reports/get]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
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
    console.error('[weekly-reports/delete]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
