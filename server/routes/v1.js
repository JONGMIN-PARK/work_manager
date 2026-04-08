var express = require('express');
var router = express.Router();

// Re-mount all existing routes under /api/v1
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/projects', require('./projects'));
router.use('/orders', require('./orders'));
router.use('/issues', require('./issues'));
router.use('/events', require('./events'));
router.use('/milestones', require('./milestones'));
router.use('/checklists', require('./checklists'));
router.use('/progress', require('./progress'));
router.use('/archives', require('./archives'));
router.use('/docs', require('./documents'));
router.use('/locks', require('./locks'));
router.use('/departments', require('./departments'));
router.use('/profile', require('./profile'));
router.use('/audit', require('./audit'));
router.use('/anyworks', require('./anyworks'));
router.use('/stats', require('./stats'));
router.use('/telegram', require('./telegram'));
router.use('/ai', require('./ai'));
router.use('/settings', require('./settings'));
router.use('/tenants', require('./tenants'));
router.use('/billing', require('./billing'));

module.exports = router;
