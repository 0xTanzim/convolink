#!/bin/sh
# install.sh — Universal POSIX installer for ConvoLink CLI
# Usage: curl -fsSL https://raw.githubusercontent.com/AgentConversation/convolink/main/scripts/install.sh | sh
set -e

# TTY Formatting
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  BLUE="\033[34m"
  YELLOW="\033[33m"
  RED="\033[31m"
  RESET="\033[0m"
else
  BOLD=""
  GREEN=""
  BLUE=""
  YELLOW=""
  RED=""
  RESET=""
fi

log_info() {
  printf "${BLUE}ℹ${RESET} %s\n" "$1"
}

log_success() {
  printf "${GREEN}✓${RESET} %s\n" "$1"
}

log_warn() {
  printf "${YELLOW}⚠${RESET} %s\n" "$1"
}

log_error() {
  printf "${RED}✗${RESET} %s\n" "$1" >&2
}

printf "${BOLD}ConvoLink Universal Runtime Installer${RESET}\n\n"

# 1. OS & Virtualization Detection
OS="$(uname -s)"
case "$OS" in
  Linux*)
    PLATFORM="linux"
    if [ -f /proc/version ] && grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
      VIRT="wsl2"
    else
      VIRT="native"
    fi
    ;;
  Darwin*)
    PLATFORM="darwin"
    VIRT="native"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    PLATFORM="win32"
    VIRT="native"
    ;;
  *)
    log_error "Unsupported operating system: $OS"
    exit 1
    ;;
esac

# 2. CPU Architecture Detection
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)
    CPU="x86_64"
    ;;
  aarch64|arm64)
    CPU="arm64"
    ;;
  *)
    log_error "Unsupported CPU architecture: $ARCH"
    exit 1
    ;;
esac

# 3. Libc Resolution (Linux only)
LIBC=""
if [ "$PLATFORM" = "linux" ]; then
  if [ -f /etc/alpine-release ]; then
    LIBC="musl"
  elif command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
    LIBC="musl"
  else
    LIBC="glibc"
  fi
fi

log_info "Detected environment: $PLATFORM ($CPU${LIBC:+, $LIBC})${VIRT:+ [$VIRT]}"

# 4. Target Installation Directories
INSTALL_DIR="${CONVOLINK_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$INSTALL_DIR"

WRAPPER_PATH="$INSTALL_DIR/convo"

# 5. Resolve Runtime Engine (Bun preferred, Node fallback)
RUNNER=""
if command -v bun >/dev/null 2>&1; then
  RUNNER="bun"
elif command -v node >/dev/null 2>&1; then
  RUNNER="node"
fi

if [ -z "$RUNNER" ]; then
  log_warn "Neither Bun nor Node.js was found in PATH."
  log_info "Installing Bun runtime recommended: curl -fsSL https://bun.sh/install | bash"
fi

log_info "Generating executable wrapper at $WRAPPER_PATH..."

cat << 'EOF' > "$WRAPPER_PATH"
#!/bin/sh
if command -v bun >/dev/null 2>&1; then
  exec bunx -y convolink@latest "$@"
elif command -v npx >/dev/null 2>&1; then
  exec npx -y convolink@latest "$@"
else
  echo "Error: ConvoLink requires either Bun (https://bun.sh) or Node.js to execute." >&2
  exit 1
fi
EOF

chmod +x "$WRAPPER_PATH"
log_success "ConvoLink executable wrapper created successfully."

# 6. PATH Verification and Shell Profile Advice
case ":$PATH:" in
  *:"$INSTALL_DIR":*)
    log_success "$INSTALL_DIR is already present in your PATH."
    ;;
  *)
    log_warn "$INSTALL_DIR is not in your system PATH."
    CURRENT_SHELL="$(basename "${SHELL:-sh}")"
    RC_FILE=""
    case "$CURRENT_SHELL" in
      bash)
        RC_FILE="$HOME/.bashrc"
        ;;
      zsh)
        RC_FILE="$HOME/.zshrc"
        ;;
      fish)
        RC_FILE="$HOME/.config/fish/config.fish"
        ;;
    esac

    if [ -n "$RC_FILE" ] && [ -f "$RC_FILE" ]; then
      printf "\nTo make 'convo' accessible globally, add this to %s:\n" "$RC_FILE"
      printf "${BOLD}export PATH=\"%s:\$PATH\"${RESET}\n\n" "$INSTALL_DIR"
    else
      printf "\nAdd the installation directory to your PATH:\n"
      printf "${BOLD}export PATH=\"%s:\$PATH\"${RESET}\n\n" "$INSTALL_DIR"
    fi
    ;;
esac

log_success "Installation complete! Run 'convo doctor' to test your environment."
