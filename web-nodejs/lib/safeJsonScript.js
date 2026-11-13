'use strict';

/**
 * Safe JSON embedding for inline `<script>` blocks.
 *
 * SECURITY (audit M11, CodeQL 367/368, 2026-11-13): `JSON.stringify()` output is
 * safe inside a JSON document but NOT inside HTML. A string containing
 * `</script>` terminates the script block early, and `<` / `>` can break out of
 * attribute or comment contexts in older parsers. Bootstrapping data (branding,
 * translations, user objects) is written with `<%- %>`, so the escaping has to
 * happen here.
 *
 * Usage in EJS:
 *   <script nonce="<%= cspNonce %>">
 *     window.BetterDesk = { branding: <%- safeJsonScript(branding) %> };
 *   </script>
 */

const HTML_UNSAFE = /[<>&\u2028\u2029]/g;

const REPLACEMENTS = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
};

/**
 * Serialize a value for inline embedding in a script element.
 *
 * @param {unknown} value
 * @returns {string} JSON text that cannot terminate or escape the script block.
 */
function safeJsonScript(value) {
    const json = JSON.stringify(value === undefined ? null : value);
    if (typeof json !== 'string') return 'null';
    return json.replace(HTML_UNSAFE, (ch) => REPLACEMENTS[ch] || ch);
}

/**
 * Convenience wrapper with a fallback for null/undefined, used for optional
 * view locals so a missing variable does not print "undefined".
 *
 * @param {unknown} value
 * @param {unknown} [fallback]
 */
function safeJsonScriptOr(value, fallback) {
    return safeJsonScript(value === undefined || value === null ? fallback : value);
}

module.exports = { safeJsonScript, safeJsonScriptOr };
