'use strict';

const fs = require('fs');
const path = require('path');

describe('restart failure recovery UI contract', () => {
    test.each([
        ['settings.js', 'dismissFailedRestart'],
        ['restart-flow.js', 'dismissFailure'],
    ])(
        'allows a failed restart transaction to be dismissed in %s',
        (fileName, dismissFunction) => {
            const source = fs.readFileSync(
                path.join(__dirname, '../public/js', fileName),
                'utf8'
            );

            expect(source).toContain("phase: 'failed'");
            expect(source).toContain('/api/settings/restart/complete');
            expect(source).toContain(dismissFunction);
        }
    );
});
