#!/usr/bin/env bash
# One screen of truth: containers, converter heartbeat, database and storage size, and how old each backup is.
#   scripts/status.sh            human-readable
# Exit status 0 when everything is fine, 1 when something needs attention (stale backup, unhealthy container, ...).
set -uo pipefail
. "$(dirname "$0")/lib/common.sh"
load_env
PROBLEMS=0
ok() { printf '  %-22s %s\n' "$1" "$2"; }
bad() { printf '  %-22s %s  <-- ATTENTION\n' "$1" "$2"; PROBLEMS=$((PROBLEMS + 1)); }
section() { printf '\n%s\n' "$1"; }

now="$(now_epoch)"
age_of_iso() { local e; e="$(epoch_of_iso "$1")" && echo $((now - e)); }

section "Containers ($COMPOSE_PROJECT_NAME)"
if ! docker_ready; then
  bad docker "daemon not reachable"
else
  for svc in app converter; do
    cid="$(dc ps -a -q "$svc" 2>/dev/null | sed -n 1p)"
    if [ -z "$cid" ]; then bad "$svc" "no container (stack is down?)"; continue; fi
    state="$(docker inspect -f '{{.State.Status}}' "$cid")"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no healthcheck{{end}}' "$cid")"
    restarts="$(docker inspect -f '{{.RestartCount}}' "$cid")"
    if [ "$state" = running ] && [ "$health" = healthy ]; then ok "$svc" "running, healthy (restarts: $restarts)"; else bad "$svc" "$state, $health (restarts: $restarts)"; fi
  done
fi

section "Storage ($DATA_DIR)"
if storage_present; then
  ok marker "present"
  hb="$DATA_DIR/queue/heartbeat"
  if [ -f "$hb" ]; then
    upd="$(json_get "$hb" updatedAt)"
    hage="$(age_of_iso "$upd" || echo 99999)"
    st="$(json_get "$hb" state)"
    proc="$(json_get "$hb" processed)"
    failed="$(json_get "$hb" failed)"
    if [ "$hage" -le 30 ]; then ok "converter heartbeat" "$st, ${hage}s ago (processed $proc, failed $failed)"; else bad "converter heartbeat" "last seen $(human_age "$hage") ago"; fi
  else
    bad "converter heartbeat" "no heartbeat file"
  fi
  pend="$(find "$DATA_DIR/queue/pending" -maxdepth 1 -name 'job_*.json' 2>/dev/null | wc -l | tr -d ' ')"
  proc_n="$(find "$DATA_DIR/queue/processing" -maxdepth 1 -name 'job_*.json' 2>/dev/null | wc -l | tr -d ' ')"
  ok "queue" "$pend waiting, $proc_n running"
  ok_k="$(du -sk "$DATA_DIR/originals" 2>/dev/null | cut -f1)"
  pg_k="$(du -sk "$DATA_DIR/pages" 2>/dev/null | cut -f1)"
  ok "originals" "$(human_bytes $((${ok_k:-0} * 1024))) in $(find "$DATA_DIR/originals" -type f 2>/dev/null | wc -l | tr -d ' ') files"
  ok "page images" "$(human_bytes $((${pg_k:-0} * 1024)))"
  ok "drive free" "$(df -h "$DATA_DIR" | awk 'NR==2{print $4" free of "$2" ("$5" used)"}')"
else
  bad marker "MISSING at $DATA_DIR: the drive is not mounted, or this is a fresh install"
fi

section "Database"
if docker_ready && db_volume_exists; then
  if app_running; then
    sizes="$(dc exec -T app sh -c 'stat -c "%s" /db/notes.db; stat -c "%s" /db/notes.db-wal 2>/dev/null || echo 0' 2>/dev/null | tr '\n' ' ')"
  else
    sizes="$(docker run --rm --network none --entrypoint sh --mount "type=volume,src=$DB_VOLUME,dst=/db,readonly" "$APP_IMAGE" -c 'stat -c "%s" /db/notes.db; stat -c "%s" /db/notes.db-wal 2>/dev/null || echo 0' 2>/dev/null | tr '\n' ' ')"
  fi
  # shellcheck disable=SC2086
  set -- $sizes
  if [ -n "${1:-}" ]; then ok "live database" "$(human_bytes "$1") (+ $(human_bytes "${2:-0}") write-ahead log) in volume $DB_VOLUME"; else bad "live database" "volume $DB_VOLUME has no notes.db (a Docker reset? restore with scripts/restore.sh)"; fi
