'use strict';

/**
 * Administrator username change (issue #498, 2026-11-13).
 *
 * `username` is the primary key of `address_books` and the lookup key in
 * `org_users` and `strategy_assignments.target_key`. Renaming only the `users`
 * row would orphan the address book and detach org/strategy assignments, so the
 * cascade is part of the contract.
 */

const { renameUserCascade } = require('../lib/renameUserCascade');

function makeTx({ failOn } = {}) {
    const statements = [];
    return {
        statements,
        run(sql, params) {
            if (failOn && failOn.test(sql)) {
                const err = new Error('no such table: address_books');
                throw err;
            }
            statements.push({ sql, params: params || [] });
            return { changes: 1 };
        },
    };
}

describe('renameUserCascade', () => {
    it('moves the address book, org membership and strategy assignment', () => {
        const tx = makeTx();
        renameUserCascade(tx, 'oldadmin', 'newadmin');

        const sql = tx.statements.map((s) => s.sql);
        expect(sql).toEqual(expect.arrayContaining([
            'DELETE FROM address_books WHERE username = ?',
            'UPDATE address_books SET username = ? WHERE username = ?',
            'UPDATE org_users SET username = ? WHERE username = ?',
        ]));
        expect(sql.some((s) => s.includes('strategy_assignments'))).toBe(true);
        expect(sql.some((s) => s.includes('login_attempts'))).toBe(true);
    });

    it('clears a lockout on the target name and follows attempts to the new name', () => {
        const tx = makeTx();
        renameUserCascade(tx, 'oldadmin', 'newadmin');

        const lockoutDelete = tx.statements.find((s) => s.sql.includes('DELETE FROM account_lockouts'));
        expect(lockoutDelete.params).toEqual(['newadmin']);

        const attempts = tx.statements.find((s) => s.sql.includes('login_attempts'));
        expect(attempts.params).toEqual(['newadmin', 'oldadmin']);
    });

    it('clears a stale address book under the target name first', () => {
        const tx = makeTx();
        renameUserCascade(tx, 'oldadmin', 'newadmin');

        const deleteIndex = tx.statements.findIndex((s) => s.sql === 'DELETE FROM address_books WHERE username = ?');
        const updateIndex = tx.statements.findIndex((s) => s.sql === 'UPDATE address_books SET username = ? WHERE username = ?');
        expect(deleteIndex).toBeGreaterThanOrEqual(0);
        expect(deleteIndex).toBeLessThan(updateIndex);
    });

    it('tolerates a missing optional table on an older database', () => {
        const tx = makeTx({ failOn: /address_books/ });
        expect(() => renameUserCascade(tx, 'oldadmin', 'newadmin')).not.toThrow();
        // The remaining statements still run.
        expect(tx.statements.some((s) => s.sql.includes('org_users'))).toBe(true);
    });

    it('is a no-op for an empty or unchanged name', () => {
        const tx = makeTx();
        renameUserCascade(tx, 'same', 'same');
        renameUserCascade(tx, '', 'newadmin');
        renameUserCascade(tx, 'old', '');
        expect(tx.statements).toHaveLength(0);
    });
});

describe('username format', () => {
    // Mirrors db.ValidUsername in the Go server and USERS_USERNAME_RE in the panel.
    const re = /^[A-Za-z0-9_.@-]{3,64}$/;

    it('accepts the documented character set', () => {
        expect(re.test('admin')).toBe(true);
        expect(re.test('ops.admin')).toBe(true);
        expect(re.test('ops_admin')).toBe(true);
        expect(re.test('ops-admin')).toBe(true);
        expect(re.test('ops@example')).toBe(true);
    });

    it('rejects whitespace, path separators and short names', () => {
        expect(re.test('ops admin')).toBe(false);
        expect(re.test('../etc/passwd')).toBe(false);
        expect(re.test('ops/admin')).toBe(false);
        expect(re.test('ab')).toBe(false);
        expect(re.test('a'.repeat(65))).toBe(false);
    });
});
