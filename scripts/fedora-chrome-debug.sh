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

echo "🚀 Chrome is not listening on port ${PORT}. Attempting launch..."

# Locate Chrome binary
CHROME_BIN=""
for candidate in \
  "google-chrome" \
  "google-chrome-stable" \
  "chromium" \
  "chromium-browser" \
  "/usr/bin/google-chrome" \
  "/usr/bin/chromium-browser"; do
  if command -v "${candidate}" >/dev/null 2>&1; then
    CHROME_BIN="${candidate}"
    break
  fi
done

if [[ -z "${CHROME_BIN}" ]]; then
  echo "❌ Error: Google Chrome or Chromium executable not found on PATH." >&2
  echo "Please install Google Chrome or specify CHROME_BIN explicitly." >&2
  exit 1
fi

echo "Launching ${CHROME_BIN} on port ${PORT}..."
"${CHROME_BIN}" --remote-debugging-port="${PORT}" --restore-last-session >/dev/null 2>&1 &

# Wait up to 5 seconds for CDP socket to become ready
ATTEMPTS=0
MAX_ATTEMPTS=10
while [[ ${ATTEMPTS} -lt ${MAX_ATTEMPTS} ]]; do
  if curl -s --max-time 1 "${DEBUG_URL}" >/dev/null 2>&1; then
    echo "✅ Chrome launched and listening on port ${PORT}!"
    exit 0
  fi
  sleep 0.5
  ATTEMPTS=$((ATTEMPTS + 1))
done

echo "⚠️ Timed out waiting for Chrome to bind to port ${PORT}." >&2
exit 1
