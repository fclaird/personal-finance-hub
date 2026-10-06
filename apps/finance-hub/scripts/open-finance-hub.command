#!/bin/zsh -l
# Finance Hub Dock / Automator launcher.
#
# Run `npm run build` once after code changes; this script does not build.
# The URL follows SCHWAB_REDIRECT_URI. https uses certificates/ from `npm run dev`.
# This script does not rewrite .env.local.
# Leave FINANCE_HUB_ALLOW_BROKER_ORDERS unset. Do not bind off loopback.
#
# If that origin's /api/health is already 200, only the browser opens.

set -eu

SCRIPT_DIR="${0:A:h}"
APP_ROOT="${SCRIPT_DIR:h}"
ORIGIN="$(node "$APP_ROOT/scripts/print-listen-origin.mjs")"
HEALTH_URL="${ORIGIN}/api/health"
OPEN_URL="${ORIGIN}/"
LOG_DIR="${HOME}/Library/Logs/finance-hub"
LOG_FILE="${LOG_DIR}/server.log"
MAX_BYTES=$((20 * 1024 * 1024))

if curl -fsS -k --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  open "$OPEN_URL"
  exit 0
fi

mkdir -p "$LOG_DIR"
if [[ -f "$LOG_FILE" ]]; then
  size=$(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
  if (( size > MAX_BYTES )); then
    mv -f "$LOG_FILE" "${LOG_FILE}.1"
  fi
fi

cd "$APP_ROOT"
nohup npm run start >>"$LOG_FILE" 2>&1 &

for attempt in {1..40}; do
  if curl -fsS -k --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    open "$OPEN_URL"
    exit 0
  fi
  sleep 1
done

print -u2 "Finance Hub did not become healthy at ${HEALTH_URL}. See ${LOG_FILE}"
exit 1
