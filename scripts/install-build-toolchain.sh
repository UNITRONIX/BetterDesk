#!/usr/bin/env bash
# BetterDesk — embedded Support builder toolchain installer (Linux only)
#
# Provisions a host so the Node.js console can build incoming-only
# BetterDesk Support artifacts with the embedded BetterDesk-Client provider.
# Idempotent — safe to re-run.
#
# Local targets are host-only:
#   linux/x64/portable     Portable Support archive
#   linux/x64/deb|rpm|arch Linux packages when their packagers are installed
#
# Windows, macOS and ARM targets require a separate trusted provider. This
# script does not install or pretend to provide cross-compilers for them.
#
# Usage:
#   sudo ./install-build-toolchain.sh [--unattended]
#
# Environment overrides:
#   BUILD_USER         user that runs the local builder (default: betterdesk)
#   BUILD_CACHE_DIR    cargo target dir (default: /var/cache/betterdesk-build)
#   RUSTUP_HOME        rustup install root (default: $BUILD_USER home/.rustup)
#   CARGO_HOME         cargo install root  (default: $BUILD_USER home/.cargo)
#   FLUTTER_ROOT       Flutter installation root (default: /opt/flutter-3.24.5)
#   FLUTTER_VERSION    Flutter version (default: 3.24.5)
#   VCPKG_ROOT         vcpkg installation root (default: /opt/vcpkg)
#   VCPKG_COMMIT_ID    pinned vcpkg commit used by BetterDesk-Client

set -euo pipefail

UNATTENDED=0
for arg in "$@"; do
    case "$arg" in
        --unattended) UNATTENDED=1 ;;
        -h|--help)
            sed -n '2,25p' "$0"
            exit 0
            ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: must run as root (use sudo)" >&2
    exit 1
fi

BUILD_USER="${BUILD_USER:-betterdesk}"
if ! id "$BUILD_USER" >/dev/null 2>&1; then
    echo "ERROR: BUILD_USER '$BUILD_USER' does not exist on this host" >&2
    exit 1
fi

BUILD_HOME="$(getent passwd "$BUILD_USER" | cut -d: -f6)"
BUILD_CACHE_DIR="${BUILD_CACHE_DIR:-/var/cache/betterdesk-build}"
RUSTUP_HOME_DIR="${RUSTUP_HOME:-$BUILD_HOME/.rustup}"
CARGO_HOME_DIR="${CARGO_HOME:-$BUILD_HOME/.cargo}"
FLUTTER_VERSION="${FLUTTER_VERSION:-3.24.5}"
FLUTTER_ROOT="${FLUTTER_ROOT:-/opt/flutter-${FLUTTER_VERSION}}"
VCPKG_ROOT_DIR="${VCPKG_ROOT:-/opt/vcpkg}"
VCPKG_COMMIT_ID="${VCPKG_COMMIT_ID:-9e593bb18ea69cc5095e012465dcd675a822ed0d}"
PUB_CACHE_DIR="${PUB_CACHE:-$BUILD_HOME/.pub-cache}"

log()  { echo -e "\e[36m[toolchain]\e[0m $*"; }
warn() { echo -e "\e[33m[toolchain]\e[0m $*" >&2; }
err()  { echo -e "\e[31m[toolchain]\e[0m $*" >&2; }

detect_pkg_mgr() {
    if command -v apt-get >/dev/null 2>&1; then echo apt; return; fi
    if command -v dnf     >/dev/null 2>&1; then echo dnf; return; fi
    if command -v yum     >/dev/null 2>&1; then echo yum; return; fi
    if command -v zypper  >/dev/null 2>&1; then echo zypper; return; fi
    if command -v pacman  >/dev/null 2>&1; then echo pacman; return; fi
    echo unknown
}

PKG="$(detect_pkg_mgr)"
log "Package manager: $PKG"
log "Build user: $BUILD_USER  (home: $BUILD_HOME)"
log "Cargo target cache: $BUILD_CACHE_DIR"

# ---------------------------------------------------------------------------
# 1) System packages — Flutter/Rust build dependencies and packagers
# ---------------------------------------------------------------------------

