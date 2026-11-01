#!/usr/bin/env bash
# fedora-chrome-debug.sh — Launch and verify local Chrome remote debugging port 9222
set -euo pipefail

PORT=9222
DEBUG_URL="http://127.0.0.1:${PORT}/json/version"

echo "🔍 Checking for existing Chrome debugging session on port ${PORT}..."

if curl -s --max-time 1 "${DEBUG_URL}" >/dev/null 2>&1; then
  echo "✅ Chrome remote debugging is already active on port ${PORT}:"
  curl -s "${DEBUG_URL}" | grep -E '"Browser"|"webSocketDebuggerUrl"' || true
  exit 0
fi

# Check if an existing Chrome process is running without debugging port
CHROME_PIDS=$(pgrep -f "chrome" 2>/dev/null || true)
if [[ -n "${CHROME_PIDS}" ]]; then
  echo "ℹ️ Chrome is currently running, but remote debugging is not enabled on port ${PORT}."
  echo ""
  echo "👉 To connect to your existing logged-in session without losing accounts or cookies:"
  echo "   1. In your active Chrome tab, open: chrome://inspect/#remote-debugging"
  echo "   2. Enable remote debugging and approve connection."
  echo "   3. Or use the ConvoLink Chrome Companion Extension (zero-flag bridge)."
  exit 1
fi

echo "⚠️ Google Chrome is not running. Please start your everyday Chrome browser."
exit 1
