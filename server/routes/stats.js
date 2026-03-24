var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');

router.use(auth.authenticate);

// ═══ GET /api/stats/summary ═══
// 기간별 전체 요약 (총 시간, 인원수, 수주수, 업무분장 분포)
router.get('/summary', async function (req, res) {
  try {
    var startDate = req.query.startDate || '19000101';
    var endDate = req.query.endDate || '99991231';
    var names = req.query.names ? req.query.names.split(',') : null;

    var whereBase = 'WHERE date >= $1 AND date <= $2';
    var params = [startDate, endDate];
    var idx = 3;
    if (names && names.length > 0) {
      whereBase += ' AND name = ANY($' + idx++ + ')';
      params.push(names);
    }

    // 총계
    var totalSql = 'SELECT COUNT(*) as total_records, COALESCE(SUM(hours),0) as total_hours, ' +
      'COUNT(DISTINCT name) as unique_people, COUNT(DISTINCT order_no) as unique_orders, ' +
      'MIN(date) as first_date, MAX(date) as last_date ' +
      'FROM work_records ' + whereBase;
    var totalR = await db.query(totalSql, params);

    // 업무분장별 분포
    var abbrSql = 'SELECT abbr, COALESCE(SUM(hours),0) as hours, COUNT(*) as cnt ' +
      'FROM work_records ' + whereBase + ' GROUP BY abbr ORDER BY hours DESC';
    var abbrR = await db.query(abbrSql, params);

    // 인원별 요약
    var peopleSql = 'SELECT name, COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT date) as work_days, ' +
      'COUNT(DISTINCT order_no) as order_count ' +
      'FROM work_records ' + whereBase + ' GROUP BY name ORDER BY hours DESC';
    var peopleR = await db.query(peopleSql, params);

    res.json({
      summary: totalR.rows[0],
      abbrDist: abbrR.rows,
      people: peopleR.rows
    });
  } catch (e) {
    console.error('[stats/summary]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ═══ GET /api/stats/weekly ═══
// 날짜별 × 인원별 집계 (차트/테이블용)
router.get('/weekly', async function (req, res) {
  try {
    var startDate = req.query.startDate || '19000101';
    var endDate = req.query.endDate || '99991231';
    var names = req.query.names ? req.query.names.split(',') : null;

    var params = [startDate, endDate];
    var idx = 3;
    var nameFilter = '';
    if (names && names.length > 0) {
      nameFilter = ' AND name = ANY($' + idx++ + ')';
      params.push(names);
    }

    // 날짜별 × 인원별 × 업무분장별 집계
    var sql = 'SELECT date, name, abbr, COALESCE(SUM(hours),0) as hours, COUNT(*) as cnt ' +
      'FROM work_records WHERE date >= $1 AND date <= $2' + nameFilter +
      ' GROUP BY date, name, abbr ORDER BY date, name, abbr';
    var r = await db.query(sql, params);

    // 날짜별 소계
    var dailySql = 'SELECT date, COALESCE(SUM(hours),0) as hours, COUNT(DISTINCT name) as people ' +
      'FROM work_records WHERE date >= $1 AND date <= $2' + nameFilter +
      ' GROUP BY date ORDER BY date';
    var dailyR = await db.query(dailySql, params);

    res.json({
      details: r.rows,
      daily: dailyR.rows
    });
  } catch (e) {
    console.error('[stats/weekly]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ═══ GET /api/stats/by-team ═══
// 부서별 × 인원별 투입 현황
router.get('/by-team', async function (req, res) {
  try {
    var startDate = req.query.startDate || '19000101';
    var endDate = req.query.endDate || '99991231';

    var sql = 'SELECT u.department_id, d.name as department_name, ' +
      'wr.name, COALESCE(SUM(wr.hours),0) as total_hours, COUNT(*) as record_count, ' +
      'COUNT(DISTINCT wr.order_no) as order_count, COUNT(DISTINCT wr.date) as work_days ' +
      'FROM work_records wr ' +
      'LEFT JOIN users u ON u.name = wr.name AND u.status = \'active\' ' +
      'LEFT JOIN departments d ON u.department_id = d.id ' +
      'WHERE wr.date >= $1 AND wr.date <= $2 ' +
      'GROUP BY u.department_id, d.name, wr.name ' +
      'ORDER BY d.name NULLS LAST, total_hours DESC';
    var r = await db.query(sql, [startDate, endDate]);

    res.json({ data: r.rows });
  } catch (e) {
    console.error('[stats/by-team]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

// ═══ GET /api/stats/by-order ═══
// 수주번호별 투입 현황
router.get('/by-order', async function (req, res) {
  try {
    var startDate = req.query.startDate || '19000101';
    var endDate = req.query.endDate || '99991231';
    var names = req.query.names ? req.query.names.split(',') : null;

    var params = [startDate, endDate];
    var idx = 3;
    var nameFilter = '';
    if (names && names.length > 0) {
      nameFilter = ' AND name = ANY($' + idx++ + ')';
      params.push(names);
    }

    var sql = 'SELECT order_no, name, COALESCE(SUM(hours),0) as hours, ' +
      'COUNT(*) as record_count, MIN(date) as first_date, MAX(date) as last_date ' +
      'FROM work_records WHERE date >= $1 AND date <= $2' + nameFilter +
      ' GROUP BY order_no, name ORDER BY order_no, hours DESC';
    var r = await db.query(sql, params);

    res.json({ data: r.rows });
  } catch (e) {
    console.error('[stats/by-order]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: '서버 오류' });
  }
});

module.exports = router;
