#!/usr/bin/env bash
set -euo pipefail

# ── dev:chrome-fresh ──────────────────────────────────────────────────
# Kills any old Chrome, rebuilds the extension, and launches a fresh
# Chrome instance with remote debugging on :9222 and the extension
# pre-loaded.
#
# Profile: ~/.dorv-dev-chrome-profile (persistent, pre-authenticated)
#   ⚠️  This profile is used EXCLUSIVELY for dorv extension debugging.
#   It contains ONLY GitHub + Google OAuth session cookies — nothing else.
#   --remote-debugging-port=9222 is unauthenticated by design (CDP has no
#   built-in auth); this profile must NEVER contain sessions for sensitive
#   or unrelated sites, and the directory must never be committed.
#
# One-time pre-req:
#   pnpm chrome-dev-setup
#   (sign into github.com + accounts.google.com inside that window, then close it)
#
# After launch, verify freshness via MCP:
#   chrome_devtools_evaluate_script \
#     '() => document.documentElement.dataset.dorvCsBuild'

PROFILE_DIR="${HOME}/.dorv-dev-chrome-profile"
BUILD_DIR="$(cd "$(dirname "$0")/.." && pwd)/.output/chrome-mv3"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TARGET_URL="${1:-https://github.com/ahnpolished/dorv/pull/6/files}"

echo "=== 🔨 Building extension ==="
pnpm run build

echo "=== 🧹 Killing old Chrome ==="
kill $(lsof -tiTCP:9222 -sTCP:LISTEN) 2>/dev/null || true
pkill -9 -f "Google Chrome" 2>/dev/null || true
sleep 3

echo "=== 🚀 Launching Chrome ==="
"$CHROME" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE_DIR" \
  --profile-directory=Default \
  --load-extension="$BUILD_DIR" \
  "$TARGET_URL" &

echo "=== ⏳ Waiting for DevTools port ==="
for i in $(seq 1 30); do
  if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
    echo "✅ Chrome ready on :9222 after ${i}s"
    break
  fi
  sleep 1
done

echo ""
echo "=== 🔍 Verify freshness via chrome-devtools MCP ==="
echo "  evaluate_script:"
echo "    () => document.documentElement.dataset.dorvCsBuild"
