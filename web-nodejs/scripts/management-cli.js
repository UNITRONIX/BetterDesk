#!/usr/bin/env node
'use strict';

const management = require('../lib/managementCapabilities');

function usage() {
    console.log([
        'Usage:',
        '  node scripts/management-cli.js check',
        '  node scripts/management-cli.js get-config',
        '  node scripts/management-cli.js set KEY=VALUE [KEY=VALUE ...]',
        '  node scripts/management-cli.js validate KEY=VALUE [KEY=VALUE ...]',
    ].join('\n'));
}

function parseChanges(args) {
    const changes = {};
    for (const item of args) {
        const separator = item.indexOf('=');
        if (separator <= 0) throw new Error(`Expected KEY=VALUE, got: ${item}`);
        changes[item.slice(0, separator)] = item.slice(separator + 1);
    }
    return changes;
}

function printJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main() {
    const [action, ...rest] = process.argv.slice(2);
    if (!action || action === '--help' || action === '-h') {
        usage();
        return 0;
    }
    switch (action) {
        case 'check': {
            const report = management.getCapabilityReport();
            printJson(report);
            return Object.values(report.groups).every((group) => group.ready) ? 0 : 1;
        }
        case 'get-config': {
            const paths = management.resolvePaths();
            const values = management.readEnvFile(paths.envPath);
            const keys = [...management.getAllowedEnvKeys(paths)].sort();
            printJson({
                envPath: paths.envPath,
                values: Object.fromEntries(keys
                    .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
                    .map((key) => [key, management.maskValue(key, values[key])])),
            });
            return 0;
        }
        case 'validate':
            printJson({ valid: true, changes: management.validateEnvChanges(parseChanges(rest)) });
            return 0;
        case 'set':
            printJson(management.applyEnvChanges(parseChanges(rest)));
            return 0;
        default:
            usage();
            return 2;
    }
}

try {
    process.exitCode = main();
} catch (err) {
    process.stderr.write(`${err.message || String(err)}\n`);
    process.exitCode = 1;
}
