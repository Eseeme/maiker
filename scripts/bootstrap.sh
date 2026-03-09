#!/usr/bin/env bash
# mAIker Bootstrap Script
# Sets up all dependencies and links the CLI for local development

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

echo ""
echo -e "  ${CYAN}mAIker Bootstrap${RESET}"
echo -e "  ${CYAN}────────────────${RESET}"
echo ""

# Check Node version
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")
REQUIRED_NODE="v20"

if [[ "$NODE_VERSION" == "not found" ]]; then
  echo -e "  ${RED}✗${RESET} Node.js not found. Install Node.js v20+ from https://nodejs.org"
  exit 1
fi

if [[ "$NODE_VERSION" < "$REQUIRED_NODE" ]]; then
  echo -e "  ${YELLOW}⚠${RESET} Node.js ${NODE_VERSION} detected. mAIker recommends v20+"
fi

echo -e "  ${GREEN}✓${RESET} Node.js ${NODE_VERSION}"

# Check npm
if ! command -v npm &> /dev/null; then
  echo -e "  ${RED}✗${RESET} npm not found"
  exit 1
fi
echo -e "  ${GREEN}✓${RESET} npm $(npm --version)"

# Install dependencies
echo ""
echo -e "  Installing npm dependencies..."
npm install

# Build
echo ""
echo -e "  Building TypeScript..."
npm run build

# Link for local development
echo ""
echo -e "  Linking maiker CLI..."
npm link

# Setup .env
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo -e "  ${YELLOW}⚠${RESET} .env created from .env.example — add your API keys"
  fi
else
  echo -e "  ${GREEN}✓${RESET} .env already exists"
fi

# Setup maiker.config.yaml
if [ ! -f maiker.config.yaml ]; then
  if [ -f templates/maiker.config.yaml ]; then
    cp templates/maiker.config.yaml maiker.config.yaml
    echo -e "  ${GREEN}✓${RESET} maiker.config.yaml created from template"
  fi
fi

echo ""
echo -e "  ${GREEN}✓ Bootstrap complete!${RESET}"
echo ""
echo -e "  Next steps:"
echo -e "  ${CYAN}1.${RESET} Add API keys to .env"
echo -e "  ${CYAN}2.${RESET} Edit maiker.config.yaml"
echo -e "  ${CYAN}3.${RESET} Run: maiker init"
echo -e "  ${CYAN}4.${RESET} Run: maiker run ./your-project --goal \"...\""
echo ""
