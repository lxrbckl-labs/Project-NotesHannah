#!/usr/bin/env bash
# End-to-end test of the converter container with the real lockdown flags (deploy/docker-compose.converter.yml).
#
#   apps/converter/scripts/integration.sh
#
# It builds the image, starts the container against a temporary DATA_DIR, plays the server (drops a job file for
# every fixture, original files filed by SHA-256), waits for results, and checks them: page counts, text and
# notes, error codes, upright photos, originals untouched, nothing written outside pages/ and queue/, no
# network, immutable root filesystem. Then it restarts the container with lowered limits for the limit cases,
# and exercises crash recovery and SIGTERM. Needs Docker, node and a built @notes/schema (pnpm build:schema).
# Exit status 0 only if every check passed. KEEP=1 keeps the temp directory.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
compose_file="$repo/deploy/docker-compose.converter.yml"
check="$here/integration-check.mjs"
work="$(mktemp -d "${TMPDIR:-/tmp}/notes-converter-it.XXXXXX")"
export DATA_DIR="$work/data"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-notes-converter-it}"
# Set CONVERTER_IMAGE to build and test under another tag, so a shared notes-converter image is not retagged.
export CONVERTER_IMAGE="${CONVERTER_IMAGE:-notes-converter}"
export POLL_MS="${POLL_MS:-200}" HEARTBEAT_MS="${HEARTBEAT_MS:-1000}"
dc() { docker compose -f "$compose_file" "$@"; }
fail=0
note() { printf '\n== %s\n' "$*"; }
check_ok() { if "$@"; then echo "PASS $label"; else echo "FAIL $label"; fail=1; fi; }
cleanup() {
  dc down -t 5 >/dev/null 2>&1 || true
  if [ "${KEEP:-}" = 1 ]; then echo "kept $work"; else rm -rf "$work"; fi
}
trap cleanup EXIT

[ -d "$repo/packages/schema/dist" ] || (cd "$repo" && pnpm build:schema)
mkdir -p "$DATA_DIR/originals" "$DATA_DIR/pages" "$DATA_DIR"/queue/{pending,processing,done,failed}
chmod -R 777 "$DATA_DIR"   # the converter runs as uid 10001; the server side of a real deployment owns this decision

note "build"
time dc build
echo "image size: $(docker image inspect "$CONVERTER_IMAGE" --format '{{.Size}}' | awk '{printf "%.0f MB on disk\n", $1/1048576}')"

wait_for_results() { # waits until every dropped job has a result
  local deadline=$((SECONDS + ${1:-900})) line
  while :; do
    line="$(cd "$here/.." && node scripts/integration-check.mjs status "$DATA_DIR" "$work")"
    set -- ${line}; [ "$1" = "$2" ] && return 0
    if [ $SECONDS -gt $deadline ]; then echo "timed out waiting: $line finished"; return 1; fi
    sleep 0.5
  done
}
node_check() { (cd "$here/.." && node scripts/integration-check.mjs "$@"); }

snapshot() { (cd "$DATA_DIR/originals" && find . -type f -print0 | sort -z | xargs -0 shasum -a 256; find . | sort); }
hashes_ok() { (cd "$DATA_DIR/originals" && grep -E '^[0-9a-f]{64}  ' "$work/originals.before" | shasum -a 256 -c --quiet); }

note "phase 1: default limits, every fixture"
node_check prepare "$DATA_DIR" "$work" default
snapshot > "$work/originals.afterprep"   # the originals this run itself placed
cp "$work/originals.afterprep" "$work/originals.before"
dc up -d
cid="$(dc ps -q converter)"
wait_for_results 900 || fail=1
node_check verify "$DATA_DIR" "$work" || fail=1

