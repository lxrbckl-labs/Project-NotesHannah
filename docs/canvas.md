# Canvas

The canvas is the second view of a document (features E1–E6): the same blocks she reads
in the page view, as cards on a dotted grid, joined by curved labelled connectors and
grouped in frames, in the style of AFFiNE's edgeless mode. Agents describe its
**structure**; the app lays it out; anything she drags stays where she put it.

Code:

- `packages/schema/src/canvas.ts` — the model, agent inputs, validation, the pin rule,
  derive and merge.
- `packages/schema/src/canvas-layout.ts` — size estimation and the layout constraint pass
  (pure, no DOM, no ELK).
- `apps/web/src/features/canvas/` — the view (React Flow), the ELK layout and its worker,
  stores, the demo (`apps/web/canvas-demo.html`).

Related: [blocks.md](blocks.md) (blocks, edit protection), [architecture.md](architecture.md)
(front end, MCP layer), [risks.md](risks.md) (layout needs sizes; iOS gestures).

## The model

```
Canvas { documentId, revision, cards[], connectors[], frames[], syncedBlockIds[],
         allowSelfLinks, updatedAt }                       one per document
  Card { id, content, size, color?, title?, origin, position | null, dimensions | null }
    content: { kind: "block",   blockIds: [blk_…] }        1–12 blocks of this document
           | { kind: "concept", conceptId, label? }
           | { kind: "note",    text }                     rich text or a string
           | { kind: "sticker", sticker }                  pin star eyes lightbulb warning
                                                           heart question check arrow
    size: auto | small | medium | large | wide             a width class; height follows content
  Connector { id, from, to, label?, kind, line?, direction, origin }
    kind: leads_to | causes | treats | contrasts | part_of | related
    line: solid | dashed | dotted (default by kind)   direction: forward | backward | both | none
  Frame { id, title, members[] (reading order), parent?, color?, order, headingBlockId?, origin }
```

- **One canvas per document**, keyed by the document ID. Every document has one for free:
  `deriveCanvas` turns headings into frames (nested by level, at most three deep) and every
  other block into a card, in reading order. Dividers make no card; a heading with nothing
  under it makes no frame.
- **Cards reference blocks, never copy them.** Editing a block in the page view changes
  its card. A card can show several blocks (a summary card); a block can appear on more
  than one card.
- **Layout state is per card and optional.** `position` and `dimensions` are `null` (the
  app lays the card out) or **pinned by her** with `placedBy` (an `Actor`) and `placedAt`.
  Nothing else stores coordinates. Agents never send any.
- **A card is in at most one frame**; frames nest through `parent`. `order` is the
  step-through order (E5), kept as 0…n-1.
- **`origin`** says who made an item: `document` (derived), `agent`, or `user` (she made
  it or edited it since; sticky, as for blocks).
- **`syncedBlockIds`** is the document's block list at the last merge, so a merge knows
  which blocks are new and which were deleted.
- Colours are the shared tokens (`gray … pink`), so light and dark both work.
- Limits (`CANVAS_LIMITS`): 500 cards, 1000 connectors, 80 frames, 200 members per frame,
  12 blocks per card, titles 120 characters, notes 2,000, labels 80, 200 ops per call.

Why: agents are good at saying what relates to what and bad at pixel geometry; coordinates
from an agent would fight her arrangement and every screen size. Keeping layout out of the
agent format makes the format small, stable across devices and safe to regenerate. Cards
pointing at blocks keep one source of truth for the content (the document), so the canvas
can never disagree with the page.

## The pin rule

Mirrored from blocks (D11). An agent's structure change

- never moves or resizes a card she pinned (`place_cards`, `release_pins` and
  `insert_items` are hers alone; a `size` change on a pinned card is refused);
- never changes or deletes a card, connector or frame she created or edited, and never
  deletes a card she pinned,

unless the agent acts on her request and passes its `requestId`. `cardProtection(card)`
and `itemProtection(item)` decide; refusals explain the rule and how to get past it.
`set_structure` does not fail on protected items: it keeps them and reports each in
`report.skipped` with the reason (`user_edited` or `pinned`).

## Agent-facing structure format

Two ways to write, both validated with teaching errors (`$`-paths, a plain message and a
minimal valid example, as for blocks):

**1. Set the whole structure** (`SetCanvasStructureInput`, `applySetStructure`). Lists
the intended structure; new cards get a short `ref` that connectors and frames use.

