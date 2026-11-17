/**
 * 📝 애니웍스 공수 등록 (v13.512) — 날짜별 내 초안 · 등록 기록
 *   실제 등록은 PC 앱(desktop/anyworks.js)이 애니웍스에 직접 한다. 서버는 내가 쓴 것과 올린 것을 기억만 한다
 *   (휴대폰 · 웹에서 써 두고 PC 앱에서 올릴 수 있게). 모두 본인 것만.
 *
 *   GET    /api/gongsu?from=&to=        내 날짜들
 *   GET    /api/gongsu/orders           최근에 쓴 수주번호 (자주 쓴 순)
 *   PUT    /api/gongsu/:day             초안 저장 { items }
 *   POST   /api/gongsu/:day/sent        등록함 { items, message }
 *   POST   /api/gongsu/:day/checked     주간일지에서 확인함
 *   DELETE /api/gongsu/:day             지우기
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var MAX_ROWS = 15;
var DIVI = ['사내', '사외'];
var JOB = ['제안', '수주', '개발', '지원', 'CS', '양산', '공통'];
var COLS = "to_char(day, 'YYYY-MM-DD') AS day, items, status, sent_at, sent_items, sent_msg, checked_at, updated_at";

function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s)); }
function str(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
function cleanItems(src) {
  if (!Array.isArray(src)) return null;
  if (src.length > MAX_ROWS) return null;
  return src.map(function (r) {
    r = r || {};
    var h = Number(r.hours);
    return {
      orderno: str(r.orderno, 40), prodspec: str(r.prodspec, 120),
      hours: h > 0 && h <= 24 ? Math.round(h * 100) / 100 : 0,
      divi: DIVI.indexOf(r.divi) >= 0 ? r.divi : '', job: JOB.indexOf(r.job) >= 0 ? r.job : '',
      memo: str(r.memo, 200)
    };
  });
}
function row(r) {
  return { day: r.day, items: r.items || [], status: r.status, sentAt: r.sent_at, sentItems: r.sent_items || null, sentMsg: r.sent_msg || '', checkedAt: r.checked_at, updatedAt: r.updated_at };
}
function bad(res, msg) { return res.status(400).json({ error: 'INVALID', message: msg }); }

router.get('/', async function (req, res) {
  try {
    var q = req.query || {};
    if (!isDay(q.from) || !isDay(q.to)) return bad(res, '기간(from · to)이 올바르지 않습니다');
    var r = await db.query('SELECT ' + COLS + ' FROM gongsu_days WHERE tenant_id = $1 AND user_id = $2 AND day BETWEEN $3 AND $4 ORDER BY day LIMIT 200',
      [req.tenant.id, req.user.sub, q.from, q.to]);
    res.json({ data: r.rows.map(row) });
  } catch (e) { httpErr.serverError(res, '[gongsu/list]', e); }
});

/* 최근 120일 동안 내가 쓴 수주번호 — 자주 쓴 순. 가장 최근에 쓴 사내외 · 업무구분도 함께 (다음 입력의 기본값) */
router.get('/orders', async function (req, res) {
  try {
    var r = await db.query("SELECT items, sent_items FROM gongsu_days WHERE tenant_id = $1 AND user_id = $2 AND day >= CURRENT_DATE - 120 ORDER BY day DESC LIMIT 150",
      [req.tenant.id, req.user.sub]);
    var map = {}, list = [];
    r.rows.forEach(function (d) {
      (d.sent_items || d.items || []).forEach(function (it) {
        if (!it || !it.orderno) return;
        var o = map[it.orderno];
        if (!o) { o = map[it.orderno] = { orderno: it.orderno, prodspec: it.prodspec || '', divi: it.divi || '', job: it.job || '', n: 0 }; list.push(o); }
        o.n++;
        if (!o.prodspec && it.prodspec) o.prodspec = it.prodspec;
      });
    });
    list.sort(function (a, b) { return b.n - a.n; });
    res.json({ data: list.slice(0, 60) });
  } catch (e) { httpErr.serverError(res, '[gongsu/orders]', e); }
});

router.put('/:day', async function (req, res) {
  try {
    if (!isDay(req.params.day)) return bad(res, '날짜가 올바르지 않습니다');
    var items = cleanItems((req.body || {}).items);
    if (!items) return bad(res, '한 번에 ' + MAX_ROWS + '행까지입니다');
    var r = await db.query(
      'INSERT INTO gongsu_days (tenant_id, user_id, day, items, updated_at) VALUES ($1,$2,$3,$4,NOW()) '
      + 'ON CONFLICT (tenant_id, user_id, day) DO UPDATE SET items = $4, updated_at = NOW() RETURNING ' + COLS,
      [req.tenant.id, req.user.sub, req.params.day, JSON.stringify(items)]);
    res.json({ data: row(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[gongsu/put]', e); }
});

router.post('/:day/sent', async function (req, res) {
  try {
    if (!isDay(req.params.day)) return bad(res, '날짜가 올바르지 않습니다');
    var items = cleanItems((req.body || {}).items);
    if (!items || !items.length) return bad(res, '등록한 내용이 없습니다');
    var msg = str((req.body || {}).message, 500);
    var r = await db.query(
      "INSERT INTO gongsu_days (tenant_id, user_id, day, items, status, sent_at, sent_items, sent_msg, checked_at, updated_at) VALUES ($1,$2,$3,$4,'sent',NOW(),$4,$5,NULL,NOW()) "
      + "ON CONFLICT (tenant_id, user_id, day) DO UPDATE SET items = $4, status = 'sent', sent_at = NOW(), sent_items = $4, sent_msg = $5, checked_at = NULL, updated_at = NOW() RETURNING " + COLS,
      [req.tenant.id, req.user.sub, req.params.day, JSON.stringify(items), msg]);
    res.json({ data: row(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[gongsu/sent]', e); }
});

router.post('/:day/checked', async function (req, res) {
  try {
    if (!isDay(req.params.day)) return bad(res, '날짜가 올바르지 않습니다');
    var r = await db.query('UPDATE gongsu_days SET checked_at = NOW() WHERE tenant_id = $1 AND user_id = $2 AND day = $3 RETURNING ' + COLS,
      [req.tenant.id, req.user.sub, req.params.day]);
    if (!r.rows.length) return res.status(404).json({ error: 'NOT_FOUND', message: '그 날짜의 기록이 없습니다' });
    res.json({ data: row(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[gongsu/checked]', e); }
});

router.delete('/:day', async function (req, res) {
  try {
    if (!isDay(req.params.day)) return bad(res, '날짜가 올바르지 않습니다');
    await db.query('DELETE FROM gongsu_days WHERE tenant_id = $1 AND user_id = $2 AND day = $3', [req.tenant.id, req.user.sub, req.params.day]);
    res.json({ data: { day: req.params.day } });
  } catch (e) { httpErr.serverError(res, '[gongsu/delete]', e); }
});

module.exports = router;
