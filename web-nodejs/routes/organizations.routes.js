/**
 * BetterDesk Console — Organization Management Routes (v3.0.0)
 *
 * Proxies organization CRUD operations to the Go server REST API.
 * Provides page routes for the web panel and API routes for AJAX calls.
 *
 * Page routes:
 *   GET /organizations          — Organizations management page
 *   GET /organizations/:id      — Organization detail page
 *
 * API routes (proxy to Go server /api/org/*):
 *   GET    /api/panel/org              — List organizations
 *   POST   /api/panel/org              — Create organization
 *   GET    /api/panel/org/:id          — Get organization
 *   PUT    /api/panel/org/:id          — Update organization
 *   DELETE /api/panel/org/:id          — Delete organization
 *   GET    /api/panel/org/:id/users    — List org users
 *   POST   /api/panel/org/:id/users    — Create org user
 *   PUT    /api/panel/org/:id/users/:uid — Update org user
 *   DELETE /api/panel/org/:id/users/:uid — Delete org user
 *   POST   /api/panel/org/:id/invite   — Create invitation
 *   GET    /api/panel/org/:id/invitations — List invitations
 *   POST   /api/panel/org/:id/devices  — Assign device to org
 *   GET    /api/panel/org/:id/devices  — List org devices
 *   DELETE /api/panel/org/:id/devices/:did — Unassign device
 *   GET    /api/panel/org/:id/settings — List org settings
 *   PUT    /api/panel/org/:id/settings — Set org setting
 *   GET    /api/panel/org/:id/address-book — Get shared org address book
 *   PUT    /api/panel/org/:id/address-book — Update shared org address book
 */

'use strict';

const express = require('express');
const router = express.Router();
const { apiClient } = require('../services/betterdeskApi');
const { assertSafeApiId } = require('../lib/goApiPath');
const { requireAuth, requirePermission, roleHasPermission } = require('../middleware/auth');
const userSync = require('../services/userSync');
const db = require('../services/database');
const serverBackend = require('../services/serverBackend');
const deviceGroupService = require('../services/deviceGroupService');

// ---------------------------------------------------------------------------
//  Helper: proxy to Go server
// ---------------------------------------------------------------------------

async function goApiProxy(req, res, method, path, body) {
    try {
        const opts = { method, url: path };
        if (body) opts.data = body;
        const resp = await apiClient(opts);
        res.status(resp.status).json(resp.data);
    } catch (err) {
        const status = err.response?.status || 500;
        const data = err.response?.data || { error: 'Go server unreachable' };
        res.status(status).json(data);
    }
}

function orgApiPath(orgId, suffix = '') {
    const id = assertSafeApiId(orgId, 'orgId');
    return `/org/${encodeURIComponent(id)}${suffix}`;
}

function orgUserApiPath(orgId, userId) {
    return `${orgApiPath(orgId)}/users/${encodeURIComponent(assertSafeApiId(userId, 'userId'))}`;
}

function orgDeviceApiPath(orgId, deviceId) {
    return `${orgApiPath(orgId)}/devices/${encodeURIComponent(assertSafeApiId(deviceId, 'deviceId'))}`;
}

function orgMemberApiPath(orgId, userId) {
    return `${orgApiPath(orgId)}/members/${encodeURIComponent(assertSafeApiId(userId, 'userId'))}`;
}

async function goApiProxySafe(req, res, method, pathBuilder, body) {
    try {
        const path = typeof pathBuilder === 'function' ? pathBuilder() : pathBuilder;
        return goApiProxy(req, res, method, path, body);
    } catch (err) {
        if (err.message && /^Invalid /.test(err.message)) {
            return res.status(400).json({ error: err.message });
        }
        throw err;
    }
}

// ---------------------------------------------------------------------------
//  Org data scoping
//
//  The Go API is called with the console's API key, so its per-user org
//  scoping does not apply to proxied requests. These helpers enforce the same
//  rules here: panel org administrators reach every org, everyone else only
//  the orgs they are a member of, and member lists follow user.view.
// ---------------------------------------------------------------------------

const ORG_ADMIN_PERMISSIONS = ['org.create', 'org.edit', 'org.delete', 'org.manage_users', 'org.manage_devices'];

function sessionRole(req) {
    return req.session?.user?.role;
}

function sessionUsername(req) {
    return req.session?.user?.username || '';
}

function canAccessAllOrgs(req) {
    const role = sessionRole(req);
    return ORG_ADMIN_PERMISSIONS.some(perm => roleHasPermission(role, perm));
}

function canSeeAllOrgMembers(req) {
    const role = sessionRole(req);
    return roleHasPermission(role, 'user.view') || roleHasPermission(role, 'org.manage_users');
}

async function fetchOrgUsers(orgId) {
    const resp = await apiClient({ method: 'get', url: orgApiPath(orgId, '/users') });
    return Array.isArray(resp.data?.users) ? resp.data.users : [];
}

