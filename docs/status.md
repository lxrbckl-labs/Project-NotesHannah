# Status

As of 2026-11-16, after the design pass and the first deployment. Feature IDs refer to [features.md](features.md).

## Live on published images (2026-11-24 17:05 CST); Watchtower not running

The mini switched to lxrbckl/notes-app:main and lxrbckl/notes-converter:main (built from b487932) after a
verified full backup; the local images are kept as :local-f835ee2 and the old env as
deploy/.env.bak-local-images-20261124. The mini's Watchtower container has been stopped since 2026-11-07,
so a publish does not roll out by itself yet: Alex decides how it comes back (it watches all 28 containers
on the mini). Until then: docker pull both :main tags and scripts/up.sh on the mini.

On main after that build, not yet published: a folder's item count includes its source files
(`fileCount` on a node), canvas frames and connector labels are solid.

## File page bar, folding cards, viewer arrows (2026-11-24, on main, not deployed)

Tried in the local copy first. Gate passes and the mock end-to-end suite is green (424 passed). Details in
features.md, section V. Open: the guide's screenshots still show the old header and file page.

## Publishing by image (2026-11-24, in progress)

The repository was made public on Alex's word (12:13 CST) so the org's Docker Hub secrets reach it. The
first `publish` run built both images but the push was refused (401): the org's new token can log in but
not write. Waiting on a Read & Write token; then rerun, confirm the images, and have the mini switch.

## Snapshot before a migration (2026-11-24, on main, not deployed)

First step toward rolling out by published image (Watchtower) instead of `update.sh`: the app copies the
database to `backups/pre-migration/` before applying migrations to a database that holds data, and refuses
to start if it cannot. See deploy.md, "Rolling out a change". Still open for that move: a first `publish`
run, the one-time image switch on the mini, and a working scheduled backup of the uploaded files.
The top bar work below went live at f835ee2 on 2026-11-24 11:43 CST.

## Top bar, open tabs, home page, full screen (2026-11-24, on main; deploy asked for by Alex 11:27 CST)

Tried in the local copy first, at Alex's request, then committed on his word. Gate passes; the mock
end-to-end suite passes except `e2e/files.spec.ts:231`, which fails about 1 run in 24 on the code before
this work too (a right-click lands while the tree is redrawing). Details in features.md, section U.

## Database backups from a sidecar container (2026-11-23, merged; running on the mini)

- The host's 5-minute snapshot job (`app.notes.snapshot`) had failed on every run for a week: macOS privacy rules
  stop a launchd job from the external drives, so no second copy and no status were written. The mini disabled it
  (the plist is still there; `scripts/install-launchd.sh` may register it again).
- Replaced by the `backup` service in `deploy/docker-compose.yml` (`deploy/tools/backup-loop.mjs`): a verified
  snapshot, a checksummed second copy on the second drive, the retention ladder, and a heartbeat its healthcheck
  reads. `BACKUP_INTERVAL_SECONDS` defaults to 300; the mini's `deploy/.env` sets 86400 (once a day, Alex's word).
  `docs/backups.md`, "The sidecar".
- Still blocked by the same macOS rule: the nightly restic backup of the file tree (`app.notes.backup`) and
  `restic-check`. Uploaded files have no working scheduled backup until that is solved.
- Not run on the MacBook; the mini reports the first snapshot verified on both drives.

## Live site reset for Hannah (2026-11-22 17:17 CST)

- Live at `ba8a263`: every change of 2026-11-22, including the Command go-to keys (`⌘L`, `⌘C`; they replace the
  G pairs), plain shortcut badges, the Tab bar card text, the tour's Skip button, and the Library home without its
  Concepts and References buttons (Settings has a Concepts row for phones).
- Clean sweep on the mini, Alex's word: the live database and file storage were set aside, not deleted, and the app
  started on an empty database with one account, `hannahporras` (generated password, shown once on the mini).
  Before: users alex, demo, pharmacy; 15 documents, 9 requests, 3 API keys. Kept copy:
  `/Volumes/NVME1/notes-pre-clean-20261122/` (database and storage), a labelled `pre-clean` backup snapshot, and
  the old database inside the volume at `/db/pre-clean-20261122/`. Old agent API keys no longer work.
