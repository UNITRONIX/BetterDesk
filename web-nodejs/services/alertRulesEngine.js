/**
 * BetterDesk Console — Alert Rules Engine
 *
 * Evaluates alert rules against incoming telemetry / activity data
 * and triggers notifications when conditions are met.
 *
 * Delivery channels on fire:
 *   - alert_history (Automation → Alert History)
 *   - panel event stream → navbar bell + toast
 *   - email (rule.notify_emails, else Settings → Email alert_email)
 *
 * Supported condition types:
 *   - cpu_usage / memory_usage / disk_usage
 *   - offline_duration / idle_duration / custom
 *
 * @author UNITRONIX
 * @version 1.1.0
 */

'use strict';

const { getAdapter } = require('./dbAdapter');
const emailService = require('./emailService');
const { ruleMatchesDevice } = require('../lib/alertRuleScope');
const { publishPanelEvent } = require('./deviceStatusPush');
const { alertToNotification } = require('./alertNotifications');

const DEFAULT_COOLDOWN_SECS = 300;
let periodicTimer = null;

const OPS = {
    gt:  (a, b) => a > b,
    gte: (a, b) => a >= b,
    lt:  (a, b) => a < b,
    lte: (a, b) => a <= b,
    eq:  (a, b) => a === b,
    neq: (a, b) => a !== b,
};

function evalCondition(value, op, threshold) {
    const fn = OPS[op];
    if (!fn) return false;
    return fn(Number(value), Number(threshold));
}

async function resolveAlertRecipients(rule) {
    const fromRule = String(rule?.notify_emails || '')
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (fromRule.length) return fromRule.join(', ');
    try {
        return (await emailService.getAlertEmail()) || '';
    } catch (_) {
        return '';
    }
}

/**
 * Persist alert, push to panel bell, and email operators.
 */
async function fireAlert(rule, deviceId, metricType, metricValue) {
    const adapter = getAdapter();
    const alert = {
        rule_id: rule.id,
        device_id: deviceId,
        severity: rule.severity || 'warning',
        message: `${rule.name}: ${metricType} = ${metricValue} (${rule.condition_op} ${rule.condition_value})`,
        triggered_at: new Date().toISOString(),
        acknowledged: false,
        rule_name: rule.name,
    };

    const created = await adapter.createAlert(alert);
    const stored = {
        ...alert,
        ...(created && typeof created === 'object' ? created : {}),
        id: created?.id ?? created,
        rule_name: created?.rule_name || alert.rule_name,
    };
    console.log(`[AlertEngine] ALERT fired: ${alert.message} for ${deviceId}`);

    const notif = alertToNotification(stored);
    if (notif) {
        try {
            publishPanelEvent({
                type: 'automation_alert',
                ...notif,
                timestamp: Date.now(),
            });
        } catch (err) {
            console.error('[AlertEngine] Panel event failed:', err.message);
        }
    }

    try {
        const recipients = await resolveAlertRecipients(rule);
        if (recipients) {
            const ruleForMail = { ...rule, notify_emails: recipients };
            emailService.sendAlertEmail(stored, ruleForMail).catch((err) => {
                console.error('[AlertEngine] Email failed:', err.message);
            });
        }
    } catch (err) {
        console.error('[AlertEngine] Email resolve failed:', err.message);
    }

    return stored;
}

/**
 * Evaluate all enabled alert rules against a specific metric push.
 *
 * @param {string} deviceId
 * @param {string} metricType
 * @param {number} metricValue
 */
async function evaluateRules(deviceId, metricType, metricValue) {
    const adapter = getAdapter();
    let rules;
    try {
        rules = await adapter.getAlertRules({ enabled: true, condition_type: metricType });
    } catch (err) {
        console.error('[AlertEngine] Failed to load rules:', err.message);
        return;
    }

    for (const rule of rules) {
        if (!ruleMatchesDevice(rule, deviceId)) continue;

        const triggered = evalCondition(metricValue, rule.condition_op, rule.condition_value);
        if (!triggered) continue;

        const cooldown = rule.cooldown_secs || DEFAULT_COOLDOWN_SECS;
        try {
            const recent = await adapter.getRecentAlert(rule.id, deviceId, cooldown);
            if (recent) continue;
        } catch (_) { /* fire anyway */ }

        try {
            await fireAlert(rule, deviceId, metricType, metricValue);
        } catch (err) {
            console.error('[AlertEngine] Failed to create alert:', err.message);
        }
    }
}

