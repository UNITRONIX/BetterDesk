'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');

let apiClient = null;
try { ({ apiClient } = require('../services/betterdeskApi')); } catch (e) { apiClient = null; }

function goApiProxy(req, res, method, path, body) {
  if (!apiClient || !apiClient[method]) {
    return res.json({ success: false, error: 'Go API not available' });
  }
  const fn = method === 'get' || method === 'delete'
    ? apiClient[method](path)
    : apiClient[method](path, body);
  fn.then(r => res.json(r.data || r))
    .catch(err => {
      const status = err.response?.status || 502;
      res.status(status).json({ success: false, error: err.message });
    });
}

// ── Page ─────────────────────────────────────────────────────
router.get('/security-audit', requireAuth, requirePermission('audit.view'), (req, res) => {
  const tab = req.query.tab || 'overview';
  res.render('security-audit', {
    title: req.t('security_audit.title'),
    pageStyles: ['security-audit'],
    pageScripts: ['security-audit'],
    currentPage: 'security-audit',
    breadcrumb: [{ label: req.t('security_audit.title') }],
    activeTab: tab
  });
});

// ── API: Security overview ───────────────────────────────────
router.get('/api/panel/security-audit/overview', requireAuth, requirePermission('audit.view'), async (req, res) => {
  try {
    const [healthRes, keysRes, auditRes, blocklistRes] = await Promise.allSettled([
      apiClient ? apiClient.get('/health') : Promise.reject('no api'),
      apiClient ? apiClient.get('/keys') : Promise.reject('no api'),
      apiClient ? apiClient.get('/audit/events?limit=500') : Promise.reject('no api'),
      apiClient ? apiClient.get('/blocklist') : Promise.reject('no api')
    ]);

    const health = healthRes.status === 'fulfilled' ? (healthRes.value.data || healthRes.value) : {};
    const keys = keysRes.status === 'fulfilled' ? (keysRes.value.data || keysRes.value) : [];
    const auditEvents = auditRes.status === 'fulfilled' ? (auditRes.value.data || auditRes.value) : [];
    const blocklist = blocklistRes.status === 'fulfilled'
      ? (blocklistRes.value.data || blocklistRes.value)
      : {};

    const events = Array.isArray(auditEvents) ? auditEvents : (auditEvents.events || []);
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recentEvents = events.filter((event) => {
      const timestamp = Date.parse(event.timestamp || event.created_at || '');
      return Number.isNaN(timestamp) || timestamp >= since;
    });

    const failedLogins = recentEvents.filter(e =>
      ['login_failed', 'auth_failed', 'auth_login_failed'].includes(e.action)
    ).length;
    const bans = Number.isFinite(Number(blocklist.count))
      ? Number(blocklist.count)
      : Array.isArray(blocklist.entries) ? blocklist.entries.length : 0;
    const configChanges = events.filter(e => e.action === 'config_changed' || e.action === 'setting_changed').length;

    const keyList = Array.isArray(keys) ? keys : (keys.keys || []);
    const oldKeys = keyList.filter(k => {
      if (!k.created_at) return false;
      const age = Date.now() - new Date(k.created_at).getTime();
      return age > 90 * 24 * 60 * 60 * 1000;
    });

    let score = 100;
    if (failedLogins > 20) score -= 15;
    else if (failedLogins > 5) score -= 5;
    if (bans > 0) score -= 10;
    if (oldKeys.length > 0) score -= 10;
    if (!health.tls) score -= 10;
    score = Math.max(0, Math.min(100, score));

    const checks = [
      { id: 'tls_api', name: 'API TLS', pass: !!health.tls },
      { id: 'api_key_age', name: 'API Key Rotation (< 90 days)', pass: oldKeys.length === 0 },
      { id: 'failed_logins', name: 'Low Failed Login Rate', pass: failedLogins < 10 },
      { id: 'no_bans', name: 'No Active Bans', pass: bans === 0 },
      { id: 'audit_log', name: 'Audit Logging', pass: auditRes.status === 'fulfilled' },
      { id: 'blocklist', name: 'Blocklist Available', pass: blocklistRes.status === 'fulfilled' }
    ];

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0].trim().toLowerCase();
    const secureWebSocket = req.secure === true
      || req.protocol === 'https'
      || forwardedProto === 'https';

    res.json({
      score,
      checks,
      stats: { failed_logins: failedLogins, bans, config_changes: configChanges, api_keys: keyList.length, old_keys: oldKeys.length },
      // Signal/relay TLS is not reported by the Go health endpoint. Keep it
      // unknown instead of displaying a false "Disabled" status.
      tls: { signal: null, relay: null, api: !!health.tls, wss: secureWebSocket }
    });
  } catch (err) {
    res.json({ score: 0, checks: [], stats: {}, tls: {} });
  }
});

