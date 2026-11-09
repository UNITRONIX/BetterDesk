/**
 * BetterDesk Console - Remote Desktop Routes
 * Serves the web-based remote desktop viewer page (RustDesk compat + BetterDesk native)
 */

const express = require('express');
const router = express.Router();
const db = require('../services/database');
const logger = require('../lib/logger').child('REMOTE');
const {
    requireRdClientAuth,
    rdClientGuestOnly,
    normalizeRdClientReturnUrl,
    requestHasPermission,
} = require('../middleware/auth');
const { rdClientPageLimiter } = require('../middleware/rateLimiter');
const betterdeskApi = require('../services/betterdeskApi');
const keyService = require('../services/keyService');
const serverConnectionConfig = require('../services/serverConnectionConfigService');
const {
    getGuestToken,
    getGuestTokenFromQuery,
    setGuestCookie,
    clearGuestCookie,
    attachGuestGrant,
    peerAllowedByGrant,
} = require('../middleware/guestAccess');
const devMockRemote = require('../lib/devMockRemote');

const DEFAULT_CONNECTION_SNAPSHOT = {
    p2p_first: true,
    always_use_relay: false,
    p2p_fallback_ms: 2000,
    same_nat_relay: true,
    allow_shared_nat_initiator: false,
    relay_servers: ''
};

/**
 * Snapshot of Go connection policy for RdClient web (timeouts / diagnostics).
 * Prefer live /api/health.connection; fall back to local Settings env read.
 */
async function resolveConnectionSnapshot() {
    try {
        const health = await betterdeskApi.getHealth();
        if (health && health.connection && typeof health.connection === 'object') {
            return {
                ...DEFAULT_CONNECTION_SNAPSHOT,
                ...health.connection
            };
        }
    } catch (err) {
        logger.debug('Connection snapshot from health failed:', err.message || err);
    }
    try {
        const mode = await serverConnectionConfig.getConnectionMode();
        return {
            ...DEFAULT_CONNECTION_SNAPSHOT,
            p2p_first: mode.mode !== 'relay_only',
            always_use_relay: mode.mode === 'relay_only',
            p2p_fallback_ms: Number(mode.p2p_fallback_ms) >= 0
                ? Number(mode.p2p_fallback_ms)
                : DEFAULT_CONNECTION_SNAPSHOT.p2p_fallback_ms,
            same_nat_relay: mode.same_nat_relay !== false,
            allow_shared_nat_initiator: mode.allow_shared_nat_initiator === true
        };
    } catch (err) {
        logger.debug('Connection snapshot from settings failed:', err.message || err);
    }
    return { ...DEFAULT_CONNECTION_SNAPSHOT };
}

/** The viewer's JSON twin (/api/remote/viewer/:id) answers errors as JSON, the page route as HTML */
function wantsJson(req) {
    return String(req.originalUrl || req.url || '').startsWith('/api/');
}

async function requireRemoteAccess(req, res, next) {
    const deviceId = req.params.deviceId;
    const isRemoteTarget = String(deviceId || '').startsWith('rt_');

    // Panel session with device.connect wins over a stale guest cookie (avoids hijack 403).
    const connectPermission = isRemoteTarget ? 'remote_target.connect' : 'device.connect';
    if (req.session && req.session.userId && requestHasPermission(req, connectPermission)) {
        return requireRdClientAuth(connectPermission)(req, res, next);
    }
    if (isRemoteTarget) return requireRdClientAuth(connectPermission)(req, res, next);

    const queryToken = getGuestTokenFromQuery(req);
    const guestToken = getGuestToken(req);

    // Guest Access Link — hard deny only for an explicit ?guest= / ?t= without a valid grant.
    // Cookie-only failures fall through to panel auth / login.
    if (guestToken && deviceId) {
        try {
            const grant = await attachGuestGrant(req, betterdeskApi, deviceId);
            if (grant && peerAllowedByGrant(grant, deviceId)) {
                setGuestCookie(res, guestToken, grant.expires_at);
                return next();
            }
        } catch (err) {
            logger.warn('Guest grant validate failed:', err.message || err);
        }
        if (queryToken) {
            logger.info('Guest remote deny (explicit query, invalid/expired/not allowed):', deviceId);
            if (wantsJson(req)) {
                return res.status(403).json({
                    success: false,
                    code: 'guest_denied',
                    error: req.t('guest_access.device_denied', 'This guest link is invalid, expired, or does not allow this device.'),
                });
            }
            return res.status(403).render('errors/403', {
                title: req.t('guest_access.invalid_title', 'Invalid guest link'),
                message: req.t('guest_access.device_denied', 'This guest link is invalid, expired, or does not allow this device.'),
            });
        }
        logger.debug('Stale guest cookie ignored; falling through to panel auth');
    }

    // Legacy mesh single-device share
    const share = String(req.query.mesh_share || '').trim();
    if (share && deviceId) {
        try {
            const result = await betterdeskApi.apiClient.get('/mesh/share/validate', {
                params: { token: share, peer_id: deviceId },
            });
            const data = result.data || {};
            if (data.valid) {
                req.meshShareGrant = data;
                return next();
            }
        } catch {
            // fall through to standard auth
        }
    }
    return requireRdClientAuth('device.connect')(req, res, next);
}