- Fixed 2026-11-23 (live since 17:52 CST at 9cab27d): `admin init-storage` on a directory that already has the `.notes-storage`
  marker now makes any missing top-level folder again and names them; the marker is left alone. Before, the
  converter could not start after the sweep until the folders were made by hand.
- Open: `e2e/files.spec.ts:231` (right-click, Back to inbox) fails on the mini on the computer and tablet
  projects and passes on the MacBook; cause unknown.

## Keyboard shortcuts (2026-11-22, pushed as 7aa1897, live since 2026-11-22 15:04 CST at 6cc7ad2)

- One registry (`apps/web/src/features/hotkeys/registry.ts`) drives the keys, the badges, the "?" overlay and
  the guide's "Keyboard shortcuts" section. Computer layout only; destructive actions have no key.
- Setting `shortcutBadges` (default on) hides the badges; the keys keep working.
- Checked by hand at 1440x900: sidebar, go-to keys, source zoom, fit and full screen, the overlay, the
  badge switch. Lint and typecheck pass; the hotkey unit tests and the touched screens' tests pass one file at a time.
- Not verified: `e2e/built/hotkeys.spec.ts` and the e2e suites were not run; the guide PDF is not regenerated
  (`pnpm guide:pdf`); practice keys, tablet layout and a Windows keyboard were not tried.

## Instructions, tour, agent parity, icon map (2026-11-22, pushed as f9f3e9c, live since 2026-11-22 15:04 CST at 6cc7ad2)

- Saved instructions for agent requests (Settings and the request dialog; migration `0720_request_instructions`).
- Guided tour: ten stops, starts on first sign-in, restartable from the guide.
- Source pages: own full-window mode; the file page header is a title row, a facts line and a toolbar.
- Library home: Recently Opened and Favorites fold by an arrow.
- One icon per concept and one tile color rule (see design.md, "Icons and tiles").
- Agent layer: calendar, saved instructions (read), file rename, document and transcript revisions (see mcp.md, "Parity with the app").
- Checks on 2026-11-22: lint, typecheck, schema 800, converter 117, server 913 pass. Web unit tests 690 of 694 in a full
  run on an overloaded MacBook; the canvas board tests timed out on a different test each run and no canvas code changed.
  The end-to-end suites were not run on this state: run them before deploying.

## Calendar and shell changes (2026-11-17, local only until Alex says to commit)

- Calendar: a new page at `/calendar`, in the sidebar and as a sixth phone tab (`TAB_IDS` in
  `packages/schema/src/preferences.ts`). It shows exams on their dates and, for each day, what she
  studied: practice answers (count, correct, minutes, lectures) and notes she wrote in herself. The
  server route is `GET /api/calendar?from&to&utcOffsetMinutes` (`apps/server/src/domains/calendar`,
  read-only, no new table). Web: `apps/web/src/features/calendar`. Not built: lecture dates,
  reminders, planned study days.
- Header: the search fills the header; every control is one size with 8px all round; each sidebar's
  toggle sits in that sidebar's header while open and in the top bar while closed; both sidebars
  slide (`app/SideSlide.tsx`).
- Concept graph: same library (React Flow), new cards, curved coloured links, zoom buttons, drag.
- Guide page: links glide to their section; the contents marker slides.
- More pill art in page headers; the spinner is a capsule; a dedication line under Sign out.
- Colours: LucidIndex's neutrals with KU blue (`#0051ba`) as the accent replace the mint and
  teal theme; the pill art stays. See `docs/design.md`, Direction.
