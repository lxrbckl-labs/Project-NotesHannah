#!/usr/bin/env bash
# Restore drill on the REAL backups: restore the newest restic snapshot into a throwaway location, start the app on
# it, check it answers and holds the same accounts, then throw everything away. Proves the backups of this machine
# can actually be restored, and writes the result where scripts/status.sh shows it (status/last-drill.json).
#   scripts/drill.sh [--remote]      monthly, from launchd. Needs room for a full copy of the data.
# (scripts/restore-test.sh is the other drill: synthetic data, run when the tooling changes.)
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
WHICH=local
[ "${1:-}" != --remote ] || WHICH=remote
load_env
need_docker
LIVE_STATUS_DIR="$BACKUPS_DIR/$STATUS_DIR_NAME"
STAMP="$(stamp_now)"
base="${DRILL_DIR:-}"
if [ -z "$base" ]; then
  if backup_copy_ready; then base="$BACKUP_COPY_DIR/drill"; else base="${TMPDIR:-/tmp}/notes-drill"; fi
fi
WORK="${base%/}-$STAMP"
PROJECT="${COMPOSE_PROJECT_NAME}-drill"
PORT=$((39000 + $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 900))
SUBNET="10.77.$((150 + $(od -An -N1 -tu1 /dev/urandom | tr -d ' ') % 100)).0/24"
result=fail detail="did not finish"
started="$(now_epoch)"

finish() {
  rc=$?
  set +e
  NOTES_ENV_FILE="$WORK/env" docker compose -p "$PROJECT" --env-file "$WORK/env" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1
  docker volume rm "$PROJECT-db" >/dev/null 2>&1
  rm -rf "$WORK"
  took=$(($(now_epoch) - started))
  if [ -d "$LIVE_STATUS_DIR" ] || mkdir -p "$LIVE_STATUS_DIR" 2>/dev/null; then
    printf '{"at":"%s","result":"%s","detail":"%s","seconds":%s}\n' "$(ts)" "$result" "$detail" "$took" >"$LIVE_STATUS_DIR/last-drill.json"
  fi
  log "restore drill: $result ($detail) in ${took}s"
  exit "$rc"
}
trap finish EXIT

mkdir -p "$WORK/data"
cp "$ENV_FILE" "$WORK/env"
chmod 600 "$WORK/env"
set_var "$WORK/env" COMPOSE_PROJECT_NAME "$PROJECT"
set_var "$WORK/env" DATA_DIR "$WORK/data"
set_var "$WORK/env" APP_PORT "$PORT"
set_var "$WORK/env" APP_ORIGIN "http://127.0.0.1:$PORT"
set_var "$WORK/env" NOTES_SUBNET "$SUBNET"
set_var "$WORK/env" TRUSTED_PROXIES ""
# Restore reads the repository of the live install; the drill's own backup directory stays empty.
repo="$(local_repo)"
if [ "$WHICH" = local ]; then set_var "$WORK/env" RESTIC_REPOSITORY "$repo"; fi
set_var "$WORK/env" BACKUP_COPY_DIR ""

detail="restore failed"
NOTES_ENV_FILE="$WORK/env" "$SCRIPTS_DIR/restore.sh" --restic "$WHICH" --snapshot latest >"$WORK/restore.log" 2>&1 || { tail -n 15 "$WORK/restore.log" >&2; exit 1; }
detail="restored data did not start"
NOTES_ENV_FILE="$WORK/env" "$SCRIPTS_DIR/up.sh" >"$WORK/up.log" 2>&1 || { tail -n 15 "$WORK/up.log" >&2; exit 1; }
detail="app does not answer"
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/healthz" || true)"
[ "$code" = 200 ] || exit 1
detail="user count differs from the backup's manifest"
manifest="$WORK/data/backups/staging/manifest.json"
want="$(json_get "$manifest" users)"
got="$(NOTES_ENV_FILE="$WORK/env" "$SCRIPTS_DIR/admin.sh" list-users 2>/dev/null | grep -vc '^No users' || true)"
[ "${want:-x}" = "${got:-y}" ] || exit 1
result=pass
detail="snapshot restored, verified, app answered, $got account(s)"
