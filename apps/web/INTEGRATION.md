# How the feature modules are mounted

The shell (`src/app`), the library, uploads, inbox, source viewer, search and activity belong to the
shell. Documents, practice (with exams), the canvas, requests and concepts are modules in their own
folders under `src/features/`. This file is what is true today; the code is in
`src/features/mounts/`.

## What is mounted, and how

| Route | Module | Mounted by | Against |
|---|---|---|---|
| `/doc/:nodeId` | `documents` (`DocumentView`) | `mounts/DocScreen.tsx` | the real server, via `HttpDocumentStore` |
| `/doc/:nodeId/canvas` | `canvas` (`CanvasView`) | `mounts/CanvasScreen.tsx` | the real document, interim store (below) |
| `/practice`, `/practice/session/:id` | `practice` (`PracticeApp`) | `mounts/PracticeScreen.tsx` | the real server, via `mounts/practiceStore.ts` |
| `/exams` | `exams` (`ExamPlanner`, inside `PracticeApp`) | `mounts/PracticeScreen.tsx` | the same store |
| `/requests`, `/concepts/:id` | `requests`, `concepts` | `mounts/Mount.tsx` | "Coming soon" until the modules land |

Lectures and documents open as `/doc/:nodeId` from the tree, lists, breadcrumbs, search and
activity (`nodeHref` in `features/library/rules.ts`); the library page of a lecture
(`/library/:id`) keeps its source files and an "Open the page" button. The in-memory mock has no
documents, so in mock mode (`VITE_MOCK_API=1`) lectures keep their placeholder page.

All three heavy modules are loaded on demand (route-level `lazy`): Tiptap with documents, React Flow
and ELK with the canvas, and practice. The first load does not include them.

## Documents

- **First open creates the document.** The server holds one document per node and refuses a second
  (`create_document` with an existing `nodeId` is `conflict`), so `DocScreen` asks
  `GET /api/nodes/:id/document` and, on `not_found`, creates it with the node's name as its title
  (`lecture_note` for a lecture, `study_guide` for a document, `practice_set` in a Practice section).
- A document with no blocks shows an empty state that says an agent can write it, with a button that
  leaves a request ("Write a study guide for this lecture", `POST /api/requests`) and a way to start
  writing herself.
- `HttpDocumentStore` ran unchanged against the real server except `createRequest`, which sent
  `target.kind` and `note`; the server wants `target.type` and `message` (fixed in the store).
- `?block=<id>` scrolls to a block and flashes it (`DocumentView` got a `focusBlockId` prop): this is
  where block search hits and activity links land.
- **Citations** open the documents module's own citation panel (fed by the real page images and
  transcripts through `HttpDocumentStore.resolveCitation`). The shell's `SourceViewer` stays for
  everything else: source files in the tree and inbox, search hits on pages, and citation chips in
  practice feedback and results (`/files/:id?page=<pageId>&quote=<text>`).

## Practice and exams: where the module and the server differ

`practiceStore.ts` is the only place that knows. The module was written against assumed routes:

| Module assumed | Real server | Adapter |
|---|---|---|
| `GET /practice/overview` | none | start-screen scopes assembled from the question list, exams, notebook, due deck and active sessions |
| question with `lefts`/`rights`, `blanks`, `unitChoices`, `rubricSize` | `left`/`right`, `blankCount`, `needsUnit` | mapped; `unitChoices` is a fixed list (any valid unit spelling grades) |
| `POST .../answers {index}` | `POST .../answer {position}` | mapped; the key (`reveal`, citations) becomes the outcome's explanation |
| `POST .../skip` | none | skipping is kept in the browser per session; the server's "first unanswered" is overridden |
| `POST .../reveal` returning intervals | `{ reveal }` with `back`, `modelAnswer`, `rubric` | mapped; intervals use the default 0/1/3/7 days |
| "cards due" scope flag | scope `{ kind: "due" }` | `dueOnly` becomes the due scope |
| `GET /practice/cards/due` | `GET /practice/due` with `counts.byDay` | mapped |
| notebook rows with a "reason" | none | the reason is not shown |
| exams with a free-text course | exams belong to a course node (`courseId`) | found from the covered lectures' ancestors |
| session results with questions | results carry text and her answer only | the questions she saw are cached in the browser; after a reload the review shows the prompt text |
| `retry one question` (`questionIds`) | not supported | ignored: the session starts on the scope |

`PracticeApp` got two small props: `initialSessionId` (resume from a URL) and `autoStart` (a scope to
start at once: "Practise this"). The shell guards navigation while a session is on screen
(`onActiveChange` plus `useBlocker`).

The exam planner's node picker (`pickNodes`) is the shell's own sheet (`library/pickNodes.tsx`).

## Canvas

The canvas server does not exist yet. `CanvasScreen` asks `GET /api/documents/:id/canvas`: when it
answers, `HttpCanvasStore` takes over with no other change; until then it builds a canvas from the
real document's blocks (`deriveCanvas`, through `MemoryCanvasStore`) and keeps pins in this browser
(`localStorage`, prefix `notes-canvas`). Cards use the canvas module's own compact block renderer: the
documents module's block renderers need the page editor's context and were not wired through
`renderBlock`.

## What a module that lands later must export

Requests and concepts (not yet merged) are mounted by folder name, so nothing in the shell changes
when they appear. From `src/features/<folder>/index.ts(x)`:

- requests: `RequestsView` and `createHttpRequestsStore(http)`;
- concepts: `ConceptView` and `createHttpConceptsStore(http)`.

`http` is `AppHttp` from `src/lib/api.ts` (same `/api` base, cookie and typed errors, no parsing). The
root component receives `{ store, params, search, openSource, openNode, SourceViewer }`
(`mounts/modules.ts`, `MountContext`). If the real module uses other names, change the table in
`mounts/modules.ts` (`CONTRACT`) or write a thin adapter next to it, as for practice.

## Links the shell produces

- Search: `node` and `page` as before; `block` opens `/doc/:nodeId?block=:blockId`; `question` opens
  the node it is filed under; `concept` opens `/concepts/:id`.
- Activity: document and block links open `/doc/:nodeId[?block=]`.
- "Practise this" (lecture page, library page): `/practice?node=:id`; an exam: `/practice?exam=:id`.
