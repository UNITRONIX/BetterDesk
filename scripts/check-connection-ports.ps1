# Verify that the running BetterDesk host matches a documented firewall profile.
#
# Profiles are defined in docs/CONNECTION_PORTS.md. This checks observed listeners, not
# intentions: a panel bound to 0.0.0.0 fails profile B even if the operator believes
# otherwise.
#
# Usage: powershell -File scripts/check-connection-ports.ps1 -Profile b
# Exit codes: 0 = matches, 1 = mismatch, 2 = usage/environment error.

param(
    [ValidateSet('a', 'b', 'c', 'd')]
    [string]$Profile = 'b'
)

$ErrorActionPreference = 'Stop'

$failCount = 0
$warnCount = 0

function Write-Fail([string]$Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    $script:failCount++
}

function Write-Warn([string]$Message) {
    Write-Host "WARN: $Message" -ForegroundColor Yellow
    $script:warnCount++
}

function Write-Ok([string]$Message) {
    Write-Host "ok:   $Message" -ForegroundColor Green
}

function Get-BindAddress([int]$Port) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $listeners) { return $null }
    return ($listeners | Select-Object -First 1).LocalAddress
}

function Test-Loopback([string]$Address) {
    if (-not $Address) { return $false }
    return ($Address -eq '::1' -or $Address -like '127.*')
}

try {
    # Panel ports must never be bound to a WAN interface.
    foreach ($panelPort in 5000, 5443) {
        $bind = Get-BindAddress $panelPort
        if (-not $bind) { continue }
        if (Test-Loopback $bind) {
            Write-Ok "panel $panelPort bound to loopback ($bind)"
        } else {
            Write-Fail "panel $panelPort is bound to $bind - expose it only on 127.0.0.1 behind a proxy"
        }
    }

    foreach ($required in 21116, 21117) {
        $bind = Get-BindAddress $required
        if ($bind) {
            Write-Ok "port $required is listening on $bind"
        } else {
            Write-Fail "port $required is not listening - clients cannot register (21116) or relay (21117)"
        }
    }

    # UDP 21116 matters for hole punching and does not appear in Get-NetTCPConnection.
    $udp = Get-NetUDPEndpoint -LocalPort 21116 -ErrorAction SilentlyContinue
    if ($udp) {
        Write-Ok 'UDP 21116 is listening (hole punching)'
    } else {
        Write-Warn 'UDP 21116 is not listening - hole punching will fall back or fail'
    }

    $apiBind = Get-BindAddress 21114
    if ($apiBind) {
        if ($Profile -eq 'b' -and -not (Test-Loopback $apiBind)) {
            Write-Fail "profile b: Client API 21114 is bound to $apiBind; bind it to 127.0.0.1 and proxy /api over 443"
        } else {
            Write-Ok "Client API 21114 listening on $apiBind"
        }
    } else {
        if ($Profile -eq 'b') {
            Write-Warn 'Client API 21114 is not listening - pairing, branding and enrollment need it via the proxy'
        } else {
            Write-Fail 'Client API 21114 is not listening - pairing, branding and enrollment will fail'
        }
    }

    foreach ($wsPort in 21118, 21119) {
        $bind = Get-BindAddress $wsPort
        if ($bind) {
            Write-Ok "WebSocket port $wsPort is listening on $bind"
        } elseif ($Profile -eq 'c') {
            Write-Fail "profile c needs $wsPort for WebSocket Mode"
        }
    }
} catch {
    Write-Host "error: $_" -ForegroundColor Red
    exit 2
}

Write-Host ''
if ($failCount -gt 0) {
    Write-Host "Profile $Profile`: $failCount problem(s), $warnCount warning(s). See docs/CONNECTION_PORTS.md" -ForegroundColor Red
    exit 1
}
Write-Host "Profile $Profile`: OK ($warnCount warning(s))" -ForegroundColor Green
exit 0
