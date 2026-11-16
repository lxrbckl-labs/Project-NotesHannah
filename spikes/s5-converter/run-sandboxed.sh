#!/usr/bin/env bash
# Run the converter on one untrusted file inside a locked-down, throwaway container.
#
#   run-sandboxed.sh <input-file> <output-dir>
#
# stdout: one JSON line ({"ok":true,...} or {"ok":false,"error":{"code":...}}); exit 0 on success, 2 on a
# rejected/failed file, 64 on bad usage. Container stderr is passed through. The output directory is created
# if missing and must be empty. Nothing is written to it on failure.
#
# Tunables (environment): IMAGE, WALL_CLOCK_S (container watchdog, default 180), MEMORY (default 2g),
# CPUS (default 2), PIDS (default 256), and the converter limits MAX_INPUT_BYTES, MAX_PAGES,
# MAX_ZIP_UNCOMPRESSED_BYTES, MAX_ZIP_ENTRIES, MAX_PIXELS, WALL_CLOCK_MS, PAGE_LONG_EDGE, THUMB_LONG_EDGE.
set -u

IMAGE="${IMAGE:-s5-converter:spike}"
WALL_CLOCK_S="${WALL_CLOCK_S:-180}"
MEMORY="${MEMORY:-2g}"
CPUS="${CPUS:-2}"
PIDS="${PIDS:-256}"

if [ "$#" -ne 2 ]; then echo "usage: $0 <input-file> <output-dir>" >&2; exit 64; fi
input="$1"; outdir="$2"
if [ ! -f "$input" ]; then echo '{"ok":false,"error":{"code":"BAD_USAGE","message":"input is not a file"}}'; exit 64; fi
mkdir -p "$outdir"
input_abs="$(cd "$(dirname "$input")" && pwd -P)/$(basename "$input")"
outdir_abs="$(cd "$outdir" && pwd -P)"
name="s5conv-$$-$RANDOM"

env_args=()
for v in MAX_INPUT_BYTES MAX_PAGES MAX_ZIP_UNCOMPRESSED_BYTES MAX_ZIP_ENTRIES MAX_XML_ENTRY_BYTES MAX_PIXELS \
         WALL_CLOCK_MS PAGE_LONG_EDGE THUMB_LONG_EDGE WEBP_QUALITY RENDER_CONCURRENCY; do
  if [ -n "${!v:-}" ]; then env_args+=(-e "$v=${!v}"); fi
done

# The original file name is never given to the container: it is mounted at a fixed neutral path.
docker_args=(
  run --rm --name "$name" --init
  --network none                                   # no network at all (not even loopback to the host)
  --read-only                                      # root filesystem read-only
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1g,mode=1777   # scratch; counts against the memory limit
  --user 10001:10001                               # non-root
  --cap-drop ALL                                   # no Linux capabilities
  --security-opt no-new-privileges                 # setuid binaries cannot gain privilege
  --memory "$MEMORY" --memory-swap "$MEMORY"       # hard RAM cap, no swap
  --cpus "$CPUS" --pids-limit "$PIDS"              # CPU and fork-bomb limits
  --ulimit nofile=1024:1024 --ulimit fsize=2147483648 --ulimit core=0
  --ipc none
  -v "$input_abs":/input/file:ro                   # input read-only
  -v "$outdir_abs":/output:rw                      # the only writable mount
  ${env_args[@]+"${env_args[@]}"}
  "$IMAGE" /input/file /output
)

stdout_file="$(mktemp)"
start=$(date +%s)
docker "${docker_args[@]}" >"$stdout_file" &
pid=$!
# Wall-clock watchdog: kill the container if the converter's own deadline fails to fire.
( sleep "$WALL_CLOCK_S"; docker kill "$name" >/dev/null 2>&1 && touch "$stdout_file.timeout" ) >/dev/null 2>&1 &
watchdog=$!
wait "$pid"; code=$?
pkill -P "$watchdog" 2>/dev/null; kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null
elapsed=$(( $(date +%s) - start ))

# If the container died without printing a result, synthesise a machine-readable error and clean the output dir.
if ! grep -q '^{' "$stdout_file"; then
  if [ -e "$stdout_file.timeout" ]; then c=TIMEOUT; m="container killed by the wall-clock watchdog after ${WALL_CLOCK_S}s"
  elif [ "$code" = 137 ]; then c=RESOURCE_LIMIT; m="container killed (out of memory or SIGKILL), exit 137"
  else c=INTERNAL_ERROR; m="container exited $code without a result"; fi
  find "$outdir_abs" -mindepth 1 -delete 2>/dev/null
  printf '{"ok":false,"error":{"code":"%s","message":"%s"}}\n' "$c" "$m" >"$stdout_file"
  code=2
fi
cat "$stdout_file"
rm -f "$stdout_file" "$stdout_file.timeout"
echo "[sandbox] container=$name exit=$code wall=${elapsed}s" >&2
exit "$code"
