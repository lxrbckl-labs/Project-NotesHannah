
# Documents, blocks and citations

The shared contract for study material. The web UI, the HTTP API and the MCP layer all
validate against the same Zod definitions in `packages/schema/src`:

- `blocks/` — rich text, the block types, the block registry, the rules and validation;
- `citations.ts` — citations, page regions, source status and the reverse lookup;
- `documents.ts` — documents, revisions, writer operations and read helpers.

Related: [architecture.md](architecture.md) (content model, citations, MCP layer),
[features.md](features.md) (sections D and K).

## The shape in one picture

```
Document  { id, nodeId, kind, title, blockIds[], reviewStatus, revision, … }
  └─ Block { id, type, content, style?, citations[], generalKnowledge, flags[],
             origin, review, provenance }
       └─ content: one shape per type; text inside it is rich text
```

A writer (an agent, or the web editor on her behalf) sends only
`{ type, content, style?, citations?, generalKnowledge?, flags? }`. The server assigns
`id`, `origin`, `review` and `provenance`; sending them is an error that says so.

## Rich text

Text inside blocks is a flat list of inline items. Anywhere rich text is expected, a
plain string is accepted and normalised to one text run.

```json
"Beta blockers end in -olol"

[
  { "text": "Metoprolol", "bold": true },
  { "text": " is β1-selective", "highlight": "yellow" },
  { "cite": 1 },
  { "text": "; compare " },
  { "concept": "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", "text": "propranolol" }
]
```

- **Text run:** `text` plus optional marks `bold`, `italic`, `underline`, `strike`,
  `code`, `highlight` (a colour token) and `link` (http or https). A newline is a line
  break.
- **Citation marker:** `{ "cite": n }` points at the n-th citation (from 1) of the
  nearest citation list: the field's own list when the field has citations, otherwise
  the block's `citations`. A marker past the end of its list is an error.
- **Concept mention:** `{ "concept": "con_…", "text": "…" }`, shown as a link to the
  concept page and collected for the concept's backlinks.

Normalisation drops marks set to false and merges neighbouring runs with the same
marks, so the same text always serialises the same way.

**Colours** are tokens, never raw colours, so light and dark themes both work:
`gray, brown, red, orange, yellow, green, teal, blue, purple, pink`. A block's `style`
is `{ color?, background? }`.

## Block types

Every block also has the envelope fields: `style`, `citations` (at most 20),
`generalKnowledge`, `flags` (at most 20, each `{ kind, quote?, note? }` with kind
`uncertain | illegible | dose | unit | decimal | drug_name | source_conflict`).
"Cites" says whether a generated block of that type must cite (see the citation rule).
The examples are the registry's own minimal examples; `EXAMPLE_CITATION` is

```json
{ "fileId": "fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", "pageId": "pag_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  "quote": "Cardioselective agents (atenolol, metoprolol) preferentially block β1 receptors.",
  "label": "Slide 12" }
```

| Type | Purpose | Content fields and limits | Cites |
|---|---|---|---|
| `heading` | Section title | `level` 1–3, `text` (300 chars) | no |
| `paragraph` | Running text | `text` (10,000) | yes |
| `bulleted_list` | Unordered points | `items` 1–100, each a string or `{ text, indent 0–2 }` | yes |
| `numbered_list` | Ordered steps | as bulleted, plus `start` | yes |
| `checklist` | Study tasks | `items` 1–100, each a string or `{ text, checked }` | no |
| `quote` | A quoted passage | `text` (5,000), `attribution` | yes |
| `divider` | Section break | none (`content` may be left out) | no |
| `table` | Grid of rich text | `rows` 1–60 × 1–10 cells (2,000 each, equal length), `headerRow` (default true), `headerColumn`, `caption` | yes |
| `image` | An uploaded page or a region of one | `source { fileId, pageId?, region? }`, `alt` (required), `caption` | no |
| `callout` | Boxed note | `kind` info, tip, warning, important, definition, exam_tip; `title`; `text` (5,000) | yes |
| `drug_card` | One drug | `name`, `concept`, `brandNames` (10), `drugClass`, `mechanism`, and lists of up to 20: `indications`, `adverseEffects`, `contraindications`, `interactions`, `monitoring`, `counselling`, `dosingNotes` | yes |
| `comparison_table` | Drugs or concepts compared | `title`, `attributes` 1–10, `rows` 2–20 of `{ subject, concept?, cells }` with one cell per attribute | yes |
| `mnemonic` | Memory device | `device`, `topic`, `parts` 1–26 of `{ key, meaning }`, `note` | yes |
| `labelled_image` | Image with tappable hotspots | `image` (as image source), `alt`, `hotspots` 1–30 of `{ x, y, label, detail?, concept? }` | yes |
| `mind_map` | Tree of short labels | `root` node `{ label, concept?, color?, children? }`; at most 4 levels below the root, 12 children per node, 100 nodes | yes |
| `question` | Places a practice question | `questionId` (the question carries its own citations) | no |