```json
{
  "documentId": "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  "cards": [
    { "ref": "mechanism", "content": { "kind": "block", "blockIds": ["blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"] } },
    { "ref": "effects", "content": { "kind": "block", "blockIds": ["blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N9"] }, "size": "wide" },
    { "ref": "tip", "content": { "kind": "note", "text": "Think: -olol = beta blocker" }, "color": "yellow" }
  ],
  "connectors": [{ "from": "mechanism", "to": "effects", "label": "lowers heart rate", "kind": "causes" }],
  "frames": [{ "ref": "mech", "title": "Mechanism", "members": ["mechanism", "effects", "tip"] }],
  "expectedRevision": 4
}
```

- What is left out is removed, except what she made, edited or pinned.
- A listed card showing the same blocks (or concept, or note text) as an existing card
  **is** that card: its ID, pin and connectors survive. Give `"id": "crd_…"` to name an
  existing card explicitly. Frames match by `id` or title; connectors by `id` or
  `(from, to, kind)`. Sending the same body twice changes nothing (no new revision).
- The report gives `added`, `updated`, `removed`, `skipped` and `refs` (ref → new ID).

**2. Incremental ops** (`CanvasChangeInput`, `applyCanvasChange`): applied in order, all
or nothing; refs from earlier ops in the same call work in later ones.

| Op | Body |
|---|---|
| `add_card` | `card { ref?, content, size?, color?, title? }` |
| `update_card` | `id`, `patch { content?, size?, color? \| null, title? \| null }` |
| `remove_card` | `id` (its connectors and memberships go too) |
| `add_connector` | `connector { from, to, label?, kind?, line?, direction? }` |
| `update_connector` | `id`, `patch { label? \| null, kind?, line? \| null, direction?, from?, to? }` |
| `remove_connector` | `id` |
| `add_frame` | `frame { ref?, title, members?, parent?, color?, order? }` |
| `update_frame` | `id`, `patch { title?, color? \| null, order?, parent? \| null }` |
| `remove_frame` | `id` (its cards are ungrouped into its parent; child frames move up) |
| `add_to_frame` | `frame`, `cards` (a card leaves its previous frame) |
| `remove_from_frame` | `cards` |
| `place_cards` | hers: `placements [{ id, x, y, width?, height? }]` — pins |
| `release_pins` | hers: `ids?` (all when left out), `sizes?` |
| `insert_items` | hers: fully formed `cards`, `connectors`, `frames` with their IDs (how the app creates items optimistically and undoes deletes) |

```json
{ "documentId": "doc_…", "ops": [
  { "op": "add_card", "card": { "ref": "tip", "content": { "kind": "note", "text": "β1 = 1 heart" } } },
  { "op": "add_connector", "connector": { "from": "tip", "to": "crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", "kind": "related" } }
] }
```

Every op has a minimal example in `CANVAS_OP_EXAMPLES`. Examples of teaching errors:

```json
{ "path": "$.connectors[0].to",
  "message": "\"c\" is not a card in this structure. Each end of a connector names a card listed in \"cards\", by its \"ref\" or its \"id\". Refs in this request: a, b.",
  "example": { "from": "mechanism", "to": "effects", "label": "lowers heart rate", "kind": "causes" } }

{ "path": "$.cards[0].x",
  "message": "\"x\" is not accepted: agents describe structure and the app lays the canvas out. Use \"size\" (auto, small, medium, large, wide) to suggest a width class." }

{ "path": "$.frames[1].members[0]",
  "message": "Card \"a\" is already in frame $.frames[0]. A card belongs to one frame at most; nest frames with \"parent\" instead." }
```

Also checked: connector ends exist; self-links refused unless `allowSelfLinks`; frame
members exist and are in one frame; frame parents exist, no loops, three levels at most;
block cards name blocks of this document (when the caller passes `documentBlockIds`);
counts and text sizes; `expectedRevision` (a mismatch is a `conflict`).

## When the document changes

`mergeDocumentBlocks(canvas, blocks)` runs whenever the document's block list changes
(the server should call it inside the document write, see below):

- new blocks (not in `syncedBlockIds`) become unpinned `document` cards, placed in the
  frame of their reading-order neighbour, right after it; a new heading becomes a frame;
- cards whose blocks were all deleted disappear (with their connectors); a multi-block
  card just loses the deleted block; a derived frame whose heading was deleted goes, and
  its cards move to the parent frame;
- everything else, pins included, is untouched. No change → same object, same revision.

## Layout

The layout runs in two halves:

