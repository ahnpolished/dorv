#!/usr/bin/env bash
# bin/chrome-dev.sh — launch Chrome with the dorv extension loaded for local debugging.
#
# Creates a dedicated test profile at ~/.config/chrome-dorv-dev (not your real Chrome
# profile). Log in to GitHub and Google in this profile once; cookies persist between runs.
#
# Usage:
#   pnpm e2e:build          # build the extension first
#   ./bin/chrome-dev.sh     # launch Chrome
#   # Navigate to a GH PR, trigger the sidepanel (Alt+Shift+D or extension icon)
#   npx tsx tests/e2e/debug-sidepanel.ts http://127.0.0.1:9222
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${HOME}/.config/chrome-dorv-dev"
EXTENSION_PATH="${REPO_ROOT}/apps/extension/.output/chrome-mv3"

if [ ! -d "$EXTENSION_PATH" ]; then
  echo "Extension not built. Run: pnpm e2e:build" >&2
  exit 1
fi

mkdir -p "$PROFILE"

echo "Starting Chrome with dorv extension..."
echo "  Profile:   $PROFILE"
echo "  Extension: $EXTENSION_PATH"
echo "  CDP:       http://127.0.0.1:9222"
echo ""
echo "After Chrome opens, navigate to a GH PR and open the sidepanel."
echo "Then run: npx tsx tests/e2e/debug-sidepanel.ts"

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE" \
  --disable-extensions-except="$EXTENSION_PATH" \
  --load-extension="$EXTENSION_PATH" \
  --no-first-run \
  --no-default-browser-check \
  "$@"
