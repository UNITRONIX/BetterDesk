'use strict';

/**
 * ensureDefaultAdmin must not change existing admin password on routine startup (issue #158).
 * Force update only when .force_password_update sentinel is present.
 */

jest.mock('bcrypt', () => ({
    hash: jest.fn(async () => '$2b$12$mock'),
    compare: jest.fn(async () => true)
}));

jest.mock('../services/database', () => ({
    hasUsers: jest.fn(),
    getUserByUsername: jest.fn(),
    updateUserPassword: jest.fn(),
    createUser: jest.fn()
}));

jest.mock('fs', () => ({
    existsSync: jest.fn(() => false),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn()
}));

const db = require('../services/database');
const authService = require('../services/authService');

describe('ensureDefaultAdmin password policy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.DEFAULT_ADMIN_PASSWORD = 'env-password-should-not-apply';
        delete process.env.FORCE_PASSWORD_UPDATE;
        delete process.env.DOCKER;
        delete process.env.SQLITE_AUTH_DB_MODE;
        delete process.env.DOCKER_ADMIN_BOOTSTRAP_WAIT_MS;
    });

    afterAll(() => {
        delete process.env.DEFAULT_ADMIN_PASSWORD;
        delete process.env.DOCKER;
        delete process.env.SQLITE_AUTH_DB_MODE;
        delete process.env.DOCKER_ADMIN_BOOTSTRAP_WAIT_MS;
    });

    test('does not update bcrypt hash when users exist and no force sentinel', async () => {
        db.hasUsers.mockResolvedValue(true);
        db.getUserByUsername.mockResolvedValue({
            id: 1,
            username: 'admin',
            password_hash: '$2b$12$abcdefghijklmnopqrstuv', // bcrypt
            last_login: null
        });

        await authService.ensureDefaultAdmin();

        expect(db.updateUserPassword).not.toHaveBeenCalled();
    });

    test('waits for the Go bootstrap admin on a consolidated Docker database', async () => {
        process.env.DOCKER = 'true';
        process.env.SQLITE_AUTH_DB_MODE = 'consolidated';
        process.env.DOCKER_ADMIN_BOOTSTRAP_WAIT_MS = '5';
        db.hasUsers
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        db.getUserByUsername.mockResolvedValue({
            id: 1,
            username: 'admin',
            password_hash: '$2b$12$abcdefghijklmnopqrstuv',
            last_login: null
        });

        await authService.ensureDefaultAdmin();

        expect(db.createUser).not.toHaveBeenCalled();
        expect(db.hasUsers).toHaveBeenCalledTimes(2);
    });
});