else
  bad "live database" "volume $DB_VOLUME does not exist"
fi

section "Backups"
newest_in() { find "$1" -maxdepth 1 -type f -name 'notes-????????T??????Z.db' 2>/dev/null | sort | tail -n 1; }
snap_report() { # label dir max-age-seconds
  local f stamp age n
  f="$(newest_in "$2")"
  if [ -z "$f" ]; then bad "$1" "no snapshot in $2"; return; fi
  stamp="$(basename "$f" | sed 's/^notes-//; s/\.db$//')"
  age=$((now - $(epoch_of_stamp "$stamp")))
  n="$(find "$2" -maxdepth 1 -type f -name 'notes-????????T??????Z.db' | wc -l | tr -d ' ')"
  if [ "$age" -le "$3" ]; then ok "$1" "$(human_age "$age") ago, $(human_bytes "$(file_bytes "$f")"), $n kept"; else bad "$1" "$(human_age "$age") ago (limit $(human_age "$3")), $n kept"; fi
}
if storage_present; then
  snap_report "snapshot, data drive" "$BACKUPS_DIR/db" $((${STALE_SNAPSHOT_MINUTES:-20} * 60))
  lf="$BACKUPS_DIR/$STATUS_DIR_NAME/last-full.json"
  if [ -f "$lf" ]; then
    at="$(json_get "$lf" at)"
    fage="$(age_of_iso "$at" || echo 99999999)"
    failures="$(json_get "$lf" failures)"
    line="$(human_age "$fage") ago; second copy: $(json_get "$lf" secondCopy); restic:$(json_get "$lf" restic | sed 's/^/ /')"
    if [ "$fage" -le $((${STALE_FULL_HOURS:-30} * 3600)) ] && [ "${failures:-1}" = 0 ]; then ok "last full backup" "$line"; else bad "last full backup" "$line"; fi
  else
    bad "last full backup" "none recorded"
  fi
fi
if [ -n "${BACKUP_COPY_DIR:-}" ]; then
  if backup_copy_ready; then snap_report "snapshot, second drive" "$BACKUP_COPY_DIR/db" $((${STALE_SNAPSHOT_MINUTES:-20} * 60)); else bad "second drive" "$BACKUP_COPY_DIR not mounted or lacks .notes-backup-target"; fi
else
  ok "second drive" "not configured (a dead data drive would take the backups with it)"
fi
if [ -n "${RESTIC_REMOTE_REPOSITORY:-}" ]; then ok "remote repository" "configured"; else ok "remote repository" "NOT configured: nothing protects against losing the whole machine"; fi
if restic_available; then ok restic "$(restic version | head -n 1)"; else bad restic "not installed: files are not being backed up"; fi

section "Checks and drills"
for entry in "last-check:restic check:$((9 * 86400))" "last-drill:restore drill:$((40 * 86400))"; do
  name="${entry%%:*}"; rest="${entry#*:}"; label="${rest%%:*}"; limit="${rest#*:}"
  f="$BACKUPS_DIR/$STATUS_DIR_NAME/$name.json"
  if [ -f "$f" ]; then
    at="$(json_get "$f" at)"; result="$(json_get "$f" result)"; detail="$(json_get "$f" detail)"
    a="$(age_of_iso "$at" || echo 99999999)"
    if [ "$result" = pass ] && [ "$a" -le "$limit" ]; then ok "$label" "passed $(human_age "$a") ago${detail:+ ($detail)}"; else bad "$label" "$result $(human_age "$a") ago${detail:+ ($detail)}"; fi
  else
    bad "$label" "never run"
  fi
done

echo
if [ "$PROBLEMS" -eq 0 ]; then echo "All good."; else echo "$PROBLEMS item(s) need attention."; fi
[ "$PROBLEMS" -eq 0 ]