1. **Sizes** (`canvas-layout.ts`). Width from the size class (220, 280, 360, 520; stickers
   88×88); height estimated per content type (text lines at the renderer's metrics, table
   rows, drug-card sections, list items), clamped per class (cards taller than that clip
   with a fade and open to read). A pinned size wins. The metrics (`CARD_TEXT`) are the
   app's: cards draw blocks with the documents' renderers, whose study-guide text is 17 px
   on 29 px lines, and estimates err on the tall side; `canvas-layout.test.ts` checks them
   against heights measured in the app. After the first render each card reports the
   height its content needs and the layout runs again with **measured** sizes.
2. **Graph layout** (`features/canvas/layout/elk-layout.ts`, elkjs 0.12): ELK `layered`
   over the **free** cards only (not pinned, not anchored), frames as compound nodes,
   left to right on tablets and computers, top to bottom on phones. Each frame is laid out
   on its own (`SEPARATE_CHILDREN`): measured on our fixtures, `INCLUDE_CHILDREN` stacked
   every unconnected card of a frame in one tall column, ignored reading order and was
   about four times slower. A connector that crosses frames becomes a proxy edge between
   the two frames (or top-level items) at their common level, so linked frames sit
   together in flow order. Model order is respected, so reading order survives.
3. **Constraint pass** (`resolveLayout`, pure): pinned cards stay exactly where she put
   them; inside a frame that has pinned or anchored members, the free members are placed
   below them; top-level groups that collide are pushed down (groups holding a pinned card
   never move); a safety pass guarantees no unpinned card overlaps any card; frames are
   sized to their members (padding 24, title band 56). Deterministic for the same input.
4. **Incremental stability.** Unpinned cards keep their last positions (`anchor`) on
   every re-layout except "auto-arrange"; only new cards go through ELK. The last
   positions are cached per document and layout variant (`wide` or `tall`), so a reopened
   canvas looks the same.

The layout runs in a dedicated worker (`layout.worker.ts`); above 40 free cards an
"Arranging…" chip shows while it runs. `layoutProblems(input, result)` states the
invariants and the tests check them.

**No card is ever drawn over another** (`useCanvasModel`, `CardNode`, `buildNodes`). The
layout keeps boxes apart, so the view makes sure what is drawn is the box:

- A card is drawn in the box the layout gave it (`style.height`), never taller. Content
  that needs more room is clipped with the fade until the layout has made the room.
- Each card measures what its content needs itself (a `ResizeObserver` on its content:
  border, title band, body up to its maximum) and reports it (`measureCard`). React
  Flow's own measuring only sees the box. A card still showing a renderer's loading
  placeholder reports nothing: on 2026-11-16 a layout made from those placeholders
  (66 px a card) put her new paragraph 98 units below the top of the card above it, and
  that card's real 228 px reached 130 units under it until the next pass.
- On opening, the map stays out of sight ("Opening the canvas…") until a layout made
  with every card's measured size has landed (`settled`; at most 2 s), then it is fitted
  and shown. Nothing jumps after it appears.
- Afterwards, when a card needs another size (a document change, a late font, an edit),
  only the constraint pass runs (every card already has a place): pinned cards stay,
  unpinned cards it would cover move down, nothing moves sideways or up.
- A card open to read or to edit grows over its neighbours, on top, and is not measured
  meanwhile, so reading a card never rearranges the map.

**Measured** (fixtures of 10, 100 and 300 cards with nested frames, connectors inside and
across frames, some pinned; `layout/elk-layout.test.ts`):

| | 10 cards | 100 cards | 300 cards |
|---|---|---|---|
| Full layout in Node (ELK + constraints) | 59–99 ms (first call warms ELK up) | 61–136 ms | 99–129 ms |
| Full layout in the browser worker (demo, `data-layout-ms`) | — | 39–62 ms | 91–125 ms |
| Constraint pass alone | 0.6 ms | 1.6–3.7 ms | 4.1–5.3 ms |
| Adding one card, ELK from scratch: cards that moved | 0/9 | 15/96 (mean 13 px) | 20/289 (mean 2 px) |
| Adding one card, anchored: cards that moved | 0/9 | 0/96 | 0/289 |

All invariants hold at every size: no overlap among unpinned cards, pinned cards unmoved,
frames contain their members (and child frames), same input → same output. ELK alone is
already fairly stable when one card is added (its model-order option helps), but it does
shift a few cards; anchoring removes that entirely. When a frame grows into the frame
below it, the lower frame moves down as a whole; nothing reshuffles.

## The view

