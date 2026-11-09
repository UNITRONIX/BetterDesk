/**
 * BetterDesk Console - Auth Routes
 * Login, logout, session verification
 */

const express = require('express');
const router = express.Router();
const net = require('net');
const authService = require('../services/authService');
const db = require('../services/database');
const betterdeskApi = require('../services/betterdeskApi');
const brandingService = require('../services/brandingService');
const userSync = require('../services/userSync');
const avatarService = require('../services/avatarService');
let serverAttestation;
try {
    serverAttestation = require('../services/serverAttestation');
} catch (err) {
    console.warn('[auth] serverAttestation unavailable:', err.message);
    serverAttestation = {
        getLastResult: async () => null,
        buildPublicSummary: () => ({ tier: null, maxConnections: null }),
        getBadgePresentation: async () => null
    };
}
const { requireAuth } = require('../middleware/auth');
const { clearGuestCookie } = require('../middleware/guestAccess');
const { loginLimiter, passwordChangeLimiter } = require('../middleware/rateLimiter');
const panelSessionService = require('../services/panelSessionService');
const { END_REASONS } = require('../lib/sessionPolicy');
const { safeReturnPath } = require('../lib/returnUrl');
const { manager: i18nManager } = require('../services/i18nService');
const config = require('../config/config');

/**
 * Where to go after sign-in: the ?return= path when it is a path on this
 * console (lib/returnUrl.js, stricter than auth.IsRelativeReturnURL in the
 * Go server), otherwise the start page.
 */
function returnPathOr(raw, fallback = '/') {
    return safeReturnPath(raw) || fallback;
}

/** The sign-in page's capacity badge (Settings › Server attestation), or one that says nothing */
async function attestationSummary(req) {
    try {
        const last = await serverAttestation.getLastResult();
        const presentation = await serverAttestation.getBadgePresentation({
            tier: last && last.tier,
            translate: req.t,
            brandName: brandingService.getBranding().appName
        });
        return serverAttestation.buildPublicSummary(last, presentation);
    } catch (_) {
        return { tier: null, maxConnections: null };
    }
}

function isPrivateClientIp(rawIp) {
    let ip = String(rawIp || '').trim().toLowerCase();
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (net.isIP(ip) === 4) {
        const octets = ip.split('.').map(Number);
        return octets[0] === 10 ||
            (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
            (octets[0] === 192 && octets[1] === 168) ||
            octets[0] === 127;
    }
    if (net.isIP(ip) === 6) {
        return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd');
    }
    return false;
}

async function bestEffortUserSync(action, label) {
    try {
        await action();
    } catch (err) {
        console.warn(`[auth] ${label} sync failed:`, err.message);
    }
}

const PROMO_MODES = new Set(['classic', 'single', 'slides']);

/**
 * GET /api/auth/login-page - What the new sign-in page (web-ui) shows before
 * anyone is signed in, the same values the old page rendered: the CSRF
 * token for the sign-in requests, name, version and branding of the
 * console, the languages and the capacity badge. No user data.
 */
router.get('/api/auth/login-page', async (req, res) => {
    const branding = brandingService.getBranding() || {};
    const mode = PROMO_MODES.has(branding.loginPromoMode) ? branding.loginPromoMode : 'classic';
    const slides = mode === 'slides' && Array.isArray(branding.loginSlides) ? branding.loginSlides : [];
    const badge = await attestationSummary(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        success: true,
        csrfToken: res.locals.csrfToken || '',
        appName: branding.appName || config.appName || 'BetterDesk',
        appVersion: config.appVersion || '',
        // The old desktop mode's cookie still asks for the compact sign-in
        desktopMode: !!(req.cookies && req.cookies.betterdesk_desktop_mode === 'true'),
        // Whether this browser has a console session: error pages then keep the
        // console shell, and nobody else gets a refused session request
        signedIn: !!(req.session && req.session.userId
            && !(req.session.user && req.session.user.role === 'pro')),
        branding: {
            logoType: branding.logoType || 'default',
            logoSvg: branding.logoSvg || '',
            logoUrl: branding.logoUrl || '',
            logoText: branding.logoText || '',
            logoTextAccent: branding.logoTextAccent || '',
            loginTitle: branding.loginTitle || '',
            loginSubtitle: branding.loginSubtitle || '',
            loginPromoMode: mode,
            loginSlides: slides.map((s) => ({
                id: String(s.id || ''),
                slideKey: String(s.slideKey || ''),
                imageUrl: String(s.imageUrl || ''),
                title: String(s.title || ''),
                body: String(s.body || ''),
                overlay: Number(s.overlay) || 0
            })),
            footerText: branding.footerText || '',
            showPoweredBy: String(branding.showPoweredBy) !== 'false'
        },
        languages: i18nManager.getAvailableList().map((l) => ({
            code: l.code,
            name: l.name,
            native: l.native || l.name,
            flag: l.flag || '',
            rtl: !!l.rtl
        })),
        attestation: badge && badge.valid && badge.tier
            ? {
                tier: String(badge.tier),
                brand: badge.brand || '',
                badgeTitle: badge.badgeTitle || '',
                tierLabel: badge.tierLabel || ''
            }
            : null
    });
});