note "sandbox, probed from the running container"
inspect() { docker inspect "$cid" --format "$1"; }
label="network mode none";           check_ok test "$(inspect '{{.HostConfig.NetworkMode}}')" = none
label="read-only root filesystem";   check_ok test "$(inspect '{{.HostConfig.ReadonlyRootfs}}')" = true
label="all capabilities dropped";    check_ok test "$(inspect '{{.HostConfig.CapDrop}}')" = "[ALL]"
label="no-new-privileges";           check_ok test "$(inspect '{{.HostConfig.SecurityOpt}}')" = "[no-new-privileges:true]"
label="memory limit 3g";             check_ok test "$(inspect '{{.HostConfig.Memory}}')" = 3221225472
label="pids limit 256";              check_ok test "$(inspect '{{.HostConfig.PidsLimit}}')" = 256
label="cpus 2";                      check_ok test "$(inspect '{{.HostConfig.NanoCpus}}')" = 2000000000
label="runs as 10001:10001";         check_ok test "$(inspect '{{.Config.User}}')" = 10001:10001
label="exactly three mounts";        check_ok test "$(inspect '{{len .Mounts}}')" = 3
label="originals mounted read-only"; check_ok test "$(inspect '{{range .Mounts}}{{if eq .Destination "/data/originals"}}{{.RW}}{{end}}{{end}}')" = false
label="pages mounted read-write";    check_ok test "$(inspect '{{range .Mounts}}{{if eq .Destination "/data/pages"}}{{.RW}}{{end}}{{end}}')" = true
label="queue mounted read-write";    check_ok test "$(inspect '{{range .Mounts}}{{if eq .Destination "/data/queue"}}{{.RW}}{{end}}{{end}}')" = true
for _ in $(seq 60); do [ "$(inspect '{{.State.Health.Status}}')" = healthy ] && break; sleep 1; done
label="healthcheck reports healthy"; check_ok test "$(inspect '{{.State.Health.Status}}')" = healthy
exec_in() { dc exec -T converter "$@"; }
label="only loopback has an address"; check_ok test "$(exec_in /usr/local/bin/node -e "console.log(Object.keys(require('os').networkInterfaces()).join(','))" | tr -d '\r\n')" = lo
label="no routes";                   check_ok test "$(exec_in wc -l /proc/net/route | awk '{print $1}')" = 1
label="tcp connect fails";           check_ok exec_in /usr/local/bin/node -e "const s=require('net').connect(443,'1.1.1.1');s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(0),3000)"
label="dns lookup fails";            check_ok exec_in /usr/local/bin/node -e "require('dns').lookup('example.com',(e)=>process.exit(e?0:1))"
label="cannot write to /";           check_ok sh -c "! docker exec $cid sh -c 'touch /etc/x' 2>/dev/null"
label="cannot write to /opt/converter"; check_ok sh -c "! docker exec $cid sh -c 'touch /opt/converter/x' 2>/dev/null"
label="cannot write to originals";   check_ok sh -c "! docker exec $cid sh -c 'touch /data/originals/x' 2>/dev/null"
label="cannot see other data";       check_ok sh -c "! docker exec $cid sh -c 'ls /data/../data/secret /Users /host' >/dev/null 2>&1"
label="cannot exec from /tmp";       check_ok sh -c "! docker exec $cid sh -c 'cp /bin/true /tmp/t && /tmp/t' 2>/dev/null"
# docker diff lists the mount points and docker-init that Docker itself adds; any other path would be a write.
label="rootfs unchanged (docker diff shows only mount points)"; check_ok test -z "$(docker diff "$cid" | grep -vE '^[AC] (/data(/originals|/pages|/queue)?|/usr|/usr/sbin|/usr/sbin/docker-init)$')"
label="runs as uid 10001";           check_ok test "$(exec_in id -u | tr -d '\r\n')" = 10001
label="heartbeat is fresh";          check_ok node -e "const h=JSON.parse(require('fs').readFileSync('$DATA_DIR/queue/heartbeat','utf8'));if(Date.now()-Date.parse(h.updatedAt)>15000||h.state!=='idle')process.exit(1);console.log(JSON.stringify({state:h.state,processed:h.processed,failed:h.failed}))"

note "originals untouched, nothing written outside pages/ and queue/"
snapshot > "$work/originals.after"
label="originals identical by checksum and listing"; check_ok diff "$work/originals.before" "$work/originals.after"
label="no new top-level entries in DATA_DIR";        check_ok diff <( (ls -A "$DATA_DIR" | sort) ) <( (printf '%s\n' originals pages queue) )
label="no stray files under originals";              check_ok test -z "$(find "$DATA_DIR/originals" -newer "$work/originals.afterprep" -type f)"
label="only the three expected queue directories";   check_ok test "$(ls -A "$DATA_DIR/queue" | sort | tr '\n' ' ')" = "done failed heartbeat pending processing "

note "shutdown: SIGTERM while converting returns the job to pending"
# Drop one slow job (the 12-slide deck) and stop the container as soon as it is running.
sha="$(shasum -a 256 "$repo/fixtures/generated/lecture.pptx" | cut -d' ' -f1)"
u="$(ls "$DATA_DIR/originals")"  # phase 1 made exactly one user directory
[ -e "$DATA_DIR/originals/$u/$sha" ] || cp "$repo/fixtures/generated/lecture.pptx" "$DATA_DIR/originals/$u/$sha"
shut_job="job_01JZZZZZZZZZZZZZZZZZZZZZZ1"; shut_file="fil_01JZZZZZZZZZZZZZZZZZZZZZZ1"
printf '{"jobId":"%s","userId":"%s","fileId":"%s","sha256":"%s","createdAt":"%s"}' "$shut_job" "$u" "$shut_file" "$sha" "$(date -u +%FT%TZ)" > "$DATA_DIR/queue/pending/.x.tmp"
mv "$DATA_DIR/queue/pending/.x.tmp" "$DATA_DIR/queue/pending/$shut_job.json"
for _ in $(seq 100); do grep -q '"state":"processing"' "$DATA_DIR/queue/heartbeat" 2>/dev/null && break; sleep 0.1; done
t0=$SECONDS; docker stop -t 30 "$cid" >/dev/null; stop_s=$((SECONDS - t0))
echo "stopped in ${stop_s}s; pending: $(ls "$DATA_DIR/queue/pending" | tr '\n' ' ') done: $(ls "$DATA_DIR/queue/done" | grep -c "$shut_job" || true)"
label="container stopped within 10 s";  check_ok test "$stop_s" -lt 10
if [ -f "$DATA_DIR/queue/done/$shut_job.json" ]; then
  echo "job had already finished before the stop (too fast to interrupt): shutdown path not exercised"; label="shutdown path exercised"; check_ok false