install_apt() {
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y --no-install-recommends \
        build-essential pkg-config curl wget git ca-certificates \
        python3 unzip xz-utils clang cmake ninja-build \
        libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
        liblzma-dev libgl1-mesa-dev libx11-dev libxcursor-dev libxrandr-dev \
        libxinerama-dev libxi-dev libxkbcommon-dev libwayland-dev \
        dpkg-dev rpm fakeroot zstd
    # Node.js: prefer existing install (NodeSource bundles npm; the Ubuntu npm
    # package conflicts with it). Install only if neither node nor npm exist.
    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
        log "Installing Node.js LTS via NodeSource"
        curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
        apt-get install -y nodejs
    fi
}

install_dnf() {
    dnf install -y \
        @development-tools pkgconf-pkg-config curl wget git ca-certificates \
        python3 unzip xz clang cmake ninja-build \
        openssl-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel \
        libX11-devel libXcursor-devel libXrandr-devel libXinerama-devel \
        libXi-devel mesa-libGL-devel libxkbcommon-devel wayland-devel \
        rpm-build dpkg zstd \
        nodejs npm || true
}

case "$PKG" in
    apt) install_apt ;;
    dnf|yum) install_dnf ;;
    *)
        err "Unsupported package manager '$PKG'. Install build deps manually."
        exit 2
        ;;
esac

# ---------------------------------------------------------------------------
# 1b) BetterDesk-Client Flutter SDK and vcpkg
# ---------------------------------------------------------------------------

install_flutter() {
    local archive="flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"
    local url="https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/${archive}"
    local tmp
    if [ -x "$FLUTTER_ROOT/bin/flutter" ]; then
        log "Flutter OK: $("$FLUTTER_ROOT/bin/flutter" --version | head -1)"
        return 0
    fi
    if [ -e "$FLUTTER_ROOT" ]; then
        err "Flutter path exists but is incomplete: $FLUTTER_ROOT"
        err "Move it aside manually and rerun the installer."
        exit 4
    fi
    tmp="$(mktemp -d)"
    curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$tmp/$archive"
    curl --proto '=https' --tlsv1.2 -fsSL "${url}.sha256" -o "$tmp/${archive}.sha256"
    (cd "$tmp" && sha256sum -c "${archive}.sha256")
    mkdir -p "$(dirname "$FLUTTER_ROOT")"
    tar -xJf "$tmp/$archive" -C "$(dirname "$FLUTTER_ROOT")"
    if [ "$FLUTTER_ROOT" != "$(dirname "$FLUTTER_ROOT")/flutter" ]; then
        mv "$(dirname "$FLUTTER_ROOT")/flutter" "$FLUTTER_ROOT"
    fi
    chown -R "$BUILD_USER:$BUILD_USER" "$FLUTTER_ROOT"
    rm -rf "$tmp"
    log "Flutter installed: $("$FLUTTER_ROOT/bin/flutter" --version | head -1)"
}

install_vcpkg() {
    if [ -x "$VCPKG_ROOT_DIR/vcpkg" ]; then
        log "vcpkg OK: $("$VCPKG_ROOT_DIR/vcpkg" version | head -1)"
        return 0
    fi
    if [ -e "$VCPKG_ROOT_DIR" ]; then
        err "vcpkg path exists but is incomplete: $VCPKG_ROOT_DIR"
        err "Move it aside manually and rerun the installer."
        exit 4
    fi
    git clone --filter=blob:none https://github.com/microsoft/vcpkg.git "$VCPKG_ROOT_DIR"
    git -C "$VCPKG_ROOT_DIR" fetch --depth 1 origin "$VCPKG_COMMIT_ID"
    git -C "$VCPKG_ROOT_DIR" checkout --detach "$VCPKG_COMMIT_ID"
    "$VCPKG_ROOT_DIR/bootstrap-vcpkg.sh" -disableMetrics
    chown -R "$BUILD_USER:$BUILD_USER" "$VCPKG_ROOT_DIR"
    log "vcpkg installed at $VCPKG_ROOT_DIR"
}

install_flutter
install_vcpkg