/**
 * Evaluate telemetry data against all applicable rules.
 */
async function evaluateTelemetry(deviceId, telemetry) {
    if (!deviceId || !telemetry || typeof telemetry !== 'object') return;

    if (telemetry.cpu_usage_percent !== undefined && telemetry.cpu_usage_percent !== null) {
        await evaluateRules(deviceId, 'cpu_usage', telemetry.cpu_usage_percent);
    }
    if (telemetry.memory_used_bytes && telemetry.memory_total_bytes) {
        const ratio = (telemetry.memory_used_bytes / telemetry.memory_total_bytes) * 100;
        await evaluateRules(deviceId, 'memory_usage', Math.round(ratio));
    }
    if (telemetry.disk_usage_percent !== undefined && telemetry.disk_usage_percent !== null) {
        await evaluateRules(deviceId, 'disk_usage', telemetry.disk_usage_percent);
    } else if (telemetry.disk_used_bytes && telemetry.disk_total_bytes) {
        const ratio = (telemetry.disk_used_bytes / telemetry.disk_total_bytes) * 100;
        await evaluateRules(deviceId, 'disk_usage', Math.round(ratio));
    }
}

/**
 * Evaluate idle activity report.
 */
async function evaluateActivity(deviceId, activity) {
    if (!deviceId || !activity || typeof activity !== 'object') return;
    if (activity.idle_seconds !== undefined && activity.idle_seconds !== null) {
        await evaluateRules(deviceId, 'idle_duration', activity.idle_seconds);
    }
}

/**
 * Periodic sweep for offline_duration (+ custom heartbeat-style checks).
 */
async function periodicCheck() {
    const adapter = getAdapter();
    let offlineRules = [];
    try {
        offlineRules = await adapter.getAlertRules({ enabled: true, condition_type: 'offline_duration' });
    } catch (err) {
        console.error('[AlertEngine] periodic load failed:', err.message);
        return;
    }
    if (!offlineRules.length) return;

    let peers = [];
    try {
        peers = await adapter.getAllPeers({});
    } catch (err) {
        console.error('[AlertEngine] peer list failed:', err.message);
        return;
    }

    const now = Date.now();
    for (const peer of peers) {
        if (!peer || peer.is_deleted) continue;
        const id = String(peer.id || '').trim();
        if (!id) continue;

        const online = peer.status_online === 1 || peer.status_online === true || peer.online === true;
        if (online) continue;

        let offlineSecs = 0;
        const last = peer.last_online ? Date.parse(peer.last_online) : NaN;
        if (Number.isFinite(last)) {
            offlineSecs = Math.max(0, Math.floor((now - last) / 1000));
        } else {
            // Unknown last-seen: treat as long offline so threshold rules can fire once.
            offlineSecs = 24 * 60 * 60;
        }
        await evaluateRules(id, 'offline_duration', offlineSecs);
    }
}

/**
 * Start background evaluation loop (safe to call once from server boot).
 * @param {number} [intervalMs=60000]
 */
function startAlertEngine(intervalMs = 60000) {
    if (periodicTimer) return;
    const ms = Math.max(15000, Number(intervalMs) || 60000);
    // Delay first sweep so peer sync can settle.
    setTimeout(() => {
        periodicCheck().catch(() => {});
    }, 15000);
    periodicTimer = setInterval(() => {
        periodicCheck().catch(() => {});
    }, ms);
    if (typeof periodicTimer.unref === 'function') periodicTimer.unref();
    console.log(`[AlertEngine] Periodic check every ${Math.round(ms / 1000)}s`);
}

function stopAlertEngine() {
    if (periodicTimer) {
        clearInterval(periodicTimer);
        periodicTimer = null;
    }
}

module.exports = {
    evaluateRules,
    evaluateTelemetry,
    evaluateActivity,
    periodicCheck,
    evalCondition,
    fireAlert,
    startAlertEngine,
    stopAlertEngine,
    resolveAlertRecipients,
};
