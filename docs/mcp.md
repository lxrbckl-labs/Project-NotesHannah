
# MCP layer

The agents' front door. The app contains no AI; Claude Code and Codex operate it through
this endpoint on their own subscriptions. Code: `apps/server/src/mcp/`. Agent-facing
setup guide: [agent-guide.md](agent-guide.md), served as `GET /agents.txt` (and pointed
to from `/robots.txt`).

Related: [architecture.md](architecture.md) (MCP layer, agent orientation),
[api.md](api.md) (the web API over the same services), [blocks.md](blocks.md) (writer
operations), [converter.md](converter.md) (how uploads become pages),
`spikes/s1-mcp-key-auth/FINDINGS.md` (what the two agents do with images and keys).

## State (2026-11-16)

Everything below is live on the shared services: `createApp` passes the one `Services`
object to `mcpRoutes(deps, services)`, so MCP and the HTTP API run the same domain code.
Sixteen tools are registered in production, covering the library, files, documents,
requests, practice, exams and concepts. Proved end to end with the real server, the real
converter container and headless Claude Code and Codex sessions (see Live checks).

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
| `start_here` | Orientation, the whole job in order, the rules, content types, live facts (open requests, inbox); `topic` for detail | read-only |
| `browse_library` | One level of the tree, or trash, favourites, recents; paged | read-only |
| `get_item` | Any object by ID (nod_, fil_, pag_, doc_, blk_, req_, qst_, con_, exm_) with links to its neighbours; a file with `text: true` gives every page's text at once; a lecture shows who is writing for it | read-only |
| `search_notes` | Unified search: names, transcribed pages, document blocks, questions, concepts | read-only |
| `edit_library` | create, update (rename), move, duplicate, trash, restore; claim and release a lecture or document for writing | destructive |
| `changes` | The change feed since a cursor | read-only |
| `requests` | Her requests: list (waiting first, with target, path, preview), claim, release, complete with a reply and links, decline with a reason | write |
| `source_files` | upload links, list (status and transcription progress), wait for conversion, claim, release, file, move (or back to the inbox), retry | write |
| `get_page` | Page image inline (WebP) or a signed link; native text, notes, the current transcript, neighbours, how often it is cited | read-only |
| `save_transcript` | Verbatim transcript with flags; refuses unflagged doses | write |
| `write_document` | `create_document` with its first blocks | write |
| `edit_blocks` | insert, update (replace or patch), move, delete, replace_generated, restore_revision; `requestId` for her blocks | destructive |
| `concepts` | upsert concepts and relations in bulk; search, page, neighbourhood, path, filter, compare, look-alike suggestions; merge only with her claimed request | destructive |
| `practice_questions` | create in bulk (or validate only), list, update, trash, restore | destructive |
| `study_progress` | Her weak areas, missed-questions notebook, due cards, sessions, a session's results | read-only |
| `exams` | Upcoming exams with coverage and progress; create, update (never delete) | write |

Why this list (and not more): each tool is one job an agent recognises by name. Actions
that share a subject fold into one tool with an `action` (requests, source_files, concepts,
practice_questions, study_progress, exams), and anything that only reads one object by ID
is `get_item`, so the four new domains added four tools, not twenty: their `get` lives in
`get_item`, and upload links moved into `source_files` (an upload is the start of a file's
life), which keeps the count at sixteen. `study_progress` is separate from
`practice_questions` because it only reads and has a read-only annotation; `exams` is
separate because it is about dates and coverage, not questions. Agents can never take a
practice session or answer for her: those service methods are not in the port.

Decisions:

- **Exams.** Agents may create and update exams unprompted (an exam date in her
  material, or a request), because the activity log shows it and she can change it; they
  can never delete one (the domain refuses, and the tool has no such action).
- **Concept merges** stay hers: `concepts merge` needs the `requestId` of her request,
  in progress and claimed by the calling key (checked in the MCP layer), and the domain
  still requires both concepts to be unreviewed agent work. Look-alikes are reported, never
  merged.
- **Her edits.** Her blocks, her questions and anything she reviewed are protected. Only a
  request of hers lifts that, when `requestsPort.verifyForEdit` confirms it is in progress,
  claimed by this key and about that document or block. The documents domain enforces it;
  `edit_blocks` passes `requestId` through and the errors say what is missing.

`openWorldHint` is false everywhere. `destructiveHint` is true for the tools that can
remove or overwrite content (trash, block edits, upserts and merges, question rewrites),
though all of them are recoverable.

### The workflow `start_here` teaches

