#!/bin/sh
# fedora-chrome-debug.sh — Backward compatibility forwarder
# Delegating to universal cross-platform scripts/convo-debug.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/convo-debug.sh" "$@"
