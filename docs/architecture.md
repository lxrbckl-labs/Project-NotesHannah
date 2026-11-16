
# Project-NotesHannah architecture

Repo: `lxrbckl-labs/Project-NotesHannah` (private).
Domain: `hannahporras.app` (registered at Porkbun); the app is served at `notes.hannahporras.app`.

Related: [features.md](features.md), [tech-stack.md](tech-stack.md), [risks.md](risks.md).

> **Status**
> Design only. Decisions below were made in conversation on 2026-11-15. Nothing is built.

## What it is

A private web app that **builds** study material for a pharmacy student from her own
lecture material. It is not mainly a place to take notes. She uploads slides and
handwritten notes; an agent transcribes them, organises them into a structure, and
generates material for test and quiz practice that references its sources. She can then
create, edit, move and delete anything that was generated.

## Core decision: no AI inside the app

Changed 2026-11-15 (replaces the earlier server-side transcription idea).

- The app **stores, structures and displays**. It never calls a model and holds no
  Anthropic or OpenAI key.
- All intelligence is an **external agent session** (Claude Code, or Codex) that operates
  the app through its MCP layer, on that agent's own subscription.
- The agent authenticates with an **app-issued API key**: generated in the web app's
  settings, shown once, stored hashed, revocable, tied to one user's data. Sent as a
  bearer token.
- No OAuth. Consequence: the claude.ai and ChatGPT chat apps cannot connect in version
  one (they require OAuth, and they do not reliably pass connector images to the model
  anyway). Agents are Claude Code and Codex.
- Consequence: nothing is processed automatically on upload. Someone runs an agent
  session and tells it to process the inbox.
- **Request queue:** she leaves requests inside the app (on a course, document or
  block), and the next agent session claims and completes them over MCP. This is how she
  asks for work without running an agent herself.

## Agent orientation

How an agent learns its role and how to use the app (decided 2026-11-15):

- **MCP server instructions**, sent on connect: a short statement of the agent's role and
  the first tool to call. Kept brief, because some clients read only the first few
  hundred characters.
- **Overview tool:** the full conventions, schema, block types and workflow.
- **A plain-text agent guide on the site** (for an agent that arrives by URL): what the
  app is, where the MCP endpoint is, and that it needs an API key from the settings page.
- `robots.txt` disallows all crawlers and pages are marked no-index; the app is private.

## Practice formats

All of these are in scope (decided 2026-11-15): multiple choice, select-all,
calculations, case-based questions, recall (flashcards, fill-in-the-blank), matching.

- Multiple choice, select-all, matching and fill-in-the-blank are graded by the app.
- Calculations are graded numerically, with a tolerance and required units.
- Free-text and case answers cannot be graded by the app (no AI inside it): she
  self-grades against a model answer, or an agent grades them in a later session.
- Attempts and results are stored, so weak areas can be found.

## Flow

1. **Upload** into an inbox. Two routes, same destination:
   - browser file picker (PDF, PPTX, JPEG, PNG, HEIC); no third-party integrations;
   - agent upload: an MCP tool returns short-lived single-use upload links, and the local
     agent sends files to them with a shell command. Batch-capable.
2. **Convert** each file to per-page images in a locked-down throwaway container.
   Originals are kept untouched; native text is extracted alongside where it exists.
3. **Transcribe** (agent): pull each page image, write the transcript back, linked to its
   source page.
4. **Organise and build** (agent): file under course and lecture, record concepts and
   relationships, generate study material.
5. **Review** (her): read against the originals, edit, rearrange.

## Content model

- **Knowledge base:** uploads, page images, transcripts. The record; rarely changes.
- **Study material:** generated documents made of **typed blocks** (callout, highlight,
  drug card, flashcard, multiple choice, fill-in-the-blank, mnemonic, labelled image,
  mind map, table, and more through a block registry).
- **Citations are required.** Every generated block and question cites its sources:
  file, page, the quoted transcript passage, and a page region when known. She taps a
  citation to open the original page with the passage highlighted. The agent layer
  rejects generated content without a citation unless it is explicitly marked as general
  knowledge, which is labelled as not from her notes. Page-level citation and the quoted
  passage are always available; an exact region on a handwritten page is best effort,
  because models locate regions on images imprecisely.
- Each block records who last touched it (agent or user). Regeneration leaves her edits
  alone unless she asks.
- **Structured layer:** typed concepts and relationships (drug, class, mechanism, target,
  indication, adverse effect, interaction) extracted during transcription.

### Library structure (what she sees)

Decided 2026-11-15. A predictable spine of term, course, lecture, with the same sections
in every course.

```
Library
├─ Fall 2026
│  └─ Pharmacology II
│     ├─ Sources        her uploads, grouped by lecture
│     ├─ Lectures       one merged note per lecture (slides + handwriting)
│     ├─ Study guides   by topic
│     ├─ Practice       question sets and flashcards
│     └─ Exams          Exam 2 → covers lectures 5 to 9
├─ Concepts             drugs and classes, across all courses
├─ Inbox
├─ Requests
└─ Trash
```