// Dev-only mock session script (404 unless BD_DEV_MOCK_REMOTE=1)
router.use(devMockRemote.router);

// Lazy-loaded relay helper — avoid circular require at module load time
function getRemoteRelay() {
    try { return require('../services/remoteRelay'); } catch { return null; }
}

// Resolve server public key on each viewer render (file may be stale/wrong;
// fall back to live Go /api/server-key — issue #340).
async function resolveServerPubKey() {
    try {
        return (await keyService.resolvePublicKey()) || '';
    } catch (err) {
        console.warn('Warning: Could not resolve server public key:', err.message);
        return '';
    }
}

/**
 * GET /remote/login - RdClient operator login (when panel session expired)
 */
router.get('/remote/login', rdClientPageLimiter, rdClientGuestOnly, (req, res) => {
    const returnUrl = normalizeRdClientReturnUrl(req.query.return) || '/remote';
    const sessionExpired = req.query.expired === '1' || req.query.expired === 'true';
    res.render('rdclient-login', {
        title: req.t('rdclient_login.title'),
        activePage: 'remote',
        returnUrl,
        sessionExpired,
    });
});

/**
 * GET /remote/guest - Guest Access Link entry (allowlist mini RdClient, no Console).
 */
router.get('/remote/guest', rdClientPageLimiter, async (req, res) => {
    const token = getGuestToken(req);
    if (!token) {
        return res.status(400).render('errors/403', {
            title: req.t('guest_access.invalid_title', 'Invalid guest link'),
            message: req.t('guest_access.missing_token', 'This guest link is missing a token.'),
        });
    }
    try {
        const result = await betterdeskApi.apiClient.get('/guest/access-links/peers', {
            params: { token },
        });
        const data = result.data || {};
        if (!data.valid) {
            logger.info('Guest peers invalid/expired');
            return res.status(403).render('errors/403', {
                title: req.t('guest_access.invalid_title', 'Invalid guest link'),
                message: data.error || req.t('guest_access.expired', 'This guest link is invalid or expired.'),
            });
        }
        setGuestCookie(res, token, data.expires_at);
        const guestMeta = {
            view_only: !!data.view_only,
            expires_at: data.expires_at || '',
            label: data.label || '',
            devices: data.devices || [],
        };
        try {
            res.render('remote-guest', {
                title: req.t('guest_access.title', 'Guest Remote'),
                activePage: 'remote',
                guestToken: token,
                guestMeta,
            });
        } catch (renderErr) {
            logger.error('Guest remote-guest render failed:', renderErr);
            if (!res.headersSent) {
                res.status(500).type('text/plain').send(
                    'Guest Remote page failed to render. Check console logs (LOG_LEVEL=info) and try again after updating.'
                );
            }
        }
    } catch (err) {
        logger.warn('Guest /remote/guest peers/API error:', err.response?.data?.error || err.message);
        if (!res.headersSent) {
            return res.status(403).render('errors/403', {
                title: req.t('guest_access.invalid_title', 'Invalid guest link'),
                message: err.response?.data?.error || err.message,
            });
        }
    }
});

