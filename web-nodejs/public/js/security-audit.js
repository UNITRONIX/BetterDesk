/* Security and audit: console audit log, server events, checks, hardening, own sessions */
(function () {
  'use strict';
  const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params) : key);
  const TABS = ['audit', 'events', 'overview', 'hardening', 'sessions'];
  const TAB_ALIASES = { vulnerabilities: 'hardening' };
  const PAGE_SIZE = 50;
  const EVENTS_PAGE_SIZE = 25;

  let activeTab = 'audit';
  const loaded = {};

  /* ── Helpers ── */
  function esc(s) {
    if (s === null || s === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // The console stores UTC as "YYYY-MM-DD HH:MM:SS" without a zone; read it as UTC.
  function toDate(t) {
    if (t === null || t === undefined || t === '') return null;
    if (typeof t === 'number') return new Date(t);
    let s = String(t);
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Exact time with seconds (order matters in a log); the helper adds the tooltip and <time>
  function timeCell(t, options = {}) {
    return Utils.timeHtml(toDate(t), { relative: false, format: { second: '2-digit' }, ...options });
  }

  function formatTime(t) {
    const d = toDate(t);
    if (!d) return '—';
    return Utils.formatDate(d.toISOString(), { second: '2-digit' });
  }

  function actionLabel(action) {
    const raw = String(action || '').trim();
    if (!raw) return '—';
    const key = 'audit.action_' + raw.replace(/[^a-z0-9_]/gi, '_');
    const label = _(key);
    if (label && label !== key) return label;
    // Unknown action code: "device_group_saved" -> "Device group saved"
    const words = raw.replace(/[_.-]+/g, ' ').trim().toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function errorRow(colspan, message, retryId) {
    return `<tr><td colspan="${colspan}" class="state-cell"><span class="state is-error">${esc(message)} <button type="button" class="btn btn-sm" id="${retryId}">${esc(_('security_audit.try_again'))}</button></span></td></tr>`;
  }

  function stateRow(colspan, message) {
    return `<tr><td colspan="${colspan}" class="state-cell">${esc(message)}</td></tr>`;
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    let json = null;
    try { json = await res.json(); } catch (_e) { json = null; }
    if (!res.ok || (json && json.success === false)) {
      const err = new Error((json && json.error) || ('HTTP ' + res.status));
      throw err;
    }
    return json;
  }

  function renderPager(nav, page, pageCount, onGo) {
    if (!nav) return;
    if (pageCount <= 1) { nav.innerHTML = ''; return; }
    nav.innerHTML = `
      <button type="button" class="btn btn-sm" data-go="${page - 1}" ${page <= 0 ? 'disabled' : ''}>${esc(_('security_audit.newer'))}</button>
      <span class="pagination-info">${esc(_('security_audit.page_of', { page: page + 1, total: pageCount }))}</span>
      <button type="button" class="btn btn-sm" data-go="${page + 1}" ${page >= pageCount - 1 ? 'disabled' : ''}>${esc(_('security_audit.older'))}</button>`;
    nav.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => onGo(Number(b.dataset.go))));
  }

  /* ── Tabs ── */
  function showTab(tab, focus) {
    activeTab = tab;
    document.querySelectorAll('.secaudit-tab').forEach((t) => {
      const on = t.dataset.tab === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    document.querySelectorAll('.secaudit-panel').forEach((p) => { p.hidden = p.id !== 'panel-' + tab; });
    if (!loaded[tab]) loadTab(tab);
  }

  function switchTab(tab) {
    tab = TAB_ALIASES[tab] || tab;
    if (!TABS.includes(tab)) tab = 'audit';
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    if (tab !== 'audit') { params.delete('q'); params.delete('type'); }
    history.replaceState(null, '', '?' + params.toString());
    showTab(tab);
    document.querySelectorAll('.secaudit-stack tbody').forEach(syncDetailToggles);
  }

  function loadTab(tab) {
    loaded[tab] = true;
    if (tab === 'audit') loadAudit();
    else if (tab === 'events') { loadEvents(); loadEventsChart(); }
    else if (tab === 'overview') loadOverview();
    else if (tab === 'hardening') { loadHardening(); loadVulnerabilities(); }
    else if (tab === 'sessions') loadSessions();
  }

  /* ── Console audit log (who did what in this console) ── */
  const CATEGORY_TESTS = {
    bans: (a) => /(^|_)(un)?ban|banned|blocklist|ip_block/.test(a),
    signins: (a) => /^(login|logout|auth_|session_|2fa_|password_)/.test(a),
    failed: (a) => /(login|auth)(_login)?_failed/.test(a),
    devices: (a) => /^(device_|devices_|enrollment_|folder_|peer_|remote_|registration)/.test(a),
    people: (a) => /^(user_|role_|permission|group_|org_|organization_|invite)/.test(a),
    settings: (a) => /^(settings|setting_|config|theme_|branding_|backup_|restore|server_|update|smtp|commercialization_|billing_|key_|token_|policy)/.test(a)
  };

  // "Device 900100019 banned", "Approved enrollment for device 900200005", "Banned 900100028 (...)"
  const DEVICE_RE = /\b(?:device|Device|Banned|Unbanned|Deleted|Restored|Connected to)\s+([A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)\b/;

  let auditRows = [];
  let auditPage = 0;

  async function loadAudit() {
    const tbody = document.getElementById('audit-tbody');
    tbody.innerHTML = stateRow(6, _('security_audit.loading'));
    document.getElementById('audit-count').textContent = '';
    try {
      // Who has a profile picture, for the avatars in the "who" column
      const [json] = await Promise.all([getJson('/api/settings/audit?limit=2000'), Utils.loadAvatars()]);
      const list = Array.isArray(json) ? json : (json.data || []);
      auditRows = list.map((r) => {
        const action = String(r.action || '');
        const details = String(r.details || '');
        const m = details.match(DEVICE_RE);
        return {
          time: r.created_at,
          who: r.username || (r.user_id ? '#' + r.user_id : ''),
          userId: r.user_id || null,
          action,
          label: actionLabel(action),
          device: m ? m[1] : '',
          details,
          ip: r.ip_address || ''
        };
      });
      renderAudit();
    } catch (e) {
      tbody.innerHTML = errorRow(6, _('security_audit.audit_load_failed'), 'audit-retry');
      document.getElementById('audit-retry').addEventListener('click', loadAudit);
      document.getElementById('audit-pagination').innerHTML = '';
    }
  }

  function filteredAudit() {
    const q = (document.getElementById('audit-search').value || '').trim().toLowerCase();
    const type = document.getElementById('audit-filter').value;
    const test = CATEGORY_TESTS[type];
    return auditRows.filter((r) => {
      if (test && !test(r.action.toLowerCase())) return false;
      if (!q) return true;
      return [r.who, r.action, r.label, r.device, r.details, r.ip].join(' ').toLowerCase().includes(q);
    });
  }

  function renderAudit() {
    const tbody = document.getElementById('audit-tbody');
    const rows = filteredAudit();
    const count = document.getElementById('audit-count');
    const filtering = rows.length !== auditRows.length;
    count.innerHTML = filtering
      ? _('security_audit.audit_count_filtered', { shown: `<strong>${rows.length}</strong>`, total: auditRows.length })
      : _('security_audit.audit_count', { total: `<strong>${auditRows.length}</strong>` });
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (auditPage >= pageCount) auditPage = pageCount - 1;
    if (!auditRows.length) {
      tbody.innerHTML = stateRow(6, _('security_audit.audit_empty'));
    } else if (!rows.length) {
      tbody.innerHTML = stateRow(6, _('security_audit.audit_no_match'));
    } else {
      tbody.innerHTML = rows.slice(auditPage * PAGE_SIZE, (auditPage + 1) * PAGE_SIZE).map((r) => `
        <tr>
          <td class="secaudit-time">${timeCell(r.time)}</td>
          <td>${Utils.userHtml(r.userId ? { id: r.userId, username: r.who } : r.who, { avatar: true })}</td>
          <td>${Utils.tagHtml(r.label)}</td>
          <td>${Utils.valueHtml(r.device)}</td>
          <td class="secaudit-details">${detailsHtml(r.details)}</td>
          <td>${Utils.valueHtml(r.ip)}</td>
        </tr>`).join('');
    }
    renderPager(document.getElementById('audit-pagination'), auditPage, pageCount, (p) => { auditPage = p; renderAudit(); });
  }

  function syncAuditUrl() {
    const params = new URLSearchParams(window.location.search);
    const q = document.getElementById('audit-search').value.trim();
    const type = document.getElementById('audit-filter').value;
    params.set('tab', 'audit');
    if (q) params.set('q', q); else params.delete('q');
    if (type) params.set('type', type); else params.delete('type');
    history.replaceState(null, '', '?' + params.toString());
  }

  /* ── Server events (recorded by the BetterDesk server) ── */
  let eventsPage = 0;

  async function loadEvents() {
    const tbody = document.getElementById('events-tbody');
    const pag = document.getElementById('events-pagination');
    tbody.innerHTML = stateRow(5, _('security_audit.loading'));
    try {
      const filter = document.getElementById('event-filter').value || '';
      const params = new URLSearchParams({ limit: EVENTS_PAGE_SIZE, offset: eventsPage * EVENTS_PAGE_SIZE });
      if (filter) params.set('action', filter);
      const json = await getJson('/api/panel/security-audit/events?' + params);
      const d = json.data || json;
      const events = d.events || d.items || [];
      if (!events.length) {
        tbody.innerHTML = stateRow(5, eventsPage > 0 ? _('security_audit.no_more_events') : _('security_audit.no_events'));
      } else {
        tbody.innerHTML = events.map((ev) => `<tr>
            <td class="secaudit-time">${timeCell(ev.timestamp || ev.created_at)}</td>
            <td>${Utils.tagHtml(actionLabel(ev.action))}</td>
            <td>${Utils.userHtml(ev.actor || ev.user)}</td>
            <td>${Utils.valueHtml(ev.target || ev.resource)}</td>
            <td class="secaudit-details">${detailsHtml(formatDetails(ev.details || ev.detail))}</td>
          </tr>`).join('');
      }
      // The server reports the unfiltered total even when filtering, so only trust it without a filter.
      const total = filter ? null : Number(d.total);
      const pageCount = total && Number.isFinite(total)
        ? Math.ceil(total / EVENTS_PAGE_SIZE)
        : eventsPage + (events.length === EVENTS_PAGE_SIZE ? 2 : 1);
      renderPager(pag, eventsPage, pageCount, (p) => { eventsPage = p; loadEvents(); });
    } catch (e) {
      tbody.innerHTML = errorRow(5, _('security_audit.events_load_failed'), 'events-retry');
      document.getElementById('events-retry').addEventListener('click', loadEvents);
      pag.innerHTML = '';
    }
  }

  function formatDetails(details) {
    if (!details) return '';
    if (typeof details !== 'object') return String(details);
    return Object.entries(details)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
  }

  /* ── Security checks ── */
  async function loadOverview() {
    const summary = document.getElementById('checks-summary');
    const tbody = document.getElementById('checks-grid');
    summary.textContent = _('security_audit.loading');
    summary.classList.remove('is-error');
    tbody.innerHTML = '';
    renderChecksShare(0, 0);
    try {
      const json = await getJson('/api/panel/security-audit/overview');
      const d = json.data || json;
      const checks = d.checks || [];
      const passed = checks.filter((c) => c.pass ?? c.passed).length;
      // The numbers are in the legend under the bar; the sentence says what to do
      summary.textContent = !checks.length ? _('security_audit.no_checks')
        : (passed === checks.length ? _('security_audit.checks_all_pass') : _('security_audit.checks_some_fail'));
      renderChecksShare(passed, checks.length - passed);
      tbody.innerHTML = checks.map((c) => {
        const ok = !!(c.pass ?? c.passed);
        const nameKey = 'security_audit.check_' + c.id;
        const fixKey = 'security_audit.fix_' + c.id;
        const name = _(nameKey) !== nameKey ? _(nameKey) : c.name;
        const fix = ok ? '' : (_(fixKey) !== fixKey ? _(fixKey) : '');
        return `<tr>
          <td>${esc(name)}</td>
          <td>${Utils.statusHtml(ok ? 'good' : 'danger', ok ? _('security_audit.passed') : _('security_audit.failed'))}</td>
          <td class="secaudit-todo">${ok ? Utils.emptyHtml() : esc(fix)}</td>
        </tr>`;
      }).join('');

      const stats = d.stats || {};
      const num = (v) => (v === undefined || v === null ? Utils.emptyHtml() : esc(Utils.formatNumber(v)));
      document.getElementById('overview-stats').innerHTML = `
        <dt>${esc(_('security_audit.stat_failed_logins'))}</dt><dd>${num(stats.failed_logins)}</dd>
        <dt>${esc(_('security_audit.stat_blocked'))}</dt><dd>${num(stats.bans ?? stats.active_bans)}</dd>
        <dt>${esc(_('security_audit.stat_api_keys'))}</dt><dd>${stats.api_keys === undefined ? Utils.emptyHtml()
          : esc(_('security_audit.stat_api_keys_value', { total: stats.api_keys, old: stats.old_keys ?? 0 }))}</dd>
        <dt>${esc(_('security_audit.stat_config_changes'))}</dt><dd>${num(stats.config_changes)}</dd>`;

      const tls = d.tls || {};
      const tlsValue = (v) => (typeof v !== 'boolean'
        ? Utils.statusHtml('neutral', _('security_audit.tls_unknown'))
        : Utils.booleanHtml(v, { on: _('security_audit.enabled'), off: _('security_audit.disabled') }));
      document.getElementById('tls-grid').innerHTML = [
        [_('security_audit.tls_signal'), tls.signal],
        [_('security_audit.tls_relay'), tls.relay],
        [_('security_audit.tls_api'), tls.api],
        [_('security_audit.tls_wss'), tls.wss]
      ].map(([label, v]) => `<dt>${esc(label)}</dt><dd>${tlsValue(v)}</dd>`).join('');
    } catch (e) {
      summary.innerHTML = `<span class="state is-error">${esc(_('security_audit.overview_load_failed'))} <button type="button" class="btn btn-sm" id="overview-retry">${esc(_('security_audit.try_again'))}</button></span>`;
      document.getElementById('overview-retry').addEventListener('click', loadOverview);
    }
  }

  // Passed and failed checks as one bar with a legend that carries the numbers
  function renderChecksShare(passed, failed) {
    const bar = document.getElementById('checks-bar');
    const legend = document.getElementById('checks-legend');
    if (!bar || !legend) return;
    bar.textContent = '';
    legend.textContent = '';
    const total = passed + failed;
    bar.hidden = total === 0;
    if (!total) return;
    const num = new Intl.NumberFormat((window.BetterDesk && window.BetterDesk.lang) || undefined);
    [
      { n: passed, cls: 'is-ok', key: 'security_audit.checks_legend_passed' },
      { n: failed, cls: 'is-danger', key: 'security_audit.checks_legend_failed' }
    ].forEach((part) => {
      if (part.n > 0) {
        const seg = document.createElement('span');
        seg.className = part.cls;
        seg.style.flexGrow = String(part.n);
        bar.appendChild(seg);
      }
      const li = document.createElement('li');
      li.innerHTML = `<span class="key ${part.cls}" aria-hidden="true"></span><span>${
        esc(_(part.key)).replace('{n}', `<strong>${esc(num.format(part.n))}</strong>`)}</span>`;
      legend.appendChild(li);
    });
  }

  /* ── Server events per day ──
     The server keeps its events in memory since it last started (newest first, at most
     1000 per request), so the chart is drawn only when the loaded events reach back to
     the first of the last 14 days. Otherwise the section says which range they cover. */
  const CHART_DAYS = 14;

  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function loadEventsChart() {
    const section = document.getElementById('events-chart-section');
    const range = document.getElementById('events-range');
    const chart = document.getElementById('events-chart');
    if (!section || !range || !chart) return;
    let events;
    let total;
    try {
      const json = await getJson('/api/panel/security-audit/events?limit=1000');
      const d = json.data || json;
      events = (d.events || d.items || []).map((ev) => toDate(ev.timestamp || ev.created_at)).filter(Boolean);
      total = Number(d.total);
    } catch (e) {
      section.hidden = true; // the table below shows the load error
      return;
    }
    chart.textContent = '';
    if (!events.length) { section.hidden = true; return; }
    section.hidden = false;

    const lang = (window.BetterDesk && window.BetterDesk.lang) || document.documentElement.lang || 'en';
    const num = new Intl.NumberFormat(lang);
    const oldest = new Date(Math.min(...events.map((d) => d.getTime())));
    let text = _('security_audit.events_range', { from: formatTime(oldest.getTime()), count: num.format(events.length) });
    if (Number.isFinite(total) && total > events.length) {
      text += ' ' + _('security_audit.events_range_partial', { total: num.format(total) });
    }

    const firstDay = new Date();
    firstDay.setHours(0, 0, 0, 0);
    firstDay.setDate(firstDay.getDate() - (CHART_DAYS - 1));
    if (oldest > firstDay) {
      range.textContent = text + ' ' + _('security_audit.events_chart_needs', { days: CHART_DAYS });
      return;
    }
    range.textContent = text;

    const days = [];
    for (let i = 0; i < CHART_DAYS; i++) {
      const d = new Date(firstDay);
      d.setDate(firstDay.getDate() + i);
      d.setHours(12);
      days.push(d);
    }
    const keys = days.map(dayKey);
    const perDay = keys.map(() => 0);
    events.forEach((d) => { const i = keys.indexOf(dayKey(d)); if (i >= 0) perDay[i]++; });
    const fmtDay = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' });
    const fmtLong = new Intl.DateTimeFormat(lang, { weekday: 'long', month: 'long', day: 'numeric' });
    const sum = perDay.reduce((a, b) => a + b, 0);
    const peak = perDay.indexOf(Math.max(...perDay));
    window.UiChart.render(chart, {
      kind: 'columns',
      label: _('security_audit.events_chart_title'),
      summary: _('security_audit.events_chart_summary', {
        total: num.format(sum), days: CHART_DAYS, peakDay: fmtLong.format(days[peak]), peak: num.format(perDay[peak])
      }),
      labels: days.map((d) => fmtDay.format(d)),
      xHeading: _('security_audit.events_chart_day'),
      series: [{ name: _('security_audit.events_chart_series'), values: perDay }],
      format: (v) => num.format(v)
    });
  }

  /* ── Hardening plan ── */
  async function loadHardening() {
    const list = document.getElementById('hardening-list');
    const count = document.getElementById('hardening-count');
    list.innerHTML = `<li class="list-row is-empty">${esc(_('security_audit.loading'))}</li>`;
    try {
      const json = await getJson('/api/panel/security-audit/hardening');
      const items = json.data || json.items || json.priorities || json;
      if (!Array.isArray(items) || !items.length) {
        count.textContent = '';
        list.innerHTML = `<li class="list-row is-empty">${esc(_('security_audit.no_hardening'))}</li>`;
        return;
      }
      const done = items.filter((h) => h.implemented).length;
      count.textContent = _('security_audit.hardening_count', { done, total: items.length });
      list.innerHTML = items.map((h) => {
        const sev = String(h.severity || 'medium').toLowerCase();
        const sevKey = 'security_audit.severity_' + sev;
        const sevLabel = _(sevKey) !== sevKey ? _(sevKey) : sev;
        return `<li class="list-row">
          <span class="row-main">
            <span class="row-title">${esc(h.name)}</span>
            <span class="row-sub">${esc(h.description || '')}</span>
            <span class="row-sub secaudit-meta"><span class="sr-only">${esc(_('security_audit.hardening_meta', { severity: sevLabel, category: h.category || '—' }))}</span><span class="secaudit-meta-marks" aria-hidden="true">${Utils.statusHtml(sev, sevLabel.charAt(0).toUpperCase() + sevLabel.slice(1))}${h.category ? Utils.tagHtml(h.category) : ''}</span></span>
          </span>
          <span class="row-end">${Utils.statusHtml(h.implemented ? 'good' : 'waiting', h.implemented ? _('security_audit.done') : _('security_audit.not_done'))}</span>
        </li>`;
      }).join('');
    } catch (e) {
      count.textContent = '';
      list.innerHTML = `<li class="list-row"><span class="state is-error">${esc(_('security_audit.hardening_load_failed'))} <button type="button" class="btn btn-sm" id="hardening-retry">${esc(_('security_audit.try_again'))}</button></span></li>`;
      document.getElementById('hardening-retry').addEventListener('click', loadHardening);
    }
  }

  /* ── Dependency scan ── */
  async function loadVulnerabilities() {
    const summary = document.getElementById('vuln-summary');
    const list = document.getElementById('vuln-list');
    summary.textContent = '';
    list.innerHTML = `<p class="state">${esc(_('security_audit.loading'))}</p>`;
    try {
      const json = await getJson('/api/panel/security-audit/vulnerabilities');
      const d = json.data || json;
      if (d.scan_available === false) {
        list.innerHTML = `<p class="state">${esc(_('security_audit.vuln_no_scan'))}</p>`;
        return;
      }
      const c = d.counts || {};
      summary.textContent = _('security_audit.vuln_counts', {
        total: c.total ?? 0, critical: c.critical ?? 0, high: c.high ?? 0, medium: c.medium ?? 0, low: c.low ?? 0
      });
      const vulns = d.vulnerabilities || [];
      if (!vulns.length) {
        list.innerHTML = `<p class="state">${esc(_('security_audit.no_vulns'))}</p>`;
        return;
      }
      list.innerHTML = `<ul class="list">${vulns.map((v) => {
        const sev = String(v.severity || '').toLowerCase();
        const sevKey = 'security_audit.severity_' + sev;
        return `<li class="list-row"><span class="row-main"><span class="row-title">${esc(v.package || v.name)}</span>
          <span class="row-sub">${esc(v.title || v.description || '')}</span></span>
          <span class="row-end">${Utils.statusHtml(sev, _(sevKey) !== sevKey ? _(sevKey) : sev)}</span></li>`;
      }).join('')}</ul>`;
    } catch (e) {
      list.innerHTML = `<p class="state is-error">${esc(_('security_audit.vuln_load_failed'))} <button type="button" class="btn btn-sm" id="vuln-retry">${esc(_('security_audit.try_again'))}</button></p>`;
      document.getElementById('vuln-retry').addEventListener('click', loadVulnerabilities);
    }
  }

  /* ── Your console sessions ── */
  async function loadSessions() {
    const tbody = document.getElementById('sessions-tbody');
    tbody.innerHTML = stateRow(7, _('security_audit.loading'));
    try {
      const json = await getJson('/api/auth/sessions');
      const d = json.data || json;
      const sessions = d.sessions || [];
      const policy = d.policy || {};
      const summary = document.getElementById('session-policy-summary');
      if (summary && (policy.idleTimeoutMs || policy.maxAgeMs)) {
        summary.textContent = _('security_audit.sessions_policy')
          .replace('{{idle}}', String(Math.round((policy.idleTimeoutMs || 0) / 60000)))
          .replace('{{max}}', String(Math.round((policy.maxAgeMs || 0) / 3600000)));
      }
      if (!sessions.length) {
        tbody.innerHTML = stateRow(7, _('security_audit.no_sessions'));
        return;
      }
      tbody.innerHTML = sessions.map((s) => {
        const status = s.current ? 'current' : (s.active ? 'active' : 'ended');
        const label = _('security_audit.session_' + status);
        let reason = Utils.emptyHtml();
        if (s.endReason) {
          const key = 'security_audit.reason_' + s.endReason;
          reason = esc(_(key) !== key ? _(key) : s.endReason);
        }
        return `<tr>
          <td>${Utils.statusHtml(status === 'ended' ? 'neutral' : 'good', label)}</td>
          <td>${Utils.valueHtml(s.ipAddress)}</td>
          <td class="secaudit-time">${timeCell(s.createdAt)}</td>
          <td class="secaudit-time">${Utils.timeHtml(toDate(s.lastActivityAt))}</td>
          <td class="secaudit-time">${timeCell(s.endedAt)}</td>
          <td>${reason}</td>
          <td class="secaudit-ua">${uaHtml(s.userAgent)}</td>
        </tr>`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = errorRow(7, _('security_audit.sessions_load_failed'), 'sessions-retry');
      document.getElementById('sessions-retry').addEventListener('click', loadSessions);
    }
  }

  // "Chrome 156 on Windows" from a browser string; the full string stays under it on one line
  function describeUa(ua) {
    const m = (re) => { const r = ua.match(re); return r ? r[1] : ''; };
    let browser = '';
    if (/Edg\//.test(ua)) browser = 'Edge ' + m(/Edg\/(\d+)/);
    else if (/OPR\//.test(ua)) browser = 'Opera ' + m(/OPR\/(\d+)/);
    else if (/Firefox\//.test(ua)) browser = 'Firefox ' + m(/Firefox\/(\d+)/);
    else if (/Chrome\//.test(ua)) browser = (/HeadlessChrome/.test(ua) ? 'Headless Chrome ' : 'Chrome ') + m(/Chrome\/(\d+)/);
    else if (/Safari\//.test(ua)) browser = 'Safari ' + m(/Version\/(\d+)/);
    let os = '';
    if (/Windows/.test(ua)) os = 'Windows';
    else if (/iPhone|iPad/.test(ua)) os = 'iOS';
    else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    browser = browser.trim();
    if (browser && os) return tr('security_audit.ua_on', `${browser}, ${os}`, { browser, os });
    return browser || os || '';
  }

  function uaHtml(ua) {
    if (!ua) return Utils.emptyHtml();
    const name = describeUa(ua);
    if (!name) return `<span class="cell-sub" title="${esc(ua)}">${esc(ua)}</span>`;
    return `<span>${esc(name)}</span><span class="cell-sub" title="${esc(ua)}">${esc(ua)}</span>`;
  }

  // A string added in this pass, with a fallback until the language files are reloaded
  function tr(key, fallback, vars) {
    const text = _(key, vars);
    return text === key ? fallback : text;
  }

  // Long details are cut after two lines; "Show all" opens the rest in place
  const DETAILS_CLAMP = 140;
  function detailsHtml(text) {
    if (!text) return Utils.emptyHtml();
    if (String(text).length <= DETAILS_CLAMP) return esc(text);
    return `<span class="secaudit-details-text is-clamped">${esc(text)}</span>`
      + `<button type="button" class="btn-link secaudit-details-toggle" aria-expanded="false">${esc(tr('security_audit.details_more', 'Show all'))}</button>`;
  }

  // "Show all" only where the two lines really cut text off (wide screens fit more)
  function syncDetailToggles(root) {
    root.querySelectorAll('.secaudit-details-toggle').forEach((btn) => {
      const text = btn.previousElementSibling;
      // a hidden tab has no layout yet; it is checked again when shown
      if (!text || !text.clientHeight || btn.getAttribute('aria-expanded') === 'true') return;
      btn.hidden = text.scrollHeight <= text.clientHeight + 1;
    });
  }

  function toggleDetails(e) {
    const btn = e.target.closest('.secaudit-details-toggle');
    if (!btn) return;
    const text = btn.previousElementSibling;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    text.classList.toggle('is-clamped', !open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? tr('security_audit.details_less', 'Show less') : tr('security_audit.details_more', 'Show all');
  }

  // Phones show each row as a block; every cell carries its column name (see ui/security-audit.css)
  function labelCells(tbody) {
    const heads = Array.from(tbody.closest('table').querySelectorAll('thead th')).map((th) => th.textContent.trim());
    tbody.querySelectorAll('tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        if (td.classList.contains('state-cell') || !heads[i]) return;
        if (td.getAttribute('data-label') !== heads[i]) td.setAttribute('data-label', heads[i]);
      });
    });
  }

  /* ── Init ── */
  function init() {
    document.getElementById('audit-tbody').addEventListener('click', toggleDetails);
    document.getElementById('events-tbody').addEventListener('click', toggleDetails);
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => document.querySelectorAll('.secaudit-stack tbody').forEach(syncDetailToggles), 150);
    });
    document.querySelectorAll('.secaudit-stack tbody').forEach((tbody) => {
      new MutationObserver(() => { labelCells(tbody); syncDetailToggles(tbody); }).observe(tbody, { childList: true });
      labelCells(tbody);
    });

    const params = new URLSearchParams(window.location.search);
    let tab = params.get('tab') || 'audit';
    tab = TAB_ALIASES[tab] || tab;
    if (!TABS.includes(tab)) tab = 'audit';

    const search = document.getElementById('audit-search');
    const filter = document.getElementById('audit-filter');
    if (params.get('q')) search.value = params.get('q');
    if (params.get('type') && filter.querySelector(`option[value="${CSS.escape(params.get('type'))}"]`)) filter.value = params.get('type');

    const tabButtons = Array.from(document.querySelectorAll('.secaudit-tab'));
    tabButtons.forEach((btn, i) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
      btn.addEventListener('keydown', (e) => {
        let next = null;
        const rtl = document.documentElement.dir === 'rtl';
        if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = tabButtons[(i + 1) % tabButtons.length];
        else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = tabButtons[(i - 1 + tabButtons.length) % tabButtons.length];
        else if (e.key === 'Home') next = tabButtons[0];
        else if (e.key === 'End') next = tabButtons[tabButtons.length - 1];
        if (!next) return;
        e.preventDefault();
        switchTab(next.dataset.tab);
        next.focus();
      });
    });

    let searchTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { auditPage = 0; renderAudit(); syncAuditUrl(); }, 150);
    });
    filter.addEventListener('change', () => { auditPage = 0; renderAudit(); syncAuditUrl(); });
    document.getElementById('audit-refresh').addEventListener('click', loadAudit);
    document.getElementById('event-filter').addEventListener('change', () => { eventsPage = 0; loadEvents(); });
    document.getElementById('events-refresh').addEventListener('click', () => { loadEvents(); loadEventsChart(); });
    document.getElementById('sessions-refresh').addEventListener('click', loadSessions);

    showTab(tab);
  }

  window.SecurityAudit = { init, switchTab, loadEvents, loadAudit, loadSessions };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
