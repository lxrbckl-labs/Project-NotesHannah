
# MCP layer

The agents' front door. The app contains no AI; Claude Code and Codex operate it through
this endpoint on their own subscriptions. Code: `apps/server/src/mcp/`. Agent-facing
setup guide: [agent-guide.md](agent-guide.md), served as `GET /agents.txt` (and pointed
to from `/robots.txt`).

Related: [architecture.md](architecture.md) (MCP layer, agent orientation),
[api.md](api.md) (the web API over the same services), [blocks.md](blocks.md) (writer
operations), [converter.md](converter.md) (how uploads become pages),
`spikes/s1-mcp-key-auth/FINDINGS.md` (what the two agents do with images and keys).

## State (2026-11-15)

Everything below is live on the shared services: `createApp` passes the one `Services`
object to `mcpRoutes(deps, services)`, so MCP and the HTTP API run the same domain code.
All twelve tools are registered in production. Proved end to end with the real server,
the real converter container and headless Claude Code and Codex sessions (see Live checks).

## Endpoint

| | |
|---|---|
| URL | `POST /mcp` on the main server (same origin as the web app) |
| Transport | Streamable HTTP, **stateless** (a fresh server per request, no session ID), JSON responses, SDK `WebStandardStreamableHTTPServerTransport` on Hono |
| `GET /mcp`, `DELETE /mcp` | `405` with `Allow: POST` (no standing SSE stream, no session to end) |
| Auth | `Authorization: Bearer <api key>` only. Browser sessions are refused. No Origin check (a key is not an ambient credential). |
| Bad or missing key | `401`, `WWW-Authenticate: Bearer realm="notes"` (plus `error="invalid_token"` when a key was sent), body `{ error: ApiError }` whose hint says Settings, API keys, and points at `/agents.txt` |
| Keys | made by her in Settings, or by the operator: `admin create-key <username> --name "Claude Code" --scope write` (prints the secret once) |
| Server instructions | 300 characters: role, and "call start_here first" (Codex does not show them to its model; the first tool's description says the same) |
| Agent name | from `X-Agent-Label`, else the User-Agent (`claude-code/…` is "Claude Code", `codex…` is "Codex"); shown in the activity log |

## Tools

| Tool | Purpose | Annotations |
|---|---|---|
| `start_here` | Orientation, the end-to-end workflow and live facts; optional `topic` | read-only |
| `browse_library` | One level of the tree, or trash, favourites, recents; paged | read-only |
| `get_item` | Any object by ID with links to its neighbours; a file's pages with transcription state, or (`text: true`) every page's text at once | read-only |
| `search_notes` | Unified search: library names, transcribed pages and document blocks in one ranked list | read-only |
| `edit_library` | create, update (rename), move, duplicate, trash, restore | destructive |
| `changes` | The change feed since a cursor | read-only |
| `source_files` | list (inbox with status and transcription progress), wait (for conversion), claim, release, file, move (or back to the inbox), retry | write |
| `get_page` | Page image inline (WebP) or a signed link; native text, notes, the current transcript, neighbours, how often it is cited | read-only |
| `save_transcript` | Verbatim transcript with flags; refuses unflagged doses | write |
| `request_upload_links` | Single-use PUT links for local files | write |
| `write_document` | `create_document` with its first blocks | write |
| `edit_blocks` | insert, update (replace or patch), move, delete, replace_generated, restore_revision | destructive |

`openWorldHint` is false everywhere. `destructiveHint` is true for the two tools that can
remove or overwrite content (`edit_library` trash, `edit_blocks`), though both are
recoverable.

### The workflow `start_here` teaches

1. Files on the agent's machine: `request_upload_links` (name and size; an upper bound is
   accepted), then `curl -X PUT --data-binary @file <url>`; the PUT answers with the file.
   Files she uploaded are already in the inbox (`source_files list`).
2. `source_files wait` (up to 25 s per call, polled on the server so the agent does not
   loop or sleep); call again while converting. A failed conversion shows its reason;
   `retry` once, else tell her. If the converter is not online, nothing converts: tell her.
3. `claim` each file.
4. `get_item` on the file lists pages; `get_page` shows each image. For bulk work,
   `get_page` with `image: "link"` and curl the signed links.
5. `save_transcript` per page (the result says how many pages are still missing).
6. Create or find the term, course and lecture.
7. `source_files file` under the lecture (allowed with untranscribed pages, with a warning
   listing them).
8. `get_item` on the file with `text: true` for exact quotes, then `write_document`, every
   content block citing its page; check with `get_item` on the document (its references).
9. `release` each claim.

### Results

Measured with `scripts/mcp-live-check.probe.ts` (a one-tool server whose result carries
a different code word in the text, the structured content and an image):

