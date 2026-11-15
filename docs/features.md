
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

## D. Documents and blocks

- **D1** Page view with a block editor.
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
- **G9** *Later:* spaced-repetition scheduling for flashcards.
- **G10** *Later:* timed exam mode.

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
- **I2** iPad, phone and laptop layouts.
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
