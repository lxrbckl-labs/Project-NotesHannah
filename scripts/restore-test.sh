#!/usr/bin/env bash
# The restore drill, automated. The proof that a backup can bring the whole thing back.
#
#   scripts/restore-test.sh [--keep]
#
# On temporary paths and a private Docker project it:
#   1. builds the images and runs scripts/setup.sh (storage, first account, stack up)
#   2. creates library content, uploads real fixtures (PPTX, PDF, HEIC) and lets the REAL converter process them
#   3. takes a full backup (database snapshot first, then restic)
#   A. loses the drive and Docker's volume completely, restores from restic, starts the stack, and asserts that the
#      user can sign in and every file, page image, transcript, document and library item is back, byte for byte
#   B. loses only the Docker volume (a Docker reset), restores the newest database snapshot, asserts the same
#   C. loses the drive again after a NEWER upload that the file backup does not have: restores the newest database
#      with the older file tree and asserts the restore reports exactly that gap and everything else is intact
#   D. asserts that a restore refuses a live target and refuses a wrong typed confirmation
# shellcheck disable=SC2015 # "A && pass || flunk" is deliberate: pass cannot fail
# Exit status 0 only if every assertion passed. --keep leaves the temporary directory and stack in place.
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
KEEP=0
[ "${1:-}" != --keep ] || KEEP=1
need_docker
need node
restic_available || die "restic is required for the drill (brew install restic)"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/notes-restore-test.XXXXXX")"
WORK="$(cd "$WORK" && pwd -P)"
PORT=$((38000 + $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 900))
export NOTES_ENV_FILE="$WORK/env"
ENVF="$WORK/env"
ENV_FILE="$ENVF"
BASE="http://127.0.0.1:$PORT"
FAILED=0
T0="$(now_epoch)"
PHASE_T="$T0"
RUN() { local c="$1"; shift; "$SCRIPTS_DIR/$c" "$@"; }
e2e() { node "$SCRIPTS_DIR/lib/e2e.mjs" "$@" --base "$BASE" --user hannah --pass "$PASSWORD"; }
phase() { local n; n="$(now_epoch)"; printf '\n== %s  (+%ss, total %ss)\n' "$1" $((n - PHASE_T)) $((n - T0)); PHASE_T="$n"; }
pass() { printf 'PASS %s\n' "$1"; }
flunk() { printf 'FAIL %s\n' "$1"; FAILED=$((FAILED + 1)); }
check() { local label="$1"; shift; if "$@" >"$WORK/check.out" 2>&1; then pass "$label"; else flunk "$label"; sed 's/^/    /' "$WORK/check.out" | tail -n 12; fi; }
expect_fail() { local label="$1"; shift; if "$@" >"$WORK/check.out" 2>&1; then flunk "$label (it succeeded)"; else pass "$label"; fi; }

