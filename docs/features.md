
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

- **B1** File picker upload, several files at once. Accepted, read from the content and never from the
  name: PDF; slides (PowerPoint .pptx, .pptm, .ppsx, .ppt; OpenDocument .odp); Word handouts (.docx, .docm,
  .doc; OpenDocument .odt); and images: JPEG, PNG, HEIC, WebP, GIF, TIFF, AVIF, BMP. Every one becomes
  page images: a TIFF gives one page per image in it, a GIF, WebP or AVIF animation keeps its first frame
  (the viewer's file details say so). SVG (it can carry scripts) and spreadsheets are refused with a message
  that says what to send instead. The viewer's "Download original" returns the file exactly as uploaded, as
  an attachment.
- **B2** Agent upload links, batch-capable.
- **B3** Inbox list with a status per file: uploaded, converted, transcribed, filed, failed.
- **B4** Sandboxed conversion to page images; originals kept untouched.
- **B5** Native text pulled from PPTX, PDF and Word or OpenDocument files, including speaker notes (PPTX). Photos have none.
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
  - Typing marks inside text: `**bold**`, `*italic*` or `_italic_`, `` `code` ``, `~~strike~~` and `==highlight==` turn into the mark when the closing characters are typed.
  - From tablet width up, editing shows a formatting ribbon under the document's bar, as in a word processor: undo and redo, a block style dropdown (Text, Heading 1 to 3, Quote, the three lists, Callout), bold, italic, underline, strikethrough, code, highlight, block colour, link, list toggles, indent and outdent, Insert (the full block menu) with one-tap table, callout and divider, and a cheat sheet of every shortcut. It follows the block and the marks where the caret is. On a computer a small bubble over selected words keeps the inline marks; on a phone the same controls sit in a bar above the keyboard.
  - From tablet width up the document reads as a sheet of paper on the desk; wide tables scroll sideways inside their own box.
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
- **H12** Parity: agents can do what she can, through the same domain functions, except what is hers
  by design (sign-in and account, presentational and per-device state, reviewing, practice, side
  notes, permanent deletion). The capability-by-capability table is in `docs/mcp.md`, "Parity with
  the app"; a new feature gets a row there.

## I. Appearance and devices

- **I1** Light and dark mode, following the device, with a manual switch.
- **I2** Three layouts, all first-class: computer, tablet and phone. Every screen is
  designed for all three, and no feature is finished until it works at each size, in
  both orientations on tablet, by touch and by mouse and keyboard.
- **I3** Installable to the home screen.
- **I4** React Bits components, respecting reduced motion.
- **I5** *Later:* offline reading.
- **I6** Her own order for the phone's bottom tab bar (per account, so it follows her to every
  device). Settings, "Tab bar", has a copy of the bar whose icons she drags left and right, the
  others sliding out of the way, by touch, mouse or pen; the arrow keys and "Move left" and "Move
  right" buttons do the same. What she arranges is a draft: the real bar changes only when she
  presses Save (Cancel and "Reset to default" change the draft only, and leaving Settings drops
  it). The page slide when she taps a tab follows the order shown. Tablet and computer keep the
  sidebar; the card says so. It is the first of the per-person preferences (`GET` and `PATCH
  /api/me/preferences`), a small settings document that later choices (which optional tabs show)
  join without a new table.

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
- **N3** Structure and design (2026-11-16): the thirteen sections are grouped into four parts (Start here, Your material, Study tools, Help and housekeeping), each section opens with its number, part and lead line, and the guide ends with a one-page quick reference of every typing shortcut, formatting mark and key. Nine numbered figures are real screenshots of the app on the pharmacy demo set (`pnpm guide:figures`); on `/help` they open larger to zoom. The page has a sticky contents list grouped by part on a computer, a slim "On this page" bar on a phone or tablet, and both mark the section being read.
- **N4** The PDF is a designed booklet: a cover with the edition, a contents page with page numbers and working links, the showcase as a two-page spread, a full-page opener for each part, each section on a new page with a running head (part and section) and a page number, figures with their captions in the margin, and the quick reference as the last page. Letter, about 2.8 MB.

## O. References

Added 2026-11-16. Details: [references.md](references.md).

- **O1** A References page at `/references`: in the sidebar on tablet and computer; on a phone from
  the library home and Settings (the tab bar is full). Built-in sites come from a registry
  (`REFERENCE_SITES` in `packages/schema`), PharmGuides first: what it is in our words, a search box
  that opens its search in a new tab, tiles for its sections, its therapeutic areas as search chips,
  and the line about checking primary sources.
