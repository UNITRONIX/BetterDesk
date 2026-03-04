/**
 * BetterDesk Console - Auth Service
 * Handles user authentication, password hashing, session management
 */

const bcrypt = require('bcrypt');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('./database');
const config = require('../config/config');

const SALT_ROUNDS = 12;

// Pre-computed dummy hash for timing-safe comparison (prevents user enumeration)
const DUMMY_HASH = '$2b$12$KiXeOj5vHpJRJHGMhWzadeKfRJLvJRaRHQbMGBBdkpu.jQfXAzgWS';

// PBKDF2 parameters matching Go server's auth.HashPassword()
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 32; // SHA-256 output size
const PBKDF2_DIGEST = 'sha256';

/**
 * Detect whether a stored hash is bcrypt or PBKDF2 (Go server format).
 * Go format: "hex_salt:hex_derived_key" (32-char salt + ":" + 64-char key)
 * bcrypt format: "$2b$..." or "$2a$..."
 */
function isPBKDF2Hash(hash) {
    if (!hash || hash.startsWith('$2b$') || hash.startsWith('$2a$')) return false;
    const parts = hash.split(':');
    return parts.length === 2
        && /^[0-9a-f]{32}$/i.test(parts[0])
        && /^[0-9a-f]{64}$/i.test(parts[1]);
}

/**
 * Verify a password against a PBKDF2-HMAC-SHA256 hash (Go server format).
 * Format: "hex(salt):hex(derived_key)" with 100,000 iterations, SHA-256.
 */
function verifyPBKDF2(password, stored) {
    const parts = stored.split(':');
    if (parts.length !== 2) return false;
    const salt = Buffer.from(parts[0], 'hex');
    const expected = Buffer.from(parts[1], 'hex');
    const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
    return crypto.timingSafeEqual(expected, derived);
}

/**
 * Hash a password using bcrypt
 */
async function hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify password against hash (supports both bcrypt and PBKDF2).
 * Returns { valid: boolean, needsMigration: boolean }
 */
async function verifyPasswordEx(password, hash) {
    if (isPBKDF2Hash(hash)) {
        return { valid: verifyPBKDF2(password, hash), needsMigration: true };
    }
    return { valid: await bcrypt.compare(password, hash), needsMigration: false };
}

/**
 * Verify password against hash (simple boolean, backward compatible)
 */
async function verifyPassword(password, hash) {
    const result = await verifyPasswordEx(password, hash);
    return result.valid;
}

/**
 * Authenticate user with username and password.
 * Supports both bcrypt (Node.js native) and PBKDF2 (Go server) hash formats.
 * When a PBKDF2 hash is verified successfully, it is auto-migrated to bcrypt
 * so subsequent logins do not need the PBKDF2 code path.
 * Returns user object with totpRequired flag if 2FA is enabled.
 */
async function authenticate(username, password) {
    const user = await db.getUserByUsername(username);
    
    if (!user) {
        // Timing-safe: do a real hash comparison to prevent user enumeration
        await bcrypt.compare(password, DUMMY_HASH);
        return null;
    }
    
    const { valid, needsMigration } = await verifyPasswordEx(password, user.password_hash);
    if (!valid) {
        return null;
    }

    // Auto-migrate PBKDF2 hash to bcrypt for future logins
    if (needsMigration) {
        try {
            const bcryptHash = await hashPassword(password);
            await db.updateUserPassword(user.id, bcryptHash);
            console.log(`[AUTH] Migrated password hash from PBKDF2 to bcrypt for user: ${username}`);
        } catch (err) {
            console.warn(`[AUTH] Failed to migrate password hash for ${username}:`, err.message);
        }
    }
    
    // Check if TOTP is enabled
    if (user.totp_enabled) {
        return {
            id: user.id,
            username: user.username,
            role: user.role,
            totpRequired: true
        };
    }
    
    // Update last login
    await db.updateLastLogin(user.id);
    
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        totpRequired: false
    };
}

/**
 * Create default admin user if no users exist.
 * In PostgreSQL mode, the Go server may have already created the admin user
 * with a PBKDF2 hash. In that case, we migrate the hash to bcrypt format
 * using the password from DEFAULT_ADMIN_PASSWORD env var.
 */