/**
 * POST /api/auth/login - Login API
 */
router.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const clientMeta = panelSessionService.clientMetaFromRequest(req, req.body || {});
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: req.t('auth.invalid_credentials')
            });
        }

        // Input length validation to prevent DoS via bcrypt
        if (username.length > 128 || password.length > 128) {
            return res.status(400).json({
                success: false,
                error: req.t('auth.invalid_credentials')
            });
        }
        
        const user = await authService.authenticate(username, password);

        if (authService.isAuthFailure(user)) {
            authService.recordAttempt(username, req.ip, false);
            await db.logAction(
                null,
                'login_failed',
                `Username collision: ${username}; ip=${clientMeta.ip}; ua=${clientMeta.userAgent.slice(0, 160)}`,
                req.ip
            );

            if (user.__authFailure === 'username_collision') {
                return res.status(409).json({
                    success: false,
                    error: req.t('auth.username_collision'),
                    code: 'username_collision',
                });
            }

            return res.status(401).json({
                success: false,
                error: req.t('auth.invalid_credentials'),
            });
        }
        
        if (!user) {
            // Record failed attempt (shared brute-force tracker with /api/bd/operator/login)
            authService.recordAttempt(username, req.ip, false);
            await db.logAction(
                null,
                'login_failed',
                `Username: ${username}; ip=${clientMeta.ip}; ua=${clientMeta.userAgent.slice(0, 160)}`,
                req.ip
            );
            
            return res.status(401).json({
                success: false,
                error: req.t('auth.invalid_credentials')
            });
        }
        
        // Clear brute-force lockout on successful auth (shared with operator_login)
        authService.recordAttempt(username, req.ip, true);
        
        // Block pro-only accounts from web panel login
        if (user.role === 'pro') {
            return res.status(403).json({
                success: false,
                error: req.t('auth.pro_only_account')
            });
        }
        
        // Check if TOTP verification is required
        if (user.totpRequired) {
            // Store pending 2FA session
            req.session.pendingTotpUserId = user.id;
            req.session.pendingTotpUser = user;
            req.session.pendingClientMeta = clientMeta;
            // Phase A: store Go partial token for delegated TOTP verification
            if (user.goPartialToken) {
                req.session.goPartialToken = user.goPartialToken;
            }
            
            return res.json({
                success: true,
                totpRequired: true
            });
        }
        
        // Regenerate session to prevent session fixation
        req.session.regenerate(async (err) => {
            if (err) {
                console.error('Session regeneration error:', err);
                return res.status(500).json({ success: false, error: 'Server error' });
            }

            try {
                const { replaced } = await panelSessionService.establishAuthenticatedSession(req, user, {
                    meta: clientMeta,
                    extra: user.emergencyMode ? { emergencyMode: true } : undefined
                });
                clearGuestCookie(res);

                const replaceNote = replaced.length
                    ? `; replaced=${replaced.length} prior session(s)`
                    : '';
                await db.logAction(
                    user.id,
                    'login',
                    `User logged in; ip=${clientMeta.ip}; ua=${clientMeta.userAgent.slice(0, 160)}; ` +
                    `fingerprint=${clientMeta.clientFingerprint || 'none'}${replaceNote}`,
                    req.ip
                );
                if (replaced.length) {
                    await db.logAction(
                        user.id,
                        'session_replaced',
                        `New login replaced ${replaced.length} prior session(s); newIp=${clientMeta.ip}`,
                        req.ip
                    );
                }

                res.json({
                    success: true,
                    user: {
                        username: user.username,
                        role: user.role
                    },
                    // Where the page goes next: the ?return= path it sent, when safe (R3)
                    redirect: returnPathOr(req.body && req.body.return),
                    session: {
                        replacedPriorSessions: replaced.length,
                        idleTimeoutMs: panelSessionService.getPolicy().idleTimeoutMs,
                        maxAgeMs: panelSessionService.getPolicy().maxAgeMs
                    }
                });
            } catch (sessionErr) {
                console.error('Session establish error:', sessionErr);
                return res.status(500).json({ success: false, error: 'Server error' });
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({
            success: false,
            error: req.t('errors.server_error')
        });
    }
});

