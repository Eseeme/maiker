#!/usr/bin/env bash
# mAIker — One-command installer
# Usage: sudo ./scripts/bootstrap.sh
#
# Installs dependencies, builds, links globally, detects auth.
# Must run with sudo so npm link works without prompts.

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;37m'
BOLD='\033[1m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REAL_USER="${SUDO_USER:-$(whoami)}"

echo ""
echo -e "  ${CYAN}${BOLD}mAIker Installer${RESET}"
echo -e "  ${CYAN}────────────────${RESET}"
echo ""

# ── Check sudo ──────────────────────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
  echo -e "  ${RED}✗${RESET} Please run with sudo:"
  echo -e "    ${CYAN}sudo ./scripts/bootstrap.sh${RESET}"
  exit 1
fi

echo -e "  ${GREEN}✓${RESET} Running as root (files will be owned by ${BOLD}${REAL_USER}${RESET})"

# ── Check Node ──────────────────────────────────────────────────────────────
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")

if [[ "$NODE_VERSION" == "not found" ]]; then
  echo -e "  ${RED}✗${RESET} Node.js not found. Install Node.js v18+ from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo -e "  ${RED}✗${RESET} Node.js ${NODE_VERSION} is too old. mAIker needs v18+"
  exit 1
fi

echo -e "  ${GREEN}✓${RESET} Node.js ${NODE_VERSION}"
echo -e "  ${GREEN}✓${RESET} npm $(npm --version)"

# ── Fix existing dist permissions before build ──────────────────────────────
if [ -d "$PROJECT_DIR/dist" ]; then
  chown -R "$REAL_USER" "$PROJECT_DIR/dist" 2>/dev/null || true
fi
if [ -d "$PROJECT_DIR/node_modules" ]; then
  chown -R "$REAL_USER" "$PROJECT_DIR/node_modules" 2>/dev/null || true
fi

# ── Install ─────────────────────────────────────────────────────────────────
cd "$PROJECT_DIR"

echo ""
echo -e "  ${BOLD}Step 1/4${RESET} — Installing dependencies..."
sudo -u "$REAL_USER" npm install --loglevel=warn

echo ""
echo -e "  ${BOLD}Step 2/4${RESET} — Building TypeScript..."
sudo -u "$REAL_USER" npm run build

echo ""
echo -e "  ${BOLD}Step 3/4${RESET} — Linking maiker CLI globally..."
npm link
chmod +x "$PROJECT_DIR/dist/bin/maiker.js"
# Ensure the global symlink and all linked files are accessible
GLOBAL_BIN=$(npm bin -g 2>/dev/null || echo "/usr/local/bin")
if [ -f "$GLOBAL_BIN/maiker" ] || [ -L "$GLOBAL_BIN/maiker" ]; then
  chmod +x "$GLOBAL_BIN/maiker"
fi
GLOBAL_MODULES=$(npm root -g 2>/dev/null || echo "/usr/local/lib/node_modules")
if [ -d "$GLOBAL_MODULES/maiker-cli" ]; then
  chmod -R a+rX "$GLOBAL_MODULES/maiker-cli"
fi

# ── Verify CLI ──────────────────────────────────────────────────────────────
echo ""
if command -v maiker &> /dev/null; then
  echo -e "  ${GREEN}${BOLD}✓ maiker installed globally${RESET}"
  echo -e "    ${GRAY}$(which maiker)${RESET}"
else
  echo -e "  ${YELLOW}⚠${RESET} maiker not found in PATH — restart your terminal"
fi

# ── Auth detection ──────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Step 4/4${RESET} — Detecting authentication..."

AUTH_FOUND=false

# Claude Code OAuth (auto-detected at runtime — no .env needed)
# macOS: stored in Keychain; Linux: stored in ~/.claude/.credentials.json
if [[ "$(uname)" == "Darwin" ]]; then
  # macOS — try Keychain
  KEYCHAIN_DATA=$(sudo -u "$REAL_USER" security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || echo "")
  if [[ -n "$KEYCHAIN_DATA" ]]; then
    HAS_OAUTH=$(echo "$KEYCHAIN_DATA" | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  t = d.get('claudeAiOauth', {}).get('accessToken', '')
  print('yes' if t else 'no')
except: print('no')
" 2>/dev/null || echo "no")
    if [[ "$HAS_OAUTH" == "yes" ]]; then
      echo -e "  ${GREEN}✓${RESET} Claude Code OAuth detected (macOS Keychain)"
      AUTH_FOUND=true
    fi
  fi
fi

if [[ "$AUTH_FOUND" == "false" ]]; then
  # Linux / fallback — try credentials file
  CLAUDE_CREDS_HOME=$(eval echo "~$REAL_USER")
  CLAUDE_CREDS="$CLAUDE_CREDS_HOME/.claude/.credentials.json"
  if [ -f "$CLAUDE_CREDS" ]; then
    HAS_OAUTH=$(python3 -c "
import json
try:
  d = json.load(open('$CLAUDE_CREDS'))
  t = d.get('claudeAiOauth', {}).get('accessToken', '')
  print('yes' if t else 'no')
except: print('no')
" 2>/dev/null || echo "no")
    if [[ "$HAS_OAUTH" == "yes" ]]; then
      echo -e "  ${GREEN}✓${RESET} Claude Code OAuth detected (credentials file)"
      AUTH_FOUND=true
    fi
  fi
fi

# Check .env for explicit keys
if [ -f "$PROJECT_DIR/.env" ]; then
  while IFS='=' read -r key _; do
    case "$key" in
      ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY)
        echo -e "  ${GREEN}✓${RESET} ${key} found in .env"
        AUTH_FOUND=true
        ;;
    esac
  done < "$PROJECT_DIR/.env"
fi

if [[ "$AUTH_FOUND" == "false" ]]; then
  echo ""
  echo -e "  ${YELLOW}⚠ No API keys detected.${RESET}"
  echo ""
  echo -e "    ${GRAY}Option A:${RESET} ${CYAN}claude auth login${RESET}  ${GRAY}(easiest — mAIker auto-detects the token)${RESET}"
  echo -e "    ${GRAY}Option B:${RESET} Add keys to .env   ${GRAY}(ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY)${RESET}"
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}Installation complete.${RESET}"
echo ""
echo -e "  ${GRAY}Quick start:${RESET}"
echo -e "    ${CYAN}cd /path/to/your-project${RESET}"
echo -e "    ${CYAN}maiker init${RESET}                          ${GRAY}# picks best models per your API keys${RESET}"
echo -e "    ${CYAN}maiker run . --goal \"your goal\"${RESET}       ${GRAY}# run the full workflow${RESET}"
echo ""
