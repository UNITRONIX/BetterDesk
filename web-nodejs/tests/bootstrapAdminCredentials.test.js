'use strict';

/**
 * Docker bootstrap-admin-credentials.sh — idempotent shared password (issue #385).
 * Runs only when sh is available (Linux/macOS CI and Docker build hosts).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', 'docker', 'bootstrap-admin-credentials.sh');
// Match dockerBootstrapCredentials.test.js: run whenever a POSIX sh is on PATH
// (Linux CI, Git Bash on Windows). Skip only when sh is unavailable.
const shAvailable = spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0;

(shAvailable ? describe : describe.skip)('bootstrap-admin-credentials.sh', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-bootstrap-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function runBootstrap(extraEnv = {}) {
        return spawnSync('sh', [SCRIPT], {
            env: {
                ...process.env,
                RUSTDESK_PATH: tmpDir,
                DATA_DIR: path.join(tmpDir, 'data'),
                ...extraEnv,
            },
            encoding: 'utf8',
        });
    }

    test('generates credentials file and exports matching env vars', () => {
        const result = runBootstrap();
        expect(result.status).toBe(0);

        const credsFile = path.join(tmpDir, '.admin_credentials');
        expect(fs.existsSync(credsFile)).toBe(true);
        const content = fs.readFileSync(credsFile, 'utf8');
        const match = content.match(/^Admin Password:\s*(.+)$/m);
        expect(match).not.toBeNull();
        expect(match[1].trim().length).toBeGreaterThan(0);
        expect(result.stdout).toContain('Bootstrap admin credentials');
    });

    test('does not overwrite existing credentials file', () => {
        const credsFile = path.join(tmpDir, '.admin_credentials');
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(credsFile, 'Admin Username: admin\nAdmin Password: existing-secret\n', { mode: 0o600 });

        const first = runBootstrap();
        expect(first.status).toBe(0);
        expect(fs.readFileSync(credsFile, 'utf8')).toContain('existing-secret');
    });

    test('publishes ADMIN_PASSWORD to .admin_credentials on a fresh volume', () => {
        // Operators and show-admin-credentials must read the same password as
        // INIT_ADMIN_PASS / DEFAULT_ADMIN_PASSWORD (issue #385).
        const result = runBootstrap({ ADMIN_PASSWORD: 'preset-password-12345' });
        expect(result.status).toBe(0);

        const credsFile = path.join(tmpDir, '.admin_credentials');
        expect(fs.existsSync(credsFile)).toBe(true);
        expect(fs.readFileSync(credsFile, 'utf8')).toContain('Admin Password: preset-password-12345');
    });
});
