'use strict';

/**
 * BetterDesk Console — Server Attestation Routes
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const attestation = require('../services/serverAttestation');
const brandingService = require('../services/brandingService');
const db = require('../services/database');

const REQUIRED_PERMISSION = 'server.attestation';
const auth = [requireAuth, requirePermission(REQUIRED_PERMISSION)];

let runPromise = null;

// ─── Page ─────────────────────────────────────────────────────────────────────

router.get('/server-attestation', ...auth, async (req, res) => {
    try {
        const lastResult = await attestation.getLastResult();
        const badgeConfig = await attestation.getBadgeConfig();
        const badgePresentation = attestation.resolveBadgePresentation(badgeConfig, {
            tier: lastResult && lastResult.tier,
            translate: req.t,
            brandName: brandingService.getBranding().appName
        });
        res.render('server-attestation', {
            title: req.t('server_attestation.title'),
            pageStyles: ['server-attestation'],
            pageScripts: ['server-attestation'],
            currentPage: 'server-attestation',
            breadcrumb: [{ label: req.t('server_attestation.title') }],
            lastResult,
            badgeConfig,
            badgePresentation
        });
    } catch (err) {
        console.error('[ServerAttestation] page render failed:', err);
        res.status(500).render('errors/500', {
            title: 'Error',
            message: req.t('server_attestation.page_error') || 'Failed to load Server Attestation page'
        });
    }
});

// ─── Authenticated API ────────────────────────────────────────────────────────

router.get('/api/server-attestation/status', ...auth, async (req, res) => {
    try {
        const status = attestation.getStatus();
        if (!status.lastResult) {
            status.lastResult = await attestation.getLastResult();
        }
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/api/server-attestation/run', ...auth, async (req, res) => {
    try {
        const status = attestation.getStatus();
        if (status.running) {
            return res.status(409).json({ success: false, error: 'Benchmark already running' });
        }

        runPromise = attestation.runLoadTest({
            onProgress: () => { /* polled via status */ }
        }).catch((err) => {
            console.error('[ServerAttestation] run failed:', err.message);
        }).finally(() => {
            runPromise = null;
        });

        res.json({ success: true, started: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/api/server-attestation/abort', ...auth, (req, res) => {
    const aborted = attestation.requestAbort();
    res.json({ success: true, aborted });
});

router.get('/api/server-attestation/result', ...auth, async (req, res) => {
    try {
        const result = await attestation.getLastResult();
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/api/server-attestation/badge-config', ...auth, async (req, res) => {
    try {
        const config = await attestation.getBadgeConfig();
        const presentation = attestation.resolveBadgePresentation(config, {
            translate: req.t,
            brandName: brandingService.getBranding().appName
        });
        res.json({ success: true, config, presentation });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/api/server-attestation/badge-config', ...auth, async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ success: false, error: 'Invalid badge configuration' });
        }
        const config = await attestation.saveBadgeConfig(req.body);
        const badgePresentation = attestation.resolveBadgePresentation(config, {
            tier: null,
            translate: req.t,
            brandName: brandingService.getBranding().appName
        });
        await db.logAction(
            req.session?.userId,
            'server_attestation_badge_updated',
            'Updated Server Attestation badge labels',
            req.ip
        );
        res.json({ success: true, config, presentation: badgePresentation });
    } catch (err) {
        console.error('[ServerAttestation] badge config save failed:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Public badge API (login page) ───────────────────────────────────────────

router.get('/api/public/server-attestation', async (req, res) => {
    try {
        const result = await attestation.getLastResult();
        const presentation = await attestation.getBadgePresentation({
            tier: result && result.tier,
            translate: req.t,
            brandName: brandingService.getBranding().appName
        });
        res.json(attestation.buildPublicSummary(result, presentation));
    } catch (_) {
        res.json({ tier: null, maxConnections: 0, testedAt: null, valid: false });
    }
});

module.exports = router;
