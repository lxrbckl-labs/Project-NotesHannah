
# Feature list, version one

Draft. Each line has an ID so it can be kept, cut or moved by name. **Later** means
proposed for after the first release. See [architecture.md](architecture.md) for the design behind it.

## A. Accounts and access

- **A1** Login with username and password. Accounts created by an admin command; no sign-up page.
- **A2** Brute-force protection: attempt limits per account and per address, growing delays.
- **A3** Stay signed in per device; sign out; sign out everywhere.
- **A4** Change password.
- **A5** API keys in settings: create, name, read-only or read-write, revoke, last-used time.
- **A6** Data separated per user.
- **A7** *Later:* passkeys.

## B. Upload and inbox

- **B1** File picker upload, several files at once: PDF, PPTX, JPEG, PNG, HEIC.
- **B2** Agent upload links, batch-capable.
- **B3** Inbox list with a status per file: uploaded, converted, transcribed, filed, failed.
- **B4** Sandboxed conversion to page images; originals kept untouched.
- **B5** Native text pulled from PPTX and PDF, including speaker notes.
- **B6** Limits and clear errors: size, page count, password-protected files.
- **B7** Retry a failed upload or conversion.
- **B8** *Later:* resumable uploads.

## C. Library

- **C1** Tree of courses, folders and documents: create, rename, move, duplicate, trash.
- **C2** Trash with restore. Permanent delete only by her, only from the trash.
- **C3** Touch-friendly move (long-press menu, move-to sheet); drag and drop on a laptop.
- **C4** Full-text search across transcripts and study material.
- **C5** Recents and favourites.
- **C6** Source viewer: the original page beside its transcript.
- **C7** *Later:* tags.
- **C8** Whole-library tree page (added 2026-11-15, from what she said she wants most): the
  library home on every device is one page showing everything as a tree, including her
  uploaded files as leaves. She clicks into an item and back out, and the tree is exactly
  as she left it (same rows open, same scroll position).

## D. Documents and blocks

- **D1** Page view with a block editor. Typing shortcuts at the start of a paragraph: `# `, `## `, `### ` headings; `- ` or `* ` bullets; `1. ` numbers; `[] ` checklist; `> ` quote; `!! ` warning callout; `?? ` tip callout; `---` then Enter (or `--- `) a divider. An empty document can start with the caret ready in one paragraph (`startWriting`).
- **D2** Basic blocks: heading, paragraph, lists, quote, divider, table, image.
- **D3** Callouts and colour highlights.
- **D4** Drug card: name, class, mechanism, indications, adverse effects, interactions, counselling points.
- **D5** Comparison table built from concepts.
- **D6** Mnemonic block.
- **D7** Labelled image with tappable hotspots.
- **D8** Mind map block.
- **D9** Source chip on any block, opening the page it came from.
- **D10** "Unverified" marker and uncertainty flags; mark as reviewed.
- **D11** Each block records who last edited it; agent regeneration leaves her edits alone.
- **D12** Revision history and restore per document.
- **D13** Outline panel.
- **D14** *Later:* flowchart and diagram block.

## E. Canvas

- **E1** Canvas view of a document: cards, labelled connectors, frames, on a dotted grid.
- **E2** Automatic layout; anything she drags stays where she put it.
- **E3** Add, edit and delete cards, connectors and frames by hand.
- **E4** Stickers and decorations.
- **E5** Frame list and step-through, as a guided review.
- **E6** Pan, pinch-zoom, zoom to fit.
- **E7** *Later:* freehand pen.

## F. Concepts

- **F1** Typed concepts and relationships, stored with their sources.
- **F2** Concept page: everything known about a drug or class, linking to the notes.
- **F3** Concept graph view, centred on one concept.
- **F4** Drug-name check against RxNorm.
- **F5** Filter across courses (for example, every drug with a given adverse effect).

## G. Practice

- **G1** Question blocks: multiple choice, select-all, matching, fill-in-the-blank,
  calculation, flashcard, case (a vignette with linked questions), free response.
- **G2** Practice session: choose scope (course, lecture, folder or concept), formats and length.
- **G3** App grades the objective types and calculations; she self-grades free response and cases.
- **G4** Explanation and source link on every question.
- **G5** Attempt history and results.
- **G6** Weak-areas view.
- **G7** Flashcard review deck.
- **G8** Agents can read results over MCP to build targeted practice.
- **G9** Spaced-repetition scheduling for flashcards (moved into the first release 2026-11-15).
- **G10** *Later:* timed exam mode.
- **G11** Missed-questions notebook: every question she gets wrong is collected
  automatically, can be retried, and leaves the notebook once answered correctly.
