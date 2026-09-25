#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$REPO_ROOT/betterdesk.sh"
TEST_ROOT="$(mktemp -d)"
FUNCTIONS_FILE="$TEST_ROOT/betterdesk-functions.sh"
FAKE_BIN="$TEST_ROOT/bin"
HBA_FILE="$TEST_ROOT/pg_hba.conf"
STATE_DIR="$TEST_ROOT/state"
mkdir -p "$FAKE_BIN" "$STATE_DIR"
trap 'rm -rf "$TEST_ROOT"' EXIT

sed '$d' "$INSTALLER" > "$FUNCTIONS_FILE"

cat > "$FAKE_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "-u" ] && [ "${2:-}" = "postgres" ]; then
    shift 2
fi
exec "$@"
EOF

cat > "$FAKE_BIN/psql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$*" in
    *"SHOW hba_file;"*)
        printf '%s\n' "$BETTERDESK_TEST_HBA"
        ;;
    *)
        exit 0
        ;;
esac
EOF

cat > "$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "reload" ] && [ "${2:-}" = "postgresql" ]; then
    touch "$BETTERDESK_TEST_RELOADED"
fi
EOF

cat > "$FAKE_BIN/service" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

chmod +x "$FAKE_BIN"/*

count_exact_line() {
    local expected="$1"
    awk -v expected="$expected" '$0 == expected { count++ } END { print count + 0 }' "$HBA_FILE"
}

run_hba_setup() {
    local host="$1"
    PATH="$FAKE_BIN:$PATH" \
        AUTO_MODE=true \
        POSTGRESQL_HOST="$host" \
        POSTGRESQL_DB=betterdesk \
        POSTGRESQL_USER=betterdesk \
        BETTERDESK_TEST_HBA="$HBA_FILE" \
        BETTERDESK_TEST_RELOADED="$STATE_DIR/reloaded" \
        bash -c 'script="$1"; shift; source "$script" --auto; ensure_postgresql_local_hba_rules' \
        -- "$FUNCTIONS_FILE"
}

cat > "$HBA_FILE" <<'EOF'
# PostgreSQL client authentication configuration file.
local   all             postgres                                peer
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
EOF

run_hba_setup localhost

ipv4_rule='host    betterdesk    betterdesk    127.0.0.1/32    scram-sha-256'
ipv6_rule='host    betterdesk    betterdesk    ::1/128         scram-sha-256'

if [ "$(count_exact_line "$ipv4_rule")" -ne 1 ] ||
    [ "$(count_exact_line "$ipv6_rule")" -ne 1 ]; then
    printf 'Expected both BetterDesk localhost HBA rules exactly once.\n' >&2
    exit 1
fi

if ! [ -f "$STATE_DIR/reloaded" ]; then
    printf 'Expected PostgreSQL reload after changing pg_hba.conf.\n' >&2
    exit 1
fi

rule_line="$(awk -v expected="$ipv4_rule" '$0 == expected { print NR; exit }' "$HBA_FILE")"
broad_rule_line="$(awk '$1 == "host" && $2 == "all" && $3 == "all" && $4 == "127.0.0.1/32" { print NR; exit }' "$HBA_FILE")"
if [ "$rule_line" -ge "$broad_rule_line" ]; then
    printf 'Expected the scoped IPv4 rule before the broad localhost rule.\n' >&2
    exit 1
fi

before="$(sha256sum "$HBA_FILE")"
run_hba_setup localhost
after="$(sha256sum "$HBA_FILE")"
if [ "$before" != "$after" ]; then
    printf 'Expected a second HBA setup to be idempotent.\n' >&2
    exit 1
fi

cat > "$HBA_FILE" <<'EOF'
local   all             postgres                                peer
EOF
rm -f "$STATE_DIR/reloaded"
run_hba_setup db.example.test

if [ -s "$HBA_FILE" ] && [ "$(wc -l < "$HBA_FILE")" -ne 1 ]; then
    printf 'Expected remote PostgreSQL setup to leave pg_hba.conf unchanged.\n' >&2
    exit 1
fi
if [ -f "$STATE_DIR/reloaded" ]; then
    printf 'Expected remote PostgreSQL setup to skip reload.\n' >&2
    exit 1
fi

printf '%s\n' "PostgreSQL pg_hba.conf regression checks passed."