- Every sidebar can be dragged wider or narrower from its inner edge (`app/SideResize.tsx` for the
  app's sidebar and details panel; the document sidebars already could), remembered per browser;
  double-click the edge for the usual width. Document sidebars slide and their panels fold with an
  ease.
- The heart beside Sign out opens Alex's handwritten note to Hannah with a letter-opening animation
  (`features/letter`).
- Pages slide: forward when something is opened, back on a back arrow (`.nav-back`) or the
  browser's Back (`app/usePageSlide.ts`); only `#main` moves.
- Background: Settings has a Background card; her own picture replaces the dotted grid behind the
  pages, under a veil in the page colour. One per account, in the new table `user_backgrounds`
  (migration `0910_user_backgrounds.sql`), served at `/api/me/background`. The app shrinks any
  picture to 2560px on its longer side before sending; the server keeps at most 8 MB.
- Recently Opened shows six.
- Later the same day: American spelling in everything she sees; Warm Tooltip on every icon-only
  button; Read / Edit switch with a read-only Read mode (arrow cursor, no selection); panel heights
  drag; drag and drop for uploads and for moving things in and out of folders; folders any depth;
  side-note form with a dashed edge and five colors. See `docs/features.md` section R.
- Fixed the same day, both from the sliding sidebars: a long library tree made the sidebar taller
  than the window and the app could be pushed off its own top (`.side-slide` now has one row capped
  at its place's height; built test "the app is never taller than the window"); a sidebar sliding in
  widened the page by 24px (`overflow-x-clip` on the dock row).
- Suites at 21:25 on 2026-11-17, MacBook under heavy load: gate passed; mock 404 passed; built 81
  of 82 in the full run, the one failure (practice tabs at 320 wide) passing alone; real-server
  journeys 27 of 27 after the last fixes, the whole real suite not rerun since.
- 2026-11-19: guide figures retaken and the PDF regenerated (43 pages) from a fresh seeded instance.
  The demo slides are rebuilt in American spelling (`fixtures/demo/generator/build.sh`), so the
  slides, their transcripts and the seeded notes agree; the seeder quotes the slides word for word,
  so the two must change together. `tools/guide-figures.mjs` needs the side-note and reference
  seeders run as well as `local:seed:pharm`.
- Suites on 2026-11-19, quiet machine: gate passed; built 82 of 82; real-server 82 passed and the one
  failure (a test that looked only at the newest 20 files) fixed and passing; mock last run
  2026-11-17, 404 passed.

## Pharmacy theme (2026-11-17)

Hannah asked for a more pharmaceutical look. The base colours are now cool mint whites with a
pharmacy-green accent (light and dark, contrast test passing), and there is pill art on the sign-in
page, the app's mark, the library title, roomy empty states and the tab icon. See `docs/design.md`,
Direction. Still owed: the guide's figures and PDF show the old colours until `pnpm guide:figures`
and `pnpm guide:pdf` are run again. `pnpm local` takes `NOTES_WEB_HOST=0.0.0.0` (with
`NOTES_APP_ORIGIN`) to serve the local copy to the home network.

## Where it stands

The app is built and runs locally end to end on the real server with the real file
converter (`pnpm local`, then <http://localhost:5273>). It is **deployed on the mini** at
<https://notes.hannahporras.app> since 2026-11-16 (commit `6cdd4fe`, port 8060; details in
[mini-handoff.md](mini-handoff.md)). Three accounts there: `alex` (empty), `demo` (the small sample) and `pharmacy`
(the pharmacy demo set, `pnpm local:seed:pharm`). **The live build is still `6cdd4fe`**: later changes reach it
only through a rollout (see [deploy.md](deploy.md), "Rolling out a change"), and the Docker Hub login the
workflow uses is rejected until the org's `DOCKERHUB_TOKEN` is renewed. **Its scheduled backups do not work yet** (see Known gaps). It has **not** been used on a real iPad or phone, and has **not** seen any of
her real lecture material. Nothing has been through a pull request; work was merged
locally and pushed to `main` at checkpoints.

Local gate (`pnpm gate`): lint, type checks, 2,464 unit and integration tests (one skipped: BMP conversion needs netpbm, which only the converter image has), build.
Browser tests run separately at phone, tablet and computer sizes, in three suites: against a mock,
against the real server, and against the built app as it is deployed (`pnpm e2e:built`). `pnpm gate:full`
runs the gate and all three; `pnpm smoke <address>` checks a live site after a redeploy. The long-failing
canvas drag test was a fault in the test (it dragged between points off screen) and passes since 2026-11-16.
On Beta blockers in the demo set, the "Which one" and "Safety" frames overlap each other because of pinned cards.

## Built

| Area | Features | Notes |
|---|---|---|
| Accounts | A1 to A6 | No sign-up page; accounts by admin command. Lockout with a trusted-device bypass. |
| Upload and inbox | B1 to B7 | Type detected from content. Converter is a locked-down container with no network. Takes PDF, PowerPoint (.pptx, .ppt), Word (.docx, .doc), OpenDocument (.odp, .odt) and JPEG, PNG, HEIC, WebP, GIF, TIFF, AVIF, BMP images; SVG and spreadsheets are refused. A multi-page TIFF is one page per image; an animated image keeps its first frame and the file details say so. |
| Library | C1 to C6, C8 | The library home is the whole tree on one page, with her files as leaves. |
| Documents and blocks | D1 to D13 | 16 block types, editor (Tiptap), outline, revision history. Typing shortcuts at the start of a paragraph (`# `, `- `, `1. `, `[] `, `> `, `!! `, `?? `, `---`). A lecture page lists the notes she started under it, and a new document opens ready to type. A formatting ribbon (style menu, marks, colours, lists, insert, shortcut help) shows whenever she edits, from tablet width up; on a phone the same tools sit above the keyboard. Wide tables scroll sideways. No font, size or alignment: the schema has no fields for them. |
| Sidebars and side notes | P1 to P8 | Her private notes in a document's margin, level with their blocks, stored apart from the blocks (they never change the document, its review state or history), detached rather than lost when a block goes ([side-notes.md](side-notes.md)). Two sidebars around the page with Outline, Resources (the sources of the part she is reading) and Side notes panels she drags between them, remembered per kind of screen; a bottom sheet with tabs on a phone. Agents read them (`side_notes`, 19 tools); search finds them. Not on the canvas, not copied with a document. |
| References | O | Outside references tied to what she studies ([references.md](references.md)): PharmGuides built in as a trusted reference (search, section links), her own saved references linked to courses and lectures, a reference chip on blocks apart from the slide chips, agents told to check trusted references and label what comes from them (MCP tool `references`, 18 tools). The app links out and stores no outside content; "keep a copy" is not built. |
| Preferences | I6 | Her own order for the phone's tab bar, kept per account on the server (`user_preferences`, `GET` and `PATCH /api/me/preferences`) and mirrored in the browser so the bar draws in her order on the first frame. A draggable copy of the bar in Settings; changes apply on Save. A tab added later lands at the end for a saved order that predates it. |
| Guide | N | `/help` in the app (sidebar and Settings), written for her, with a PDF download (`pnpm guide:pdf` regenerates it). `/help/print` renders without signing in. |
| Citations | K1 to K7 | Tap a source chip to see the page with the passage highlighted. |
| Canvas | E1 to E6 | React Flow, automatic layout in the browser, her pins survive agent changes. |
| Concepts | F1 to F5 | F4 (drug-name check against RxNorm) is built and **off by default**. |
| Practice | G1 to G9, G11, G12 | Graded on the server; the answer key never reaches the device before she answers. |
| Requests | L1 to L5 | Composer available from library items, documents, blocks, source pages, practice and concepts. |
| Exam planner | M1 to M4 | |
| Agent layer (MCP) | H1 to H11 | 19 tools, API-key login, tested with live Claude Code and Codex sessions. |
| Appearance | I1, I2, I4 | Light and dark; phone, tablet and computer layouts. One design system ([design.md](design.md)): ten named colours, roles, scales and shared components; reference page at `/design`. Each course has its own colour. React Bits ([react-bits.md](react-bits.md)): ten components, gallery at `/design/bits`, four placed in the app. |
| Operations | J1 to J6 scripts | Compose stack, backups, restore drill, admin commands. Running on the mini; restore test passed there in 110 s. |

## Not built, or built differently

- **I3 installable app:** not started.
- **J6 full data export for her:** backups exist; a self-service export download does not.
- **G10 timed exam mode, E7 freehand pen, C7 tags, D14 flowchart block, I5 offline reading, A7 passkeys:** deferred, as planned.
- **Notes as markdown files:** replaced by typed blocks in a database (see architecture.md).
- **Course colours** are picked from the course's id. She cannot choose one yet; that needs a
  colour field on library items (server and agent layer).

## Known gaps and rough edges

- **Scheduled backups on the mini fail**: the 5-minute snapshot and the nightly backup cannot read the external drives until Alex grants `/bin/bash` access to removable volumes at the mini's keyboard. A manual `scripts/backup.sh` works. Failed runs leave unverified snapshot files behind.
- No way to build a cumulative study guide from several lectures: a block cannot be reused in another document, and nothing assembles one from an exam's coverage.
- The guide's Figure 1 (library home) still shows the greeting card that was removed on 2026-11-16; retake the figures with `pnpm guide:figures` and regenerate the PDF.
- Concepts cannot be filtered by course (the server does not record a concept's course).
- The "to review" count in the navigation covers unverified concepts only, not unverified blocks in documents (the server has no listing for those).
- Dragging a card out of a frame pins it outside the frame.
- Side notes: canvas cards show no note markers, a duplicated document starts without its side notes, and on a phone tapping Undo after deleting a note also closes the panels sheet (the note does come back).
- The local copy's sample canvas frames have no colour until it is reseeded (`pnpm local:reset`, then `pnpm local:seed`).
- Skipped practice questions, missed-question reasons and reply links were added late and have less test depth than the rest.
- The sample data's transcripts are placeholder text and do not match the sample slides.
- The "React Flow" mark on the canvas is the library's attribution; its documentation asks for a paid subscription to remove it, so it stays.

## Not verified

- **Anything on a real iPad or iPhone:** touch gestures on the canvas, the on-screen keyboard in the editor and practice player, installed-app behaviour.
- **The React Bits animations playing.** They were checked only in a browser pane that draws no animation frames; the greeting and stat numbers fall back to plain text there. Not seen in a normal window.
- **Every screen at every size in both themes by eye.** A sample was looked at on the real server; the rest rests on the browser tests.
- **The new upload formats on a real device and with her real files:** WebP, GIF, TIFF, AVIF, BMP, Word and the old Office formats were tested with generated files only (in the converter image and in a browser against the real server), not from an iPad or phone picker, and not with scanner or camera output.
- **Handwriting transcription accuracy** on real notes. One stand-in page showed a small model misreading `q8h` as `qsh`.
- **The mini:** scheduled backup jobs (failing, see Known gaps), Docker starting after a power loss (reboot test not run), live canvas updates through the proxy, signing in and uploading on the live site.
- **Remote backups:** only a local backup repository was tested.
- **A pinned-card refusal in a live agent run** (covered by tests only).

## Waiting on Alex

- Renewing the org secret `DOCKERHUB_TOKEN`, then his word for the first `publish` commit.
- At the mini's keyboard: the removable-volumes grant for `/bin/bash`, then the reboot test.
- A remote backup location; where the backup password is kept. (Drive paths are set: data on NVME1, backup copies on NVME2.)
- Changing the `alex` password, which was relayed through chat.
- Automatic login on the mini, so the app returns unattended after a power cut.
- Whether to turn on the RxNorm drug-name check.
- Whether macro-enabled decks (`.pptm`) should be accepted (they are, with a warning).
- Locking [features.md](features.md); it is still marked draft.
- A real lecture sample and a real iPad, when the surprise allows.
- The design direction (warm paper, dotted grid, green brand, ten-colour palette) was chosen without his sign-off; change it in `docs/design.md` and `apps/web/src/app/styles.css`.
- Whether she should be able to choose a course's colour.
