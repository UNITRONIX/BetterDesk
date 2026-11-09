/**
 * BetterDesk Console — old page addresses
 *
 * The pages that lived here are in the console (web-ui) at the same
 * addresses. /tenants is left: it sends people to Organizations.
 *
 * @module routes/pages.routes
 */

'use strict';

const express = require('express');
const router = express.Router();

// ── Tenants — redirect to Organizations (merged); that page checks access ──

router.get('/tenants', (req, res) => {
    res.redirect('/organizations');
});

module.exports = router;