**Cited fields.** Drug card clinical fields and comparison cells are *cited fields*: a
plain string, or `{ text, citations (≤5), flags (≤5), generalKnowledge? }`. A wrong
dose matters more than a wrong sentence, so each dose can carry its own source and its
own `dose` flag.

Coordinates (`region`, hotspot `x`/`y`) are fractions of the page: 0,0 is the top-left
corner, 1,1 the bottom-right. Regions must stay on the page.

### Examples

```json
{ "type": "heading", "content": { "level": 2, "text": "Beta-adrenergic antagonists" } }

{ "type": "paragraph",
  "content": { "text": "Atenolol and metoprolol are cardioselective (β1) blockers." },
  "citations": [EXAMPLE_CITATION] }

{ "type": "bulleted_list",
  "content": { "items": ["Bradycardia", "Fatigue", { "text": "Masks hypoglycaemia", "indent": 1 }] },
  "citations": [EXAMPLE_CITATION] }

{ "type": "numbered_list",
  "content": { "items": ["Check heart rate", "Check blood pressure", "Ask about dizziness"] },
  "citations": [EXAMPLE_CITATION] }

{ "type": "checklist",
  "content": { "items": ["Learn the cardioselective agents", { "text": "Redo quiz 3", "checked": true }] } }

{ "type": "quote",
  "content": { "text": "Never stop a beta blocker abruptly.", "attribution": "Dr Patel, lecture 7" },
  "citations": [EXAMPLE_CITATION] }

{ "type": "divider" }

{ "type": "table",
  "content": { "rows": [["Agent", "Selectivity"], ["Atenolol", "β1"], ["Propranolol", "β1 and β2"]] },
  "citations": [EXAMPLE_CITATION] }

{ "type": "image",
  "content": { "source": { "fileId": "fil_…", "pageId": "pag_…",
                           "region": { "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.4 } },
               "alt": "Diagram of β1 and β2 receptor locations" } }

{ "type": "callout",
  "content": { "kind": "exam_tip",
               "text": "Know which beta blockers are cardioselective: atenolol, bisoprolol, metoprolol." },
  "citations": [EXAMPLE_CITATION] }

{ "type": "drug_card",
  "content": { "name": "metoprolol", "brandNames": ["Lopressor", "Toprol-XL"],
               "drugClass": "Cardioselective beta blocker",
               "adverseEffects": ["Bradycardia", "Fatigue"],
               "dosingNotes": [{ "text": "Start 25 mg PO BID", "citations": [EXAMPLE_CITATION],
                                 "flags": [{ "kind": "dose", "quote": "25 mg" }] }] },
  "citations": [EXAMPLE_CITATION] }

{ "type": "comparison_table",
  "content": { "attributes": ["Selectivity", "Lipid soluble"],
               "rows": [{ "subject": "Atenolol", "cells": ["β1", "No"] },
                        { "subject": "Propranolol", "cells": ["β1 and β2", "Yes"] }] },
  "citations": [EXAMPLE_CITATION] }

{ "type": "mnemonic",
  "content": { "device": "BAD", "topic": "Beta-blocker cautions",
               "parts": [{ "key": "B", "meaning": "Bradycardia" }, { "key": "A", "meaning": "Asthma" },
                         { "key": "D", "meaning": "Diabetes (masks hypoglycaemia)" }] },
  "generalKnowledge": true }

{ "type": "labelled_image",
  "content": { "image": { "fileId": "fil_…", "pageId": "pag_…" },
               "alt": "Heart and lungs with adrenergic receptors",
               "hotspots": [{ "x": 0.42, "y": 0.35, "label": "β1: heart" },
                            { "x": 0.7, "y": 0.3, "label": "β2: bronchial smooth muscle" }] },
  "citations": [EXAMPLE_CITATION] }

{ "type": "mind_map",
  "content": { "root": { "label": "Beta blockers", "children": [
      { "label": "Cardioselective", "children": [{ "label": "Atenolol" }, { "label": "Metoprolol" }] },
      { "label": "Non-selective", "children": [{ "label": "Propranolol" }] } ] } },
  "citations": [EXAMPLE_CITATION] }

{ "type": "question", "content": { "questionId": "qst_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" } }
```

