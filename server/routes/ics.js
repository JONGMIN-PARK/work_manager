/**
 * 개인 달력 구독 (v13.252) — 로그인 없이 토큰으로 읽기만
 *   GET /api/ics/:token.ics   내 할 일(마감) + 내 일정 — 구글 · 아웃룩 · 애플 달력에 'URL로 추가'
 * 토큰은 /api/my-work/feed 에서 만들고 다시 만들면 옛 주소는 끊긴다. 퇴사(비활성) 사용자는 404.
 */
var express = require('express');
var router = express.Router();
var db = require('../config/db');
var myWork = require('../lib/my-work');
var myEvents = require('../lib/my-events');
var ics = require('../lib/ics');

router.get('/:file', async function (req, res) {
  try {
    var m = /^([a-f0-9]{48})(\.ics)?$/.exec(req.params.file || '');
    if (!m) return res.status(404).type('text/plain').send('Not found');
    var r = await db.query(
      'SELECT f.user_id, f.tenant_id, u.name, u.role, u.department_id FROM calendar_feeds f JOIN users u ON u.id = f.user_id AND u.tenant_id = f.tenant_id ' +
      "WHERE f.token = $1 AND u.status = 'active'", [m[1]]);
    var f = r.rows[0];
    if (!f) return res.status(404).type('text/plain').send('Not found');
    // 본인으로 모은다 — 본인 화면과 같은 것만 나간다
    var req2 = { tenant: { id: f.tenant_id }, user: { sub: f.user_id, role: f.role, departmentId: f.department_id } };
    var user = { id: f.user_id, name: f.name };
    var today = myWork.kstToday();
    var results = await Promise.all([
      myWork.collect(req2, [user]),
      myEvents.eventsFor(req2, user, myEvents.addDays(today, -90), myEvents.addDays(today, 366))
    ]);
    await db.query('UPDATE calendar_feeds SET last_used_at = now() WHERE user_id = $1', [f.user_id]).catch(function () {});
    var host = String(req.get('host') || 'workmanager').split(':')[0];
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="my-work.ics"');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(ics.build('내 업무 · ' + f.name, results[0], results[1], host));
  } catch (e) {
    console.error('[ics]', e.message);
    res.status(500).type('text/plain').send('Error');
  }
});

module.exports = router;