/**
 * POST /api/auth/logout - Logout API
 */
router.post('/api/auth/logout', async (req, res) => {
    const userId = req.session?.userId;
    
    if (userId) {
        await db.logAction(userId, 'logout', 'User logged out', req.ip);
    }
    await panelSessionService.endCurrentSession(req, END_REASONS.LOGOUT);
    
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error:', err);
        }
        res.clearCookie(req.sessionID ? req.session?.cookie?.name : 'betterdesk.sid');
        res.clearCookie('betterdesk.sid');
        res.clearCookie('bd.sid');
        res.json({ success: true });
    });
});

/**
 * GET /api/auth/verify - Verify session is valid
 */
router.get('/api/auth/verify', requireAuth, (req, res) => {
    const policy = panelSessionService.getPolicy();
    const createdAt = Number(req.session.createdAt) || null;
    const lastActivityAt = Number(req.session.lastActivityAt) || null;
    const now = Date.now();
    res.json({
        success: true,
        user: req.session.user,
        session: {
            createdAt,
            lastActivityAt,
            loginIp: req.session.loginIp || null,
            idleTimeoutMs: policy.idleTimeoutMs,
            maxAgeMs: policy.maxAgeMs,
            warnBeforeMs: policy.warnBeforeMs,
            idleExpiresAt: lastActivityAt ? lastActivityAt + policy.idleTimeoutMs : null,
            absoluteExpiresAt: createdAt ? createdAt + policy.maxAgeMs : null,
            serverNow: now
        }
    });
});

/**
 * GET /api/auth/sessions - Current user's panel session history (owner only)
 */
router.get('/api/auth/sessions', requireAuth, async (req, res) => {
    try {
        const sessions = await panelSessionService.listSessionsForUser(
            req.session.userId,
            req.sessionID,
            { includeEnded: true, limit: 50 }
        );
        res.json({
            success: true,
            data: {
                sessions,
                policy: panelSessionService.getPolicy()
            }
        });
    } catch (err) {
        console.error('List sessions error:', err);
        res.status(500).json({ success: false, error: req.t('errors.server_error') });
    }
});

/**
 * POST /api/auth/password - Change password
 */
router.post('/api/auth/password', requireAuth, passwordChangeLimiter, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: req.t('auth.password_required')
            });
        }
        
        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                error: req.t('auth.passwords_mismatch')
            });
        }
        
        const result = await authService.changePassword(
            req.session.userId,
            currentPassword,
            newPassword
        );
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        await bestEffortUserSync(
            async () => {
                const user = req.session.user?.username ? req.session.user : await db.getUserById(req.session.userId);
                await userSync.mirrorUpdate(user?.username, { password: newPassword });
            },
            'password change'
        );
        
        // Log password change
        await db.logAction(req.session.userId, 'password_changed', 'Password changed', req.ip);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Password change error:', err);
        res.status(500).json({
            success: false,
            error: req.t('errors.server_error')
        });
    }
});

