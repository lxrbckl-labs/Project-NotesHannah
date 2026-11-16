#!/usr/bin/env bash
# Fill in the launchd templates (deploy/launchd/*.plist.template) and install them for the current user.
#   scripts/install-launchd.sh [--print-only] [--out DIR] [--uninstall]
#
#   app.notes.snapshot       every 5 minutes: database snapshot only (the Docker-reset insurance)
#   app.notes.backup         03:15 every night: full backup (database, second copy, restic)
#   app.notes.restic-check   Sundays 05:00: restic check
#   app.notes.drill          the 1st of each month 04:00: restore drill on the real backups
#   app.notes.start          at login/boot: wait for Docker and the drive, then start the stack
#
# These are LaunchAgents: they run while the user is logged in (the mini should log in automatically; see
# docs/deploy.md). --print-only writes the filled plists to --out (default ./launchd-out) and loads nothing.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
PRINT=0 OUT="" UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --print-only) PRINT=1 ;;
    --out) OUT="${2:?}"; shift ;;
    --uninstall) UNINSTALL=1 ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done
NAMES="snapshot nightly check drill start"
LABELS="app.notes.snapshot app.notes.backup app.notes.restic-check app.notes.drill app.notes.start"
AGENTS="$HOME/Library/LaunchAgents"

if [ "$UNINSTALL" = 1 ]; then
  for label in $LABELS; do
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$AGENTS/$label.plist"
    log "removed $label"
  done
  exit 0
fi

load_env
LOG_DIR="${NOTES_LOG_DIR:-$HOME/Library/Logs/notes}"
if [ "$PRINT" = 1 ]; then DEST="${OUT:-./launchd-out}"; else DEST="$AGENTS"; mkdir -p "$LOG_DIR"; fi
mkdir -p "$DEST"
for name in $NAMES; do
  src="$REPO_DIR/deploy/launchd/$name.plist.template"
  label="$(sed -n 's|.*<string>\(app\.notes\.[a-z-]*\)</string>.*|\1|p' "$src" | head -n 1)"
  sed -e "s|@REPO_DIR@|$REPO_DIR|g" -e "s|@ENV_FILE@|$ENV_FILE|g" -e "s|@LOG_DIR@|$LOG_DIR|g" "$src" >"$DEST/$label.plist"
  plutil -lint "$DEST/$label.plist" >/dev/null
  log "wrote $DEST/$label.plist"
  if [ "$PRINT" = 0 ]; then
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$DEST/$label.plist"
    log "loaded $label"
  fi
done
[ "$PRINT" = 1 ] || log "installed. Logs: $LOG_DIR. Check with: launchctl list | grep app.notes"
