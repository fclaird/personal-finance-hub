#!/bin/zsh
# Daily launcher for Financial Bridge.
#
# ~/bin/launch-financial-bridge.sh should be:
#   exec "$HOME/Projects/personal-finance-hub/apps/finance-hub/scripts/launch-financial-bridge.sh" "$@"
#
#   scripts/launch-financial-bridge.sh              # native check, build if needed, stage, health, then cut over
#   scripts/launch-financial-bridge.sh start        # native check, stage, health, then cut over
#   scripts/launch-financial-bridge.sh dev          # native check, then stop :3000 and next dev
#   scripts/launch-financial-bridge.sh --background prod
#
# Node: ~/.local/opt/node-arm64 when that binary reports arm64, else the current node.
# Override with FINANCE_HUB_NODE. FINANCE_HUB_REBUILD=1 forces a production build.
# Production start is `node .next/standalone/server.js` (not `next start`).
# The new server is staged on port 3001 (or the next free port) and must return
# /api/health 200 before anything stops the listener on 3000. A 500 or a timeout
# leaves the old server running.
# After that cutover, Bridge tabs in the default browser (Safari, Chrome, Arc,
# Brave, or Edge) are closed and a new full-screen window opens.
# FINANCE_HUB_NO_BROWSER=1 skips the browser. Other tabs are left alone.
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
NODE_BIN_DIR="${NODE:h}"
export PATH="${NODE_BIN_DIR}:$PATH"
print -r -- "Finance Hub node: ${NODE} ($("$NODE" -p 'process.arch + " " + process.version'))"
npm_on_path="$(command -v npm 2>/dev/null || true)"
print -r -- "Finance Hub npm: ${npm_on_path:-none on PATH}"

STAGE_PORT=""
STAGE_PID=""
PROMOTE_PID=""
LOG_DIR="${HOME}/Library/Logs/finance-hub"
LOG_FILE="${LOG_DIR}/server.log"

pick_stage_port() {
  local offset candidate pids
  for offset in {1..10}; do
    candidate=$((PORT + offset))
    pids="$(lsof -nP -iTCP:"${candidate}" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [[ -z "${pids//[$' \n\t']/}" ]]; then
      STAGE_PORT="$candidate"
      return 0
    fi
  done
  print -u2 "No free port near ${PORT} for the staged server. Leaving port ${PORT} running."
  exit 1
}

stop_pid() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  kill "$pid" 2>/dev/null || true
  sleep 0.2
  kill -9 "$pid" 2>/dev/null || true
}

# Prints 200, 500, or empty. Does not kill anything.
health_code() {
  local port="$1"
  local origin code
  origin="$(PORT="$port" "$NODE" "$APP_ROOT/scripts/print-listen-origin.mjs" 2>/dev/null)" || {
    print -r -- ""
    return 0
  }
  code="$(curl -k -s -o /dev/null -w '%{http_code}' --max-time 2 "${origin}/api/health" || true)"
  print -r -- "$code"
}

# 0 = healthy, 2 = HTTP 500, 1 = exited or timed out. Does not kill port $PORT.
wait_for_health() {
  local port="$1"
  local pid="$2"
  local attempt code
  for attempt in {1..60}; do
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      print -u2 "Server on port ${port} exited before /api/health returned 200."
      return 1
    fi
    code="$(health_code "$port")"
    if [[ "$code" == "200" ]]; then
      print -r -- "Finance Hub healthy on port ${port}."
      return 0
    fi
    if [[ "$code" == "500" ]]; then
      print -u2 "Finance Hub /api/health returned 500 on port ${port}."
      return 2
    fi
    sleep 1
  done
  print -u2 "Finance Hub on port ${port} did not become healthy within 60s."
  return 1
}

# Close Bridge tabs and open one new full-screen window. Never fails the cutover.
reopen_bridge_browser() {
  if [[ "${FINANCE_HUB_NO_BROWSER:-}" == "1" ]]; then
    print -r -- "Browser reopen skipped (FINANCE_HUB_NO_BROWSER=1)."
    return 0
  fi
  local origin
  origin="$(PORT="$PORT" "$NODE" "$APP_ROOT/scripts/print-listen-origin.mjs" 2>/dev/null || true)"
  if [[ -z "$origin" ]]; then
    print -u2 "Browser reopen skipped: listen origin is unknown."
    return 0
  fi
  "$NODE" "$APP_ROOT/scripts/reopenBridgeBrowser.mjs" "$origin" \
    || print -u2 "Browser reopen failed; Finance Hub is up on port ${PORT}."
}

STEPS="$("$NODE" "$APP_ROOT/scripts/launchPlan.mjs" "$MODE" "$APP_ROOT")"
steps=("${(@f)STEPS}")

run_step() {
  case "$1" in
    ensure-native)
      "$NODE" "$APP_ROOT/scripts/ensure-sqlite-native.mjs"
      ;;
    backup-native)
      "$NODE" "$APP_ROOT/scripts/sqliteStandalone.mjs" backup
      ;;
    build)
      "$NODE" "$APP_ROOT/node_modules/next/dist/bin/next" build
      ;;
    restore-native)
      "$NODE" "$APP_ROOT/scripts/sqliteStandalone.mjs" restore
      ;;
    stage-start)
      pick_stage_port
      mkdir -p "$LOG_DIR"
      print -r -- "Staging Finance Hub on port ${STAGE_PORT}. Port ${PORT} stays up until /api/health returns 200."
      PORT="$STAGE_PORT" nohup "$NODE" "$APP_ROOT/scripts/start.mjs" >>"$LOG_FILE" 2>&1 &
      STAGE_PID=$!
      ;;
    health-gate)
      if ! wait_for_health "$STAGE_PORT" "$STAGE_PID"; then
        print -u2 "Leaving port ${PORT} running."
        stop_pid "$STAGE_PID"
        exit 1
      fi
      ;;
    promote-start)
      mkdir -p "$LOG_DIR"
      # start.mjs stops port $PORT only after the standalone sqlite probe passes.
      FINANCE_HUB_REPLACE=1 PORT="$PORT" nohup "$NODE" "$APP_ROOT/scripts/start.mjs" >>"$LOG_FILE" 2>&1 &
      PROMOTE_PID=$!
      if ! wait_for_health "$PORT" "$PROMOTE_PID"; then
        print -u2 "Cutover did not stay healthy. Staged server remains on port ${STAGE_PORT} (pid ${STAGE_PID})."
        stop_pid "$PROMOTE_PID"
        exit 1
      fi
      stop_pid "$STAGE_PID"
      reopen_bridge_browser
      if (( BACKGROUND )); then
        print -r -- "Finance Hub listening on port ${PORT} (pid ${PROMOTE_PID})."
      else
        wait "$PROMOTE_PID"
      fi
      ;;
    kill-port)
      kill_port "$PORT"
      ;;
    dev)
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