/**
 * GET /logout - Logout (redirect)
 */
router.get('/logout', async (req, res) => {
    const userId = req.session?.userId;
    if (userId) {
        try {
            await db.logAction(userId, 'logout', 'User logged out', req.ip);
        } catch (_) { /* best-effort */ }
    }
    await panelSessionService.endCurrentSession(req, END_REASONS.LOGOUT);
    req.session.destroy(() => {
        res.clearCookie('betterdesk.sid');
        res.clearCookie('bd.sid');
        res.redirect('/login');
    });
});

// ==================== OIDC/OAuth2 Routes ====================

const crypto = require('crypto');
const bcrypt = require('bcrypt');

/**
 * GET /api/auth/oidc/status - Public endpoint for login page
 * Returns whether OIDC is enabled and the display name for the button.
 */
router.get('/api/auth/oidc/status', async (req, res) => {
    try {
        const result = await betterdeskApi.getOIDCStatus();
        if (!result.success) {
            return res.json({ enabled: false });
        }
        res.json({
            ...result.data,
            local_bypass: isPrivateClientIp(req.ip || req.socket?.remoteAddress)
        });
    } catch (err) {
        res.json({ enabled: false });
    }
});

/**
 * GET /api/auth/oidc/authorize - Redirect browser to OIDC IdP
 *
 * Go builds state/nonce/PKCE and returns 302 Location to the IdP.
 * We resolve that URL server-to-server so the browser is never sent to the
 * internal BETTERDESK_API_URL (often http://localhost:21114) — issue #298.
 */
router.get('/api/auth/oidc/authorize', async (req, res) => {
    const requested = typeof req.query.return_url === 'string' ? req.query.return_url : '/';
    const returnUrl = returnPathOr(requested);
    try {
        const result = await betterdeskApi.startOIDCAuthorize(returnUrl);
        if (!result.success || !result.data?.auth_url) {
            return res.redirect('/login?error=oidc_error');
        }
        return res.redirect(result.data.auth_url);
    } catch (err) {
        return res.redirect('/login?error=oidc_error');
    }
});

/**
 * GET /api/auth/oidc/callback and GET /api/oidc/callback
 *
 * IdP redirect target. Proxies to Go so operators can register the *panel*
 * public URL as Redirect URL (common on :5000/:5443) while pending OIDC state
 * and RustDesk client completion still live on the Go API (#304).
 */
async function handlePanelOIDCCallback(req, res) {
    try {
        await betterdeskApi.proxyOIDCCallback(req, res);
    } catch (err) {
        console.error('[OIDC] panel callback proxy error:', err.message);
        if (!res.headersSent) {
            res.status(502).type('text/plain').send('OIDC callback proxy failed');
        }
    }
}

router.get('/api/auth/oidc/callback', handlePanelOIDCCallback);
router.get('/api/oidc/callback', handlePanelOIDCCallback);

/**
 * GET /api/auth/oidc/session - Session creation after OIDC callback.
 *
 * Security model: Go server NEVER passes the JWT or user identity through
 * the browser URL bar. Instead the IdP callback handler stores a one-time
 * auth code (60s TTL) and redirects here with only `?code=<32 bytes>`.
 * Node.js POSTs back to Go's /api/auth/oidc/exchange (server-to-server)
 * to retrieve the JWT plus the verified username/role.
 *
 * This prevents JWT/role leakage via:
 *   - browser history / Referer headers
 *   - access logs (Go, Node.js, reverse proxy)
 *   - role spoofing through URL tampering
 */
