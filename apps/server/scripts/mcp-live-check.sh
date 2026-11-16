#!/usr/bin/env bash
# Live proof of the MCP layer against the real stack.
#
# Starts the real server on a throwaway database and storage directory, builds
# (if needed) and starts the REAL converter container against the same storage
# with the lockdown flags of deploy/docker-compose.converter.yml, creates a user
# and a write key with the admin CLI, and runs a headless agent (Claude Code
# and/or Codex) with only this server's tools plus curl and Read, asking it to
# get two fixture files in, transcribe them, file them and write a cited study
# guide. Then it checks the result from the database (mcp-live-check.verify.ts).
#
# Usage (from apps/server):  scripts/mcp-live-check.sh [claude|codex|both|smoke|measure] [guide|requests|canvas]
#   guide (default): the two fixture files, filed and turned into a cited study guide.
#   requests: she (seeded through the HTTP API with her session) has a lecture note with a
#     paragraph she wrote, two unprocessed uploads, and two requests: "this is wrong: fix the
#     dose" on her paragraph and "make me a quiz on beta blockers" on the lecture. Checked by
#     mcp-live-check.verify-more.ts.
#   canvas: lecture 7 with a cited study guide (written through the API by a seed agent key) and
#     three cards she pinned on its study map (her session); the agent arranges the map into frames
#     with labelled connectors and adds a note, without moving her pins. Checked by
#     mcp-live-check.verify-canvas.ts.
#   measure: token cost of the tool listing and of start_here, read from Codex's usage.
# Env: PORT (8790), CLAUDE_MODEL (haiku), BUDGET_USD (3), KEEP=1 keeps the temp dir,
#      CONVERTER_IMAGE (notes-converter:mcp-live; built from deploy/converter.Dockerfile if missing).
set -euo pipefail

cd "$(dirname "$0")/.."
SERVER_DIR="$(pwd)"
REPO="$(cd ../.. && pwd)"
WHICH="${1:-claude}"
SCENARIO="${2:-guide}"
PORT="${PORT:-8790}"
BASE="http://127.0.0.1:${PORT}"
IMAGE="${CONVERTER_IMAGE:-notes-converter:mcp-live}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/notes-mcp-live.XXXXXX")"
DECK="$REPO/fixtures/generated/lecture.pptx"
NOTES="$REPO/fixtures/generated/image-only.pdf"
CONTAINER="notes-converter-live-$$"
PROMPT="${PROMPT:-You are connected to an app you have never seen. There is a lecture deck at $DECK and handwritten-style notes at $NOTES. Get them into the app, wait for them to be processed, transcribe every page carefully, file them under a course 'Pharmacology II' in term 'Fall 2026' as lecture 7 'Beta blockers' (use the real topic of the deck if different), and write a study guide document for that lecture with headings, at least one callout and a table, where every content block cites the page it came from. Then tell me what you did and anything the app refused.}"

export NODE_ENV=development DATA_DIR="$TMP/data" DB_PATH="$TMP/notes.db" PORT APP_ORIGIN="$BASE"
echo "work dir: $TMP"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  if [[ "${KEEP:-0}" != "1" ]]; then rm -rf "$TMP"; else echo "kept $TMP"; fi
}
trap cleanup EXIT

# ---- storage, user, key ---------------------------------------------------------------
npx tsx src/cli/admin.ts init-storage --create-dir >/dev/null
PASSWORD="$(npx tsx src/cli/admin.ts create-user hannah --name "Hannah" --generate </dev/null |
  sed -n 's/^Password (shown once): //p')"
NOTES_MCP_KEY="$(npx tsx src/cli/admin.ts create-key hannah --name "live check" --scope write |
  sed -n 's/^Secret (shown once): //p')"
export NOTES_MCP_KEY

# ---- the real converter, locked down as in deploy/docker-compose.converter.yml --------------
# The compose default user 10001:10001. init-storage makes the directories 0700 for this
# user: Docker Desktop on macOS (virtiofs) does not enforce host ownership, so that works
# as is (checked 2026-11-15); on Linux set CONVERTER_USER to this user's uid:gid, the
# documented alternative to a shared group (docs/converter.md, step 7).
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -f "$REPO/deploy/converter.Dockerfile" -t "$IMAGE" "$REPO"
fi
docker run -d --name "$CONTAINER" --init \
  --network none --read-only --user "${CONVERTER_USER:-10001:10001}" \
  --cap-drop ALL --security-opt no-new-privileges:true --ipc none \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1g,mode=1777 \
  --memory 3g --memory-swap 3g --cpus 2 --pids-limit 256 \
  --ulimit nofile=1024:1024 --ulimit core=0 --ulimit fsize=2147483648 \
  -e DATA_DIR=/data \
  --mount "type=bind,source=$DATA_DIR/originals,target=/data/originals,readonly" \
  --mount "type=bind,source=$DATA_DIR/pages,target=/data/pages" \
  --mount "type=bind,source=$DATA_DIR/queue,target=/data/queue" \
  "$IMAGE" >/dev/null

