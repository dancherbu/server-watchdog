#!/usr/bin/env bash
# server-watchdog installer
# Usage: curl -fsSL https://raw.githubusercontent.com/dancherbu/server-watchdog/main/install.sh | bash
#
# Options (set as env vars before piping):
#   WATCHDOG_DIR   — install directory (default: ~/.server-watchdog)
#   WATCHDOG_REF   — git branch/tag to install (default: main)

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────
REPO="https://github.com/dancherbu/server-watchdog.git"
INSTALL_DIR="${WATCHDOG_DIR:-$HOME/.server-watchdog}"
REF="${WATCHDOG_REF:-main}"
VENV_DIR="$INSTALL_DIR/ai_fix_agent/.venv"

# ── Colours ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[watchdog]${NC} $*"; }
success() { echo -e "${GREEN}✅${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠️ ${NC} $*"; }
error()   { echo -e "${RED}❌${NC} $*"; exit 1; }

echo -e ""
echo -e "${BOLD}╔═══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║      server-watchdog  installer       ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════╝${NC}"
echo -e ""

# ── Prerequisites ─────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v git   >/dev/null 2>&1 || error "git is required but not installed."
command -v node  >/dev/null 2>&1 || error "Node.js >=16 is required but not installed."
command -v python3 >/dev/null 2>&1 || error "Python 3 is required but not installed."

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[[ "$NODE_MAJOR" -ge 16 ]] || error "Node.js >=16 required. Found: $(node --version)"

success "Prerequisites OK (node $(node --version), python3 $(python3 --version | cut -d' ' -f2))"

# ── Clone or update ───────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing install at $INSTALL_DIR ..."
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" checkout "$REF"
  git -C "$INSTALL_DIR" pull --ff-only origin "$REF"
  success "Updated to latest ($REF)"
else
  info "Installing to $INSTALL_DIR ..."
  git clone --branch "$REF" --depth 1 "$REPO" "$INSTALL_DIR"
  success "Cloned server-watchdog ($REF)"
fi

# ── Python venv ───────────────────────────────────────────────────────
info "Setting up Python virtual environment..."

if ! python3 -m venv --help >/dev/null 2>&1; then
  warn "python3-venv not available. Trying --break-system-packages fallback..."
  python3 -m pip install --break-system-packages \
    google-antigravity python-dotenv 2>&1 | grep -E "Successfully|already" || true
else
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/pip" install --quiet \
    google-antigravity python-dotenv
  success "Python venv ready at $VENV_DIR"
fi

# ── .env.watchdog ─────────────────────────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env.watchdog"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$INSTALL_DIR/.env.watchdog.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  success ".env.watchdog created (chmod 600)"
else
  warn ".env.watchdog already exists — skipping (not overwritten)"
fi

# ── SSH → GitHub check ────────────────────────────────────────────────
info "Checking GitHub SSH authentication..."
if ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
  success "GitHub SSH: authenticated"
else
  warn "GitHub SSH not configured. The watchdog needs to push fix branches."
  echo ""
  echo "  To fix: add this server's public key to GitHub → Settings → SSH keys"
  echo "  Your public key:"
  cat ~/.ssh/id_*.pub 2>/dev/null || echo "  (no SSH key found — run: ssh-keygen -t ed25519)"
  echo ""
fi

# ── PM2 registration (optional) ──────────────────────────────────────
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe server-watchdog >/dev/null 2>&1; then
    warn "PM2 process 'server-watchdog' already registered — skipping"
  else
    pm2 start "$INSTALL_DIR/watchdog.js" \
      --name server-watchdog \
      --restart-delay 5000 \
      --max-restarts 10 \
      --log "$INSTALL_DIR/logs/watchdog.log" \
      --time
    pm2 save
    success "Registered as PM2 process 'server-watchdog'"
  fi
else
  warn "PM2 not found. Start manually: node $INSTALL_DIR/watchdog.js"
fi

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Installation complete!${NC}"
echo ""
echo -e "  Next steps:"
echo -e "  ${BOLD}1.${NC} Edit your config:  ${BLUE}$ENV_FILE${NC}"
echo -e "  ${BOLD}2.${NC} Minimum required fields:"
echo -e "       WATCHDOG_PROJECT_ROOT=/var/www/myapp"
echo -e "       WATCHDOG_LOG_PATH=/var/www/myapp/logs/error.log"
echo -e "       WATCHDOG_HEALTH_URL=https://myapp.com/api/health"
echo -e "       GEMINI_API_KEY=your_key_here"
echo -e "       WATCHDOG_RESTART_MODE=pm2"
echo -e "       WATCHDOG_PM2_APP_NAME=server-myapp"
echo -e "  ${BOLD}3.${NC} Start: ${BLUE}pm2 restart server-watchdog${NC}"
echo ""
echo -e "  Docs: https://github.com/dancherbu/server-watchdog"
echo ""