cleanup() {
  set +e
  if [ "$KEEP" = 1 ]; then echo "kept $WORK (project notes-rt, port $PORT)"; return; fi
  NOTES_ENV_FILE="$ENVF" docker compose -p notes-rt --env-file "$ENVF" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1
  docker volume rm notes-rt-db >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/drive1/notes" "$WORK/drive2/backups"
SETS=(--set COMPOSE_PROJECT_NAME=notes-rt --set APP_IMAGE=notes-app:restore-test --set CONVERTER_IMAGE=notes-converter:restore-test
  --set NOTES_SUBNET=10.77.211.0/24 --set "TRUSTED_PROXIES=10.77.211.1,127.0.0.1" --set POLL_MS=200 --set HEARTBEAT_MS=1000)

phase "1. setup: build, initialise storage, create the first account, start"
RUN setup.sh --data-dir "$WORK/drive1/notes" --backup-copy-dir "$WORK/drive2/backups" --origin "$BASE" --port "$PORT" \
  --username hannah "${SETS[@]}" >"$WORK/setup.log" 2>&1 || { tail -n 30 "$WORK/setup.log"; die "setup failed"; }
PASSWORD="$(sed -n 's/^Password (shown once): //p' "$WORK/setup.log" | head -n 1)"
[ -n "$PASSWORD" ] || die "could not read the generated password from the setup output"
check "stack is up and healthy after setup" curl -sf "$BASE/healthz"
load_env

phase "2. create content: library, document, uploads converted by the real converter"
e2e seed --out "$WORK/state.json" | tee "$WORK/seed.out"
SEEDED_FILES="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).files.length)' "$WORK/state.json")"
check "three files converted" test "$SEEDED_FILES" = 3

phase "3. full backup (database snapshot first, then the file tree)"
RUN backup.sh >"$WORK/backup.log" 2>&1 || { cat "$WORK/backup.log"; flunk "full backup"; }
cat "$WORK/backup.log"
check "backup wrote a database snapshot on the data drive" test -n "$(find "$BACKUPS_DIR/db" -name 'notes-*.db')"
check "backup wrote a database snapshot on the second drive" test -n "$(find "$BACKUP_COPY_DIR/db" -name 'notes-*.db')"
check "restic repository holds a snapshot" sh -c "RESTIC_PASSWORD='$RESTIC_PASSWORD' restic -r '$BACKUP_COPY_DIR/restic' snapshots --json | grep -q '\"short_id\"'"

destroy_volume() { RUN down.sh >/dev/null 2>&1; docker volume rm "$DB_VOLUME" >/dev/null; }
destroy_drive() { find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; } # the drive is replaced by an empty one

phase "A. lose the drive and the Docker volume; restore everything from restic"
destroy_volume
destroy_drive
check "volume is gone" sh -c "! docker volume inspect $DB_VOLUME >/dev/null 2>&1"
check "data directory is empty" test -z "$(ls -A "$DATA_DIR")"
RUN restore.sh --restic local >"$WORK/restore-a.log" 2>&1 && pass "restore.sh succeeded and verified" || { tail -n 20 "$WORK/restore-a.log"; flunk "restore.sh"; }
grep -E 'files restored|"ok"' "$WORK/restore-a.log" | cut -c1-200
RUN up.sh >"$WORK/up-a.log" 2>&1 || { tail -n 20 "$WORK/up-a.log"; flunk "up after restore"; }
check "the user signs in with the same password" e2e login
check "a wrong password is still refused (401)" node "$SCRIPTS_DIR/lib/e2e.mjs" login --expect-fail --base "$BASE" --user hannah --pass "not-the-password-0"
check "every file, page image, transcript, document and library item is back, byte for byte" e2e verify --expect "$WORK/state.json"
node "$SCRIPTS_DIR/lib/e2e.mjs" verify --expect "$WORK/state.json" --base "$BASE" --user hannah --pass "$PASSWORD" 2>&1 | tail -n 1

phase "D. a restore refuses a live target and a wrong confirmation"
RUN down.sh >/dev/null 2>&1
expect_fail "restore into the live installation is refused" "$SCRIPTS_DIR/restore.sh" --restic local
expect_fail "restore --overwrite with a wrong confirmation is refused" sh -c "echo 'yes please' | '$SCRIPTS_DIR/restore.sh' --restic local --overwrite"
RUN up.sh >/dev/null 2>&1
check "the data is still intact after the refusals" e2e verify --expect "$WORK/state.json"

phase "B. lose only the Docker volume (a Docker reset); restore the newest database snapshot"
e2e add-note --parent "$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(s.nodes.find(n=>n.section==="study_guides").id)' "$WORK/state.json")" \
  --title "Written after the nightly backup" >/dev/null
e2e capture --out "$WORK/state-b.json"
RUN backup.sh --db-only --quiet
destroy_volume
RUN restore.sh --db-only --db newest >"$WORK/restore-b.log" 2>&1 && pass "database-only restore verified" || { tail -n 20 "$WORK/restore-b.log"; flunk "db-only restore"; }
RUN up.sh >/dev/null 2>&1
check "the note written after the nightly backup is back too" e2e verify --expect "$WORK/state-b.json"

phase "C. lose the drive after an upload the file backup does not have"
LATE_ID="$(e2e upload --file "$REPO_DIR/fixtures/generated/image-only.pdf" | tail -n 1)"
check "the late upload converts" test "$(e2e wait --id "$LATE_ID")" = converted
RUN backup.sh --db-only --quiet
RUN down.sh >/dev/null 2>&1
docker volume rm "$DB_VOLUME" >/dev/null
destroy_drive
RUN restore.sh --restic local --db newest >"$WORK/restore-c.log" 2>&1 && pass "restore with the newest database over the older tree finished" || { tail -n 20 "$WORK/restore-c.log"; flunk "restore C"; }
check "the restore names the one dangling file" grep -q '1 file row(s) point at originals' "$WORK/restore-c.log"
RUN up.sh >/dev/null 2>&1
check "the newest notes are back" sh -c "node '$SCRIPTS_DIR/lib/e2e.mjs' capture --out '$WORK/state-c.json' --base '$BASE' --user hannah --pass '$PASSWORD' >/dev/null && node -e '
const a=JSON.parse(require(\"fs\").readFileSync(process.argv[1]));const b=JSON.parse(require(\"fs\").readFileSync(process.argv[2]));
const ids=new Set(b.files.map(f=>f.id));process.exit(a.files.every(f=>ids.has(f.id))&&a.documents.length===b.documents.length?0:1)' '$WORK/state-b.json' '$WORK/state-c.json'"

phase "result"
TOTAL=$(($(now_epoch) - T0))
if [ "$FAILED" -eq 0 ]; then printf '\nrestore drill PASSED in %ss\n' "$TOTAL"; else printf '\nrestore drill FAILED: %s check(s) in %ss\n' "$FAILED" "$TOTAL"; exit 1; fi
