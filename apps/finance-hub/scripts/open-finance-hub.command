#!/bin/zsh -l
# Dock / Automator entry. Same launcher as ~/bin/launch-financial-bridge.sh.
# Dev mode is not this file. From apps/finance-hub: npm run dev
set -eu
SCRIPT_DIR="${0:A:h}"
exec "$SCRIPT_DIR/launch-financial-bridge.sh"
