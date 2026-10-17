'use strict';

/** Unquoted SQL identifier: letters, digits, underscore; must not start with a digit. */
const SAFE_SQL_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * @param {unknown} name
 * @returns {string} validated identifier
 * @throws {Error} when name is not a safe SQL identifier
 */
function assertSafeSqlIdent(name) {
    if (typeof name !== 'string' || !SAFE_SQL_IDENT_RE.test(name)) {
        throw new Error(`Unsafe SQL identifier: ${String(name)}`);
    }
    return name;
}

/**
 * @param {unknown} name
 * @returns {boolean}
 */
function isSafeSqlIdent(name) {
    return typeof name === 'string' && SAFE_SQL_IDENT_RE.test(name);
}

module.exports = {
    SAFE_SQL_IDENT_RE,
    assertSafeSqlIdent,
    isSafeSqlIdent,
};
