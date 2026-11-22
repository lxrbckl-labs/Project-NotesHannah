
# MCP layer

The agents' front door. The app contains no AI; Claude Code and Codex operate it through
this endpoint on their own subscriptions. Code: `apps/server/src/mcp/`. Agent-facing
setup guide: [agent-guide.md](agent-guide.md), served as `GET /agents.txt` (and pointed
to from `/robots.txt`).

Related: [architecture.md](architecture.md) (MCP layer, agent orientation),
[api.md](api.md) (the web API over the same services), [blocks.md](blocks.md) (writer
operations), [converter.md](converter.md) (how uploads become pages),
`spikes/s1-mcp-key-auth/FINDINGS.md` (what the two agents do with images and keys).

## State (2026-11-16, canvas and the four fixes added)

Everything below is live on the shared services: `createApp` passes the one `Services`
object to `mcpRoutes(deps, services)`, so MCP and the HTTP API run the same domain code.
Nineteen tools are registered in production, covering the library, files, documents,
the study map, requests, practice, exams, concepts, trusted references (added 2026-11-16) and her
side notes (read only, added 2026-11-16). On 2026-11-22 the existing tools gained the app's newer
features (calendar, saved instructions, file rename, revision history), with no new tool; see
"Parity with the app". Proved end to end with the real server, the real
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
| `get_item` | Any object by ID (nod_, fil_, pag_, doc_, blk_, req_, qst_, con_, exm_) with links to its neighbours; a file with `text: true` gives every page's text at once; a doc_ or pag_ with `history: true` lists its revisions (a document's versions, a page's transcript revisions), newest first; a lecture shows who is writing for it | read-only |
| `search_notes` | Unified search: names, transcribed pages, document blocks, questions, concepts, her saved references, her side notes | read-only |
| `edit_library` | create, update (rename), move, duplicate, trash, restore; claim and release any library item or document for writing | destructive |
| `changes` | The change feed since a cursor | read-only |
| `requests` | Her requests: list (waiting first, with target, path, preview, and the saved instructions she attached), claim, release, complete with a reply and links (figures in the reply are checked against its sources), decline with a reason; `instructions` lists every instruction she saved in Settings (read only) | write |
| `source_files` | upload links, list (status and transcription progress), wait for conversion, claim, release, file, move (or back to the inbox), retry, rename; `restore_transcript` makes an earlier transcript revision of a page current again (as a new revision); filing is refused while pages have no transcript unless forced with a reason | write |
| `get_page` | Page image inline (WebP) or a signed link; native text, notes, the current transcript, neighbours, how often it is cited | read-only |
| `save_transcript` | Verbatim transcript with flags; refuses unflagged doses | write |
| `write_document` | `create_document` with its first blocks | write |
| `edit_blocks` | insert, update (replace or patch), move, delete, replace_generated, restore_revision; `requestId` for her blocks | destructive |
| `study_map` | A document's study map (docs/canvas.md): `get` (frames with card previews, connectors as "A -[label]-> B", hers and pinned items marked), `set_structure` (the whole map), `change` (incremental ops); never coordinates | write |
| `concepts` | upsert concepts and relations in bulk; search, page, neighbourhood, path, filter, compare, look-alike suggestions; merge only with her claimed request | destructive |
| `practice_questions` | create in bulk (or validate only), list, update, trash, restore | destructive |
| `study_progress` | Her weak areas, missed-questions notebook, due cards, sessions, a session's results; `calendar` (from, to, utcOffsetMinutes): what her Calendar page shows, exams by date, the days she studied and her streak | read-only |
| `exams` | Upcoming exams with coverage and progress; create, update (never delete) | write |
| `references` | Trusted outside references: `list` returns the built-in sites (PharmGuides and its sections, with its search address pattern, flagged trusted) and her saved references (optionally for one place and what is inside it); `add` saves one she asked for. No change or delete. The description carries the writing rule (below) | write |
| `side_notes` | Her private side notes beside a document's blocks (docs/side-notes.md): `list` a document's notes (open first, in block order, detached last; each with its anchor block id and type, quote, colour, resolved, detached, the block's last known text, her words, timestamps); `recent` her open notes across documents, newest first, with document title and id (`limit`, default 20). No add, change or delete: only her session writes them | read-only |

Why this list (and not more) and why ONE `study_map` tool: each tool is one job an agent recognises by name. Actions
that share a subject fold into one tool with an `action` (requests, source_files, concepts,
practice_questions, study_progress, exams), and anything that only reads one object by ID
is `get_item`, so the four new domains added four tools, not twenty: their `get` lives in
`get_item`, and upload links moved into `source_files` (an upload is the start of a file's
life). `study_progress` is separate from
`practice_questions` because it only reads and has a read-only annotation; `exams` is
separate because it is about dates and coverage, not questions. Agents can never take a
practice session or answer for her: those service methods are not in the port.

The canvas is one tool, `study_map`, with `get`, `set_structure` and `change`, not three
`canvas_*` tools. The three share one subject (one document's map), one input (`documentId`
plus the optional `requestId` and `expectedRevision`) and one rule (the pin rule), and an agent
decides between them by reading, not by name; three more entries would cost three more
descriptions in every session's tool listing, and the listing is the budget that matters
(`study_map` as one tool is about 2,300 tokens, measured). `get` is its own action but the tool
is annotated as a writer because two of its three actions write; a read-only key can still
`get`. The published schema describes the card, connector, frame and op fields so an agent sees the
shapes, while the exact checking stays with the canvas validators, whose errors (path, plain
message, a minimal valid example) are passed through as the tool error.

Decisions:

- **Trusted references** (docs/references.md). Her notes are built from her slides and notes;
  PharmGuides and her saved references are trusted outside resources to check and extend them.
  The `references` tool and `start_here` tell agents to consult them with their own web access
  (the app fetches nothing), to keep her slide where a reference disagrees (cite it, add a
  `source_conflict` flag naming the reference), and to put anything from a reference in the
  block's `references` ([{title, url, referenceId?}], at most 5), which renders as its own chip
  apart from her numbered sources. Such a block satisfies the citation rule. Agents summarise in
  their own words with the link and never paste long passages from a site. Agents can add a
  saved reference only when she asks; they cannot change or delete hers.

- **Side notes are read only for agents** (docs/side-notes.md). They are her private remarks
  on a document, telling an agent where she is confused or what she wants. `side_notes` lists
  them; its description, `start_here` and the agent guide say to read them before revising a
  document and to address the open ones in the edits or a request reply. The tool has no write
  action, and the HTTP routes refuse every API key (`forbidden`, in plain words), so an agent
  cannot add, change, resolve or delete one. Block writes never change a note's words; a note
  whose block an agent deletes or regenerates shows to her as detached, with the block's last text.

- **Exams.** Agents may create and update exams unprompted (an exam date in her
  material, or a request), because the activity log shows it and she can change it; they
  can never delete one (the domain refuses, and the tool has no such action).
- **Concept merges** stay hers: `concepts merge` needs the `requestId` of her request,
  in progress and claimed by the calling key (checked in the MCP layer), and the domain
  still requires both concepts to be unreviewed agent work. Look-alikes are reported, never
  merged.
- **The study map and the pin rule.** The app lays the map out and she can drag cards, so an
  agent's input never carries coordinates (`x`, `y`, `position`, `width`, `height` are refused
  with the reason). What she made, edited or pinned is hers: `set_structure` keeps it and lists
  it as skipped; an op on it is refused (`forbidden`) with the pin rule in her terms. Only a
  request of hers about the whole document (not one block), in progress and claimed by this key,
  lifts it; the canvas domain checks that with `requestsPort.verifyForEdit`. `place_cards`,
  `release_pins` and `insert_items` are hers alone. The write also respects a writing claim on
  the document.
