#!/usr/bin/env bash
# Shared helpers for the scripts in scripts/. Source it; do not run it.
#
#   . "$(dirname "$0")/lib/common.sh"
#
# Works with the bash 3.2 that macOS ships (no associative arrays, no mapfile) and with GNU/BSD userland.
# shellcheck shell=bash

# launchd starts jobs with a bare PATH. Add the usual homes of docker, restic and jq.
PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PATH

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/deploy/docker-compose.yml"
ENV_FILE="${NOTES_ENV_FILE:-$REPO_DIR/deploy/.env}"

# ---- output ------------------------------------------------------------------------------------------------------
QUIET="${QUIET:-0}"
export QUIET
ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { [ "$QUIET" = 1 ] || printf '%s %s\n' "$(ts)" "$*"; }
warn() { printf '%s WARN %s\n' "$(ts)" "$*" >&2; }
die() {
  printf '%s ERROR %s\n' "$(ts)" "$*" >&2
  exit 1
}

# ---- environment -------------------------------------------------------------------------------------------------
# Load the env file into the shell (and, with set -a, into child processes such as restic).
load_env() {
  [ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE (run scripts/setup.sh, or set NOTES_ENV_FILE)"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-notes}"
  APP_IMAGE="${APP_IMAGE:-notes-app}"
  NOTES_UID="${NOTES_UID:-10001}"
  NOTES_GID="${NOTES_GID:-10001}"
  : "${DATA_DIR:?DATA_DIR is not set in $ENV_FILE}"
  case "$DATA_DIR" in
    /*) ;;
    *) die "DATA_DIR must be an absolute path (got: $DATA_DIR)" ;;
  esac
  DATA_DIR="${DATA_DIR%/}"
  DB_VOLUME="${COMPOSE_PROJECT_NAME}-db"
  BACKUPS_DIR="$DATA_DIR/backups"
  export COMPOSE_PROJECT_NAME APP_IMAGE NOTES_UID NOTES_GID DATA_DIR
}

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"; }

dc() {
  docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

docker_ready() { docker info >/dev/null 2>&1; }
need_docker() {
  need docker
  docker_ready || die "the Docker daemon is not reachable (is Docker Desktop running?)"
}

# ---- storage -----------------------------------------------------------------------------------------------------
# The drive is "there" only if the marker file written by `admin init-storage` is. An unmounted drive leaves an
# empty mount point (or nothing) behind, never the marker.
storage_present() { [ -f "$DATA_DIR/.notes-storage" ]; }
need_storage() {
  [ -d "$DATA_DIR" ] || die "storage directory $DATA_DIR does not exist; is the external drive mounted?"
  storage_present || die "$DATA_DIR has no .notes-storage marker; is the external drive mounted, or is this a fresh install (scripts/setup.sh)?"
}

backup_copy_ready() {
  [ -n "${BACKUP_COPY_DIR:-}" ] && [ -d "$BACKUP_COPY_DIR" ] && [ -f "$BACKUP_COPY_DIR/.notes-backup-target" ]
}

# ---- JSON without jq ---------------------------------------------------------------------------------------------
# json_get <file|-> <key>: first value of a flat or nested key (string, number or boolean). Reads stdin with "-".
json_get() {
  local src="$1" key="$2"
  if command -v jq >/dev/null 2>&1; then
    if [ "$src" = "-" ]; then jq -r "[.. | objects | select(has(\"$key\")) | .[\"$key\"]][0] // empty" 2>/dev/null; else
      jq -r "[.. | objects | select(has(\"$key\")) | .[\"$key\"]][0] // empty" "$src" 2>/dev/null
    fi
  else
    if [ "$src" = "-" ]; then tr -d '\n' ; else tr -d '\n' <"$src"; fi |
      sed -n "s/.*\"$key\": *\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p"
  fi
}

# ---- time --------------------------------------------------------------------------------------------------------
now_epoch() { date -u +%s; }
stamp_now() { date -u '+%Y%m%dT%H%M%SZ'; }

# epoch_of_stamp 20261115T120000Z  (pure arithmetic, so it works the same with BSD and GNU date)
epoch_of_stamp() {
  printf '%s' "$1" | awk '{
    y=substr($0,1,4); m=substr($0,5,2)+0; d=substr($0,7,2)+0
    H=substr($0,10,2)+0; M=substr($0,12,2)+0; S=substr($0,14,2)+0
    if (m<=2) y--
    era=int(y/400); yoe=y-era*400
    doy=int((153*(m+(m>2?-3:9))+2)/5)+d-1
    doe=yoe*365+int(yoe/4)-int(yoe/100)+doy
    days=era*146097+doe-719468
    printf "%d\n", days*86400+H*3600+M*60+S }'
}
# epoch_of_iso 2026-11-15T12:00:00.123Z
epoch_of_iso() {
  local s
  s="$(printf '%s' "$1" | sed -n 's/^\([0-9]\{4\}\)-\([0-9][0-9]\)-\([0-9][0-9]\)T\([0-9][0-9]\):\([0-9][0-9]\):\([0-9][0-9]\).*/\1\2\3T\4\5\6Z/p')"
  [ -n "$s" ] && epoch_of_stamp "$s"
}
human_age() {
  local s="$1"
  if [ "$s" -lt 120 ]; then printf '%ss' "$s"
  elif [ "$s" -lt 7200 ]; then printf '%sm' $((s / 60))
  elif [ "$s" -lt 172800 ]; then printf '%sh' $((s / 3600))
  else printf '%sd' $((s / 86400)); fi
}
human_bytes() {
  awk -v b="$1" 'BEGIN{ split("B KB MB GB TB",u); i=1; while (b>=1024 && i<5) {b/=1024; i++} printf (i==1?"%d %s":"%.1f %s"), b, u[i] }'
}

# ---- checksums ---------------------------------------------------------------------------------------------------
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
file_bytes() { wc -c <"$1" | tr -d ' '; }

# ---- locks (mkdir is atomic; works on macOS, which has no flock) ---------------------------------------------------
LOCK_DIR=""
lock_acquire() { # name [wait-seconds]
  local name="$1" wait="${2:-0}" waited=0 holder
  LOCK_DIR="${TMPDIR:-/tmp}"
  LOCK_DIR="${LOCK_DIR%/}/notes-${COMPOSE_PROJECT_NAME:-notes}-$name.lock"
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$LOCK_DIR" # the holder died without releasing
      continue
    fi
    if [ "$waited" -ge "$wait" ]; then return 1; fi
    sleep 1
    waited=$((waited + 1))
  done
  echo $$ >"$LOCK_DIR/pid"
  trap 'lock_release' EXIT
  return 0
}
lock_release() { [ -n "$LOCK_DIR" ] && rm -rf "$LOCK_DIR"; LOCK_DIR=""; }

# ---- app image tools ---------------------------------------------------------------------------------------------
app_running() { [ -n "$(dc ps --status running -q app 2>/dev/null)" ]; }
db_volume_exists() { docker volume inspect "$DB_VOLUME" >/dev/null 2>&1; }

# run_tool <script.mjs> [args]: run one of deploy/tools inside the app image against the live database volume and
# the data directory. Uses the running app container when there is one, otherwise a locked-down one-off container.
run_tool() {
  local script="$1"
  shift
  if app_running; then
    dc exec -T app node "/app/tools/$script" "$@"
  else
    db_volume_exists || die "database volume $DB_VOLUME does not exist (a Docker reset?). Restore it with scripts/restore.sh."
    docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
      --user "$NOTES_UID:$NOTES_GID" -e DB_PATH=/db/notes.db -e DATA_DIR=/data \
      --mount "type=volume,src=$DB_VOLUME,dst=/db" \
      --mount "type=bind,src=$DATA_DIR,dst=/data" \
      --entrypoint node "$APP_IMAGE" "/app/tools/$script" "$@"
  fi
}

# ---- restic ------------------------------------------------------------------------------------------------------
restic_available() { command -v restic >/dev/null 2>&1; }
local_repo() { printf '%s' "${RESTIC_REPOSITORY:-${BACKUP_COPY_DIR:+$BACKUP_COPY_DIR/restic}}"; }
# restic_in <local|remote> restic-args...
restic_in() {
  local which="$1"
  shift
  case "$which" in
    local) RESTIC_REPOSITORY="$(local_repo)" RESTIC_PASSWORD="${RESTIC_PASSWORD:-}" restic "$@" ;;
    remote) RESTIC_REPOSITORY="${RESTIC_REMOTE_REPOSITORY:-}" RESTIC_PASSWORD="${RESTIC_REMOTE_PASSWORD:-${RESTIC_PASSWORD:-}}" restic "$@" ;;
    *) die "restic_in: unknown repository $which" ;;
  esac
}
repo_configured() {
  case "$1" in
    local) [ -n "${RESTIC_PASSWORD:-}" ] && [ -n "$(local_repo)" ] ;;
    remote) [ -n "${RESTIC_REMOTE_REPOSITORY:-}" ] && [ -n "${RESTIC_REMOTE_PASSWORD:-${RESTIC_PASSWORD:-}}" ] ;;
  esac
}

# ---- status files (JSON, on the data drive so they travel with it) ---------------------------------------------------
STATUS_DIR_NAME="status"
write_status() { # name json
  mkdir -p "$BACKUPS_DIR/$STATUS_DIR_NAME" 2>/dev/null || return 0
  printf '%s\n' "$2" >"$BACKUPS_DIR/$STATUS_DIR_NAME/$1.json.tmp" && mv "$BACKUPS_DIR/$STATUS_DIR_NAME/$1.json.tmp" "$BACKUPS_DIR/$STATUS_DIR_NAME/$1.json"
}

# set_var <file> <KEY> <value>: replace KEY=... in an env file, or append it. Values must not contain '|'.
set_var() {
  local file="$1" key="$2" value="$3"
  if grep -q "^$key=" "$file"; then
    # The file holds secrets: write the replacement private from the start, since mv would carry a looser mode over.
    (umask 077 && sed -e "s|^$key=.*|$key=$value|" "$file" >"$file.new") && mv "$file.new" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
  chmod 600 "$file"
}
