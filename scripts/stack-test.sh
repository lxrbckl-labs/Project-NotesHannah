#!/usr/bin/env bash
# Integration test of the REAL stack: the real server image and the real converter image, started from the production
# compose file against temporary paths.
#
#   scripts/stack-test.sh [--keep]
#
# Asserts: both images build; setup works; sign-in over HTTP; a write API key; upload tickets; a PPTX, a PDF and a HEIC
# from fixtures/ are converted by the real converter; files reach "converted"; page images are served; originals are
# byte-identical; the container lockdown and mounts are what the compose file promises; the converter has no network;
# the app is reachable only on loopback; the proxy-trust value (TRUSTED_PROXIES) matches what the app really sees; a
# missing drive and an empty mount point are refused; stopping, killing and restarting mid-conversion loses nothing;
# file-ownership behaves the same under Linux permission semantics (an ext4 volume).
# Exit status 0 only if every assertion passed. --keep leaves the temporary directory and stack in place.
# shellcheck disable=SC2016 # single quotes are deliberate: node -e programs and docker inspect templates
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
KEEP=0
[ "${1:-}" != --keep ] || KEEP=1
need_docker
need node

WORK="$(mktemp -d "${TMPDIR:-/tmp}/notes-stack-test.XXXXXX")"
WORK="$(cd "$WORK" && pwd -P)"
PORT=$((37000 + $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 900))
export NOTES_ENV_FILE="$WORK/env"
ENVF="$WORK/env"
ENV_FILE="$ENVF"
BASE="http://127.0.0.1:$PORT"
FAILED=0
T0="$(now_epoch)"
e2e() { node "$SCRIPTS_DIR/lib/e2e.mjs" "$@" --base "$BASE" --user hannah --pass "$PASSWORD"; }
phase() { printf '\n== %s  (total %ss)\n' "$1" $(($(now_epoch) - T0)); }
pass() { printf 'PASS %s\n' "$1"; }
flunk() { printf 'FAIL %s\n' "$1"; FAILED=$((FAILED + 1)); }
check() { local label="$1"; shift; if "$@" >"$WORK/check.out" 2>&1; then pass "$label"; else flunk "$label"; sed 's/^/    /' "$WORK/check.out" | tail -n 12; fi; }
expect_fail() { local label="$1"; shift; if "$@" >"$WORK/check.out" 2>&1; then flunk "$label (it succeeded)"; sed 's/^/    /' "$WORK/check.out" | tail -n 5; else pass "$label"; fi; }
eq() { [ "$1" = "$2" ] || { echo "expected '$2', got '$1'"; return 1; }; }

# Compose reads the shell environment before --env-file, and load_env exported the main stack's values: run the
# side scenarios (missing drive, empty mount point) with those variables removed, so only their own env file counts.
dcx() {
  local proj="$1" envf="$2"
  shift 2
  (
    unset DATA_DIR APP_PORT APP_ORIGIN NOTES_SUBNET COMPOSE_PROJECT_NAME TRUSTED_PROXIES APP_IMAGE CONVERTER_IMAGE NOTES_UID NOTES_GID APP_MEM_LIMIT
    docker compose -p "$proj" --env-file "$envf" -f "$COMPOSE_FILE" "$@"
  )
}
has_output() { # has_output PATTERN command...: the command's output (any exit status) contains PATTERN
  local pat="$1" out
  shift
  out="$("$@" 2>&1 || true)"
  case "$out" in *"$pat"*) return 0 ;; *) echo "$out" | tail -n 4; return 1 ;; esac
}
running_count() { docker ps -q --filter "label=com.docker.compose.project=$1" | wc -l | tr -d ' '; }
never_started() { # never_started CONTAINER-ID...: none of them has ever run
  local id started
  for id in "$@"; do
    [ -n "$id" ] || continue # no container at all: Docker refused to create it
    started="$(docker inspect -f '{{.State.StartedAt}}' "$id")"
    case "$started" in 0001-*) ;; *) echo "$id started at $started"; return 1 ;; esac
  done
}
strip_hash() { sed 's/"sha256":"[0-9a-f]*",//' "$1"; }
same_conversion() { diff <(strip_hash "$1") <(strip_hash "$2"); }
first_files_unchanged() { # state.json state-final.json
  node -e '
const fs = require("fs");
const a = JSON.parse(fs.readFileSync(process.argv[1]));
const b = JSON.parse(fs.readFileSync(process.argv[2]));
const m = new Map(b.files.map((f) => [f.id, f]));
process.exit(a.files.every((f) => JSON.stringify(f) === JSON.stringify(m.get(f.id))) ? 0 : 1);' "$1" "$2"
}
in_conv() { docker exec "$CONV_CID" /usr/local/bin/node -e "$1"; }

