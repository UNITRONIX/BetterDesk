'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

function shellBool(value) {
    return value ? '1' : '0';
}

function linuxInstaller({ installService, autostart }) {
    return `#!/bin/sh
set -eu
APP_DIR="/opt/betterdesk-support-agent"
UNIT="betterdesk-support-agent.service"
SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INSTALL_SERVICE="${shellBool(installService)}"
AUTOSTART="${shellBool(autostart)}"

if [ "$(id -u)" -ne 0 ]; then
    exec sudo "$0" "$@"
fi

mkdir -p "$APP_DIR"
cp -a "$SOURCE_DIR"/. "$APP_DIR"/
chmod 755 "$APP_DIR"/betterdesk 2>/dev/null || true
if [ "$INSTALL_SERVICE" = 1 ]; then
    cat >"/etc/systemd/system/$UNIT" <<EOF
[Unit]
Description=BetterDesk Support Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$APP_DIR/betterdesk --service
Restart=on-failure
RestartSec=5
User=root
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    if [ "$AUTOSTART" = 1 ]; then
        systemctl enable --now "$UNIT"
    else
        systemctl disable "$UNIT" 2>/dev/null || true
    fi
fi
echo "BetterDesk Support Agent installed."
`;
}

function linuxUninstaller({ installService }) {
    return `#!/bin/sh
set -eu
APP_DIR="/opt/betterdesk-support-agent"
UNIT="betterdesk-support-agent.service"
if [ "$(id -u)" -ne 0 ]; then
    exec sudo "$0" "$@"
fi
if [ "${shellBool(installService)}" = 1 ]; then
    systemctl disable --now "$UNIT" 2>/dev/null || true
    rm -f "/etc/systemd/system/$UNIT"
    systemctl daemon-reload
fi
rm -rf "$APP_DIR"
echo "BetterDesk Support Agent removed."
`;
}

function macInstaller({ installService, autostart }) {
    return `#!/bin/sh
set -eu
SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP="$(find "$SOURCE_DIR" -maxdepth 2 -name '*.app' -type d | head -n 1)"
TARGET="/Applications/BetterDesk Support Agent.app"
PLIST="/Library/LaunchDaemons/com.unitronix.betterdesk-support-agent.plist"
if [ -z "$APP" ]; then echo "BetterDesk app bundle not found" >&2; exit 1; fi
if [ "$(id -u)" -ne 0 ]; then exec sudo "$0" "$@"; fi
rm -rf "$TARGET"
ditto "$APP" "$TARGET"
if [ "${shellBool(installService)}" = 1 ]; then
    SERVICE="$TARGET/Contents/MacOS/service"
    [ -x "$SERVICE" ] || SERVICE="$TARGET/Contents/MacOS/betterdesk"
    cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.unitronix.betterdesk-support-agent</string>
<key>ProgramArguments</key><array><string>$SERVICE</string><string>--service</string></array>
<key>RunAtLoad</key><${autostart ? 'true' : 'false'}/>
<key>KeepAlive</key><true/>
</dict></plist>
EOF
    launchctl bootout system "$PLIST" 2>/dev/null || true
    launchctl bootstrap system "$PLIST"
    if [ "${shellBool(autostart)}" = 1 ]; then launchctl kickstart -k system/com.unitronix.betterdesk-support-agent; fi
fi
echo "BetterDesk Support Agent installed."
`;
}

function macUninstaller({ installService }) {
    return `#!/bin/sh
set -eu
PLIST="/Library/LaunchDaemons/com.unitronix.betterdesk-support-agent.plist"
if [ "$(id -u)" -ne 0 ]; then exec sudo "$0" "$@"; fi
if [ "${shellBool(installService)}" = 1 ]; then
    launchctl bootout system "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
fi
rm -rf "/Applications/BetterDesk Support Agent.app"
echo "BetterDesk Support Agent removed."
`;
}

async function writeUnixSupportInstallers(stageDir, platform, options = {}) {
    const normalized = {
        installService: !!options.installService,
        autostart: !!options.autostart,
    };
    const scripts = platform === 'linux'
        ? {
            install: linuxInstaller(normalized),
            uninstall: linuxUninstaller(normalized),
        }
        : {
            install: macInstaller(normalized),
            uninstall: macUninstaller(normalized),
        };
    await fsp.writeFile(path.join(stageDir, 'install-betterdesk-support.sh'), scripts.install, { mode: 0o755 });
    await fsp.writeFile(path.join(stageDir, 'uninstall-betterdesk-support.sh'), scripts.uninstall, { mode: 0o755 });
    await Promise.all([
        fsp.chmod(path.join(stageDir, 'install-betterdesk-support.sh'), 0o755),
        fsp.chmod(path.join(stageDir, 'uninstall-betterdesk-support.sh'), 0o755),
    ]);
}

module.exports = {
    writeUnixSupportInstallers,
};
