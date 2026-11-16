#!/usr/bin/env bash
# Run every fixture through run-sandboxed.sh and print a result table.
# Each case: name | file | expected ("ok:<type>:<pages>" or an error code) | env overrides
set -u
cd "$(dirname "$0")"
F=fixtures/generated
RUNS="${RUNS:-runs}"
rm -rf "$RUNS"; mkdir -p "$RUNS"
cases=(
  "lecture-pptx|lecture.pptx|ok:pptx:12|"
  "text-layer-pdf|text-layer.pdf|ok:pdf:5|"
  "image-only-pdf|image-only.pdf|ok:pdf:4|"
  "photo-exif6-jpg|photo-exif6.jpg|ok:jpeg:1|"
  "photo-exif3-png|photo-exif3.png|ok:png:1|"
  "photo-heic|photo.heic|ok:heic:1|"
  "lies-pptx-named-pdf|lies-pptx-named.pdf|ok:pptx:12|"
  "lies-png-named-jpg|lies-png-named.jpg|ok:png:1|"
  "lies-pdf-named-pptx|lies-pdf-named.pptx|ok:pdf:5|"
  "encrypted-ownerpw-only|encrypted-ownerpw-only.pdf|ok:pdf:5|"
  "encrypted-userpw-pdf|encrypted-userpw.pdf|ENCRYPTED|"
  "encrypted-pptx|encrypted.pptx|ENCRYPTED|"
  "truncated-pptx|truncated.pptx|CORRUPT_FILE|"
  "junkxml-pptx|junkxml.pptx|CORRUPT_FILE|"
  "corrupt-pdf|corrupt.pdf|CORRUPT_FILE|"
  "truncated-jpg|truncated.jpg|CORRUPT_FILE|"
  "zipbomb-pptx|zipbomb.pptx|DECOMPRESSION_BOMB|"
  "pixelbomb-png|pixelbomb.png|PIXEL_BOMB|"
  "toomany-301pages|toomany-301pages.pdf|TOO_MANY_PAGES|"
  "toomany-override|lecture.pptx|TOO_MANY_PAGES|MAX_PAGES=5"
  "toolarge-override|photo-exif6.jpg|FILE_TOO_LARGE|MAX_INPUT_BYTES=100000"
  "timeout-override|lecture.pptx|TIMEOUT|WALL_CLOCK_MS=1200"
  "docx-unsupported|other-office.docx|UNSUPPORTED_TYPE|"
  "plain-text-named-pdf|plain-text.pdf|UNSUPPORTED_TYPE|"
)
printf '%-24s %-10s %-22s %6s %8s  %s\n' CASE RESULT DETAIL WALL_S PEAK_MB VERDICT
for c in "${cases[@]}"; do
  IFS='|' read -r name file expect envs <<<"$c"
  out="$RUNS/$name"
  start=$(date +%s.%N 2>/dev/null || python3 -c 'import time;print(time.time())')
  res=$(env ${envs:+$envs} ./run-sandboxed.sh "$F/$file" "$out" 2>/dev/null)
  end=$(date +%s.%N 2>/dev/null || python3 -c 'import time;print(time.time())')
  wall=$(python3 -c "print(round($end-$start,1))")
  python3 - "$name" "$expect" "$wall" "$out" "$res" <<'PY'
import json, os, sys
name, expect, wall, out, res = sys.argv[1:6]
r = json.loads(res)
peak = ""
if r["ok"]:
    m = json.load(open(f"{out}/manifest.json"))
    got = f'ok:{m["source"]["detectedType"]}:{m["pageCount"]}'
    peak = round((m["peakMemoryBytes"] or 0) / 1048576)
    detail = got
else:
    got = r["error"]["code"]; detail = got
    leftover = os.listdir(out) if os.path.isdir(out) else []
    if leftover: detail += f" LEFTOVER={leftover}"
verdict = "PASS" if got == expect and "LEFTOVER" not in detail else "FAIL"
print(f"{name:<24} {'ok' if r['ok'] else 'rejected':<10} {detail:<22} {wall:>6} {str(peak):>8}  {verdict}")
PY
done
