/* policies.js: organization policies (/policies, /policies/<orgId>) */
(function () {
  'use strict';

  const t = (key, params) => (typeof window._ === 'function' ? window._(key, params || {}) : key);

  const SECTIONS = ['connection', 'features', 'security', 'network', 'update'];
  const STATUS_IDS = {
    connection: 'conn-status', features: 'feat-status', security: 'sec-status',
    network: 'net-status', update: 'upd-status'
  };

  let currentOrgId = null;
  let policyData = {};
  let orgIds = new Set();
  let dirtySections = new Set();
  let loadSeq = 0;

  const $ = (id) => document.getElementById(id);
  const form = () => $('policy-form');

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    placeToc();
    $('policy-org-select').addEventListener('change', onOrgChange);
    const f = form();
    f.addEventListener('submit', (e) => { e.preventDefault(); saveAll(); });
    const markSection = (e) => {
      const sec = e.target.closest('[data-section]');
      if (sec) dirtySections.add(sec.dataset.section);
    };
    f.addEventListener('input', markSection);
    f.addEventListener('change', markSection);

    await loadOrganizations();
    // With one organization there is nothing to choose
    const fromUrl = orgIdFromPath() || (orgIds.size === 1 ? [...orgIds][0] : null);
    if (!fromUrl) showOrgPick(true);
    if (fromUrl) {
      if (orgIds.has(fromUrl)) {
        $('policy-org-select').value = fromUrl;
        await selectOrg(fromUrl);
      } else if (!$('policy-org-select').dataset.failed) {
        setState(`<p class="state is-error">${esc(t('policies.org_not_found'))}</p>`);
      }
    }
  }

  // /policies/<orgId> preselects that organization
  function orgIdFromPath() {
    const m = window.location.pathname.match(/^\/policies\/([^/?#]+)/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (_) { return null; }
  }

  function setState(html) {
    const el = $('policy-state');
    el.innerHTML = html;
    el.hidden = !html;
  }

  /* ── Organizations ── */
  async function loadOrganizations() {
    const sel = $('policy-org-select');
    try {
      const resp = await fetch('/api/panel/org', { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(resp.statusText || String(resp.status));
      const data = await resp.json();
      const orgs = data.organizations || data.data || data || [];
      (Array.isArray(orgs) ? orgs : []).forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.name || o.id;
        sel.appendChild(opt);
        orgIds.add(String(o.id));
      });
      renderOrgList(Array.isArray(orgs) ? orgs : []);
      if (!orgIds.size) setState(`<p class="state">${esc(t('policies.no_orgs'))}</p>`);
    } catch (e) {
      sel.dataset.failed = '1';
      setState(`<p class="state is-error">${esc(t('policies.orgs_failed'))} <button type="button" class="btn btn-sm" id="policy-orgs-retry">${esc(t('actions.retry'))}</button></p>`);
      $('policy-orgs-retry').addEventListener('click', () => window.location.reload());
    }
  }

  // Every organization as a row; opening one is the same as choosing it in the select
  function renderOrgList(orgs) {
    const list = $('policy-org-list');
    list.innerHTML = orgs.map(o => `
      <li><a class="list-row" href="/policies/${encodeURIComponent(o.id)}" data-org-id="${esc(o.id)}">
        <span class="row-main"><span class="row-title">${esc(o.name || o.id)}</span></span>
        <span class="material-icons row-chevron" aria-hidden="true">chevron_right</span></a></li>`).join('');
    list.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-org-id]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      $('policy-org-select').value = a.dataset.orgId;
      onOrgChange().then(() => {
        const h = $('pol-connection-title');
        if (h && !$('policy-sections').hidden) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      });
    });
  }

  function showOrgPick(on) {
    $('policy-org-pick').hidden = !(on && orgIds.size);
  }

  async function onOrgChange() {
    const sel = $('policy-org-select');
    const next = sel.value;
    if (currentOrgId && window.UiForm && UiForm.isDirty(form())) {
      const ok = await Modal.confirm({
        title: t('policies.discard_title'),
        message: t('policies.discard_message'),
        confirmLabel: t('policies.discard_confirm'),
        danger: true
      });
      if (!ok) { sel.value = currentOrgId; return; }
    }
    const path = next ? `/policies/${encodeURIComponent(next)}` : '/policies';
    if (window.location.pathname !== path) window.history.replaceState(null, '', path);
    await selectOrg(next);
  }

  async function selectOrg(orgId) {
    currentOrgId = orgId || null;
    $('policy-sections').hidden = true;
    showOrgPick(!currentOrgId);
    if (!currentOrgId) {
      setState(`<p class="state">${esc(t('policies.pick_org_state'))}</p>`);
      return;
    }
    await fetchPolicies();
  }

  /* ── Fetch policies ── */
  async function fetchPolicies() {
    if (!currentOrgId) return;
    const seq = ++loadSeq;
    setState(`<p class="state">${esc(t('policies.loading'))}</p>`);
    try {
      const resp = await fetch(`/api/panel/policies/${encodeURIComponent(currentOrgId)}`, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(await errorText(resp));
      const raw = await resp.json();
      if (seq !== loadSeq) return;
      policyData = raw.data || raw || {};
      populateForms();
      setState('');
      $('policy-sections').hidden = false;
      loadAuditLog();
      loadOrgSummary(currentOrgId);
    } catch (e) {
      if (seq !== loadSeq) return;
      setState(`<p class="state is-error">${esc(t('policies.load_failed'))} <button type="button" class="btn btn-sm" id="policy-load-retry">${esc(t('actions.retry'))}</button></p>`);
      $('policy-load-retry').addEventListener('click', fetchPolicies);
    }
  }

  /* ── Populate ── */
  // Keep 0 when it was saved; fall back only when the value is missing
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));

  function populateForms() {
    const c = policyData.connection || {};
    setVal('pol-connection-mode', c.mode || 'attended');
    setVal('pol-max-session', num(c.max_session_duration, 480));
    setVal('pol-idle-lock', num(c.idle_lock_timeout, 15));
    setVal('pol-wallpaper', c.wallpaper || 'show');

    const f = policyData.features || {};
    setChecked('pol-file-transfer', f.allow_file_transfer !== false);
    setChecked('pol-clipboard', f.allow_clipboard !== false);
    setChecked('pol-audio', !!f.allow_audio);
    setChecked('pol-recording', f.allow_recording !== false);

    const s = policyData.security || {};
    setChecked('pol-require-2fa', s.require_2fa !== false);
    setVal('pol-pass-min', num(s.password_min_length, 12));
    setChecked('pol-pass-special', s.password_require_special !== false);
    setVal('pol-pass-age', num(s.password_max_age_days, 90));
    setVal('pol-allowed-ops', (s.allowed_operators || []).join(', '));

    const n = policyData.network || {};
    setChecked('pol-block-p2p', !!n.block_direct_p2p);
    setVal('pol-relay-servers', (n.allowed_relay_servers || []).join('\n'));
    setVal('pol-ip-allowlist', (n.ip_allowlist || []).join('\n'));

    const u = policyData.update || {};
    setChecked('pol-auto-update', u.auto_update !== false);
    setVal('pol-update-channel', u.channel || 'stable');

    renderSectionStates();
    dirtySections = new Set();
    if (window.UiForm) UiForm.reset(form());
  }

  function isSet(obj) {
    return !!(obj && typeof obj === 'object' && Object.keys(obj).length > 0);
  }

  // "Set for this organization" / "Not set" next to each heading and in the contents,
  // and how many groups are set in the side column
  function setSectionState(section, obj) {
    const set = isSet(obj);
    const text = set ? t('policies.configured') : t('policies.not_configured');
    const el = $(STATUS_IDS[section]);
    if (el) {
      el.textContent = text;
      el.classList.toggle('is-set', set);
    }
    const toc = document.querySelector(`[data-toc-state="${section}"]`);
    if (toc) {
      toc.textContent = text;
      toc.classList.toggle('is-set', set);
    }
  }

  function renderSectionStates() {
    SECTIONS.forEach(sec => setSectionState(sec, policyData[sec] || {}));
    const n = SECTIONS.filter(sec => isSet(policyData[sec])).length;
    $('policy-org-groups').textContent = t('policies.groups_set_value', { set: n, total: SECTIONS.length });
  }

  /* ── Side column: the organization ── */
  async function countOf(url, key) {
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) return null;
      const data = await resp.json();
      const list = data[key] || data.data || data;
      return Array.isArray(list) ? list.length : null;
    } catch (_) {
      return null;
    }
  }

  async function loadOrgSummary(orgId) {
    const sel = $('policy-org-select');
    const opt = sel.options[sel.selectedIndex];
    $('policy-org-name').textContent = opt && opt.value ? opt.textContent : '';
    $('policy-org-link').href = `/organizations/${encodeURIComponent(orgId)}`;
    const devices = $('policy-org-devices');
    const people = $('policy-org-people');
    devices.textContent = '…';
    people.textContent = '…';
    const base = `/api/panel/org/${encodeURIComponent(orgId)}`;
    const [nDevices, nPeople] = await Promise.all([countOf(base + '/devices', 'devices'), countOf(base + '/users', 'users')]);
    if (orgId !== currentOrgId) return;
    const fmt = new Intl.NumberFormat((window.BetterDesk && window.BetterDesk.lang) || undefined);
    devices.textContent = nDevices === null ? t('policies.count_unknown') : fmt.format(nDevices);
    // People need the user permissions; leave the line out without them
    document.querySelectorAll('[data-org-people]').forEach(n => { n.hidden = nPeople === null; });
    if (nPeople !== null) people.textContent = fmt.format(nPeople);
  }

  /* ── Contents: inline above the form, in the side column on wide screens ── */
  function placeToc() {
    const nav = $('policy-toc');
    const inline = $('policy-toc-inline');
    const side = $('policy-toc-side');
    if (!nav || !inline || !side || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 1200px)');
    const place = () => {
      const target = mq.matches ? side : inline;
      if (nav.parentElement !== target) target.appendChild(nav);
      nav.classList.toggle('is-side', mq.matches);
      inline.hidden = mq.matches;
      side.hidden = !mq.matches;
    };
    place();
    if (mq.addEventListener) mq.addEventListener('change', place);
    else if (mq.addListener) mq.addListener(place);

    // Mark the group in view
    if (typeof IntersectionObserver !== 'function') return;
    const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
    const visible = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => visible.set(e.target.id, e.isIntersecting));
      const first = links.find(a => visible.get(a.getAttribute('href').slice(1)));
      if (!first) return;
      links.forEach(a => {
        if (a === first) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }, { rootMargin: '-80px 0px -55% 0px' });
    links.forEach(a => {
      const target = document.getElementById(a.getAttribute('href').slice(1));
      if (target) io.observe(target);
    });
  }

  /* ── Save ── */
  function intField(id, min, max, label) {
    const raw = getVal(id).trim();
    const v = Number(raw);
    if (raw === '' || !Number.isInteger(v) || v < min || v > max) {
      throw Object.assign(new Error(t('policies.invalid_number', { field: label, min, max })), { field: id });
    }
    return v;
  }

  function labelOf(id) {
    const l = document.querySelector(`label[for="${id}"]`);
    return l ? l.textContent.trim() : id;
  }

  function bodyFor(section) {
    switch (section) {
      case 'connection':
        return {
          mode: getVal('pol-connection-mode'),
          max_session_duration: intField('pol-max-session', 0, 1440, labelOf('pol-max-session')),
          idle_lock_timeout: intField('pol-idle-lock', 0, 120, labelOf('pol-idle-lock')),
          wallpaper: getVal('pol-wallpaper')
        };
      case 'features':
        return {
          allow_file_transfer: isChecked('pol-file-transfer'),
          allow_clipboard: isChecked('pol-clipboard'),
          allow_audio: isChecked('pol-audio'),
          allow_recording: isChecked('pol-recording')
        };
      case 'security':
        return {
          require_2fa: isChecked('pol-require-2fa'),
          password_min_length: intField('pol-pass-min', 6, 128, labelOf('pol-pass-min')),
          password_require_special: isChecked('pol-pass-special'),
          password_max_age_days: intField('pol-pass-age', 0, 365, labelOf('pol-pass-age')),
          allowed_operators: getVal('pol-allowed-ops').split(',').map(s => s.trim()).filter(Boolean)
        };
      case 'network':
        return {
          block_direct_p2p: isChecked('pol-block-p2p'),
          allowed_relay_servers: getVal('pol-relay-servers').split('\n').map(s => s.trim()).filter(Boolean),
          ip_allowlist: getVal('pol-ip-allowlist').split('\n').map(s => s.trim()).filter(Boolean)
        };
      case 'update':
        return {
          auto_update: isChecked('pol-auto-update'),
          channel: getVal('pol-update-channel')
        };
      default:
        return null;
    }
  }

  async function saveSection(section) {
    const body = bodyFor(section);
    if (!body) return;
    const csrfToken = window.BetterDesk?.csrfToken || '';
    const resp = await fetch(`/api/panel/policies/${encodeURIComponent(currentOrgId)}/${section}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {})
      },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(await errorText(resp));
    dirtySections.delete(section);
  }

  // Saves only the sections that changed, so untouched ones stay "not set"
  async function saveAll() {
    if (!currentOrgId) return;
    const f = form();
    const sections = SECTIONS.filter(s => dirtySections.has(s));
    if (!sections.length) {
      if (window.UiForm) UiForm.saved(f, t('policies.no_changes'));
      return;
    }
    const btn = f.querySelector('[data-save-button]');
    btn.disabled = true;
    try {
      // Validate everything first so nothing is half saved because of a typo
      for (const s of sections) bodyFor(s);
    } catch (e) {
      btn.disabled = false;
      if (window.UiForm) UiForm.failed(f, e.message);
      if (e.field && $(e.field)) $(e.field).focus();
      return;
    }
    // Each group goes to its own endpoint: save every changed one and say
    // which ones did not make it, so nothing is silently half saved
    const failed = [];
    let savedAny = false;
    try {
      for (const s of sections) {
        try {
          await saveSection(s);
          savedAny = true;
        } catch (e) {
          failed.push(`${sectionName(s)} (${e.message || ''})`);
        }
      }
      if (!failed.length) {
        if (window.UiForm) UiForm.saved(f, t('policies.save_success'));
      } else if (window.UiForm) {
        UiForm.failed(f, `${t('ui_form.save_failed')} ${t('policies.save_failed_groups', { groups: failed.join(', ') })}`);
      }
      if (savedAny) {
        // Refresh the section states and the change list
        const resp = await fetch(`/api/panel/policies/${encodeURIComponent(currentOrgId)}`, { credentials: 'same-origin' });
        if (resp.ok) {
          const raw = await resp.json();
          policyData = raw.data || raw || {};
          renderSectionStates();
        }
        loadAuditLog();
      }
    } finally {
      btn.disabled = false;
    }
  }

  /* ── Change log ── */
  function sectionName(cat) {
    const key = { connection: 'connection_title', features: 'features_title', security: 'security_title', network: 'network_title', update: 'update_title' }[cat];
    return key ? t(`policies.${key}`) : (cat || '');
  }

  async function loadAuditLog() {
    if (!currentOrgId) return;
    const container = $('policy-audit-list');
    container.innerHTML = `<p class="state">${esc(t('policies.audit_loading'))}</p>`;
    try {
      const resp = await fetch(`/api/panel/policies/${encodeURIComponent(currentOrgId)}/audit`, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(resp.statusText);
      const raw = await resp.json();
      const entries = raw.data || raw.entries || raw || [];
      if (!Array.isArray(entries) || entries.length === 0) {
        container.innerHTML = `<p class="state">${esc(t('policies.no_audit'))}</p>`;
        return;
      }
      const rows = entries.map(e => {
        const when = new Date(e.timestamp || e.created_at);
        const whenText = isNaN(when) ? '' : (window.Utils && Utils.formatDate ? Utils.formatDate(when) : when.toLocaleString());
        const cat = (e.details && e.details.category) || e.section || e.category || '';
        const who = e.actor || e.user || '';
        const via = e.target || '';
        const detail = e.detail || e.description || '';
        return `<tr>
            <td class="policy-audit-time">${esc(whenText)}</td>
            <td>${esc(sectionName(cat))}${detail ? `<span class="cell-sub">${esc(detail)}</span>` : ''}</td>
            <td>${esc(who)}${via ? `<span class="cell-sub">${esc(via)}</span>` : ''}</td>
          </tr>`;
      }).join('');
      container.innerHTML = `
        <p class="count-line">${esc(t('policies.audit_count', { count: entries.length }))}</p>
        <div class="table-scroll" tabindex="0" role="region" aria-label="${esc(t('policies.audit_title'))}">
          <table class="data-table policy-audit-table">
            <thead><tr>
              <th scope="col">${esc(t('policies.col_time'))}</th>
              <th scope="col">${esc(t('policies.col_policy'))}</th>
              <th scope="col">${esc(t('policies.col_source'))}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    } catch (e) {
      container.innerHTML = `<p class="state is-error">${esc(t('policies.audit_failed'))} <button type="button" class="btn btn-sm" data-audit-retry>${esc(t('actions.retry'))}</button></p>`;
      container.querySelector('[data-audit-retry]').addEventListener('click', loadAuditLog);
    }
  }

  /* ── Helpers ── */
  async function errorText(resp) {
    try {
      const d = await resp.json();
      return d.error || d.message || resp.statusText || String(resp.status);
    } catch (_) {
      return resp.statusText || String(resp.status);
    }
  }
  function getVal(id) { const el = $(id); return el ? el.value : ''; }
  function setVal(id, v) { const el = $(id); if (el) el.value = v; }
  function isChecked(id) { const el = $(id); return el ? el.checked : false; }
  function setChecked(id, v) { const el = $(id); if (el) el.checked = !!v; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── Public API ── */
  window.Policies = {
    saveSection: async (section) => {
      dirtySections.add(section);
      await saveAll();
    }
  };
})();