- **Filing untranscribed files.** The files domain refuses an AGENT filing or moving a file into a
  place while any of its pages has no transcript: `invalid_input`, naming the page numbers, with
  how to proceed. `force: true` with a short `reason` (3 to 200 characters) overrides it and the
  reason goes into the activity summary ("... (forced; 2 pages not transcribed: ...)"). She
  (a browser session) can always file, and anyone can send a file back to the inbox. It lives in
  the domain (`fileUnder`, `POST /api/files/:id/file` takes `force` and `reason`), so it holds
  for the HTTP API with a key as well.
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

### Request replies and their figures

In one live run an agent's reply to her dose request cited the slide but stated a range the slide
does not give, and nothing checked it. When an agent completes a request (domain `requests`,
so MCP and the HTTP API alike), every number with a unit, range or decimal in the reply is looked
for in: the page(s) or block(s) the request is about (a `node` request: the documents and files under
it), the objects the agent passes in `links`, and her own message. Figures found nowhere come back as
a refusal, naming them, before anything is completed; the agent must add a link to a source that
contains them, fix the reply, or pass `acknowledgeUnsourced: true`. An acknowledged reply is stored
with `unsourcedFigures: true` and the list (`unsourcedFigureList`) on the reply, and the app shows it
with "contains figures not found in your notes" (web change below). A reply without such figures
stores `unsourcedFigures: false`; older replies lack the field. Declines are not checked. The matching
is deliberately simple: the same number and unit (also as one end of a range; a range needs both
ends), case, spacing, a decimal comma and mcg for µg ignored.

