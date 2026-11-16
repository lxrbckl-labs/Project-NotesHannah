#!/usr/bin/env bash
# Restore a backup into a fresh, empty target, then verify it. Never starts the stack (run scripts/up.sh after).
#
# The target is whatever the env file names: DATA_DIR (the storage directory) and COMPOSE_PROJECT_NAME (whose
# database volume is "<name>-db"). Point NOTES_ENV_FILE at an env file for a brand-new location to restore elsewhere.
#
# Full restore (the data drive is lost or empty), from the restic repository:
#   scripts/restore.sh --restic local [--snapshot latest|ID] [--db paired|newest|FILE]
#   scripts/restore.sh --restic remote ...
# Database only (a Docker reset wiped the volume; the drive is intact):
#   scripts/restore.sh --db-only [--db newest|FILE]
#
#   --db paired   (default with --restic) the database that was snapshotted together with the files
#   --db newest   the newest snapshot file on the second drive or the data drive: keeps her latest notes, but may
#                 reference uploads newer than the file backup (reported as warnings, see --allow-missing)
#   --allow-missing  originals missing from the file tree are warnings, not failures
#   --quick       verify existence and sizes only, not every original's sha256
#   --overwrite   permit replacing a live installation. Asks you to TYPE "overwrite <project>"; the old files and
#                 database are moved aside into <DATA_DIR>/.replaced-<time>/, never deleted.
#
# Refuses unless the stack is stopped and the target is empty (no storage marker, no files, no database in the
# volume). Exit status 0 only if the restored result verifies.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"

SRC="" SNAP=latest DBSEL="" DB_ONLY=0 ALLOW_MISSING=0 QUICK=0 OVERWRITE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --restic) SRC="${2:?--restic local|remote}"; shift ;;
    --snapshot) SNAP="${2:?}"; shift ;;
    --db) DBSEL="${2:?}"; shift ;;
    --db-only) DB_ONLY=1 ;;
    --allow-missing) ALLOW_MISSING=1 ;;
    --quick) QUICK=1 ;;
    --overwrite) OVERWRITE=1 ;;
    -h | --help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

load_env
need_docker
STAMP="$(stamp_now)"

if [ "$DB_ONLY" = 1 ]; then
  [ -z "$SRC" ] || die "--db-only and --restic cannot be combined"
  DBSEL="${DBSEL:-newest}"
else
  [ -n "$SRC" ] || die "say where the files come from: --restic local|remote (or --db-only when the drive is intact)"
  DBSEL="${DBSEL:-paired}"
  restic_available || die "restic is not installed (brew install restic)"
  repo_configured "$SRC" || die "the $SRC restic repository is not configured in $ENV_FILE"
fi

# ---- refuse to touch anything live -------------------------------------------------------------------------------------
if app_running || [ -n "$(dc ps --status running -q converter 2>/dev/null)" ]; then
  die "the stack is running; stop it first (scripts/down.sh). A restore never happens under a running app."
fi
live_data=0
live_db=0
if [ "$DB_ONLY" = 0 ]; then
  [ -d "$DATA_DIR" ] || die "target directory $DATA_DIR does not exist; mount the new drive and create the (empty) directory first"
  if [ -n "$(find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name .DS_Store 2>/dev/null | sed -n 1p)" ]; then live_data=1; fi
else
  need_storage # the files must be there already
fi
volume_has_db() {
  db_volume_exists &&
    docker run --rm --network none --entrypoint test --mount "type=volume,src=$DB_VOLUME,dst=/db,readonly" "$APP_IMAGE" -f /db/notes.db
}
if volume_has_db; then live_db=1; fi

