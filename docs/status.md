# Status

As of 2026-11-16, after the design pass. Feature IDs refer to [features.md](features.md).

## Where it stands

The app is built and runs locally end to end on the real server with the real file
converter (`pnpm local`, then <http://localhost:5273>). It has **not** been deployed to
the mini, has **not** been used on a real iPad or phone, and has **not** seen any of
her real lecture material. Nothing has been through a pull request; work was merged
locally and pushed to `main` at checkpoints.

Local gate (`pnpm gate`): lint, type checks, 2,273 unit and integration tests, build.
Browser tests run separately at phone, tablet and computer sizes: 450 against a mock and
81 against the real server. One fails, and failed before the design pass: dragging a card
into a frame on the canvas at tablet and computer sizes (see Known gaps).

## Built

| Area | Features | Notes |
|---|---|---|
| Accounts | A1 to A6 | No sign-up page; accounts by admin command. Lockout with a trusted-device bypass. |
| Upload and inbox | B1 to B7 | Type detected from content. Converter is a locked-down container with no network. |
| Library | C1 to C6, C8 | The library home is the whole tree on one page, with her files as leaves. |
| Documents and blocks | D1 to D13 | 16 block types, editor (Tiptap), outline, revision history. |
| Citations | K1 to K7 | Tap a source chip to see the page with the passage highlighted. |
| Canvas | E1 to E6 | React Flow, automatic layout in the browser, her pins survive agent changes. |
| Concepts | F1 to F5 | F4 (drug-name check against RxNorm) is built and **off by default**. |
| Practice | G1 to G9, G11, G12 | Graded on the server; the answer key never reaches the device before she answers. |
| Requests | L1 to L5 | Composer available from library items, documents, blocks, source pages, practice and concepts. |
| Exam planner | M1 to M4 | |
| Agent layer (MCP) | H1 to H11 | 17 tools, API-key login, tested with live Claude Code and Codex sessions. |
| Appearance | I1, I2, I4 | Light and dark; phone, tablet and computer layouts. One design system ([design.md](design.md)): ten named colours, roles, scales and shared components; reference page at `/design`. Each course has its own colour. React Bits ([react-bits.md](react-bits.md)): ten components, gallery at `/design/bits`, four placed in the app. |
| Operations | J1 to J6 scripts | Compose stack, backups, restore drill, admin commands. Not yet run on the mini. |

## Not built, or built differently

- **I3 installable app:** not started.
- **J6 full data export for her:** backups exist; a self-service export download does not.
- **G10 timed exam mode, E7 freehand pen, C7 tags, D14 flowchart block, I5 offline reading, A7 passkeys:** deferred, as planned.
- **Notes as markdown files:** replaced by typed blocks in a database (see architecture.md).
- **Course colours** are picked from the course's id. She cannot choose one yet; that needs a
  colour field on library items (server and agent layer).

## Known gaps and rough edges

- Concepts cannot be filtered by course (the server does not record a concept's course).
- The "to review" count in the navigation covers unverified concepts only, not unverified blocks in documents (the server has no listing for those).
- **Dragging a card into a frame fails in the browser test at tablet and computer sizes** (it passes at phone size). Not yet investigated: it may be the gesture or the test.
- Dragging a card out of a frame pins it outside the frame.
- At tablet width the Practice tab bar is cut off at the right edge.
- On a phone the "Practise this" button on a document wraps onto its own row.
- The local copy's sample canvas frames have no colour until it is reseeded (`pnpm local:reset`, then `pnpm local:seed`).
- Skipped practice questions, missed-question reasons and reply links were added late and have less test depth than the rest.
- The sample data's transcripts are placeholder text and do not match the sample slides.
- The "React Flow" mark on the canvas is the library's attribution; its documentation asks for a paid subscription to remove it, so it stays.

## Not verified

- **Anything on a real iPad or iPhone:** touch gestures on the canvas, the on-screen keyboard in the editor and practice player, installed-app behaviour.
- **The React Bits animations playing.** They were checked only in a browser pane that draws no animation frames; the greeting and stat numbers fall back to plain text there. Not seen in a normal window.
- **Every screen at every size in both themes by eye.** A sample was looked at on the real server; the rest rests on the browser tests.
- **Handwriting transcription accuracy** on real notes. One stand-in page showed a small model misreading `q8h` as `qsh`.
- **The mini:** scheduled backup jobs, Docker starting after a power loss, the Caddy route, live canvas updates through the proxy.
- **Remote backups:** only a local backup repository was tested.
- **A pinned-card refusal in a live agent run** (covered by tests only).

## Waiting on Alex

- The Caddy route on the mini (task 1 in [mini-handoff.md](mini-handoff.md)); deployment (task 2) waits on his go.
- Drive paths for data and backups; a remote backup location; where the backup password is kept.
- Automatic login on the mini, so the app returns unattended after a power cut.
- Whether to turn on the RxNorm drug-name check.
- Whether macro-enabled decks (`.pptm`) should be accepted (they are, with a warning).
- Locking [features.md](features.md); it is still marked draft.
- A real lecture sample and a real iPad, when the surprise allows.
- The design direction (warm paper, dotted grid, green brand, ten-colour palette) was chosen without his sign-off; change it in `docs/design.md` and `apps/web/src/app/styles.css`.
- Whether she should be able to choose a course's colour.