/**
 * What the remote client's pages without a session may show: the console's
 * name and logo, the languages and a CSRF token for the sign-in form. No
 * user data.
 */
function publicPageInfo(req, res) {
    let branding = {};
    let languages = [];
    let appVersion = '';
    try { branding = require('../services/brandingService').getBranding() || {}; } catch { branding = {}; }
    try {
        languages = require('../services/i18nService').manager.getAvailableList().map((l) => ({
            code: l.code,
            name: l.name,
            native: l.native || l.name,
            flag: l.flag || '',
            rtl: !!l.rtl
        }));
    } catch { languages = []; }
    try { appVersion = require('../config/config').appVersion || ''; } catch { appVersion = ''; }
    return {
        appName: branding.appName || 'BetterDesk',
        appVersion,
        branding: {
            logoType: branding.logoType || null,
            logoIcon: branding.logoIcon || '',
            logoSvg: branding.logoSvg || '',
            logoUrl: branding.logoUrl || '',
            logoText: branding.logoText || '',
            logoTextAccent: branding.logoTextAccent || ''
        },
        languages,
        csrfToken: res.locals.csrfToken || ''
    };
}

/**
 * GET /api/remote/login-info?return=<path> - The new /remote/login page's data:
 * where to go after sign-in (a path under /remote, as normalizeRdClientReturnUrl
 * allows) and whether this browser is signed in with device.connect already
 * (rdClientGuestOnly sends those straight on).
 */
router.get('/api/remote/login-info', rdClientPageLimiter, (req, res) => {
    const role = req.session && req.session.user && req.session.user.role;
    const signedIn = !!(req.session && req.session.userId && role !== 'pro' && requestHasPermission(req, 'device.connect'));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        success: true,
        signedIn,
        returnUrl: normalizeRdClientReturnUrl(typeof req.query.return === 'string' ? req.query.return : '') || '/remote',
        ...publicPageInfo(req, res)
    });
});

/**
 * GET /api/remote/guest-info?t=<token> - The new /remote/guest page's data,
 * with the checks of GET /remote/guest: the token (query or guest cookie) must
 * be valid on the Go server; a valid one is stored in the guest cookie.
 */
router.get('/api/remote/guest-info', rdClientPageLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const page = publicPageInfo(req, res);
    const token = getGuestToken(req);
    if (!token) {
        return res.status(400).json({
            success: false,
            code: 'missing_token',
            error: req.t('guest_access.missing_token', 'This guest link is missing a token.'),
            page
        });
    }
    try {
        const result = await betterdeskApi.apiClient.get('/guest/access-links/peers', { params: { token } });
        const data = result.data || {};
        if (!data.valid) {
            return res.status(403).json({
                success: false,
                code: 'invalid',
                error: data.error || req.t('guest_access.expired', 'This guest link is invalid or expired.'),
                page
            });
        }
        setGuestCookie(res, token, data.expires_at);
        return res.json({
            success: true,
            token,
            guest: {
                view_only: !!data.view_only,
                expires_at: data.expires_at || '',
                label: data.label || '',
                devices: Array.isArray(data.devices) ? data.devices : []
            },
            page
        });
    } catch (err) {
        logger.warn('Guest guest-info peers/API error:', err.response?.data?.error || err.message);
        return res.status(403).json({
            success: false,
            code: 'invalid',
            error: err.response?.data?.error || req.t('guest_access.expired', 'This guest link is invalid or expired.'),
            page
        });
    }
});

/**
 * GET /remote - RdClient operator dashboard (device list + connect)
 */
router.get('/remote', rdClientPageLimiter, requireRdClientAuth('device.connect'), (req, res) => {
    clearGuestCookie(res);
    res.render('remote-dashboard', {
        title: req.t('remote_dashboard.title'),
        activePage: 'remote',
    });
});

/**
 * GET /api/remote/desk - The new remote dashboard asks this first: the same
 * check as GET /remote (device.connect), and like it, it drops a guest cookie
 * left from a guest link so the console session is used from here on.
 */
router.get('/api/remote/desk', rdClientPageLimiter, requireRdClientAuth('device.connect'), (req, res) => {
    clearGuestCookie(res);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true });
});

