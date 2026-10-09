#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
UUID="sylepsign@alecromano.com"
ACTION="${1:---install}"

EXT_INSTALL_DIR="/usr/local/share/gnome-shell/extensions/${UUID}"
SCHEMA_DIR="/usr/share/glib-2.0/schemas"
BIN_DIR="/usr/local/bin"
DBUS_POLICY_DIR="/usr/share/dbus-1/system.d"
SYSTEMD_DIR="/etc/systemd/system"
POOL_DIR="/var/lib/signage-pool"
CACHE_DIR="/var/cache/signage-videos"
SHARE_DIR="/usr/local/share/sylepsign"
DAEMON_SHARE_DIR="${SHARE_DIR}/daemon"
POLKIT_DIR="/usr/share/polkit-1/actions"

CLEANUP_TEMP_DIR=""
cleanup() {
    if [ -n "${CLEANUP_TEMP_DIR:-}" ] && [ -d "${CLEANUP_TEMP_DIR}" ]; then
        rm -rf "${CLEANUP_TEMP_DIR}"
    fi
}
trap cleanup EXIT

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        if [ -n "${SCRIPT_DIR}" ]; then
            echo "Root privileges required. Re-running with sudo..."
            exec sudo bash "${SCRIPT_DIR}/install.sh" "$@"
        else
            echo "Root privileges required. Please re-run with sudo." >&2
            exit 1
        fi
    fi
}

detect_distro() {
    local id="" id_like=""
    [ -f /etc/os-release ] && . /etc/os-release
    id="${ID:-}"
    id_like="${ID_LIKE:-}"
    case "${id}:${id_like}" in
        *debian*|*ubuntu*|*pop*|*mint*) echo "debian" ;;
        *fedora*|*rhel*|*centos*|*rocky*|*alma*) echo "fedora" ;;
        *arch*|*manjaro*) echo "arch" ;;
        *suse*) echo "suse" ;;
        *)
            if command -v apt-get >/dev/null 2>&1; then echo "debian"
            elif command -v dnf >/dev/null 2>&1; then echo "fedora"
            elif command -v pacman >/dev/null 2>&1; then echo "arch"
            elif command -v zypper >/dev/null 2>&1; then echo "suse"
            else echo "unknown"; fi
            ;;
    esac
}

install_dependencies() {
    local distro
    distro=$(detect_distro)
    echo "Detected platform: ${distro}"
    case "${distro}" in
        debian)
            export DEBIAN_FRONTEND=noninteractive
            apt-get update -qq || true
            apt-get install -y --no-install-recommends mpv avahi-daemon avahi-utils gjs libglib2.0-bin curl git jq gettext
            apt-get install -y --no-install-recommends gnome-shell-extension-manager 2>/dev/null || true
            ;;
        fedora)
            dnf install -y --setopt=install_weak_deps=False mpv avahi avahi-tools gjs glib2 curl git jq gettext
            dnf install -y --setopt=install_weak_deps=False gnome-shell-extension-manager 2>/dev/null || true
            ;;
        arch)
            pacman -Sy --noconfirm --needed mpv avahi gjs glib2 curl git jq gettext
            pacman -S --noconfirm --needed gnome-shell-extension-manager 2>/dev/null || true
            ;;
        suse)
            zypper --non-interactive install --no-recommends mpv avahi gjs glib2-tools curl git jq gettext-tools
            zypper --non-interactive install --no-recommends gnome-shell-extension-manager 2>/dev/null || true
            ;;
        *)
            echo "Warning: Unrecognized package manager. Ensure dependencies are installed." >&2
            ;;
    esac
    systemctl enable --now avahi-daemon 2>/dev/null || true
}

bootstrap_source() {
    if [ -z "${SCRIPT_DIR}" ] || [ ! -d "${SCRIPT_DIR}/daemon" ] || [ ! -d "${SCRIPT_DIR}/ext" ]; then
        echo "Sylepsign source files not found locally. Fetching repository from GitHub..."
        CLEANUP_TEMP_DIR="$(mktemp -d -t sylepsign-src-XXXXXX)"
        git clone --depth 1 https://github.com/alecdromano/sylepsign.git "${CLEANUP_TEMP_DIR}"
        SCRIPT_DIR="${CLEANUP_TEMP_DIR}"
    elif [ "${ACTION}" = "--update" ] && [ -d "${SCRIPT_DIR}/.git" ]; then
        echo "Updating local repository..."
        git -C "${SCRIPT_DIR}" pull --ff-only 2>/dev/null || true
    fi
}

