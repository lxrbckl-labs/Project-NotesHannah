# Spike S1: remote MCP with bearer-key login, from Claude Code and Codex CLI

Run 2026-11-15, macOS, Node 25.3.0, Claude Code 2.1.283 (model `haiku`), codex-cli 0.162.1 (logged in via ChatGPT, default model). Everything ran against a local server on 127.0.0.1. Throwaway code.

## Verdict

| | Claude Code | Codex CLI |
|---|---|---|
| Bearer-key login | Works. Wrong key: server rejected with 401, the agent reported the tool unavailable (HTTP 401) and exited cleanly | Works. Wrong key: tool not offered, agent said TOOL UNAVAILABLE, rmcp logged AuthRequired on stderr, exit clean |
| Reads inline image from tool result | Yes (both images) | Yes (both images, and a 7.8 MB one) |
| Download URL path (curl then file read) | Works (Bash curl + Read) | Works only when the sandbox allows localhost network (default workspace-write sandbox: curl exit 7); with `sandbox_workspace_write.network_access=true` it worked and `view_image` read the file |

## Server design (what was built)

- Files: `server.ts`, `make_images.py`, `run-server.sh`, `claude-mcp.json`. Start with `./run-server.sh` (creates an untracked `.env` with a random `MCP_KEY` on first run).
- **Hono + `@hono/node-server` + the SDK's `WebStandardStreamableHTTPServerTransport`** (shipped in @modelcontextprotocol/sdk 1.32.2 under `server/webStandardStreamableHttp.js`). Chosen because it takes a web `Request` and returns a web `Response`, so no Express and no req/res shim; auth is one Hono check before the transport. Stateless: a fresh `McpServer` + transport per request, `sessionIdGenerator: undefined`, `enableJsonResponse: true`. Both agents worked against this with no session id.
- Auth: constant-time compare of `Authorization: Bearer <key>`; otherwise 401 with `WWW-Authenticate: Bearer`.
- Download URL: HMAC-signed (`exp` + `sig` query), 5 minutes, needs no header. Agent shells (curl) therefore need no key.
- Instructions: 218 chars.
- Observation: in stateless mode Claude Code still sent a GET /mcp (answered 200) and one early POST that the server answered 400 (not investigated); sessions still worked.

## Images and ground truth

`images/ground-truth.txt`. slide.png 1568x882 (66 KB, 88 KB base64), printed text plus an invented drug table (Veloprol, Zantrexal, Corbimide). handwritten.png 1400x900 (104 KB, 139 KB base64), Bradley Hand Bold with per-glyph rotation/jitter, includes 72.5, 0.4, 45.5. big.png 3000x2000 (7.8 MB, 10.4 MB base64) blurred-noise background with a code word, for limit testing.

## Transcription accuracy (vs ground truth)

- Claude Code (haiku), inline: slide exact. Handwriting: `q8h` read as `qsh`, `CrCl` as `Crcl`; all decimals (72.5, 0.4, 45.5) and `< 55` correct.
- Claude Code (haiku), via downloaded file + Read: handwriting `yo` read as `y0`, `CrCl` as `Crcl`; `q8h` correct, decimals correct.
- Codex, inline: both images exact (all lines). Download path slide: exact.
- Takeaway: a small model confuses 8/s and l/I in handwriting; dose/unit flags in the real app are warranted. Single sample per cell, not statistics.

## Measured

- Server-side handling time per /mcp call: 0 to 3 ms (get_page_image with 104 KB file: 1 to 3 ms). Client round-trip not instrumented separately.
- Whole headless run, 2 images + overview + list + 2 saves: Claude Code (haiku) 16.4 s API time / 22 s wall, 8 turns, $0.068; Codex 26 s wall, 116k input tokens (106k cached).
- Big image (10.4 MB base64): Claude Code showed no warning or truncation, and read the code word; it reported the image reached it downscaled to 2000x1333. Codex read the code word too, but its event log showed the result flattened into one ~1 MB text blob (`{"content":[{"type":"image"...` with the middle elided), unlike small images, which were logged as structured image blocks. Input tokens stayed ~31k, so the model was not fed 1 MB of text, but whether Codex downsamples or truncates internally was not determined.
- No output-limit warning (MAX_MCP_OUTPUT_TOKENS) appeared in any run. The 25,000-token cap claim was NOT triggered or tested directly; images up to 10 MB base64 passed in Claude Code.

