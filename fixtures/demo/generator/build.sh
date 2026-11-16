#!/usr/bin/env bash
# Rebuild the pharmacy demo files in fixtures/demo/files from scratch (needs Docker).
#   fixtures/demo/generator/build.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../files"
rm -rf "$out"; mkdir -p "$out"
docker build -q -t notes-demo-generator "$here" >/dev/null
docker run --rm -v "$out":/out notes-demo-generator /out
# Format the manifest the way the repo's Biome config wants it, so `pnpm lint` stays clean.
(cd "$here/../../.." && pnpm exec biome format --write fixtures/demo/files/manifest.json >/dev/null)
echo "demo files written to $out"; du -sh "$out"
