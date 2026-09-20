#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$REPO_ROOT/betterdesk.sh"
TEST_ROOT="$(mktemp -d)"
FUNCTIONS_FILE="$TEST_ROOT/betterdesk-functions.sh"
FAKE_BIN="$TEST_ROOT/bin"
STATE_DIR="$TEST_ROOT/state"
mkdir -p "$FAKE_BIN" "$STATE_DIR"
trap 'rm -rf "$TEST_ROOT"' EXIT

# Load the production functions without invoking the interactive installer.
sed '$d' "$INSTALLER" > "$FUNCTIONS_FILE"

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

output=""
while [ "$#" -gt 0 ]; do
    if [ "$1" = "-o" ]; then
        output="$2"
        shift 2
    else
        shift
    fi
done

{
    printf '%s\n' '#!/bin/bash'
    for _ in $(seq 1 1100); do
        printf '%s\n' '# mocked NodeSource setup script'
    done
} > "$output"
EOF

cat > "$FAKE_BIN/apt-get" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case " $* " in
    *" remove "*)
        touch "$BETTERDESK_NODE_TEST_STATE/libnode-dev.removed"
        ;;
    *" install "*)
        if [ "$BETTERDESK_NODE_TEST_APT" = "fail" ]; then
            exit 42
        fi
        touch "$BETTERDESK_NODE_TEST_STATE/node22"
        ;;
esac
EOF

cat > "$FAKE_BIN/dpkg-query" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$BETTERDESK_NODE_TEST_CONFLICT" = "true" ]; then
    printf '%s\n' 'installed'
fi
EOF

cat > "$FAKE_BIN/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ -f "$BETTERDESK_NODE_TEST_STATE/node22" ] || [ "$BETTERDESK_NODE_TEST_NODE" = "22" ]; then
    printf '%s\n' 'v22.23.2'
else
    printf '%s\n' 'v12.22.9'
fi
EOF

cat > "$FAKE_BIN/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$BETTERDESK_NODE_TEST_NPM" = "missing" ]; then
    exit 127
fi
printf '%s\n' '10.9.2'
EOF

chmod +x "$FAKE_BIN"/*

run_case() {
    local apt_mode="$1"
    local node_mode="$2"
    local npm_mode="$3"
    local conflict="$4"
    local output
    local status

    rm -f "$STATE_DIR"/* 2>/dev/null || true
    set +e
    output=$(
        PATH="$FAKE_BIN:$PATH" \
        AUTO_MODE=true \
        BETTERDESK_NODE_TEST_APT="$apt_mode" \
        BETTERDESK_NODE_TEST_NODE="$node_mode" \
        BETTERDESK_NODE_TEST_NPM="$npm_mode" \
        BETTERDESK_NODE_TEST_CONFLICT="$conflict" \
        BETTERDESK_NODE_TEST_STATE="$STATE_DIR" \
        bash -c 'script="$1"; shift; source "$script" --auto; install_nodejs' -- "$FUNCTIONS_FILE" 2>&1
    )
    status=$?
    set -e

    TEST_OUTPUT="$output"
    TEST_STATUS="$status"
}

assert_failed_with() {
    local expected="$1"
    if [ "$TEST_STATUS" -eq 0 ]; then
        printf 'Expected failure, but installer returned success.\n%s\n' "$TEST_OUTPUT" >&2
        exit 1
    fi
    if [[ "$TEST_OUTPUT" != *"$expected"* ]]; then
        printf 'Expected output to contain %q.\n%s\n' "$expected" "$TEST_OUTPUT" >&2
        exit 1
    fi
}

run_case fail 12 missing true
assert_failed_with "Node.js 22 package installation failed."

run_case success 12 available true
if [ "$TEST_STATUS" -ne 0 ] || [ ! -f "$STATE_DIR/libnode-dev.removed" ]; then
    printf 'Expected libnode-dev conflict recovery to succeed.\n%s\n' "$TEST_OUTPUT" >&2
    exit 1
fi

run_case success 22 missing false
assert_failed_with "npm is missing or not executable."

printf '%s\n' "Native Node.js installer regression checks passed."
