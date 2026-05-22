#!/usr/bin/env bash
# Copy legacy Finance Hub into apps/finance-hub/ without runtime data or build artifacts.
set -euo pipefail

LEGACY="${LEGACY:-$HOME/personal-finance-hub/finance-hub}"
TARGET="${TARGET:-$(cd "$(dirname "$0")/.." && pwd)/apps/finance-hub}"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      echo "Usage: $0 [--dry-run]"
      echo "  LEGACY=$LEGACY"
      echo "  TARGET=$TARGET"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$LEGACY" ]]; then
  echo "Legacy app not found: $LEGACY" >&2
  exit 1
fi

mkdir -p "$TARGET"

RSYNC_FLAGS=(-a --delete --human-readable --progress)
EXCLUDES=(
  --exclude node_modules/
  --exclude .next/
  --exclude .next-desktop/
  --exclude desktop/out/
  --exclude desktop/server-bundle/
  --exclude .git/
  --exclude .env.local
  --exclude '*.tsbuildinfo'
  --exclude .DS_Store
)

echo "Legacy:  $LEGACY"
echo "Target:  $TARGET"
echo ""

if $DRY_RUN; then
  echo "[dry-run] Would rsync with excludes:"
  printf '  %s\n' "${EXCLUDES[@]}"
  rsync "${RSYNC_FLAGS[@]}" --dry-run "${EXCLUDES[@]}" "$LEGACY/" "$TARGET/"
  echo ""
  echo "No files written. Run without --dry-run to migrate."
else
  # Preserve placeholder README if target only contains our scaffold
  rsync "${RSYNC_FLAGS[@]}" "${EXCLUDES[@]}" "$LEGACY/" "$TARGET/"
  echo ""
  echo "Migration copy complete."
  echo "Next:"
  echo "  cd \"$TARGET\""
  echo "  cp \"$LEGACY/.env.local\" .env.local   # if needed"
  echo "  npm install && npm run build"
fi
