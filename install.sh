#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║           PoleBrowse Installer — Cross Platform          ║
# ║                    by RidelL                             ║
# ╚══════════════════════════════════════════════════════════╝

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

REPO_URL="https://github.com/RidelLazor/polebrowse"
APP_NAME="PoleBrowse"
APP_VERSION="1.0.0"
INSTALL_DIR="$HOME/.local/share/polebrowse"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"

print_banner() {
  echo -e "${CYAN}"
  echo "  ██████╗  ██████╗ ██╗     ███████╗"
  echo "  ██╔══██╗██╔═══██╗██║     ██╔════╝"
  echo "  ██████╔╝██║   ██║██║     █████╗  "
  echo "  ██╔═══╝ ██║   ██║██║     ██╔══╝  "
  echo "  ██║     ╚██████╔╝███████╗███████╗"
  echo "  ╚═╝      ╚═════╝ ╚══════╝╚══════╝"
  echo -e "${BOLD}${WHITE}         B R O W S E${NC}"
  echo -e "${CYAN}         by RidelL — v${APP_VERSION}${NC}"
  echo ""
}

log()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()   { echo -e "${YELLOW}[!]${NC} $1"; }
error()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info()   { echo -e "${BLUE}[→]${NC} $1"; }
step()   { echo -e "\n${BOLD}${CYAN}━━ $1 ━━${NC}"; }

detect_os() {
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    if command -v pacman &>/dev/null; then
      DISTRO="arch"
    elif command -v apt-get &>/dev/null; then
      DISTRO="debian"
    elif command -v dnf &>/dev/null; then
      DISTRO="fedora"
    elif command -v zypper &>/dev/null; then
      DISTRO="opensuse"
    elif command -v emerge &>/dev/null; then
      DISTRO="gentoo"
    elif command -v apk &>/dev/null; then
      DISTRO="alpine"
    else
      DISTRO="unknown"
    fi
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="mac"
    DISTRO="mac"
  else
    error "Unsupported OS: $OSTYPE"
  fi
  log "Detected: $OS ($DISTRO)"
}

install_deps() {
  step "Installing dependencies"

  # Check Node.js
  if ! command -v node &>/dev/null; then
    info "Installing Node.js..."
    case $DISTRO in
      arch)    sudo pacman -S --noconfirm nodejs npm ;;
      debian)  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs ;;
      fedora)  sudo dnf install -y nodejs npm ;;
      opensuse) sudo zypper install -y nodejs npm ;;
      alpine)  sudo apk add nodejs npm ;;
      mac)     brew install node || error "Install Homebrew first: https://brew.sh" ;;
      *)       error "Please install Node.js 18+ manually: https://nodejs.org" ;;
    esac
  else
    NODE_VER=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VER" -lt 16 ]; then
      warn "Node.js $NODE_VER is too old, need 16+. Please upgrade."
    else
      log "Node.js $(node --version) already installed"
    fi
  fi

  # Check git
  if ! command -v git &>/dev/null; then
    info "Installing git..."
    case $DISTRO in
      arch)    sudo pacman -S --noconfirm git ;;
      debian)  sudo apt-get install -y git ;;
      fedora)  sudo dnf install -y git ;;
      opensuse) sudo zypper install -y git ;;
      alpine)  sudo apk add git ;;
      mac)     xcode-select --install 2>/dev/null || true ;;
    esac
  else
    log "git already installed"
  fi

  # Linux-specific: webkit/gtk for electron
  if [[ "$OS" == "linux" ]]; then
    info "Checking system libraries..."
    case $DISTRO in
      arch)
        sudo pacman -S --noconfirm --needed \
          gtk3 libnotify nss libxss libxtst xdg-utils \
          at-spi2-core libsecret 2>/dev/null || true
        ;;
      debian)
        sudo apt-get install -y \
          libgtk-3-0 libnotify4 libnss3 libxss1 \
          libxtst6 xdg-utils libatspi2.0-0 libsecret-1-0 2>/dev/null || true
        ;;
      fedora)
        sudo dnf install -y \
          gtk3 libnotify nss libXScrnSaver libXtst \
          xdg-utils at-spi2-core libsecret 2>/dev/null || true
        ;;
    esac
  fi
}

install_app() {
  step "Installing PoleBrowse"

  mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR"

  info "Downloading PoleBrowse..."

  # Try to clone from GitHub
  if git clone --depth=1 "$REPO_URL" "$INSTALL_DIR/app" 2>/dev/null; then
    log "Downloaded from GitHub"
  else
    # Fallback: check if we're running from the source dir
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$SCRIPT_DIR/package.json" ]]; then
      info "Using local source..."
      cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/app/" 2>/dev/null || true
      log "Copied local files"
    else
      error "Could not download PoleBrowse. Make sure the repo is public or you're in the source folder."
    fi
  fi

  cd "$INSTALL_DIR/app"

  info "Installing npm packages..."
  npm install --omit=dev 2>/dev/null || npm install

  log "PoleBrowse installed to $INSTALL_DIR"
}

create_launcher() {
  step "Creating launcher"

  # Launcher script
  cat > "$BIN_DIR/polebrowse" << EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR/app"
exec npx electron . "\$@"
EOF
  chmod +x "$BIN_DIR/polebrowse"

  # Desktop entry
  cat > "$DESKTOP_DIR/polebrowse.desktop" << EOF
[Desktop Entry]
Name=PoleBrowse
GenericName=Web Browser
Comment=PoleBrowse Desktop Browser by RidelL
Exec=$BIN_DIR/polebrowse %U
Icon=$INSTALL_DIR/app/src/assets/pb-logo.png
Type=Application
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=PoleBrowse
StartupNotify=true
EOF

  # Update desktop database
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

  # Add bin to PATH if needed
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc" 2>/dev/null || true
    warn "Added $BIN_DIR to PATH. Run: source ~/.bashrc"
  fi

  log "Launcher created at $BIN_DIR/polebrowse"
  log "Desktop entry created"
}

uninstall() {
  step "Uninstalling PoleBrowse"
  rm -rf "$INSTALL_DIR"
  rm -f "$BIN_DIR/polebrowse"
  rm -f "$DESKTOP_DIR/polebrowse.desktop"
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  log "PoleBrowse uninstalled"
  exit 0
}

print_done() {
  echo ""
  echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════╗"
  echo -e "║     PoleBrowse installed! 🎉           ║"
  echo -e "╚═══════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${BOLD}Run:${NC}     polebrowse"
  echo -e "  ${BOLD}Or:${NC}      Find it in your app menu"
  echo -e "  ${BOLD}Remove:${NC}  bash install.sh --uninstall"
  echo ""
}

# ── MAIN ──────────────────────────────────────────────────────────
case "${1:-}" in
  --uninstall|-u) uninstall ;;
  --help|-h)
    echo "Usage: bash install.sh [--uninstall]"
    exit 0
    ;;
esac

print_banner
detect_os
install_deps
install_app
create_launcher
print_done