- Every new course gets the same sections automatically, so agents always know where
  things go.
- Sources stay separate from generated material.
- Each item lives in one place and appears elsewhere as a link. An exam is a view over
  lectures; a concept page gathers mentions from every course. Neither holds copies.
- Lectures are numbered and dated ("07 · Beta blockers · Oct 14") and sort in teaching order.
- She can add, rename and move folders freely. Permanent IDs mean a move never breaks a
  citation or a link.
- Four levels at most. On a phone a course opens to a home screen with its sections.

### Storage on disk

- The folder tree lives in the database, not as real folders. Renames and moves never
  touch a file.
- Uploaded originals are stored once, under a fingerprint of their content, and never
  modified.
- Page images sit beside their original, numbered by page.
- Each user has their own top-level directory.
- Documents, blocks, revisions and citations are database rows. (This replaces the
  earlier idea of notes as markdown files in real folders.)

### Transcription safeguards

- Keep the verbatim reading beside the normalised value; never silently correct.
- Flag uncertain words, and any dose, unit or decimal.
- Check drug names against RxNorm (free lookup, no AI).
- Notes stay marked "unverified" until she reviews them.

## MCP layer

The contract of the product. The web UI and the MCP server sit on one internal interface,
so anything the screen can do, an agent can do.

- Stable IDs for folders, documents, blocks, source pages, concepts, views. Paths are a
  readable alias.
- Every response links to its neighbours (parent, sources, concepts, backlinks).
- One overview tool as the entry point, with the conventions and schema.
- Light listings; full content on request, in ranges.
- Find things three ways: folder tree, text search, concept graph.
- Change feed ("what changed since").
- About a dozen well-described tools, not one per object per action.
- Read-only and read-write keys.
- Rejected writes explain the rule and show a valid example.
- Stateless HTTP; calls kept short; long work through job IDs.

## Front end

- React web app, installable to the home screen. Computer, tablet and phone are all
  first-class layouts; nothing is finished until it works on all three.
- **Two views of one block tree:** linear page view, and a canvas (dotted grid, cards,
  curved labelled connectors, frames, stickers) in the style of AFFiNE's edgeless mode.
- **Canvas:** React Flow, with automatic layout (ELK). Agents state structure, not pixel
  positions; anything she drags stays put. No freehand pen in version one.
- **Editor:** block editor saving structured JSON (Tiptap core or BlockNote core; decide
  after an iPad test).
- **Components:** React Bits, copied in and modified. Keep animation-heavy and WebGL
  components off canvas cards; respect reduced motion.
- **Light and dark mode** from the first line of styling, through colour tokens.
- Full create, rename, move and trash for files and folders, with touch-friendly moves.
- iPad is the workbench (tree, document, side panel); phone is single-pane.

## Accounts and security

- Login-gated. Accounts created by Alex; no sign-up page.
- Brute-force protection in the app: slow password hashing, per-account and per-address
  limits with growing delays.
- Data separated per user from the start. No sharing features.
- Upload links: single use, expire in minutes, capped by size and type.
- Conversion of uploaded files runs sandboxed (no network, resource limits).

## Hosting and data safety

- Docker container on the Mac mini, routed through the existing Caddyfile at
  `notes.hannahporras.app`, HTTPS only (`.app` requires it).
- Container holds no state.
- Live database on a Docker named volume (SQLite on a Docker Desktop bind mount has
  corruption reports; stress-test before trusting any layout).
- Large originals and page images on the external drive, with a marker file so the
  container refuses to start if the drive is not mounted.
- Version history as revisions in the database, not git.
- Delete means trash.
- Backups: database snapshot first, then files; a second local copy on a different disk;
  an encrypted off-machine copy; a restore that has actually been run.

## Open questions

- Where the off-machine backup goes.
- Who runs the agent sessions day to day (Alex at first, or her with Codex or Claude
  Code installed).
- What form her handwritten notes are in today. She does not know about the project
  (it is a surprise), so no real sample is available yet; assume standard pharmacy
  lecture notes and test with stand-in material until one is.
- The locked feature list for version one.

## Risks to test early

- Handwriting transcription accuracy on a real lecture of hers.
- iPad behaviour: canvas gestures, editor keyboard and selection, installed-app storage.
- SQLite on the mini's Docker setup; Docker starting after a power loss.
- PPTX conversion fidelity.
- School policy on putting instructors' slides into AI tools (she should check syllabi).

## Rejected

- Deploying AFFiNE itself: wrong fit for a generate-from-uploads pipeline.
- tldraw: production key is discretionary for hobby use and forces a watermark.
- BlockSuite: unstable, storage format hostile to agents.
- Server-side transcription with a model API key: removed 2026-11-15.
- OAuth connectors for chat apps: out of version one.
- Imports from Google Docs, GoodNotes and similar: upload only.
