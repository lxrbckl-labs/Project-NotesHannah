#!/usr/bin/env bash
# Build the two images and push them to the registry, so Watchtower on the mini rolls them out.
#
#   scripts/publish.sh            build and push app and converter, tagged :latest and :<commit>
#   scripts/publish.sh --dry-run  build only, push nothing
#
# Run it from a clean checkout of main that has passed `pnpm gate`. The machine needs a registry login that
# may write packages (`docker login ghcr.io`). The mini is arm64, so that is the only platform built.
set -euo pipefail
cd "$(dirname "$0")/.."

REGISTRY="${NOTES_REGISTRY:-ghcr.io/lxrbckl-labs}"
PLATFORM="${NOTES_PLATFORM:-linux/arm64}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
die() { log "ERROR $*" >&2; exit 1; }

[ -z "$(git status --porcelain)" ] || die "the checkout has uncommitted changes; commit or stash first"
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = main ] || die "on branch $branch; publish from main"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main is not the same as origin/main; push or pull first"
sha="$(git rev-parse --short HEAD)"

build() {
  local name="$1" dockerfile="$2" image="$REGISTRY/$1"
  log "building $image ($sha, $PLATFORM)"
  docker build --platform "$PLATFORM" -f "$dockerfile" -t "$image:latest" -t "$image:$sha" \
    --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
    --label "org.opencontainers.image.source=https://github.com/lxrbckl-labs/Project-NotesHannah" .
  if [ "$DRY" = 1 ]; then log "dry run: not pushing $image"; return; fi
  docker push "$image:$sha"
  docker push "$image:latest"
  log "pushed $image:latest and :$sha"
}

build notes-app deploy/Dockerfile
build notes-converter deploy/converter.Dockerfile
log "done: commit $sha"
