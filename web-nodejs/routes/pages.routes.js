/**
 * BetterDesk Console — Page Render Routes
 *
 * Serves HTML pages for management modules. API endpoints are in separate route files.
 *
 * @module routes/pages.routes
 */

'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');

// ── Inventory ──

router.get('/inventory', requireAuth, (req, res) => {
    res.render('inventory', {
        title: req.t('inventory.title'),
        activePage: 'inventory',
    });
});

// ── Network Monitoring ──

router.get('/network', requireAuth, (req, res) => {
    res.render('network', {
        title: req.t('network.title'),
        activePage: 'network',
    });
});

// ── Tenants — redirect to Organizations (merged) ──

router.get('/tenants', requireAuth, requireRole('admin'), (req, res) => {
    res.redirect('/organizations');
});

module.exports = router;