# ---- the real server (routes, MCP, queue watcher) ---------------------------------------
npx tsx src/index.ts >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 100); do
  curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 0.2
done
for _ in $(seq 1 50); do
  [[ -f "$DATA_DIR/queue/heartbeat" ]] && break
  sleep 0.5
done
echo "converter heartbeat: $(cat "$DATA_DIR/queue/heartbeat" 2>/dev/null || echo none)"

if [[ "$SCENARIO" == "canvas" ]]; then
  SEED_KEY="$(npx tsx src/cli/admin.ts create-key hannah --name "seed" --scope write |
    sed -n 's/^Secret (shown once): //p')"
  SEED="$(npx tsx scripts/mcp-live-check.seed-canvas.ts "$BASE" hannah "$PASSWORD" "$DECK" "$SEED_KEY")"
  echo "seeded: $SEED"
  CANVAS_PROMPT="Arrange lecture 7's study map into frames by topic with labelled connectors between related cards, and add a note card summarising the single most important point. Do not move anything she placed. Report what you did."
  PROMPT="${PROMPT_CANVAS:-$CANVAS_PROMPT}"
fi
if [[ "$SCENARIO" == "requests" ]]; then
  SEED="$(npx tsx scripts/mcp-live-check.seed.ts "$BASE" hannah "$PASSWORD" "$DECK" "$NOTES")"
  echo "seeded: $SEED"
  PROMPT="${PROMPT_REQUESTS:-Check what Hannah has asked for and do it, then finish any unprocessed files, then make sure lecture 7 has concepts recorded and a 12-question mixed practice set including two dose calculations and four flashcards. Report what you did.}"
fi

# The key stays in the environment; the config only references it.
cat >"$TMP/notes-mcp.json" <<EOF
{"mcpServers":{"notes":{"type":"http","url":"$BASE/mcp","headers":{"Authorization":"Bearer \${NOTES_MCP_KEY}"}}}}
EOF

summarise() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const clip = (s, n) => String(s).replace(/\s+/g, " ").slice(0, n);
    for (const line of readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      for (const p of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (p.type === "tool_use") console.log(`CALL ${p.name} ${clip(JSON.stringify(p.input), 300)}`);
        if (p.type === "tool_result") {
          const text = Array.isArray(p.content) ? p.content.map((c) => c.text ?? `[${c.type}]`).join(" ") : p.content;
          console.log(`  ${p.is_error ? "ERROR" : "ok"}: ${clip(text, 300)}`);
        }
      }
      if (e.type === "result") console.log(`RESULT turns=${e.num_turns} cost=$${e.total_cost_usd} duration=${Math.round(e.duration_ms / 1000)}s\n${e.result}`);
      const i = e.item;
      if (e.type === "item.completed" && i?.type === "mcp_tool_call") {
        console.log(`CALL ${i.tool} ${clip(JSON.stringify(i.arguments), 300)}`);
        console.log(`  ${i.status}: ${clip(JSON.stringify(i.result ?? i.error), 300)}`);
      }
      if (e.type === "item.completed" && i?.type === "command_execution") console.log(`SHELL ${clip(i.command, 200)} -> ${i.exit_code}`);
      if (e.type === "item.completed" && i?.type === "agent_message") console.log(`SAY ${i.text}`);
      if (e.type === "turn.completed") console.log(`USAGE ${JSON.stringify(e.usage)}`);
    }
  ' "$1"
}

run_claude() {
  echo "== Claude Code (${CLAUDE_MODEL:-haiku})"
  (cd "$TMP" && claude -p --model "${CLAUDE_MODEL:-haiku}" --strict-mcp-config --mcp-config "$TMP/notes-mcp.json" \
    --allowedTools "mcp__notes" "Bash(curl:*)" "Read" --permission-mode dontAsk \
    --output-format stream-json --verbose --max-budget-usd "${BUDGET_USD:-3}" \
    "$PROMPT" </dev/null >"$TMP/claude.jsonl" 2>"$TMP/claude.err") || echo "claude exited $?"
  summarise "$TMP/claude.jsonl"
}

