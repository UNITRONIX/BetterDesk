/**
 * BetterDesk Console — Device identity (/attestation)
 *
 * A table of the hardware fingerprints devices report: device, fingerprint,
 * status and last check, with a count line above. Each row can be marked as
 * verified or revoked (with confirmation); the full fingerprint is copied
 * from the row menu.
 */
(function () {
  'use strict';

  const tbody = document.getElementById('attestation-body');
  const countLine = document.getElementById('att-count-line');
  const COLS = 5;

  function tr(key, params) {
    if (typeof _ !== 'function') return key;
    const v = _(key, params);
    return v || key;
  }
  const t = (key, params) => tr(`attestation.${key}`, params);

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function toast(type, msg) {
    if (typeof Notifications !== 'undefined' && Notifications[type]) Notifications[type](msg);
  }

  // verified / pending / failed, plus the word shown in the table
  function statusOf(raw) {
    const s = String(raw || 'pending').toLowerCase();
    if (s === 'verified' || s === 'trusted') return { group: 'verified', cls: 'ok', label: t('verified') };
    if (s === 'mismatch') return { group: 'failed', cls: 'error', label: t('status_mismatch') };
    if (s === 'revoked') return { group: 'failed', cls: 'error', label: t('status_revoked') };
    if (s === 'failed') return { group: 'failed', cls: 'error', label: t('failed') };
    return { group: 'pending', cls: 'pending', label: t('pending') };
  }

  // Icon for a meaning (Utils.ICONS); decorative, the label carries the meaning
  const icon = (meaning) => (window.Utils && Utils.icon ? Utils.icon(meaning) : '');

  function formatDate(v) {
    if (window.Utils && Utils.formatDate) return Utils.formatDate(v, { empty: '—' });
    const d = new Date(v);
    return isNaN(d) ? '—' : d.toLocaleString();
  }

  function stateRow(html) {
    tbody.innerHTML = `<tr><td colspan="${COLS}" class="state-cell">${html}</td></tr>`;
  }

  async function loadAttestation() {
    showEmpty(false);
    stateRow(escapeHtml(t('loading')));
    countLine.textContent = '';
    countLine.hidden = true;
    try {
      const resp = await fetch('/api/panel/attestation', { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(resp.statusText);
      const raw = await resp.json();
      const records = raw.data || raw.records || raw || [];
      render(Array.isArray(records) ? records : []);
    } catch (e) {
      console.warn('Failed to load attestation:', e);
      stateRow(`<span class="text-danger">${escapeHtml(t('load_error'))}</span>
        <button type="button" class="btn btn-sm" id="att-retry">${escapeHtml(tr('actions.retry'))}</button>`);
      document.getElementById('att-retry').addEventListener('click', loadAttestation);
    }
  }

  // The total in the count line; the parts as a share bar with their numbers in the legend
  function renderCount(records) {
    const bar = document.getElementById('att-share-bar');
    const legend = document.getElementById('att-share-legend');
    countLine.hidden = !records.length;
    bar.hidden = !records.length;
    legend.hidden = !records.length;
    bar.textContent = '';
    legend.textContent = '';
    if (!records.length) { countLine.textContent = ''; return; }
    const n = { verified: 0, pending: 0, failed: 0 };
    records.forEach(r => { n[statusOf(r.status).group]++; });
    countLine.innerHTML = escapeHtml(t(records.length === 1 ? 'count_one' : 'count_many', { count: '{{n}}' }))
      .replace('{{n}}', `<strong>${records.length}</strong>`);
    const fmt = new Intl.NumberFormat((window.BetterDesk && window.BetterDesk.lang) || undefined);
    [
      { k: 'failed', cls: 'is-danger', label: t('legend_failed') },
      { k: 'pending', cls: 'is-warning', label: t('legend_pending') },
      { k: 'verified', cls: 'is-ok', label: t('legend_verified') },
    ].forEach(part => {
      if (n[part.k] > 0) {
        const seg = document.createElement('span');
        seg.className = part.cls;
        seg.style.flexGrow = String(n[part.k]);
        bar.appendChild(seg);
      }
      const li = document.createElement('li');
      li.innerHTML = `<span class="key ${part.cls}" aria-hidden="true"></span><span><strong>${escapeHtml(fmt.format(n[part.k]))}</strong> ${escapeHtml(part.label)}</span>`;
      legend.appendChild(li);
    });
  }

  // No records: the table makes way for a note on why the list is empty.
  // This server version has no place to store fingerprints, so devices
  // cannot report them yet.
  function showEmpty(on) {
    document.getElementById('att-empty').hidden = !on;
    document.getElementById('att-table-wrap').hidden = on;
  }

  function render(records) {
    renderCount(records);
    showEmpty(!records.length);
    if (!records.length) {
      stateRow(escapeHtml(t('empty')));
      return;
    }
    // Problems first, then devices still waiting, then verified ones
    const order = { failed: 0, pending: 1, verified: 2 };
    const sorted = records.slice().sort((a, b) =>
      order[statusOf(a.status).group] - order[statusOf(b.status).group]);

    tbody.innerHTML = sorted.map((r, i) => {
      const st = statusOf(r.status);
      const id = r.device_id || '';
      const fp = r.fingerprint || r.device_fingerprint || '';
      const short = fp.length > 16 ? fp.slice(0, 8) + '…' + fp.slice(-8) : fp;
      const menuId = `att-menu-${i}`;
      const last = r.last_check ? formatDate(r.last_check) : '—';
      const canVerify = st.group !== 'verified';
      const canRevoke = String(r.status || '').toLowerCase() !== 'revoked';
      return `
        <tr data-device="${escapeHtml(id)}">
          <td><span class="mono">${escapeHtml(id || '—')}</span>${r.hostname ? `<span class="cell-sub">${escapeHtml(r.hostname)}</span>` : ''}</td>
          <td>${fp ? `<span class="mono" title="${escapeHtml(fp)}">${escapeHtml(short)}</span>` : '—'}</td>
          <td><span class="status ${st.cls}">${escapeHtml(st.label)}</span></td>
          <td>${escapeHtml(last)}</td>
          <td class="actions">
            ${canVerify && id ? `<button type="button" class="btn btn-sm" data-att-action="verify" data-id="${escapeHtml(id)}">${icon('approve')}${escapeHtml(t('mark_verified'))}</button>` : ''}
            <span class="menu-anchor">
              <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                aria-controls="${menuId}" aria-label="${escapeHtml(t('actions_for', { device: id || r.hostname || '' }))}">
                <span class="material-icons" aria-hidden="true">more_vert</span></button>
              <span class="menu menu-end${i >= sorted.length - 2 && sorted.length > 3 ? ' menu-up' : ''}" id="${menuId}" role="menu">
                <button type="button" class="menu-item" role="menuitem" data-att-action="copy" data-fp="${escapeHtml(fp)}"${fp ? '' : ' disabled'}>${icon('copy')}${escapeHtml(t('copy_fingerprint'))}</button>
                ${canRevoke && id ? `<span class="menu-divider"></span>
                <button type="button" class="menu-item danger" role="menuitem" data-att-action="revoke" data-id="${escapeHtml(id)}">${icon('revoke')}${escapeHtml(t('revoke'))}</button>` : ''}
              </span>
            </span>
          </td>
        </tr>`;
    }).join('');
  }

  async function setStatus(deviceId, status) {
    const csrfToken = window.BetterDesk?.csrfToken || '';
    const resp = await fetch(`/api/panel/attestation/${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {})
      },
      credentials: 'same-origin',
      body: JSON.stringify({ status })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || resp.statusText || String(resp.status));
    }
  }

  async function verify(deviceId) {
    const ok = await Modal.confirm({
      title: t('confirm_verify_title', { device: deviceId }),
      message: t('confirm_verify_message'),
      confirmLabel: t('mark_verified')
    });
    if (!ok) return;
    try {
      await setStatus(deviceId, 'verified');
      toast('success', t('verify_success'));
      loadAttestation();
    } catch (e) {
      toast('error', `${t('verify_failed')} ${e.message}`);
    }
  }

  async function revoke(deviceId) {
    const ok = await Modal.confirm({
      title: t('confirm_revoke_title', { device: deviceId }),
      message: t('confirm_revoke_message'),
      confirmLabel: t('revoke_confirm'),
      danger: true
    });
    if (!ok) return;
    try {
      await setStatus(deviceId, 'revoked');
      toast('success', t('revoke_success'));
      loadAttestation();
    } catch (e) {
      toast('error', `${t('revoke_failed')} ${e.message}`);
    }
  }

  async function copyFingerprint(fp) {
    try {
      await navigator.clipboard.writeText(fp);
      toast('success', tr('common.copied'));
    } catch (e) {
      toast('error', t('copy_failed'));
    }
  }

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-att-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.attAction;
    if (action === 'verify') verify(btn.dataset.id);
    else if (action === 'revoke') revoke(btn.dataset.id);
    else if (action === 'copy') copyFingerprint(btn.dataset.fp);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAttestation);
  } else {
    loadAttestation();
  }

  window.Attestation = { verify, revoke, reload: loadAttestation };
})();
