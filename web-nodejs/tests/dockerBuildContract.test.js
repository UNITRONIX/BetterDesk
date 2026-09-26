'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const dockerfiles = ['Dockerfile', 'Dockerfile.console', 'Dockerfile.server'];

function copySources(dockerfile) {
    return fs.readFileSync(path.join(repoRoot, dockerfile), 'utf8')
        .split(/\r?\n/)
        .filter(line => /^\s*COPY\s/.test(line) && !line.includes('--from='))
        .flatMap(line => {
            const tokens = line.trim().split(/\s+/).slice(1);
            return tokens.slice(0, -1);
        });
}

function sourceExists(source) {
    if (!/[?*[\]{}]/.test(source)) {
        return fs.existsSync(path.join(repoRoot, source));
    }

    const wildcardIndex = source.search(/[?*[\]{}]/);
    const directory = path.dirname(source.slice(0, wildcardIndex));
    const prefix = path.basename(source.slice(0, wildcardIndex));
    const absoluteDirectory = path.join(repoRoot, directory);

    return fs.existsSync(absoluteDirectory)
        && fs.readdirSync(absoluteDirectory).some(entry => entry.startsWith(prefix));
}

describe('Docker build context contract', () => {
    test.each(dockerfiles)('%s only copies sources present in the repository', dockerfile => {
        const missing = copySources(dockerfile).filter(source => !sourceExists(source));

        expect(missing).toEqual([]);
    });

    test.each(dockerfiles)('%s does not require withdrawn agent sources', dockerfile => {
        const contents = fs.readFileSync(path.join(repoRoot, dockerfile), 'utf8');

        expect(contents).not.toMatch(/betterdesk-(?:support-)?agent|agent-source/);
    });
});

describe('Docker admin bootstrap contract', () => {
    const composeFiles = [
        'docker-compose.yml',
        'docker-compose.single.yml',
        'docker-compose.quick.yml',
        'docker-compose.quick.single.yml',
        'docker-compose.quick.macvlan.yml',
        'docker-compose.quick.single.macvlan.yml',
    ];

    test.each(composeFiles)('%s forwards all admin password aliases', composeFile => {
        const contents = fs.readFileSync(path.join(repoRoot, composeFile), 'utf8');

        expect(contents).toContain('ADMIN_PASSWORD=${ADMIN_PASSWORD:-}');
        expect(contents).toContain('INIT_ADMIN_PASS=${ADMIN_PASSWORD:-}');
        expect(contents).toContain('DEFAULT_ADMIN_PASSWORD=${ADMIN_PASSWORD:-}');
    });

    test('split Compose variants use the shared primary SQLite path', () => {
        for (const composeFile of ['docker-compose.quick.yml', 'docker-compose.quick.macvlan.yml']) {
            const contents = fs.readFileSync(path.join(repoRoot, composeFile), 'utf8');

            expect(contents).toContain('DB_URL=/opt/rustdesk/db_v2.sqlite3');
            expect(contents).toContain('DB_PATH=/opt/rustdesk/db_v2.sqlite3');
        }
    });

    test('split server entrypoint normalizes the Go database path', () => {
        const contents = fs.readFileSync(
            path.join(repoRoot, 'docker', 'server-entrypoint.sh'),
            'utf8'
        );

        expect(contents).toContain('export DB_URL="${DB_PATH:-${RUSTDESK_PATH:-$DATA_DIR}/db_v2.sqlite3}"');
        expect(contents).toContain('export DB_URL="${DATABASE_URL:-${DB_PATH:-${RUSTDESK_PATH:-$DATA_DIR}/db_v2.sqlite3}}"');
    });

    test('hardened Docker checks app-owned paths as betterdesk', () => {
        const bootstrap = fs.readFileSync(
            path.join(repoRoot, 'docker', 'bootstrap-admin-credentials.sh'),
            'utf8'
        );
        const entrypoint = fs.readFileSync(
            path.join(repoRoot, 'docker', 'entrypoint.sh'),
            'utf8'
        );
        const guard = fs.readFileSync(
            path.join(repoRoot, 'docker', 'guard-sqlite-auth-split.sh'),
            'utf8'
        );

        expect(bootstrap).toContain('file_exists_as_betterdesk()');
        expect(bootstrap).toContain('path_exists_as_betterdesk()');
        expect(bootstrap).toContain('file_exists_as_betterdesk "$_file"');
        expect(bootstrap).toContain('file_exists_as_betterdesk "$_primary_db"');
        expect(bootstrap).toContain('path_exists_as_betterdesk "$CREDS_FILE"');
        expect(entrypoint).toContain('file_exists_as_betterdesk "$API_KEY_FILE"');
        expect(entrypoint).toContain('file_exists_as_betterdesk "$ENROLLMENT_SENTINEL"');
        expect(guard).toContain('file_exists_as_betterdesk "$_auth_db"');
        expect(guard).toContain('file_exists_as_betterdesk "$_primary_db"');
    });

    test('AIO supervisord admin variables are always exported by bootstrap', () => {
        const bootstrap = fs.readFileSync(
            path.join(repoRoot, 'docker', 'bootstrap-admin-credentials.sh'),
            'utf8'
        );
        const supervisor = fs.readFileSync(
            path.join(repoRoot, 'docker', 'supervisord.conf'),
            'utf8'
        );

        expect(bootstrap).toContain('ensure_admin_exports()');
        expect(bootstrap).toContain('export INIT_ADMIN_USER=');
        expect(bootstrap).toContain('export INIT_ADMIN_PASS=');
        expect(bootstrap).toContain('export DEFAULT_ADMIN_USERNAME=');
        expect(bootstrap).toContain('export DEFAULT_ADMIN_PASSWORD=');
        expect(supervisor).toContain('%(ENV_DEFAULT_ADMIN_USERNAME)s');
        expect(supervisor).toContain('%(ENV_DEFAULT_ADMIN_PASSWORD)s');
        expect(supervisor).toContain('%(ENV_INIT_ADMIN_USER)s');
        expect(supervisor).toContain('%(ENV_INIT_ADMIN_PASS)s');
    });

    test.each([
        'docker-compose.yml',
        'docker-compose.single.yml',
        'docker-compose.quick.yml',
        'docker-compose.quick.single.yml',
        'docker-compose.quick.macvlan.yml',
        'docker-compose.quick.single.macvlan.yml',
    ])('%s exposes optional TRUST_PROXY configuration', composeFile => {
        const contents = fs.readFileSync(path.join(repoRoot, composeFile), 'utf8');

        expect(contents).toContain('TRUST_PROXY=${TRUST_PROXY:-}');
    });
});
