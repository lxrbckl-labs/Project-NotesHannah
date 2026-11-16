#!/usr/bin/env bash
# After a reboot: wait for Docker and for the external drive, then start the stack.
#   scripts/start-when-ready.sh [max-wait-minutes]      (launchd runs it at load; default wait 45 minutes)
# Docker's own restart policy brings the containers back by itself once Docker is up, but a container whose
# drive was not mounted yet fails to start and stays down. This script is the safety net: it starts the stack once
# both are there, and gives up loudly (exit 1) if they never come.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
load_env
limit=$(( ${1:-45} * 60 ))
waited=0
while :; do
  if docker_ready && storage_present; then break; fi
  if [ "$waited" -ge "$limit" ]; then
    docker_ready || warn "Docker never became reachable"
    storage_present || warn "the storage marker never appeared at $DATA_DIR (drive not mounted?)"
    die "gave up after $((limit / 60)) minutes; the stack is NOT running"
  fi
  sleep 10
  waited=$((waited + 10))
done
log "docker and storage are ready after ${waited}s"
exec "$SCRIPTS_DIR/up.sh"
