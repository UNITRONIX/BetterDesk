/**
 * BetterDesk Console - Network tools
 *
 * Every tool runs on the server: network checks call /api/network/* and
 * /api/toolkit/*, server information comes from /api/system/*, /api/logs/*,
 * /api/database/* and /api/docker/*. Each tool shows its result in its own
 * result area, with a loading line next to the button and a plain error
 * when it fails. Tools the user's role may not run are hidden.
 */

'use strict';

(function () {
    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params) : key);
    const esc = (value) => Utils.escapeHtml(value == null ? '' : String(value));
    const $ = (id) => document.getElementById(id);

    const locale = () => (window.BetterDesk && window.BetterDesk.lang) || undefined;

    function formatNumber(value, digits) {
        try {
            return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value);
        } catch (e) {
            return String(value);
        }
    }

    function formatBytes(bytes) {
        bytes = Number(bytes) || 0;
        if (bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
        return `${formatNumber(bytes, i > 2 ? 1 : 0)} ${units[i]}`;
    }

    function ms(value) {
        return _('toolkit.ms', { value: formatNumber(Math.round(Number(value) || 0), 0) });
    }

    // ---- Result helpers ----

    function facts(rows) {
        return `<dl class="facts tool-facts">${rows.filter(Boolean).map(([label, value]) =>
            `<dt>${esc(label)}</dt><dd>${value}</dd>`).join('')}</dl>`;
    }

    let copyId = 0;
    function codeBlock(title, value) {
        const id = `tool-copy-${++copyId}`;
        return `<div class="code-block-head"><span class="code-block-title">${esc(title)}</span>
                <button type="button" class="btn btn-sm" data-copy="${id}">${esc(_('actions.copy'))}</button></div>
            <pre class="code-block" id="${id}">${esc(value)}</pre>`;
    }

    function statusText(kind, text) {
        return `<span class="status ${kind}">${esc(text)}</span>`;
    }

    /**
     * Run one tool: disable its buttons, say it is running, then show the
     * result or a plain error with the reason.
     */
    async function run(tool, resultId, work) {
        const form = $(`${tool}-form`);
        const status = $(`${tool}-status`);
        const result = $(resultId);
        const buttons = form ? Array.from(form.querySelectorAll('button')) : [];
        buttons.forEach((b) => { b.disabled = true; });
        status.className = 'form-status';
        status.textContent = _('toolkit.running');
        result.setAttribute('aria-busy', 'true');
        try {
            result.innerHTML = await work();
            status.textContent = '';
        } catch (err) {
            status.textContent = '';
            result.innerHTML = `<p class="state is-error">${esc(err && err.message ? err.message : _('toolkit.failed'))}</p>`;
        } finally {
            result.removeAttribute('aria-busy');
            buttons.forEach((b) => { b.disabled = false; });
        }
    }

    /** Ask for a value: show the reason next to the button and focus the field. */
    function need(tool, inputId, messageKey) {
        const status = $(`${tool}-status`);
        status.className = 'form-status is-error';
        status.textContent = _(messageKey);
        $(inputId).focus();
    }

    async function post(url, body) {
        const res = await Utils.api(url, { method: 'POST', body });
        if (res && res.success === false && res.error) throw new Error(res.error);
        return res;
    }

    function onSubmit(tool, handler) {
        const form = $(`${tool}-form`);
        if (!form) return;
        form.addEventListener('submit', (e) => { e.preventDefault(); handler(); });
    }

    // ---- Tabs ----

    const tabs = Array.from(document.querySelectorAll('.toolkit-page [role="tab"]'));

    function selectTab(tab, focus, remember = true) {
        tabs.forEach((t) => {
            const on = t === tab;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
            const panel = $(t.getAttribute('aria-controls'));
            if (panel) panel.hidden = !on;
        });
        if (focus) tab.focus();
        if (remember) {
            try { history.replaceState(null, '', `#${tab.dataset.tab}`); } catch (e) { /* ignore */ }
        }
    }

    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => selectTab(tab, false));
        tab.addEventListener('keydown', (e) => {
            const visible = tabs.filter((t) => !t.hidden);
            const at = visible.indexOf(tab);
            let next = null;
            const rtl = document.documentElement.dir === 'rtl';
            if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = visible[(at + 1) % visible.length];
            else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = visible[(at - 1 + visible.length) % visible.length];
            else if (e.key === 'Home') next = visible[0];
            else if (e.key === 'End') next = visible[visible.length - 1];
            if (next) { e.preventDefault(); selectTab(next, true); }
        });
    });

    // Hide tools this role may not run, then tabs with nothing left
    document.querySelectorAll('.toolkit-page details[data-requires]').forEach((d) => {
        if (!Utils.can(d.dataset.requires)) d.remove();
    });
    tabs.forEach((tab) => {
        const panel = $(tab.getAttribute('aria-controls'));
        if (panel && !panel.querySelector('details')) { tab.hidden = true; panel.hidden = true; }
    });
    const visibleTabs = tabs.filter((t) => !t.hidden);
    if (!visibleTabs.length) {
        $('toolkit-none').hidden = false;
        document.querySelector('.toolkit-page .tabs').hidden = true;
    } else {
        const wanted = visibleTabs.find((t) => `#${t.dataset.tab}` === location.hash);
        const current = visibleTabs.find((t) => t.classList.contains('active'));
        selectTab(wanted || current || visibleTabs[0], false, false);
    }

    // Copy buttons in results
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.toolkit-page [data-copy]');
        if (!btn) return;
        const el = $(btn.dataset.copy);
        if (!el) return;
        const value = el.dataset.value != null ? el.dataset.value : el.textContent;
        try {
            await Utils.copyToClipboard(value);
            btn.textContent = _('toolkit.copied');
            setTimeout(() => { btn.textContent = _('actions.copy'); }, 1500);
        } catch (err) {
            Notifications.error(_('toolkit.copy_failed'));
        }
    });

    // ==== Network ====

    onSubmit('ping', () => {
        const host = $('ping-host').value.trim();
        if (!host) return need('ping', 'ping-host', 'toolkit.need_host');
        run('ping', 'ping-result', async () => {
            const d = await Utils.api('/api/network/ping', { method: 'POST', body: { host } });
            const ok = !!d.success;
            return facts([
                [_('toolkit.host'), `<span class="mono">${esc(d.host || host)}</span>`],
                [_('toolkit.result'), ok ? statusText('ok', _('toolkit.ping_answered')) : statusText('error', _('toolkit.ping_no_answer'))],
                ok && d.rtt_ms != null ? [_('toolkit.response_time'), esc(ms(d.rtt_ms))] : null,
                !ok && d.error ? [_('toolkit.reason'), esc(d.error)] : null,
            ]);
        });
    });

    onSubmit('tcp', () => {
        const host = $('tcp-host').value.trim();
        const port = parseInt($('tcp-port').value, 10);
        if (!host) return need('tcp', 'tcp-host', 'toolkit.need_host');
        if (!(port >= 1 && port <= 65535)) return need('tcp', 'tcp-port', 'toolkit.need_port');
        run('tcp', 'tcp-result', async () => {
            const d = await Utils.api('/api/network/tcp', { method: 'POST', body: { host, port } });
            const open = !!(d.success || d.open || d.connected);
            return facts([
                [_('toolkit.address'), `<span class="mono">${esc(host)}:${esc(port)}</span>`],
                [_('toolkit.result'), open ? statusText('ok', _('toolkit.port_open')) : statusText('error', _('toolkit.port_closed'))],
                open && d.rtt_ms != null ? [_('toolkit.connect_time'), esc(ms(d.rtt_ms))] : null,
                !open && d.error ? [_('toolkit.reason'), esc(d.error)] : null,
            ]);
        });
    });

    onSubmit('ssl', () => {
        const host = $('ssl-host').value.trim();
        const port = parseInt($('ssl-port').value, 10) || 443;
        if (!host) return need('ssl', 'ssl-host', 'toolkit.need_host');
        run('ssl', 'ssl-result', async () => {
            const d = await post('/api/toolkit/ssl', { host, port });
            const days = Number(d.daysLeft);
            const daysKind = days < 0 ? 'error' : days <= 7 ? 'error' : days <= 30 ? 'warning' : 'ok';
            const daysText = days < 0 ? _('toolkit.cert_expired_ago', { count: Math.abs(days) }) : _('toolkit.days_left_count', { count: days });
            let html = facts([
                [_('toolkit.subject'), esc(d.subject || '')],
                [_('toolkit.issuer'), esc(d.issuer || '') + (d.organization && d.organization !== d.issuer ? ` (${esc(d.organization)})` : '')],
                [_('toolkit.valid_from'), esc(Utils.formatDate(d.validFrom))],
                [_('toolkit.valid_to'), esc(Utils.formatDate(d.validTo))],
                [_('toolkit.days_left'), statusText(daysKind, daysText)],
                [_('toolkit.trusted'), d.authorized ? esc(_('common.yes')) : esc(_('toolkit.not_trusted'))],
                d.protocol ? [_('toolkit.protocol'), esc(d.protocol)] : null,
                d.cipher && d.cipher.name ? [_('toolkit.cipher'), `<span class="mono">${esc(d.cipher.name)}</span>`] : null,
                d.altNames && d.altNames.length ? [_('toolkit.alt_names'), `<span class="mono">${d.altNames.map(esc).join('<br>')}</span>`] : null,
                d.serial ? [_('toolkit.serial'), `<span class="mono">${esc(d.serial)}</span>`] : null,
                d.fingerprint ? [_('toolkit.fingerprint'), `<span class="mono">${esc(d.fingerprint)}</span>`] : null,
            ]);
            if (d.chain && d.chain.length > 1) {
                html += `<h3 class="tool-sub">${esc(_('toolkit.chain'))}</h3>
                    <ol class="steps tool-chain">${d.chain.map((c) =>
                        `<li>${esc(c.subject)} <span class="text-muted">${esc(_('toolkit.issued_by', { issuer: c.issuer }))}</span></li>`).join('')}</ol>`;
            }
            return html;
        });
    });

    onSubmit('http', () => {
        let url = $('http-url').value.trim();
        if (!url) return need('http', 'http-url', 'toolkit.need_url');
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        run('http', 'http-result', async () => {
            const d = await Utils.api('/api/network/http', { method: 'POST', body: { url } });
            const code = d.status_code;
            const ok = code >= 200 && code < 400;
            return facts([
                [_('toolkit.url'), `<span class="mono">${esc(url)}</span>`],
                [_('toolkit.result'), code ? statusText(ok ? 'ok' : 'error', _('toolkit.http_answered', { code })) : statusText('error', _('toolkit.http_no_answer'))],
                d.rtt_ms != null ? [_('toolkit.response_time'), esc(ms(d.rtt_ms))] : null,
                d.error ? [_('toolkit.reason'), esc(d.error)] : null,
            ]);
        });
    });

    onSubmit('dns', () => {
        const host = $('dns-domain').value.trim();
        if (!host) return need('dns', 'dns-domain', 'toolkit.need_domain');
        run('dns', 'dns-result', async () => {
            const d = await Utils.api('/api/network/resolve', { method: 'POST', body: { host } });
            let addrs = d.addresses || d.address || d.ip || [];
            if (!Array.isArray(addrs)) addrs = [addrs];
            return facts([
                [_('toolkit.domain'), `<span class="mono">${esc(d.host || host)}</span>`],
                [_('toolkit.resolved'), addrs.length ? `<span class="mono">${addrs.map(esc).join('<br>')}</span>` : esc(_('toolkit.no_address'))],
            ]);
        });
    });

    onSubmit('whois', () => {
        const domain = $('whois-domain').value.trim();
        if (!domain) return need('whois', 'whois-domain', 'toolkit.need_domain');
        run('whois', 'whois-result', async () => {
            const d = await post('/api/toolkit/whois', { domain });
            const dns = d.dns || {};
            const rows = [];
            (dns.A || []).forEach((v) => rows.push(['A', v]));
            (dns.AAAA || []).forEach((v) => rows.push(['AAAA', v]));
            (dns.NS || []).forEach((v) => rows.push(['NS', v]));
            (dns.MX || []).forEach((m) => rows.push(['MX', m.exchange ? _('toolkit.mx_value', { host: m.exchange, priority: m.priority }) : _('toolkit.mx_null')]));
            (dns.TXT || []).forEach((v) => rows.push(['TXT', v]));
            if (!rows.length) return `<p class="state">${esc(_('toolkit.no_records', { domain: d.domain || domain }))}</p>`;
            return `<p class="count-line">${esc(_('toolkit.records_count', { count: rows.length, domain: d.domain || domain }))}</p>
                <div class="table-scroll"><table class="data-table tool-table">
                    <thead><tr><th>${esc(_('toolkit.record_type'))}</th><th>${esc(_('toolkit.record_value'))}</th></tr></thead>
                    <tbody>${rows.map(([type, value]) => `<tr><td>${esc(type)}</td><td class="mono tool-wrap">${esc(value)}</td></tr>`).join('')}</tbody>
                </table></div>`;
        });
    });

    onSubmit('speed', () => {
        run('speed', 'speed-result', async () => {
            const start = performance.now();
            const res = await fetch('/api/speed-test', { credentials: 'same-origin', cache: 'no-store' });
            if (!res.ok) {
                let message = '';
                try { const j = await res.json(); message = j.error || ''; } catch (e) { /* not JSON */ }
                throw new Error(res.status === 403 ? Utils.permissionDeniedMessage() : (message || _('toolkit.failed')));
            }
            const buf = await res.arrayBuffer();
            const seconds = (performance.now() - start) / 1000;
            const size = buf.byteLength;
            const mbit = (size * 8) / seconds / 1e6;
            return facts([
                [_('toolkit.download_speed'), `<strong>${esc(_('toolkit.mbit', { value: formatNumber(mbit, 1) }))}</strong>`],
                [_('toolkit.transferred'), esc(formatBytes(size))],
                [_('toolkit.duration'), esc(ms(seconds * 1000))],
            ]);
        });
    });

    onSubmit('wol', () => {
        const mac = $('wol-mac').value.trim();
        const broadcast = $('wol-broadcast').value.trim() || '255.255.255.255';
        if (!mac) return need('wol', 'wol-mac', 'toolkit.need_mac');
        run('wol', 'wol-result', async () => {
            const d = await post('/api/toolkit/wol', { mac, broadcast });
            return `<p class="notice success">${esc(_('toolkit.wol_sent_to', { mac: d.mac, broadcast: d.broadcast }))}</p>`;
        });
    });

    // ==== Crypto ====

    onSubmit('hash', () => {
        const text = $('hash-input').value;
        if (!text) return need('hash', 'hash-input', 'toolkit.need_text');
        const algorithm = $('hash-algo').value;
        run('hash', 'hash-result', async () => {
            const d = await post('/api/toolkit/hash', { text, algorithm });
            const label = $('hash-algo').selectedOptions[0] ? $('hash-algo').selectedOptions[0].textContent : String(d.algorithm).toUpperCase();
            return codeBlock(label, d.hash);
        });
    });

    onSubmit('password', () => {
        const length = parseInt($('pwd-length').value, 10);
        if (!(length >= 4 && length <= 128)) return need('password', 'pwd-length', 'toolkit.need_length');
        run('password', 'pwd-result', async () => {
            const d = await post('/api/toolkit/password', {
                length,
                uppercase: $('pwd-upper').checked,
                lowercase: $('pwd-lower').checked,
                digits: $('pwd-digits').checked,
                symbols: $('pwd-symbols').checked,
            });
            const strength = d.entropy >= 128 ? _('toolkit.very_strong') : d.entropy >= 60 ? _('toolkit.strong') : _('toolkit.weak');
            const kind = d.entropy >= 60 ? 'ok' : 'error';
            const id = `tool-copy-${++copyId}`;
            return `<span class="value-field tool-password"><code id="${id}">${esc(d.password)}</code>
                    <button type="button" data-copy="${id}">${esc(_('actions.copy'))}</button></span>
                <p class="tool-strength">${statusText(kind, strength)} <span class="text-muted">${esc(_('toolkit.entropy_bits', { bits: d.entropy }))}</span></p>`;
        });
    });

    onSubmit('jwt', () => {
        const token = $('jwt-input').value.trim();
        if (!token) return need('jwt', 'jwt-input', 'toolkit.need_token');
        run('jwt', 'jwt-result', async () => {
            const d = await post('/api/toolkit/jwt-decode', { token });
            let html = '';
            if (d.expiry) {
                const expired = d.expiry.expired;
                html += facts([[_('toolkit.expiry'), statusText(expired ? 'error' : 'ok', expired ? _('toolkit.expired_on', { date: Utils.formatDate(d.expiry.date) }) : _('toolkit.valid_until', { date: Utils.formatDate(d.expiry.date) }))]]);
            }
            html += codeBlock(_('toolkit.jwt_header'), JSON.stringify(d.header, null, 2));
            html += codeBlock(_('toolkit.jwt_payload'), JSON.stringify(d.payload, null, 2));
            return html;
        });
    });

    // ==== Encoding ====

    function encoder(tool, inputId, resultId, url, mode) {
        const text = $(inputId).value;
        if (!text) return need(tool, inputId, 'toolkit.need_text');
        run(tool, resultId, async () => {
            const d = await post(url, { text, mode });
            return codeBlock(mode === 'decode' ? _('toolkit.decoded') : _('toolkit.encoded'), d.result);
        });
    }

    $('b64-encode').addEventListener('click', () => encoder('base64', 'b64-input', 'b64-result', '/api/toolkit/base64', 'encode'));
    $('b64-decode').addEventListener('click', () => encoder('base64', 'b64-input', 'b64-result', '/api/toolkit/base64', 'decode'));
    $('url-encode').addEventListener('click', () => encoder('urlencode', 'url-input', 'url-result', '/api/toolkit/urlencode', 'encode'));
    $('url-decode').addEventListener('click', () => encoder('urlencode', 'url-input', 'url-result', '/api/toolkit/urlencode', 'decode'));
    ['base64-form', 'urlencode-form'].forEach((id) => {
        $(id).addEventListener('submit', (e) => e.preventDefault());
    });

    // ==== Server ====

    onSubmit('processes', () => {
        run('processes', 'proc-result', async () => {
            const res = await Utils.api('/api/system/info');
            const procs = (res && res.processes) || [];
            if (!procs.length) return `<p class="state">${esc(_('toolkit.no_processes'))}</p>`;
            return `<div class="table-scroll"><table class="data-table tool-table">
                <thead><tr><th>${esc(_('toolkit.process_name'))}</th><th class="num">${esc(_('toolkit.cpu_percent'))}</th><th class="num">${esc(_('toolkit.memory_mb'))}</th></tr></thead>
                <tbody>${procs.map((p) => `<tr>
                    <td class="mono tool-wrap">${esc(p.name || p.command || '')}</td>
                    <td class="num">${esc(formatNumber(Number(p.cpu) || 0, 1))}</td>
                    <td class="num">${esc(formatNumber(Number(p.mem) || 0, 0))}</td>
                </tr>`).join('')}</tbody></table></div>`;
        });
    });

    onSubmit('disk', () => {
        run('disk', 'disk-result', async () => {
            const res = await Utils.api('/api/system/info');
            const disks = (res && res.disks) || [];
            if (!disks.length) return `<p class="state">${esc(_('toolkit.no_disks'))}</p>`;
            return `<div class="table-scroll"><table class="data-table tool-table">
                <thead><tr><th>${esc(_('toolkit.mount'))}</th><th>${esc(_('toolkit.used'))}</th></tr></thead>
                <tbody>${disks.map((d) => {
                    const total = Number(d.total) || 0;
                    const used = Number(d.used) || 0;
                    const pct = total ? Math.round((used / total) * 100) : 0;
                    const level = pct >= 95 ? ' is-full' : pct >= 85 ? ' is-high' : '';
                    return `<tr><td class="mono">${esc(d.mount || d.name || '')}</td>
                        <td class="tool-meter"><div class="meter${level}"><span class="meter-bar" aria-hidden="true"><span class="meter-fill" style="width:${pct}%"></span></span>
                        <span class="meter-value">${esc(_('toolkit.used_of', { used: formatBytes(used), total: formatBytes(total), percent: pct }))}</span></div></td></tr>`;
                }).join('')}</tbody></table></div>`;
        });
    });

    onSubmit('db', () => {
        run('db', 'db-result', async () => {
            const d = await Utils.api('/api/database/stats');
            const tables = Array.isArray(d.tables) ? d.tables
                : Object.entries(d.tables || {}).map(([name, count]) => ({ name, count }));
            let html = facts([
                d.type ? [_('toolkit.db_type'), esc(d.type)] : null,
                d.size ? [_('toolkit.db_size'), esc(d.size)] : null,
                [_('toolkit.last_backup'), d.last_backup ? esc(Utils.formatDate(d.last_backup)) : esc(_('toolkit.no_backup'))],
            ]);
            if (tables.length) {
                html += `<div class="table-scroll"><table class="data-table tool-table">
                    <thead><tr><th>${esc(_('toolkit.table_name'))}</th><th class="num">${esc(_('toolkit.row_count'))}</th></tr></thead>
                    <tbody>${tables.map((t) => `<tr><td class="mono">${esc(t.name)}</td><td class="num">${esc(formatNumber(Number(t.count) || 0, 0))}</td></tr>`).join('')}</tbody>
                </table></div>`;
            }
            return html;
        });
    });

    onSubmit('docker', () => {
        run('docker', 'docker-result', async () => {
            const res = await Utils.api('/api/docker/containers');
            const containers = (res && res.containers) || [];
            if (!containers.length) {
                return `<p class="state">${esc(res && res.available === false ? _('toolkit.docker_unavailable') : _('toolkit.no_containers'))}</p>`;
            }
            return `<div class="table-scroll"><table class="data-table tool-table">
                <thead><tr><th>${esc(_('toolkit.container'))}</th><th>${esc(_('toolkit.status'))}</th><th>${esc(_('toolkit.ports'))}</th></tr></thead>
                <tbody>${containers.map((c) => {
                    const running = c.state === 'running' || /^up\b/i.test(c.status || '');
                    return `<tr><td><span class="mono">${esc(c.name || c.names || '')}</span><span class="cell-sub mono">${esc(c.image || '')}</span></td>
                        <td>${statusText(running ? 'ok' : 'offline', c.status || c.state || '')}</td>
                        <td class="mono tool-wrap">${c.ports ? esc(c.ports) : '<span class="text-muted">–</span>'}</td></tr>`;
                }).join('')}</tbody></table></div>`;
        });
    });

    onSubmit('logs', () => {
        const source = $('log-source').value;
        const limit = parseInt($('log-lines').value, 10);
        if (!(limit >= 10 && limit <= 200)) return need('logs', 'log-lines', 'toolkit.need_lines');
        run('logs', 'log-result', async () => {
            const res = await Utils.api(`/api/logs/recent?source=${encodeURIComponent(source)}&limit=${limit}`);
            const lines = (res && res.lines) || [];
            if (!lines.length) return `<p class="state">${esc(_('toolkit.no_log_lines'))}</p>`;
            const title = source === 'go' ? _('toolkit.log_go') : _('toolkit.log_console');
            return codeBlock(_('toolkit.log_title', { source: title, count: lines.length }), lines.join('\n'));
        });
    });
})();
