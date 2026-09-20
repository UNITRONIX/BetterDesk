'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { apiClient } = require('../services/betterdeskApi');
const { proxyToGo, proxyBinaryToGo, safeSegment } = require('../lib/goApiProxy');
const db = require('../services/database');
const {
    parseCommercializationEmailConfig,
    CONFIG_KEY,
} = require('../services/helpRequestEmailService');
const { getSmtpSettings } = require('../lib/smtpSettingsHandlers');
const billingClockConfig = require('../services/billingClockConfigService');
const restartCoordinator = require('../services/restartCoordinator');

router.get('/commercialization', requireAuth, requirePermission('billing.view'), (req, res) => {
    const validTabs = ['overview', 'packages', 'sessions', 'reports', 'settings'];
    const tab = validTabs.includes(req.query.tab) ? req.query.tab : 'overview';
    const tabKey = `commercialization.tabs.${tab}`;
    res.render('commercialization', {
        title: req.t(tabKey),
        pageStyles: ['commercialization'],
        pageScripts: ['commercialization'],
        currentPage: 'commercialization',
        currentTab: tab,
        activeTab: tab,
        breadcrumb: [
            { label: req.t('commercialization.title') },
            { label: req.t(tabKey) }
        ],
        req
    });
});

router.get('/api/panel/billing/timesync/status', requireAuth, requirePermission('billing.view'), (req, res) => {
    proxyToGo(apiClient, req, res, 'GET', '/timesync/status');
});

router.post('/api/panel/billing/timesync/check', requireAuth, requirePermission('server.config'), (req, res) => {
    proxyToGo(apiClient, req, res, 'POST', '/timesync/check');
});

