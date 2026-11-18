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
const { guestOnly, requireAuth } = require('../middleware/auth');
const { clearGuestCookie } = require('../middleware/guestAccess');
const { loginLimiter, passwordChangeLimiter } = require('../middleware/rateLimiter');
const panelSessionService = require('../services/panelSessionService');
const { END_REASONS } = require('../lib/sessionPolicy');

/**
 * Validate that a return URL is a safe relative path. Mirrors
 * auth.IsRelativeReturnURL in the Go server. Rejects absolute URLs,
 * protocol-relative URLs (//evil.com/...), CR/LF (response splitting),
 * and anything not starting with a single "/".
 */
function isSafeReturnUrl(u) {
    if (typeof u !== 'string' || u.length === 0) return false;
    if (/[\r\n\x00]/.test(u)) return false;
    if (!u.startsWith('/')) return false;
    if (u.startsWith('//') || u.startsWith('/\\')) return false;
    return true;
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

/**
 * GET /login - Login page
 * Serves desktop-style login when user previously had desktop mode active
 * (detected via localStorage preference or explicit ?desktop=1 query param).
 */
router.get('/login', guestOnly, async (req, res) => {
    const useDesktop = req.query.desktop === '1' || req.cookies.betterdesk_desktop_mode === 'true';

    let attestationBadge = { tier: null, maxConnections: null };
    try {
        const last = await serverAttestation.getLastResult();
        const presentation = await serverAttestation.getBadgePresentation({
            tier: last && last.tier,
            translate: req.t,
            brandName: brandingService.getBranding().appName
        });
        attestationBadge = serverAttestation.buildPublicSummary(last, presentation);
    } catch (_) { /* optional */ }

    if (useDesktop) {
        // SECURITY (audit H6, 2026-11-13): this used to render every account
        // name and role into the anonymous login page, which handed attackers a
        // ready-made target list. The desktop login now starts with an empty
        // selector; `/login/lookup` (rate limited) fills it in on demand once
        // the visitor starts typing a name.
        return res.render('desktop-login', {
            title: req.t('nav.login'),
            activePage: 'login',
            loginUsers: [],
            attestationBadge
        });
    }

    res.render('login', {
        title: req.t('nav.login'),
        activePage: 'login',
        attestationBadge
    });
});

/**
 * GET /login/lookup?q=prefix — typeahead for the desktop login selector.
 *
 * SECURITY (audit H6, 2026-11-13): replaces the pre-rendered full account list.
 * Returns at most 8 matches for a >=2 character prefix, only usernames and
 * roles, and is rate limited per IP. Anonymous callers therefore cannot
 * enumerate the account list in one request; harvesting it costs requests that
 * are both rate limited and logged.
 */
router.get('/login/lookup', loginLimiter, async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    if (query.length < 2 || query.length > 64) {
        return res.json({ success: true, matches: [] });
    }
    try {
        const users = typeof db.getAllUsersForBackup === 'function'
            ? await db.getAllUsersForBackup() : [];
        const matches = (Array.isArray(users) ? users : [])
            .filter((u) => String(u.username || '').toLowerCase().startsWith(query))
            .slice(0, 8)
            .map((u) => ({
                username: u.username,
                role: u.role || 'operator',
            }));
        return res.json({ success: true, matches });
    } catch (_) {
        return res.json({ success: true, matches: [] });
    }
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

        // SECURITY (audit H4, 2026-11-13): the panel login used to rely on the
        // per-IP limiter alone, while the client API paths already consulted the
        // shared account-lockout tracker. Without this, rotating source IPs gave
        // an unlimited password guess budget against the admin account.
        const lockout = await authService.checkBruteForce(username, req.ip);
        if (lockout.blocked) {
            await db.logAction(
                null,
                'login_blocked',
                `Account/IP locked; ip=${clientMeta.ip}`,
                req.ip
            ).catch(() => {});
            const retryAfter = Number.isFinite(lockout.retryAfter) ? lockout.retryAfter : 60;
            res.set('Retry-After', String(Math.max(1, retryAfter)));
            return res.status(429).json({
                success: false,
                error: req.t('auth.too_many_attempts'),
                code: 'account_locked',
                retry_after: Math.max(1, retryAfter),
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
            // SECURITY (audit M2, 2026-11-13): regenerate the session BEFORE
            // storing pending 2FA state. Writing it onto the pre-login session
            // id gave a session-fixation window: an attacker who planted an id
            // could inherit the half-authenticated state and finish the second
            // factor on it.
            return req.session.regenerate((regenErr) => {
                if (regenErr) {
                    console.error('Session regeneration error (2FA):', regenErr);
                    return res.status(500).json({ success: false, error: 'Server error' });
                }
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
 *
 * SECURITY (audit M3, 2026-11-13): a state-changing GET without CSRF lets any
 * page log the operator out with an `<img src="…/logout">`. Destructive session
 * teardown now requires POST + the double-submit CSRF token (handled by the
 * global middleware); a GET only renders a confirmation page so old bookmarks
 * still explain what happened instead of silently failing.
 */
router.get('/logout', (req, res) => {
    if (req.session?.userId) {
        return res.status(405).render('errors/500', {
            title: 'Logout requires POST',
            activePage: 'error',
            error: 'Signing out changed to a POST request for CSRF protection. Use the sign-out button in the panel.',
        });
    }
    return res.redirect('/login');
});

/** POST /logout — browser form/redirect flow with CSRF protection. */
router.post('/logout', async (req, res) => {
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
    const returnUrl = isSafeReturnUrl(requested) ? requested : '/';
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
        const safeReturnUrl = isSafeReturnUrl(return_url) ? return_url : '/';

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
                // SECURITY (audit M1, 2026-11-13): fail closed. Falling back to
                // local verification while Go is unreachable let an attacker who
                // already had the password skip Go's 2FA policy and rate limits
                // whenever the backend was down or partitioned.
                console.error('[AUTH] Go server unreachable during delegated 2FA — refusing local fallback');
                await db.logAction(
                    pendingUserId,
                    'totp_unavailable',
                    'Delegated 2FA unavailable (Go unreachable)',
                    req.ip,
                ).catch(() => {});
                return res.status(503).json({
                    success: false,
                    error: req.t('auth.totp_temporarily_unavailable')
                        || 'Two-factor verification is temporarily unavailable. Please try again shortly.',
                    code: 'totp_backend_unavailable',
                });
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
