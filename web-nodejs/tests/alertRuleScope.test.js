'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseScopeDeviceIds,
    serializeScopeDeviceIds,
    normalizeScopeFromBody,
    ruleMatchesDevice,
    enrichRuleScope,
} = require('../lib/alertRuleScope');

test('parseScopeDeviceIds: null/empty means all devices', () => {
    assert.equal(parseScopeDeviceIds(null), null);
    assert.equal(parseScopeDeviceIds(''), null);
    assert.equal(parseScopeDeviceIds('   '), null);
});

test('parseScopeDeviceIds: legacy single id', () => {
    assert.deepEqual(parseScopeDeviceIds('12345'), ['12345']);
});

test('parseScopeDeviceIds: JSON array and CSV', () => {
    assert.deepEqual(parseScopeDeviceIds('["a","b"]'), ['a', 'b']);
    assert.deepEqual(parseScopeDeviceIds('a, b, a'), ['a', 'b']);
});

test('serializeScopeDeviceIds stores single id without JSON', () => {
    assert.equal(serializeScopeDeviceIds(['only']), 'only');
    assert.equal(serializeScopeDeviceIds(['a', 'b']), '["a","b"]');
    assert.equal(serializeScopeDeviceIds([]), null);
});

test('normalizeScopeFromBody prefers scope_device_ids', () => {
    assert.equal(normalizeScopeFromBody({ scope_device_ids: ['1', '2'], scope_device_id: '9' }), '["1","2"]');
    assert.equal(normalizeScopeFromBody({ scope_device_ids: [] }), null);
    assert.equal(normalizeScopeFromBody({ scope_device_id: '7' }), '7');
    assert.equal(normalizeScopeFromBody({}), undefined);
});

test('ruleMatchesDevice respects multi-scope', () => {
    assert.equal(ruleMatchesDevice({ scope_device_id: null }, '1'), true);
    assert.equal(ruleMatchesDevice({ scope_device_id: '1' }, '1'), true);
    assert.equal(ruleMatchesDevice({ scope_device_id: '1' }, '2'), false);
    assert.equal(ruleMatchesDevice({ scope_device_id: '["1","2"]' }, '2'), true);
    assert.equal(ruleMatchesDevice({ scope_device_id: '["1","2"]' }, '3'), false);
});

test('enrichRuleScope adds scope_device_ids', () => {
    const enriched = enrichRuleScope({ id: 1, scope_device_id: '["a","b"]' });
    assert.deepEqual(enriched.scope_device_ids, ['a', 'b']);
});
