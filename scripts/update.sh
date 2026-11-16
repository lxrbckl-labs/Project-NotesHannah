#!/usr/bin/env bash
# Update the running stack: pre-update backup, pull, build, restart (the app runs its migrations on start).
#   scripts/update.sh [--no-pull] [--skip-backup]
#
# The pre-update backup is a FULL backup labelled "pre-update". If it fails, the update stops: a migration that
# goes wrong must always have a restore point. Migrations only move forward, so a rollback means restoring that
# backup (scripts/restore.sh) and running the previous image, which this script tags as <image>:previous.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"

PULL=1 BACKUP=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --skip-backup) BACKUP=0 ;;
    -h | --help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "unknown option: $arg" ;;
  esac
done
load_env
need_docker
need_storage

if [ "$BACKUP" = 1 ]; then
  log "pre-update backup"
  "$SCRIPTS_DIR/backup.sh" --label pre-update || die "the pre-update backup failed; not updating (fix it, or pass --skip-backup knowingly)"
fi
if [ "$PULL" = 1 ]; then
  log "git pull --ff-only"
  git -C "$REPO_DIR" pull --ff-only
fi

# Keep the running images as :previous for a rollback.
for img in "$APP_IMAGE" "${CONVERTER_IMAGE:-notes-converter}"; do
  base="${img%%:*}"
  if docker image inspect "$img" >/dev/null 2>&1; then docker tag "$img" "$base:previous"; fi
done

since="$(ts)"
log "building"
dc build
log "restarting (the app applies pending migrations on start)"
dc up -d --wait --wait-timeout 240
dc logs --since "$since" app 2>/dev/null | grep -E 'applied migrations|listening' || true
"$SCRIPTS_DIR/backup.sh" --db-only --label post-update --quiet || warn "post-update snapshot failed"
log "updated. Roll back: scripts/down.sh; restore the pre-update backup; run the :previous images."
