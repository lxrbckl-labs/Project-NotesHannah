#!/usr/bin/env bash
# Back up the notes database and files. See docs/backups.md for what each part protects against.
#
#   scripts/backup.sh               full backup: database snapshot, second-drive copy, restic file tree, retention
#   scripts/backup.sh --db-only     only the database snapshot (the 5-minute job): snapshot, copy, ladder
#   options: --label TEXT   free text stored in the manifest (update.sh uses "pre-update")
#            --quiet        log only warnings and errors
#            --no-restic    full backup without the file-tree part
#
# ORDER MATTERS: the database snapshot is taken first, the file tree afterwards (docs/backups.md explains why that
# order can never leave a database row pointing at a file the backup lacks).
#
# Exit status: 0 when every configured part succeeded; 1 otherwise. A failed optional part (second drive, remote
# repository) does not stop the parts after it, so one broken destination never blocks the others.
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"
# shellcheck source=lib/ladder.sh
. "$(dirname "$0")/lib/ladder.sh"

MODE=full
LABEL=""
USE_RESTIC=1
while [ $# -gt 0 ]; do
  case "$1" in
    --db-only) MODE=light ;;
    --label) LABEL="${2:?--label needs a value}"; shift ;;
    --quiet) QUIET=1 ;;
    --no-restic) USE_RESTIC=0 ;;
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

load_env
need_docker
FAILURES=0
fail_part() { warn "$*"; FAILURES=$((FAILURES + 1)); }

# Two backup jobs must not prune or write the same files at once. The 5-minute job skips a run that overlaps; a full
# backup waits up to 30 minutes for a running one.
if [ "$MODE" = light ]; then
  lock_acquire backup 0 || { log "another backup is running; skipping this snapshot"; exit 0; }
else
  lock_acquire backup 1800 || die "another backup has been running for 30 minutes; giving up"
fi

need_storage
mkdir -p "$BACKUPS_DIR/db" "$BACKUPS_DIR/staging" "$BACKUPS_DIR/$STATUS_DIR_NAME"

# ---- 1. database snapshot (first, always) --------------------------------------------------------------------------
db_volume_exists || die "database volume $DB_VOLUME does not exist; nothing to back up (restore with scripts/restore.sh)"
started="$(now_epoch)"
manifest_json="$(run_tool db-snapshot.mjs --out /data/backups/db --kind "$MODE" --label "$LABEL" | tail -n 1)" ||
  die "database snapshot failed"
snap_name="$(printf '%s' "$manifest_json" | json_get - file)"
snap_sha="$(printf '%s' "$manifest_json" | json_get - sha256)"
snap_bytes="$(printf '%s' "$manifest_json" | json_get - bytes)"
[ -n "$snap_name" ] && [ -f "$BACKUPS_DIR/db/$snap_name" ] || die "snapshot tool reported success but $snap_name is missing"
# Re-hash on the host: proves the bytes that reached the drive are the bytes the tool checked.
[ "$(sha256_of "$BACKUPS_DIR/db/$snap_name")" = "$snap_sha" ] || die "snapshot $snap_name does not match its recorded checksum"
log "database snapshot $snap_name ($(human_bytes "$snap_bytes"), integrity ok)"

# ---- 2. second local copy (a different drive) -----------------------------------------------------------------------
copy_ok="not configured"
if [ -n "${BACKUP_COPY_DIR:-}" ]; then
  if backup_copy_ready; then
    mkdir -p "$BACKUP_COPY_DIR/db"
    if cp "$BACKUPS_DIR/db/$snap_name" "$BACKUP_COPY_DIR/db/.tmp-$snap_name" &&
      [ "$(sha256_of "$BACKUP_COPY_DIR/db/.tmp-$snap_name")" = "$snap_sha" ] &&
      mv "$BACKUP_COPY_DIR/db/.tmp-$snap_name" "$BACKUP_COPY_DIR/db/$snap_name" &&
      cp "$BACKUPS_DIR/db/$snap_name.json" "$BACKUP_COPY_DIR/db/$snap_name.json"; then
      copy_ok="ok"
      log "copied to $BACKUP_COPY_DIR/db (checksum verified)"
    else
      rm -f "$BACKUP_COPY_DIR/db/.tmp-$snap_name"
      copy_ok="FAILED"
      fail_part "copy to $BACKUP_COPY_DIR failed"
    fi
  else
    copy_ok="FAILED (target missing)"
    fail_part "BACKUP_COPY_DIR=$BACKUP_COPY_DIR is not mounted or lacks its .notes-backup-target marker; second copy skipped"
  fi