`CanvasView` (`features/canvas/CanvasView.tsx`) on React Flow 12.12:

- custom card nodes (block, concept, note, sticker), node and edge types defined outside
  components, nodes memoised and rebuilt only when their card changes;
- block content through `renderBlock(block)`; until the documents feature supplies its
  renderers, `FallbackBlock` renders headings, paragraphs, lists, checklists, quotes,
  callouts, tables, comparison tables, a drug-card summary, mnemonics, image and mind-map
  placeholders;
- floating connectors: each end attaches to the side facing the other card, a bezier
  curve, an arrowhead per `direction`, colour and dash per kind, labels as pills above
  the cards; edges run under the cards;
- frames as titled tinted regions; only the title bar takes pointer events (drag it to
  move the frame and pin everything inside), the rest pans and marquee-selects;
- 9 original SVG stickers; card tints and connector colours tuned separately for dark.

**Gestures and what they emit** (`model/gestures.ts`, tested op by op):

| Gesture | Computer | Touch (iPad, iPhone) | Ops |
|---|---|---|---|
| Pan | scroll, space-drag, middle/right drag, Hand tool | one finger on empty canvas, with momentum | — |
| Zoom | ⌘/ctrl + scroll or trackpad pinch, toolbar, `+` `-` | pinch, double tap | — |
| Select | click, shift/⌘ click, marquee drag | tap; long-press then tap to multi-select | — |
| Move a card | drag | drag | `place_cards` (+ `add_to_frame` / `remove_from_frame` when dropped in or out of a frame) |
| Move a frame | drag its title | drag its title | `place_cards` for every card inside |
| Connect | drag from a card's handle to a card | Connect mode: tap source, tap target | `insert_items` (connector), then the label editor |
| Edit a connector | click its label | tap its label | `update_connector`, `remove_connector` |
| Note, sticker | toolbar or `N` | toolbar | `insert_items` (+ `add_to_frame`), note text `update_card` |
| Frame | select cards, `F` or toolbar | long-press select, Frame | `insert_items` (frame) |
| Rename, colour, reorder, delete frame | double-click title, frame toolbar, frame list | frame list | `update_frame`, `remove_frame` |
| Align | selection toolbar | — | `place_cards` |
| Delete | Delete/Backspace, toolbar | toolbar | `remove_*`; Undo in the toast or ⌘Z |
| Undo / redo | ⌘Z, ⇧⌘Z, toolbar | toolbar | the diff back (`diffOps`) |
| Auto-arrange | toolbar | toolbar | none (layout only; pins stay) |
| Release pins | selection or all, after a confirmation | same | `release_pins`, then auto-arrange |
| Open | double-click | double tap | calls `onOpenBlock(blockId)` |
| Read inside a card | Read / Enter | Read | none: text becomes selectable and scrollable only in this state |
| Step-through | ▶, ←/→, Esc | ▶, buttons | none |

Shortcuts: V select, H hand, N note, C connect, F frame, ⇧1 fit, ⇧2 zoom to selection.

A card is moved into the frame under its centre when dropped. Dropped outside every frame,
it leaves its frame and stays pinned where it was dropped: like every drag, it stays where
she put it (by design, not a gap; releasing the pin hands it back to the layout).

**Touch on iPad and iPhone Safari**: one-finger pan on empty canvas; pinch zooms the
canvas, never the page (Safari's `gesturestart`/`gesturechange` are cancelled, the demo
page also sets `user-scalable=no`); touches starting within 24 px of the left or right
edge have their default prevented so the back/forward swipe never fires from the canvas;
overscroll is off while mounted; momentum after a flick (off with reduced motion); card
text is not selectable and links not tappable unless the card is in its Read state;
44 px targets; safe-area insets on all chrome; handles are hidden on touch (connect mode
replaces them). **Phone** opens on a focused view: one frame at a time with previous and
next in the top bar and a "Whole map" button; the map is laid out top to bottom there.

**Performance** (`e2e/canvas-perf.spec.ts`, headless Chromium on an M1 Pro; frame deltas
from `requestAnimationFrame` during 60 scroll-pans and 30 zoom steps):

| Run | Mean | p95 | Max | Frames over 20 ms |
|---|---|---|---|---|
| 100 cards | 16.7 ms | 16.8 ms | 16.8 ms | 0 of 302 |
| 300 cards | 16.9 ms | 16.7 ms | 33.4 ms | 4 of 274 |
| 300 cards, CPU slowed 4× (whole map) | 19.6 ms | 33.4 ms | 50.1 ms | 67 of 414 |
| 300 cards, CPU slowed 4×, zoomed in | 16.7 ms | 16.8 ms | 16.8 ms | 0 of 295 |
| 300 cards, only-render-visible on | 17.2 ms | 16.8 ms | 66.6 ms | 7 of 354 |
| 300 cards, only-render-visible on, CPU ÷4 | 41.8 ms | 166.6 ms | 250 ms | 88 of 283 |