- **O2** Her saved references: title, address (http or https), note, kind (guideline, calculator,
  chart, article, other), places in her library, pinned. Add, edit, delete (with a confirm), pin,
  filter by kind, course and words. A pasted address fills the title and kind; a PharmGuides
  address is tagged as from PharmGuides. "Where it is used" lists the notes that draw on it.
- **O3** Where she studies: a course, folder, lecture or document page shows the references tied to
  it (a course also those of everything inside it) with "Add a reference here"; a document's bar
  has a References button; a concept page has "Look up on PharmGuides"; search and quick find show
  her references and offer "Search PharmGuides for ..." under the results.
- **O4** Attribution: a block can name the outside references it draws on. They show as their own
  chip ("PharmGuides · DoseDex", opening the page in a new tab), apart from her numbered sources,
  and in their own group in the document's references list. She adds one from the block menu
  ("Add a reference...": a saved reference or a pasted address).
- **O5** Agents: the `references` tool lists the trusted built-in sites and her saved references and
  adds one when she asks; agents check and extend her notes against them, keep her slides first and
  flag disagreements, and label anything from a reference. The app never fetches the sites.
- **O6** The demo set (`pnpm local:seed:pharm`, or `pnpm local:seed:pharm:references` on an existing
  one) saves eight references to guideline organisations' pages and PharmGuides sections, tied to
  the lectures, and adds three agent blocks checked against them.

## P. Sidebars and side notes

Added 2026-11-16. Details: [side-notes.md](side-notes.md).

- **P1** Side notes: her private notes in the margin of a document, like comments in a word
  processor but to herself. Plain text with line breaks, an optional colour, created and changed
  times, done (resolve) and delete with Undo. Stored apart from the document's blocks: writing one
  never edits the document, its review state or its version history, so they work on agent-written
  guides.
- **P2** Resources panel: the slide and page sources and the outside references of each block,
  grouped by section; the section she is reading is open and the entries for the blocks in view are
  highlighted. An entry jumps to its block (and flashes it) or opens the source (the source panel,
  or the outside page in a new tab). Pointing at a block lights up its entries and the other way
  round.
- **P3** Notes panel: each note sits level with its block and moves with it as she scrolls; notes
  that compete for the same height stack, the one she is looking at exactly level and the others
  moving out of its way; a note whose block is on screen but past the panel's edge waits at that
  edge.
- **P4** Writing one: the note button in a block's right margin (on hover on a computer, beside the
  block at the reading line on touch), "Add a side note" in the block menu, `⌘⌥M` / `Ctrl+Alt+M`
  while editing (words selected in the block become the note's quote), and the + of the Notes
  panel (the block she is reading). A block with notes shows a marker with the count, which opens
  them.
- **P5** Two sidebars: Outline, Resources and Side notes are panels she drags by a grip (mouse,
  touch or pen) between and within the sidebars, or moves from the grip's menu (other sidebar, up,
  down, close); a tap on the title folds one; the Panels button shows or hides each sidebar and
  reopens a closed panel; the inner edge drags the width. Remembered per kind of screen. Defaults:
  computer, Outline left and Side notes over Resources right; iPad sideways, Side notes right and
  the Outline folded left; iPad upright, both over the page one at a time; phone, a bottom sheet
  with Outline, Resources and Notes tabs. Sidebars dock only while the page keeps 460 px; the left
  gives way first.
- **P6** One reading position (the block a third of the way down) drives the outline's current
  heading, the Resources panel's section and the Notes panel's +.
