
# MCP layer

The agents' front door. The app contains no AI; Claude Code and Codex operate it through
this endpoint on their own subscriptions. Code: `apps/server/src/mcp/`. Agent-facing
setup guide: [agent-guide.md](agent-guide.md), served as `GET /agents.txt`.

Related: [architecture.md](architecture.md) (MCP layer, agent orientation),
[api.md](api.md) (the web API over the same services), [blocks.md](blocks.md) (writer
operations), `spikes/s1-mcp-key-auth/FINDINGS.md` (what the two agents actually do).

## Endpoint

| | |
|---|---|
| URL | `POST /mcp` on the main server (same origin as the web app) |
| Transport | Streamable HTTP, **stateless** (a fresh server per request, no session ID), JSON responses (`enableJsonResponse`), SDK `WebStandardStreamableHTTPServerTransport` on Hono |
| `GET /mcp`, `DELETE /mcp` | `405` with `Allow: POST` (no standing SSE stream, no session to end) |
| Auth | `Authorization: Bearer <api key>` only. Browser sessions are refused. No Origin check (a key is not an ambient credential). |
| Bad or missing key | `401`, `WWW-Authenticate: Bearer realm="notes"` (plus `error="invalid_token"` when a key was sent), body `{ error: ApiError }` whose hint says: Settings, API keys, and points at `/agents.txt` |
| Server instructions | 300 characters: role, and "call start_here first" |
| Optional header | `X-Agent-Label` (e.g. "Claude Code"), recorded in the audit log |

## Tools

Twelve tools when every port is present; five today in production (library only).
Names are distinct verbs plus nouns so Claude Code's tool search finds them, and the first
tool's description begins "CALL THIS FIRST", because Codex does not show the model the
server instructions.

| Tool | Status | Purpose | Annotations |
|---|---|---|---|
| `start_here` | live | Orientation and live facts; optional `topic` | read-only, idempotent |
| `browse_library` | live | One level of the tree, or trash, favourites, recents; paged | read-only, idempotent |
| `get_item` | live (nod_); ported (fil_, pag_, trn_, doc_, blk_) | Any object by ID, with links to its neighbours; windows for long content | read-only, idempotent |
| `search_notes` | live (library); ported scopes `transcripts`, `documents` | Word-prefix search | read-only, idempotent |
| `edit_library` | live | create, update (rename), move, duplicate, trash, restore | destructive |
| `changes` | ported (`ChangesPort`) | Change feed since a cursor or time | read-only, idempotent |
| `source_files` | ported (`FilesPort`) | Inbox: list, claim, release, file; `move` a file to another lecture or folder, or back to the inbox | write |
| `get_page` | ported | Page image inline (or a signed link), native text, notes, neighbours | read-only, idempotent |
| `save_transcript` | ported | Verbatim transcript with flags; refuses unflagged doses | write |
| `request_upload_links` | ported | Single-use PUT links for local files | write |
| `write_document` | ported (`DocumentsPort`) | `create_document` with its first blocks | write |
| `edit_blocks` | ported | insert, update (replace or patch), move, delete, replace_generated, restore_revision | destructive |

Annotations: `openWorldHint` is false everywhere (the app is a closed world).
`destructiveHint` is true for the two tools that can remove or overwrite content
(`edit_library` trash, `edit_blocks`), even though both are recoverable (trash, revisions):
a client that asks before destructive calls should ask there.

### Results

