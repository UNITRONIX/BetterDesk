'use strict';

/**
 * Map automation alert_history rows into navbar notification-center items.
 */

const { getAdapter } = require('./dbAdapter');

function toCreatedAt(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function severityIcon(severity) {
    switch (String(severity || '').toLowerCase()) {
        case 'critical':
            return 'error';
        case 'warning':
            return 'warning';
        default:
            return 'notifications_active';
    }
}

/**
 * @param {object} alert
 * @returns {object|null}
 */
function alertToNotification(alert) {
    if (!alert || alert.id === undefined || alert.id === null) return null;
    const id = `automation:alert:${alert.id}`;
    return {
        id,
        title: alert.rule_name || 'Alert',
        message: alert.message || [alert.device_id, alert.severity].filter(Boolean).join(' · '),
        icon: severityIcon(alert.severity),
        link: '/automation?tab=alerts',
        read: false,
        created_at: toCreatedAt(alert.triggered_at || alert.created_at),
        kind: 'automation_alert',
        severity: alert.severity || 'warning',
        device_id: alert.device_id || '',
        alert_id: alert.id,
    };
}

/**
 * Unacknowledged automation alerts for the panel bell.
 *
 * @param {Set<string>} readIds
 * @returns {Promise<object[]>}
 */
async function listAutomationAlertNotifications(readIds = new Set()) {
    try {
        const adapter = getAdapter();
        if (typeof adapter.getAlertHistory !== 'function') return [];
        const alerts = await adapter.getAlertHistory({ acknowledged: false, limit: 50 });
        return (Array.isArray(alerts) ? alerts : [])
            .map(alertToNotification)
            .filter(Boolean)
            .map((item) => ({
                ...item,
                read: readIds.has(String(item.id)),
            }));
    } catch (_) {
        return [];
    }
}

module.exports = {
    alertToNotification,
    listAutomationAlertNotifications,
    severityIcon,
};