- **G12** Brand and generic drill: a matching mode over the drugs in her notes (brand
  name, generic name, class), built from the concepts with no extra authoring.

## K. Citations

Added 2026-11-15. Everything generated says where it came from, and she can click
through to see it.

- **K1** Every generated block and every practice question carries one or more citations.
  A citation names the source file, the page, the quoted passage from the transcript,
  and a region on the page when one is known.
- **K2** Citations show as numbered chips. Tapping one opens the original page beside the
  document, with the quoted passage highlighted in the transcript, and the region
  outlined on the page image when available.
- **K3** A block built from several sources lists each one.
- **K4** The agent layer refuses a generated block with no citation, unless the agent
  marks it explicitly as general knowledge; those blocks show a visible "not from your
  notes" label.
- **K5** Reverse view on a source page: everything that cites it.
- **K6** Citations survive edits, moves and regeneration. If a cited source is trashed,
  the chip says so instead of breaking.
- **K7** A references list at the end of each document.

K1 to K4 and K6 are built in stage 2 with the block schema; K5 and K7 follow in the
same stage. Supersedes D9 and G4, which described the same idea more loosely.

## L. Request queue

Added 2026-11-15. How she asks for things without running an agent herself.

- **L1** She can leave a request anywhere: on a course, a document or a single block
  ("quiz me on beta blockers", "this card is wrong", "explain this more").
- **L2** A requests screen lists them with a status: waiting, in progress, done, declined.
- **L3** Agents read and claim requests over MCP, do the work, and mark them done with a
  short note of what changed and links to the result.
- **L4** She sees the agent's reply on the request and can reopen it.
- **L5** Quick actions on a block for the common cases: wrong, unclear, more like this,
  make questions from this.

## M. Exam planner

Added 2026-11-15.

- **M1** Each course has exams with a date and the lectures or folders each one covers.
- **M2** Home screen shows upcoming exams with a countdown and how much of the covered
  material she has reviewed.
- **M3** Practice sessions, the missed-questions notebook and the flashcard deck can be
  scoped to an exam.
- **M4** Agents read exams over MCP, so they can build a review schedule backwards from
  the date and target the covered material.

## H. Agent layer (MCP)

- **H1** Remote MCP endpoint with API-key login.
- **H2** Short role instructions on connect, plus an overview tool with the full conventions.
- **H3** Traverse everything: tree, documents, blocks, source pages, concepts, with links to neighbours.
- **H4** Search.
- **H5** Fetch page images, inline or as a download link.
- **H6** Write: create, update, move and trash documents, blocks, concepts and canvas
  structure, with validation and helpful errors.
- **H7** Request upload links.
- **H8** Inbox workflow: list pending files, claim one, mark it done.
- **H9** Change feed.
- **H10** Agent activity log shown in the app.
- **H11** Plain-text agent guide on the site; `robots.txt` keeps crawlers out.

## I. Appearance and devices

- **I1** Light and dark mode, following the device, with a manual switch.
- **I2** Three layouts, all first-class: computer, tablet and phone. Every screen is
  designed for all three, and no feature is finished until it works at each size, in
  both orientations on tablet, by touch and by mouse and keyboard.
- **I3** Installable to the home screen.
- **I4** React Bits components, respecting reduced motion.
- **I5** *Later:* offline reading.

## J. Operations

- **J1** Docker container, routed through the existing Caddyfile at `notes.hannahporras.app`.
- **J2** Storage layout with a guard against a missing drive.
- **J3** Backups and a tested restore, in place before she uses it.
- **J4** Health check and logs.
- **J5** Admin commands: create user, reset password.
- **J6** Export all of her data as one download.

## Proposed build order

1. **Foundation:** A1 to A6, B, C, H1 to H8, J1, J2, J5. An agent can upload, transcribe and file.
2. **Documents:** D, H9, H10. Generated study material she can read and edit.
3. **Practice:** G1 to G8.
4. **Canvas and concepts:** E1 to E6, F.
5. **Before she gets it:** I, J3, J4, J6, H11.

## N. User guide

Added 2026-11-16.

- **N1** A guide page at `/help` ("Guide"), written for her: what the app is, finals planning with assistants, every screen in plain words, a "what makes this different" band and a list of current limits. Reached from the sidebar and from Settings (the phone's tab bar is full).
- **N2** The same guide as a PDF at `/guide/notes-guide.pdf`, linked by a Download PDF button on the page, and a print layout so the browser's Print is clean too. The words live in `apps/web/src/features/help/content.ts`; `pnpm guide:pdf` regenerates the file.
