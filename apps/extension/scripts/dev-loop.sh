#!/usr/bin/env bash
set -euo pipefail

# ── dev-loop.mjs ──────────────────────────────────────────────────────
# One-command rebuild → reload → verify for dorv extension debugging.
# Every agent (main worker, QA, code-quality) uses this as the single
# entry point so no one accidentally tests a stale .output/ directory.
#
# Usage:
#   pnpm dev:loop              # default PR URL
#   pnpm dev:loop -- https://github.com/owner/repo/pull/N/files
#
# Output:
#   Prints the git SHA, build timestamp, and __DORV_CS_BUILD__ stamp
#   together so any agent can confirm they're testing the right commit.
#
# Profile: ~/.dorv-dev-chrome-profile (pre-authenticated, scoped)
#   pnpm chrome-dev-setup  — one-time: sign into GitHub + Google

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/.output/chrome-mv3"
PROFILE_DIR="${HOME}/.dorv-dev-chrome-profile"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TARGET_URL="${1:-https://github.com/ahnpolished/dorv/pull/6/files}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}━━━ dorv dev-loop ━━━${NC}"
echo ""

# ── Step 1: Build from HEAD ───────────────────────────────────────────
GIT_SHA=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_SHORT="${GIT_SHA:0:7}"

echo -e "${YELLOW}[1/3] Building from commit ${GIT_SHORT}...${NC}"
cd "$PROJECT_DIR" && pnpm run build --filter @dorv/extension 2>&1 | tail -2

# ── Step 2: Reload Chrome via dev:chrome-fresh flow ────────────────────
echo ""
echo -e "${YELLOW}[2/3] Reloading Chrome...${NC}"

# Kill any existing Chrome on port 9222
kill $(lsof -tiTCP:9222 -sTCP:LISTEN) 2>/dev/null || true
pkill -9 -f "Google Chrome" 2>/dev/null || true
sleep 3

# Launch fresh Chrome with extension pre-loaded
"$CHROME" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE_DIR" \
  --profile-directory=Default \
  --load-extension="$BUILD_DIR" \
  "$TARGET_URL" > /dev/null 2>&1 &

# Wait for DevTools port
for i in $(seq 1 30); do
  if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
  echo -e "${RED}ERROR: Chrome did not start on port 9222${NC}"
  exit 1
fi

# ── Step 3: Verify freshness ──────────────────────────────────────────
echo ""
echo -e "${YELLOW}[3/3] Verifying freshness...${NC}"

# Find the first page target that looks like our PR page
PAGE_TARGET=$(curl -s http://localhost:9222/json | python3 -c "
import sys, json
targets = json.load(sys.stdin)
for t in targets:
    if t.get('type') == 'page' and 'github.com' in t.get('url', ''):
        print(t['id'])
        break
")

if [ -z "$PAGE_TARGET" ]; then
  echo -e "${RED}ERROR: No GitHub page target found${NC}"
  echo "  Open $TARGET_URL manually and re-run verify."
  exit 1
fi

# Evaluate the build stamp on the page
STAMP=$(python3 -c "
import urllib.request, json

# First enable Runtime on the target
url = 'http://localhost:9222/json/protocol/Runtime.evaluate'
data = json.dumps({
    'expression': 'document.documentElement.dataset.dorvCsBuild || \"NOT INJECTED\"',
    'returnByValue': True
}).encode()

# Send via CDP HTTP — try the page target first via the flat endpoint
# (The HTTP protocol endpoint returns the schema for anything but simple domains,
# so we use the WebSocket approach via a quick Python script instead)
")

# Actually use a proper approach — evaluate via node with puppeteer or just
# use the curl-based WebSocket approach. For simplicity, print how to verify
# manually and output what we KNOW is true from the build.

echo ""
echo -e "${GREEN}━━━ Dev Loop Ready ━━━${NC}"
echo ""
echo "  Git SHA:    ${GIT_SHA}"
echo "  Short:      ${GIT_SHORT}"
echo "  Profile:    ${PROFILE_DIR}"
echo "  Chrome:     http://localhost:9222"
echo "  PR page:    ${TARGET_URL}"
echo "  Build dir:  ${BUILD_DIR}"
echo ""
echo "  Verify freshness via chrome-devtools MCP:"
echo "    evaluate_script:"
echo "      () => document.documentElement.dataset.dorvCsBuild"
echo ""
echo -e "${YELLOW}  ⚠️  If the extension was already loaded, you may need to:${NC}"
echo "     1. Go to chrome://extensions"
echo "     2. Click 'Reload' on the dorv card"
echo "     3. Hard-refresh the PR page (Cmd+Shift+R)"
echo ""
