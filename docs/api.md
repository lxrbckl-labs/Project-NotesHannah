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

`TranscriptHit` (search, exported from the service for the library domain's search route) is
`{ kind: "transcript", pageId, pageIndex, fileId, fileName, nodeId, transcriptId, snippet }`.
Search covers the current revision of each page of live files.
