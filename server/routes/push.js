/**
 * 📲 /api/push — 휴대폰 · 브라우저 푸시 구독 (v13.359)
 */
var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var tenant = require('../middleware/tenant');
var httpErr = require('../lib/http-errors');
var push = require('../services/push.service');

router.use(auth.authenticate);
router.use(tenant.tenantScope);

router.get('/key', async function (req, res) {
  try { res.json({ data: { publicKey: await push.publicKey(), subs: await push.count(req.user.sub) } }); }
  catch (e) { httpErr.serverError(res, '[push/key]', e); }
});
router.post('/subscribe', async function (req, res) {
  try { await push.subscribe(req.user.sub, req.tenant.id, (req.body || {}).subscription, req.headers['user-agent']); res.status(201).json({ ok: true }); }
  catch (e) { if (e.status === 400) return res.status(400).json({ error: 'VALIDATION', message: e.message }); httpErr.serverError(res, '[push/sub]', e); }
});
router.post('/unsubscribe', async function (req, res) {
  try { await push.unsubscribe(req.user.sub, (req.body || {}).endpoint); res.json({ ok: true }); }
  catch (e) { httpErr.serverError(res, '[push/unsub]', e); }
});
router.post('/test', async function (req, res) {
  try { var n = await push.sendToUsers([req.user.sub], { title: '🔔 알림 시험', body: '이 기기에서 알림을 받을 수 있습니다.', tag: 'push-test', go: 'messages' }); res.json({ data: { sent: n } }); }
  catch (e) { httpErr.serverError(res, '[push/test]', e); }
});

module.exports = router;