# ---------------------------------------------------------------------------
# 2) Rust toolchain (as BUILD_USER, not root)
# ---------------------------------------------------------------------------

install_rust() {
    if sudo -u "$BUILD_USER" -H bash -lc "command -v cargo" >/dev/null 2>&1; then
        log "Rust already present for $BUILD_USER — updating"
        sudo -u "$BUILD_USER" -H bash -lc "rustup update stable"
    else
        log "Installing rustup + stable toolchain for $BUILD_USER"
        sudo -u "$BUILD_USER" -H bash -lc \
            "export RUSTUP_HOME='$RUSTUP_HOME_DIR' CARGO_HOME='$CARGO_HOME_DIR'; \
             curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
             sh -s -- -y --default-toolchain stable --profile minimal"
    fi
    # Ensure cargo/rustup are on PATH for future shells
    if ! grep -q 'cargo/env' "$BUILD_HOME/.bashrc" 2>/dev/null; then
        echo 'source "$HOME/.cargo/env"' >> "$BUILD_HOME/.bashrc"
        chown "$BUILD_USER:$BUILD_USER" "$BUILD_HOME/.bashrc"
    fi
}

install_rust

# Cargo helpers
sudo -u "$BUILD_USER" -H bash -lc "
    source \"\$HOME/.cargo/env\"
    rustup target add x86_64-unknown-linux-gnu
"

# ---------------------------------------------------------------------------
# 5) Build cache directory (owned by BUILD_USER, isolated from $HOME)
# ---------------------------------------------------------------------------

mkdir -p "$BUILD_CACHE_DIR"
chown -R "$BUILD_USER:$BUILD_USER" "$BUILD_CACHE_DIR"
log "Build cache: $BUILD_CACHE_DIR  ($(df -h "$BUILD_CACHE_DIR" | awk 'NR==2 {print $4 " free"}'))"

# ---------------------------------------------------------------------------
# 6) Persist build env for systemd / Node worker
# ---------------------------------------------------------------------------

ENV_FILE="/etc/betterdesk/build.env"
mkdir -p "$(dirname "$ENV_FILE")"
cat > "$ENV_FILE" <<EOF
# Generated by install-build-toolchain.sh — used by the embedded Support builder
BUILD_USER=$BUILD_USER
BUILD_HOME=$BUILD_HOME
CARGO_HOME=$CARGO_HOME_DIR
RUSTUP_HOME=$RUSTUP_HOME_DIR
CARGO_TARGET_DIR=$BUILD_CACHE_DIR
FLUTTER_ROOT=$FLUTTER_ROOT
VCPKG_ROOT=$VCPKG_ROOT_DIR
PUB_CACHE=$PUB_CACHE_DIR
BETTERDESK_CLIENT_CARGO=$CARGO_HOME_DIR/bin/cargo
BETTERDESK_CLIENT_FLUTTER=$FLUTTER_ROOT/bin/flutter
PATH=$FLUTTER_ROOT/bin:$CARGO_HOME_DIR/bin:/usr/local/bin:/usr/bin:/bin
EOF
chmod 644 "$ENV_FILE"
log "Wrote $ENV_FILE"

# ---------------------------------------------------------------------------
# 7) Summary
# ---------------------------------------------------------------------------

log "Verifying installed tools…"
sudo -u "$BUILD_USER" -H bash -lc "
    source \"\$HOME/.cargo/env\" 2>/dev/null || true
    export PATH='$FLUTTER_ROOT/bin:$CARGO_HOME_DIR/bin:/usr/local/bin:/usr/bin:/bin'
    export VCPKG_ROOT='$VCPKG_ROOT_DIR'
    for c in cargo rustc flutter dart dpkg-deb rpmbuild zstd; do
        if command -v \$c >/dev/null 2>&1; then
            v=\$(\$c --version 2>/dev/null | head -1 || echo '?')
            printf '  \e[32mOK\e[0m   %-26s %s\n' \"\$c\" \"\$v\"
        else
            printf '  \e[31mMISS\e[0m %s\n' \"\$c\"
        fi
    done
"

log "Done. Console service (betterdesk-console) should be restarted so the"
log "Node worker picks up the new \$PATH from $ENV_FILE."
