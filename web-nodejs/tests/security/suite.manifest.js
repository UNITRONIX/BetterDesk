/**
 * BetterDesk Security Test Suite — manifest
 *
 * Version this file when adding/removing modules so release notes can cite
 * the suite revision. Modules are plain Jest files under this directory;
 * the manifest is documentation + programmatic inventory for CI summaries.
 *
 * Run:  npm run test:security   (from web-nodejs/)
 * Full: npm run test:security:full  (Node + Go connection suite)
 */
'use strict';

module.exports = {
    /** Bump when the suite inventory or payload set changes meaningfully. */
    version: '1.2.0',
    updated: '2026-10-17',
    scope: 'local-only',
    description:
        'Defensive regression suite: attack-shaped inputs must be rejected. ' +
        'Never point these tests at remote/production hosts.',
    modules: [
        { id: '01', file: '01-sql-injection.test.js', covers: ['SQLi', 'identifier hygiene'] },
        { id: '02', file: '02-xss.test.js', covers: ['XSS output encoding'] },
        { id: '03', file: '03-auth-bypass.test.js', covers: ['RBAC', 'unauthenticated API'] },
        { id: '04', file: '04-brute-force.test.js', covers: ['login rate limit'] },
        { id: '05', file: '05-csrf-cors-ssrf.test.js', covers: ['CSRF', 'CORS', 'SSRF'] },
        { id: '06', file: '06-rustdesk-client-api.test.js', covers: ['RustDesk Client API 21121', 'session leak'] },
        { id: '07', file: '07-connection-ws.test.js', covers: ['WS CSWSH', 'relay upgrade auth', 'BD Bearer'] },
        { id: '08', file: '08-path-redirect.test.js', covers: ['path traversal', 'open redirect'] },
        { id: '09', file: '09-deps-audit.test.js', covers: ['DEP-01 proxy-addr', 'DEP-02 axios', 'DEP-03 brace-expansion', 'DEP-04 multer'] },
    ],
    goPackages: [
        { path: './relay', covers: ['relay ticket', 'unauthorized UUID', 'pair claim'] },
        { path: './sessiongrant', covers: ['session grant binding', 'impersonation'] },
        { path: './crypto', covers: ['server key signing', 'IdPk verification'] },
    ],
};
