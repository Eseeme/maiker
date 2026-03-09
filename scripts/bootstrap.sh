#!/usr/bin/env bash
# mAIker — One-command installer
# Run this once to install mAIker globally on your machine.
# Usage: ./scripts/bootstrap.sh

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;37m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "  ${CYAN}${BOLD}mAIker Installer${RESET}"
echo -e "  ${CYAN}────────────────${RESET}"
echo ""

# ── Check Node ──────────────────────────────────────────────────────────────
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")

if [[ "$NODE_VERSION" == "not found" ]]; then
  echo -e "  ${RED}✗${RESET} Node.js not found. Install Node.js v20+ from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo -e "  ${RED}✗${RESET} Node.js ${NODE_VERSION} is too old. mAIker needs v20+"
  exit 1
fi

echo -e "  ${GREEN}✓${RESET} Node.js ${NODE_VERSION}"
echo -e "  ${GREEN}✓${RESET} npm $(npm --version)"

# ── Install ─────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}Step 1/3${RESET} — Installing dependencies..."
npm install --loglevel=warn

echo ""
echo -e "  ${BOLD}Step 2/3${RESET} — Building TypeScript..."
npm run build

echo ""
echo -e "  ${BOLD}Step 3/3${RESET} — Linking maiker CLI globally..."
npm link 2>/dev/null || {
  echo -e "  ${YELLOW}⚠${RESET} npm link failed (may need sudo). Trying with sudo..."
  sudo npm link
}

# ── Verify ──────────────────────────────────────────────────────────────────
echo ""
if command -v maiker &> /dev/null; then
  echo -e "  ${GREEN}${BOLD}✓ maiker installed successfully!${RESET}"
else
  echo -e "  ${YELLOW}⚠${RESET} maiker command not found in PATH. You may need to restart your terminal."
fi

# ── Setup .env ──────────────────────────────────────────────────────────────
echo ""
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo -e "  ${YELLOW}⚠${RESET} Created .env from .env.example — add your API keys"
  else
    echo -e "  ${YELLOW}⚠${RESET} No .env file. Create one with: ANTHROPIC_API_KEY=sk-ant-..."
  fi
else
  echo -e "  ${GREEN}✓${RESET} .env file exists"
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}${BOLD}Installation complete.${RESET}"
echo ""
echo -e "  ${GRAY}Now go to your project and run:${RESET}"
echo -e "    ${CYAN}cd /path/to/your-project${RESET}"
echo -e "    ${CYAN}maiker init${RESET}       ${GRAY}# interactive setup: picks models based on your API keys${RESET}"
echo -e "    ${CYAN}maiker run . --goal \"your goal\"${RESET}"
echo ""