/** Legacy bottom-nav / bookmarks used this path; keep a permanent redirect. */
router.get('/remote-dashboard', (_req, res) => {
    res.redirect(301, '/remote');
});

/**
 * Everything the viewer needs for one device, after requireRemoteAccess let
 * the request through. Shared by the page (/remote/:deviceId) and its JSON
 * twin (/api/remote/viewer/:deviceId) so both apply the same rules.
 * Returns { status: 400 | 404 } when there is nothing to show.
 */
async function resolveViewer(req) {
    const deviceId = req.params.deviceId;

    if (!deviceId || deviceId === 'login' || !/^[A-Za-z0-9_-]{3,64}$/.test(deviceId)) {
        return { status: 400 };
    }

    const isRemoteTarget = deviceId.startsWith('rt_');
    let device = null;
    try {
        device = isRemoteTarget
            ? await betterdeskApi.getRemoteTarget(deviceId)
            : await db.getDevice(deviceId);
    } catch {
        // Database lookup failure is non-blocking - viewer can still work
    }
    // A remote target's protocol and settings come from its record: without
    // one there is nothing to connect to
    if (isRemoteTarget && !device) return { status: 404 };

    let isOsAgent = false;
    let isCdapConnected = false;
    let isMeshAgent = false;
    let meshConnected = false;
    let goPeer = null;
    try {
        const api = require('../services/betterdeskApi');
        goPeer = isRemoteTarget
            ? device
            : await api.getPeer(deviceId);
        if (goPeer) {
            isOsAgent = !isRemoteTarget && String(goPeer.device_type || '').toLowerCase() === 'os_agent';
            isCdapConnected = !!goPeer.cdap_connected;
            isMeshAgent = !isRemoteTarget && String(goPeer.device_type || '').toLowerCase() === 'mesh_agent';
            meshConnected = !!goPeer.mesh_connected;
        }
    } catch { /* non-fatal: degrade to standard viewer */ }

    const forced = String(req.query.transport || '').toLowerCase();
    let transport;
    if (isRemoteTarget) {
        transport = String(device.remote_protocol || device.protocol || '').toLowerCase();
    } else if (forced === 'mesh' || forced === 'cdap' || forced === 'rd') {
        transport = forced;
    } else if (isMeshAgent && meshConnected) {
        transport = 'mesh';
    } else if (isOsAgent || isCdapConnected) {
        transport = 'cdap';
    } else {
        transport = 'rd';
    }

    const capabilities = {
        transport,
        os_agent: isOsAgent,
        cdap_connected: isCdapConnected,
        mesh_connected: meshConnected,
        device_type: goPeer && goPeer.device_type ? String(goPeer.device_type) : '',
        mesh_share: req.meshShareGrant ? true : false,
        mesh_view_only: req.meshShareGrant && req.meshShareGrant.view_only ? true : false,
        remote_target: isRemoteTarget,
        remote_protocol: isRemoteTarget ? transport : '',
        remote_target_config: isRemoteTarget ? {
            id: device.id,
            name: device.name || device.display_name || '',
            username: device.username || '',
            credential_mode: device.credential_mode || 'prompt',
            tls_mode: device.tls_mode || 'preferred',
            cert_fingerprint: device.cert_fingerprint || ''
        } : null,
        guest_access: !!req.guestGrant,
        guest_view_only: !!(req.guestGrant && req.guestGrant.view_only),
        guest_peer_ids: req.guestGrant && Array.isArray(req.guestGrant.peer_ids) ? req.guestGrant.peer_ids : [],
    };

    return {
        status: 200,
        deviceId,
        isRemoteTarget,
        device,
        capabilities,
        serverPubKey: await resolveServerPubKey(),
        connection: await resolveConnectionSnapshot(),
        guestToken: req.guestToken || getGuestTokenFromQuery(req) || '',
        mockRemote: devMockRemote.forRequest(req),
    };
}

/**
 * GET /remote/:deviceId - Unified remote desktop viewer (single entry point).
 */
