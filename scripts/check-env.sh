#!/usr/bin/env bash
# mAIker Environment Checker
# Validates that the environment is correctly set up

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

ERRORS=0
WARNINGS=0

check() {
  local name="$1"
  local condition="$2"
  local message="$3"
  local severity="${4:-error}"

  if eval "$condition"; then
    echo -e "  ${GREEN}✓${RESET} $name"
  else
    if [ "$severity" = "warn" ]; then
      echo -e "  ${YELLOW}⚠${RESET} $name — $message"
      ((WARNINGS++)) || true
    else
      echo -e "  ${RED}✗${RESET} $name — $message"
      ((ERRORS++)) || true
    fi
  fi
}

echo ""
echo -e "  ${CYAN}mAIker Environment Check${RESET}"
echo -e "  ${CYAN}────────────────────────${RESET}"
echo ""

echo -e "  ${CYAN}System${RESET}"
check "Node.js v20+" \
  "node --version 2>/dev/null | grep -qE 'v2[0-9]'" \
  "Node.js v20+ required. Current: $(node --version 2>/dev/null || echo 'not found')"

check "npm" \
  "command -v npm &>/dev/null" \
  "npm not found"

check "git" \
  "command -v git &>/dev/null" \
  "git not found" \
  "warn"

echo ""
echo -e "  ${CYAN}Project Files${RESET}"
check "package.json" \
  "[ -f package.json ]" \
  "package.json not found — run from project root"

check "node_modules" \
  "[ -d node_modules ]" \
  "Dependencies not installed — run: npm install"

check "dist/" \
  "[ -d dist ]" \
  "Project not built — run: npm run build"

check "maiker.config.yaml" \
  "[ -f maiker.config.yaml ]" \
  "Config not found — run: maiker init" \
  "warn"

check ".env" \
  "[ -f .env ]" \
  ".env not found — copy .env.example and add API keys" \
  "warn"

echo ""
echo -e "  ${CYAN}API Keys (.env)${RESET}"

if [ -f .env ]; then
  source .env 2>/dev/null || true

  check "ANTHROPIC_API_KEY" \
    '[ -n "${ANTHROPIC_API_KEY:-}" ]' \
    "Required for code and repair agents" \
    "warn"

  check "OPENAI_API_KEY" \
    '[ -n "${OPENAI_API_KEY:-}" ]' \
    "Required for planner and visual review" \
    "warn"

  check "GOOGLE_API_KEY" \
    '[ -n "${GOOGLE_API_KEY:-}" ]' \
    "Required for research ingestion (Gemini)" \
    "warn"
else
  echo -e "  ${YELLOW}⚠${RESET} .env not found — skipping API key checks"
fi

echo ""
echo -e "  ${CYAN}Optional Tools${RESET}"
check "Playwright" \
  "npx playwright --version &>/dev/null 2>&1" \
  "Not installed — run: ./scripts/install-playwright.sh" \
  "warn"

check "tsx" \
  "npx tsx --version &>/dev/null 2>&1" \
  "Not installed — needed for dev mode" \
  "warn"

echo ""
echo -e "  ${CYAN}maiker CLI${RESET}"
check "maiker binary" \
  "command -v maiker &>/dev/null" \
  "Not linked — run: npm link"

# Summary
echo ""
echo -e "  ────────────────────────"
if [ "$ERRORS" -gt 0 ]; then
  echo -e "  ${RED}${ERRORS} error(s) found${RESET} — fix required before running mAIker"
  exit 1
elif [ "$WARNINGS" -gt 0 ]; then
  echo -e "  ${YELLOW}${WARNINGS} warning(s)${RESET} — environment is functional but incomplete"
else
  echo -e "  ${GREEN}All checks passed${RESET}"
fi
echo ""
