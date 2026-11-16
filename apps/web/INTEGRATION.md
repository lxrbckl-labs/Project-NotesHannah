# How the feature modules are mounted

The shell (`src/app`), the library, uploads, inbox, source viewer, search and activity belong to the
shell. Documents, practice (with exams), the canvas, requests and concepts are modules in their own
folders under `src/features/`. This file is what is true today; the code is in
`src/features/mounts/`.

## What is mounted, and how

| Route | Module | Mounted by | Against |
|---|---|---|---|
| `/doc/:nodeId` | `documents` (`DocumentView`) | `mounts/DocScreen.tsx` | the real server, via `HttpDocumentStore` |
| `/doc/:nodeId/canvas` | `canvas` (`CanvasView`) | `mounts/CanvasScreen.tsx` | the real canvas routes, via `HttpCanvasStore` (live over SSE) |
| `/practice`, `/practice/session/:id` | `practice` (`PracticeApp`) | `mounts/PracticeScreen.tsx` | the real server, via `mounts/practiceStore.ts` |
| `/exams` | `exams` (`ExamPlanner`, inside `PracticeApp`) | `mounts/PracticeScreen.tsx` | the same store |
| `/requests` | `requests` (`RequestsView`) | `mounts/Mount.tsx` | the real `/requests` routes |
| `/concepts`, `/concepts/:id` | `concepts` (`ConceptsIndex`, `ConceptView`) | `mounts/Mount.tsx` | the real concept routes |
| `/question/:id` | (shell) | `mounts/QuestionRedirect.tsx` | opens the lecture a practice question belongs to |

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
| `POST .../skip` | `POST /practice/sessions/:id/skip { position }` (added in the final pass) | the skip lives on the server, so a session resumes the same on another device; skipped questions come back after the ones not yet seen |
| `POST .../reveal` returning intervals | `{ reveal }` with `back`, `modelAnswer`, `rubric` | mapped; intervals use the default 0/1/3/7 days |
| "cards due" scope flag | scope `{ kind: "due" }` | `dueOnly` becomes the due scope |
| `GET /practice/cards/due` | `GET /practice/due` with `counts.byDay` | mapped |
| notebook rows with a "reason" | `reason` on each notebook item (the grader's first plain line from the last wrong attempt) | shown as is |
| exams with a free-text course | exams belong to a course node (`courseId`) | found from the covered lectures' ancestors |
| session results with questions | results carry text and her answer only | the questions she saw are cached in the browser; after a reload the review shows the prompt text |
| `retry one question` (`questionIds`) | not supported | ignored: the session starts on the scope |

`PracticeApp` got two small props: `initialSessionId` (resume from a URL) and `autoStart` (a scope to
start at once: "Practise this"). The shell guards navigation while a session is on screen
(`onActiveChange` plus `useBlocker`).

The exam planner's node picker (`pickNodes`) is the shell's own sheet (`library/pickNodes.tsx`).

## Canvas

`CanvasScreen` asks `GET /api/documents/:id/canvas`. When it answers (every current server) the
`HttpCanvasStore` is used: structure, her pins (`PUT .../placements`, debounced), the layout cache and
live updates over `GET .../events`, so a canvas an agent changes through the API or `study_map`
updates in the open view. Only an older server without the route falls back to a canvas derived from
the document's blocks, with pins kept in this browser (`notes-canvas`).

Cards draw their blocks with the documents module's own read-only renderers
(`mounts/CanvasBlocks.tsx`), passed as `renderBlock` and loaded with `React.lazy`, so the canvas
chunk does not carry the editor until a card is drawn. The canvas opens on its first frame when the
whole map would be smaller than a readable zoom (a portrait tablet); "Whole map" (Shift+1) shows it
all. React Flow's attribution stays visible: its MIT licence does not mention it, but its own
documentation says to remove it only with a Pro subscription.

## Requests, concepts and "ask"

One app-wide composer (`mounts/ask.tsx`, `AskProvider` inside the shell) serves every entry point:
a library item's menu and the detail panel, the document header, each block's "Ask about this",
a source page, a practice question's feedback and the concept page. The documents module's own
request call is replaced through `DocumentView`'s `onAskAboutBlock`; its quick actions are kept.

Links in replies and concepts carry document and question ids, not library nodes:
`mounts/navigation.ts` resolves them through `GET /documents/:id` and `GET /practice/questions/:id`
(then `nodeHref`), with a fallback to the library. The module's "New answer" tag treats answers that
exist on a device's first look as seen (`setFirstLoadCountsAsSeen`). A reply that states figures its
sources do not contain shows "Contains figures not found in your notes".

Not done: a course filter on concepts (citations name pages, not nodes: it needs a file to node to
course join on every concept route and a new summary field) and an unverified-content count for the
nav (no aggregate route exists).

## What a module must export

Modules are mounted by folder name, so nothing in the shell changes when one is added. From `src/features/<folder>/index.ts(x)`:

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
