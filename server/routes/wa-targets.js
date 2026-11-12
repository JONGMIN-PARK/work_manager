/**
 * 🎯 목표 분장 비율 (v13.460) — 업무일지 › 주간 분석 › 📊 분석 「목표 구성 대비」
 *   GET /api/wa-targets          목록 — 관리자 · 임원 · 팀장은 모두, 그 밖엔 팀 · 부서 + 본인(person) 것만
 *   PUT /api/wa-targets          { scope: 'team'|'dept'|'person', key, mix: { 분장: % } } — 관리자 · 임원 · 팀장만 · mix 가 비면 지움
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var SCOPES = ['team', 'dept', 'person'];
function isMgr(req) { return ['admin', 'executive', 'manager'].indexOf(req.user.role) >= 0; }
async function myNames(req) {
  var r = await db.query('SELECT name, display_name FROM users WHERE id = $1', [req.user.sub]);
  var u = r.rows[0] || {};
  return [u.name, u.display_name, req.user.name].filter(Boolean);
}
function row(r) { return { scope: r.scope, key: r.key, mix: r.mix || {}, updatedName: r.updated_name, updatedAt: r.updated_at }; }
/* 분장 약자(영문 · 숫자 1~4자) → 0~100 정수 · 0 은 버림 · 합이 100 을 넘으면 거절 */
function cleanMix(m) {
  var o = {}, sum = 0;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { o: o, sum: 0 };
  Object.keys(m).slice(0, 40).forEach(function (k) {
    if (!/^[A-Za-z0-9?]{1,4}$/.test(k)) return;
    var v = Math.round(Number(m[k]));
    if (!isFinite(v) || v <= 0) return;
    v = Math.min(100, v); o[k] = v; sum += v;
  });
  return { o: o, sum: sum };
}

router.get('/', async function (req, res) {
  try {
    var r = await db.query('SELECT scope, key, mix, updated_name, updated_at FROM wa_targets WHERE tenant_id = $1 ORDER BY scope, key', [req.tenant.id]);
    var rows = r.rows;
    if (!isMgr(req)) {
      var me = await myNames(req);
      rows = rows.filter(function (x) { return x.scope !== 'person' || me.indexOf(x.key) >= 0; });
    }
    res.json({ data: rows.map(row), canEdit: isMgr(req) });
  } catch (e) { httpErr.serverError(res, '[wa-targets/get]', e); }
});

router.put('/', async function (req, res) {
  try {
    if (!isMgr(req)) return res.status(403).json({ error: 'FORBIDDEN', message: '목표는 관리자 · 임원 · 팀장만 정할 수 있습니다.' });
    var b = req.body || {}, scope = String(b.scope || ''), key = String(b.key == null ? '' : b.key).trim().slice(0, 100);
    if (SCOPES.indexOf(scope) < 0) return res.status(400).json({ error: 'INVALID', message: 'scope 는 team · dept · person' });
    if (scope === 'team') key = '*';
    if (!key) return res.status(400).json({ error: 'INVALID', message: 'key 필수' });
    var m = cleanMix(b.mix);
    if (m.sum > 100) return res.status(400).json({ error: 'INVALID', message: '목표 합이 100% 를 넘습니다 (' + m.sum + '%)' });
    if (!Object.keys(m.o).length) {
      await db.query('DELETE FROM wa_targets WHERE tenant_id = $1 AND scope = $2 AND key = $3', [req.tenant.id, scope, key]);
      return res.json({ data: null });
    }
    var mn = await myNames(req), nm = mn[1] || mn[0] || '';
    var r = await db.query(
      'INSERT INTO wa_targets (tenant_id, scope, key, mix, updated_by, updated_name, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) '
      + 'ON CONFLICT (tenant_id, scope, key) DO UPDATE SET mix = $4, updated_by = $5, updated_name = $6, updated_at = NOW() '
      + 'RETURNING scope, key, mix, updated_name, updated_at',
      [req.tenant.id, scope, key, JSON.stringify(m.o), req.user.sub, nm]);
    res.json({ data: row(r.rows[0]) });
  } catch (e) { httpErr.serverError(res, '[wa-targets/put]', e); }
});

module.exports = router;