router.get('/api/panel/billing/clock/settings', requireAuth, requirePermission('billing.view'), async (req, res) => {
    try {
        res.json({ success: true, settings: await billingClockConfig.getRuntimeClockSettings() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/api/panel/billing/clock/settings', requireAuth, requirePermission('server.config'), async (req, res) => {
    try {
        const previous = await billingClockConfig.getRuntimeClockSettings();
        const result = await billingClockConfig.saveClockSettings(req.body || {}, { restart: false });
        const restartRequired = result.dockerMode
            ? null
            : restartCoordinator.registerChange(req, {
                key: 'billing-clock',
                label: req.t('commercialization.clock.title'),
                rollback: {
                    type: 'billing-clock',
                    settings: previous,
                }
            });
        if (result.dockerMode) {
            // A previous failed native-restart attempt must not keep the
            // Settings page locked after Docker hot-reload succeeds.
            restartCoordinator.dismissFailed(req, 'billing-clock');
        }
        try {
            await db.logAction(
                req.session.userId,
                'billing_clock_settings_updated',
                'Updated billing/NTP clock settings',
                req.ip
            );
        } catch (_) {}
        res.json({
            success: true,
            settings: result.settings,
            serviceConfig: result.serviceConfig,
            status: result.status || null,
            restart: result.restart,
            restartRequired,
            dockerMode: !!result.dockerMode,
        });
    } catch (err) {
        const code = ['invalid_ntp_servers', 'invalid_max_skew'].includes(err.message) ? 400 : 500;
        res.status(code).json({ success: false, error: err.message });
    }
});

router.get('/api/panel/billing/packages', requireAuth, requirePermission('billing.view'), (req, res) => {
    proxyToGo(apiClient, req, res, 'GET', '/billing/packages');
});

router.post('/api/panel/billing/packages', requireAuth, requirePermission('billing.manage'), (req, res) => {
    proxyToGo(apiClient, req, res, 'POST', '/billing/packages', req.body);
});

router.put('/api/panel/billing/packages/:id', requireAuth, requirePermission('billing.manage'), (req, res) => {
    proxyToGo(apiClient, req, res, 'PUT', () => `/billing/packages/${safeSegment(req.params.id, 'packageId')}`, req.body);
});

router.delete('/api/panel/billing/packages/:id', requireAuth, requirePermission('billing.manage'), (req, res) => {
    proxyToGo(apiClient, req, res, 'DELETE', () => `/billing/packages/${safeSegment(req.params.id, 'packageId')}`);
});

router.get('/api/panel/billing/contracts', requireAuth, requirePermission('billing.view'), (req, res) => {
    const q = new URLSearchParams(req.query).toString();
    proxyToGo(apiClient, req, res, 'GET', () => `/billing/contracts${q ? `?${q}` : ''}`);
});

router.post('/api/panel/billing/contracts', requireAuth, requirePermission('billing.manage'), (req, res) => {
    proxyToGo(apiClient, req, res, 'POST', '/billing/contracts', req.body);
});

router.put('/api/panel/billing/contracts/:id', requireAuth, requirePermission('billing.manage'), (req, res) => {
    proxyToGo(apiClient, req, res, 'PUT', () => `/billing/contracts/${safeSegment(req.params.id, 'contractId')}`, req.body);
});

router.delete('/api/panel/billing/contracts/:id', requireAuth, requirePermission('billing.manage'), (req, res) => {
    proxyToGo(apiClient, req, res, 'DELETE', () => `/billing/contracts/${safeSegment(req.params.id, 'contractId')}`);
});

router.get('/api/panel/billing/stats', requireAuth, requirePermission('billing.view'), (req, res) => {
    proxyToGo(apiClient, req, res, 'GET', '/billing/stats');
});

router.get('/api/panel/billing/sessions', requireAuth, requirePermission('billing.view'), (req, res) => {
    const q = new URLSearchParams(req.query).toString();
    proxyToGo(apiClient, req, res, 'GET', () => `/billing/sessions${q ? `?${q}` : ''}`);
});

router.get('/api/panel/billing/sessions/pending', requireAuth, requirePermission('billing.reports'), (req, res) => {
    const q = new URLSearchParams(req.query).toString();
    proxyToGo(apiClient, req, res, 'GET', () => `/billing/sessions/pending${q ? `?${q}` : ''}`);
});

router.get('/api/panel/billing/sessions/export', requireAuth, requirePermission('billing.export'), (req, res) => {
    const q = new URLSearchParams(req.query).toString();
    proxyBinaryToGo(apiClient, req, res, 'GET', () => `/billing/sessions/export${q ? `?${q}` : ''}`);
});

router.get('/api/panel/billing/reports', requireAuth, requirePermission('billing.view'), (req, res) => {
    const q = new URLSearchParams(req.query).toString();
    proxyToGo(apiClient, req, res, 'GET', () => `/billing/reports${q ? `?${q}` : ''}`);
});

router.get('/api/panel/billing/reports/export', requireAuth, requirePermission('billing.export'), (req, res) => {
    const q = new URLSearchParams(req.query).toString();
    proxyBinaryToGo(apiClient, req, res, 'GET', () => `/billing/reports/export${q ? `?${q}` : ''}`);
});

router.post('/api/panel/billing/sessions/:id/report', requireAuth, requirePermission('billing.reports'), (req, res) => {
    proxyToGo(apiClient, req, res, 'POST', () => `/billing/sessions/${safeSegment(req.params.id, 'sessionId')}/report`, req.body);
});

router.get('/api/panel/billing/currencies', requireAuth, requirePermission('billing.view'), (req, res) => {
    proxyToGo(apiClient, req, res, 'GET', '/billing/currencies');
});

router.put('/api/panel/billing/currencies/:code', requireAuth, requirePermission('billing.manage'), (req, res) => {
    proxyToGo(apiClient, req, res, 'PUT', () => `/billing/currencies/${safeSegment(req.params.code, 'currencyCode')}`, req.body);
});

router.get('/api/panel/commercialization/email-config', requireAuth, requirePermission('billing.view'), async (req, res) => {
    try {
        const raw = await db.getSetting(CONFIG_KEY);
        res.json({ success: true, config: parseCommercializationEmailConfig(raw) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/api/panel/commercialization/email-config', requireAuth, requirePermission('billing.manage'), async (req, res) => {
    try {
        const body = req.body || {};
        const config = {
            help_requests_enabled: body.help_requests_enabled !== false,
            notify_assigned_operators: body.notify_assigned_operators !== false,
            fallback_alert_email: body.fallback_alert_email !== false,
            include_folder_in_subject: body.include_folder_in_subject !== false,
        };
        await db.setSetting(CONFIG_KEY, JSON.stringify(config));
        try {
            await db.logAction(req.session.userId, 'commercialization_email_config_updated', 'Updated commercialization email notifications', req.ip);
        } catch (_) {}
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/api/panel/commercialization/smtp-status', requireAuth, requirePermission('billing.view'), (req, res) => {
    getSmtpSettings(req, res);
});

module.exports = router;
