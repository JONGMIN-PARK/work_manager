/**
 * 👀 지금 같이 보는 사람 (v13.539) — POST /api/presence { keys: ['project:ID', 'doc:ID', 'map:ID', 'note:ID'] }
 *   보는 동안 20초마다 부름(살아 있음 알림) → 키마다 45초 안에 다녀간 다른 사람 [{ id, name }]
 *   { leave: true } 면 그 키에서 빠짐. 메모리에만 (서버 한 대 · 재시작하면 20초 안에 다시 채워짐)
 *   project: 키는 그 프로젝트를 볼 수 있는 사람만 (볼 수 없으면 빈 목록 · 기록도 안 함)
 */
var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var pa = require('../lib/project-access');
var db = require('../config/db');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

var TTL = 45000;
var MAP = new Map();   // tenant|key → Map(userId → { name, at })
var NAMES = new Map(); // userId → { n, t }
async function nameOf(req) {
  var c = NAMES.get(req.user.sub);
  if (c && Date.now() - c.t < 600000) return c.n;
  var r = await db.query("SELECT COALESCE(NULLIF(display_name,''), name) AS n FROM users WHERE id = $1", [req.user.sub]);
  var n = (r.rows[0] && r.rows[0].n) || req.user.name || '';
  NAMES.set(req.user.sub, { n: n, t: Date.now() });
  return n;
}
function sweep() {
  var now = Date.now();
  MAP.forEach(function (m, k) { m.forEach(function (v, u) { if (now - v.at > TTL) m.delete(u); }); if (!m.size) MAP.delete(k); });
}
setInterval(sweep, 60000).unref();

router.post('/', async function (req, res) {
  try {
    var b = req.body || {}, me = req.user.sub, tid = req.tenant.id, now = Date.now();
    var keys = (Array.isArray(b.keys) ? b.keys : []).filter(function (k, i, a) { return typeof k === 'string' && /^(project|doc|map|note|meeting):[\w.:-]{1,120}$/.test(k) && a.indexOf(k) === i; }).slice(0, 12);
    var name = await nameOf(req), out = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], mk = tid + '|' + k;
      if (/^project:/.test(k) && !(await pa.canReadById(req, k.slice(8)))) { out[k] = []; continue; }
      var m = MAP.get(mk);
      if (b.leave) { if (m) m.delete(me); out[k] = []; continue; }
      if (!m) { m = new Map(); MAP.set(mk, m); }
      m.set(me, { name: name, at: now });
      var list = [];
      m.forEach(function (v, u) { if (u !== me && now - v.at <= TTL) list.push({ id: u, name: v.name }); });
      out[k] = list;
    }
    res.json({ data: out });
  } catch (e) { httpErr.serverError(res, '[presence]', e); }
});

module.exports = router;
module.exports._reset = function () { MAP.clear(); NAMES.clear(); };
