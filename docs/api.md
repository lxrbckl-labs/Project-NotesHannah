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
