/* server-attestation.js: Capacity test page (load test, result, sign-in badge) */
'use strict';
(function () {
    const _ = (key, vars) => (typeof window._ === 'function' ? window._(key, vars || {}) : key);

    function tr(key, fallback, vars) {
        const v = _(key, vars);
        return (v && v !== key) ? v : fallback;
    }

    const TIERS = ['bronze', 'iron', 'platinum', 'titanium', 'obsidian'];
    let pollTimer = null;
    let lastResult = null;
    let badgeConfig = {
        badgeTitle: '',
        tierLabels: {}
    };
    let badgePresentation = {
        brand: 'BetterDesk',
        badgeTitle: '',
        tierLabels: {}
    };

    function csrfHeaders(extra) {
        const h = Object.assign({}, extra || {});
        const token = (window.BetterDesk && window.BetterDesk.csrfToken) || '';
        if (token) h['x-csrf-token'] = token;
        return h;
    }

    function notify(level, message) {
        if (!message) return;
        if (window.Notifications && typeof window.Notifications[level] === 'function') {
            window.Notifications[level](message);
        }
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function tierLabel(tier) {
        if (!tier) return tr('server_attestation.tier_none', 'Not tested');
        if (badgePresentation.tierLabels && badgePresentation.tierLabels[tier]) {
            return badgePresentation.tierLabels[tier];
        }
        return tr('server_attestation.tier_' + tier, tier);
    }

    function badgeTitle() {
        return badgePresentation.badgeTitle || tr('server_attestation.badge_tooltip', 'BetterDesk Server Attestation');
    }

    // The preview shows what the sign-in page shows: brand, tier, connections
    function updateBadge(tier, maxConnections) {
        const hero = document.querySelector('.sa-hero .bd-attest-badge');
        if (!hero) return;
        hero.title = badgeTitle();
        setText('sa-badge-hover', tr('server_attestation.badge_hover', hero.title, { title: hero.title }));
        const brandEl = hero.querySelector('.bd-attest-brand');
        if (brandEl) brandEl.textContent = badgePresentation.brand || 'BetterDesk';
        const tierEl = hero.querySelector('.bd-attest-tier');
        if (tierEl) tierEl.textContent = tierLabel(tier);
        let connEl = hero.querySelector('.bd-attest-conn');
        if (maxConnections) {
            if (!connEl) {
                connEl = document.createElement('span');
                connEl.className = 'bd-attest-conn';
                hero.appendChild(connEl);
            }
            connEl.textContent = maxConnections + ' ' + tr('server_attestation.connections_short', 'conn.');
        } else if (connEl) {
            connEl.remove();
        }
    }

    function applyBadgePresentation(presentation) {
        if (!presentation) return;
        badgePresentation = Object.assign({}, badgePresentation, presentation, {
            tierLabels: Object.assign({}, badgePresentation.tierLabels, presentation.tierLabels || {})
        });
        updateBadge(lastResult ? lastResult.tier : null, lastResult ? lastResult.maxConnections : null);
        if (lastResult) setText('sa-tier-value', tierLabel(lastResult.tier));

        document.querySelectorAll('.sa-tier-guide .bd-attest-tier').forEach((element) => {
            const label = badgePresentation.tierLabels[element.dataset.tier];
            if (label) element.textContent = label;
        });
    }

    function populateBadgeConfig(config) {
        badgeConfig = {
            badgeTitle: config && config.badgeTitle ? config.badgeTitle : '',
            tierLabels: Object.assign({}, config && config.tierLabels)
        };
        const title = document.getElementById('sa-badge-title');
        if (title) title.value = badgeConfig.badgeTitle;
        TIERS.forEach((tier) => {
            const input = document.getElementById('sa-tier-' + tier);
            if (input) input.value = badgeConfig.tierLabels[tier] || '';
        });
    }

    async function loadBadgeConfig() {
        try {
            const res = await fetch('/api/server-attestation/badge-config', { credentials: 'same-origin' });
            const data = await res.json();
            if (!data.success) return;
            populateBadgeConfig(data.config || {});
            applyBadgePresentation(data.presentation);
            const form = document.getElementById('sa-badge-form');
            if (window.UiForm && form) window.UiForm.reset(form);
        } catch (err) {
            console.error('[ServerAttestation] badge config load error', err);
        }
    }

    async function saveBadgeConfig() {
        const payload = {
            badgeTitle: document.getElementById('sa-badge-title')?.value || '',
            tierLabels: {}
        };
        TIERS.forEach((tier) => {
            payload.tierLabels[tier] = document.getElementById('sa-tier-' + tier)?.value || '';
        });
        const form = document.getElementById('sa-badge-form');
        const status = document.getElementById('sa-badge-settings-status');
        const button = document.getElementById('sa-save-badge-btn');
        if (button) button.disabled = true;
        if (status) status.textContent = tr('server_attestation.badge_settings_saving', 'Saving…');
        try {
            const res = await fetch('/api/server-attestation/badge-config', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: csrfHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || ('HTTP ' + res.status));
            populateBadgeConfig(data.config || payload);
            applyBadgePresentation(data.presentation);
            const msg = tr('server_attestation.badge_settings_saved', 'Badge settings saved');
            if (window.UiForm && form) window.UiForm.saved(form, msg);
            else if (status) status.textContent = msg;
        } catch (err) {
            const msg = tr('server_attestation.badge_save_failed', err.message, { error: err.message });
            if (window.UiForm && form) window.UiForm.failed(form, msg);
            else if (status) status.textContent = msg;
        } finally {
            if (button) button.disabled = false;
        }
    }

    function applyResult(result) {
        if (!result) return;
        lastResult = result;

        updateBadge(result.tier, result.maxConnections);
        setText('sa-max-conn', result.maxConnections != null ? String(result.maxConnections) : '–');
        setText('sa-tier-value', tierLabel(result.tier));

        if (result.signalConnections != null || result.relaySessions != null) {
            setText('sa-conn-detail', tr('server_attestation.conn_detail', '', {
                signal: result.signalConnections || 0,
                relay: result.relaySessions || 0
            }));
        }

        if (result.finalMetrics) {
            setText('sa-th-cpu', result.finalMetrics.cpu + ' %');
            setText('sa-th-mem', result.finalMetrics.mem + ' %');
            setText('sa-th-disk', result.finalMetrics.disk + ' %');
        }

        if (result.testedAt) {
            setText('sa-hero-meta', tr('server_attestation.result_sentence', '', {
                date: new Date(result.testedAt).toLocaleString(),
                count: result.maxConnections || 0,
                tier: tierLabel(result.tier)
            }));
        }
        const est = document.getElementById('sa-estimated-note');
        if (est) est.hidden = result.mode !== 'estimated';
        const facts = document.getElementById('sa-result-facts');
        if (facts) facts.hidden = false;
        const dlBtn = document.getElementById('sa-download-btn');
        if (dlBtn) dlBtn.hidden = false;
    }

    function setRunning(running) {
        const runBtn = document.getElementById('sa-run-btn');
        const abortBtn = document.getElementById('sa-abort-btn');
        const progress = document.getElementById('sa-progress');
        if (runBtn) runBtn.disabled = running;
        if (abortBtn) {
            abortBtn.classList.toggle('hidden', !running);
            if (!running) abortBtn.disabled = false;
        }
        if (progress) progress.classList.toggle('hidden', !running);
    }

    function updateProgress(progress) {
        if (!progress) return;
        const fill = document.getElementById('sa-progress-fill');
        let pct = 10;
        if (progress.phase === 'baseline') pct = 15;
        else if (progress.phase === 'ramp-up') {
            pct = 20 + Math.min(60, (progress.connections || 0) / 5);
        } else if (progress.phase === 'stabilize') pct = 85;
        else if (progress.phase === 'done') pct = 100;
        if (fill) fill.style.width = pct + '%';
        setText('sa-progress-pct', Math.round(pct) + ' %');
        const phaseText = {
            starting: tr('server_attestation.starting', 'Starting…'),
            baseline: tr('server_attestation.phase_baseline', ''),
            probe: tr('server_attestation.phase_probe', ''),
            'ramp-up': tr('server_attestation.phase_ramp', '', { count: progress.connections || 0 }),
            stabilize: tr('server_attestation.phase_stabilize', ''),
            done: tr('server_attestation.complete', '')
        }[progress.phase];
        setText('sa-progress-text', phaseText || progress.message || progress.phase || '');
    }

    async function pollStatus() {
        try {
            const res = await fetch('/api/server-attestation/status', { credentials: 'same-origin' });
            const data = await res.json();
            if (!data.success) return;

            setRunning(data.running);
            if (data.progress) updateProgress(data.progress);

            if (!data.running) {
                clearInterval(pollTimer);
                pollTimer = null;
                const result = data.lastResult || (data.progress && data.progress.result);
                if (result) {
                    applyResult(result);
                    if (result.aborted) {
                        notify('info', tr('server_attestation.stopped', 'Test stopped'));
                    } else if (result.valid) {
                        notify('success', tr('server_attestation.complete', 'Benchmark complete'));
                    } else {
                        notify('warning', tr('server_attestation.incomplete', 'Benchmark finished without a valid tier'));
                    }
                }
            }
        } catch (err) {
            console.error('[ServerAttestation] poll error', err);
        }
    }

    async function runBenchmark() {
        const confirmed = await Modal.confirm({
            title: tr('server_attestation.confirm_title', 'Run the capacity test?'),
            message: tr('server_attestation.confirm_run', 'This will load-test the server. Continue?'),
            confirmLabel: tr('server_attestation.run_benchmark', 'Run test')
        });
        if (!confirmed) return;

        setRunning(true);
        updateProgress({ phase: 'starting', connections: 0 });

        try {
            const res = await fetch('/api/server-attestation/run', {
                method: 'POST',
                credentials: 'same-origin',
                headers: csrfHeaders({ 'Content-Type': 'application/json' })
            });
            const data = await res.json();
            if (!data.success) {
                notify('error', tr('server_attestation.start_failed', data.error || 'Failed to start', { error: data.error || '' }));
                setRunning(false);
                return;
            }
            pollTimer = setInterval(pollStatus, 2000);
            pollStatus();
        } catch (err) {
            notify('error', tr('server_attestation.start_failed', err.message, { error: err.message }));
            setRunning(false);
        }
    }

    async function abortBenchmark() {
        const abortBtn = document.getElementById('sa-abort-btn');
        if (abortBtn) abortBtn.disabled = true;
        setText('sa-progress-text', tr('server_attestation.stopping', 'Stopping…'));
        try {
            await fetch('/api/server-attestation/abort', {
                method: 'POST',
                credentials: 'same-origin',
                headers: csrfHeaders({ 'Content-Type': 'application/json' })
            });
        } catch (_) { /* ignore */ }
    }

    function downloadReport() {
        if (!lastResult) return;
        const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'betterdesk-server-attestation-' + (lastResult.testedAt || Date.now()) + '.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    async function init() {
        document.getElementById('sa-run-btn')?.addEventListener('click', runBenchmark);
        document.getElementById('sa-abort-btn')?.addEventListener('click', abortBenchmark);
        document.getElementById('sa-download-btn')?.addEventListener('click', downloadReport);
        document.getElementById('sa-badge-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            saveBadgeConfig();
        });

        try {
            const res = await fetch('/api/server-attestation/status', { credentials: 'same-origin' });
            const data = await res.json();
            if (data.lastResult) applyResult(data.lastResult);
            if (data.running) {
                setRunning(true);
                if (data.progress) updateProgress(data.progress);
                pollTimer = setInterval(pollStatus, 2000);
            }
        } catch (_) { /* ignore */ }
        loadBadgeConfig();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
