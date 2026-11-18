'use strict';

const express = require('express');
const router = express.Router();
const db = require('../services/database');
const policyService = require('../services/panelAccessPolicyService');
const { requireAuth, requirePermission } = require('../middleware/auth');

function sendError(req, res, error) {
    const status = error.status || 500;
    res.status(status).json({
        success: false,
        error: status === 500 ? req.t('errors.server_error') : error.message,
    });
}

router.get('/api/panel/access/catalog', requireAuth, requirePermission('user.view'), (req, res) => {
    res.json({ success: true, data: policyService.getCatalog() });
});

router.get('/api/panel/access/effective', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const effective = await policyService.resolveForUser({
            id: req.session.userId,
            role: user?.role,
        });
        res.json({ success: true, data: effective });
    } catch (error) {
        sendError(req, res, error);
    }
});

router.get('/api/panel/access/users/:id', requireAuth, requirePermission('user.view'), async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        const user = await db.getUserById(id);
        if (!user) return res.status(404).json({ success: false, error: req.t('users.not_found') });
        const sections = await db.getPanelAccessPolicies('user', String(id));
        const features = await db.getClientFeaturePolicies('user', String(id));
        const effective = await policyService.resolveForUser(user);
        res.json({ success: true, data: { user_id: id, sections, features, effective } });
    } catch (error) {
        sendError(req, res, error);
    }
});

router.put('/api/panel/access/users/:id', requireAuth, requirePermission('user.edit'), async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        const user = await db.getUserById(id);
        if (!user) return res.status(404).json({ success: false, error: req.t('users.not_found') });
        const saved = await policyService.savePolicy('user', String(id), req.body || {});
        await db.logAction(req.session.userId, 'user_access_policy_updated', `Updated access policy for user ${id}`, req.ip);
        res.json({ success: true, data: { user_id: id, ...saved, effective: await policyService.resolveForUser(user) } });
    } catch (error) {
        sendError(req, res, error);
    }
});

router.get('/api/panel/access/groups/:guid', requireAuth, requirePermission('user.view'), async (req, res) => {
    try {
        const guid = String(req.params.guid || '');
        const group = await db.getUserGroupByGuid(guid);
        if (!group) return res.status(404).json({ success: false, error: req.t('users.user_group_not_found') });
        const sections = await db.getPanelAccessPolicies('group', guid);
        const features = await db.getClientFeaturePolicies('group', guid);
        const effective = await policyService.resolveForGroup(group);
        res.json({ success: true, data: { group_guid: guid, sections, features, effective } });
    } catch (error) {
        sendError(req, res, error);
    }
});

router.put('/api/panel/access/groups/:guid', requireAuth, requirePermission('user.edit'), async (req, res) => {
    try {
        const guid = String(req.params.guid || '');
        const group = await db.getUserGroupByGuid(guid);
        if (!group) return res.status(404).json({ success: false, error: req.t('users.user_group_not_found') });
        const saved = await policyService.savePolicy('group', guid, req.body || {});
        await db.logAction(req.session.userId, 'user_group_access_policy_updated', `Updated access policy for group ${guid}`, req.ip);
        res.json({ success: true, data: { group_guid: guid, ...saved, effective: await policyService.resolveForGroup(group) } });
    } catch (error) {
        sendError(req, res, error);
    }
});

module.exports = router;
