#!/usr/bin/env bash
# Rebuild fixtures/generated from scratch (needs Docker; the generator runs in a container).
#   fixtures/generator/build.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../generated"
rm -rf "$out"; mkdir -p "$out"
docker build -q -t notes-fixture-generator "$here" >/dev/null
docker run --rm -v "$out":/out notes-fixture-generator /out
echo "fixtures written to $out"; du -sh "$out"