// ── API: Audit events ────────────────────────────────────────
router.get('/api/panel/security-audit/events', requireAuth, requirePermission('audit.view'), (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const action = req.query.action || '';
  let path = `/audit/events?limit=${limit}&offset=${offset}`;
  if (action) path += `&action=${encodeURIComponent(action)}`;
  goApiProxy(req, res, 'get', path);
});

// ── API: Hardening checklist ─────────────────────────────────
router.get('/api/panel/security-audit/hardening', requireAuth, requirePermission('audit.view'), async (req, res) => {
  try {
    const priorities = [
      { id: 'mutual_tls', name: 'Mutual TLS Console ↔ Go Server', category: 'network', severity: 'high', implemented: false, description: 'Replace plain HTTP localhost with mutual TLS authentication between web console and Go server.' },
      { id: 'api_key_rotation', name: 'API Key Auto-Rotation', category: 'auth', severity: 'high', implemented: false, description: 'Automatically rotate API keys every 30 days with a grace period for old keys.' },
      { id: 'audit_tamper', name: 'Audit Log Tamper Detection', category: 'audit', severity: 'medium', implemented: false, description: 'HMAC chain where each audit entry signs the previous — detects log tampering.' },
      { id: 'session_timeout', name: 'Configurable Session Timeout', category: 'auth', severity: 'medium', implemented: true, description: 'Session timeout configurable per organization for compliance requirements.' },
      { id: 'ip_allowlist', name: 'IP Allowlisting', category: 'network', severity: 'medium', implemented: false, description: 'Restrict console and API access to specific IP ranges per organization.' },
      { id: 'cert_pinning', name: 'Certificate Pinning', category: 'network', severity: 'low', implemented: false, description: 'Pin TLS certificates in desktop client to prevent MITM attacks.' },
      { id: 'mem_safe_creds', name: 'Memory-Safe Credential Handling', category: 'crypto', severity: 'medium', implemented: false, description: 'Zeroize secrets in memory after use to prevent memory dump attacks.' },
      { id: 'csp_headers', name: 'CSP Headers Hardening', category: 'web', severity: 'high', implemented: true, description: 'Content Security Policy headers to prevent XSS and code injection.' },
      { id: 'rate_limit_review', name: 'Rate Limiting Review', category: 'network', severity: 'medium', implemented: true, description: 'Review and enforce rate limiting on all public-facing endpoints.' },
      { id: 'docker_scan', name: 'Docker Image Scanning', category: 'infra', severity: 'medium', implemented: false, description: 'Automated vulnerability scanning of Docker images using Trivy in CI/CD pipeline.' }
    ];
    res.json({ priorities });
  } catch (err) {
    res.json({ priorities: [] });
  }
});

// ── API: Vulnerability scan results ──────────────────────────
router.get('/api/panel/security-audit/vulnerabilities', requireAuth, requirePermission('audit.view'), async (req, res) => {
  try {
    const deps = {
      go: { total: 0, vulnerable: 0, items: [] },
      nodejs: { total: 0, vulnerable: 0, items: [] }
    };

    const pkgPath = require('path').join(__dirname, '..', 'package.json');
    try {
      const pkg = require(pkgPath);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      deps.nodejs.total = Object.keys(allDeps).length;
    } catch (e) { /* ignore */ }

    // Dependency inventory is available locally, but this endpoint does not
    // run npm audit or govulncheck. Do not present an inventory as a clean scan.
    res.json({
      scan_available: false,
      counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      vulnerabilities: [],
      dependencies: deps,
      last_scan: null
    });
  } catch (err) {
    res.json({ dependencies: {}, last_scan: null });
  }
});

module.exports = router;
