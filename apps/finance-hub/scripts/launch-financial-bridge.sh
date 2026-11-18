#!/bin/zsh
# Financial Bridge login launcher.
#
# launchd (com.chris.financialbridge) runs this in the foreground.
# The Dock command runs it too: if the server is already up, only the window opens.
#
# Production: Intel Node at /usr/local/bin/node, `next build` when HEAD or
# package-lock.json changed, then `next start` over HTTPS on 127.0.0.1:3000.
# Dev mode is manual: cd apps/finance-hub && npm run dev
#
# Does not rewrite .env.local or token files. Does not run npm rebuild.
set -eu
# launchd's PATH is /usr/bin:/bin. Turbopack's PostCSS worker spawns `node` from PATH.
export PATH="/usr/local/bin:${PATH:-/usr/bin:/bin}"

SCRIPT_DIR="${0:A:h}"
APP_ROOT="${SCRIPT_DIR:h}"
NODE="/usr/local/bin/node"
LOG_DIR="${HOME}/Library/Logs/finance-hub"
PIDFILE="${LOG_DIR}/bridge.pid"

if [[ "$(uname)" == "Darwin" ]]; then
  if [[ ! -x "$NODE" ]]; then
    print -u2 "Refusing to start. Intel Node is not at ${NODE}."
    exit 1
  fi
  arch="$("$NODE" -p 'process.arch')"
  if [[ "$arch" != "x64" ]]; then
    print -u2 "Refusing ${NODE} (process.arch=${arch}). Financial Bridge requires x64, not arm64."
    exit 1
  fi
else
  NODE="${FINANCE_HUB_NODE:-$(command -v node)}"
fi

ORIGIN="$("$NODE" "$APP_ROOT/scripts/print-listen-origin.mjs")"
HEALTH_URL="${ORIGIN}/api/health"

mkdir -p "$LOG_DIR"

server_up() {
  if [[ ! -f "$PIDFILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

open_window() {
  "$APP_ROOT/scripts/open-bridge-window.sh" "$ORIGIN" || true
}

if [[ "${FINANCE_HUB_LAUNCHD:-}" != "1" ]] && server_up; then
  open_window
  exit 0
fi

export FINANCE_HUB_OPEN_WINDOW="${FINANCE_HUB_OPEN_WINDOW:-1}"
if [[ "${FINANCE_HUB_LAUNCHD:-}" == "1" ]]; then
  exec "$NODE" "$APP_ROOT/scripts/serve-production.mjs"
fi

# Dock / manual start: do not block the click on the supervisor.
# The supervisor does not open a second window; this script does, once health is up.
FINANCE_HUB_OPEN_WINDOW=0 nohup "$NODE" "$APP_ROOT/scripts/serve-production.mjs" >>"${LOG_DIR}/bridge.log" 2>&1 &
for _ in {1..240}; do
  if curl -fsS -k --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    open_window
    exit 0
  fi
  sleep 2
done
print -u2 "Financial Bridge did not become healthy at ${HEALTH_URL}. See ${LOG_DIR}/bridge.log"
exit 1