fi

# ---- 3. retention ladder ---------------------------------------------------------------------------------------------
prune_ladder "$BACKUPS_DIR/db"
if [ "$copy_ok" = ok ]; then prune_ladder "$BACKUP_COPY_DIR/db"; fi

write_status "last-snapshot" "{\"at\":\"$(ts)\",\"kind\":\"$MODE\",\"file\":\"$snap_name\",\"bytes\":$snap_bytes,\"sha256\":\"$snap_sha\",\"secondCopy\":\"$copy_ok\"}"

if [ "$MODE" = light ]; then
  [ "$FAILURES" -eq 0 ] || exit 1
  exit 0
fi

# ---- 4. file tree with restic (after the snapshot) -------------------------------------------------------------------
restic_summary=""
if [ "$USE_RESTIC" = 1 ]; then
  if ! restic_available; then
    warn "restic is NOT INSTALLED: originals and pages are NOT backed up by this run (install it: brew install restic). Database snapshots and the second copy were still made."
    restic_summary="restic not installed"
    FAILURES=$((FAILURES + 1))
  else
    # Stage the snapshot beside the tree so each restic snapshot holds a database and files that belong together.
    rm -rf "$BACKUPS_DIR/staging"
    mkdir -p "$BACKUPS_DIR/staging"
    cp "$BACKUPS_DIR/db/$snap_name" "$BACKUPS_DIR/staging/notes.db"
    cp "$BACKUPS_DIR/db/$snap_name.json" "$BACKUPS_DIR/staging/manifest.json"

    for which in local remote; do
      if [ "$which" = remote ] && ! repo_configured remote; then continue; fi
      if [ "$which" = local ]; then
        if ! repo_configured local; then
          warn "restic: RESTIC_PASSWORD or the local repository is not configured; the local file backup was skipped"
          restic_summary="$restic_summary local:not-configured"; FAILURES=$((FAILURES + 1)); continue
        fi
        if ! backup_copy_ready && [ -z "${RESTIC_REPOSITORY:-}" ]; then
          fail_part "restic local repository is under BACKUP_COPY_DIR, which is not mounted or lacks its marker; skipped"
          restic_summary="$restic_summary local:target-missing"; continue
        fi
      fi
      if ! restic_in "$which" cat config >/dev/null 2>&1; then
        log "restic: creating the $which repository"
        restic_in "$which" init >/dev/null || { fail_part "restic init ($which) failed"; restic_summary="$restic_summary $which:init-failed"; continue; }
      fi
      log "restic ($which): backing up originals, pages and the database snapshot"
      if restic_in "$which" backup --host notes --tag notes --tag "snapshot-$snap_name" --quiet \
        "$DATA_DIR/.notes-storage" "$DATA_DIR/originals" "$DATA_DIR/pages" "$BACKUPS_DIR/staging"; then
        if restic_in "$which" forget --host notes --tag notes --prune --quiet \
          --keep-daily "${RESTIC_KEEP_DAILY:-30}" --keep-weekly "${RESTIC_KEEP_WEEKLY:-26}" --keep-monthly "${RESTIC_KEEP_MONTHLY:-24}"; then
          restic_summary="$restic_summary $which:ok"
        else
          fail_part "restic forget --prune ($which) failed"
          restic_summary="$restic_summary $which:backup-ok-prune-failed"
        fi
      else
        fail_part "restic backup ($which) failed"
        restic_summary="$restic_summary $which:FAILED"
      fi
    done
  fi
else
  restic_summary="skipped (--no-restic)"
fi

took=$(($(now_epoch) - started))
write_status "last-full" "{\"at\":\"$(ts)\",\"snapshot\":\"$snap_name\",\"secondCopy\":\"$copy_ok\",\"restic\":\"$(printf '%s' "$restic_summary" | sed 's/^ //')\",\"seconds\":$took,\"failures\":$FAILURES}"
log "full backup finished in ${took}s: second copy $copy_ok; restic:${restic_summary:- none}"
[ "$FAILURES" -eq 0 ] || exit 1