async function ensureDefaultAdmin() {
    const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || '';

    if (await db.hasUsers()) {
        // Users exist — check if the admin's hash needs migration from PBKDF2 to bcrypt.
        // This handles the case where the Go server created the user first (PostgreSQL shared DB).
        if (defaultPassword) {
            const admin = await db.getUserByUsername(defaultUsername);
            if (admin && isPBKDF2Hash(admin.password_hash)) {
                console.log(`[AUTH] Found admin user with PBKDF2 hash (created by Go server). Migrating to bcrypt...`);
                if (verifyPBKDF2(defaultPassword, admin.password_hash)) {
                    const bcryptHash = await hashPassword(defaultPassword);
                    await db.updateUserPassword(admin.id, bcryptHash);
                    console.log(`[AUTH] Admin password hash migrated from PBKDF2 to bcrypt successfully`);
                } else {
                    console.warn(`[AUTH] DEFAULT_ADMIN_PASSWORD does not match existing PBKDF2 hash — skipping migration`);
                }
            }
        }
        return false;
    }
    
    // No users at all — create the default admin
    const password = defaultPassword || require('crypto').randomBytes(16).toString('hex');
    
    const hash = await hashPassword(password);
    await db.createUser(defaultUsername, hash, 'admin');
    
    console.log(`Created default admin user: ${defaultUsername}`);
    if (!defaultPassword) {
        console.log(`Generated admin password: ${password}`);
    }
    console.log('IMPORTANT: Change the default password immediately!');
    
    return true;
}

/**
 * Change user password
 */
async function changePassword(userId, currentPassword, newPassword) {
    const user = await db.getUserById(userId);
    if (!user) {
        return { success: false, error: 'User not found' };
    }
    
    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
        return { success: false, error: 'Current password is incorrect' };
    }
    
    // Validate new password strength
    if (newPassword.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' };
    }
    
    const newHash = await hashPassword(newPassword);
    await db.updateUserPassword(userId, newHash);
    
    return { success: true };
}

/**
 * Validate password strength
 */
function validatePasswordStrength(password) {
    const result = {
        score: 0,
        feedback: []
    };
    
    if (password.length >= 8) result.score += 1;
    else result.feedback.push('Use at least 8 characters');
    
    if (password.length >= 12) result.score += 1;
    
    if (/[a-z]/.test(password)) result.score += 1;
    else result.feedback.push('Add lowercase letters');
    
    if (/[A-Z]/.test(password)) result.score += 1;
    else result.feedback.push('Add uppercase letters');
    
    if (/[0-9]/.test(password)) result.score += 1;
    else result.feedback.push('Add numbers');
    
    if (/[^a-zA-Z0-9]/.test(password)) result.score += 1;
    else result.feedback.push('Add special characters');
    
    result.strength = result.score <= 2 ? 'weak' : result.score <= 4 ? 'medium' : 'strong';
    
    return result;
}

// ==================== TOTP (2FA) Functions ====================

/**
 * Generate TOTP secret and QR code for user setup
 */
async function generateTotpSetup(userId) {
    const user = await db.getUserById(userId);
    if (!user) {
        return { success: false, error: 'User not found' };
    }
    
    // Generate secret
    const secret = authenticator.generateSecret();
    
    // Save secret to DB (not yet enabled)
    await db.saveTotpSecret(userId, secret);
    
    // Generate otpauth URI
    const otpauthUrl = authenticator.keyuri(user.username, 'BetterDesk Console', secret);
    
    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
        width: 256,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    });
    
    return {
        success: true,
        secret,
        qrCode: qrCodeDataUrl,
        otpauthUrl
    };
}

/**
 * Verify TOTP code and enable 2FA
 */
async function verifyAndEnableTotp(userId, token) {
    const user = await db.getUserById(userId);
    if (!user || !user.totp_secret) {
        return { success: false, error: 'TOTP not set up' };
    }
    
    // Verify the token against the stored secret
    const isValid = authenticator.verify({
        token,
        secret: user.totp_secret
    });
    
    if (!isValid) {
        return { success: false, error: 'Invalid verification code' };
    }
    
    // Generate recovery codes
    const recoveryCodes = generateRecoveryCodes(8);
    
    // Enable TOTP
    await db.enableTotp(userId, recoveryCodes);
    
    return {
        success: true,
        recoveryCodes
    };
}

/**
 * Verify TOTP code during login
 */
async function verifyTotpCode(userId, token) {
    const user = await db.getUserById(userId);
    if (!user || !user.totp_enabled || !user.totp_secret) {
        return false;
    }
    
    const isValid = authenticator.verify({
        token,
        secret: user.totp_secret
    });
    
    return isValid;
}

/**
 * Verify recovery code during login
 */
async function verifyRecoveryCode(userId, code) {
    const user = await db.getUserById(userId);
    if (!user || !user.totp_enabled || !user.totp_recovery_codes) {
        return false;
    }
    
    let codes;
    try {
        codes = JSON.parse(user.totp_recovery_codes);
    } catch (e) {
        return false;
    }
    
    const normalizedCode = code.trim().toUpperCase();
    const index = codes.findIndex(c => c.toUpperCase() === normalizedCode);
    
    if (index === -1) {
        return false;
    }
    
    // Remove used code
    codes.splice(index, 1);
    await db.useRecoveryCode(userId, codes);
    
    return true;
}

/**
 * Disable TOTP for user
 */
async function disableTotp(userId) {
    await db.disableTotp(userId);
    return { success: true };
}

/**
 * Check if user has TOTP enabled
 */
async function isTotpEnabled(userId) {
    const user = await db.getUserById(userId);
    return user ? !!user.totp_enabled : false;
}

/**
 * Generate random recovery codes
 */