router.get('/api/auth/oidc/session', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';

    if (!code) {
        return res.redirect('/login?error=oidc_invalid');
    }

    try {
        // Server-to-server exchange. Go returns { token, username, role, return_url }
        // only for a valid, unconsumed, unexpired code.
        const exchange = await betterdeskApi.exchangeOIDCCode(code);
        if (!exchange || !exchange.success || !exchange.data || !exchange.data.token || !exchange.data.username) {
            console.warn('[OIDC] Exchange rejected by Go server');
            return res.redirect('/login?error=oidc_invalid');
        }

        const { token, username, role, return_url } = exchange.data;

        // Defense in depth: re-validate the return URL Go provided.
        const safeReturnUrl = returnPathOr(return_url);

        // Look up the local user (may have been auto-provisioned by Go).
        let user = await db.getUserByUsername(username);

        if (!user) {
            // Mirror Go-side auto-provisioning into auth.db so sessions persist
            // and middleware/RBAC can resolve the user ID locally.
            const randomPass = crypto.randomBytes(32).toString('hex');
            const hash = await bcrypt.hash(randomPass, 12);
            try {
                await db.createUser(username, hash, role || 'viewer', 'oidc');
            } catch (err) {
                console.error('[OIDC] Failed to auto-provision local user', username, err.message);
            }
            user = await db.getUserByUsername(username);
        } else {
            try {
                await db.syncUserFromGo(user.id, {
                    role: role || user.role,
                    authProvider: 'oidc',
                });
                user = await db.getUserByUsername(username);
            } catch (err) {
                console.warn('[OIDC] Failed to sync local user from Go', username, err.message);
            }
        }

        if (!user) {
            return res.redirect('/login?error=oidc_error');
        }

        // Profile picture from the IdP's "picture" claim. Runs in the
        // background: a slow or failing picture fetch never delays or stops
        // the sign-in (services/avatarService.js).
        avatarService.syncOidcPicture(user.id, exchange.data);

        // Regenerate session to prevent fixation across the authentication boundary.
        req.session.regenerate(async (err) => {
            if (err) {
                console.error('OIDC session regenerate error:', err);
                return res.redirect('/login?error=oidc_error');
            }

            // Trust the role from the exchange response (server-to-server), not
            // the URL. Fall back to the locally stored role only if Go omitted one.
            const effectiveRole = role || user.role || 'viewer';
            const clientMeta = panelSessionService.clientMetaFromRequest(req);

            try {
                const { replaced } = await panelSessionService.establishAuthenticatedSession(req, {
                    id: user.id,
                    username: user.username,
                    role: effectiveRole,
                    preferred_language: user.preferred_language || null
                }, {
                    meta: clientMeta,
                    extra: {
                        username: user.username,
                        role: effectiveRole,
                        goToken: token,
                        authMethod: 'oidc'
                    }
                });
                clearGuestCookie(res);

                req.session.save(async (saveErr) => {
                    if (saveErr) {
                        console.error('OIDC session save error:', saveErr);
                        return res.redirect('/login?error=oidc_error');
                    }

                    try {
                        await db.updateLastLogin(user.id);
                        const replaceNote = replaced.length
                            ? `; replaced=${replaced.length} prior session(s)`
                            : '';
                        await db.logAction(
                            user.id,
                            'login',
                            `User logged in via OIDC; ip=${clientMeta.ip}; ua=${clientMeta.userAgent.slice(0, 160)}${replaceNote}`,
                            req.ip
                        );
                        if (replaced.length) {
                            await db.logAction(
                                user.id,
                                'session_replaced',
                                `OIDC login replaced ${replaced.length} prior session(s); newIp=${clientMeta.ip}`,
                                req.ip
                            );
                        }
                    } catch (bookkeepingErr) {
                        console.error('OIDC post-auth bookkeeping error:', bookkeepingErr);
                    }
                    res.redirect(safeReturnUrl);
                });
            } catch (sessionErr) {
                console.error('OIDC session establish error:', sessionErr);
                return res.redirect('/login?error=oidc_error');
            }
        });
    } catch (err) {
        console.error('OIDC session creation error:', err);
        res.redirect('/login?error=oidc_error');
    }
});