## Citations

A citation names `fileId`, `pageId`, the `quote` (1–1,000 characters, copied character
for character from the page's transcript), optionally the `transcriptId` and
`transcriptRevision` it was quoted from, a `region` on the page, and a short `label`
("Slide 12"). Servers check the quote with `findQuote`, which is exact on purpose: an
exact quote is what lets the reader highlight it.

- **Numbering (K2, K7).** `listReferences(blocks)` lists every cited passage once,
  numbered from 1 in order of first appearance: block by block, and within a block its
  own citations first, then its fields' in reading order. The same quote from the same
  page keeps one number wherever it is cited.
- **Trashed sources (K6).** Citations are never rewritten when a source changes. When
  they are read, each gets a `CitationStatus`: `available`, `source_trashed` (the chip
  says so and offers restore) or `source_deleted` (permanently deleted; the quote is all
  that remains). Status is computed, not stored, so trashing a file touches no block.
- **Reverse lookup (K5).** `citationIndexRows(documentId, blocks)` gives one row per
  citation for the index behind "what cites this page"; the response shape is
  `PageBacklinks { pageId, fileId, items: CitationBacklink[] }`, where a citing location
  is a block (with the field path, e.g. `$.content.dosingNotes[0]`) or a practice
  question.

## The citation rule

A block written by an agent, of a type marked "cites", must carry at least one citation
(on the block or on any of its fields) **or** be marked `"generalKnowledge": true`, which
the UI labels "not from your notes". Exempt: `heading`, `checklist`, `divider`, `image`,
`question`, and anything she writes herself.

`generalKnowledge: true` means nothing in the block is from her notes, so it cannot be
combined with citations on the same block or field. To mark one line of a drug card as
general knowledge, set it on that field.

The rule depends on who writes, so it is checked by `validateBlockInput` and
`validateOperation` (writer defaults to agent), not by the bare `BlockInput` schema. A
refused block gets this kind of error:

```json
{ "path": "$.blocks[1].citations",
  "message": "This paragraph has no citation. Generated blocks must say where they came from. Add at least one citation … or set \"generalKnowledge\": true …",
  "example": { "type": "paragraph", "content": { "text": "…" }, "citations": [EXAMPLE_CITATION] } }
```

## Edit protection

Each block has `origin` (`agent` or `user`), `review` (`unverified` or `reviewed`) and
`provenance { createdBy, createdAt, lastEditedBy, lastEditedAt }`.

- An agent creating or editing a block makes it `origin: "agent"` and `unverified`.
- Her creating a block makes it `user` and `reviewed` (her own words).
- Her editing a block's content or style makes it `user`. This is sticky.
- Her marking a block reviewed changes only `review`, not origin or provenance.

**An agent may overwrite a block** (replace, patch, delete, or remove it in
regeneration) **only when its origin is `agent` and it is unverified.** Blocks she wrote,
edited or reviewed are protected. The single exception is when the agent acts on her
explicit request and passes that request's `requestId`. `canAgentOverwrite(block, {
requestId })` is the one function that decides; servers call it before every agent
write to an existing block.

**Regeneration** (`replace_generated`) removes the overwritable blocks in scope (default:
the whole document), keeps protected blocks where they are, places the new blocks where
the first removed block stood, and reports protected blocks as `skipped` with reason
`user_edited` or `reviewed` (`planRegeneration`).

## Writer operations

These are the API bodies and MCP tool inputs (`WRITER_OPERATIONS`). Each has an example
in `OPERATION_EXAMPLES`. All accept `expectedRevision` (refuse with `conflict` if the
document moved on).

| Operation | Body |
|---|---|
| `create_document` | `kind`, `title`, `blocks?` and exactly one of `nodeId` (fill an existing lecture or document node) or `parentId` (create a document node there) |
| `insert_blocks` | `documentId`, `blocks` (1–100), `position` |
| `update_block` | `mode: "replace"` with `block`, or `mode: "patch"` with `patch { content?, style?, citations?, generalKnowledge?, flags? }`; `requestId?` |
| `move_blocks` | `documentId`, `blockIds`, `position`, `toDocumentId?` |
| `delete_blocks` | `documentId`, `blockIds`, `requestId?` (removed blocks remain in revision history) |
| `replace_generated` | `documentId`, `blocks` (≤300), `scope?`, `requestId?` |
| `restore_revision` | `documentId`, `revision` |

A position is `"start"`, `"end"` (default for inserts), `{ "after": "blk_…" }`,
`{ "before": "blk_…" }` or `{ "index": n }`. A patch replaces each top-level key it
names; inside `content` it replaces the named content fields and keeps the rest;
`style: null` clears the style.

`validateOperation(name, body, { writer })` validates a body with teaching errors. Every
problem has a JSON `path`, a plain-language `message` and an `example`: a minimal block
of the same type for problems inside a block, or the operation's example otherwise. An
unknown block type lists all valid types and suggests the closest one. Server fields
sent by a writer are explained, not silently dropped.

`writerJsonSchema(schema)` produces the JSON Schema the MCP layer publishes (input
side, shared definitions such as `Citation`, `Inline` and `block_drug_card` under
`$defs`). The full block union is about 18 KB.

## Revisions

Every saved change increases `revision`. A `Revision` holds a full snapshot (`title`,
`kind`, `blocks` with their provenance). Restoring writes the old snapshot as a *new*
revision (`restoredFrom` set), so history is never rewritten and a restore can be undone.
Snapshots are full rather than diffs because one user's documents are small and a full
snapshot makes "restore this version" a copy, not a replay.

## Design decisions

**A flat list of blocks, not a tree.** A document is `blockIds` in reading order.
Nesting lives inside a block's content where it means something (list indents, mind map
children, table cells), and there is no generic container or columns block.
- Agents address blocks by ID with simple positions (after, before, index); a tree would
  need parent IDs and nested positions in every write.
- Regeneration, protection, review and citations all work per block; containers would
  raise "is a container user-edited if one child is?" with no good answer.
- The canvas view (E1) already lays blocks out in two dimensions, one card per block.
  Columns would be a second, phone-hostile layout system; on a phone they collapse to a
  list anyway.
- A container type can still be added later as one registry entry, if a real need shows.

**Lists use indents, not nested lists.** Items are `{ text, indent }` with indent growing
by at most one. It is compact to write, cannot form impossible shapes, and converts in a
few lines to the nested lists both editors use. Mind maps are genuine trees and use
nested `children`.

**Rich text is a flat inline list with marks as properties.** It is short enough to
write by hand, has one canonical form, and maps directly onto both editors: a run is a
ProseMirror text node (Tiptap) or a styled text item (BlockNote); `bold` and friends map
to marks or styles; `highlight` maps to a highlight mark with a token attribute; `link`
to a link mark (BlockNote: a link inline content item); `cite` and `concept` become
custom inline nodes (Tiptap) or custom inline content (BlockNote). The string shorthand
covers most agent writes.

**Mapping to Tiptap or BlockNote.** Each block type becomes one custom block node:
`heading`, `paragraph`, the lists, `quote`, `divider`, `table` and `image` map to the
built-ins (lists by expanding indents; table rows to table rows); the rest are custom
React node views whose attributes hold `content` as JSON. The envelope (`id`,
`citations`, `flags`, `origin`, …) rides along as node attributes the editor carries
but does not edit. The stored format is ours; an editor is a view over it, so switching
editors is a mapping change, not a migration.

**Content inside `content`.** Keeping type-specific fields under `content` and shared
fields at the top lets every block share one envelope and one set of rules, and lets a
patch name content fields without colliding with `citations` or `style`.

**Validation in two layers.** Zod schemas give structure and limits; small functions
(`envelopeIssues`, `citationRuleIssue`) check what spans fields or depends on the
writer. Both report through one problem format.

## Adding a block type

1. Write its content schema in `blocks/types.ts`, with limits.
2. Add one entry to `DEFINITIONS` in `blocks/registry.ts`: label, description for
   agents, `citationsRequired`, content schema, a minimal example and a `parts` function
   listing its readable text in order.

The unions, writer input, validation, plain-text extraction, references and JSON Schema
pick it up from the registry. The tests check every registry example automatically.
