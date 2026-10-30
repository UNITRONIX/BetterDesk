'use strict';

/**
 * Billing work report — right pane of the RD disconnect overlay.
 * Closing without submit leaves session as pending_report (same record in Sessions).
 */
(function (global) {
    function t(key, fallback) {
        if (typeof global.t === 'function') {
            const val = global.t(key);
            if (val && val !== key) return val;
        }
        return fallback !== undefined ? fallback : key;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function fetchPendingSession(deviceId) {
        const url = `/api/panel/billing/sessions/pending?device_id=${encodeURIComponent(deviceId)}`;
        const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.session || null;
    }

    async function fetchBillingCheck(deviceId) {
        try {
            const url = `/api/panel/billing/check?device_id=${encodeURIComponent(deviceId)}`;
            const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!resp.ok) return null;
            return await resp.json();
        } catch (_) {
            return null;
        }
    }

    async function submitReport(sessionId, payload) {
        await Utils.api(`/api/panel/billing/sessions/${encodeURIComponent(sessionId)}/report`, {
            method: 'POST',
            body: payload
        });
    }

    function findSessionPanel(deviceId) {
        const panels = document.querySelectorAll('.session-panel');
        for (const panel of panels) {
            if (panel.dataset.deviceId === deviceId || panel.querySelector('.session-device-label')?.textContent === deviceId) {
                return panel;
            }
        }
        return document.querySelector('.session-panel.active') || document.querySelector('.session-panel');
    }

    function setPaneVisible(pane, divider, card, visible) {
        if (!pane) return;
        pane.hidden = !visible;
        pane.classList.toggle('hidden', !visible);
        if (divider) {
            divider.hidden = !visible;
            divider.classList.toggle('hidden', !visible);
            divider.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
        if (card) {
            card.classList.toggle('overlay-card--billing', visible);
        }
    }

    function hideBillingPane(panel) {
        if (!panel) return;
        const card = panel.querySelector('.overlay-card');
        const pane = panel.querySelector('.session-billing-pane');
        const divider = panel.querySelector('.session-billing-divider');
        setPaneVisible(pane, divider, card, false);
    }

    function applyLocalizedLabels(pane) {
        const titleEl = pane.querySelector('.billing-pane-title');
        if (titleEl) titleEl.textContent = t('commercialization.report.title', 'Work report');

        const labelEl = pane.querySelector('.billing-pane-label');
        if (labelEl) {
            const textarea = labelEl.querySelector('textarea');
            const labelText = t('commercialization.report.summary', 'Work performed');
            // Keep textarea as child; replace only the text node before it.
            let textNode = null;
            for (const node of labelEl.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    textNode = node;
                    break;
                }
            }
            if (textNode) {
                textNode.textContent = labelText;
            } else if (textarea) {
                labelEl.insertBefore(document.createTextNode(labelText), textarea);
            } else {
                labelEl.textContent = labelText;
            }
        }

        const skipBtn = pane.querySelector('.session-billing-skip');
        if (skipBtn) skipBtn.textContent = t('commercialization.report.skip', 'Skip for now');

        const submitBtn = pane.querySelector('.session-billing-submit');
        if (submitBtn) {
            submitBtn.dataset.labelDefault = t('commercialization.report.submit', 'Submit report');
            if (!submitBtn.disabled) submitBtn.textContent = submitBtn.dataset.labelDefault;
        }
    }

    function showInOverlay(session, deviceName, panel) {
        return new Promise((resolve) => {
            const card = panel?.querySelector('.overlay-card');
            const pane = panel?.querySelector('.session-billing-pane');
            const divider = panel?.querySelector('.session-billing-divider');
            if (!card || !pane) {
                resolve(false);
                return;
            }

            setPaneVisible(pane, divider, card, true);
            applyLocalizedLabels(pane);

            const mins = session.billed_minutes || 0;
            const hours = (mins / 60).toFixed(2);
            const amount = (session.amount_included || 0) + (session.amount_overage || 0);
            const pkgEl = pane.querySelector('.session-billing-package');
            const hoursEl = pane.querySelector('.session-billing-hours');
            const summaryEl = pane.querySelector('.session-billing-summary');
            const errEl = pane.querySelector('.session-billing-error');
            const skipBtn = pane.querySelector('.session-billing-skip');
            const submitBtn = pane.querySelector('.session-billing-submit');

            if (pkgEl) {
                pkgEl.textContent = session.package_name
                    ? `${t('commercialization.contracts.package', 'Package')}: ${session.package_name}`
                    : (deviceName || session.device_id || '');
            }
            if (hoursEl) {
                hoursEl.textContent = `${hours} h (${mins} min) · ${amount.toFixed(2)} ${session.currency || ''}`.trim();
            }
            if (summaryEl) summaryEl.value = session._draftSummary || '';
            if (errEl) {
                errEl.hidden = true;
                errEl.classList.add('hidden');
            }

            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = submitBtn.dataset.labelDefault
                        || t('commercialization.report.submit', 'Submit report');
                }
                if (skipBtn) skipBtn.disabled = false;
                setPaneVisible(pane, divider, card, false);
                resolve(result);
            };

            if (skipBtn) {
                skipBtn.disabled = false;
                skipBtn.onclick = () => finish(false);
            }

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.onclick = async () => {
                    const summary = (summaryEl?.value || '').trim();
                    if (!summary) {
                        if (errEl) {
                            errEl.textContent = t('commercialization.report.summary_required', 'Summary is required');
                            errEl.hidden = false;
                            errEl.classList.remove('hidden');
                        }
                        return;
                    }
                    submitBtn.disabled = true;
                    if (skipBtn) skipBtn.disabled = true;
                    submitBtn.textContent = t('common.loading', '…');
                    if (errEl) {
                        errEl.hidden = true;
                        errEl.classList.add('hidden');
                    }
                    try {
                        await submitReport(session.id, { summary, category: '', ticket_ref: '' });
                        finish(true);
                    } catch (e) {
                        submitBtn.disabled = false;
                        if (skipBtn) skipBtn.disabled = false;
                        submitBtn.textContent = submitBtn.dataset.labelDefault
                            || t('commercialization.report.submit', 'Submit report');
                        if (errEl) {
                            errEl.textContent = e.message || 'Error';
                            errEl.hidden = false;
                            errEl.classList.remove('hidden');
                        }
                    }
                };
            }

            summaryEl?.focus();
        });
    }

    async function promptAfterSession(deviceId, deviceName) {
        if (!deviceId) return false;
        await sleep(1200);
        let session = null;
        for (let i = 0; i < 5; i++) {
            session = await fetchPendingSession(deviceId);
            if (session) break;
            await sleep(800);
        }
        if (!session) return false;
        const panel = findSessionPanel(deviceId);
        return showInOverlay(session, deviceName, panel);
    }

    async function markReportIntent(deviceId) {
        try {
            sessionStorage.setItem(`bd-billing-report-intent:${deviceId}`, '1');
        } catch (_) { /* ignore */ }
    }

    async function refreshToolbarPackage(deviceId) {
        const badge = document.getElementById('toolbar-package-badge');
        const btn = document.getElementById('btn-billing-report');
        if (!deviceId) {
            if (badge) badge.hidden = true;
            if (btn) btn.style.display = 'none';
            return null;
        }
        const check = await fetchBillingCheck(deviceId);
        const has = check && (check.allowed !== false) && (check.contract_id || check.package_name || check.remaining_minutes != null);
        if (badge) {
            if (has && (check.package_name || check.remaining_minutes != null)) {
                const rem = check.remaining_minutes != null ? `${check.remaining_minutes} min` : '';
                badge.textContent = check.package_name ? `${check.package_name}${rem ? ' · ' + rem : ''}` : rem;
                badge.hidden = false;
                badge.title = [
                    check.org_name || check.company || '',
                    check.device_name || deviceId,
                    check.package_name || '',
                    rem
                ].filter(Boolean).join('\n');
            } else {
                badge.hidden = true;
            }
        }
        if (btn) {
            btn.style.display = has ? '' : 'none';
            btn.title = t('commercialization.report.toolbar', 'Work report');
        }
        return check;
    }

    global.BillingReport = {
        promptAfterSession,
        markReportIntent,
        refreshToolbarPackage,
        fetchBillingCheck,
        hideBillingPane
    };
})(window);
