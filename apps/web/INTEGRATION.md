# Mounting a feature module

The app shell (`src/app`), the library, the inbox, the source viewer, settings and the activity
screen are owned by the web shell. Documents, practice, exams, canvas, requests and concepts are
separate modules in their own folders. The shell mounts each at a fixed route and **finds the
module by folder name**: nothing in the shell has to be edited when a module appears. Until a
module exists (or while it lacks the exports below) its route shows a "Coming soon" page.

## Routes

| Route | Feature key | Folder | Root export |
|---|---|---|---|
| `/doc/:nodeId` | `documents` | `src/features/documents` | `DocumentView` |
| `/doc/:nodeId/canvas` | `canvas` | `src/features/canvas` | `CanvasView` |
| `/practice` | `practice` | `src/features/practice` | `PracticeHome` |
| `/practice/session/:id` | `practiceSession` | `src/features/practice` | `PracticeSessionView` |
| `/exams` | `exams` | `src/features/exams` | `ExamsView` |
| `/requests` | `requests` | `src/features/requests` | `RequestsView` |
| `/concepts/:id` | `concepts` | `src/features/concepts` | `ConceptView` |

The table lives in code in `src/features/mounts/modules.ts` (`CONTRACT`); change it there if a
name differs, in one place.

## What each module must export

From `src/features/<folder>/index.ts` (or `index.tsx`):

1. **The root component** named in the table. It receives `store` plus the mount context.
2. **A store factory**: `createHttpDocumentStore`, `createHttpCanvasStore`,
   `createHttpPracticeStore` (used by practice, practice session and exams),
   `createHttpRequestsStore`, `createHttpConceptsStore`. Each is `(http: AppHttp) => Store`.
   `AppHttp` (from `src/lib/api.ts`) is the app's own HTTP client: same `/api` base path, same
   session cookie, errors raised as `ApiClientError` with the server's `code`, `message` and `hint`.
   It does not parse responses: validate with your own schemas.

```ts
// from "src/lib/api"
interface AppHttp {
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}
// paths are below /api, e.g. http.get("/documents/doc_...")
```

The root component's props are `{ store } & MountContext`:

```ts
interface MountContext {
  params: Record<string, string | undefined>; // :nodeId, :id
  search: URLSearchParams;                    // e.g. ?block=blk_...
  openSource(target: { fileId: string; pageId?: string; quote?: string }): void;
  openNode(nodeId: string): void;
  SourceViewer: ComponentType<SourceViewerProps>; // the embeddable viewer
}
```

Keep the store a plain object (so it can be faked in your tests) and keep the root component free
of router and query-client assumptions beyond React: the shell supplies a React Query client, a
router and a toast provider, but a module that wants none of them can ignore them.

## Opening a source from a citation

Call `openSource({ fileId, pageId, quote })` from a citation chip: it navigates to
`/files/:fileId?page=<pageId>&quote=<text>`, which opens the viewer on that page with the quote
highlighted in the transcript. To show the viewer inline instead (a popover or a side panel), render
`context.SourceViewer`:

```tsx
<SourceViewer
  fileId={citation.fileId}
  pageId={citation.pageId}
  highlightQuote={citation.quote}
  region={citation.region}   // optional NormalizedBox {x, y, width, height}, 0..1
/>
```

The viewer needs a router and a React Query provider above it, which the shell supplies.

## Links the shell produces for you

- Search: a block hit opens `/doc/:nodeId?block=:blockId`. The documents module should scroll to
  and highlight that block.
- Activity: document and block links open `/doc/:nodeId` and `/doc/:nodeId?block=:blockId`.
- Library: a `document` node opens `/library/:nodeId` today (a placeholder page). When the documents
  module is live, the shell will open `/doc/:nodeId` for documents and lectures; tell the shell owner.

## Checking the mount

`pnpm --filter @notes/web test` includes a test that every route renders "Coming soon" while the
folders are empty. Drop a module in and the test for that route is replaced by your own.
