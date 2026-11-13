'use strict';

/**
 * Username rename cascade (issue #498, 2026-11-13).
 *
 * `username` is not just a label: it is the primary key of `address_books`
 * (`username, ab_type`) and the lookup key in `org_users` and
 * `strategy_assignments.target_key`. Renaming only the `users` row would orphan
 * the address book, detach organisation membership and silently drop strategy
 * assignments — a data-loss bug, not just a cosmetic one.
 *
 * This helper performs the dependent updates for a caller that already holds a
 * transaction. Statements run in a fixed order and tolerate missing tables so
 * older databases keep working.
 *
 * @param {{ run: (sql: string, params?: any[]) => any, dialect: 'sqlite'|'postgres' }} tx
 * @param {string} oldUsername
 * @param {string} newUsername
 */
function renameUserCascade(tx, oldUsername, newUsername) {
    const oldName = String(oldUsername || '').trim();
    const newName = String(newUsername || '').trim();
    if (!oldName || !newName || oldName === newName) return;

    const run = (sql, params) => {
        try {
            tx.run(sql, params);
        } catch (err) {
            // Optional tables (older installs) must not abort the rename.
            if (/no such table|does not exist/i.test(String(err.message || ''))) return;
            throw err;
        }
    };

    // Address books are keyed by (username, ab_type); clear the target first so a
    // stale book under the new name cannot collide with the rename.
    run('DELETE FROM address_books WHERE username = ?', [newName]);
    run('UPDATE address_books SET username = ? WHERE username = ?', [newName, oldName]);

    // Organisation membership and strategy assignments reference the name.
    run('UPDATE org_users SET username = ? WHERE username = ?', [newName, oldName]);
    run(
        "UPDATE strategy_assignments SET target_key = ? WHERE target_key = ? AND target_type = 'user'",
        [newName, oldName]
    );

    // Lockout history must not lock the fresh name; attempts are historical rows
    // that should follow the account.
    run('DELETE FROM account_lockouts WHERE username = ?', [newName]);
    run('UPDATE login_attempts SET username = ? WHERE username = ?', [newName, oldName]);
}

module.exports = { renameUserCascade };
