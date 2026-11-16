#!/usr/bin/env bash
# First run: create deploy/.env with generated secrets, build the images, initialise the storage drive, create the
# first account and start the stack.
#
#   scripts/setup.sh --data-dir /Volumes/NVME1/notes --backup-copy-dir /Volumes/NVME2/notes-backups \
#                    --origin https://notes.hannahporras.app --port 3000 --username hannah
#
#   --data-dir PATH         storage directory on the external drive; must already exist (never created for you,
#                           unless --create-dir, which is for local testing only)
#   --backup-copy-dir PATH  existing directory on a different drive for the second copy and the local restic repo
#   --origin URL            public origin (default https://notes.hannahporras.app)
#   --port N                host port on 127.0.0.1 (default 3000)
#   --username NAME         first account (default: ask; --no-user skips it)
#   --env-file FILE         write/read this env file instead of deploy/.env
#   --no-start              stop after the account is created
#   --no-build              do not build the images (they must exist already)
#   --set KEY=VALUE         set any other variable of the new env file (repeatable; used by the tests)
#
# Safe to run again: an existing env file, marker and account are kept, nothing is overwritten. The first
# account's password is generated and printed once; it is never written to a file.
set -euo pipefail
export NOTES_ENV_FILE="${NOTES_ENV_FILE:-}"
. "$(dirname "$0")/lib/common.sh"

SETS=()
DATA="" COPY="" ORIGIN="" PORT="" USERNAME="" CREATE_DIR=0 START=1 BUILD=1 NO_USER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir) DATA="${2:?}"; shift ;;
    --backup-copy-dir) COPY="${2:?}"; shift ;;
    --origin) ORIGIN="${2:?}"; shift ;;
    --port) PORT="${2:?}"; shift ;;
    --username) USERNAME="${2:?}"; shift ;;
    --env-file) ENV_FILE="${2:?}"; shift ;;
    --create-dir) CREATE_DIR=1 ;;
    --no-user) NO_USER=1 ;;
    --no-start) START=0 ;;
    --no-build) BUILD=0 ;;
    --set) SETS+=("${2:?}"); shift ;;
    -h | --help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done
[ -z "$NOTES_ENV_FILE" ] || ENV_FILE="$NOTES_ENV_FILE"
need_docker

# ---- 1. env file -----------------------------------------------------------------------------------------------------
random_hex() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
if [ -f "$ENV_FILE" ]; then
  log "using the existing env file $ENV_FILE (nothing in it is overwritten)"
else
  [ -n "$DATA" ] || die "--data-dir is required for a first run"
  cp "$REPO_DIR/deploy/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  set_var "$ENV_FILE" DATA_DIR "${DATA%/}"
  [ -z "$ORIGIN" ] || set_var "$ENV_FILE" APP_ORIGIN "$ORIGIN"
  [ -z "$PORT" ] || set_var "$ENV_FILE" APP_PORT "$PORT"
  if [ -n "$COPY" ]; then set_var "$ENV_FILE" BACKUP_COPY_DIR "${COPY%/}"; else set_var "$ENV_FILE" BACKUP_COPY_DIR ""; fi
  set_var "$ENV_FILE" RESTIC_PASSWORD "$(random_hex)"
  for kv in ${SETS[@]+"${SETS[@]}"}; do set_var "$ENV_FILE" "${kv%%=*}" "${kv#*=}"; done
  log "created $ENV_FILE with a generated restic password"
  warn "COPY the RESTIC_PASSWORD line of $ENV_FILE into your password manager NOW. If this machine is lost and the password with it, the backup repositories cannot be opened."
fi
load_env

# ---- 2. storage directory and backup target -------------------------------------------------------------------------
if [ ! -d "$DATA_DIR" ]; then
  if [ "$CREATE_DIR" = 1 ]; then
    warn "creating $DATA_DIR (--create-dir): fine for a local directory, never do this for a drive mount point"
    mkdir -p "$DATA_DIR"
  else
    die "$DATA_DIR does not exist. Mount the external drive and create the directory on it (mkdir $DATA_DIR), then run this again."
  fi
fi
if [ -n "${BACKUP_COPY_DIR:-}" ]; then
  if [ -d "$BACKUP_COPY_DIR" ]; then
    if [ ! -f "$BACKUP_COPY_DIR/.notes-backup-target" ]; then
      printf 'notes backup target, written by scripts/setup.sh on %s\n' "$(ts)" >"$BACKUP_COPY_DIR/.notes-backup-target"
      log "marked $BACKUP_COPY_DIR as the second backup target"
    fi
  else
    warn "BACKUP_COPY_DIR=$BACKUP_COPY_DIR does not exist; the second copy is OFF until you mount that drive, create the directory and run this script again"
  fi
fi

# ---- 3. images -------------------------------------------------------------------------------------------------------
if [ "$BUILD" = 1 ]; then
  log "building the images (the first build downloads LibreOffice and takes several minutes)"
  dc build
fi

# ---- 4. file ownership (Linux only) ----------------------------------------------------------------------------------
# On Docker Desktop for Mac the bind mount ignores uid and gid (docs/deploy.md), so nothing is needed. On Linux the
# containers run as NOTES_UID:NOTES_GID and the directory must belong to them.
if [ "$(uname -s)" = Linux ] && [ "$(stat -c %u "$DATA_DIR")" != "$NOTES_UID" ]; then
  log "Linux host: giving $DATA_DIR to uid $NOTES_UID:$NOTES_GID"
  docker run --rm --network none --user 0 --cap-drop ALL --cap-add CHOWN --entrypoint /bin/chown \
    --mount "type=bind,src=$DATA_DIR,dst=/d" "$APP_IMAGE" "$NOTES_UID:$NOTES_GID" /d 2>/dev/null ||
    warn "could not chown $DATA_DIR; run: sudo chown $NOTES_UID:$NOTES_GID $DATA_DIR (images must be built first)"
fi

# ---- 5. storage layout and first account -----------------------------------------------------------------------------
log "initialising storage in $DATA_DIR"
dc run --rm -T app node dist/cli/admin.js init-storage

if [ "$NO_USER" = 0 ]; then
  if [ -z "$USERNAME" ] && [ -t 0 ]; then
    printf 'Username for the first account: '
    read -r USERNAME
  fi
  if [ -n "$USERNAME" ]; then
    existing="$(dc run --rm -T app node dist/cli/admin.js list-users 2>/dev/null | cut -f1 || true)"
    if printf '%s\n' "$existing" | grep -qx "$USERNAME"; then
      log "account $USERNAME already exists; not touched"
    else
      log "creating account $USERNAME"
      dc run --rm -T app node dist/cli/admin.js create-user "$USERNAME" --generate
      log "WRITE THE PASSWORD ABOVE DOWN: it is shown once and stored only as a hash. Reset it later with: scripts/admin.sh reset-password $USERNAME --generate"
    fi
  else
    log "no account created (use --username, or scripts/admin.sh create-user NAME --generate)"
  fi
fi

# ---- 6. start --------------------------------------------------------------------------------------------------------
if [ "$START" = 1 ]; then
  "$SCRIPTS_DIR/up.sh"
fi
cat <<EOF

Next:
  1. Add the Caddy site block from docs/deploy.md (reverse_proxy 127.0.0.1:${APP_PORT:-3000}) and reload Caddy.
  2. Install the launchd jobs (docs/deploy.md, "Backups and start-up jobs").
  3. Run scripts/backup.sh once and scripts/status.sh to see it all green.
EOF
