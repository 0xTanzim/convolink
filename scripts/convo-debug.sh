#!/bin/sh
# convo-debug.sh — Universal POSIX browser debugging probe & launcher
# Supports Linux distros (Fedora, Debian, Ubuntu, Arch, Alpine), macOS, and WSL2
set -e

PORT="${PORT:-9222}"
DEBUG_URL="http://127.0.0.1:${PORT}/json/version"

if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  BLUE="\033[34m"
  YELLOW="\033[33m"
  RESET="\033[0m"
else
  BOLD=""
  GREEN=""
  BLUE=""
  YELLOW=""
  RESET=""
fi

printf "${BOLD}ConvoLink Cross-Platform Browser Debug Probe${RESET}\n\n"

# 1. Probe local loopback
printf "Probing 127.0.0.1:%s...\n" "$PORT"
if command -v curl >/dev/null 2>&1 && curl -s --max-time 1 "$DEBUG_URL" >/dev/null 2>&1; then
  printf "${GREEN}✓ Remote debugging is ACTIVE on 127.0.0.1:%s${RESET}\n" "$PORT"
  curl -s "$DEBUG_URL" | grep -E '"Browser"|"webSocketDebuggerUrl"' || true
  exit 0
fi

# 2. Check WSL2 Host Gateway Fallback
if [ -f /proc/version ] && grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
  GATEWAY_IP="$(ip route show default 2>/dev/null | awk '{print $3}')"
  if [ -n "$GATEWAY_IP" ]; then
    printf "Detected WSL2 environment. Probing Windows host gateway (%s:%s)...\n" "$GATEWAY_IP" "$PORT"
    GW_URL="http://${GATEWAY_IP}:${PORT}/json/version"
    if curl -s --max-time 1 "$GW_URL" >/dev/null 2>&1; then
      printf "${GREEN}✓ Windows host Chrome debugging is ACTIVE on %s:%s${RESET}\n" "$GATEWAY_IP" "$PORT"
      curl -s "$GW_URL" | grep -E '"Browser"|"webSocketDebuggerUrl"' || true
      exit 0
    fi
  fi
fi

# 3. Detect if browser is currently running without remote debugging
RUNNING_PIDS=""
if command -v pgrep >/dev/null 2>&1; then
  RUNNING_PIDS="$(pgrep -f "chrome|brave|msedge|chromium" 2>/dev/null | head -n 3 || true)"
fi

if [ -n "$RUNNING_PIDS" ]; then
  printf "\n${YELLOW}⚠ Browser is currently running, but remote debugging port %s is closed.${RESET}\n\n" "$PORT"
  printf "Chromium ignores '--remote-debugging-port' when joining an already-running process.\n"
  printf "Recommended solutions:\n"
  printf "  1. In your active browser, open: ${BOLD}chrome://inspect/#remote-debugging${RESET}\n"
  printf "  2. Or pair the Companion Extension: ${BOLD}convo ext pair${RESET}\n"
  printf "  3. Or launch with an isolated profile: ${BOLD}convo profile select 1${RESET}\n\n"
  exit 1
fi

printf "\n${BLUE}ℹ No active browser detected on port %s.${RESET}\n" "$PORT"
printf "Launch Chrome with remote debugging:\n"
printf "  ${BOLD}google-chrome --remote-debugging-port=%s${RESET}\n\n" "$PORT"
exit 1
