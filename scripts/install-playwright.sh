#!/usr/bin/env bash
# mAIker Playwright Installer
# Installs Playwright and its browser dependencies

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

echo ""
echo -e "  ${CYAN}mAIker Playwright Setup${RESET}"
echo -e "  ${CYAN}───────────────────────${RESET}"
echo ""

# Check if @playwright/test is installed
if ! npx playwright --version &> /dev/null 2>&1; then
  echo -e "  Installing @playwright/test..."
  npm install --save-dev @playwright/test
  echo -e "  ${GREEN}✓${RESET} @playwright/test installed"
else
  echo -e "  ${GREEN}✓${RESET} Playwright already installed ($(npx playwright --version))"
fi

# Install browser binaries
echo ""
echo -e "  Installing Playwright browser binaries..."
echo -e "  ${YELLOW}⚠${RESET} This may take several minutes on first install"
echo ""

npx playwright install --with-deps chromium

echo ""
echo -e "  ${GREEN}✓${RESET} Playwright installed with Chromium"
echo ""
echo -e "  To install additional browsers:"
echo -e "  ${CYAN}npx playwright install firefox${RESET}"
echo -e "  ${CYAN}npx playwright install webkit${RESET}"
echo ""

# Verify installation
echo -e "  Verifying Playwright..."
npx playwright --version
echo -e "  ${GREEN}✓${RESET} Playwright ready"
echo ""