1. **Requests first**: list, claim, do it, complete with a reply and links (or decline).
2. **Inbox**: `source_files upload_links` for local files (one bare curl per file),
   `wait` until converted, `claim` each file.
3. **Transcribe** every page with `save_transcript`, slides too (native text is a draft).
4. **Place and file**: term, course, lecture 7 (`edit_library`), then `source_files file`.
5. **Write**: claim the lecture (`edit_library claim`), collect quotes with `get_item`
   on the file with `text: true`, write the lecture note with `write_document`.
6. **Concepts**: `concepts upsert`, each citing its page.
7. **Practice**: `practice_questions create` under the lecture (validate first), using
   `study_progress` to target weak areas.
8. **Finish**: complete the claimed requests; release file and writing claims.

### Duplicate work: writing claims

Two agents could write a study guide for the same lecture. A file claim (source_files) and
a request claim (requests) cover their own objects, so writing gets the same idea:
`edit_library {"action":"claim","id":"<lecture>"}` takes an advisory, expiring claim
(30 minutes) on a lecture, folder or document and everything under it (table
`mcp_write_claims`, migration 0620, owned by the MCP layer). While another key holds it,
`write_document`, `edit_blocks` and `practice_questions` writes into that subtree are
refused with who holds it and until when, and so is a second claim; `get_item` on the
lecture shows the holder; the holder's own writes renew it; `release` ends it. Her browser
session is never affected. Limitation: a study guide written into the course's Study
guides section is outside the lecture's subtree, so the claim only advises there (the
holder is still shown on the lecture).

### Quotes

The domains refuse a citation whose quote is not, character for character, on its page.
In the first live run an agent that hit this gave up and marked 11 of 12 questions and all
its concepts "general knowledge". So every write tool now checks every citation in its
input first, the same way (whitespace collapsed; transcript, native text and speaker
notes), and refuses with each failing path and **the closest passage on that page** to
copy, e.g. `$.questions[0].sources[0].quote "…" is not on page pag_…; the closest passage
there is "Propranolol is nonselective."`.

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

### Activity action names

The MCP layer writes no activity of its own: every agent change is recorded by the domain
that makes it, the same way for MCP and the HTTP API, and writing claims are deliberately
not logged (advisory, and they would drown the log). So no MCP-originated names needed
changing. The names the domains use today, seen in the live runs and the code, are not
consistent; to fix in the domains (suggested form `<object>.<past participle>`):

| Domain | Today | Suggested |
|---|---|---|
| library | `library.created`, `.updated`, `.moved`, `.duplicated`, `.trashed`, `.restored`, `.deleted` (its change feed says `node.*`) | `node.*`, as in the feed |
| documents | the operation names: `create_document`, `insert_blocks`, `update_block`, `move_blocks`, `delete_blocks`, `replace_generated`, `restore_revision`, `batch` (its change feed says `document.created`, `document.updated`) | `document.created`, `blocks.inserted`, `block.updated`, `blocks.moved`, `blocks.deleted`, `document.regenerated`, `document.restored`, `document.batch` |
| requests | `request.claim`, `request.release`, `request.complete`, `request.decline` | `request.claimed`, `.released`, `.completed`, `.declined` |
| files, transcripts, practice, exams, concepts | `file.filed`, `transcript.saved`, `question.created`, `exam.created`, `concept.bulk_upserted`, ... | already consistent |

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

Practice, exams, requests and concepts need no adapter: their services already take the
caller's `AuthContext`, so `McpBackend` holds them narrowed by `Pick` to the methods the
tools call (`PracticeToolPort`, `ExamsToolPort`, `RequestsToolPort`, `ConceptsToolPort` in
`ports.ts`). The domain's own `PracticePort` lacks update, trash and restore, which her
"list/get/update/trash" brief needs, so the MCP layer picks them from the service; session
methods (start, answer, finish) are left out on purpose.

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
- `test/mcp-more.test.ts`, over the real composed app: her requests (her block, edited by
  her session, refused to the agent without a request, refused with the request before the
  claim, refused to another key holding the same request ID, accepted after the claim;
  complete, decline, read-only key, another user's request); practice (validate only, an
  atomic refusal with the problem path and an example of that type, a made-up quote refused
  with the closest passage, create, get, a calculation graded correct by the shared `grade`,
  update, trash, restore, study_progress, another user's question); exams (create, list
  with progress, update, coverage outside the course refused); concepts (bulk upsert with
  citations, a relation between the wrong types refused with the rule and an example,
  search, page, neighbourhood, filter through a class, compare, suggestions, merge refused
  without a request and done with her claimed request, read-only key); writing claims; an
  array sent as a JSON string; and the whole surface (sixteen tools, every field described,
  every schema small and valid, start_here within budget).