Every success returns a compact text block **and** `structuredContent`. The structured
result starts with `message`, which repeats the text. Reason (live check, 2026-11-15):
Claude Code 2.1.283 shows the model only `structuredContent` when it is present, so
guidance that lived only in the text (the start_here guide, "next" hints, cursors) never
reached it. Codex shows both. To keep the duplication small, bulk text (a transcript, a
page's native text) is in `message` only, not repeated in the structured fields. Errors
(`isError: true`) carry the text and `structuredContent: { error: ApiError }`; Claude
Code shows error text.

Images (`get_page`) are MCP image content next to the text; Claude Code and Codex both
read them (spike and live check). Above 1.5 MB the image is replaced by a signed link.

Size: listings are light and paged (`limit` at most 100); `get_item` returns at most 40
blocks or 30,000 transcript characters per call and says how to get the next window; any
text above 60,000 characters is cut with a note. `start_here` stays under 20,000
characters for every topic (tested); the overview is about 7,000.

### Errors

Every failure is a tool error with the shared `ApiError` (`code`, `message`, `hint`,
`example`, `retryAfter`). The text form is:

```
Error invalid_input: A document cannot be created in the top level of the library.
Hint: A document goes inside section or folder or lecture. Pick a parent of the right kind.
Example: {"action":"create","parentId":"nod_01HZX3K9Q2V7M4N8P6R5T0W1YB","kind":"document","name":"Example"}
```

- Schema problems become `invalid_input` naming every offending field path
  (`lecture.date: missing (required, a string)`), the action, and that action's minimal
  example. Unknown fields are named (schemas are strict, so a misspelt field is never
  silently dropped).
- Missing or unknown `action` lists the valid ones. `rename` is answered with "use
  update"; `delete` is `forbidden` (permanent deletion is browser-only) with a trash example.
- IDs: an ID of the wrong kind says what kind it is and which tool takes it ("You sent an
  uploaded file ID (fil_…). Read it with get_item; claim, file or move it with
  source_files."); a malformed ID says so; an unknown prefix lists the usable prefixes; an
  account ID (`key_`, `usr_`, `ses_`) is not visible to agents.
- Another user's ID is `not_found` with exactly the message of a missing ID.
- Domain hints written for the web API (`POST /api/nodes/…/restore`) are rewritten into
  the tool call (`edit_library {"action":"restore","id":"…"}`), for every port.
- Anything unexpected is `internal` with no detail; the stack goes to the server log.

## Safety

- Every call is scoped to the key's user; tools never take a user ID.
- Read-only keys **see** the write tools and get `read_only_key` with a hint to ask for a
  read-write key. Hiding them would leave an agent unable to tell "the app cannot do this"
  from "my key cannot", and it would describe the product wrongly; `start_here` also
  states the key's scope at the top.
- Rate limit per key: a token bucket of 120 calls refilled at 2 per second, in memory.
  Over it: `rate_limited` with `retryAfter` seconds. Only `tools/call` counts.
- Audit: every mutating call, refused ones included, is a row in `mcp_audit`
  (migration `0600_mcp_audit.sql`): user, key, agent label, tool, action, target IDs,
  outcome (`ok` or the error code), time. Written through `AuditPort`; `sqliteAudit(db)`
  is the default and has `list(userId)` for the future "what agents did" view (H10).

## Inputs

Tool input schemas are generated from the shared zod schemas in `@notes/schema`
(`CreateNodeInput`, `UpdateNodeInput`, `MoveNodeInput`, `FileStatus`, `SaveTranscriptInput`,
`RequestUploadsInput`, `CreateDocumentInput`, the writer operations, `Citation`,
`BlockFlag`, `BlockStyle`, `BlockType`) with `z.toJSONSchema`, then:

- **Flattened** for action tools: clients reject `oneOf` at the top of a tool schema, so
  `edit_library`, `source_files` and `edit_blocks` publish one object with the
  discriminator required and every other field optional, each field saying which actions
  use it. The server still validates the exact branch.
- **Described** field by field in plain language, with ID prefixes and examples (a test
  fails on any undescribed property).
- **Inlined** (`$defs` resolved) and stripped of generated date regexes, to stay small:
  every schema is under 8 KB; the largest is `edit_blocks` at about 7 KB.
- **Block content left open**: the full block union is about 18 KB per tool, so the
  published block is the envelope (`type` enum, `content` object, `citations`, `flags`,
  `style`, `generalKnowledge`). `start_here {"topic":"blocks"}` lists each type with an
  example, and `validateOperation(…, { writer: "agent" })` checks every block, answering a
  wrong one with its JSON path, the rule and a valid block of that type.

## Tool reference

Examples use placeholder IDs.

**start_here** `{ topic?: "overview" | "library" | "inbox" | "blocks" | "citations" | "transcription" }`.
Returns the guide (what the app is, the agent's role, her name, the key's scope, library
and inbox counts, the tool map, IDs, library rules and both kinds of move, the inbox
workflow, transcription and citation rules, block types, how errors work).
`start_here {}`

**browse_library** `{ parentId?: nod_ | null, view?: "children" | "trash" | "favourites" | "recents", cursor?, limit? }`.
Returns `parent`, `canCreateHere`, light `items` (id, kind, name, label, path, parentId,
childCount, lecture/course details), `nextCursor`.
`browse_library {"parentId":"nod_…","limit":50}`

**get_item** `{ id, cursor?, offset?, limit? }`. Dispatches on the prefix. Node: the node,
ancestors, first 25 children, `canCreateHere`, its document and filed source files when
those ports exist. File: pages. Page: summary (use get_page for the image). Transcript:
a window of text. Document: a window of blocks with full JSON in the structured result.
Block: the block and its document.
`get_item {"id":"doc_…","offset":40}`

**search_notes** `{ query, scope?: "library" | "transcripts" | "documents", cursor?, limit? }`.
Scopes appear only when their port supports search.
`search_notes {"query":"beta blockers"}`

**edit_library** `{ action, … }`:
`create {parentId, kind, name, course?, lecture?}`, `update {id, name?, course?, lecture?, favourite?}`,
`move {id, parentId, afterId?}`, `duplicate {id}`, `trash {id}`, `restore {id}`.
A course's create result lists its five section IDs.
`edit_library {"action":"move","id":"nod_…","parentId":"nod_…","afterId":null}`

**changes** `{ cursor?, since?, limit? }`. Returns items, a cursor to continue from, `more`.

**source_files** `{ action, … }`: `list {nodeId?, status?, cursor?, limit?}` (the inbox, or
the files filed under a node), `claim {fileId}`, `release {fileId}`, `file {fileId, nodeId}`,
`move {fileId, nodeId | null}` (another lecture or folder; null returns it to the inbox).
Filing says how many pages still lack a transcript. A move result names where the file was.
`source_files {"action":"move","fileId":"fil_…","nodeId":null}`

**get_page** `{ pageId, image?: "inline" | "link" | "none", size?: "page" | "thumb" }`.
Page metadata, native text (8,000 characters at most), speaker notes, transcript status,
previous and next page IDs, what cites it (when the documents port has backlinks), and
the image or a curl command for the signed link.

**save_transcript** `SaveTranscriptInput { pageId, text, flags[] }`. Refused when a flag's
quote is not in the text, or when a dose, unit or decimal is not covered by a flag (a flag
covers a value when its quote overlaps the value's digits anywhere in the text); the error
lists the values and gives the flags to add.
`save_transcript {"pageId":"pag_…","text":"Metoprolol 25 mg PO BID","flags":[{"kind":"dose","quote":"25 mg"}]}`

**request_upload_links** `RequestUploadsInput { files: [{name, bytes}], nodeId? }`. Returns
tickets and a ready `curl -X PUT --data-binary @file "<url>"` per file.

**write_document** `CreateDocumentInput { nodeId | parentId, kind, title, blocks? }`. Returns
document ID, node ID, revision and written block IDs.

**edit_blocks** `{ operation, … }` with the bodies of `insert_blocks`, `update_block`,
`move_blocks`, `delete_blocks`, `replace_generated`, `restore_revision` from blocks.md.
Results report written, removed and skipped (protected) blocks and the new revision.

## Ports the integrator implements

`src/mcp/ports.ts` holds the interfaces; `src/mcp/fakes.ts` the in-memory reference
implementations used by the tests. Wire real services with
`app.route("/", mcpRoutes(deps, { files, documents, changes }))`. A port's methods take
`userId` (and `actor` for writes), return shared schema types, and throw `AppError`;
another user's object must be `not_found`. Hints may mention web routes; the MCP layer
rewrites the known ones (`/api/nodes/…`, `/api/files/:id/file`, `/api/files/:id/retry`,
`/api/trash`).

- **FilesPort** (lane `src/domains/files`): `inboxSummary`, `listInbox`, `listFilesUnder`,
  `getFile`, `listPages`, `claim`, `release`, `fileUnder(actor, userId, fileId, nodeId | null)`
  (the same service as `POST /api/files/:id/file`, which owns the rule for valid
  destinations and returns `invalid_input` with hint and example for a bad one),
  `getPage` (page, file summary, previous and next page, transcript summary), `pageImage`,
  `pageImageLink` (signed, no credential), `getTranscript`, `saveTranscript`,
  `requestUploads`, optional `searchTranscripts`.
- **DocumentsPort** (lane `src/domains/documents`): `getDocument(range)`, `documentForNode`,
  `getBlock`, `createDocument`, `applyOperation` (input already validated with
  `validateOperation`; the domain enforces `canAgentOverwrite`, `expectedRevision` and the
  `findQuote` check on citations), optional `pageBacklinks`, `searchDocuments`.
- **ChangesPort**: `changesSince(userId, { cursor?, since?, limit })`.
- **AuditPort**: defaults to `sqliteAudit(db)`.

## Not yet designed into tools

No shared schema exists yet for practice questions, attempts, requests (L), exams (M) or
concepts (F), so no tools are registered for them (the schemas must come first; inputs
are never hand-copied). Intended shape, keeping the total near fifteen: `practice`
(write questions with citations, read results and weak areas), `requests` (list, claim,
complete with a note and links), with concepts and exams reachable through `get_item`,
`search_notes` and `changes` by prefix (`con_`, `exm_`).

## Live checks

`apps/server/scripts/mcp-live-check.sh [claude|codex|both]` runs the real server on a temp
database and storage, creates a user with the admin CLI, signs in and creates a key
through the API, then runs a headless agent with only this server's tools.
`scripts/mcp-live-check.ports.ts [claude|codex]` runs the ported tools over the fakes with
the spike's slide and handwriting images.

Runs on 2026-11-15 (Claude Code 2.1.283 with `haiku`, codex-cli 0.162.1):

- Library task, both agents: called `start_here` first (Codex without being told),
  created the term, the course (using the returned Lectures section ID), three numbered
  lectures, and reported the top-level document error verbatim. Claude Code: 9 turns,
  $0.07 to $0.08.
- First Claude run showed the agent only the structured result (JSON), not the guide text;
  this led to `message` in every structured result. The second run quoted the guide.
- Ports task (inbox to filed lecture note): both agents read both images, transcribed
  them, hit the unflagged-value error once or twice and fixed it from the error alone,
  created the hierarchy, filed both files, wrote a cited lecture note (Claude also fixed a
  wrong callout kind from the error), and Codex moved the handwritten file to a new
  lecture 8. Claude: 28 turns, $0.27. Both agents flagged "5.0" in "3.5-5.0 mEq/L" and were
  refused because the check wanted "5.0 mEq"; coverage is now by overlap with the digits.
  Codex filed a file in parallel with a refused transcript save; filing now reports
  untranscribed pages. Claude read "CrCl" as "Crcl" (known from the spike).

## Open questions

- `structuredContent` duplicates the text for clients that show both (Codex). Dropping
  structured content would avoid it but loses machine-readable results; revisit when
  either client changes.
- Should filing an untranscribed file be refused? Today it is allowed (she may file by
  hand) and the result warns.
- The check for unflagged values is a pattern (decimals, numbers with dose and
  lab units); it may need tuning on her real notes.
- One process: the rate limiter is in memory, which fits the single container.