### Duplicate work: writing claims

Two agents could write a study guide for the same lecture. A file claim (source_files) and
a request claim (requests) cover their own objects, so writing gets the same idea:
`edit_library {"action":"claim","id":"<id>"}` takes an advisory, expiring claim (30 minutes)
on a library item and everything under it (table `mcp_write_claims`, migration
`0620_mcp_write_claims.sql`, owned by the MCP layer). The target can be any library item (a
lecture, folder, document or section such as the course's Study guides) by its `nod_` ID, or a
document by its `doc_` ID. While another key holds it, `write_document`, `edit_blocks`,
`practice_questions` and `study_map` writes into that subtree are refused with who holds it and
until when, and so is a second claim; the holder's own writes renew it; `release` ends it. Her
browser session is never affected.

A study guide for a lecture lives in the course's Study guides section, outside the lecture's
subtree, so a claim on the lecture alone cannot guard it. The claim is therefore takeable on
the section (guards every guide being written there) or on the guide itself once it exists, and
`get_item` shows it from both directions: on a document, a section, folder or lecture it says who
holds a claim on it or above it ("Being written for by ...") and which claims exist below it
("Being written below this: doc_... by Codex until ..."). Claiming a lecture says where its guide
goes. Limit: nothing can be claimed before the guide document exists except its section, so two
agents that both create a guide at the same instant can still produce two (the second sees the
first at its next `get_item`).

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

## Parity with the app

The rule (Alex, 2026-11-22): agents can do everything she can do in the app, through the same
domain functions the web routes call, so the rules and validation live in one place and the MCP
layer stays an abstraction over them. Exceptions are deliberate and listed with the reason: her
sign-in and account, per-device or purely presentational state, her own judgement (reviewing,
taking practice, writing side notes) and permanent deletion (agents trash, she deletes). A new user
feature needs a row here: the tool that covers it, or why agents do not get it.

Checked against every route in `apps/server/src/domains/*/routes.ts` on 2026-11-22.

| Capability | HTTP route(s) | MCP | Status |
|---|---|---|---|
| Browse the tree, open an item | `GET /api/nodes`, `GET /api/nodes/:id` | `browse_library`, `get_item` | covered |
| Create, rename, change details | `POST /api/nodes`, `PATCH /api/nodes/:id` | `edit_library` create, update | covered |
| Favourite any item (sections and folders too) | `PATCH /api/nodes/:id` `favourite` | `edit_library` update `favourite`; `browse_library` view favourites | covered |
| Move, drag and drop, folders of any depth | `POST /api/nodes/:id/move` | `edit_library` move (`parentId`, `afterId`) | covered (depth rule is the library's) |
| Duplicate, trash, restore | `POST /api/nodes/:id/duplicate`, `/trash`, `/restore` | `edit_library` | covered |
| Delete for good | `DELETE /api/nodes/:id` | none | excluded: permanent deletion is hers (route needs her session) |
| Trash list, recents | `GET /api/trash`, `GET /api/recents` | `browse_library` views trash, recents | covered (agents' reads never count as "opened") |
| Search | `GET /api/search` | `search_notes` | covered |
| Change feed, activity log | `GET /api/changes`, `GET /api/activity` | `changes` | covered (same events; the plain-word log is her view of them) |
| Upload links | `POST /api/uploads/tickets` | `source_files` upload_links | covered |
| Browser upload (multipart) | `POST /api/uploads`, `PUT /api/uploads/:token` | the link from upload_links | covered |
| Inbox, files under a node | `GET /api/files`, `GET /api/files/:id`, `/pages` | `source_files` list, `get_item` | covered |
| File, move, back to the inbox | `POST /api/files/:id/file` | `source_files` file, move | covered |
| Claim, release, retry | `POST /api/files/:id/claim`, `/release`, `/retry` | `source_files` | covered |
| Rename a file | `PATCH /api/files/:id` | `source_files` rename | **added 2026-11-22** |
| Trash, restore a file | `POST /api/files/:id/trash`, `/restore` | none | excluded for now: agents have never removed a source file (trashing one marks every citation to it, in all her notes, as trashed); left for Alex to decide |
| Delete a file for good | `DELETE /api/files/:id` | none | excluded: hers (session) |
| Download the original | `GET /api/files/:id/original` | none (page images and text via `get_page`, `get_item` text) | excluded for now: needs a signed link like the page images; left for Alex |
| Page, image, signed link | `GET /api/pages/:id`, `/image`, `/image-url` | `get_page` | covered |
| Read, save a transcript | `GET`, `PUT /api/pages/:id/transcript` | `get_page`, `save_transcript` | covered |
| Transcript revisions | `GET /api/pages/:id/transcript/revisions` | `get_item` pag_ with `history: true` | **added 2026-11-22** |
| Restore a transcript revision | `POST /api/pages/:id/transcript/revisions/:n/restore` | `source_files` restore_transcript | **added 2026-11-22** |
| Review a transcript | `POST /api/pages/:id/transcript/review` | none | excluded: her check against the page (session) |
| Converter state | `GET /api/converter/status` | `source_files` list, `start_here` | covered |
| Read a document, a block, by node | `GET /api/documents/:id`, `/content`, `/blocks/:blockId`, `GET /api/nodes/:id/document` | `get_item` | covered |
| Create, write, move, delete blocks, regenerate | `POST /api/documents`, `/blocks`, `PATCH .../blocks/:id`, `/blocks/move`, `/blocks/delete`, `/regenerate` | `write_document`, `edit_blocks` | covered |
| Several operations in one commit | `POST /api/documents/batch` | `edit_blocks`, one operation per call | covered in effect (each call is checked the same way) |
| Document references | `GET /api/documents/:id/references` | `get_item` doc_ | covered |
| Document revisions | `GET /api/documents/:id/revisions`, `/revisions/:n` | `get_item` doc_ with `history: true` (summaries; not a revision's snapshot) | **added 2026-11-22** |
| Restore a document revision | `POST /api/documents/:id/revisions/:n/restore` | `edit_blocks` restore_revision | covered |
| What cites a page or file | `GET /api/pages/:id/citations`, `/files/:id/citations` | `get_page` (count) | partly covered (the count, not the list) |
| Review a document | `POST /api/documents/:id/review` | none | excluded: hers (session) |
| Study map read, structure, ops | `GET /api/documents/:id/canvas`, `PUT .../structure`, `POST .../ops` | `study_map` | covered |
| Place cards, arrange, layout cache, live events | `PUT .../canvas/placements`, `POST .../arrange`, `.../layout-cache/:variant`, `GET .../events` | none | excluded: placing and arranging are hers (the pin rule); the cache and the event stream are her browser's |
| Side notes read | `GET /api/documents/:id/margin-notes` | `side_notes` | covered |
| Side notes write (text, colour, resolve, reattach, delete) | `POST`, `PATCH`, `DELETE .../margin-notes/...` | none | excluded: hers alone (docs/side-notes.md); agents read the colour |
| Concepts: list, search, page, graph, path, query, compare, suggestions, types, brand and generic | `GET /api/concepts...`, `POST /api/concepts/query`, `/compare` | `concepts` | covered (types in `start_here` topic concepts) |
| Create, change concepts and relations | `POST /api/concepts`, `/bulk`, `PATCH /api/concepts/:id`, `/relations...` | `concepts` upsert | covered |
| Merge concepts | `POST /api/concepts/:id/merge` | `concepts` merge | covered (with her claimed request) |
| Delete a concept or relation, review | `DELETE /api/concepts/:id`, `/relations/:id`, `POST .../review` | none | excluded: the domain refuses any key |
| Drug name check | `POST /api/concepts/name-checks`, `/:id/name-check` | none | not added: runs by itself after an upsert; left for Alex |
| Saved references: list, add | `GET`, `POST /api/references` | `references` | covered |
| Change, delete a saved reference | `PATCH`, `DELETE /api/references/:id` | none | excluded: hers (decision of 2026-11-16) |
| Questions: create, validate, list, get, update, trash, restore | `/api/practice/questions...` | `practice_questions`, `get_item` | covered |
| Delete a question, review, schedule | `DELETE`, `POST .../review`, `.../schedule` | none | excluded: hers (session; her study plan) |
| Results: weak areas, notebook, due, sessions, results, attempts | `/api/practice/...` | `study_progress` | covered (attempts as stats on `get_item` qst_) |
| Take a practice session | `POST /api/practice/sessions...` | none | excluded: an agent never answers for her |
| Exams: create, list, upcoming, get, update | `/api/exams...` | `exams`, `get_item` | covered |
| Delete an exam | `DELETE /api/exams/:id` | none | excluded: hers (session) |
| Calendar: exams, days studied, streak | `GET /api/calendar` | `study_progress` calendar | **added 2026-11-22** |
| Requests: list, get, counts, claim, release, complete, decline | `/api/requests...` | `requests`, `get_item` | covered |
| A request's instructions | `instructions` on each request | `requests` list and claim (follow them) | covered |
| Leave, edit, cancel, reopen a request | `POST /api/requests`, `PATCH`, `/cancel`, `/reopen` | none | excluded: requests are hers to agents (the domain refuses agents) |
| Saved instructions: read | `GET /api/me/preferences` `instructions` | `requests` instructions | **added 2026-11-22** |
| Saved instructions: add, edit, delete | `PATCH /api/me/preferences` `instructions` | none | excluded for now: they are her rules for agents, so an agent rewriting them would be writing its own rules; the route takes her session only; left for Alex |
| Tab order, guided tour seen, shortcut badges | `PATCH /api/me/preferences` `tabOrder`, `tourSeen`, `shortcutBadges` | none | excluded: presentational |
| Background picture | `GET`, `PUT`, `DELETE /api/me/background` | none | excluded: presentational, and a binary upload |
| Folded sections, sidebar widths, panel heights and folds, Read or Edit, practice focus aids | (browser storage, no route) | none | excluded: per device |
| Sign in and out, password, API keys, who am I | `/api/auth/...`, `/api/me`, `/api/me/password`, `/api/keys` | none | excluded: credentials and account security; `start_here` gives her name and the key's scope |
| Health | `GET /healthz` | none | not a user feature |

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
not logged (advisory, and they would drown the log). The change feed and the activity log use
the SAME code for the same event, and since migration `0620_activity_names.sql` one scheme,
`<area>.<past-tense verb>`:

| Area | Names now | Was |
|---|---|---|
| library | `library.created`, `.updated`, `.moved`, `.duplicated`, `.trashed`, `.restored`, `.deleted` | the feed said `node.*`, the activity log `library.*` |
| documents | `document.created`, `.restored` (a revision), `.trashed`, `.untrashed`, `.deleted`; `block.inserted`, `.edited`, `.moved`, `.deleted`, `.regenerated`, `.reviewed`; `document.edited` (a commit of several kinds) | activity: `create_document`, `insert_blocks`, `update_block`, `move_blocks`, `delete_blocks`, `replace_generated`, `restore_revision`, `batch`; feed: `document.updated`, `document.reviewed`, `document.restored_from_trash` |
| requests | `request.created`, `.edited`, `.cancelled`, `.reopened`, `.claimed`, `.released`, `.completed`, `.declined` | `request.claim`, `.release`, `.complete`, `.decline` |
| practice | `question.authored`, `.updated`, `.trashed`, `.restored`, `.deleted` | `question.created` |
| concepts | `concept.upserted` (one entry per bulk call), `.created`, `.updated`, `.related`, `.merged`, `.deleted`, `.unsourced` | `concept.bulk_upserted`, `concept.source_deleted` |
| files | `file.*` and `transcript.*`, `exam.*` | unchanged |
| canvas | `canvas.arranged` (an agent set the structure, or she arranged), `.edited` (an agent's ops), `.placed` (hers), `.synced` (the document changed) | `canvas.structure_set`, `canvas.changed`, `canvas.merged` |

The migration rewrote the old rows in both tables (`document.updated` in the feed cannot be
traced to one operation any more and became `document.edited`). The plain-word summaries did not
change.

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
- `test/mcp-canvas.test.ts`, over the real composed app: `study_map` (get; set_structure with
  frames, labelled connectors, a note and a wide card; the same body twice changes nothing;
  change with an earlier call's IDs; the activity entry `canvas.arranged` in plain words),
  teach-by-error (coordinates, a connector to nowhere, a block outside the document, ops hers
  alone, a stale revision, a library ID where a document goes), the pin rule (three cards
  she pinned through her session keep their exact positions after a set_structure that omits
  them; an op on one is refused with the rule; a request about one block does not lift it, a
  request about the document does), read-only key, another user's document, a writing claim by
  another agent, `start_here`'s study-map section and topic; writing claims on a section and on a
  study guide by `doc_` ID with `get_item` from both directions; a request reply whose dose the
  slide does not say (refused with the figures, acknowledged, shown flagged to her).
- `test/request-figures.test.ts`: the figure recognizer (values, ranges, decimals, mcg for µg, decimal
  commas; bare integers and words never trip it) and the domain guard (refused, accepted from the
  target, from a cited block, from her own message; acknowledged with the flag and the list;
  declines unchecked; over the HTTP API).
- `test/activity-names.test.ts`: migration `0620_activity_names.sql` on rows written under every old
  name, in both tables, idempotent. The filing rule is tested in `files-workflow.test.ts` (HTTP: both
  callers, force without a reason, back to the inbox) and `services.test.ts` (the forced reason in
  the activity log), the MCP side in `mcp-real.test.ts`.
- `test/mcp-parity.test.ts`, over the real composed app: `study_progress calendar` returns exactly what
  `GET /api/calendar` returns for the same key, refuses more than 62 days and a bad date, works with a
  read key; `requests instructions` lists what she saved through her session, is empty for another
  user, and the preferences route refuses a key; `source_files rename`; `get_item` page history,
  `restore_transcript` as a new revision, refused for an unknown or current revision, another agent's
  claim and a read-only key; no `trash` action; `get_item` document history and `restore_revision`
  from it; `history` on a node refused.
- `test/mcp-cli.test.ts`: `admin create-key`.

## Live checks

`apps/server/scripts/mcp-live-check.sh [claude|codex|both|smoke|measure] [guide|requests|canvas]` starts the real server
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

### Canvas scenario (2026-11-16)

`scripts/mcp-live-check.sh <agent> canvas` seeds, through the HTTP API (`mcp-live-check.seed-canvas.ts`):
term, course and lecture 7; the 12-slide deck uploaded by her session and converted by the real
converter; a cited study guide written into the lecture by a separate agent key ("Seed agent": an h1,
then an h2 and two quoted, cited paragraphs for each of nine slides, 28 blocks); the deck filed by her;
and three cards on the map pinned by her session (`PUT .../canvas/placements`, at (120, 1900),
(640, 1900), (1160, 1900)). The prompt: "Arrange lecture 7's study map into frames by topic with
labelled connectors between related cards, and add a note card summarising the single most important
point. Do not move anything she placed. Report what you did." `mcp-live-check.verify-canvas.ts` then
reads the database: frames and connectors made by the agent, every connector labelled and joining two
cards on the map, every block card naming a real block, a connector across two frames, her three cards
at exactly their coordinates and no other card pinned or sized, a note card by the agent, and the
activity log.

| Run | Outcome (from the database) | Cost |
|---|---|---|
| Claude `haiku` (the cheapest model; first and only run) | **All checks passed.** 12 turns, 80 s: start_here, library walk to the lecture, `get_item` on it, `study_map get` with `include: full`, then one `set_structure` refused from its error alone (two connector `kind`s were not in the list; the error named `$.connectors[1].kind` and the valid kinds), then the corrected one. Result: 5 agent frames by topic (Fundamentals, Drug selectivity, Clinical use, Safety, Dosing), 9 labelled connectors across frames, an agent note card; her three pins unchanged; entry `canvas.arranged`: "Arranged the study map for Beta blockers: study guide into 6 frames". | $0.20 |
| Codex | **All checks passed.** One `start_here {"topic":"study_map"}`, `study_map get`, then a single `change` call (4 frame renames, 1 frame, 1 note card, 9 labelled connectors); nothing refused; entry `canvas.edited`: "Changed the study map for Beta blockers: study guide: added 1 card, 9 connectors, 1 frame; changed 4 frames". Neither agent touched a pinned card, so the pin refusal itself is proved in `mcp-canvas.test.ts`, not live. 284k input tokens (248k cached), 1.4k output. | ChatGPT plan |

### Size

Measured with `scripts/mcp-live-check.sh measure` (Claude Code's own usage, read by
`mcp-live-check.tokens.mjs`; haiku loads every notes tool schema with ToolSearch, then calls
`start_here`; the growth of the context between turns is the cost). Budget: the whole listing under
80,000 characters of JSON, every tool's schema under 9,000, `start_here`'s overview under 12,000
characters and any topic under 20,000 (all tested), and the listing under about 20,000 tokens.

| 2026-11-16 | Listing (all schemas) | `start_here` default |
|---|---|---|
| Sixteen tools, after the compact citation and link schemas (measured now; 18 schemas incl. 2 non-notes) | +17,495 tokens (two runs: 17,494 and 17,496) | +2,613 |
| Seventeen tools, with `study_map` (19 schemas) | **+19,831 tokens**, 61,600 characters of JSON | **+2,926** (`study_map` is 7,621 characters, about 2,340 tokens; its overview section about 310) |

The earlier figure (19,310 for sixteen tools, 2,591 for `start_here`) was taken before the compact
schemas; the sixteen-tool listing is now 17.5k. The current listing is within the budget (19.8k of
about 20k tokens). Codex's reported input did not grow when the server was attached, so it could
not be used. `start_here` stays short by keeping detail in topics (largest: blocks 7.3k and
practice 6.0k characters).

## Open questions

- The figure check on a request reply (below) only looks for numbers with units, ranges and
  decimals, and only for their presence in the sources: it cannot tell that a figure that does
  occur is the right one (a dose of 50 mg from another drug's row passes), and a reply that cites
  nothing about a lecture-wide request (`node` target) is checked against everything under the node,
  which is generous. Tune the unit list on her real notes.
- The check for unflagged doses and decimals is a pattern; tune it on her real notes. The figure
  check reuses that pattern (`domains/files/figures.ts`).
- Two agents that both create a study guide at the same instant can still write two; the claim helps
  once one exists (see Duplicate work).
- A study map's card text previews are the first 100 characters of a block; a very long document
  gives a long `get`. Pass `include` only when the whole structure is needed.
- Rate limiting is in memory, which fits the single container.
