#!/bin/zsh
# Install the Financial Bridge login launcher.
# Symlinks ~/bin/launch-financial-bridge.sh and reloads com.chris.financialbridge.
# Does not touch credentials, .env.local, or node_modules.
set -eu

SCRIPT_DIR="${0:A:h}"
APP_ROOT="${SCRIPT_DIR:h}"
BIN_DIR="${HOME}/bin"
LAUNCHER="${BIN_DIR}/launch-financial-bridge.sh"
AGENTS="${HOME}/Library/LaunchAgents"
PLIST="${AGENTS}/com.chris.financialbridge.plist"
LOG_DIR="${HOME}/Library/Logs/finance-hub"
UID_NUM="$(id -u)"

mkdir -p "$BIN_DIR" "$AGENTS" "$LOG_DIR"
ln -sfn "$APP_ROOT/scripts/launch-financial-bridge.sh" "$LAUNCHER"
chmod +x "$APP_ROOT/scripts/launch-financial-bridge.sh" "$APP_ROOT/scripts/open-bridge-window.sh"

sed \
  -e "s|__BIN__|${BIN_DIR}|g" \
  -e "s|__APP_ROOT__|${APP_ROOT}|g" \
  -e "s|__HOME__|${HOME}|g" \
  "$APP_ROOT/scripts/com.chris.financialbridge.plist" >"$PLIST"

launchctl bootout "gui/${UID_NUM}/com.chris.financialbridge" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"
launchctl enable "gui/${UID_NUM}/com.chris.financialbridge"
launchctl kickstart -k "gui/${UID_NUM}/com.chris.financialbridge" || true

print "Installed ${LAUNCHER}"
print "Launch agent ${PLIST}"
print "Logs: ${LOG_DIR}/bridge.log"
