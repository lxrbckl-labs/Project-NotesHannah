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
| `GET /api/search` | `q`, `cursor`, `limit` | `{ items: SearchHit[], nextCursor }` |

Rules the server enforces (and reports with `invalid_input` or `conflict`, a hint and a
valid example):

- A node may only be placed where `canContain(parentKind, childKind)` allows.
- Sections cannot be created, renamed, moved, duplicated or trashed on their own.
- Folders nest at most `MAX_FOLDER_DEPTH` deep below a section.
- A node cannot be moved into itself or its own descendants.
- Trashing a node trashes everything under it; restoring brings it all back. Restoring
  into a trashed parent is refused.

`SearchHit` is `{ kind: "node", node: NodeWithLinks, snippet: string }` for now; more
kinds are added as transcripts and documents arrive.

## Files, pages and inbox (built after the conversion spike)

| Method and path | Body or query | Returns |
|---|---|---|
| `POST /api/uploads` | multipart form, field `file`, optional `nodeId` | `{ file: SourceFile }` |
| `PUT /api/uploads/:ticket` | raw bytes | `{ file: SourceFile }` (agent upload link; no other credential needed) |
| `GET /api/files` | `status`, `nodeId`, `inbox=true`, `cursor`, `limit` | list of `SourceFile` |
| `GET /api/files/:id` | | `{ file: SourceFile }` |
| `POST /api/files/:id/retry` | none | `{ file }` |
| `POST /api/files/:id/file` | `{ nodeId }` | `{ file }` (file it under a lecture or folder) |
| `GET /api/files/:id/original` | | the original bytes |
| `GET /api/files/:id/pages` | | `{ items: Page[] }` |
| `GET /api/pages/:id/image` | `size=page` or `thumb` | the page image |
| `GET /api/pages/:id/transcript` | | `{ transcript: Transcript | null }` |

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

## Activity and changes

| Method and path | Query | Returns |
|---|---|---|
| `GET /api/changes` | `cursor` (omit to start from the beginning), `limit` (default 100, at most 500) | `{ items: ChangeEntry[], nextCursor, hasMore }`, oldest first |
| `GET /api/activity` | `keyId`, `action`, `objectId`, `since`, `until` (ISO times), `cursor`, `limit` (default 50) | `{ items: ActivityEntry[], nextCursor }`, newest first |

**Change feed (H9).** An entry is `{ seq, at, action, objectType, objectIds, documentId,
nodeId, revision, actor, requestId, summary }`. Actions: `document.created`,
`document.updated`, `document.reviewed`, `document.restored` (a revision was restored),
`document.trashed`, `document.restored_from_trash`, `document.deleted`. The cursor is the last
`seq` seen; `nextCursor` never moves backwards and is returned even when `items` is empty, so
a poller simply stores it and sends it next time. `seq` strictly increases in commit order
(one sequence shared by all users, so one user's numbers have gaps). Entries are written in
the same transaction as the change, so a failed write leaves none. A batch writes one entry
per document touched.

**Activity log (H10).** One entry per thing an agent did, never for her own work:
`{ id, at, keyId, keyLabel, action, summary, links }`. `action` is the operation
(`insert_blocks`, `replace_generated`, ...) or `batch`; `summary` is plain words such as
`Beta blockers: Regenerated: wrote 3 blocks, removed 5, left 2 of hers alone`; `links` point at
the document (with its library `nodeId`), up to 15 of the blocks, and the request when one
was named. `objectId` filters on any of those IDs.
