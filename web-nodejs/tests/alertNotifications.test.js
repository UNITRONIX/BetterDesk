'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    alertToNotification,
    severityIcon,
} = require('../services/alertNotifications');

test('severityIcon maps critical/warning/info', () => {
    assert.equal(severityIcon('critical'), 'error');
    assert.equal(severityIcon('warning'), 'warning');
    assert.equal(severityIcon('info'), 'notifications_active');
});

test('alertToNotification shapes panel bell payload', () => {
    const item = alertToNotification({
        id: 42,
        rule_name: 'Idle too long',
        message: 'Idle too long: idle_duration = 90 (gt 60)',
        severity: 'critical',
        device_id: '123',
        triggered_at: '2026-11-27T10:00:00.000Z',
    });
    assert.equal(item.id, 'automation:alert:42');
    assert.equal(item.kind, 'automation_alert');
    assert.equal(item.link, '/automation?tab=alerts');
    assert.equal(item.icon, 'error');
    assert.equal(item.title, 'Idle too long');
    assert.match(item.message, /idle_duration/);
});

test('alertToNotification returns null without id', () => {
    assert.equal(alertToNotification({ rule_name: 'x' }), null);
});