setup_directories() {
    mkdir -p "${POOL_DIR}" "${CACHE_DIR}" "${DAEMON_SHARE_DIR}" "${EXT_INSTALL_DIR}" "${SHARE_DIR}/branding"
    chmod 0777 "${POOL_DIR}" "${CACHE_DIR}"
    chmod 0755 "${SHARE_DIR}/branding"
    if [ -d "${SCRIPT_DIR}/samples" ] && [ -z "$(ls -A "${POOL_DIR}" 2>/dev/null)" ]; then
        echo "Seeding sample videos into ${POOL_DIR}..."
        cp "${SCRIPT_DIR}/samples/"*.mp4 "${POOL_DIR}/" 2>/dev/null || true
        chmod 0666 "${POOL_DIR}"/* 2>/dev/null || true
    fi
}

install_daemon() {
    echo "Installing Sylepsign daemon..."
    cp -r "${SCRIPT_DIR}/daemon/"*.js "${DAEMON_SHARE_DIR}/"
    cat << 'EOF' > "${BIN_DIR}/sylepsign-daemon"
#!/usr/bin/env bash
exec /usr/bin/gjs -m /usr/local/share/sylepsign/daemon/daemon.js "$@"
EOF
    chmod +x "${BIN_DIR}/sylepsign-daemon"
    cp "${SCRIPT_DIR}/systemd/org.sylepsign.conf" "${DBUS_POLICY_DIR}/org.sylepsign.conf"
    cp "${SCRIPT_DIR}/systemd/sylepsign.service" "${SYSTEMD_DIR}/sylepsign.service"
    systemctl daemon-reload
    systemctl reload dbus 2>/dev/null || true
    systemctl enable sylepsign.service
    systemctl restart sylepsign.service
}

install_cli() {
    echo "Installing Sylepsign CLI and helpers..."
    cp "${SCRIPT_DIR}/bin/sylepsign" "${BIN_DIR}/sylepsign"
    chmod +x "${BIN_DIR}/sylepsign"
    cp "${SCRIPT_DIR}/bin/session" "${SHARE_DIR}/session"
    chmod 0755 "${SHARE_DIR}/session"
    cp "${SCRIPT_DIR}/bin/helper" "${SHARE_DIR}/helper"
    chmod 0755 "${SHARE_DIR}/helper"
    if [ -f "${SCRIPT_DIR}/data/policy" ]; then
        cp "${SCRIPT_DIR}/data/policy" "${POLKIT_DIR}/org.sylepsign.policy"
        chmod 0644 "${POLKIT_DIR}/org.sylepsign.policy"
    fi
}

install_extension() {
    echo "Installing GNOME Shell extension..."
    [ -x "${SCRIPT_DIR}/bin/locale" ] && "${SCRIPT_DIR}/bin/locale" || true
    rm -rf "${EXT_INSTALL_DIR}"
    mkdir -p "${EXT_INSTALL_DIR}"
    cp -r "${SCRIPT_DIR}/ext/"* "${EXT_INSTALL_DIR}/"
    cp "${SCRIPT_DIR}/schemas/org.gnome.shell.extensions.sylepsign.gschema.xml" "${SCHEMA_DIR}/"
    glib-compile-schemas "${SCHEMA_DIR}"
}

load_session_helper() {
    local helper="${SHARE_DIR}/session"
    [ ! -f "${helper}" ] && helper="${SCRIPT_DIR}/bin/session"
    # shellcheck source=/dev/null
    source "${helper}"
}

uninstall() {
    echo "Uninstalling Sylepsign..."
    load_session_helper
    stop_players
    manage_sessions disable
    if command -v systemctl >/dev/null 2>&1; then
        systemctl disable --now sylepsign.service 2>/dev/null || true
        systemctl stop sylepsign.service 2>/dev/null || true
    fi
    pkill -9 -f "sylepsign-daemon" 2>/dev/null || true
    pkill -9 -f "daemon/daemon.js" 2>/dev/null || true
    rm -f "${SYSTEMD_DIR}/sylepsign.service" "${DBUS_POLICY_DIR}/org.sylepsign.conf" \
          "${SCHEMA_DIR}/org.gnome.shell.extensions.sylepsign.gschema.xml" \
          /etc/dconf/db/gdm.d/10-sylepsign /etc/dconf/db/local.d/10-sylepsign \
          "${POLKIT_DIR}/org.sylepsign.policy" "${BIN_DIR}/sylepsign-daemon" "${BIN_DIR}/sylepsign"
    rm -rf "${SHARE_DIR}" "${EXT_INSTALL_DIR}" /etc/signage "${POOL_DIR}" "${CACHE_DIR}"
    dconf update 2>/dev/null || true
    glib-compile-schemas "${SCHEMA_DIR}" 2>/dev/null || true
    systemctl reload dbus 2>/dev/null || true
    systemctl daemon-reload
    refresh_gdm
    stop_players
    echo "Sylepsign uninstalled."
}

require_root

case "${ACTION}" in
    --uninstall)
        uninstall
        ;;
    --install|--update)
        install_dependencies
        bootstrap_source
        setup_directories
        install_extension
        install_cli
        install_daemon
        load_session_helper
        manage_dconf enable
        manage_sessions enable
        echo "=== Sylepsign Installation Complete ==="
        echo "CLI available at: /usr/local/bin/sylepsign"
        ;;
    *)
        echo "Usage: $0 [--install|--update|--uninstall]"
        exit 1
        ;;
esac