run_codex() {
  if ! command -v codex >/dev/null || ! codex login status >/dev/null 2>&1; then
    echo "== Codex skipped (not installed or not logged in)"
    return
  fi
  echo "== Codex"
  mkdir -p "$TMP/codex-cwd"
  codex exec --ignore-user-config --ephemeral --skip-git-repo-check --json \
    -s workspace-write -c 'sandbox_workspace_write.network_access=true' \
    -C "$TMP/codex-cwd" --add-dir "$REPO/fixtures/generated" \
    -c "mcp_servers.notes.url=\"$BASE/mcp\"" \
    -c 'mcp_servers.notes.bearer_token_env_var="NOTES_MCP_KEY"' \
    -c 'mcp_servers.notes.default_tools_approval_mode="approve"' \
    "$PROMPT" </dev/null >"$TMP/codex.jsonl" 2>"$TMP/codex.err" || echo "codex exited $?"
  summarise "$TMP/codex.jsonl"
}

# A tool call by hand, for the smoke mode: JSON-RPC over curl, as any client would send it.
mcp_call() {
  curl -fsS "$BASE/mcp" -H "Authorization: Bearer $NOTES_MCP_KEY" -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
}

run_smoke() {
  echo "== Smoke: upload the deck through a link and wait for the real converter"
  local bytes url id
  bytes=$(wc -c <"$DECK" | tr -d ' ')
  url=$(mcp_call source_files "{\"action\":\"upload_links\",\"files\":[{\"name\":\"lecture.pptx\",\"bytes\":$bytes}]}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.structuredContent.tickets[0].url))')
  id=$(curl -fsS -X PUT --data-binary @"$DECK" "$url" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).file.id))')
  for _ in 1 2 3 4 5 6; do
    mcp_call source_files "{\"action\":\"wait\",\"fileIds\":[\"$id\"]}" |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).result.structuredContent.message;console.log(m);process.exit(/All converted|failed/.test(m)?0:1)})' && break
  done
}

# Tokens of the tool listing and of start_here, as Claude Code reports its context: one
# haiku session that loads every notes tool schema with ToolSearch, then calls start_here.
# Each assistant turn's usage (input + cache read + cache write) is the context it saw, so
# the growth between turns is what each step added. (Codex's usage could not be used: its
# input tokens did not grow with the MCP server attached.)
run_measure() {
  (cd "$TMP" && claude -p --model haiku --strict-mcp-config --mcp-config "$TMP/notes-mcp.json" \
    --allowedTools "mcp__notes" --permission-mode dontAsk --output-format stream-json --verbose \
    --max-budget-usd 0.3 \
    "First use ToolSearch to load the schemas of ALL tools whose names start with mcp__notes (one query: +notes, max_results 20). Then call mcp__notes__start_here once with no arguments. Then reply with the single word OK." \
    </dev/null >"$TMP/measure.jsonl" 2>/dev/null) || true
  node "$SERVER_DIR/scripts/mcp-live-check.tokens.mjs" "$TMP/measure.jsonl"
}

case "$WHICH" in
  smoke) run_smoke; exit 0 ;;
  measure) run_measure; exit 0 ;;
  claude) run_claude ;;
  codex) run_codex ;;
  both) run_claude; echo "(a second agent on the same library; see the verify output)"; run_codex ;;
esac

echo "== Server log (agents, uploads, refusals)"
grep -E "mcp refused|error|Error" "$TMP/server.log" | head -40 || true
echo "== Converter log (tail)"
docker logs "$CONTAINER" 2>&1 | tail -10 || true
echo "== Verification from the database"
if [[ "$SCENARIO" == "canvas" ]]; then
  (cd "$SERVER_DIR" && npx tsx scripts/mcp-live-check.verify-canvas.ts hannah "$SEED") || echo "verification found problems"
elif [[ "$SCENARIO" == "requests" ]]; then
  (cd "$SERVER_DIR" && npx tsx scripts/mcp-live-check.verify-more.ts hannah "$SEED") || echo "verification found problems"
else
  (cd "$SERVER_DIR" && npx tsx scripts/mcp-live-check.verify.ts hannah) || echo "verification found problems"
fi
cp "$TMP"/*.jsonl "${LIVE_OUT:-$TMP}/" 2>/dev/null || true