function generateRecoveryCodes(count = 8) {
    const codes = [];
    for (let i = 0; i < count; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        codes.push(code.slice(0, 4) + '-' + code.slice(4));
    }
    return codes;
}

// ==================== RustDesk Client API Token Functions ====================

const TOKEN_EXPIRY_DAYS = parseInt(process.env.API_TOKEN_EXPIRY_DAYS, 10) || 7;
const MAX_FAILED_ATTEMPTS = parseInt(process.env.API_MAX_FAILED_ATTEMPTS, 10) || 10;
const LOCKOUT_MINUTES = parseInt(process.env.API_LOCKOUT_MINUTES, 10) || 15;
const IP_RATE_LIMIT = parseInt(process.env.API_IP_RATE_LIMIT, 10) || 30;
const ATTEMPT_WINDOW_MINUTES = parseInt(process.env.API_ATTEMPT_WINDOW, 10) || 15;

/**
 * Generate a secure access token for RustDesk client
 * Token format: 64 hex chars (256 bits of entropy)
 */
async function generateAccessToken(userId, clientId, clientUuid, ipAddress) {
    // Revoke old tokens for the same client device
    await db.revokeUserClientTokens(userId, clientId, clientUuid);

    // Generate cryptographically secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiry
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').replace('Z', '');

    await db.createAccessToken(token, userId, clientId, clientUuid, expiresAt, ipAddress);

    return token;
}

/**
 * Validate an access token and return associated user
 */
async function validateAccessToken(token) {
    if (!token || typeof token !== 'string' || token.length !== 64) {
        return null;
    }

    const tokenRecord = await db.getAccessToken(token);
    if (!tokenRecord) {
        return null;
    }

    const user = await db.getUserById(tokenRecord.user_id);
    if (!user) {
        return null;
    }

    // Update last_used
    await db.touchAccessToken(token);

    return {
        id: user.id,
        username: user.username,
        role: user.role,
        clientId: tokenRecord.client_id,
        clientUuid: tokenRecord.client_uuid
    };
}

/**
 * Revoke all tokens for a user+client during logout
 */
async function revokeClientTokens(userId, clientId, clientUuid) {
    if (clientId && clientUuid) {
        await db.revokeUserClientTokens(userId, clientId, clientUuid);
    } else {
        await db.revokeAllUserTokens(userId);
    }
}

// ==================== Brute-Force Protection ====================

/**
 * Check if login should be blocked (account lockout or IP rate limit)
 * Returns { blocked: boolean, reason: string, retryAfter: number }
 */
async function checkBruteForce(username, ipAddress) {
    // Check account lockout
    if (username) {
        const lockout = await db.getAccountLockout(username);
        if (lockout) {
            const retryAfter = Math.ceil(
                (new Date(lockout.locked_until + 'Z').getTime() - Date.now()) / 1000
            );
            return {
                blocked: true,
                reason: 'Account temporarily locked due to too many failed attempts',
                retryAfter: Math.max(retryAfter, 1)
            };
        }
    }

    // Check IP rate limiting
    if (ipAddress) {
        const ipAttempts = await db.countRecentFailedAttemptsFromIp(ipAddress, ATTEMPT_WINDOW_MINUTES);
        if (ipAttempts >= IP_RATE_LIMIT) {
            return {
                blocked: true,
                reason: 'Too many failed attempts from this IP address',
                retryAfter: ATTEMPT_WINDOW_MINUTES * 60
            };
        }
    }

    return { blocked: false };
}

/**
 * Record a login attempt and potentially lock account
 */
async function recordAttempt(username, ipAddress, success) {
    await db.recordLoginAttempt(username, ipAddress, success);

    if (success) {
        // Clear lockout on successful login
        await db.clearAccountLockout(username);
        return;
    }

    // Check if we need to lock the account
    const failedCount = await db.countRecentFailedAttempts(username, ATTEMPT_WINDOW_MINUTES);
    if (failedCount >= MAX_FAILED_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
            .toISOString().replace('T', ' ').replace('Z', '');
        await db.lockAccount(username, lockedUntil, failedCount);
    }
}

/**
 * Run periodic housekeeping (expired tokens, old attempts)
 */
async function cleanupHousekeeping() {
    try {
        await db.cleanupExpiredTokens();
        await db.cleanupOldLoginAttempts();
    } catch (err) {
        console.error('Housekeeping error:', err.message);
    }
}

module.exports = {
    hashPassword,
    verifyPassword,
    authenticate,
    ensureDefaultAdmin,
    changePassword,
    validatePasswordStrength,
    // TOTP
    generateTotpSetup,
    verifyAndEnableTotp,
    verifyTotpCode,
    verifyRecoveryCode,
    disableTotp,
    isTotpEnabled,
    // RustDesk Client API tokens
    generateAccessToken,
    validateAccessToken,
    revokeClientTokens,
    // Brute-force protection
    checkBruteForce,
    recordAttempt,
    cleanupHousekeeping
};