/** The caller's membership record in an org, or null. */
async function findOrgMembership(req, orgId) {
    const username = sessionUsername(req);
    if (!username) return null;
    const users = await fetchOrgUsers(orgId);
    return users.find(u => u && u.username === username) || null;
}

function forwardGoError(res, err) {
    if (err.message && /^Invalid /.test(err.message)) {
        return res.status(400).json({ error: err.message });
    }
    const status = err.response?.status || 500;
    const data = err.response?.data || { error: 'Go server unreachable' };
    return res.status(status).json(data);
}

/** Org admins pass; other callers must be a member of :id. */
async function requireOrgAccess(req, res, next) {
    if (canAccessAllOrgs(req)) return next();
    try {
        const membership = await findOrgMembership(req, req.params.id);
        if (membership) return next();
        return res.status(403).json({ error: 'Not a member of this organization' });
    } catch (err) {
        return forwardGoError(res, err);
    }
}

async function resolveGoMemberId(userId) {
    const resolved = await userSync.resolveGoUserId(userId);
    return resolved || userId;
}

// ---------------------------------------------------------------------------
//  Page routes
// ---------------------------------------------------------------------------

router.get('/organizations', requireAuth, (req, res) => {
    res.render('organizations', {
        title: 'Organizations',
        user: req.session.user,
        currentPage: 'organizations',
    });
});

router.get('/organizations/:id', requireAuth, (req, res) => {
    try {
        const orgId = assertSafeApiId(req.params.id, 'orgId');
        res.render('organization-detail', {
            title: 'Organization Details',
            user: req.session.user,
            currentPage: 'organizations',
            orgId,
        });
    } catch (err) {
        if (err.message && /^Invalid /.test(err.message)) {
            return res.status(400).render('errors/404', {
                title: 'Bad Request',
                activePage: 'error',
            });
        }
        throw err;
    }
});

// ---------------------------------------------------------------------------
//  API routes (proxy to Go server)
// ---------------------------------------------------------------------------

// Organizations CRUD
router.get('/api/panel/org', requireAuth, async (req, res) => {
    if (canAccessAllOrgs(req)) return goApiProxy(req, res, 'get', '/org');
    try {
        const resp = await apiClient({ method: 'get', url: '/org' });
        const orgs = Array.isArray(resp.data?.organizations) ? resp.data.organizations : [];
        const membership = await Promise.all(orgs.map(org =>
            findOrgMembership(req, org.id).catch(() => null)));
        res.json({ organizations: orgs.filter((_, i) => membership[i]) });
    } catch (err) {
        forwardGoError(res, err);
    }
});
router.post('/api/panel/org', requireAuth, requirePermission('org.create'), (req, res) => goApiProxy(req, res, 'post', '/org', req.body));
router.get('/api/panel/org/:id', requireAuth, requireOrgAccess, (req, res) =>
    goApiProxySafe(req, res, 'get', () => orgApiPath(req.params.id)));
router.put('/api/panel/org/:id', requireAuth, requirePermission('org.edit'), (req, res) =>
    goApiProxySafe(req, res, 'put', () => orgApiPath(req.params.id), req.body));
router.delete('/api/panel/org/:id', requireAuth, requirePermission('org.delete'), (req, res) =>
    goApiProxySafe(req, res, 'delete', () => orgApiPath(req.params.id)));

// Org Users
router.get('/api/panel/org/:id/users', requireAuth, async (req, res) => {
    try {
        const users = await fetchOrgUsers(req.params.id);
        if (canSeeAllOrgMembers(req)) return res.json({ users });

        // Without user.view / org.manage_users: org owners and admins still see
        // their members; any other member only sees themselves.
        const username = sessionUsername(req);
        const self = users.find(u => u && u.username === username);
        if (!self) {
            if (canAccessAllOrgs(req)) return res.json({ users: [] });
            return res.status(403).json({ error: 'Not a member of this organization' });
        }
        if (self.role === 'owner' || self.role === 'admin') return res.json({ users });
        return res.json({ users: [self] });
    } catch (err) {
        return forwardGoError(res, err);
    }
});
router.post('/api/panel/org/:id/users', requireAuth, requirePermission('org.manage_users'), (req, res) =>
    goApiProxySafe(req, res, 'post', () => orgApiPath(req.params.id, '/users'), req.body));
router.put('/api/panel/org/:id/users/:uid', requireAuth, requirePermission('org.manage_users'), (req, res) =>
    goApiProxySafe(req, res, 'put', () => orgUserApiPath(req.params.id, req.params.uid), req.body));
router.delete('/api/panel/org/:id/users/:uid', requireAuth, requirePermission('org.manage_users'), (req, res) =>
    goApiProxySafe(req, res, 'delete', () => orgUserApiPath(req.params.id, req.params.uid)));

// User-Org Linking (Issue #106)
router.get('/api/panel/org/:id/available-users', requireAuth, requirePermission('org.manage_users'), (req, res) =>
    goApiProxySafe(req, res, 'get', () => orgApiPath(req.params.id, '/available-users')));