- `test/mcp-cli.test.ts`: `admin create-key`.

## Live checks

`apps/server/scripts/mcp-live-check.sh [claude|codex|both|smoke|measure] [guide|requests]` starts the real server
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

### Requests scenario (2026-11-16)

`scripts/mcp-live-check.sh <agent> requests` seeds, through the HTTP API with her browser
session (`mcp-live-check.seed.ts`): term, course, lecture 7, a lecture note with a
paragraph she wrote herself ("Metoprolol tartrate: usual daily dose 500-2000 mg, twice
daily."), the two fixture files uploaded and left unprocessed, and two requests: "this is
wrong: fix the dose" on her paragraph and "make me a quiz on beta blockers" on the
lecture. The prompt: "Check what Hannah has asked for and do it, then finish any
unprocessed files, then make sure lecture 7 has concepts recorded and a 12-question mixed
practice set including two dose calculations and four flashcards. Report what you did."
`mcp-live-check.verify-more.ts` then checks the database: both requests done with replies;
every agent change to her block carries her block request; both files filed and fully
transcribed; at least 12 questions under the lecture with at least two calculations and
four flashcards, each valid (`practice.Question`) and every source quote found on its
page; every calculation graded correct by `practice.grade` for its own stated answer
(`correctAnswerOf`, seeds 0 to 2); concepts and relations with citations whose quotes are
on their pages; agent document blocks' citations; the activity log.

| Run | Outcome (from the database) | Cost |
|---|---|---|
| Claude haiku #1 | Requests done, her block changed only through the request. Filed the deck without transcribing it (it had slide text) and, after quote errors, marked 11 of 12 questions and all concepts general knowledge. Led to: the quote pre-check with the closest passage, and stronger wording on transcribing slides and on general knowledge. | $0.47 |
| Claude haiku #2 | All 12 questions and all concepts cite real pages; requests done. Left the handwriting file transcribed but unfiled; 3 flashcards, not 4; repeatedly omitted `mode` on update_block. Led to: mode inferred, "file it next" after the last transcript, counts by type after create. | $0.54 |
| Claude haiku #3 | Requests, files, 12 questions (4 flashcards, 2 calculations) all pass; sent the concepts list as a JSON string five times, so no relations. Led to: JSON-string arrays accepted. | $0.67 |
| Claude haiku #4 | Everything passed except the handwriting PDF, filed without transcribing it (with the warning). Its reply on her dose request cited the slide but stated "50-100 mg twice daily; maximum 400 mg", which is not what the slide says (50-200 mg). | $0.59 |
| Claude sonnet | Finished (61 turns, 527 s) and reported both requests done, both files transcribed and filed, 36 concepts, 34 relations, 12 questions. **Not verified**: I edited the live script while it ran, bash read the changed file and the verification step failed with a syntax error; the temporary database was removed on exit. | $2.00 |
| Codex | **All checks passed**: both requests done (dose corrected to the slide's 50-200 mg), both files transcribed and filed, 12 questions (2 calculations, 4 flashcards) all citing real pages and the calculations grading their own answers correct, 33 concepts and 29 relations all cited. 1.31M input tokens (1.17M cached), 7k output. | ChatGPT plan |

### Size

Measured with `scripts/mcp-live-check.sh claude measure` (Claude Code's own usage, read
by `mcp-live-check.tokens.mjs`): loading every tool schema with ToolSearch added 19,310
tokens to the context (18 schemas: the 16 notes tools and two others), and the default
`start_here` result added 2,591 tokens. That listing was measured before the compact
citation and link schemas; the JSON of the listing then went from 63,816 to 55,637
characters. Codex's reported input did not grow when the server was attached, so it could
not be used for this. `start_here` stays short by keeping detail in topics (largest:
blocks 7.3k and practice 6.0k characters).

## Open questions

- The handwriting PDF was twice filed untranscribed by haiku: filing is allowed with a
  warning by decision; refusing it (or making the warning an error) would stop that.
- Agents can state facts in a request reply that the cited page does not say (haiku #4's
  dose range); nothing checks a reply's text.
- Writing claims cover a lecture's subtree; a study guide filed in the course's Study
  guides section is outside it, so the claim only advises there.
- The domains' activity names are inconsistent (table above).
- The check for unflagged doses and decimals is a pattern; tune it on her real notes.
- Rate limiting is in memory, which fits the single container.