Only-render-visible (React Flow's culling) made things **worse** in every run, because
mounting and unmounting cards while panning costs more than keeping 300 memoised cards
in the DOM; it is off by default (`onlyRenderVisible` prop to measure again). Not yet
measured on a real iPad.

## Data boundary

```ts
interface CanvasStore {
  readonly actor: Actor;                                   // her, signed in
  load(documentId): Promise<LoadedCanvas>;                 // { canvas, blocks, documentTitle }
  apply(documentId, ops: CanvasOp[], { expectedRevision? }): Promise<ApplyOutcome>;
  savePlacements(documentId, placements: Placement[]): void;   // debounced, coalesced per card
  flush(): Promise<void>;
  subscribe(documentId, listener: (next: LoadedCanvas) => void): () => void;  // block changes, agent changes
  loadLayoutCache(documentId, variant: "wide" | "tall"): Promise<Record<string, Point> | null>;
  saveLayoutCache(documentId, variant, positions): void;
}
```

`MemoryCanvasStore` (demo, tests; optional localStorage persistence) and `HttpCanvasStore`
(the routes below). The view applies every change locally first through the same
`applyCanvasChange` the server runs, then sends the ops; the server's canvas wins once
nothing else is in flight. IDs of items she creates are made on her device
(`insert_items`), so the optimistic state and the server agree.

**Mounting** (the shell):

```tsx
import { CanvasView, HttpCanvasStore } from "@/features/canvas";
const store = useMemo(() => new HttpCanvasStore({ actor: { type: "user", userId } }), [userId]);
<div className="h-dvh">
  <CanvasView store={store} documentId={documentId}
    renderBlock={(block) => <BlockRenderer block={block} compact />}
    onOpenBlock={(blockId) => navigate(`/d/${documentId}#${blockId}`)}
    onOpenConcept={(id) => navigate(`/concepts/${id}`)}
    onSwitchToPage={() => navigate(`/d/${documentId}`)}
    topBarExtras={<ThemeSwitch />} />
</div>
```

The view fills its parent; give it the full height under the shell (on a phone, hide the
tab bar while the canvas is open, or leave 64 px below for it).

## For the server: storage, API and MCP

**Built** (`apps/server/src/domains/canvas`, migration `0550_canvas.sql`, tests `apps/server/test/canvas*.test.ts`,
routes in [api.md](api.md#canvas)). What differs from the proposal, and why:

- **Storage** is as proposed: `canvases(document_id PK → documents ON DELETE CASCADE, user_id, revision,
  data JSON, created_at, updated_at)`, validated with `Canvas` on every write, plus
  `canvas_layout_cache(document_id, variant, positions, updated_at)`. Trashing the document hides the
  canvas through the join with `documents.trashed_at` (no second flag to keep in step); deleting
  it removes the rows by cascade. No per-revision snapshot history (not needed yet).
- **Layout runs only in the browser** (ELK in the worker). The server stores no coordinates for
  unpinned cards: `position`/`dimensions` are set only by her `place_cards`, and the layout cache
  drops pinned and unknown cards on save and read. "Auto-arrange" is `POST .../canvas/arrange`:
  it clears the cache (and with `releasePins` her pins) and wakes every open view.
- **Hooks.** Documents take one new port, `onBlocksChanged`, called inside `commit` (after the blocks
  are saved, same transaction); the composition root wires it to the canvas, documents never import
  the canvas. A document without a canvas is ignored until first read. `open()` also merges on
  every read as a safety net, silently. Duplicate: `onNodeDuplicated` in the library listener.
- **Pin rule.** `requestId` lifts protection only when `requestsPort.verifyForEdit` confirms it for the
  document and the calling key (a request on one block does not count); otherwise it is dropped and
  the refusal says why (`$.requestId`).
- **Concurrency.** Ops and structure honour `expectedRevision` (409); placements ignore it by
  design (absolute, per card, idempotent, last write wins; vanished cards are `ignored`).
- **Routes** are as proposed, plus `POST .../arrange` and `PUT` layout-cache refused to agents.
  Errors: `{ error: { code, message, hint, example, problems }, problems, message }`: the docs ask
  for the shared `ApiError` shape with `problems`; the web store reads `problems` and `message` at
  the top, so both are sent.
- **Placements** return `{ canvas, placed, ignored }` (the store ignores the body).
- **Events** are SSE as proposed (see api.md), with full-state messages and a heartbeat.
- **MCP.** `CanvasPort` (`createCanvasPort`, `services.canvasPort`): `get` (frames with card previews,
  connectors as "A -[label]-> B", `pinned`/`byHer` flags, no coordinates; `include: "full"` adds the
  structure), `setStructure`, `change`; the writes return `{ ok: false, kind, problems }` instead of
  throwing. The MCP tool is `study_map` (get, set_structure, change; docs/mcp.md): one tool rather than the
  three `canvas_*` tools proposed below, because they share one subject, one input and one rule.

**Proposed originally**, kept for reference:

**Storage.** One row per canvas: `canvases(document_id PK, revision, data JSON, updated_at)`
where `data` holds `cards`, `connectors`, `frames`, `syncedBlockIds`, `allowSelfLinks`
(validated with `Canvas` on write). A canvas is small (300 cards ≈ 100 KB), always read
whole and changed by ops, so JSON in one row keeps writes atomic and revisions cheap.
Optional: `canvas_layout_cache(document_id, variant, positions JSON, updated_at)`.
Created lazily: the first read of a document's canvas runs `deriveCanvas`. On trash or
delete of the document, its canvas follows (library hooks). Add the canvas to revision
history if wanted (a snapshot per revision like documents).

**Hooks.** After every document write that changes its block list, run
`mergeDocumentBlocks` in the same transaction and bump the canvas revision; emit a change
feed entry and an SSE event.

**Routes** (session auth, JSON, shared `ApiError` shape with `problems` for invalid input):

| Route | Body → result |
|---|---|
| `GET /api/documents/:id/canvas` | → `LoadedCanvas { canvas, blocks, documentTitle }` (derives on first read) |
| `POST /api/documents/:id/canvas/ops` | `{ ops, expectedRevision?, requestId? }` → `{ canvas, report }`; `applyCanvasChange` with the session's actor; 409 on conflict |
| `PUT /api/documents/:id/canvas/structure` | `SetCanvasStructureInput` → `{ canvas, report }` (agents mostly) |
| `PUT /api/documents/:id/canvas/placements` | `{ placements }` → `{ canvas }`; same as a `place_cards` op, accepts `keepalive` posts |
| `GET/PUT /api/documents/:id/canvas/layout-cache/:variant` | `{ positions }` (204 when none) |
| `GET /api/documents/:id/canvas/events` | Server-Sent Events: `event: canvas`, data `LoadedCanvas`, after merges and agent writes |

**MCP** (as proposed; built as ONE tool, `study_map`, whose actions are `get`, `set_structure` and `change`; read-write keys only for writes):

| Action | Input | Notes |
|---|---|---|
| `canvas_get` | `documentId`, `include?: "structure" \| "full"` | Structure only by default: cards (id, kind, block IDs, size, colour, title, `pinned: true/false`, frame), connectors, frames in order; never coordinates |
| `canvas_set_structure` | `SetCanvasStructureInput` | Returns the report with `skipped` items and refs |
| `canvas_change` | `CanvasChangeInput` | Agent ops only; `place_cards`, `release_pins`, `insert_items` are refused with the reason |
| (overview) | | Publish `writerJsonSchema(SetCanvasStructureInput)` and `CANVAS_EXAMPLES`, plus one paragraph: "describe structure, never positions; she arranges; pass requestId to change what she made" |

The server passes `documentBlockIds` (the document's current blocks) to both apply
functions so block cards are checked, and the agent's `Actor` (type `agent`) so the pin
rule applies.

## What is not done

- The web HTTP store has not yet been run against the server in a browser (the server side and the
  MCP tool `study_map` are built and tested).
- Real block renderers (the documents feature's `renderBlock`); images are placeholders.
- Card resize handles: `PinnedSize` and `place_cards` with `width`/`height` exist, the
  view has no resize gesture yet.
- Editing a card's size class, title or blocks from the view (agents and the API can).
- Concept cards resolve their label from the card only; no concept lookup yet.
- Connector routing around cards: curves can pass under other cards; labels stay on top.
- Tested on desktop Chromium with touch emulation, not yet on a real iPad or iPhone:
  the edge guard, `gesturestart` handling and momentum need a device check.
- Freehand pen (E7, later).
