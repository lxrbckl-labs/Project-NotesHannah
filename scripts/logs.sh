#!/usr/bin/env bash
# Follow the logs of the stack (or of the named services). Docker rotates them: 5 files of 10 MB per container.
#   scripts/logs.sh [app|converter] [extra docker compose logs options]
set -euo pipefail
. "$(dirname "$0")/lib/common.sh"
load_env
need_docker
exec docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail 200 -f "$@"
