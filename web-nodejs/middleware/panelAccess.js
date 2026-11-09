'use strict';

const { accessAllows } = require('../services/panelAccessPolicyService');
const { ACCESS_LEVELS } = require('../lib/panelAccessCatalog');

const ROUTE_RULES = [
    { path: '/', section: 'dashboard' },
    { prefix: '/inventory', section: 'devices' },
    { prefix: '/tickets', section: 'tickets' },
    { prefix: '/help-requests', section: 'help-requests' },
    { prefix: '/automation', section: 'automation' },
    { prefix: '/network', section: 'network' },
    { prefix: '/registrations', section: 'registrations' },
    { prefix: '/cdap', section: 'cdap' },
    { prefix: '/fleet', section: 'fleet' },
    { prefix: '/chat', section: 'chat' },
    { prefix: '/scaling', section: 'scaling' },
    { prefix: '/cross-platform', section: 'cross-platform' },
    { prefix: '/reports', section: 'reports' },
    { prefix: '/agents', section: 'agents' },
    { prefix: '/toolkit', section: 'toolkit' },
    { prefix: '/keys', section: 'settings' },
    { prefix: '/tokens', section: 'settings' },
    { prefix: '/policies', section: 'settings' },
    { prefix: '/attestation', section: 'server-attestation' },
    { prefix: '/dataguard', section: 'dataguard' },
    { prefix: '/security-audit', section: 'security-audit' },
    { prefix: '/permissions', section: 'permissions' },
    { prefix: '/languages', section: 'languages' },
    { prefix: '/resource-control', section: 'resource-control' },
    { prefix: '/server-management', section: 'server-management' },
    { prefix: '/client-branding', section: 'settings' },
    { prefix: '/cdap-studio', section: 'cdap' },
    { prefix: '/users', section: 'users' },
    { prefix: '/api/users', section: 'users' },
    { prefix: '/api/panel/user-groups', section: 'users' },
    { prefix: '/api/panel/access', section: 'users' },
    { prefix: '/api/guest', section: 'guests' },
    { prefix: '/api/folders', section: 'folders' },
    { prefix: '/organizations', section: 'organizations' },
    { prefix: '/api/organizations', section: 'organizations' },
    { prefix: '/devices', section: 'devices' },
    { prefix: '/api/devices', section: 'devices' },
    { prefix: '/api/device-groups', section: 'devices' },
    { prefix: '/api/tags', section: 'devices' },
    { prefix: '/api/panel/strategies', section: 'strategies' },
    { prefix: '/folders', section: 'folders' },
    { prefix: '/remote', section: 'remote' },
    { prefix: '/api/remote', section: 'remote' },
    { prefix: '/api/tickets', section: 'tickets' },
    { prefix: '/api/automation', section: 'automation' },
    { prefix: '/api/network', section: 'network' },
    { prefix: '/api/dataguard', section: 'dataguard' },
    { prefix: '/api/reports', section: 'reports' },
    { prefix: '/api/activity', section: 'activity' },
    { prefix: '/api/files', section: 'files' },
    { prefix: '/api/scaling', section: 'scaling' },
    { prefix: '/api/cross-platform', section: 'cross-platform' },
    { prefix: '/api/toolkit', section: 'toolkit' },
    { prefix: '/api/security-audit', section: 'security-audit' },
    { prefix: '/api/languages', section: 'languages' },
    { prefix: '/api/resource-control', section: 'resource-control' },
    { prefix: '/api/server-management', section: 'server-management' },
    { prefix: '/api/server-attestation', section: 'server-attestation' },
    { prefix: '/api/registrations', section: 'registrations' },
    { prefix: '/api/settings', section: 'settings' },
    { prefix: '/settings', section: 'settings' },
    { prefix: '/api/panel/billing', section: 'commercialization' },
    { prefix: '/commercialization', section: 'commercialization' },
    { prefix: '/reports', section: 'reports' },
    { prefix: '/activity', section: 'activity' },
];

function findRule(pathname) {
    return ROUTE_RULES
        .filter((rule) => rule.path
            ? pathname === rule.path
            : pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`))
        .sort((left, right) => (right.prefix || right.path).length - (left.prefix || left.path).length)[0] || null;
}

function getRequiredLevel(req) {
    return ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
        ? ACCESS_LEVELS.READ
        : ACCESS_LEVELS.WRITE;
}

function panelAccessGuard(req, res, next) {
    const rule = findRule(req.path);
    if (!rule || !req.session?.userId || !req.session.user) return next();
    req.panelAccessSection = rule.section;
    if (req.panelAccessPolicyLoadError) {
        if (req.path.startsWith('/api/')) {
            return res.status(503).json({
                success: false,
                error: 'Panel access policy unavailable',
                code: 'panel_access_policy_unavailable',
            });
        }
        // The console's error page (lib/webUi.js), or plain text without a build
        const message = 'Panel access policy unavailable';
        if (typeof res.sendErrorPage === 'function' && res.sendErrorPage(500, { status: 503, message })) return undefined;
        return res.status(503).type('text').send(message);
    }
    if (accessAllows(req.panelAccessPolicy, rule.section, getRequiredLevel(req))) return next();
    if (req.path.startsWith('/api/')) {
        return res.status(403).json({
            success: false,
            error: `Panel access denied: ${rule.section}`,
            code: 'panel_access_denied',
        });
    }
    const message = 'You do not have permission to access this panel section';
    if (typeof res.sendErrorPage === 'function' && res.sendErrorPage(403, { message })) return undefined;
    return res.status(403).type('text').send(message);
}

module.exports = {
    findRule,
    getRequiredLevel,
    panelAccessGuard,
};