// ==================== TOTP (2FA) Routes ====================

/**
 * POST /api/auth/totp/verify - Verify TOTP code during login
 *
 * Phase A: If goPartialToken is present in session, delegate verification
 * to Go server's POST /api/auth/login/2fa. Otherwise fall back to local
 * verification (emergency mode or legacy).
 */
router.post('/api/auth/totp/verify', loginLimiter, async (req, res) => {
    try {
        const { code, recoveryCode } = req.body;
        const pendingUserId = req.session.pendingTotpUserId;
        const pendingUser = req.session.pendingTotpUser;
        const goPartialToken = req.session.goPartialToken;
        
        if (!pendingUserId || !pendingUser) {
            return res.status(400).json({
                success: false,
                error: req.t('auth.totp_session_expired')
            });
        }

        const totpCode = code || recoveryCode || '';

        // --- Phase A: Delegate to Go server when partial token available ---
        if (goPartialToken) {
            const goResult = await authService.verifyTotpViaGo(goPartialToken, totpCode);

            if (!goResult) {
                // Go unreachable — don't lock user out, fall through to local
                console.warn('[AUTH] Go server unreachable during 2FA — falling back to local verification');
            } else if (goResult.rejected) {
                if (goResult.rateLimited) {
                    return res.status(429).json({
                        success: false,
                        error: req.t('auth.totp_rate_limited') || 'Too many attempts. Please try again later.'
                    });
                }
                await db.logAction(pendingUserId, 'totp_failed', 'Go server rejected TOTP', req.ip);
                return res.status(401).json({
                    success: false,
                    error: req.t('auth.totp_invalid_code')
                });
            } else if (goResult.token) {
                // Go accepted — create session
                return finalizeLoginSession(req, res, pendingUser, 'totp (Go delegated)');
            }
        }

        // --- Local TOTP verification (fallback or emergency mode) ---
        let verified = false;
        let method = 'totp';
        
        if (recoveryCode) {
            verified = await authService.verifyRecoveryCode(pendingUserId, recoveryCode);
            method = 'recovery';
        } else if (code) {
            verified = await authService.verifyTotpCode(pendingUserId, code);
        }
        
        if (!verified) {
            await db.logAction(pendingUserId, 'totp_failed', `Method: ${method}`, req.ip);
            return res.status(401).json({
                success: false,
                error: req.t('auth.totp_invalid_code')
            });
        }

        return finalizeLoginSession(req, res, pendingUser, `${method} (local)`);
    } catch (err) {
        console.error('TOTP verify error:', err);
        res.status(500).json({
            success: false,
            error: req.t('errors.server_error')
        });
    }
});

/**
 * Finalize login session after successful 2FA verification.
 * Regenerates session, sets user data, logs action.
 */
function finalizeLoginSession(req, res, pendingUser, method) {
    const pendingMeta = req.session.pendingClientMeta || panelSessionService.clientMetaFromRequest(req, req.body || {});
    return new Promise((resolve) => {
        req.session.regenerate(async (regenErr) => {
            if (regenErr) {
                console.error('TOTP session regeneration error:', regenErr);
                res.status(500).json({
                    success: false,
                    error: 'Server error'
                });
                return resolve();
            }

            try {
                const { replaced } = await panelSessionService.establishAuthenticatedSession(req, pendingUser, {
                    meta: pendingMeta
                });
                clearGuestCookie(res);

                await db.updateLastLogin(pendingUser.id);
                const replaceNote = replaced.length
                    ? `; replaced=${replaced.length} prior session(s)`
                    : '';
                await db.logAction(
                    pendingUser.id,
                    'login',
                    `User logged in (2FA: ${method}); ip=${pendingMeta.ip}; ua=${pendingMeta.userAgent.slice(0, 160)}${replaceNote}`,
                    req.ip
                );
                if (replaced.length) {
                    await db.logAction(
                        pendingUser.id,
                        'session_replaced',
                        `2FA login replaced ${replaced.length} prior session(s); newIp=${pendingMeta.ip}`,
                        req.ip
                    );
                }

                res.json({
                    success: true,
                    user: {
                        username: pendingUser.username,
                        role: pendingUser.role
                    },
                    redirect: returnPathOr(req.body && req.body.return),
                    session: {
                        replacedPriorSessions: replaced.length,
                        idleTimeoutMs: panelSessionService.getPolicy().idleTimeoutMs,
                        maxAgeMs: panelSessionService.getPolicy().maxAgeMs
                    }
                });
            } catch (logErr) {
                console.error('TOTP post-auth bookkeeping error:', logErr);
                res.status(500).json({ success: false, error: 'Server error' });
            }
            resolve();
        });
    });
}

