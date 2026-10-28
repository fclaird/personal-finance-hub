#!/bin/zsh -l
# Finance Hub Dock / Automator launcher.
# Production-builds when sources changed, stages the new server, and cuts over
# only after /api/health returns 200. The launcher then opens the Bridge.
# Dev mode: scripts/launch-financial-bridge.sh dev
# Leave FINANCE_HUB_ALLOW_BROKER_ORDERS unset.
set -eu

SCRIPT_DIR="${0:A:h}"
APP_ROOT="${SCRIPT_DIR:h}"
"$SCRIPT_DIR/launch-financial-bridge.sh" --background prod

# The launcher already closed Bridge tabs and opened a full-screen window.
# This wait only confirms health so the Dock action fails if the server is down.
ORIGIN="$(node "$APP_ROOT/scripts/print-listen-origin.mjs")"
HEALTH_URL="${ORIGIN}/api/health"
LOG_FILE="${HOME}/Library/Logs/finance-hub/server.log"

for attempt in {1..90}; do
  if curl -fsS -k --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

print -u2 "Finance Hub did not become healthy at ${HEALTH_URL}. See ${LOG_FILE}"
exit 1