if [ "$live_data" = 1 ] || [ "$live_db" = 1 ]; then
  [ "$OVERWRITE" = 1 ] || die "the target is not empty (data directory in use: $live_data, database in the volume: $live_db). Restore into an empty target, or pass --overwrite to replace a live installation."
  phrase="overwrite $COMPOSE_PROJECT_NAME"
  printf 'This replaces the installation "%s": files in %s and the database volume %s.\nThe old files and database are moved aside into %s/.replaced-%s, not deleted.\nType "%s" to continue: ' \
    "$COMPOSE_PROJECT_NAME" "$DATA_DIR" "$DB_VOLUME" "$DATA_DIR" "$STAMP" "$phrase" >&2
  read -r answer || answer=""
  [ "$answer" = "$phrase" ] || die "confirmation did not match; nothing was changed"
  ASIDE="$DATA_DIR/.replaced-$STAMP"
  mkdir -p "$ASIDE"
  if [ "$live_db" = 1 ]; then
    log "saving the old database to $ASIDE"
    if ! run_tool db-snapshot.mjs --out "/data/.replaced-$STAMP" --kind replaced >/dev/null 2>&1; then
      warn "the old database could not be snapshotted (damaged?); copying its raw files instead"
      docker run --rm --network none --user 0 --cap-drop ALL --cap-add DAC_OVERRIDE --entrypoint sh \
        --mount "type=volume,src=$DB_VOLUME,dst=/db,readonly" --mount "type=bind,src=$ASIDE,dst=/out" \
        "$APP_IMAGE" -c 'cp -a /db/. /out/' || die "could not save the old database; nothing was removed"
    fi
  fi
  if [ "$DB_ONLY" = 0 ]; then
    for entry in "$DATA_DIR"/* "$DATA_DIR"/.[!.]*; do
      [ -e "$entry" ] || continue
      case "$entry" in "$ASIDE") continue ;; esac
      mv "$entry" "$ASIDE/"
    done
  fi
  if [ "$live_db" = 1 ]; then docker volume rm "$DB_VOLUME" >/dev/null; fi
fi

# ---- 1. files (full restore) ---------------------------------------------------------------------------------------------
PAIRED_DB="" PAIRED_MANIFEST=""
if [ "$DB_ONLY" = 0 ]; then
  TMP="$DATA_DIR/.restore-tmp-$STAMP"
  mkdir "$TMP"
  log "restic: restoring snapshot $SNAP from the $SRC repository (this reads the whole backup)"
  restic_in "$SRC" restore "$SNAP" --target "$TMP" --quiet || { rm -rf "$TMP"; die "restic restore failed"; }
  marker="$(find "$TMP" -name .notes-storage -type f | sed -n 1p)"
  [ -n "$marker" ] || { rm -rf "$TMP"; die "the snapshot holds no .notes-storage marker; refusing to continue"; }
  root="$(dirname "$marker")"
  for part in .notes-storage originals pages; do
    [ -e "$root/$part" ] && mv "$root/$part" "$DATA_DIR/$part"
  done
  [ -d "$DATA_DIR/originals" ] || mkdir -p "$DATA_DIR/originals"
  [ -d "$DATA_DIR/pages" ] || mkdir -p "$DATA_DIR/pages"
  if [ -f "$root/backups/staging/notes.db" ]; then
    PAIRED_DB="$DATA_DIR/backups/staging/notes.db"
    mkdir -p "$DATA_DIR/backups/staging"
    mv "$root/backups/staging/notes.db" "$PAIRED_DB"
    [ -f "$root/backups/staging/manifest.json" ] && mv "$root/backups/staging/manifest.json" "$DATA_DIR/backups/staging/manifest.json"
    PAIRED_MANIFEST="$DATA_DIR/backups/staging/manifest.json"
  fi
  rm -rf "$TMP"
  mkdir -p "$DATA_DIR/tmp" "$DATA_DIR"/queue/pending "$DATA_DIR"/queue/processing "$DATA_DIR"/queue/done "$DATA_DIR"/queue/failed \
    "$DATA_DIR/backups/db" "$DATA_DIR/backups/status"
  if [ "$(uname -s)" = Linux ]; then
    log "Linux host: giving the restored tree to uid $NOTES_UID:$NOTES_GID"
    docker run --rm --network none --user 0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --entrypoint /bin/chown \
      --mount "type=bind,src=$DATA_DIR,dst=/d" "$APP_IMAGE" -R "$NOTES_UID:$NOTES_GID" /d
  fi
  log "files restored: $(find "$DATA_DIR/originals" -type f | wc -l | tr -d ' ') originals, $(find "$DATA_DIR/pages" -name '[0-9][0-9][0-9][0-9].webp' | wc -l | tr -d ' ') page images"
fi

# ---- 2. choose the database snapshot ---------------------------------------------------------------------------------
newest_snapshot() { # the newest snapshot file by name (names carry the UTC time), second drive or data drive
  local d f best="" best_name="" name
  for d in "${BACKUP_COPY_DIR:-}/db" "$BACKUPS_DIR/db"; do
    [ -d "$d" ] || continue
    f="$(find "$d" -maxdepth 1 -type f -name 'notes-????????T??????Z.db' | sort | tail -n 1)"
    [ -n "$f" ] || continue
    name="$(basename "$f")"
    if [ -z "$best" ] || [ "$name" \> "$best_name" ]; then best="$f"; best_name="$name"; fi
  done
  printf '%s' "$best"
}
case "$DBSEL" in
  paired)
    [ -n "$PAIRED_DB" ] || die "the restic snapshot has no paired database (made before staging existed?); use --db newest or --db FILE"
    DBFILE="$PAIRED_DB" MANIFEST="$PAIRED_MANIFEST" ;;
  newest)
    DBFILE="$(newest_snapshot)"
    [ -n "$DBFILE" ] || die "no database snapshot found in ${BACKUP_COPY_DIR:-(no second drive)}/db or $BACKUPS_DIR/db"
    MANIFEST="$DBFILE.json" ;;
  *)
    [ -f "$DBSEL" ] || die "database snapshot file not found: $DBSEL"
    DBFILE="$DBSEL" MANIFEST="$DBSEL.json" ;;
esac
[ "$DBSEL" = paired ] || [ "$DB_ONLY" = 1 ] || ALLOW_MISSING=1 # a database newer than the tree may point at newer uploads
EXPECT_SHA=""
STORAGE_ID=""
if [ -f "$MANIFEST" ]; then
  EXPECT_SHA="$(json_get "$MANIFEST" sha256)"
  STORAGE_ID="$(json_get "$MANIFEST" storageId)"
fi
if [ -z "$EXPECT_SHA" ]; then warn "no manifest beside $DBFILE; its checksum cannot be compared (integrity_check still runs)"; fi
if [ -n "$STORAGE_ID" ] && storage_present; then
  actual_id="$(json_get "$DATA_DIR/.notes-storage" storageId)"
  [ "$actual_id" = "$STORAGE_ID" ] || die "this database belongs to storage $STORAGE_ID but $DATA_DIR holds storage $actual_id: wrong drive or wrong backup"
fi
log "restoring database $(basename "$DBFILE") (from $(dirname "$DBFILE"))"

# ---- 3. database into a fresh volume -----------------------------------------------------------------------------------
db_volume_exists || docker volume create "$DB_VOLUME" >/dev/null
docker run --rm --network none --read-only --user 0 --cap-drop ALL \
  --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --security-opt no-new-privileges:true \
  --mount "type=volume,src=$DB_VOLUME,dst=/db" \
  --mount "type=bind,src=$(dirname "$DBFILE"),dst=/in,readonly" \
  --entrypoint node "$APP_IMAGE" /app/tools/restore-db.mjs --from "/in/$(basename "$DBFILE")" \
  ${EXPECT_SHA:+--sha256 "$EXPECT_SHA"} --uid "$NOTES_UID" --gid "$NOTES_GID" >/dev/null ||
  die "database restore failed; the volume $DB_VOLUME was left as it is"

# ---- 4. verify ----------------------------------------------------------------------------------------------------------
log "verifying (database integrity, every original, page images and counts)"
verify_args=()
[ "$QUICK" = 0 ] || verify_args+=(--quick)
[ "$ALLOW_MISSING" = 0 ] || verify_args+=(--allow-missing)
set +e
report="$(docker run --rm --network none --read-only --user "$NOTES_UID:$NOTES_GID" --cap-drop ALL --security-opt no-new-privileges:true \
  --mount "type=volume,src=$DB_VOLUME,dst=/db" --mount "type=bind,src=$DATA_DIR,dst=/data,readonly" \
  --entrypoint node "$APP_IMAGE" /app/tools/verify.mjs ${verify_args[@]+"${verify_args[@]}"})"
verify_status=$?
set -e
printf '%s\n' "$report"
if [ "$verify_status" -ne 0 ]; then die "verification FAILED; do not start the stack on this restore"; fi
missing="$(printf '%s' "$report" | json_get - missingOriginals)"
if [ "${missing:-0}" != 0 ]; then warn "$missing file row(s) point at originals the file backup does not hold (uploaded after it). Those files show as unavailable; everything else is intact."; fi
log "restore complete. Start the stack with: scripts/up.sh"
