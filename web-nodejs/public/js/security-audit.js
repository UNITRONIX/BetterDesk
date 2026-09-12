/* Security Audit Dashboard — Phase 8 */
(function () {
  'use strict';
  const _ = window._ || (k => k);

  let activeTab = 'overview';
  let eventsPage = 0;
  const PAGE_SIZE = 25;

  /* ── Tab switching ── */
  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.secaudit-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.secaudit-panel').forEach(p => {
      p.style.display = p.id === 'panel-' + tab ? 'block' : 'none';
    });
    history.replaceState(null, '', '?tab=' + tab);
    if (tab === 'overview') loadOverview();
    else if (tab === 'events') loadEvents();
    else if (tab === 'hardening') loadHardening();
    else if (tab === 'vulnerabilities') loadVulnerabilities();
  }

  /* ── Overview ── */
  async function loadOverview() {
    try {
      const res = await fetch('/api/panel/security-audit/overview');
      const json = await res.json();
      const d = json.data || json;

      // Score ring
      const score = typeof d.score === 'number' ? d.score : 0;
      const circle = document.getElementById('score-circle');
      const circumference = 2 * Math.PI * 52;
      const offset = circumference - (score / 100) * circumference;
      circle.style.strokeDashoffset = offset;
      circle.style.stroke = score >= 80 ? '#3fb950' : score >= 50 ? '#d29922' : '#f85149';
      document.getElementById('score-value').textContent = score;

      // Stats
      const stats = d.stats || {};
      setText('stat-failed-logins', stats.failed_logins ?? '—');
      setText('stat-bans', stats.active_bans ?? '—');
      setText('stat-api-keys', stats.api_keys ?? '—');
      setText('stat-old-keys', stats.old_keys ?? '—');

      // Checks
      const checksGrid = document.getElementById('checks-grid');
      const checks = d.checks || [];
      checksGrid.innerHTML = checks.map(c => {
        const cls = c.pass ? 'pass' : (c.warn ? 'warn' : 'fail');
        const icon = c.pass ? 'check_circle' : (c.warn ? 'warning' : 'cancel');
        const badge = c.pass ? _('security_audit.pass') : (c.warn ? _('security_audit.warning') : _('security_audit.fail'));
        return `<div class="secaudit-check">
          <span class="material-icons secaudit-check-icon ${cls}">${icon}</span>
          <span class="secaudit-check-name">${esc(c.name)}</span>
          <span class="secaudit-check-badge ${cls}">${badge}</span>
        </div>`;
      }).join('');

      // TLS
      const tls = d.tls || {};
      const tlsGrid = document.getElementById('tls-grid');
      const tlsItems = [
        { label: _('security_audit.tls_signal'), value: tls.signal },
        { label: _('security_audit.tls_relay'), value: tls.relay },
        { label: _('security_audit.tls_api'), value: tls.api },
        { label: _('security_audit.tls_wss'), value: tls.wss }
      ];
      tlsGrid.innerHTML = tlsItems.map(t => {
        const en = t.value === true;
        return `<div class="secaudit-tls-card">
          <div class="tls-label">${esc(t.label)}</div>
          <div class="tls-value ${en ? 'enabled' : 'disabled'}">${en ? _('security_audit.enabled') : _('security_audit.disabled')}</div>
        </div>`;
      }).join('');
    } catch (e) {
      console.error('SecurityAudit overview error:', e);
    }
  }

  /* ── Audit Events ── */
  async function loadEvents() {
    try {
      const filter = document.getElementById('event-filter')?.value || '';
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: eventsPage * PAGE_SIZE });
      if (filter) params.set('action', filter);
      const res = await fetch('/api/panel/security-audit/events?' + params);
      const json = await res.json();
      const d = json.data || json;
      const events = d.events || d.items || [];
      const total = d.total || events.length;

      const tbody = document.getElementById('events-tbody');
      if (!events.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="secaudit-empty"><span class="material-icons">history</span>${_('security_audit.no_events')}</td></tr>`;
      } else {
        tbody.innerHTML = events.map(ev => {
          const cls = actionClass(ev.action);
          return `<tr>
            <td>${formatTime(ev.timestamp || ev.created_at)}</td>
            <td><span class="secaudit-action-badge ${cls}">${esc(Utils.formatAuditAction ? Utils.formatAuditAction(ev.action) : ev.action)}</span></td>
            <td>${esc(ev.actor || ev.user || '—')}</td>
            <td>${esc(ev.target || ev.resource || '—')}</td>
            <td>${esc(ev.ip || '—')}</td>
            <td>${esc(ev.details || ev.detail || '—')}</td>
          </tr>`;
        }).join('');
      }

      // Pagination
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pag = document.getElementById('events-pagination');
      if (totalPages <= 1) { pag.innerHTML = ''; return; }
      let html = '';
      for (let i = 0; i < totalPages && i < 10; i++) {
        html += `<button class="secaudit-page-btn ${i === eventsPage ? 'active' : ''}" onclick="SecurityAudit.goPage(${i})">${i + 1}</button>`;
      }
      pag.innerHTML = html;
    } catch (e) {
      console.error('SecurityAudit events error:', e);
    }
  }

  function filterEvents() { eventsPage = 0; loadEvents(); }
  function goPage(p) { eventsPage = p; loadEvents(); }

  /* ── Hardening ── */
  async function loadHardening() {
    try {
      const res = await fetch('/api/panel/security-audit/hardening');
      const json = await res.json();
      const items = json.data || json.items || json;
      const list = document.getElementById('hardening-list');
      if (!Array.isArray(items) || !items.length) {
        list.innerHTML = `<div class="secaudit-empty"><span class="material-icons">shield</span>${_('security_audit.no_hardening')}</div>`;
        return;
      }
      list.innerHTML = items.map(h => `
        <div class="secaudit-harden-card">
          <div class="secaudit-harden-status">
            <span class="material-icons ${h.implemented ? 'done' : 'pending'}">${h.implemented ? 'check_circle' : 'radio_button_unchecked'}</span>
          </div>
          <div class="secaudit-harden-body">
            <div class="secaudit-harden-header">
              <span class="secaudit-harden-name">${esc(h.name)}</span>
              <span class="secaudit-harden-severity ${h.severity || 'medium'}">${esc((h.severity || 'medium').toUpperCase())}</span>
              <span class="secaudit-harden-category">${esc(h.category || '')}</span>
            </div>
            <div class="secaudit-harden-desc">${esc(h.description || '')}</div>
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.error('SecurityAudit hardening error:', e);
    }
  }

  /* ── Vulnerabilities ── */
  async function loadVulnerabilities() {
    try {
      const res = await fetch('/api/panel/security-audit/vulnerabilities');
      const json = await res.json();
      const d = json.data || json;

      const summary = document.getElementById('vuln-summary');
      const counts = d.counts || {};
      summary.innerHTML = [
        { label: 'Critical', key: 'critical' },
        { label: 'High', key: 'high' },
        { label: 'Medium', key: 'medium' },
        { label: 'Low', key: 'low' },
        { label: 'Total', key: 'total' }
      ].map(s => `
        <div class="secaudit-vuln-card">
          <div class="vuln-count ${s.key}">${counts[s.key] ?? 0}</div>
          <div class="vuln-label">${s.label}</div>
        </div>
      `).join('');

      const vulns = d.vulnerabilities || [];
      const list = document.getElementById('vuln-list');
      if (!vulns.length) {
        list.innerHTML = `<div class="secaudit-empty"><span class="material-icons">verified</span>${_('security_audit.no_vulns')}</div>`;
      } else {
        list.innerHTML = vulns.map(v => `
          <div class="secaudit-vuln-item">
            <div class="vuln-pkg">${esc(v.package || v.name)} <span class="secaudit-harden-severity ${v.severity || 'medium'}">${esc((v.severity || '').toUpperCase())}</span></div>
            <div class="vuln-detail">${esc(v.title || v.description || '')}</div>
          </div>
        `).join('');
      }
    } catch (e) {
      console.error('SecurityAudit vulnerabilities error:', e);
    }
  }

  /* ── Helpers ── */
  function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function formatTime(t) {
    if (!t) return '—';
    try { return new Date(t).toLocaleString(); } catch { return t; }
  }
  function actionClass(a) {
    if (!a) return 'info';
    if (/fail|ban|block|denied|revoke/i.test(a)) return 'danger';
    if (/success|login_success|created/i.test(a)) return 'success';
    if (/warn|degrade|timeout/i.test(a)) return 'warn';
    return 'info';
  }

  /* ── Init ── */
  function init() {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && ['overview', 'events', 'hardening', 'vulnerabilities'].includes(tab)) {
      activeTab = tab;
    }
    // Activate correct tab on load
    document.querySelectorAll('.secaudit-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
    document.querySelectorAll('.secaudit-panel').forEach(p => {
      p.style.display = p.id === 'panel-' + activeTab ? 'block' : 'none';
    });

    if (activeTab === 'overview') loadOverview();
    else if (activeTab === 'events') loadEvents();
    else if (activeTab === 'hardening') loadHardening();
    else if (activeTab === 'vulnerabilities') loadVulnerabilities();
  }

  window.SecurityAudit = { init, switchTab, loadEvents, filterEvents, goPage };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
