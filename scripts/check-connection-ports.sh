#!/usr/bin/env bash
# Verify that the running BetterDesk host matches a documented firewall profile.
#
# Profiles and their expected exposure are defined in docs/CONNECTION_PORTS.md. This script
# checks observed listeners, not intentions: a panel bound to 0.0.0.0 fails profile B even if
# the operator believes otherwise.
#
# Usage: sudo bash scripts/check-connection-ports.sh [a|b|c|d]
# Exit codes: 0 = matches, 1 = mismatch, 2 = usage/environment error.

set -uo pipefail

PROFILE="${1:-b}"
PROFILE="$(printf '%s' "$PROFILE" | tr '[:upper:]' '[:lower:]')"

case "$PROFILE" in
  a | b | c | d) ;;
  *)
    echo "usage: $0 [a|b|c|d]   (see docs/CONNECTION_PORTS.md)" >&2
    exit 2
    ;;
esac

FAIL=0
WARN=0

fail() {
  echo "FAIL: $*"
  FAIL=$((FAIL + 1))
}

warn() {
  echo "WARN: $*"
  WARN=$((WARN + 1))
}

ok() {
  echo "ok:   $*"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

if ! have ss && ! have netstat; then
  echo "error: need ss or netstat to inspect listeners" >&2
  exit 2
fi

# `ss -ltn` output: "LISTEN 0 4096 127.0.0.1:5000 0.0.0.0:*"
listeners() {
  if have ss; then
    ss -ltn 2>/dev/null | awk 'NR > 1 { print $4 }'
  else
    netstat -ltn 2>/dev/null | awk 'NR > 2 { print $4 }'
  fi
}

# Print the bind address for a port, or nothing when it is not listening.
bind_of() {
  listeners | awk -v port="$1" '
    {
      idx = match($0, /:[0-9]+$/)
      if (idx == 0) next
      p = substr($0, idx + 1)
      if (p != port) next
      host = substr($0, 1, idx - 1)
      sub(/^\[/, "", host)
      sub(/\]$/, "", host)
      print host
      exit
    }'
}

port_open() {
  [ -n "$(bind_of "$1")" ]
}

is_loopback() {
  case "$1" in
    127.* | ::1 | localhost) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Panel must never be WAN-bound ------------------------------------------------------
for panel_port in 5000 5443; do
  bind="$(bind_of "$panel_port")"
  if [ -z "$bind" ]; then
    continue
  fi
  if is_loopback "$bind"; then
    ok "panel $panel_port bound to loopback ($bind)"
  else
    fail "panel $panel_port is bound to $bind - expose it only on 127.0.0.1 behind a proxy"
  fi
done

# --- Required in every profile ----------------------------------------------------------
for required in 21116 21117; do
  if port_open "$required"; then
    ok "port $required is listening"
  else
    fail "port $required is not listening - clients cannot register (21116) or relay (21117)"
  fi
done

# --- Client API -------------------------------------------------------------------------
if port_open 21114; then
  bind="$(bind_of 21114)"
  case "$PROFILE" in
    b)
      # Profile B keeps the Client API reachable only from the proxy on the same host.
      if is_loopback "$bind"; then
        ok "Client API 21114 bound to loopback (profile B)"
      else
        fail "profile B: Client API 21114 is bound to $bind; bind it to 127.0.0.1 and proxy /api over 443"
      fi
      ;;
    *)
      ok "Client API 21114 listening on $bind"
      ;;
  esac
else
  case "$PROFILE" in
    b)
      warn "Client API 21114 is not listening - pairing, branding and enrollment will fail unless the proxy reaches it"
      ;;
    *)
      fail "Client API 21114 is not listening - pairing, branding and enrollment will fail"
      ;;
  esac
fi

# --- WebSocket ports are optional except in profile C -----------------------------------
case "$PROFILE" in
  c)
    for ws_port in 21118 21119; do
      if port_open "$ws_port"; then
        ok "WebSocket port $ws_port is listening (profile C)"
      else
        fail "profile C needs $ws_port for WebSocket Mode"
      fi
    done
    ;;
  *)
    for ws_port in 21118 21119; do
      if port_open "$ws_port"; then
        ok "WebSocket port $ws_port is listening (optional)"
      fi
    done
    ;;
esac

# --- HTTP reachability of the API -------------------------------------------------------
if have curl; then
  if curl -sf --max-time 5 "http://127.0.0.1:21114/api/health" >/dev/null 2>&1; then
    ok "GET /api/health answers on 21114"
  else
    warn "GET /api/health did not answer on http://127.0.0.1:21114 (expected when TLS-only)"
  fi
else
  warn "curl not installed; skipped the /api/health probe"
fi

echo
if [ "$FAIL" -ne 0 ]; then
  echo "Profile $PROFILE: $FAIL problem(s), $WARN warning(s). See docs/CONNECTION_PORTS.md" >&2
  exit 1
fi
echo "Profile $PROFILE: OK ($WARN warning(s))"
