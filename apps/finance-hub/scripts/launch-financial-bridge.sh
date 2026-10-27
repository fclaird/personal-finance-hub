#!/bin/zsh
# Daily launcher for Financial Bridge.
#
# ~/bin/launch-financial-bridge.sh should be:
#   exec "$HOME/Projects/personal-finance-hub/apps/finance-hub/scripts/launch-financial-bridge.sh" "$@"
#
#   scripts/launch-financial-bridge.sh              # kill :3000, build if needed, production start
#   scripts/launch-financial-bridge.sh start        # kill :3000, production start, no build
#   scripts/launch-financial-bridge.sh dev          # kill :3000, next dev
#   scripts/launch-financial-bridge.sh --background prod
#
# Node: ~/.local/opt/node-arm64 when that binary reports arm64, else the current node.
# Override with FINANCE_HUB_NODE. FINANCE_HUB_REBUILD=1 forces a production build.
# Production start is `node .next/standalone/server.js` (not `next start`).
# Port 3000 is cleared again immediately before start or dev, after any build.
# Leave FINANCE_HUB_ALLOW_BROKER_ORDERS unset.
set -eu

SCRIPT_DIR="${0:A:h}"
APP_ROOT="${SCRIPT_DIR:h}"
BACKGROUND=0
if [[ "${1:-}" == "--background" ]]; then
  BACKGROUND=1
  shift
fi
MODE="${1:-prod}"
PORT="${PORT:-3000}"

kill_port() {
  local port="$1"
  local attempt pids
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    pids="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [[ -z "${pids//[$' \n\t']/}" ]]; then
      return 0
    fi
    print -r -- "Stopping listener on port ${port}: ${pids//$'\n'/ }"
    if (( attempt <= 2 )); then
      kill ${=pids} 2>/dev/null || true
    else
      kill -9 ${=pids} 2>/dev/null || true
    fi
    sleep 0.3
  done
  print -u2 "Port ${port} is still in use."
  exit 1
}

cd "$APP_ROOT"
NODE="$(node "$APP_ROOT/scripts/print-finance-hub-node.mjs")"
print -r -- "Finance Hub node: ${NODE} ($("$NODE" -p 'process.arch + " " + process.version'))"
kill_port "$PORT"

STEPS="$("$NODE" "$APP_ROOT/scripts/launchPlan.mjs" "$MODE" "$APP_ROOT")"
steps=("${(@f)STEPS}")

run_step() {
  case "$1" in
    build)
      "$NODE" "$APP_ROOT/scripts/ensure-sqlite-native.mjs"
      "$NODE" "$APP_ROOT/node_modules/next/dist/bin/next" build
      ;;
    start)
      kill_port "$PORT"
      "$NODE" "$APP_ROOT/scripts/ensure-sqlite-native.mjs"
      if (( BACKGROUND )); then
        mkdir -p "${HOME}/Library/Logs/finance-hub"
        nohup "$NODE" "$APP_ROOT/scripts/start.mjs" >>"${HOME}/Library/Logs/finance-hub/server.log" 2>&1 &
        print -r -- "Finance Hub starting in the background (pid $!)."
      else
        exec "$NODE" "$APP_ROOT/scripts/start.mjs"
      fi
      ;;
    dev)
      kill_port "$PORT"
      if (( BACKGROUND )); then
        mkdir -p "${HOME}/Library/Logs/finance-hub"
        nohup "$NODE" "$APP_ROOT/scripts/dev.mjs" >>"${HOME}/Library/Logs/finance-hub/dev.log" 2>&1 &
        print -r -- "Finance Hub dev starting in the background (pid $!)."
      else
        exec "$NODE" "$APP_ROOT/scripts/dev.mjs"
      fi
      ;;
    *)
      print -u2 "Unknown launch step: $1"
      exit 1
      ;;
  esac
}

for step in "${steps[@]}"; do
  [[ -z "$step" ]] && continue
  run_step "$step"
done
