/**
 * BetterDesk Console — Alert Rules Engine
 *
 * Evaluates alert rules against incoming telemetry / activity data
 * and triggers notifications when conditions are met. The device uploads
 * call it (telemetry, inventory, activity); start() runs the offline sweep.
 *
 * Supported condition types:
 *   - cpu_usage        (threshold on cpu_usage_percent, POST /api/bd/telemetry)
 *   - memory_usage     (threshold on memory_used_bytes / memory_total_bytes ratio, telemetry)
 *   - disk_usage       (threshold on the fullest disk's usage percent, POST /api/bd/inventory)
 *   - offline_duration (device offline > N seconds, the sweep every minute)
 *   - idle_duration    (user idle > N seconds, POST /api/bd/activity)
 *   - custom           (not checked: it has no value to compare)
 *
 * Condition operators: gt, gte, lt, lte, eq, neq
 *
 * @author UNITRONIX
 * @version 1.0.0
 */

'use strict';

const { getAdapter } = require('./dbAdapter');
const emailService = require('./emailService');

// Cooldown: minimum seconds between repeated alerts for the same rule + device
const DEFAULT_COOLDOWN_SECS = 300; // 5 minutes

// ---------------------------------------------------------------------------
//  Operator helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
//  Evaluation
// ---------------------------------------------------------------------------

async function loadRules(metricType) {
    try {
        return await getAdapter().getAlertRules({ enabled: true, condition_type: metricType });
    } catch (err) {
        console.error('[AlertEngine] Failed to load rules:', err.message);
        return [];
    }
}

/**
 * Check one value against rules already loaded (all of one condition type).
 * `minCooldownSecs` stretches the cooldown: an offline device stays over its
 * limit for as long as it is offline, so its alert counts for that whole
 * time instead of firing again every few minutes.
 */
async function evaluateAgainst(rules, deviceId, metricType, metricValue, { minCooldownSecs = 0 } = {}) {
    const adapter = getAdapter();
    for (const rule of rules) {
        // Scope check: rule.scope_device_id can be null (all devices) or specific
        if (rule.scope_device_id && rule.scope_device_id !== deviceId) continue;

        const triggered = evalCondition(metricValue, rule.condition_op, rule.condition_value);
        if (!triggered) continue;

        // Cooldown check
        const cooldown = Math.max(rule.cooldown_secs || DEFAULT_COOLDOWN_SECS, minCooldownSecs);
        try {
            const recent = await adapter.getRecentAlert(rule.id, deviceId, cooldown);
            if (recent) continue; // Still in cooldown
        } catch (_) { /* ignore — fire anyway */ }

        // Fire alert
        const alert = {
            rule_id: rule.id,
            device_id: deviceId,
            severity: rule.severity || 'warning',
            message: `${rule.name}: ${metricType} = ${metricValue} (${rule.condition_op} ${rule.condition_value})`,
            triggered_at: new Date().toISOString(),
            acknowledged: false,
        };

        try {
            await adapter.createAlert(alert);
            console.log(`[AlertEngine] ALERT fired: ${alert.message} for ${deviceId}`);

            // Email notification
            if (rule.notify_emails) {
                emailService.sendAlertEmail(alert, rule).catch(err => {
                    console.error('[AlertEngine] Email failed:', err.message);
                });
            }
        } catch (err) {
            console.error('[AlertEngine] Failed to create alert:', err.message);
        }
    }
}

/**
 * Evaluate all enabled alert rules against a specific metric push.
 *
 * @param {string} deviceId
 * @param {string} metricType - e.g. 'cpu_usage', 'memory_usage', 'offline_duration'
 * @param {number} metricValue
 */
async function evaluateRules(deviceId, metricType, metricValue, opts) {
    if (!deviceId || metricValue === null || metricValue === undefined || metricValue === '') return;
    const value = Number(metricValue);
    if (!Number.isFinite(value)) return;
    const rules = await loadRules(metricType);
    if (rules.length) await evaluateAgainst(rules, deviceId, metricType, value, opts);
}

/**
 * Evaluate telemetry data against all applicable rules.
 * Called when a device sends a telemetry update.
 */
async function evaluateTelemetry(deviceId, telemetry) {
    if (telemetry.cpu_usage_percent !== undefined && telemetry.cpu_usage_percent !== null) {
        await evaluateRules(deviceId, 'cpu_usage', telemetry.cpu_usage_percent);
    }
    if (telemetry.memory_used_bytes && telemetry.memory_total_bytes) {
        const ratio = (telemetry.memory_used_bytes / telemetry.memory_total_bytes) * 100;
        await evaluateRules(deviceId, 'memory_usage', Math.round(ratio));
    }
}

/**
 * Run an evaluation without holding up the device's request. A failure is
 * logged, never thrown into the route.
 */
function evaluateInBackground(fn) {
    Promise.resolve().then(fn).catch((err) => {
        console.error('[AlertEngine] Evaluation failed:', err.message);
    });
}

/**
 * Periodic sweep: devices offline longer than an offline rule allows.
 * Reads the device list only when such a rule is on. Online, banned and
 * deleted devices, RDP/VNC targets and devices never seen are left out.
 */
async function periodicCheck({ now = Date.now() } = {}) {
    const rules = await loadRules('offline_duration');
    if (!rules.length) return;
    let devices;
    try {
        // Required here: the backend pulls in the database and the Go API client
        devices = await require('./serverBackend').getAllDevices();
    } catch (err) {
        console.error('[AlertEngine] Device list failed:', err.message);
        return;
    }
    for (const d of Array.isArray(devices) ? devices : []) {
        if (!d || !d.id || d.online || d.banned || d.soft_deleted || d.remote_target) continue;
        const last = Date.parse(d.last_online || '');
        if (!Number.isFinite(last)) continue;
        const secs = Math.floor((now - last) / 1000);
        if (secs <= 0) continue;
        await evaluateAgainst(rules, d.id, 'offline_duration', secs, { minCooldownSecs: secs });
    }
}

/** Run the offline sweep every `every` ms (one at a time); returns stop() */
function start({ every = 60 * 1000 } = {}) {
    let running = false;
    const timer = setInterval(async () => {
        if (running) return;
        running = true;
        try {
            await module.exports.periodicCheck();
        } catch (err) {
            console.error('[AlertEngine] Sweep failed:', err.message);
        } finally {
            running = false;
        }
    }, every);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
}

module.exports = {
    evaluateRules,
    evaluateTelemetry,
    evaluateInBackground,
    periodicCheck,
    start,
    evalCondition,
};