cleanup() {
  set +e
  if [ "$KEEP" = 1 ]; then echo "kept $WORK (project notes-st, port $PORT)"; return; fi
  for p in notes-st notes-st-absent notes-st-empty notes-st-nomark; do
    docker compose -p "$p" --env-file "$ENVF" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1
    docker volume rm "$p-db" >/dev/null 2>&1
  done
  docker volume rm notes-st-linux >/dev/null 2>&1
  chmod -R u+rwX "$WORK" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/drive1/notes" "$WORK/drive2/backups"
SETS=(--set COMPOSE_PROJECT_NAME=notes-st --set APP_IMAGE=notes-app:stack-test --set CONVERTER_IMAGE=notes-converter:stack-test
  --set NOTES_SUBNET=10.77.212.0/24 --set "TRUSTED_PROXIES=10.77.212.1,127.0.0.1" --set POLL_MS=200 --set HEARTBEAT_MS=1000)

phase "1. build both images from the repository and run setup"
b0="$(now_epoch)"
"$SCRIPTS_DIR/setup.sh" --data-dir "$WORK/drive1/notes" --backup-copy-dir "$WORK/drive2/backups" --origin "$BASE" --port "$PORT" \
  --username hannah "${SETS[@]}" >"$WORK/setup.log" 2>&1 || { tail -n 40 "$WORK/setup.log"; die "setup failed"; }
echo "setup (build, init-storage, create-user, up) took $(($(now_epoch) - b0))s"
PASSWORD="$(sed -n 's/^Password (shown once): //p' "$WORK/setup.log" | head -n 1)"
[ -n "$PASSWORD" ] || die "no generated password in the setup output"
load_env
check "app image exists" docker image inspect "$APP_IMAGE"
check "converter image exists" docker image inspect "$CONVERTER_IMAGE"
check "healthz answers over HTTP" curl -sf "$BASE/healthz"
check "storage marker written by the CLI in the container" test -f "$DATA_DIR/.notes-storage"
for d in originals pages queue/pending queue/processing queue/done queue/failed tmp; do check "layout: $d/" test -d "$DATA_DIR/$d"; done
expect_fail "compose refuses to run without APP_ORIGIN" sh -c "APP_ORIGIN= docker compose -p x --env-file /dev/null -f '$COMPOSE_FILE' config"

phase "2. the real server meets the real converter"
e2e seed --out "$WORK/state.json" | tee "$WORK/seed.out"
check "sign in over HTTP, write key, tickets, PPTX + PDF + HEIC converted, transcript saved" grep -q '^seeded:' "$WORK/seed.out"
node -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1]));
const fx = require("path").resolve(process.argv[2]);
const crypto = require("crypto"), fs = require("fs");
const want = { "lecture.pptx": "pptx", "text-layer.pdf": "pdf", "photo.heic": "heic" };
let bad = 0;
for (const f of s.files) {
  const local = crypto.createHash("sha256").update(fs.readFileSync(`${fx}/${f.originalName}`)).digest("hex");
  const line = (ok, m) => { console.log(`${ok ? "PASS" : "FAIL"} ${f.originalName}: ${m}`); if (!ok) bad++; };
  line(f.status === "converted", `status ${f.status}`);
  line(f.type === want[f.originalName], `type ${f.type}`);
  line(f.pageCount > 0 && f.pages.length === f.pageCount, `${f.pages.length} page rows, pageCount ${f.pageCount}`);
  line(f.pages.every((p) => p.image.page.status === 200 && p.image.page.type === "image/webp" && p.image.thumb.status === 200), "every page and thumbnail image is served as image/webp");
  line(f.originalSha256 === local && f.sha256 === local, "original served byte-identical to the fixture (sha256)");
}
process.exit(bad ? 1 : 0)' "$WORK/state.json" "$REPO_DIR/fixtures/generated" | tee "$WORK/assert.out" || true
FAILED=$((FAILED + $(grep -c '^FAIL' "$WORK/assert.out" || true)))
for f in "$DATA_DIR"/originals/*/*; do
  name="$(basename "$f")"
  [ "$(sha256_of "$f")" = "$name" ] || flunk "stored original $name does not hash to its file name"
done
pass "every stored original hashes to its file name"
check "the queue is empty (every job finished)" test -z "$(find "$DATA_DIR/queue/pending" "$DATA_DIR/queue/processing" "$DATA_DIR/queue/done" "$DATA_DIR/queue/failed" -name 'job_*.json')"

phase "3. container lockdown and mounts, as running"
APP_CID="$(dc ps -q app)"
CONV_CID="$(dc ps -q converter)"
insp() { docker inspect "$1" --format "$2"; }
check "app runs as 10001:10001" eq "$(insp "$APP_CID" '{{.Config.User}}')" 10001:10001
check "app root filesystem is read-only" eq "$(insp "$APP_CID" '{{.HostConfig.ReadonlyRootfs}}')" true
check "app drops all capabilities" eq "$(insp "$APP_CID" '{{.HostConfig.CapDrop}}')" "[ALL]"
check "app has no-new-privileges" eq "$(insp "$APP_CID" '{{.HostConfig.SecurityOpt}}')" "[no-new-privileges:true]"
check "app restart policy unless-stopped" eq "$(insp "$APP_CID" '{{.HostConfig.RestartPolicy.Name}}')" unless-stopped
check "app log rotation 10m x 5" eq "$(insp "$APP_CID" '{{index .HostConfig.LogConfig.Config "max-size"}} {{index .HostConfig.LogConfig.Config "max-file"}}')" "10m 5"
check "app has a healthcheck and it is healthy" eq "$(insp "$APP_CID" '{{.State.Health.Status}}')" healthy
check "app publishes only on 127.0.0.1" eq "$(insp "$APP_CID" '{{range $p, $b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}')" "127.0.0.1:$PORT"
check "database is a NAMED VOLUME mounted at /db" eq "$(insp "$APP_CID" '{{range .Mounts}}{{if eq .Destination "/db"}}{{.Type}} {{.Name}}{{end}}{{end}}')" "volume notes-st-db"
check "data directory is a BIND mount at /data" eq "$(insp "$APP_CID" '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}} {{.RW}}{{end}}{{end}}')" "bind true"
check "create_host_path is off on the data bind" eq "$(insp "$APP_CID" '{{range .HostConfig.Mounts}}{{if eq .Target "/data"}}{{.BindOptions.CreateMountpoint}}{{end}}{{end}}')" false
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
if [ -n "$LAN_IP" ]; then expect_fail "app is NOT reachable on the LAN address $LAN_IP" curl -s --max-time 3 -o /dev/null "http://$LAN_IP:$PORT/healthz"; fi
check "converter runs as 10001:10001" eq "$(insp "$CONV_CID" '{{.Config.User}}')" 10001:10001
check "converter has no network (mode none)" eq "$(insp "$CONV_CID" '{{.HostConfig.NetworkMode}}')" none
check "converter root filesystem is read-only" eq "$(insp "$CONV_CID" '{{.HostConfig.ReadonlyRootfs}}')" true
check "converter drops all capabilities" eq "$(insp "$CONV_CID" '{{.HostConfig.CapDrop}}')" "[ALL]"
check "converter has no-new-privileges" eq "$(insp "$CONV_CID" '{{.HostConfig.SecurityOpt}}')" "[no-new-privileges:true]"
check "converter memory 3g, no swap, 2 cpus, 256 pids" eq "$(insp "$CONV_CID" '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}}')" "3221225472 3221225472 2000000000 256"
check "converter has exactly three mounts" eq "$(insp "$CONV_CID" '{{len .Mounts}}')" 3
check "converter: originals read-only" eq "$(insp "$CONV_CID" '{{range .Mounts}}{{if eq .Destination "/data/originals"}}{{.RW}}{{end}}{{end}}')" false
check "converter: pages read-write" eq "$(insp "$CONV_CID" '{{range .Mounts}}{{if eq .Destination "/data/pages"}}{{.RW}}{{end}}{{end}}')" true
check "converter: queue read-write" eq "$(insp "$CONV_CID" '{{range .Mounts}}{{if eq .Destination "/data/queue"}}{{.RW}}{{end}}{{end}}')" true
check "converter is healthy" eq "$(insp "$CONV_CID" '{{.State.Health.Status}}')" healthy
check "only the loopback interface exists in the converter" eq "$(dc exec -T converter /usr/local/bin/node -e "console.log(Object.keys(require('os').networkInterfaces()).join(','))" | tr -d '\r\n')" lo
expect_fail "the converter cannot reach the app (no network)" in_conv "const s=require('net').connect(3000,'app');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),3000)"
expect_fail "the converter cannot reach the internet" in_conv "const s=require('net').connect(443,'1.1.1.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),3000)"
expect_fail "the converter cannot write to originals (read-only mount)" in_conv "require('fs').writeFileSync('/data/originals/x','x')"
expect_fail "the converter cannot see backups/ or the database" in_conv "require('fs').statSync('/data/backups')"

phase "4. proxy trust: what the app sees when Caddy on the host forwards a request"
e2e throttle-ip --xff 203.0.113.77 --who nobody-throttle >/dev/null
seen="$(dc exec -T app node -e "
const D=require('better-sqlite3');const d=new D('/db/notes.db',{readonly:true});
console.log(d.prepare(\"SELECT subject FROM login_throttle WHERE kind='address' ORDER BY last_failure_at DESC LIMIT 1\").get()?.subject)" | tr -d '\r')"
check "X-Forwarded-For is believed from the host gateway (TRUSTED_PROXIES=10.77.212.1,127.0.0.1)" eq "$seen" 203.0.113.77
gw="$(docker network inspect notes-st-net --format '{{(index .IPAM.Config 0).Gateway}}')"
check "the proxy address the app sees is the network gateway $gw" eq "$gw" 10.77.212.1

phase "5. drive missing and drive not mounted: the app must refuse, Docker must not create anything"
ABSENT="$WORK/gone/notes"
sed -e "s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=notes-st-absent|; s|^DATA_DIR=.*|DATA_DIR=$ABSENT|; s|^APP_PORT=.*|APP_PORT=$((PORT + 1))|; s|^NOTES_SUBNET=.*|NOTES_SUBNET=10.77.213.0/24|" "$ENVF" >"$WORK/env-absent"
check "compose up with a missing host path is refused by Docker: bind source path does not exist (create_host_path: false)" has_output "bind source path does not exist" dcx notes-st-absent "$WORK/env-absent" up -d
check "Docker did NOT create the missing directory" test ! -e "$WORK/gone"
check "no container of that project is running" eq "$(running_count notes-st-absent)" 0
check "the app container was never started" never_started "$(docker ps -a -q --filter label=com.docker.compose.project=notes-st-absent --filter label=com.docker.compose.service=app)" 
dcx notes-st-absent "$WORK/env-absent" down -v >/dev/null 2>&1 || true

EMPTY="$WORK/emptymount"
mkdir -p "$EMPTY"
sed -e "s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=notes-st-empty|; s|^DATA_DIR=.*|DATA_DIR=$EMPTY|; s|^APP_PORT=.*|APP_PORT=$((PORT + 2))|; s|^NOTES_SUBNET=.*|NOTES_SUBNET=10.77.214.0/24|" "$ENVF" >"$WORK/env-empty"
dce() { dcx notes-st-empty "$WORK/env-empty" "$@"; }
expect_fail "a bare empty mount point (what an unmounted drive leaves): up fails" dce up -d --wait --wait-timeout 20
check "...and nothing was started (the converter's binds are missing too)" eq "$(running_count notes-st-empty)" 0
check "...the app container was never started" never_started "$(dce ps -a -q app)"
check "nothing was written into the empty mount point" test -z "$(ls -A "$EMPTY")"
dce down -v >/dev/null 2>&1 || true
# A directory that has the layout but not the marker (a copied or half-restored tree): only the app's own check stops it.
# (A fresh path and a fresh project: Docker Desktop's file sharing remembers "does not exist" for a path it was just
# asked about, and a network of the previous project can still hold its subnet for a moment.)
NOMARK="$WORK/layout-no-marker"
mkdir -p "$NOMARK/originals" "$NOMARK/pages" "$NOMARK/queue"
sed -e "s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=notes-st-nomark|; s|^DATA_DIR=.*|DATA_DIR=$NOMARK|; s|^APP_PORT=.*|APP_PORT=$((PORT + 3))|; s|^NOTES_SUBNET=.*|NOTES_SUBNET=10.77.215.0/24|" "$ENVF" >"$WORK/env-nomark"
dcn() { dcx notes-st-nomark "$WORK/env-nomark" "$@"; }
expect_fail "layout without the .notes-storage marker: up --wait fails because the app refuses to start" dcn up -d --wait --wait-timeout 25
app_refuses() { local out; out="$(dcn logs app 2>&1)"; case "$out" in *"Refusing to start"*) return 0 ;; *) echo "logs: $out" | tail -n 5; dcn ps -a; return 1 ;; esac; }
check "the app log says: Refusing to start (storage marker missing)" app_refuses
check "the converter never started (it waits for a healthy app)" never_started "$(dcn ps -a -q converter)"
dcn down -v >/dev/null 2>&1 || true
expect_fail "scripts/up.sh refuses with a clear message when the marker is missing" env NOTES_ENV_FILE="$WORK/env-nomark" "$SCRIPTS_DIR/up.sh"
check "up.sh's message names the missing marker" sh -c "NOTES_ENV_FILE='$WORK/env-nomark' '$SCRIPTS_DIR/up.sh' 2>&1 | grep -q 'no .notes-storage marker'"

# The live stack, with the drive "unplugged" while it is stopped, then plugged back in.
"$SCRIPTS_DIR/down.sh" >/dev/null 2>&1
mv "$DATA_DIR" "$WORK/unplugged"
expect_fail "docker compose start of the existing containers fails while the drive is away" dc start
expect_fail "scripts/start-when-ready.sh gives up (exit 1) when the drive never appears" "$SCRIPTS_DIR/start-when-ready.sh" 0
check "no stray directory appeared at the old path" test ! -e "$DATA_DIR"
mv "$WORK/unplugged" "$DATA_DIR"
check "start-when-ready.sh brings the stack up once the drive is back" "$SCRIPTS_DIR/start-when-ready.sh" 1

phase "6. stop, kill and restart in the middle of a conversion"
BASELINE_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).files.find(f=>f.originalName==="lecture.pptx").id)' "$WORK/state.json")"
e2e describe --id "$BASELINE_ID" >"$WORK/baseline.json"
wait_processing() { for _ in $(seq 1 300); do [ -n "$(find "$DATA_DIR/queue/processing" -name 'job_*.json' 2>/dev/null)" ] && return 0; sleep 0.05; done; return 1; }
upload_and_catch() { # echoes the file id once its job is being processed
  local id
  id="$(e2e upload --file "$REPO_DIR/fixtures/generated/lecture.pptx" | tail -n 1)"
  wait_processing || { echo "never saw the job in processing/"; return 1; }
  echo "$id"
}
ID1="$(upload_and_catch)" || flunk "could not catch a conversion in flight (stop)"
echo "stopping the whole stack while $ID1 is being converted"
dc stop >/dev/null 2>&1
check "the job went back to pending when the converter was stopped (SIGTERM)" test -n "$(find "$DATA_DIR/queue/pending" -name 'job_*.json')"
dc start >/dev/null 2>&1
check "after restart the interrupted file is converted" eq "$(e2e wait --id "$ID1" --timeout 240000)" converted
e2e describe --id "$ID1" >"$WORK/after-stop.json"
check "the result equals an undisturbed conversion of the same file (pages, sizes, text, image bytes)" same_conversion "$WORK/baseline.json" "$WORK/after-stop.json"

ID2="$(upload_and_catch)" || flunk "could not catch a conversion in flight (kill)"
echo "killing the converter (SIGKILL) while $ID2 is being converted"
docker kill "$(dc ps -q converter)" >/dev/null
sleep 1
dc up -d --wait --wait-timeout 120 >/dev/null 2>&1 || true
check "after a kill and restart the file is converted (crash recovery)" eq "$(e2e wait --id "$ID2" --timeout 240000)" converted
e2e describe --id "$ID2" >"$WORK/after-kill.json"
check "the result equals an undisturbed conversion again" same_conversion "$WORK/baseline.json" "$WORK/after-kill.json"
check "no job files are left over" test -z "$(find "$DATA_DIR/queue/pending" "$DATA_DIR/queue/processing" "$DATA_DIR/queue/done" "$DATA_DIR/queue/failed" -name 'job_*.json')"
e2e capture --out "$WORK/state-final.json" >/dev/null
check "the first three files are unchanged after all of that" first_files_unchanged "$WORK/state.json" "$WORK/state-final.json"

phase "7. file ownership under Linux permission semantics (an ext4 volume, where uid and gid are enforced)"
# Docker Desktop for Mac's bind mount ignores uid and gid, so it cannot show the Linux behaviour. A named volume lives
# on the VM's ext4 and enforces permissions exactly as a Linux host would.
docker volume create notes-st-linux >/dev/null
IMG="$APP_IMAGE"
vrun() { local user="$1" script="$2"; docker run --rm --network none --user "$user" --entrypoint sh --mount type=volume,src=notes-st-linux,dst=/data "$IMG" -c "$script"; }
docker run --rm --network none --user 0 --cap-drop ALL --cap-add CHOWN --entrypoint chown --mount type=volume,src=notes-st-linux,dst=/data "$IMG" 10001:10001 /data
check "the app's CLI initialises storage as 10001 (modes 700)" docker run --rm --network none --user 10001:10001 -e DATA_DIR=/data -e DB_PATH=/tmp/x.db -e APP_ORIGIN=http://x.test --tmpfs /tmp --mount type=volume,src=notes-st-linux,dst=/data --entrypoint node "$IMG" dist/cli/admin.js init-storage
check "layout directories are mode 700 (the app's choice)" eq "$(vrun 10001:10001 'stat -c %a /data/originals /data/queue' | tr '\n' ' ')" "700 700 "
vrun 10001:10001 'umask 077; mkdir -p /data/originals/usr_test && echo original >/data/originals/usr_test/abc'
check "same uid: the converter reads an original the app wrote (dir 700, file 600)" vrun 10001:10001 'cat /data/originals/usr_test/abc'
check "same uid: the converter writes pages/<user>/<file>/ and renames inside queue/" vrun 10001:10001 'umask 002; mkdir -p /data/pages/usr_test/fil_x && echo p >/data/pages/usr_test/fil_x/0001.webp && echo j >/data/queue/pending/.t && mv /data/queue/pending/.t /data/queue/done/job.json'
check "same uid: the app then reads the pages and deletes the queue file" vrun 10001:10001 'cat /data/pages/usr_test/fil_x/0001.webp && rm /data/queue/done/job.json && rm -r /data/pages/usr_test/fil_x'
docker run --rm --network none --user 0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --entrypoint sh --mount type=volume,src=notes-st-linux,dst=/data "$IMG" -c 'mkdir -m 700 /data/originals/usr_other && echo x >/data/originals/usr_other/f && chown -R 1000:1000 /data/originals/usr_other'
expect_fail "different uids (app 1000, converter 10001): the converter CANNOT read the app's 700 directory" vrun 10001:10001 'cat /data/originals/usr_other/f'

phase "result"
TOTAL=$(($(now_epoch) - T0))
if [ "$FAILED" -eq 0 ]; then printf '\nstack test PASSED in %ss\n' "$TOTAL"; else printf '\nstack test FAILED: %s check(s) in %ss\n' "$FAILED" "$TOTAL"; exit 1; fi