| | text block | structuredContent | image |
|---|---|---|---|
| Claude Code 2.1.283 | not shown when structured content is present | shown | shown (WebP too) |
| Codex 0.162.1 | shown | shown | shown (WebP too) |

So a success result is `structuredContent: { message, ...data }`, where `message` is the
full readable text, and a text block holding only the message's first line: Claude sees
the message once, Codex sees it once plus one line, and a text-only client still gets a
summary. Bulk text (a transcript, native text) is in `message` only. Errors carry only
text (Claude Code shows an error's text, not its structured content), so neither agent
sees an error twice.

Size: listings are paged (`limit` at most 100); `get_item` returns at most 40 blocks, or
about 40,000 characters of page text, per call and says how to get the next window; any
text above 60,000 characters is cut with a note; `start_here` stays under 20,000
characters per topic (tested). Inline images above 1.5 MB become links (converter pages are
WebP, at most 1568 px, typically 30 to 200 KB).

### Errors

Every failure is a tool error whose text is

```
Error invalid_input: A document cannot be created in the top level of the library.
Hint: A document goes inside section or folder or lecture. Pick a parent of the right kind.
Example: {"action":"create","parentId":"nod_01HZX3K9Q2V7M4N8P6R5T0W1YB","kind":"document","name":"Example"}
```

- Schema problems name every offending field path, the action, and that action's minimal
  example; unknown fields are named (schemas are strict).
- Missing or unknown `action` lists the valid ones; `rename` is answered with "use
  update"; `delete` is `forbidden` (permanent deletion is browser-only).
- IDs: a wrong-kind ID says what it is and which tool takes it; a malformed ID or unknown
  prefix says so; account IDs are not visible to agents; another user's ID is `not_found`
  with exactly the message of a missing one.
- The domains write hints for the web API; the MCP layer rewrites the routes they name in
  messages and hints into tool calls (`POST /api/nodes/X/restore` becomes
  `edit_library {"action":"restore","id":"X"}`, `GET /api/pages/X/transcript` becomes
  `get_page {"pageId":"X"}`, and so on) and drops examples that are web requests.
- A block refused by the documents domain (no citation, a quote not on the page, a trashed
  source) names its JSON path, e.g. `$.blocks[2].citations[0]`.
- Anything unexpected is `internal` with no detail; the stack goes to the server log.

## Safety and the audit trail

- Every call runs as the key's user, through the domain services with the caller's
  `AuthContext`; the domains check scope (`read_only_key`), claims and ownership.
- Read-only keys see the write tools and get `read_only_key` with a hint to ask for a
  read-write key, so an agent can tell "the app cannot" from "my key cannot".
- Rate limit per key: 120 calls, refilled at 2 per second, in memory; over it,
  `rate_limited` with `retryAfter`.
- **One audit trail.** Agent changes are recorded by the domains in the activity log (in
  plain words, for her "what agents did" view) and the change feed, the same way for MCP
  and for the HTTP API (tested: an MCP create and an HTTP create leave identical entries).
  The per-call `mcp_audit` table of the first version is gone (migration
  `0601_drop_mcp_audit.sql`): it duplicated the successes and nothing read it. Refused
  write attempts are not her business; they go to the server log as
  `mcp refused <tool> <action> key=<id> code=<code>`.

## Inputs

Tool input schemas are generated from the shared zod schemas in `@notes/schema` with
`z.toJSONSchema`, then flattened for action tools (clients reject `oneOf` at the top of a
tool schema; the discriminator is required and each field says which actions use it; the
server still validates the exact branch), described field by field (a test fails on any
undescribed property), inlined and kept small (every schema under 8 KB). The published
block is the envelope with `content` left open; `start_here {"topic":"blocks"}` lists each
type with an example, and every block is validated exactly.

## Ports and adapters

`src/mcp/ports.ts` defines what the layer needs, shaped like the domains (methods take the
caller's `AuthContext`); `src/mcp/adapters.ts` builds them from `Services` in a few lines
each; `src/mcp/fakes.ts` holds in-memory versions for unit tests. Mismatches found when
plugging in the real domains, and how they were resolved (all by changing the port, none
needed domain code):

| Port wanted | Domain has | Resolution |
|---|---|---|
| `(actor, userId)` on writes | `AuthContext` | ports take `AuthContext`; the MCP layer passes the key's, with the agent label |
| inbox summary | `listFiles({ inbox })`, `converterStatus()` | `start_here` and `source_files` count from the list |
| paged `listPages` | all pages in order | port returns all; tools window them |
| transcript by `trn_` ID | transcript by page | `get_item` on a `trn_` ID points to the page |
| block by ID alone | `getBlock(documentId, blockId)` | `get_item` on a block takes `documentId` too |
| page with neighbours | `getPage` | the tool derives them from `listPages` |
| image bytes | a stored file path (WebP) | the adapter reads the file |
| per-operation write results | `OperationResult` union | the adapter normalises to written / removed / skipped |
| `since` time in the change feed | cursor only (plus latest cursor) | `changes` takes a cursor, or `from: "now"` |
| library writes as the agent | optional `by` actor | the tool passes the agent (before, MCP library writes were logged as her) |

## Tests

- `test/mcp-auth.test.ts`, `mcp-library.test.ts`, `mcp-ports.test.ts`: the SDK client
  against the router, over fakes for the ported tools.
- `test/mcp-real.test.ts`: every tool against the real composed app with a fake converter
  playing the queue protocol: upload links and PUT, wait, claim, page images (WebP) and
  signed links, the flag rule, placing, filing with the warning, a refused move, a made-up
  quote refused at its path, a cited study guide whose references resolve and whose quotes
  are checked against the transcripts, unified search, the change feed, the activity log
  (agent label, same entry as the HTTP API), a failed conversion and retry, read-only keys
  and isolation.
- `test/mcp-cli.test.ts`: `admin create-key`.

## Not yet designed into tools

Practice questions, requests, exams and concepts are being built in other lanes; tools
for them come once their schemas and services exist (inputs are never hand-copied).

## Live checks

`apps/server/scripts/mcp-live-check.sh [claude|codex|both|smoke]` starts the real server
(routes, MCP, queue watcher) on a temporary database and storage directory, starts the
real converter image with the lockdown flags of `deploy/docker-compose.converter.yml`
(user 10001:10001, no network, read-only root, originals mounted read-only), creates a
user and a write key with the admin CLI, runs the agent with only this server's tools
plus `Bash(curl:*)` and `Read` (Codex: per-run `-c` config, workspace-write sandbox with
network), and then checks the outcome from the database with
`scripts/mcp-live-check.verify.ts`: files converted and filed, every page transcribed, the
document's blocks, every citation quote found on its page (transcript or native text),
the references list, the activity log. The prompt gives the paths of
`fixtures/generated/lecture.pptx` (12 slides) and `fixtures/generated/image-only.pdf`
(4 handwriting-style pages) and asks for a cited study guide with headings, a callout and
a table.

Converter hand-off: on Docker Desktop for macOS the converter wrote into the 0700
directories made by `admin init-storage` both as 10001:10001 and as the host user; no
ownership change was needed. On Linux, run it as the server's uid:gid (`CONVERTER_USER`)
or give `pages/` and `queue/` a shared group (docs/converter.md, step 7).

Runs on 2026-11-15 (Claude Code 2.1.283, codex-cli 0.162.1):

| Run | What happened | Cost |
|---|---|---|
| Claude `haiku` #1 | Never called a tool beyond ToolSearch: tried to run `start_here` as a shell command, then wanted `wc -c` for upload sizes (not allowed) and gave up. Led to: upload size optional. | $0.10 |
| Claude `haiku` #2 | Called start_here and request_upload_links, then ran `cd … && curl …`, which the `Bash(curl:*)` rule does not allow, and stopped. Led to: every printed curl is one bare command with an absolute path. | $0.09 |
| Claude `haiku` #3 | Done, 15 turns, 484 s: uploads, wait, claims, 16 get_page + 16 save_transcript, term/course/lecture, filed, a 9-block study guide (headings, paragraphs, a table, a callout), releases. Two refusals it fixed from the error alone: an unknown table field `headers`, and a quote not on the cited page. Verification: all checks passed (11 references, all available, every quote found). | $0.96 |
| Codex | Done in about two minutes with no refused call: start_here first, links, curl, wait, `start_here {"topic":"blocks"}`, claims, `get_item … text:true`, 16 get_page + 16 save_transcript, the spine, filed, a 24-block guide citing both files (18 references), get_item on it to check, releases. All checks passed. | ChatGPT plan; 889k input tokens (803k cached), 3.5k output |

Observed along the way: haiku delegated most steps to sub-agents (the operator's own
Claude Code settings load in `claude -p`); both agents read WebP page images inline; the
activity log named them "Claude Code" and "Codex" from their User-Agent.

## Open questions

- Two agents on one library at once: claims stop double transcription, but nothing stops
  both writing a study guide for the same lecture.
- Activity action codes are not uniform across domains (`file.filed`, `library.created`,
  but `create_document` from the documents domain).
- The check for unflagged doses and decimals is a pattern; tune it on her real notes.
- Rate limiting is in memory, which fits the single container.
