# Web API contract

The contract between `apps/web` and `apps/server` for stage 1. Types named here are
exported from `@notes/schema`. The MCP layer is a second front door onto the same
services and is documented separately when it is built.

## Conventions

- All routes are under `/api`. Bodies are JSON unless stated.
- **Errors:** a non-2xx response has the body `{ "error": ApiError }`. HTTP status by
  code: `unauthenticated` 401, `forbidden` and `read_only_key` 403, `not_found` 404,
  `invalid_input` 400, `conflict` 409, `rate_limited` 429 (with `retryAfter` and a
  `Retry-After` header), `too_large` 413, `storage_unavailable` 503, `internal` 500.
- **Browser sign-in:** a session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` in
  production, 30-day sliding expiry). State-changing requests must carry an `Origin`
  header matching the app's origin, or they are refused with `forbidden`.
- **Agent sign-in:** `Authorization: Bearer <api key>`. A `read` key gets `read_only_key`
  on any state-changing route.
- **Isolation:** every object belongs to one user. Asking for another user's object
  returns `not_found`, never `forbidden`.
- **Lists** return `{ "items": [...], "nextCursor": string | null }` and accept `cursor`
  and `limit` query parameters.
- Timestamps are ISO 8601 UTC strings.

## Accounts

| Method and path | Body | Returns |
|---|---|---|
| `POST /api/auth/login` | `LoginInput` | `{ user: User }`, sets the cookie. Wrong username and wrong password give the same `unauthenticated` error. |
| `POST /api/auth/logout` | none | `204`, clears this session |
| `POST /api/auth/logout-all` | none | `204`, ends every session for the user |
| `GET /api/me` | | `{ user: User }` |
| `POST /api/me/password` | `ChangePasswordInput` | `204`; ends all other sessions |

Sign-in is limited per account and per address, with delays that grow on repeated
failures. A limited attempt returns `rate_limited`.

## API keys

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/keys` | | `{ items: ApiKey[] }` (revoked keys included, newest first) |
| `POST /api/keys` | `CreateApiKeyInput` | `CreatedApiKey` (the secret appears only here) |
| `DELETE /api/keys/:id` | | `204`; the key stops working at once |

These three routes accept a browser session only, never an API key.

## Library

