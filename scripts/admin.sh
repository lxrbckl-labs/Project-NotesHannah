#!/usr/bin/env bash
# Run an admin command (create-user, reset-password, list-users, disable-user, enable-user, init-storage).
#   scripts/admin.sh create-user NAME --generate
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
load_env
need_docker
need_storage
if app_running; then
  dc exec -T app node dist/cli/admin.js "$@"
else
  dc run --rm -T app node dist/cli/admin.js "$@"
fi
