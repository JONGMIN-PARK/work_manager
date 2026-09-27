/**
 * 라우트 인벤토리 — 등록된 모든 (METHOD, 경로) 가 체크인된 스냅샷과 같아야 한다.
 *
 * 라우터 분할(routes/as-tickets/*)·리팩터링으로 경로가 사라지거나 바뀌면 여기서 걸린다.
 * 라우트를 의도적으로 추가/삭제했다면:  node scripts/dump-routes.js --write  로 스냅샷을 갱신한다.
 */
var fs = require('fs');
var path = require('path');
var app = require('../app');
var listRoutes = require('../lib/route-inventory').listRoutes;

describe('route inventory', function () {
  test('등록된 라우트 = route-inventory.snapshot.txt', function () {
    var snap = fs.readFileSync(path.join(__dirname, 'route-inventory.snapshot.txt'), 'utf8')
      .split(/\r?\n/).filter(Boolean);
    var now = listRoutes(app);
    var missing = snap.filter(function (r) { return now.indexOf(r) < 0; });
    var added = now.filter(function (r) { return snap.indexOf(r) < 0; });
    expect({ missing: missing, added: added }).toEqual({ missing: [], added: [] });
    expect(now).toEqual(snap);
  });

  test('as-tickets 하위 라우터 분할 후에도 경로 우선순위(등록 순서) 유지', function () {
    var ordered = listRoutes(app, { sorted: false })
      .filter(function (r) { return / \/api\/as-tickets(\/|$)/.test(r); });
    expect(ordered).toEqual([
      'GET /api/as-tickets',
      'GET /api/as-tickets/:id',
      'POST /api/as-tickets',
      'PUT /api/as-tickets/:id',
      'DELETE /api/as-tickets/:id',
      'DELETE /api/as-tickets/:id/hard',
      'POST /api/as-tickets/:id/restore',
      'GET /api/as-tickets/:id/assignments',
      'POST /api/as-tickets/:id/assignments',
      'PUT /api/as-tickets/:id/assignments/:aid',
      'DELETE /api/as-tickets/:id/assignments/:aid',
      'GET /api/as-tickets/:id/logs',
      'POST /api/as-tickets/:id/logs',
      'PUT /api/as-tickets/:id/logs/:lid',
      'DELETE /api/as-tickets/:id/logs/:lid',
      'POST /api/as-tickets/:id/link-issue',
      'GET /api/as-tickets/:id/parts',
      'POST /api/as-tickets/:id/parts',
      'PUT /api/as-tickets/:id/parts/:pid',
      'DELETE /api/as-tickets/:id/parts/:pid',
      'GET /api/as-tickets/:id/attachments',
      'POST /api/as-tickets/:id/attachments',
      'DELETE /api/as-tickets/:id/attachments/:aid',
      'GET /api/as-tickets/:id/signatures',
      'POST /api/as-tickets/:id/signatures',
      'DELETE /api/as-tickets/:id/signatures/:sid',
      'GET /api/as-tickets/:id/recurrences',
      'POST /api/as-tickets/:id/email-report'
    ]);
  });

  test('notification.service 는 분할 후에도 같은 API 를 내보낸다', function () {
    var ns = require('../services/notification.service');
    expect(Object.keys(ns).sort()).toEqual([
      'TEMPLATES', 'notify', 'notifyAdmins', 'notifyGroup', 'notifyProjectStakeholders',
      'sendActionItemReminders', 'sendDailyBriefing', 'sendDeadlineReminders', 'sendOrderDeliveryReminders',
      'sendOverloadWarnings', 'sendPrestudyReminders', 'sendProgressWarnings', 'sendTechStaleReminders',
      'sendWeeklyDigest'
    ]);
    Object.keys(ns).forEach(function (k) {
      if (k !== 'TEMPLATES') expect(typeof ns[k]).toBe('function');
    });
  });
});