| Method and path | Body or query | Returns |
|---|---|---|
| `GET /api/nodes` | `parentId` (omit for the root), `cursor`, `limit` | list of `NodeWithLinks`, in sibling order, trashed items excluded |
| `GET /api/nodes/:id` | | `{ node: NodeWithLinks }` |
| `POST /api/nodes` | `CreateNodeInput` | `{ node }`. Creating a course also creates its five sections. |
| `PATCH /api/nodes/:id` | `UpdateNodeInput` | `{ node }` |
| `POST /api/nodes/:id/move` | `MoveNodeInput` | `{ node }` |
| `POST /api/nodes/:id/duplicate` | none | `{ node }` (the copy, placed after the original) |
| `POST /api/nodes/:id/trash` | none | `{ node }` |
| `POST /api/nodes/:id/restore` | none | `{ node }` |
| `DELETE /api/nodes/:id` | none | `204`. Only allowed when the node is already in the trash, and only with a browser session. |
| `GET /api/trash` | `cursor`, `limit` | list of trashed `NodeWithLinks` (top-most trashed item of each subtree) |
| `GET /api/recents` | `limit` | list of recently opened or changed `NodeWithLinks` |
| `GET /api/favourites` | | list of `NodeWithLinks` |
| `GET /api/search` | `q`, `kinds`, `cursor`, `limit` | `{ items: SearchHit[], nextCursor }`: see [Search](#search) |

Rules the server enforces (and reports with `invalid_input` or `conflict`, a hint and a
valid example):

- A node may only be placed where `canContain(parentKind, childKind)` allows.
- Sections cannot be created, renamed, moved, duplicated or trashed on their own.
- Folders nest at most `MAX_FOLDER_DEPTH` deep below a section.
- A node cannot be moved into itself or its own descendants.
- Trashing a node trashes everything under it; restoring brings it all back. Restoring
  into a trashed parent is refused.

Trashing, restoring, deleting and duplicating a node carry through to what hangs off it:

- **Documents** of the node and of everything under it are hidden on trash (they answer
  `not_found`, drop out of search and read as trashed in the reverse lookup), come back
  with all their blocks and revisions on restore, are removed on permanent delete, and are
  deep-copied on duplicate (new document and block IDs, citations included).
- **Source files** filed under the node or anything under it go **back to the inbox,
  unfiled** (status `transcribed` or `converted` again): they are never trashed or deleted
  as a side effect, and their original, pages and transcripts are untouched. When the node
  came back from the trash they are filed there again, unless they were filed somewhere
  else in the meantime. After a permanent delete they simply stay in the inbox.

All of this happens in the same transaction as the library change.

## Files, pages and inbox

All routes need a sign-in (session or key) except `PUT /api/uploads/:token` and a signed
`GET /api/pages/:id/image`. Routes that change anything need a session or a **write** key
(`read_only_key` otherwise). Everything is scoped to the caller: another user's file or page
is `not_found`.

### Uploading

| Method and path | Body or query | Returns |
|---|---|---|
| `POST /api/uploads` | multipart form: field `file` (exactly one), optional field or query `nodeId` | `201 { file: SourceFile }` |
| `POST /api/uploads/tickets` | `RequestUploadsInput` | `201 { items: UploadTicket[] }`, one per file, in order |
| `PUT /api/uploads/:token` | the raw bytes | `201 { file: SourceFile }` |

- The body is streamed to `tmp/` on the data volume and never held in memory. The size cap
  (`UPLOAD_LIMITS.maxBytes`, or the ticket's declared size) is enforced while streaming;
  past it the upload is aborted with `too_large` and nothing is left behind. A declared
  `Content-Length` over the cap is refused before any byte is read.
- The type is read from the content (PDF, JPEG, PNG, HEIC by magic bytes; PPTX is a ZIP
  whose `[Content_Types].xml` declares a presentation and which holds
  `ppt/presentation.xml`). Anything else is `unsupported_type`, whatever the name or
  `Content-Type` says. The original is stored at `originals/<userId>/<sha256>`; identical
  content from the same user is stored once, and each upload still gets its own
  `SourceFile`.
- `originalName` is display text only: control characters, bidi marks and `/ \ : * ? " < > |`
  are replaced, leading dots dropped, length capped at 200 characters. It is never used in a
  path.
- A new file has status `converting` and a job in the queue (`uploaded` only if the queue
  file could not be written; `POST /api/files/:id/retry` queues it).
- `nodeId` files it under a lecture, a folder, or a course's Sources section once the work
  is done (see the state machine). Another user's node is `not_found`; a trashed node, a
  term, course, document or any other section is `invalid_input`.
- **Agent upload links (B2).** `POST /api/uploads/tickets` (needs write) returns tickets
  whose `url` is `${APP_ORIGIN}/api/uploads/<token>`. The token is the whole credential for
  `PUT`: no cookie, key or Origin is needed or read. A ticket works **once** (it is spent when
  the PUT starts; a failed upload does not make it reusable), for
  `UPLOAD_LIMITS.linkTtlSeconds` (10 minutes), up to the declared `bytes`. A spent or
  expired link is `conflict`; an unknown token is `not_found`. Only a hash of the token is
  stored. The file is recorded as uploaded by the actor that requested the ticket.

### Files and the inbox

| Method and path | Body or query | Returns |
|---|---|---|
| `GET /api/files` | `status`, `nodeId`, `inbox=true`, `trashed=true`, `cursor`, `limit` | list of `SourceFile`, newest first |
| `GET /api/files/:id` | | `{ file: SourceFile }` |
| `POST /api/files/:id/retry` | none | `{ file }` (status `failed` or `uploaded` only) |
| `POST /api/files/:id/file` | `{ nodeId: NodeId | null }` | `{ file }`; `null` takes it back to the inbox |
| `POST /api/files/:id/claim` | none | `{ file }` |
| `POST /api/files/:id/release` | none | `{ file }` |
| `POST /api/files/:id/trash` | none | `{ file }` |
| `POST /api/files/:id/restore` | none | `{ file }` |
| `DELETE /api/files/:id` | none | `204`; browser session only, and only from the trash |
| `GET /api/files/:id/original` | `download=true` | the original bytes |
| `GET /api/files/:id/pages` | | `{ items: Page[] }` in page order |
| `GET /api/converter/status` | | `{ converter: ConverterStatus }` |

`inbox=true` means not yet filed: live files whose status is not `filed` (so it includes
failed ones and ones still being transcribed). `trashed=true` lists the trash instead of
live files. Files in the trash refuse every change except `restore` and permanent delete.

**State machine** (`FileStatus`). Enforced in the server; there is no way to set a status
directly.

```
uploaded -> converting -> converted -> transcribed -> filed
               |   ^                       ^            |
               v   | retry                 +- unfiled --+
             failed
```
- `uploaded -> converting`: when the job file is written (at upload, or by `retry`).
- `converting -> converted`: the converter's result passed validation; pages are recorded.
- `converting -> failed`: converter failure (`errorCode` is the converter's code), an
  unusable result or a timeout (`conversion_failed`). `errorMessage` says why.
- `failed | uploaded -> converting`: `retry`. Any other status is `conflict`.
- `converted -> transcribed`: saving a transcript when every page of the file now has one.
  `transcribed -> filed` when it has a `nodeId`; `filed -> transcribed` when the node is
  taken off (`file` with `null`) or the library node is permanently deleted.
- The last three are derived: after every transcript save and every `file` call the status of
  a converted file is recomputed from the facts, so a file filed under a node before it is
  transcribed stays `converted` and becomes `filed` when its last page is transcribed.
  `file` works in any status (the node is recorded), but only the three states above
  move with it.
- `claim` needs a converted-or-later file (`conflict` otherwise).

**Claims.** A claim records the caller's actor in `claimedBy`/`claimedAt` and lasts 30
minutes unless the same actor claims again; after that the file reads as unclaimed, so a
crashed agent never blocks it. A live claim by someone else makes `claim` a `conflict`
(the hint says when it ends), blocks that other **agent's** transcript saves and restores,
and blocks its `release`. The signed-in user is never blocked and can release any claim.

**Permanent delete** removes the record, pages, transcripts and page images, and removes
`originals/<userId>/<sha256>` only when no other `SourceFile` of that user has the same
hash.

`ConverterStatus` is `{ state: "online" | "stale" | "offline", lastSeenAt, ageSeconds,
queued, processing, heartbeat }`: from `queue/heartbeat` (online within 30 seconds, stale
within 5 minutes, offline after that or when missing); `queued` and `processing` count job
files; `heartbeat` carries the file's own flat fields.

### Conversion hand-off

The server writes `queue/pending/<jobId>.json` (`{ jobId, userId, fileId, sha256,
createdAt, attempt }`, temp name then rename; `attempt` counts earlier jobs for the file)
after the original is stored. The converter's `done`/`failed` result files are polled about
every 1.5 seconds. A result is checked against the job the server issued: the job must still
be waiting or running; ids, the file's type, the page count, indexes and the page and
thumbnail images on disk must agree; sizes and dimensions must be sane. Anything else fails
the file with `conversion_failed`. Result files are deleted after handling; files with other
names, and results for unknown or finished jobs, are ignored (and the latter deleted). A job
not picked up within 15 minutes, or not finished within 45 minutes of pickup, fails the file
with `conversion_failed` and is withdrawn from the queue.

### Pages, images and transcripts

| Method and path | Body or query | Returns |
|---|---|---|
| `GET /api/pages/:id` | | `{ page: Page }` |
| `GET /api/pages/:id/image` | `size=page` (default) or `thumb`; or `exp` and `sig` | the WebP image |
| `GET /api/pages/:id/image-url` | `size` | `{ url, expiresAt }` |
| `GET /api/pages/:id/transcript` | | `{ transcript: Transcript | null }` (current revision) |
| `PUT /api/pages/:id/transcript` | `{ text, flags? }` (a matching `pageId` is allowed) | `201 { transcript }`, a new revision |
| `POST /api/pages/:id/transcript/review` | `{ reviewed?: boolean }` (default true) | `{ transcript }`; browser session only |
| `GET /api/pages/:id/transcript/revisions` | `cursor`, `limit` | list of `Transcript`, newest first |
| `POST /api/pages/:id/transcript/revisions/:revision/restore` | none | `201 { transcript }` |

- Every save creates a new revision (1, 2, 3 ...) authored by the caller's actor, starting
  `unverified`; earlier revisions are kept. Each flag's `quote` must occur in `text` exactly;
  otherwise `invalid_input` lists the quotes not found and shows an example. An empty text
  is allowed.
- `restore` copies the chosen revision's text and flags into a **new** revision (history is
  never rewritten); restoring the current one is `conflict`.
- Only the signed-in user can mark a transcript `reviewed` (or take it back). It applies to
  the current revision; saving again makes the new revision `unverified`.
- Page images and originals are sent with the right `Content-Type`, a
  `Content-Disposition` built from the cleaned name (ASCII fallback plus `filename*`), `Cache-Control:
  private, max-age=3600, must-revalidate`, a strong `ETag` (the SHA-256 for originals) with
  `If-None-Match` giving `304`, and `X-Content-Type-Options: nosniff`. Originals support one
  `Range` (`206`, `Accept-Ranges: bytes`; unsatisfiable is `416`). PDFs and images are
  `inline`, presentations `attachment`.
- **Signed image links.** `image-url` returns an absolute URL (`${APP_ORIGIN}`) carrying
  `exp` (Unix seconds, five minutes ahead) and `sig`, an HMAC-SHA-256 over the page id, size
  and expiry. The same `/image` route then needs no other credential, so an agent's shell can
  `curl` the page. A wrong or expired signature is `forbidden`.

`TranscriptHit` (what the files service returns to the unified search) is
`{ kind: "transcript", pageId, pageIndex, fileId, fileName, nodeId, transcriptId, snippet }`.
It covers the current revision of each page of live files; [Search](#search) turns it into a
`page` hit.

## Search

`GET /api/search?q=beta&kinds=node,page&limit=20` finds things in three places at once and
returns `{ items: SearchHit[], nextCursor }` (`SearchHit` is in `@notes/schema`):

| `kind` | Matches | Fields |
|---|---|---|
| `node` | the **name** of a library item (sections excluded) | `node: NodeWithLinks`, `snippet` |
| `page` | the **current transcript** of a page of a live file | `pageId`, `pageIndex` (1-based), `fileId`, `fileName`, `nodeId` (null while in the inbox), `transcriptId`, `snippet` |
| `block` | the **text of a block** of a live document | `documentId`, `nodeId`, `documentTitle`, `blockId`, `blockType`, `snippet` |

- `kinds` is a comma-separated subset of `node,page,block`; leave it out for all three. An
  unknown or empty list is `invalid_input`. `limit` is 1 to 100 (default 50).
- **Words** are matched as prefixes, all of them, case and accents ignored.
- **Ranking.** Each kind is ranked by the full-text engine on its own; the lists are merged by
  reciprocal rank: a hit at position `r` of its kind scores `weight / (3 + r)`, with weights
  node 1.5, block 1, page 0.9. So the best name match comes first, then the best block and
  the best page, then the next name matches, and so on; a name match outranks a block, which
  outranks a raw transcript page. Within a kind the engine's order stands.
- **One cursor.** `nextCursor` is opaque and covers all kinds; pass it back unchanged with the
  same `q` and `kinds`. Pages never repeat or skip a hit while nothing changes.
- **Trash.** Trashed library items, documents in the trash (including those under a trashed
  node) and pages of files in the trash are not found, and are found again after a restore.
  A file taken back to the inbox because its place was trashed is still found, with
  `nodeId: null`.
- Everything is scoped to the caller.

## Documents

A document is the body of a library node of kind `document` or `lecture`: one document per
node, an ordered list of typed blocks (see [blocks.md](blocks.md)). Bodies are the writer
operations of `@notes/schema` (`WRITER_OPERATIONS`); the document ID in the URL fills in
`documentId`, and a body that names a different one is refused. Types are `Document`,
`Block`, `Revision` and `RevisionSummary`.

| Method and path | Body or query | Returns |
|---|---|---|
| `POST /api/documents` | `create_document`: `kind`, `title`, `blocks?`, exactly one of `nodeId` or `parentId` | `201` `{ documentId, nodeId, revision: 1, blockIds }` |
| `POST /api/documents/batch` | `{ operations: [{ operation, input }] }`, 1 to 50, each with `documentId` inside `input` | `{ results }`, one per operation, tagged with `operation`. All or none. |
| `GET /api/documents/:id` | | light: `{ document, blocks: BlockPreview[], unverifiedCount }`. Block previews carry `id`, `type`, `preview` (first 120 characters), `origin`, `review`, `generalKnowledge`, `citationCount`, `flagCount`, `lastEditedBy`, `lastEditedAt`. |
| `GET /api/nodes/:nodeId/document` | | the same light view, found through the library node |
| `GET /api/documents/:id/content` | `from` (0-based index, default 0), `limit` (default 200, at most 1000) | `{ document, blocks: Block[], from, total }` |
| `GET /api/documents/:id/blocks/:blockId` | | `{ block }` |
| `POST /api/documents/:id/blocks` | `insert_blocks`: `blocks`, `position` (default `"end"`), `expectedRevision?` | `201` `{ documentId, revision, blockIds }` |
| `PATCH /api/documents/:id/blocks/:blockId` | `update_block`: `{ patch, requestId?, expectedRevision? }` or `{ block, ... }`. `mode` is inferred (`block` present means replace). | `{ documentId, revision, block }` |
| `POST /api/documents/:id/blocks/move` | `move_blocks`: `blockIds`, `position`, `toDocumentId?`, `expectedRevision?` | `{ documentId, revision, blockIds, toDocumentId?, toRevision? }` |
| `POST /api/documents/:id/blocks/delete` | `delete_blocks`: `blockIds`, `requestId?`, `expectedRevision?` | `{ documentId, revision, removed }` |
| `POST /api/documents/:id/regenerate` | `replace_generated`: `blocks`, `scope?`, `requestId?`, `expectedRevision?` | `{ documentId, revision, written, removed, skipped: [{ blockId, type, reason }] }` |
| `GET /api/documents/:id/revisions` | `cursor`, `limit` | list of `RevisionSummary`, newest first |
| `GET /api/documents/:id/revisions/:number` | | `{ revision }` with its full snapshot |
| `POST /api/documents/:id/revisions/:number/restore` | `{ expectedRevision? }` (optional body) | `{ documentId, revision, restoredFrom, blockCount }` |
| `POST /api/documents/:id/review` | `{ status: "reviewed" \| "unverified", blockIds?, expectedRevision? }`; leave out `blockIds` for the whole document | `{ documentId, revision, changed }`. **Browser session only.** |
| `GET /api/documents/:id/references` | | `{ documentId, revision, items }`: the references list (K7) |
| `GET /api/pages/:pageId/citations` | `cursor`, `limit` | what cites this page (K5): `{ fileId, pageId, items: CitationBacklink[], nextCursor }` |
| `GET /api/files/:fileId/citations` | `cursor`, `limit` | the same for any page of a file |

Reads need any signed-in caller; every changing route needs a write key or a session
(`read_only_key` otherwise). Another user's document, block, page or file is `not_found`.
A document whose library node is in the trash is `not_found` too, and returns on restore.

### How writes behave

- **Provenance.** The server stamps every block from the caller. An agent key gives
  `origin: "agent"` and `review: "unverified"`; her session gives `origin: "user"` and
  `reviewed`. Editing makes a block hers; an agent rewriting it at her request makes it the
  agent's and unverified again.
- **Citation rule.** An agent block of a type that must cite needs a citation on the block or
  one of its fields, or `generalKnowledge: true`. The refusal is `invalid_input` whose
  `message` starts with the JSON path (`$.blocks[1].citations: This paragraph has no
  citation. ...`) and whose `example` is a valid block of that type. New citations an agent
  writes are also checked against her library: the page must exist, must not be trashed, and
  the quote must occur character for character in its current transcript.
- **Edit protection.** An agent may not replace, patch or delete a block she wrote, edited or
  reviewed unless the call carries a `requestId` (accepted and recorded; the request itself
  is validated later). Refusal is `forbidden`; the message names the blocks and why, the hint
  says to pass `requestId`, and nothing is written. A delete naming several blocks is refused
  whole. Regeneration instead keeps those blocks and reports them in `skipped` with reason
  `user_edited` or `reviewed`. Moving a block is allowed. An agent restoring a revision is
  refused when it would change or remove one of her blocks.
- **Concurrency.** Per document: every write may carry `expectedRevision`. A stale one is
  `409 conflict` with the current revision in the message and `example: { expectedRevision }`;
  re-read, check the change still makes sense, and resend. Left out, the write applies to
  whatever is there (the protection rules still hold). Always send it with a review, so she
  never verifies content that changed after she looked.
- **Batches.** Operations run in order inside one transaction. A document touched by a batch
  gets exactly one new revision, and each `expectedRevision` inside is checked against the
  revision the batch started from. A validation error names the operation:
  `$.operations[1].input.blocks[0].citations`.
- **Revisions.** Every write that changes something appends a full snapshot and bumps
  `revision` by one; a write that changes nothing does not. Restoring appends a new revision
  (`restoredFrom` set) and never edits an earlier one; the state it replaces is already the
  previous snapshot. Per document the newest 200 snapshots are kept, plus revision 1; older
  ones are pruned, and asking for one answers `not_found` and says which are kept.
- **Validation errors.** `invalid_input` with `message` `"<path>: <what is wrong>"` (or
  `"N problems. First, at <path>: ..."`), `hint` listing every problem, and `example` a
  minimal valid block (or operation body) for the first one.

### References

`items` are `Reference` (`number`, `citation`, `uses`) plus: `status` (`available`,
`source_trashed`, `source_deleted`), `unavailable` (true unless available), `fileName`,
`pageIndex`, `quoteStillPresent` (null when unknown) and `currentTranscriptRevision`. Status
is computed on every read; nothing in a block is rewritten when a source is trashed.

`quoteStillPresent` is true when the quote occurs, whitespace-normalised (runs of spaces and
line breaks count as one space), in the page's **current transcript**, its **native text** (the
text layer of a PDF or slide) or its **speaker notes**; so slide text can be cited before the
page is transcribed. It is false when the page has such text and the quote is in none of it,
and null while the page has no text at all. A page that does not belong to the cited file, or
to the caller, does not exist (`source_deleted`). A new citation by an agent is refused when
the page is missing or trashed or the quote is `false`; a `null` is let through.

The reverse lookups (`GET /api/pages/:pageId/citations`, `GET /api/files/:fileId/citations`)
answer `not_found` for a page or file that is not the caller's or was deleted.

## Activity and changes

| Method and path | Query | Returns |
|---|---|---|
| `GET /api/changes` | `cursor` (omit to start from the beginning), `limit` (default 100, at most 500) | `{ items: ChangeEntry[], nextCursor, hasMore }`, oldest first |
| `GET /api/activity` | `keyId`, `action`, `objectId`, `since`, `until` (ISO times), `cursor`, `limit` (default 50) | `{ items: ActivityEntry[], nextCursor }`, newest first |

**Change feed (H9).** An entry is `{ seq, at, action, objectType, objectIds, documentId,
nodeId, revision, actor, requestId, summary }`. Actions:

- documents: `document.created`, `document.updated`, `document.reviewed`, `document.restored`
  (a revision was restored), `document.trashed`, `document.restored_from_trash`,
  `document.deleted`;
- library (`objectType: "node"`): `node.created`, `node.updated`, `node.moved`,
  `node.duplicated`, `node.trashed`, `node.restored`, `node.deleted`; `objectIds` are the node
  (for a delete, everything deleted with it), `nodeId` is the node;
- files (`objectType: "file"`, or `"page"` with `objectIds: [fileId, pageId]`): `file.uploaded`,
  `file.converted` and `file.failed` (the actor is whoever uploaded the file), `file.retried`,
  `file.filed`, `file.unfiled` (also when its place went to the trash or was deleted),
  `file.claimed`, `file.released`, `file.trashed`, `file.restored`, `file.deleted`;
  `transcript.saved`, `transcript.restored`, `transcript.reviewed`.

All of them land in the same feed, in commit order, for the user whose data it is.

The cursor is the last
`seq` seen; `nextCursor` never moves backwards and is returned even when `items` is empty, so
a poller simply stores it and sends it next time. `seq` strictly increases in commit order
(one sequence shared by all users, so one user's numbers have gaps). Entries are written in
the same transaction as the change, so a failed write leaves none. A batch writes one entry
per document touched.

**Activity log (H10).** One entry per thing an agent did, never for her own work:
`{ id, at, keyId, keyLabel, action, summary, links }`. `action` is the operation
(`insert_blocks`, `replace_generated`, ...) or `batch` for documents, `library.created`,
`library.moved`, ... for the library and the change feed's own codes (`file.uploaded`,
`transcript.saved`, ...) for files; `summary` is plain words such as `Beta blockers:
Regenerated: wrote 3 blocks, removed 5, left 2 of hers alone`, `Created lecture 07 · Beta
blockers`, `Uploaded beta-blockers.pptx`, `Transcribed page 3 of beta-blockers.pptx` or
`Filed beta-blockers.pptx under lecture 07 · Beta blockers`; `links` point at the document
(with its library `nodeId`), up to 15 of the blocks and the request when one was named, or at
the `node`, `file` and `page`. `objectId` filters on any of those IDs. Conversion results
(done by the converter, not an agent) and the knock-on effects of trashing a node are in the
change feed only.
(`insert_blocks`, `replace_generated`, ...) or `batch`; `summary` is plain words such as
`Beta blockers: Regenerated: wrote 3 blocks, removed 5, left 2 of hers alone`; `links` point at
the document (with its library `nodeId`), up to 15 of the blocks, and the request when one
was named. `objectId` filters on any of those IDs.

## Practice

Questions, practice sessions, the missed-questions notebook, weak areas and the review
schedule. Code: `apps/server/src/domains/practice/`; the question schemas, grading and
scheduling are the pure functions of `packages/schema/src/practice/` (see
[practice.md](practice.md)). Types are `practice.Question`, `practice.QuestionInput`,
`practice.Answer`, `practice.GradeResult`. Reads need any signed-in caller; changing routes
need a session or a **write** key (`read_only_key` otherwise); the routes marked *session*
need her browser session (an agent key gets `forbidden`). Everything is scoped to the caller:
another user's question, session or exam is `not_found`.

### Questions

| Method and path | Body or query | Returns |
|---|---|---|
| `POST /api/practice/questions` | `{ nodeIds, questions, partial? }`: 1 to 10 nodes, 1 to 100 questions as `QuestionInput` | `201` (`200` when nothing was stored) `{ stored, created: QuestionSummary[], problems }` |
| `POST /api/practice/questions/validate` | `{ questions }` | `{ valid, problems }`; checks only, stores nothing |
| `GET /api/practice/questions` | `nodeId` (and everything below it), `type`, `tag`, `conceptId`, `difficulty`, `review`, `examId`, `author` (`agent` or `user`), `trashed=true` (the trash instead), `full=true` (content with each item), `cursor`, `limit` | `{ items: QuestionSummary[] \| QuestionDetail[], nextCursor }`, in creation order |
| `GET /api/practice/questions/:id` | | `{ question: QuestionDetail }`: the stored `question`, its `nodeIds`, `examIds`, `stats`, and its `card` |
| `PATCH /api/practice/questions/:id` | `{ question?, nodeIds? }`: the whole new content (same type), and/or where it lives | `{ question: QuestionDetail }` |
| `POST /api/practice/questions/:id/trash` / `restore` | none | `{ question: QuestionSummary }` |
| `DELETE /api/practice/questions/:id` | none | `204`. *Session.* Only from the trash. Her attempts stay as history. |
| `POST /api/practice/questions/:id/review` | `{ status: "reviewed" \| "unverified" }` | `{ question, changed }`. *Session.* |
| `POST /api/practice/questions/review` | `{ questionIds (1 to 200), status }` | `{ changed, items }`. *Session.* |
| `POST /api/practice/questions/:id/schedule` | `{ enabled }` | `{ question }`; puts any question type on the review schedule (flashcards always are) |
| `GET /api/practice/questions/:id/attempts` | `cursor`, `limit` | list of her answers to it, newest first |
| `GET /api/practice/citations/pages/:pageId`, `/files/:fileId` | `cursor`, `limit` | questions that cite a page (K5): `{ pageId, fileId, items: CitationBacklink[], nextCursor }` |

`QuestionSummary` is `{ id, type, text, difficulty, tags, conceptIds, nodeIds, review, author,
generalKnowledge, citationCount, scheduled, createdAt, updatedAt, trashedAt }`.

- **Filing.** Every question lives under one or more library nodes: a lecture, a folder, a
  document, or the Practice section itself. Another user's node is `not_found`; a trashed node
  or any other kind of node is `invalid_input`. Listing by `nodeId` includes everything below
  it, so a course lists all its questions.
- **Authoring.** Each question is checked with `validateQuestionInput`. A batch is **atomic**:
  if any question has a problem the whole call is `invalid_input`, nothing is stored, `message`
  says how many failed and the first problem, `hint` lists every problem as
  `questions[3] $.options[1].text: ...`, and `example` is a valid question of the first one's
  type. With `"partial": true` the valid questions are stored and `problems` is
  `[{ index, problems: [{ path, message, example }] }]` for the rest.
  `POST .../validate` returns the same structure without storing anything.
- **Citation rule.** Every question, from an agent or from her, needs at least one citation
  or `generalKnowledge: true` (never both). Citations are checked against her library like
  document citations: the page must be hers and not trashed, and the quote must occur
  character for character in the page's current transcript (`$.sources[0].quote` otherwise).
- **Provenance.** The server stamps `author` from the caller. An agent's questions start
  `unverified`; hers are `reviewed`. Only her session marks questions reviewed. An agent may
  not rewrite a question she reviewed or wrote (`forbidden`; moving it between nodes is
  allowed). A rewrite by an agent makes the question the agent's and unverified again.
- **Trash.** A question is hidden when it is trashed, or when every node it lives under is in
  the trash; restoring brings it back with its history and schedule.

### Sessions

A session belongs to her. An agent can read sessions and results (G8) but cannot start one or
answer. The server stores the question order, every variant seed (the numbers of a
calculation) and every shuffle seed (option order), so a session is reproducible, and a
session started on a phone continues on another device with the same questions, numbers and
order.

| Method and path | Body or query | Returns |
|---|---|---|
| `POST /api/practice/sessions` | `{ scope, formats?, length? (default 10, at most 100), seed? }`. *Session.* | `201 { session: SessionView, next: PresentedQuestion \| null }` |
| `GET /api/practice/sessions` | `status`, `cursor`, `limit` | list of `SessionView` (with `correct`), newest first |
| `GET /api/practice/sessions/:id` | | `{ session }` |
| `GET /api/practice/sessions/:id/next` | | `{ session, next }`: the first unanswered question, without its answer key; `null` when none is left |
| `GET /api/practice/sessions/:id/items/:position` | | one position: unanswered `{ answered: false, question }`, or answered with her `attempt`, the `reveal` and the citations |
| `POST /api/practice/sessions/:id/answer` | `{ position?, answer, timeTakenMs? }`. *Session.* | `AnswerOutcome` |
| `POST /api/practice/sessions/:id/reveal` | `{ position }`. *Session.* | `{ position, reveal }`: the key of a question she marks herself (flashcard, free response, and those parts of a case) |
| `POST /api/practice/sessions/:id/finish` | none. *Session.* | `SessionResults`; finishing twice is fine |
| `POST /api/practice/sessions/:id/abandon` | none. *Session.* | `{ session }` |
| `GET /api/practice/sessions/:id/results` | | `SessionResults` |

`scope` is one of `{ kind: "nodes", nodeIds }` (each and everything below it),
`{ kind: "concepts", conceptIds }`, `{ kind: "exam", examId }`, `{ kind: "missed", examId?,
nodeIds? }` (the notebook), `{ kind: "due", examId?, nodeIds? }` (flashcards and scheduled
questions due now, most overdue first, then new cards) or `{ kind: "all" }`. `formats` limits
the question types (all by default). Questions are chosen by the shared `buildSession`:
balanced across the types, weak questions more likely, shuffled. A small pool gives a shorter
session (`shortfall` says by how much); an empty one is `invalid_input` with a hint saying why.

- **No answer leaks.** `PresentedQuestion` is `{ position, total, questionId, type, view,
  selfGraded }`. `view` is written field by field for each type (never the question minus a few
  keys): multiple choice and select-all show option ids and texts in this session's order;
  matching shows the left items and the right-hand column (always shuffled); fill-in shows the
  text and the number of blanks; a calculation shows the prompt with her variant's numbers
  filled in and `needsUnit`; a flashcard its front; free response its prompt; a case its
  vignette and the views of its parts. Correct flags, rationales, accepted answers,
  expressions, variables, units, rubrics, model answers, backs and explanations are absent until
  she has answered.
- **Grading is on the server.** `answer` is an `Answer` (one shape per type) graded with
  `grade` from the stored question and the stored variant seed. Any `correct`, `score` or
  `result` the client adds is ignored. An answer that cannot be read for the type (unknown option
  id, wrong number of blanks, a free-response tick for a point that does not exist) is
  `invalid_input` and does not use up the question; a calculation with a missing or wrong unit
  is a graded wrong answer with feedback. Position defaults to the first unanswered one. A
  position is answered once: a second answer is `conflict`.
- **Self-graded types** (flashcard, free response, and those parts of a case) take her own
  judgement in the answer (`rating`, or `covered` rubric positions). Call `reveal` first to show
  the key; it never reveals the app-graded parts of a case.
- **Time.** `timeTakenMs` is stored when sent; otherwise the server measures from the previous
  answer (or the start of the session).
- `AnswerOutcome` is `{ attempt, result: GradeResult, reveal, citations, generalKnowledge,
  schedule, progress: { answered, total, finished }, next }`. `reveal` carries the explanation
  (with a calculation's numbers filled in), each option's correctness and rationale, the pairs,
  the accepted answers, the rubric and model answer, and for a case each part's. `schedule` is
  `{ rating, intervalDays, due }` when the question has a card. Answering the last question
  finishes the session.
- `SessionResults` is `{ session, summary: { total, answered, unanswered, correct, incorrect,
  accuracy, points, maxPoints, percent, timeTakenMs, durationMs }, items: [{ position,
  questionId, type, text, answered, correct, score, points, maxPoints, timeTakenMs, answer,
  result, tags, conceptIds, nodeIds }] }`. Unanswered items show no key. `text` is `null` for a
  question deleted for good. `finish` closes the session with the questions she answered;
  `abandon` closes it without finishing (its answers still count in the notebook and weak
  areas). A closed session takes no more answers (`conflict`).

### Notebook, weak areas, review schedule

| Method and path | Query | Returns |
|---|---|---|
| `GET /api/practice/notebook` | `nodeId`, `type` | `{ items: [{ questionId, type, timesMissed, firstMissedAt, lastMissedAt, correctRun, stillNeeds, question: QuestionSummary }], counts: { total, byType } }`, newest miss first |
| `GET /api/practice/weak-areas` | `nodeId`, `minAttempts` (5), `minQuestions` (3), `weakBelow` (0.7) | `{ byTag, byConcept, byNode, unmatchedAttempts, thresholds }`; each area is `{ key, attempts, correct, accuracy, meanScore, questions, status, label }` with `status` `weak`, `ok` or `insufficient_data`; `label` is the readable path of a library area |
| `GET /api/practice/due` | `nodeId`, `examId`, `type`, `limit`, `utcOffsetMinutes` | `{ items: [{ question, card, overdueDays, intervals }], counts: { due, new, total, byDay: [{ date, count }] } }` |

- **Notebook (G11).** Exactly the pure rule `notebookEntries` over her stored attempts: a
  miss puts a question in; one correct answer takes it out (two in a row for a calculation);
  flashcards never enter. There is no manual removal. Questions in the trash are not listed.
- **Weak areas (G6).** `weakAreas` over her attempts, with each question's tags, concepts and
  every node above its lecture (so a course and a folder have figures too). An area stays
  `insufficient_data` until it has 5 attempts across 3 different questions.
- **Spaced repetition (G9).** One card per (her, question), FSRS-6 via `reviewCard`. Flashcards
  get one when they are created (new, due at once); other types join with
  `POST .../schedule`. Any answer to a question that has a card reviews it: a flashcard uses
  the rating she gave, other types `ratingFromGrade`. `due` lists reviews due now, most
  overdue first, then new cards. `byDay` forecasts the next 14 days (today includes anything
  overdue); `utcOffsetMinutes` says where her day ends (default 0, UTC). `intervals` previews
  the days to the next review for each of the four buttons.

## Exams

An exam belongs to a course, has a date and lists the lectures, folders or documents it
covers; each covered node must be inside the course. Code: `apps/server/src/domains/exams/`.
Reads need any signed-in caller (agents read exams to plan a review schedule backwards from
the date, M4); changing routes need a session or a write key; delete needs her session.

| Method and path | Body or query | Returns |
|---|---|---|
| `POST /api/exams` | `{ courseId, title, date, nodeIds?, notes? }`; `date` is `YYYY-MM-DD` | `201 { exam: ExamDetail }` |
| `GET /api/exams` | `courseId`, `from`, `to` (days), `cursor`, `limit` | `{ items: [ExamView + daysRemaining], nextCursor }` by date, soonest first |
| `GET /api/exams/upcoming` | `limit` (10), `withinDays`, `utcOffsetMinutes` | `{ items: ExamDetail[] }`: exams from today on, soonest first (the home screen, M2) |
| `GET /api/exams/:id` | `utcOffsetMinutes` | `{ exam: ExamDetail }` |
| `PATCH /api/exams/:id` | any of `title`, `date`, `nodeIds`, `notes` | `{ exam }` |
| `DELETE /api/exams/:id` | none | `204`. *Session.* The material it covered is untouched. |

`ExamView` is `{ id, courseId, courseName, title, date, notes, nodeIds, coverage: [{ nodeId,
name, path }], createdBy, createdAt, updatedAt }`. `ExamDetail` adds `daysRemaining` (whole days
from today, 0 on the day, negative once past) and `progress`: `{ questions, attempted,
attemptedShare, attempts, correct, accuracy, dueCards, newCards, notebook }`, over the live
questions filed under the covered nodes and everything below them (`attemptedShare` and
`accuracy` are `null` until there is something to divide). A course in the trash hides its
exams; a covered node deleted for good drops out of the list.

An exam is also a session scope (`{ kind: "exam", examId }`, or `examId` on `missed` and `due`
scopes, and a filter on the question list and the due deck): the questions in scope are those
filed under the covered nodes.
## Requests

The request queue (features L1 to L5): she leaves a request, an agent claims it over MCP or
HTTP, does the work and replies. Types are `StudyRequest`, `StudyRequestWithContext`, `RequestTarget`,
`RequestKind`, `RequestStatus` and `RequestCounts` from `@notes/schema`; the state machine is
`REQUEST_TRANSITIONS` and `canTransition`.

A **target** is one of `{ type: "library" }`, `{ type: "node", nodeId }`, `{ type: "document",
documentId }`, `{ type: "block", documentId, blockId }`, `{ type: "source", fileId, pageId? }`
or `{ type: "question", questionId }`. A block target records its document so the request
survives the block being replaced when the document is regenerated: the request then points at
the document and says so in `context.note`. The target must exist for her and not be in the
trash. `kind` is `wrong`, `unclear`, `expand`, `more_like_this`, `make_questions`, `summarise`,
`quiz_me` or `other`; only `other` needs a `message`.

| Method and path | Body or query | Returns |
|---|---|---|
| `POST /api/requests` | `{ target, kind?, message? }` (hers) | `201 { request }` |
| `GET /api/requests` | `status` (one or more, comma separated; default: all but `cancelled`), `targetType`, `nodeId`, `documentId`, `blockId`, `fileId`, `questionId`, `order` (`newest` or `oldest`), `cursor`, `limit` | list of `StudyRequestWithContext` |
| `GET /api/requests/counts` | | `{ counts: { waiting, in_progress, done, declined, cancelled, open } }`; `open` is waiting plus in progress, for the badge |
| `GET /api/requests/:id` | | `{ request }` |
| `PATCH /api/requests/:id` | `{ kind?, message? }` (hers, while `waiting`; the target never changes) | `{ request }` |
| `POST /api/requests/:id/cancel` | none (hers; `waiting` or `in_progress`) | `{ request }` with status `cancelled` |
| `POST /api/requests/:id/reopen` | `{ note? }` (hers; `done` or `declined`) | `{ request }`, `waiting` again, with a `reopens` entry keeping the earlier reply |
| `POST /api/requests/:id/claim` | `{ ttlSeconds? }` (agent) | `{ request }`, `in_progress` |
| `POST /api/requests/:id/release` | none (the agent that holds it) | `{ request }`, `waiting` |
| `POST /api/requests/:id/complete` | `{ reply, links? }` (the agent that holds it) | `{ request }`, `done` |
| `POST /api/requests/:id/decline` | `{ reason }` (any agent when `waiting`; the holder when `in_progress`) | `{ request }`, `declined` |

- **Who may do what.** Creating, editing, cancelling and reopening need her browser session:
  an agent key gets `forbidden` with the rule in the message. Claiming, releasing, completing
  and declining need an API key with write scope: her session gets `forbidden`. A read-only
  key reads (including the counts) and is refused every change with `read_only_key`. Reading
  works for both.
- **Context for an agent.** Every item of a listing carries `context`: the target's `name`,
  its library `path`, a short `preview` (the block's, document's, page's or question's first
  words), the library `nodeId`, and a `note` (a regenerated block, a trashed or deleted target).
  A listing therefore has what an agent needs to start without further calls.
- **Claims.** A claim lasts 30 minutes (`ttlSeconds` asks for 60 seconds to 24 hours). After
  that the request is `waiting` again with no claimant, so a crashed agent never blocks it.
  Another agent claiming a live claim gets `conflict` with the time it ends. The holder
  claiming again renews it. Completing after the claim ran out is `conflict` ("claim it
  again").
- **Replies.** `reply` has `text`, `links` (up to 50: `node`, `document`, `block`, `question`,
  `concept` or `source`, each with an optional `label`), `by` and `at`. A decline stores its
  reason as the reply's text. A request closed by the server (what it was about was deleted
  for good) is `declined` with `by: { type: "system" }`.
- **Edit protection.** `RequestsPort.verifyForEdit(userId, requestId, { documentId, blockId?,
  keyId })` is true only when the request is claimed and unexpired, claimed by that key, and
  asks about that document (any block) or that block. Whole-document operations (no `blockId`)
  are not covered by a block request, and requests on the library, a node, a source or a
  question never lift protection. The integrator calls it before the documents domain accepts
  a `requestId`.
- **Trash and delete.** Requests on trashed nodes, documents, blocks or files are hidden from
  lists, counts and reads until restored; the hooks `onNodeTrashed`, `onNodeRestored`,
  `onNodeDeleted`, `onFilesTrashed`, `onFilesRestored`, `onFilesDeleted`, `onQuestionsDeleted`
  and `onDocumentsDeleted` do this. Open requests on things deleted for good are closed
  (`declined`, system reply); finished ones stay as history.
- Errors: `not_found` for another user's request or target, `conflict` with a hint listing the
  moves still possible from the current status, `invalid_input` with an example.

## Concepts

The structured layer (features F1 to F5; the data for G12): typed concepts and relations with
sources. Types are `Concept`, `Relation`, `ConceptSummary`, `ConceptPage`, `GraphResult`,
`PathResult`, `FilterResult`, `ComparisonResult`, `BrandGenericPair` and `BulkUpsertResult`.
See [concepts.md](concepts.md) for the model.

| Method and path | Body or query | Returns |
|---|---|---|
| `GET /api/concepts` | `type`, `q`, `cursor`, `limit` | list of `ConceptSummary`, alphabetical (relevance with `q`) |
| `GET /api/concepts/search` | `q`, `type`, `limit` | `{ items: ConceptSummary[] }`; prefix match on names, aliases, generic and brand names |
| `GET /api/concepts/types` | | `{ concepts, relations }`: the concept types and the relation rules (the validity table) |
| `GET /api/concepts/brand-generic` | `classId?`, `limit?` | `{ items: BrandGenericPair[] }` for the drill |
| `GET /api/concepts/path` | `from`, `to`, `maxHops?` (default 6, at most 8), `relationTypes?` | `PathResult` |
| `POST /api/concepts/query` | a `ConceptFilter` (read only, so a read key may call it) | `FilterResult` |
| `POST /api/concepts/compare` | a `ComparisonInput` (read only) | `ComparisonResult` |
| `POST /api/concepts/bulk` | `{ concepts, relations, partial? }` | `BulkUpsertResult`; atomic refusal is `invalid_input` listing every problem |
| `POST /api/concepts` | `ConceptInput` | `201 { concept, suggestions }` |
| `GET /api/concepts/:id` | | `{ concept, redirectedFrom }`; a merged concept's old ID returns the survivor |
| `GET /api/concepts/:id/page` | | `ConceptPage`: relations grouped by type in both directions, mentions, questions, sources, look-alikes |
| `GET /api/concepts/:id/graph` | `hops` (1 to 4), `maxNodes` (at most 200, default 60), `relationTypes` | `GraphResult` |
| `GET /api/concepts/:id/suggestions` | | `{ items }`: look-alikes that might be the same concept |
| `PATCH /api/concepts/:id` | `UpdateConceptInput` | `{ concept }` |
| `DELETE /api/concepts/:id` | none; browser session only | `204`; its relations go with it |
| `POST /api/concepts/:id/merge` | `{ mergeId }` | `{ concept, mergedId, relationsMoved, relationsDropped }` |
| `POST /api/concepts/:id/review` | `{ status }`; browser session only | `{ concept }` |
| `POST /api/concepts/:id/name-check` | none | `{ concept }`; `conflict` while the check is off |
| `POST /api/concepts/name-checks` | `{ limit? }` | `{ checked, remaining }`: unchecked drugs checked now |
| `GET /api/relations` | `from` or `to` (a concept), `type?` | `{ items: Relation[] }` |
| `POST /api/relations` | `RelationInput` | `201 { relation }` |
| `GET`, `PATCH`, `DELETE /api/relations/:id` | `UpdateRelationInput` for PATCH; DELETE is browser session only | `{ relation }` or `204` |
| `POST /api/relations/:id/review` | `{ status }`; browser session only | `{ relation }` |

- **Citation rule.** A concept or relation an agent adds needs at least one citation or
  `"generalKnowledge": true` (never both). Her own are exempt. Citations are checked through
  the source lookup: a page that does not exist, or a quote not in its transcript, is refused
  with the path and an example. Adding to a concept that already exists needs no new citation.
- **Identity.** A concept is the pair of type and normalised name (case, accents, punctuation
  and spacing flattened). `POST /api/concepts` of an existing one is `conflict` naming it; the
  bulk call matches it and updates. Look-alikes (another salt, an alias, a one-letter slip) are
  returned as `suggestions` and never merged for you.
- **Edit protection.** An agent may rewrite a concept's or relation's text only when it is its
  own work and unreviewed. After she edits or reviews it, `PATCH` by an agent is `forbidden`
  and a bulk upsert only adds (aliases, brand names, citations) and lists what it left alone in
  `protectedFields`. Merge by an agent needs both concepts to be unreviewed agent work.
- **Bulk upsert.** Up to 200 concepts and 500 relations. Relations name their ends by ID or by
  `{ type, name }`, which may be a concept created earlier in the same call. Atomic by default
  (any problem: nothing is written, `applied: false`, items that were fine show
  `not_applied`); `partial: true` writes the valid items and reports `rejected` ones. Each
  problem has `path`, `message` and `example`. Per item: `created`, `updated`, `unchanged` or
  `rejected`; `skipped` counts unchanged plus rejected.
- **Relations** are valid only between certain concept types (`GET /api/concepts/types`);
  a refusal explains the rule, says if the ends look swapped, lists what does fit and gives an
  example. `interacts_with` and `related_to` read the same from either end and are stored once;
  `interacts_with` may carry `{ severity, effect }`.
- **Filters** (`POST /api/concepts/query`): `with_relation` (every concept with relation `R` to
  a target, through its class by default, with the supporting citations), `in_class` (drugs in
  a class and its subclasses) and `sharing_mechanism` (drugs sharing a mechanism with one drug).
  Every row says whether it matches directly or through a class and carries the citations of
  the relations it rests on.
- **Comparison** returns data, not a rendered table: columns, then one row per drug with a
  cell per attribute (`values` each with citations, and `inheritedFrom` when `includeClass`
  filled it from a class).
- **Merge.** The survivor keeps both sets of aliases (the old name becomes an alias), brand
  names, citations (up to 50) and relations; relations that would become a loop, or repeat one
  the survivor already has, are dropped after their citations are moved. The old ID keeps
  working as a redirect.
- Errors follow the conventions above. Read-only keys read everything, including the query,
  compare and path routes, and are refused every change.
