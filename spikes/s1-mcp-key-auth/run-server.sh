#!/bin/zsh
# generates .env with a fresh key if missing (untracked), starts the server
cd "$(dirname "$0")"
[ -f .env ] || echo "MCP_KEY=nh_test_$(openssl rand -hex 16)" > .env
set -a; . ./.env; set +a
exec npx tsx server.ts
