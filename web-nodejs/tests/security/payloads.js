/**
 * Shared attack-shaped payloads for the security suite.
 * Used only to assert that controls reject or neutralize them.
 */
'use strict';

const SQLI = Object.freeze([
    "' OR '1'='1",
    "1; DROP TABLE users--",
    "1' UNION SELECT password FROM users--",
    "admin'--",
    "'; WAITFOR DELAY '0:0:5'--",
    '1 OR 1=1',
]);

const XSS = Object.freeze([
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    '<svg onload=alert(1)>',
    '<img src=x onerror=alert(document.cookie)>',
]);

const PATH_TRAVERSAL = Object.freeze([
    '..',
    '../etc/passwd',
    '..\\..\\windows\\system32',
    '....//....//etc/passwd',
    '%2e%2e/%2e%2e/etc/passwd',
]);

const OPEN_REDIRECT = Object.freeze([
    'https://evil.example.com',
    '//evil.example.com',
    '/\\evil.example.com',
    'http://127.0.0.1:5000/remote',
]);

const EVIL_ORIGINS = Object.freeze([
    'https://evil.example.com',
    'http://attacker.local',
    'null',
]);

/** Safe SQL/catalog identifiers (positive controls). */
const SAFE_SQL_IDENT = Object.freeze(['users', 'settings', 'peer', 'audit_log']);

/** Malicious table-name attempts for identifier interpolation checks. */
const MALICIOUS_SQL_IDENT = Object.freeze([
    'users"; DROP TABLE users--',
    'users" OR 1=1 --',
    '../etc/passwd',
    'users;--',
]);

module.exports = {
    SQLI,
    XSS,
    PATH_TRAVERSAL,
    OPEN_REDIRECT,
    EVIL_ORIGINS,
    SAFE_SQL_IDENT,
    MALICIOUS_SQL_IDENT,
    SAFE_IDENT_RE: /^[A-Za-z_][A-Za-z0-9_]*$/,
};
