#!/usr/bin/env bash
# Start (or update in place) the stack and wait until both containers are healthy.
#   scripts/up.sh [--build]
# Checks the drive first, so an unmounted drive gives a clear message instead of Docker's mount error.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"

BUILD=""
for arg in "$@"; do
  case "$arg" in
    --build) BUILD="--build" ;;
    -h | --help) sed -n '2,4p' "$0"; exit 0 ;;
    *) die "unknown option: $arg" ;;
  esac
done

load_env
need_docker
need_storage
if [ -n "${BACKUP_COPY_DIR:-}" ] && ! backup_copy_ready; then
  warn "BACKUP_COPY_DIR=$BACKUP_COPY_DIR is not mounted or lacks its marker: backups will not reach the second drive until it is"
fi
# shellcheck disable=SC2086 # BUILD is empty or one flag
dc up -d --wait --wait-timeout 240 $BUILD
log "stack is up: $APP_ORIGIN (published on 127.0.0.1:${APP_PORT:-3000})"
