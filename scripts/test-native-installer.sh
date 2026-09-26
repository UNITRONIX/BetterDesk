#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

test_bounded_go_commands() (
    export GO_COMMAND_HEARTBEAT_INTERVAL=1
    export GO_COMMAND_KILL_AFTER=1
    set --
    # shellcheck disable=SC1091
    source "$SCRIPT_ROOT/betterdesk.sh"

    if ! _run_go_command_bounded "successful test command" 5 sh -c 'exit 0'; then
        fail "successful bounded command returned non-zero"
    fi

    if _run_go_command_bounded "failed test command" 5 sh -c 'exit 7'; then
        fail "failed bounded command returned success"
    else
        status=$?
    fi
    [ "$status" -eq 7 ] || fail "expected exit code 7, got ${status}"

    if _run_go_command_bounded "timed test command" 1 sh -c 'sleep 10'; then
        fail "timed bounded command returned success"
    else
        status=$?
    fi
    [ "$status" -eq 124 ] || fail "expected timeout code 124, got ${status}"
)

test_dirty_native_clone() (
    local temp_dir fake_bin install_dir repo_dir
    temp_dir=$(mktemp -d)
    trap 'rm -rf "$temp_dir"' EXIT
    fake_bin="$temp_dir/bin"
    install_dir="$temp_dir/install"
    repo_dir="$install_dir/source"
    mkdir -p "$fake_bin" "$repo_dir/.git" "$repo_dir/betterdesk-server/data"
    printf 'local edit\n' > "$repo_dir/betterdesk.sh"
    printf 'runtime state\n' > "$repo_dir/betterdesk-server/data/state.txt"

    cat > "$fake_bin/git" <<'FAKE_GIT'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "-C" ]; then
    shift 2
    case "${1:-}" in
        remote|fetch)
            exit 0
            ;;
        status)
            printf ' M betterdesk.sh\n'
            exit 0
            ;;
        checkout)
            printf 'error: local changes would be overwritten\n' >&2
            exit 1
            ;;
        rev-parse)
            printf 'abc123\n'
            exit 0
            ;;
    esac
fi

if [ "${1:-}" = "clone" ]; then
    if [ "${FAKE_GIT_FAIL_CLONE:-0}" = "1" ]; then
        printf 'simulated clone failure\n' >&2
        exit 1
    fi
    destination="${!#}"
    mkdir -p "$destination/.git" "$destination/betterdesk-server"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$destination/betterdesk.sh"
    exit 0
fi

printf 'unexpected fake git invocation: %s\n' "$*" >&2
exit 1
FAKE_GIT
    chmod +x "$fake_bin/git"

    export PATH="$fake_bin:$PATH"
    export INSTALL_DIR="$install_dir"
    export RELAY_SERVERS="127.0.0.1:21117"
    export BETTERDESK_REPO="example/BetterDesk"
    export BETTERDESK_BRANCH="dev"
    set --
    # shellcheck disable=SC1091
    source "$SCRIPT_ROOT/install.sh"

    install_native_mode

    [ -d "$repo_dir/.git" ] || fail "fresh clone was not installed"
    [ -f "$repo_dir/betterdesk-server/data/state.txt" ] \
        || fail "runtime Go data was not preserved"
    compgen -G "$install_dir/source.backup.*" > /dev/null \
        || fail "dirty source backup was not preserved"
    backup_dir=""
    for path in "$install_dir"/source.backup.*; do
        if [ -e "$path" ]; then
            backup_dir="$path"
            break
        fi
    done
    [ -f "$backup_dir/betterdesk.sh" ] || fail "original dirty source was not backed up"

    if (
        export FAKE_GIT_FAIL_CLONE=1
        set --
        # shellcheck disable=SC1091
        source "$SCRIPT_ROOT/install.sh"
        install_native_mode
    ); then
        fail "failed clone returned success"
    fi
    [ -d "$repo_dir/.git" ] || fail "original source was not restored after clone failure"
)

test_bounded_go_commands
test_dirty_native_clone
printf 'PASS: native installer regression tests\n'