else
  label="interrupted job is back in pending, no result, no staging"; check_ok test -f "$DATA_DIR/queue/pending/$shut_job.json" -a ! -e "$DATA_DIR/queue/failed/$shut_job.json" -a -z "$(ls "$DATA_DIR/queue/processing")" -a -z "$(find "$DATA_DIR/pages" -name '*.tmp-*')"
fi
dc start >/dev/null
for _ in $(seq 100); do [ -f "$DATA_DIR/queue/done/$shut_job.json" ] && break; sleep 0.5; done
label="after restart the job completes"; check_ok test -f "$DATA_DIR/queue/done/$shut_job.json"

note "crash recovery: a job left in processing/ by a killed converter"
dc stop -t 10 >/dev/null
crash_job="job_01JZZZZZZZZZZZZZZZZZZZZZZ2"; crash_file="fil_01JZZZZZZZZZZZZZZZZZZZZZZ2"; dead_job="job_01JZZZZZZZZZZZZZZZZZZZZZZ3"; dead_file="fil_01JZZZZZZZZZZZZZZZZZZZZZZ3"
mkdir -p "$DATA_DIR/pages/$u/$crash_file.tmp-$crash_job" && echo half > "$DATA_DIR/pages/$u/$crash_file.tmp-$crash_job/0001.webp"
printf '{"jobId":"%s","userId":"%s","fileId":"%s","sha256":"%s","createdAt":"%s","attempts":1}' "$crash_job" "$u" "$crash_file" "$sha" "$(date -u +%FT%TZ)" > "$DATA_DIR/queue/processing/$crash_job.json"
printf '{"jobId":"%s","userId":"%s","fileId":"%s","sha256":"%s","createdAt":"%s","attempts":2}' "$dead_job" "$u" "$dead_file" "$sha" "$(date -u +%FT%TZ)" > "$DATA_DIR/queue/processing/$dead_job.json"
dc start >/dev/null
for _ in $(seq 100); do [ -f "$DATA_DIR/queue/done/$crash_job.json" ] && [ -f "$DATA_DIR/queue/failed/$dead_job.json" ] && break; sleep 0.5; done
label="first-time crash victim is retried and succeeds as attempt 2"; check_ok node -e "const r=JSON.parse(require('fs').readFileSync('$DATA_DIR/queue/done/$crash_job.json','utf8'));process.exit(r.ok&&r.attempt===2&&r.pageCount===12?0:1)"
label="twice-crashed job is failed with conversion_failed";           check_ok node -e "const r=JSON.parse(require('fs').readFileSync('$DATA_DIR/queue/failed/$dead_job.json','utf8'));process.exit(!r.ok&&r.errorCode==='conversion_failed'&&r.reason==='crashed'?0:1)"
label="stale staging directory removed";                              check_ok test ! -e "$DATA_DIR/pages/$u/$crash_file.tmp-$crash_job"

note "phase 2: lowered limits, one container restart per case"
dc down -t 10 >/dev/null
while IFS=$'\t' read -r lbl envs; do
  [ -z "$lbl" ] && continue
  rm -f "$work/jobs.json"
  # shellcheck disable=SC2086
  node_check prepare "$DATA_DIR" "$work" "limits:$lbl"
  # shellcheck disable=SC2086
  env $envs docker compose -f "$compose_file" up -d >/dev/null
  wait_for_results 120 || fail=1
  node_check verify "$DATA_DIR" "$work" || fail=1
  docker compose -f "$compose_file" down -t 10 >/dev/null
done < <(node_check limits-labels)

note "originals still untouched after every phase"
label="every original still has its checksum"; check_ok hashes_ok

note "result"
if [ "$fail" = 0 ]; then echo "ALL INTEGRATION CHECKS PASSED"; else echo "SOME INTEGRATION CHECKS FAILED"; fi
exit "$fail"
