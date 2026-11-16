#!/usr/bin/env bash
# Stop the stack. Never deletes the database volume: -v/--volumes is refused on purpose.
#   scripts/down.sh
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
for arg in "$@"; do
  case "$arg" in
    -v | --volumes) die "refusing: that would delete the database volume. Back up first, and remove the volume by hand if you really mean it." ;;
  esac
done
load_env
need_docker
dc down "$@"
log "stack stopped; the database volume ($DB_VOLUME) and the data directory are untouched"
