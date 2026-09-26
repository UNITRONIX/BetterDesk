#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="${BETTERDESK_IMAGE_TAG:-dev}"
IMAGE="${BETTERDESK_HARDENING_IMAGE:-ghcr.io/unitronix/betterdesk:${IMAGE_TAG}}"
PROJECT="betterdesk-hardening-$RANDOM"
TEST_DIR="$(mktemp -d)"
OVERRIDE_FILE="$TEST_DIR/compose.override.yml"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

cleanup() {
    docker compose -p "$PROJECT" \
        -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
        -f "$OVERRIDE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    printf 'SKIP: Docker is not available\n'
    exit 0
fi

mkdir -p "$TEST_DIR/rustdesk" "$TEST_DIR/console"
cat > "$OVERRIDE_FILE" <<EOF
services:
  betterdesk:
    image: ${IMAGE}
    volumes:
      - ${TEST_DIR}/rustdesk:/opt/rustdesk
      - ${TEST_DIR}/console:/app/data
EOF

if [[ "$IMAGE" == ghcr.io/* ]]; then
    docker compose -p "$PROJECT" \
        -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
        -f "$OVERRIDE_FILE" pull betterdesk
fi

printf 'stable-test-api-key\n' > "$TEST_DIR/rustdesk/.api_key"
chmod 600 "$TEST_DIR/rustdesk/.api_key"
docker run --rm \
    --entrypoint sh \
    -v "$TEST_DIR/rustdesk:/opt/rustdesk" \
    -v "$TEST_DIR/console:/app/data" \
    "$IMAGE" \
    -c 'chown -R 10001:10001 /opt/rustdesk /app/data && chmod 700 /opt/rustdesk /app/data'

docker compose -p "$PROJECT" \
    -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
    -f "$OVERRIDE_FILE" up -d --wait

first_key=$(docker compose -p "$PROJECT" \
    -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
    -f "$OVERRIDE_FILE" exec -T -u betterdesk betterdesk \
    sh -c 'cat /opt/rustdesk/.api_key' | tr -d '\r\n')
[ "$first_key" = "stable-test-api-key" ] \
    || fail "existing API key was not preserved on first start"

docker compose -p "$PROJECT" \
    -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
    -f "$OVERRIDE_FILE" restart betterdesk
docker compose -p "$PROJECT" \
    -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
    -f "$OVERRIDE_FILE" up -d --wait

second_key=$(docker compose -p "$PROJECT" \
    -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
    -f "$OVERRIDE_FILE" exec -T -u betterdesk betterdesk \
    sh -c 'cat /opt/rustdesk/.api_key' | tr -d '\r\n')
[ "$second_key" = "$first_key" ] \
    || fail "API key changed after a hardened-container restart"

docker compose -p "$PROJECT" \
    -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
    -f "$OVERRIDE_FILE" exec -T -u betterdesk betterdesk \
    rm -f /opt/rustdesk/.admin_credentials
docker compose -p "$PROJECT" \
    -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
    -f "$OVERRIDE_FILE" restart betterdesk
docker compose -p "$PROJECT" \
    -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
    -f "$OVERRIDE_FILE" up -d --wait

[ ! -e "$TEST_DIR/rustdesk/.admin_credentials" ] \
    || fail "bootstrap recreated credentials for an existing database"
if docker compose -p "$PROJECT" \
    -f "$SCRIPT_ROOT/docker-compose.quick.single.yml" \
    -f "$OVERRIDE_FILE" logs 2>&1 \
    | grep -Eq 'Format string .*ENV_(DEFAULT_ADMIN|INIT_ADMIN)'; then
    fail "supervisord failed to expand admin environment variables"
fi

printf 'PASS: hardened Docker startup regression tests\n'