## Claims checked

- Stateless works in both: VERIFIED.
- Codex `bearer_token_env_var`: VERIFIED (`-c 'mcp_servers.notes.bearer_token_env_var="MCP_KEY"'`). Env-var read from the process environment.
- Claude Code header with env expansion `${MCP_KEY}` in `--mcp-config` JSON: VERIFIED.
- Codex 60 s tool timeout: NOT tested (calls took milliseconds).
- Codex reads only first 512 chars of instructions: NOT verified. Observed instead: with a 70-char instruction containing a code word, Codex's model said it could not see it (also not visible when placed after 520 chars). So Codex may not expose server instructions to the model at all in `exec`, or the model only sees them after tools load. Claude Code's model quoted a code word placed past char 570 (so it sees at least that much).
- Claude Code in `-p` used ToolSearch to load the deferred MCP tool schemas before calling them (extra turn).
- Codex MCP tool calls in `exec` need approval: without `default_tools_approval_mode="approve"` the first call fails with "MCP tool call requires approval, but approval policy is never".

## Commands that worked

```
cd spikes/s1-mcp-key-auth && npm i && python3 make_images.py
BIG=1 ./run-server.sh        # port 8799, key in .env
set -a; . ./.env; set +a
```
Claude Code (config `claude-mcp.json`: `{"mcpServers":{"notes":{"type":"http","url":"http://127.0.0.1:8799/mcp","headers":{"Authorization":"Bearer ${MCP_KEY}"}}}}`):
```
claude -p --model haiku --strict-mcp-config --mcp-config claude-mcp.json \
  --allowedTools "mcp__notes" "Bash(curl:*)" "Read" --permission-mode dontAsk \
  --output-format json --max-budget-usd 1 "<prompt>" < /dev/null
```
Codex (no global config touched; `--ignore-user-config` still used the existing login):
```
codex exec --ignore-user-config --ephemeral --skip-git-repo-check --json -s read-only \
  -c 'mcp_servers.notes.url="http://127.0.0.1:8799/mcp"' \
  -c 'mcp_servers.notes.bearer_token_env_var="MCP_KEY"' \
  -c 'mcp_servers.notes.default_tools_approval_mode="approve"' "<prompt>" < /dev/null
# for the curl path add: -s workspace-write -c 'sandbox_workspace_write.network_access=true'
```

## Recommendations for the real server

1. Hono + web-standard transport, stateless, JSON responses; bearer check before the transport; 401 for bad key.
2. Return the image inline AND a signed short-lived URL. Inline is the simplest and worked everywhere tested; the URL is the bulk path (many pages, big files) and for Codex needs the user to allow network in its sandbox.
3. Size page images to about 1568 px long edge PNG/JPEG (Claude downscales beyond ~2000 px anyway); prefer JPEG q85 for photos/handwriting to keep results well under 1 MB. Do not rely on multi-MB inline results in Codex (flattening seen above).
4. Keep server instructions short (well under 500 chars) with the role and "call overview first", but do not put anything essential only there: Codex's model did not surface them in this test. Put conventions in `overview` and tool descriptions.
5. Document for Codex users: `default_tools_approval_mode = "approve"` (or interactive approval) and `bearer_token_env_var`.
6. Reading is reliable enough but not perfect on handwriting (8/s, l/I, 0/o); keep the flag-uncertain-doses safeguard.

## Not verified

Codex 60 s timeout; the 25k-token cap and `MAX_MCP_OUTPUT_TOKENS`; Codex's 512-char instruction claim; client-side per-call latency; larger models on handwriting; behaviour over HTTPS/real network and with Claude Code's remote `claude mcp add` flow (only `--mcp-config` used).