/**
 * POST /api/auth/totp/setup - Generate TOTP setup (QR code + secret)
 */
router.post('/api/auth/totp/setup', requireAuth, async (req, res) => {
    try {
        // Check if already enabled
        if (await authService.isTotpEnabled(req.session.userId)) {
            return res.status(400).json({
                success: false,
                error: req.t('auth.totp_already_enabled')
            });
        }
        
        const result = await authService.generateTotpSetup(req.session.userId);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }
        
        res.json({
            success: true,
            qrCode: result.qrCode,
            secret: result.secret,
            otpauthUrl: result.otpauthUrl
        });
    } catch (err) {
        console.error('TOTP setup error:', err);
        res.status(500).json({
            success: false,
            error: req.t('errors.server_error')
        });
    }
});

/**
 * POST /api/auth/totp/enable - Verify code and enable TOTP
 */
router.post('/api/auth/totp/enable', requireAuth, async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code || code.length !== 6) {
            return res.status(400).json({
                success: false,
                error: req.t('auth.totp_invalid_code')
            });
        }
        
        const result = await authService.verifyAndEnableTotp(req.session.userId, code);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        await bestEffortUserSync(
            async () => {
                const user = await db.getUserById(req.session.userId);
                await userSync.mirrorTotpEnable(user?.username, { secret: user?.totp_secret });
            },
            'TOTP enable'
        );
        
        // Log action
        await db.logAction(req.session.userId, 'totp_enabled', '2FA enabled', req.ip);
        
        res.json({
            success: true,
            recoveryCodes: result.recoveryCodes
        });
    } catch (err) {
        console.error('TOTP enable error:', err);
        res.status(500).json({
            success: false,
            error: req.t('errors.server_error')
        });
    }
});

/**
 * POST /api/auth/totp/disable - Disable TOTP
 */
router.post('/api/auth/totp/disable', requireAuth, async (req, res) => {
    try {
        const { password } = req.body;
        
        if (!password) {
            return res.status(400).json({
                success: false,
                error: req.t('auth.password_required')
            });
        }
        
        // Verify password before disabling (supports both bcrypt and PBKDF2 hashes)
        const user = await db.getUserById(req.session.userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: req.t('users.not_found')
            });
        }
        
        const valid = await authService.verifyPassword(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({
                success: false,
                error: req.t('auth.invalid_credentials')
            });
        }
        
        await authService.disableTotp(req.session.userId);
        await bestEffortUserSync(
            () => userSync.mirrorTotpDisable(user.username),
            'TOTP disable'
        );
        
        // Log action
        await db.logAction(req.session.userId, 'totp_disabled', '2FA disabled', req.ip);
        
        res.json({ success: true });
    } catch (err) {
        console.error('TOTP disable error:', err);
        res.status(500).json({
            success: false,
            error: req.t('errors.server_error')
        });
    }
});

/**
 * GET /api/auth/totp/status - Check if TOTP is enabled for current user
 */
router.get('/api/auth/totp/status', requireAuth, async (req, res) => {
    try {
        const enabled = await authService.isTotpEnabled(req.session.userId);
        res.json({ success: true, enabled });
    } catch (err) {
        console.error('TOTP status error:', err);
        res.status(500).json({ success: false, error: req.t('errors.server_error') });
    }
});

module.exports = router;
