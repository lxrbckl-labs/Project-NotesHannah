#!/usr/bin/env bash
# Verify the restic repositories (structure of every snapshot, plus a random sample of the data itself).
#   scripts/restic-check.sh            weekly, from launchd
# RESTIC_CHECK_SUBSET (default 5%) is how much of the stored data is re-read and re-hashed each time; over a few
# months that touches all of it. Writes status/last-check.json, which scripts/status.sh shows.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
load_env
need_storage
result=pass
detail=""
if ! restic_available; then
  result=fail; detail="restic not installed"
else
  checked=0
  for which in local remote; do
    repo_configured "$which" || continue
    if [ "$which" = local ] && [ -z "${RESTIC_REPOSITORY:-}" ] && ! backup_copy_ready; then
      result=fail; detail="$detail local:target-missing"; continue
    fi
    checked=$((checked + 1))
    log "restic check ($which)"
    if restic_in "$which" check --read-data-subset "${RESTIC_CHECK_SUBSET:-5%}" >/dev/null 2>"${TMPDIR:-/tmp}/notes-restic-check.err"; then
      detail="$detail $which:ok"
    else
      result=fail; detail="$detail $which:FAILED($(tail -n 1 "${TMPDIR:-/tmp}/notes-restic-check.err" | tr -d '"'))"
    fi
  done
  if [ "$checked" = 0 ] && [ "$result" = pass ]; then result=fail; detail="no repository configured"; fi
fi
detail="$(printf '%s' "$detail" | sed 's/^ //')"
write_status last-check "{\"at\":\"$(ts)\",\"result\":\"$result\",\"detail\":\"$detail\"}"
log "restic check: $result ${detail}"
[ "$result" = pass ]
