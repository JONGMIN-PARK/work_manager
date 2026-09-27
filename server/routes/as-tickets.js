/**
 * /api/as-tickets — A/S 티켓 라우터 (하위 라우터 조립)
 *
 * 구현은 routes/as-tickets/ 아래로 나뉘어 있다. 모든 경로·메서드와 등록 순서는 분할 전과 같다
 * (__tests__/route-inventory.test.js 가 스냅샷으로 검증).
 *   core.js        GET/POST /, GET/PUT/DELETE /:id, DELETE /:id/hard, POST /:id/restore
 *   assignments.js /:id/assignments[/:aid]
 *   logs.js        /:id/logs[/:lid], POST /:id/link-issue
 *   parts.js       /:id/parts[/:pid]
 *   attachments.js /:id/attachments[/:aid], /:id/signatures[/:sid]
 *   reports.js     GET /:id/recurrences, POST /:id/email-report
 */
var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

router.use(require('./as-tickets/core'));
router.use(require('./as-tickets/assignments'));
router.use(require('./as-tickets/logs'));
router.use(require('./as-tickets/parts'));
router.use(require('./as-tickets/attachments'));
router.use(require('./as-tickets/reports'));

module.exports = router;