- **P7** When blocks change: a note on a deleted block, or on generated content an agent replaced,
  is detached (kept, with the block's last words) until she attaches it to another block or deletes
  it; a note follows its block when it moves; restoring a revision that brings the block back
  attaches it again. Copies of a document start without side notes.
- **P8** Agents read her side notes (the `side_notes` tool: one document, or her open notes
  everywhere) as her remarks on where she is confused or what she wants; they cannot write them.
  Search finds them. The guide has a section on them, and the pharmacy demo set has eleven
  (`pnpm local:seed:pharm:sidenotes`). The formatting ribbon wraps to a second line when even its
  folded form does not fit (an upright iPad beside the app's sidebar).

## Q. Calendar

Added 2026-11-17 at Alex's request. `/calendar`, in the sidebar and the phone's tab bar.

- A month grid, Sunday first, with Today, previous and next. Each exam shows on its date (a dot on
  a phone, its title from tablet width up).
- A day she studied is tinted in three steps and marked with a pen. Studying is a graded practice
  answer or a block she added or changed in a document herself; an agent's writing is not counted.
- Picking a day lists its exams and what she did: questions answered, share correct, minutes
  (each answer capped at five minutes), the lectures the questions belong to, and the notes she
  wrote in, each a link.
- Three figures above: next exam, study streak (days in a row, today not yet studied does not break
  it), days studied in the month shown. "Coming up" lists exams in the next 60 days.
- Server: `GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&utcOffsetMinutes=N`, at most 62 days,
  any sign-in, read-only. Days are her local days, sorted with the offset the app sends.
- Not built: lecture dates on the calendar, reminders, planning study for a future day.

## R. Added on 2026-11-17 (local until Alex says to commit)

- **Colours:** Project-LucidIndex's neutrals with the University of Kansas blue (`#0051ba`) as the
  accent. Pill art stays.
- **Shell:** the search fills the header; one control size; each sidebar's toggle lives in that
  sidebar's header while open and in the top bar while closed; sidebars slide; every sidebar's inner
  edge drags to resize (remembered per browser, double-click to reset). Pages slide forward when
  something is opened and back on a back arrow or the browser's Back.
- **Background:** her own picture behind the pages (Settings, Background), one per account,
  `user_backgrounds` table, `/api/me/background`. Shrunk in the browser to 2560px before sending.
- **Practice:** every control on the question screen is one size; the bar, the question and the foot
  share one column. Focus aids (text size, extra spacing, reading ruler, just the question, read
  aloud), remembered per device. "How many" and Start are one solid bar.
- **Library:** whole-page drag and drop for uploads on the library home, the Inbox and every page
  that takes files; files drop onto folder rows; breadcrumbs are drop targets, to drag things out
  of a folder; folders nest as deep as she likes (`MAX_FOLDER_DEPTH` is a backstop of 50); a section
  can be marked as a favourite; Recently Opened shows six.
- **Documents:** the right side of the bar is one grouped toolbar with one control size; sidebars
  slide and their panels fold with an ease.
- **Concepts:** the neighbourhood graph draws concept cards with type icons and curved, coloured
  links, with zoom buttons and draggable cards.
- **Guide page:** links glide to their section; the contents marker slides.
- **Letter:** the heart beside Sign out (and at the foot of Settings on a phone) opens Alex's
  handwritten note to Hannah with a letter-opening animation.
- **Fixes:** dialog, sheet and confirm footers keep their bottom padding (the safe-area class had
  replaced it); the sign-in page keeps its top and bottom spacing; the Requests page no longer
  repeats the "agents pick these up" note.
- **Spelling:** American throughout what she sees (practice, color, favorites, summarize). Code
  names keep their spelling: the `favourite` and `colour` fields, the `cancelled` status, the
  `summarise` request kind, the `counselling_point` concept type and the agent tool descriptions
  are unchanged. The script is not kept in the repo; new wording is simply written in American.
- **Read and Edit:** the document bar has a Read / Edit switch (`mode-read`, `mode-toggle`),
  remembered per device under `notes-doc-mode`.
- **Panel heights:** a line between panels stacked in a document sidebar drags to share the height
  (`sizes` in the dock state); the aligned side notes are placed from the page, so they do not move.
- **Lecture header and panel headers:** the lecture page's actions are one grouped bar; a panel's
  header reads fold arrow, name, plus, and the grip at the far right.
- **Tooltips:** every icon-only button names itself with the Warm Tooltip (hover, focus, long
  press). See `docs/design.md` and `docs/react-bits.md`.

## S. Saved instructions and the tour (2026-11-21, local until Alex says to commit)

- **Saved instructions.** Her standing rules for work she asks agents for. Settings, "Instructions
  for agents": add, edit, delete (at most 30; name 80 characters, body 4,000). They are part of her
  preferences document (`instructions` in `/api/me/preferences`), so they follow the account.
- **On a request.** The request dialog has an Instructions dropdown. The chosen instruction's title
  and body are copied onto the request (`instructions`, column added by
  `0720_request_instructions.sql`), so a later edit or delete never changes an older request. With
  an instruction chosen, kind "other" needs no message. The request card shows it; the agent tool
  `requests` returns it on each item, names it in the summary line and tells agents to follow it.
- **The tour.** `features/tour`: ten stops (welcome, Library, Quick find, Inbox, Practice, Calendar,
  Concepts, Requests, Settings, the guide). The page dims, a spotlight glides to the navigation item
  for the stop (sidebar or tab bar; the page title where there is neither), and a card explains it.
  Next, Back, the arrow keys; Skip at the bottom right or Escape ends it.
- **When it runs.** By itself the first time an account signs in (`tourSeen` in preferences, set
  when it is finished or skipped). From "Take the tour" at the top of the guide and at its end. It
  never starts by itself under browser automation (`navigator.webdriver`), so the test suites are
  not covered by it.