router.post('/api/panel/org/:id/members', requireAuth, requirePermission('org.manage_users'), (req, res) =>
    goApiProxySafe(req, res, 'post', () => orgApiPath(req.params.id, '/members'), req.body));
router.delete('/api/panel/org/:id/members/:userId', requireAuth, requirePermission('org.manage_users'), async (req, res) => {
    try {
        const goUserId = await resolveGoMemberId(req.params.userId);
        return goApiProxySafe(req, res, 'delete', () => orgMemberApiPath(req.params.id, goUserId));
    } catch (err) {
        if (err.message && /^Invalid /.test(err.message)) {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: 'Failed to resolve user' });
    }
});

// Invitations
router.post('/api/panel/org/:id/invite', requireAuth, requirePermission('org.manage_users'), (req, res) =>
    goApiProxySafe(req, res, 'post', () => orgApiPath(req.params.id, '/invite'), req.body));
router.get('/api/panel/org/:id/invitations', requireAuth, requirePermission('org.manage_users'), (req, res) =>
    goApiProxySafe(req, res, 'get', () => orgApiPath(req.params.id, '/invitations')));

// Devices
router.post('/api/panel/org/:id/devices', requireAuth, requirePermission('org.manage_devices'), (req, res) =>
    goApiProxySafe(req, res, 'post', () => orgApiPath(req.params.id, '/devices'), req.body));
router.get('/api/panel/org/:id/devices', requireAuth, requireOrgAccess, (req, res) =>
    goApiProxySafe(req, res, 'get', () => orgApiPath(req.params.id, '/devices')));
router.delete('/api/panel/org/:id/devices/:did', requireAuth, requirePermission('org.manage_devices'), (req, res) =>
    goApiProxySafe(req, res, 'delete', () => orgDeviceApiPath(req.params.id, req.params.did)));

// Settings
router.get('/api/panel/org/:id/settings', requireAuth, requireOrgAccess, (req, res) =>
    goApiProxySafe(req, res, 'get', () => orgApiPath(req.params.id, '/settings')));
router.put('/api/panel/org/:id/settings', requireAuth, requirePermission('org.edit'), (req, res) =>
    goApiProxySafe(req, res, 'put', () => orgApiPath(req.params.id, '/settings'), req.body));

// Shared organization address book (Issue #190)
router.get('/api/panel/org/:id/address-book', requireAuth, requireOrgAccess, (req, res) =>
    goApiProxySafe(req, res, 'get', () => orgApiPath(req.params.id, '/address-book')));
router.put('/api/panel/org/:id/address-book', requireAuth, requirePermission('org.edit'), (req, res) =>
    goApiProxySafe(req, res, 'put', () => orgApiPath(req.params.id, '/address-book'), req.body));

// Encrypted org peer credential vault (#367)
router.get('/api/panel/org/:id/peer-credentials', requireAuth, requireOrgAccess, (req, res) =>
    goApiProxySafe(req, res, 'get', () => orgApiPath(req.params.id, '/peer-credentials')));
router.put('/api/panel/org/:id/peer-credentials/:peerId', requireAuth, requirePermission('org.edit'), (req, res) =>
    goApiProxySafe(req, res, 'put', () => orgApiPath(req.params.id, `/peer-credentials/${encodeURIComponent(req.params.peerId)}`), req.body));
router.delete('/api/panel/org/:id/peer-credentials/:peerId', requireAuth, requirePermission('org.edit'), (req, res) =>
    goApiProxySafe(req, res, 'delete', () => orgApiPath(req.params.id, `/peer-credentials/${encodeURIComponent(req.params.peerId)}`)));

/**
 * GET /api/panel/org/:id/device-groups
 * Device and user groups linked to this organization (team_id = org id).
 */
router.get('/api/panel/org/:id/device-groups', requireAuth, requireOrgAccess, async (req, res) => {
    try {
        const orgId = assertSafeApiId(req.params.id, 'orgId');
        const devices = await serverBackend.getAllDevices({});
        const allGroups = (await db.getAllDeviceGroups())
            .filter(group => deviceGroupService.folderIdFromGroupGuid(group.guid) === null)
            .filter(group => String(group.team_id || '').trim() === orgId);

        const deviceGroups = await deviceGroupService.enrichGroups(db, allGroups, devices);
        const userGroups = (await db.getAllUserGroups())
            .filter(group => String(group.team_id || '').trim() === orgId)
            .map(group => ({
                guid: group.guid,
                name: group.name,
                note: group.note || '',
                member_count: group.member_count || 0
            }));

        res.json({
            org_id: orgId,
            device_groups: deviceGroups,
            user_groups: userGroups
        });
    } catch (err) {
        if (err.message && /^Invalid /.test(err.message)) {
            return res.status(400).json({ error: err.message });
        }
        console.error('[org] List org device groups error:', err);
        res.status(500).json({ error: 'Failed to load organization groups' });
    }
});

module.exports = router;
