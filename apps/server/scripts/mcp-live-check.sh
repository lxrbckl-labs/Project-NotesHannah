#!/usr/bin/env bash
# Live check of the MCP layer with real agents.
#
# Starts the real server on a throwaway database and storage directory,
# creates a user with the admin CLI, signs in and creates a read-write API key
# the way she would in Settings, then runs a headless Claude Code session (and
# Codex, when it is logged in) against /mcp with only this server's tools.
# Transcripts and the server log are kept in the temp directory it prints.
#
# Usage (from apps/server):  scripts/mcp-live-check.sh [claude|codex|both]
# Env: PORT (default 8790), CLAUDE_MODEL (default haiku), BUDGET_USD (default 1),
#      PROMPT (default: the orientation task below).
set -euo pipefail

cd "$(dirname "$0")/.."
WHICH="${1:-both}"
PORT="${PORT:-8790}"
BASE="http://127.0.0.1:${PORT}"
ORIGIN="http://localhost:5173"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/notes-mcp-live.XXXXXX")"
PROMPT="${PROMPT:-You have been connected to an app you have never seen. Find out what it is, then create a term 'Fall 2026' with a course 'Pharmacology II', add lectures numbered 1 to 3 with plausible titles, then deliberately try to create a document at the top level and report what the app told you.}"

export NODE_ENV=development DATA_DIR="$TMP/storage" DB_PATH="$TMP/notes.db" PORT APP_ORIGIN="$ORIGIN"
echo "work dir: $TMP"

npx tsx src/cli/admin.ts init-storage --create-dir >/dev/null
CREATED="$(npx tsx src/cli/admin.ts create-user hannah --name "Hannah" --generate </dev/null)"
PASSWORD="$(printf '%s\n' "$CREATED" | sed -n 's/^Password (shown once): //p')"

npx tsx src/index.ts >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break
  sleep 0.2
done

LOGIN_BODY="$(node -e 'console.log(JSON.stringify({username:"hannah",password:process.argv[1]}))' "$PASSWORD")"
curl -fsS -c "$TMP/cookies" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -d "$LOGIN_BODY" "$BASE/api/auth/login" >/dev/null
NOTES_MCP_KEY="$(curl -fsS -b "$TMP/cookies" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -d '{"name":"live check","scope":"write"}' "$BASE/api/keys" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).secret))')"
export NOTES_MCP_KEY
rm -f "$TMP/cookies"

# The key stays in the environment; the config only references it.
cat >"$TMP/notes-mcp.json" <<EOF
{"mcpServers":{"notes":{"type":"http","url":"$BASE/mcp","headers":{"Authorization":"Bearer \${NOTES_MCP_KEY}"}}}}
EOF

summarise() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const lines = readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      const parts = e.message?.content ?? [];
      for (const p of Array.isArray(parts) ? parts : []) {
        if (p.type === "tool_use") console.log(`CALL ${p.name} ${JSON.stringify(p.input)}`);
        if (p.type === "tool_result") {
          const text = Array.isArray(p.content) ? p.content.map((c) => c.text ?? `[${c.type}]`).join(" ") : String(p.content);
          console.log(`  ${p.is_error ? "ERROR" : "ok"}: ${text.replace(/\s+/g, " ").slice(0, 300)}`);
        }
        if (p.type === "text" && e.type === "assistant") console.log(`SAY ${p.text.replace(/\s+/g, " ").slice(0, 400)}`);
      }
      if (e.type === "result") console.log(`RESULT turns=${e.num_turns} cost=$${e.total_cost_usd} ${String(e.result).replace(/\s+/g, " ").slice(0, 1200)}`);
      if (e.type === "item.completed" && e.item) {
        const i = e.item;
        if (i.type === "mcp_tool_call") console.log(`CALL ${i.tool} ${JSON.stringify(i.arguments)}\n  ${i.status}: ${JSON.stringify(i.result ?? i.error).slice(0, 300)}`);
        if (i.type === "agent_message") console.log(`SAY ${String(i.text).replace(/\s+/g, " ").slice(0, 1200)}`);
      }
      if (e.type === "turn.completed") console.log(`USAGE ${JSON.stringify(e.usage)}`);
    }
  ' "$1"
}

if [[ "$WHICH" == "claude" || "$WHICH" == "both" ]]; then
  echo "== Claude Code (${CLAUDE_MODEL:-haiku})"
  claude -p --model "${CLAUDE_MODEL:-haiku}" --strict-mcp-config --mcp-config "$TMP/notes-mcp.json" \
    --allowedTools "mcp__notes" --permission-mode dontAsk \
    --output-format stream-json --verbose --max-budget-usd "${BUDGET_USD:-1}" \
    "$PROMPT" </dev/null >"$TMP/claude.jsonl" 2>"$TMP/claude.err" || echo "claude exited $?"
  summarise "$TMP/claude.jsonl"
fi

if [[ "$WHICH" == "codex" || "$WHICH" == "both" ]]; then
  if command -v codex >/dev/null && codex login status >/dev/null 2>&1; then
    echo "== Codex"
    mkdir -p "$TMP/codex-cwd"
    codex exec --ignore-user-config --ephemeral --skip-git-repo-check --json -s read-only \
      -C "$TMP/codex-cwd" \
      -c "mcp_servers.notes.url=\"$BASE/mcp\"" \
      -c 'mcp_servers.notes.bearer_token_env_var="NOTES_MCP_KEY"' \
      -c 'mcp_servers.notes.default_tools_approval_mode="approve"' \
      "$PROMPT" </dev/null >"$TMP/codex.jsonl" 2>"$TMP/codex.err" || echo "codex exited $?"
    summarise "$TMP/codex.jsonl"
  else
    echo "== Codex skipped (not installed or not logged in)"
  fi
fi

echo "== Audit log (what the agents changed)"
node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.argv[1], { readonly: true });
  for (const r of db.prepare("SELECT at, tool, action, outcome, target_ids FROM mcp_audit ORDER BY seq").all())
    console.log(`${r.at} ${r.tool} ${r.action ?? ""} ${r.outcome} ${r.target_ids}`);
' "$DB_PATH"
echo "transcripts and server log: $TMP"