router.get('/remote/:deviceId', rdClientPageLimiter, requireRemoteAccess, async (req, res) => {
    const v = await resolveViewer(req);
    if (v.status === 400) return res.redirect('/devices');
    if (v.status === 404) {
        return res.status(404).render('errors/404', {
            title: req.t('errors.not_found_title'),
            message: req.t('errors.not_found_message')
        });
    }
    res.render('remote', {
        title: `${req.t('remote.title')} - ${v.deviceId}`,
        activePage: 'remote',
        deviceId: v.deviceId,
        device: v.device || { id: v.deviceId, hostname: '', platform: '', note: '' },
        serverPubKey: v.serverPubKey,
        connection: v.connection,
        capabilities: v.capabilities,
        guestToken: v.guestToken,
        mockRemote: v.mockRemote,
        layout: 'viewer'
    });
});

/**
 * GET /api/remote/viewer/:deviceId - The new viewer's data (web-ui), with the
 * same access rules as the page: a console session with device.connect
 * (remote_target.connect for rt_ targets), a guest grant for this device or
 * a mesh share. mockRemote is set only with BD_DEV_MOCK_REMOTE=1 and ?mock=1.
 */
router.get('/api/remote/viewer/:deviceId', rdClientPageLimiter, requireRemoteAccess, async (req, res) => {
    const v = await resolveViewer(req);
    res.setHeader('Cache-Control', 'no-store');
    if (v.status === 400) {
        return res.status(400).json({ success: false, code: 'invalid_id', error: 'Invalid device ID' });
    }
    if (v.status === 404) {
        return res.status(404).json({ success: false, code: 'not_found', error: req.t('errors.not_found_message') });
    }
    const d = v.device || {};
    const user = req.session && req.session.userId && req.session.user ? req.session.user : null;
    res.json({
        success: true,
        deviceId: v.deviceId,
        device: {
            name: d.display_name || d.hostname || (v.isRemoteTarget ? d.name || '' : ''),
            platform: d.platform || d.os || ''
        },
        capabilities: v.capabilities,
        serverPubKey: v.serverPubKey,
        connection: v.connection,
        guestToken: v.guestToken,
        mockRemote: v.mockRemote,
        user: user
            ? { id: user.id != null ? user.id : req.session.userId, name: user.display_name || user.username || '' }
            : null,
        // The work report after a billed session needs billing.reports (its API does)
        workReports: !!user && requestHasPermission(req, 'billing.reports'),
        csrfToken: res.locals.csrfToken || ''
    });
});

/**
 * GET /remote-cdap/:deviceId - Legacy alias, redirects to unified entry.
 */
router.get('/remote-cdap/:deviceId', rdClientPageLimiter, requireRdClientAuth('device.connect'), (req, res) => {
    const deviceId = req.params.deviceId;
    if (deviceId && /^[A-Za-z0-9_-]{3,64}$/.test(deviceId)) {
        return res.redirect(`/remote/${encodeURIComponent(deviceId)}?transport=cdap`);
    }
    return res.redirect('/devices');
});

/**
 * GET /remote-desktop/:deviceId - Legacy route, redirects to unified /remote/:deviceId
 */
router.get('/remote-desktop/:deviceId', rdClientPageLimiter, requireRdClientAuth('device.connect'), (req, res) => {
    const deviceId = req.params.deviceId;
    if (deviceId && /^[A-Za-z0-9_-]{3,64}$/.test(deviceId)) {
        return res.redirect(`/remote/${encodeURIComponent(deviceId)}`);
    }
    return res.redirect('/devices');
});

/**
 * GET /api/remote/sessions - List active native remote sessions
 */
router.get('/api/remote/sessions', requireRdClientAuth(), (req, res) => {
    const relay = getRemoteRelay();
    if (!relay) return res.json({ sessions: [] });
    const sessions = relay.getActiveSessions();
    res.json({ sessions });
});

/**
 * GET /api/remote/session/:deviceId - Get state of a single native remote session
 */
router.get('/api/remote/session/:deviceId', requireRdClientAuth(), (req, res) => {
    const relay = getRemoteRelay();
    if (!relay) return res.status(404).json({ error: 'Remote relay not available' });
    const state = relay.getSessionState(req.params.deviceId);
    if (!state) return res.status(404).json({ error: 'Session not found' });
    res.json(state);
});

module.exports = router;
