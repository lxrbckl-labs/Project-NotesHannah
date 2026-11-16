# Side notes and the document sidebars

Features P1 to P8 in [features.md](features.md); routes in [api.md](api.md) ("Side notes"); the
agent tool `side_notes` in [mcp.md](mcp.md). Built 2026-11-16.

## The model

A side note is her private note in the margin of a document, like a comment in a word processor
but addressed to herself. In code it is a **margin note** (`margin_notes` table, `margin-notes`
domain, `MarginNote` in `packages/schema/src/margin-notes.ts`), so it cannot be confused with a
document or with the app's own name. In the app it is a "side note".

- Stored apart from the document's blocks. Writing, changing, resolving or deleting one never
  edits the document, never changes its review state and never adds a revision. So she can write
  them on an agent's study guide without touching it.
- Fields: her text (plain, line breaks kept, at most 4,000 characters), an optional colour token
  (none or one of the palette's lively hues), resolved (with the time), created and changed times,
  and the anchor below.
- At most 300 per document. Per user like every domain: another person's note or document is
  "not found".
- Only her browser session writes them. Agents read them through the `side_notes` tool (`list` for
  one document, `recent` for her open notes everywhere), as her remarks about where she is
  confused or what she wants; they cannot create, change or delete them.
- Search finds them (hit kind `margin_note`), and a hit opens the document at the note.
- Deleting a note on a live block shows an Undo toast (the note is written again); a detached note
  asks first, because its block is gone.

## Anchors

An anchor is a **block id**, plus an optional **quote** (at most 300 characters): the words she had
selected in that block when she started the note with `⌘⌥M` (`Ctrl+Alt+M`). The note also keeps a
**snippet**: the block's text when last seen (160 characters), so a detached note can still say what
it was on.

## When a block changes

The documents domain tells the margin-notes domain about every saved write, inside the write's own
transaction, with the blocks as they now are (`onBlocksChanged`, fanned out in `services.ts` next to
the canvas). For each note on that document:

| What happened to the block | The note |
|---|---|
| Still there (edited, moved, reviewed) | Attached; snippet refreshed. A move keeps the block id, so the note follows. |
| Deleted | **Detached**: kept, shown under "Detached" with the last snippet. |
| Replaced by an agent's "replace generated content" | Detached (the new blocks have new ids). |
| Brought back by restoring a revision (same id) | Attached again on its own. |
| Document deleted for good | The notes go with it (foreign key, cascade). |
| Document or lecture duplicated | The copy starts with no side notes (they are remarks on that copy). |

A detached note can be **re-attached** to any block of the same document (`POST
…/margin-notes/:noteId/reattach`; in the app, "Attach here" puts it on the block she is reading), or
deleted. The web app mirrors the rule as she edits: a note whose block is not in the page shows as
detached at once, and comes back if she undoes the delete.

## Where she is reading

One tracker per document (`panels/dock/position.ts`) works out the block at the **reading line**, a
third of the way down the page (at the very end of the page, the bottom), and the blocks in view.
Scroll events fold into one measurement per frame, which is a binary search over the blocks, so it
stays cheap in a long document. It drives the outline's current heading, the Resources panel's open
section and highlighted entries, the "+" in the Notes panel and, on touch screens, the note button
beside the block at the line.

## The Notes panel

In a sidebar (docked or over the page) each card sits level with the top of its block and moves
with it. Cards are laid out outside React (`panels/notes/align.ts`): a change of the page's height,
of a card or of the notes measures and stacks once per frame; scrolling only moves the cards from
numbers already known.

- **Stacking**: when cards would overlap they stack. The card she is looking at sits exactly level
  with its block; the others move up or down out of its way.
- **Edges**: a card whose block is still on screen but above the panel's top (or below its foot,
  when the panel shares a sidebar) waits at that edge until the block leaves.
- Resolved notes are tucked away under "Done (n)" at the panel's foot; detached ones under
  "Detached (n)".
- On a phone the panel is a list in page order inside the panels sheet.
- Markers: a block with notes has a small count in its right margin (amber while any is open); it
  opens the panel (or the phone sheet) at the first note.

## The Resources panel

The sources (numbered chips: her slides and pages) and outside references (reference chips) of each
block, grouped by section heading. The section at the reading line is open and its entries for the
blocks in view are highlighted. An entry jumps to its block (and flashes it); its button opens the
source panel or the outside page in a new tab. Pointing at a block lights up its entries, and the
other way round.

## Panels and sidebars

Three panels (Outline, Resources, Side notes) live in two sidebars beside the page column
(`panels/dock/`). A panel is dragged by its grip with any pointer (mouse, touch, pen), or moved from
the grip's menu (Move to the other sidebar, Move up, Move down, Close panel); a tap on its title
folds it; the "Panels" button in the document bar shows or hides each sidebar, reopens a closed
panel and resets the arrangement. A sidebar's inner edge drags its width (240 to 440 px; arrow
keys too). In a shared sidebar the Notes panel takes three fifths of the height.

The arrangement is remembered in local storage per **kind of screen**, not per document
(`notes.sidebars.v1.<layout>`):

| Kind of screen | Width | Starts with |
|---|---|---|
| Computer | 1280 and up | Outline left (248 px); Side notes above Resources right (320 px). |
| iPad held sideways | 768 to 1279, landscape | Outline left, folded away; Side notes right (288 px); Resources closed. |
| iPad held upright | 768 to 1279, portrait | Both sidebars folded away; each opens over the page, one at a time. |
| Phone | under 768 | No sidebars: the Outline button opens a bottom sheet with Outline, Resources and Notes tabs. |

**Minimum widths and what gives way.** A sidebar sits beside the page only while the page column
keeps at least **460 px** (about sixty characters of text after the page's margins). When both do
not fit, the **left sidebar gives way first** (the outline matters least while reading), then the
right; a sidebar that gives way waits folded and opens **over the page** when she asks for it, so the
page never squeezes and never scrolls sideways. On a 1440 computer with the app's sidebar open both
sidebars dock (the page keeps 616 px); at 1280 the left one gives way. While the source panel is open
it takes the right sidebar's place.

The page's own layout (the paper look from 520 px, wider margins from 880 px) follows the width of
the page column, not the window, so it stays readable whatever the sidebars take.

## Not done

- Canvas cards do not show side note markers.
- Duplicating a document does not copy its side notes.
- Notes are plain text (no bold or lists); the quote is captured from a selection only with the
  keyboard shortcut.
- The phone sheet closes when she taps Undo in the toast after deleting a note (the note does come
  back).
