# Work plan

Written 2026-11-15. How the build is split so that independent pieces can run in parallel
and nothing is built on an untested assumption. Feature IDs refer to
[features.md](features.md); the design is in [architecture.md](architecture.md).

## Principles

- **The shared schema comes first.** Every other piece depends on the object and block
  definitions, so they are written and agreed before parallel work starts.
- **Test the risky assumptions before building on them** (stage 0).
- **Each work package ends in something that can be checked:** a passing test, a working
  screen, or an agent session that completes a task against the running app.
- **One writer per area.** Packages are cut along folder lines (`apps/web`,
  `apps/server`, `apps/converter`, `packages/schema`) so parallel workers do not collide.
- **Every package lands through a pull request** with tests, reviewed before merge.

## Stage 0: decisions and spikes

Small throwaway experiments. Each answers one question from [risks.md](risks.md).

| ID | Question | Done when |
|---|---|---|
| S1 | Does key-authenticated MCP work from Claude Code and Codex, including returning a page image? | A hello-world server answers both agents, and each can describe a test image |
| S2 | Tiptap or BlockNote on a real iPad? | Both tried with one custom block; one chosen and recorded in tech-stack.md |
| S3 | Does React Flow with ELK feel right on an iPad with 100 or more cards? | Prototype pans and zooms smoothly; layout of nested frames works |
| S4 | Is SQLite safe on the mini's Docker setup? | Concurrent-write stress test and integrity check pass on a named volume |
| S5 | Does the conversion container handle a real deck? | A PPTX, a PDF and a HEIC photo each become page images, with text and speaker notes extracted |
| S6 | How well does handwriting transcribe? | A stand-in handwritten page is transcribed and the error rate noted; repeated on a real page when one exists |

Decisions needed from Alex in this stage: the feature list locked, where the off-machine
backup goes, and whether the mini is ready to host.

## Stage 1: foundation

Goal: an agent can upload files, transcribe pages and file the results; a person can log
in and browse them.

| ID | Package | Area | Features | Depends on |
|---|---|---|---|---|
| W1 | Repository scaffold: workspace, lint, test runner, container build, CI config (manual trigger only) | root | J1 | none |
| W2 | Schema: IDs, users, tree, files, pages, transcripts, API keys | packages/schema | A6 | W1 |
| W3 | Database, migrations, storage layout with the missing-drive guard | apps/server | J2 | W2 |
| W4 | Accounts: login, sessions, brute-force limits, password change, admin commands | apps/server | A1 to A4, J5 | W3 |
| W5 | API keys: create, scope, revoke, last used | apps/server | A5 | W4 |
| W6 | Upload: file picker endpoint, upload links, inbox states, limits, retry | apps/server | B1 to B3, B6, B7 | W3 |
| W7 | Converter: sandboxed worker, page images, native text, job table | apps/converter | B4, B5 | W2 |
| W8 | Library API: tree operations, trash, search | apps/server | C1, C2, C4 | W3 |
| W9 | MCP server: instructions, overview, traversal, search, page images, writes, upload links, inbox workflow | apps/server | H1 to H8 | W5, W6, W8 |
| W10 | Web shell: login, layout for iPad and phone, light and dark tokens, tree, inbox, source viewer | apps/web | C3, C5, C6, I1, I2 | W2 (API can be mocked until W4 to W8 land) |

Parallel lanes once W2 is merged: **server** (W3 then W4, W5, W6, W8, W9), **converter**
(W7), **web** (W10).

Stage check: from a Claude Code session with only an API key, upload a deck, transcribe
it, file it under a course, and see it in the browser on an iPad.

## Stage 2: documents

| ID | Package | Area | Features | Depends on |
|---|---|---|---|---|
| W11 | Block schema and registry: every block type, validation, edit ownership | packages/schema | D2 to D11 | stage 1 |
| W12 | Document storage, revisions, change feed, activity log | apps/server | D12, H9, H10 | W11 |
| W13 | Page view and editor with the basic blocks, outline, source chips, review markers | apps/web | D1, D2, D3, D9, D10, D13 | W11 |
| W14 | Study blocks: drug card, comparison table, mnemonic, labelled image, mind map | apps/web | D4 to D8 | W13 |
| W15 | MCP document and block tools, with helpful validation errors | apps/server | H6 | W12 |

Stage check: an agent turns one transcribed lecture into a study guide; she edits a block;
the agent regenerates the guide and her edit survives.

## Stage 3: practice

| ID | Package | Area | Features | Depends on |
|---|---|---|---|---|
| W16 | Question schema and grading rules, including numeric tolerance and units | packages/schema | G1, G3 | W11 |
| W17 | Sessions, attempts, results, weak areas; readable over MCP | apps/server | G2, G5, G6, G8 | W16 |
| W18 | Question blocks, session player, results and weak-area screens, flashcard deck | apps/web | G1 to G7 | W16 |

Stage check: an agent builds a mixed quiz from a lecture; she takes it on a phone; the
agent reads the results and builds a follow-up on the weak areas.

## Stage 4: canvas and concepts

| ID | Package | Area | Features | Depends on |
|---|---|---|---|---|
| W19 | Concept schema, storage, drug-name check, cross-course filter | schema, server | F1, F4, F5 | W11 |
| W20 | Canvas structure in the schema, automatic layout, MCP tools for cards, connectors and frames | schema, server | E2 | W11 |
| W21 | Canvas view: cards, connectors, frames, hand editing, stickers, step-through, gestures | apps/web | E1, E3 to E6 | W20 |
| W22 | Concept pages and graph view | apps/web | F2, F3 | W19 |

## Stage 5: before she gets it

| ID | Package | Features | Depends on |
|---|---|---|---|
| W23 | Backups, off-machine copy, and a restore that has been run | J3 | stage 1 |
| W24 | Deployment on the mini, Caddy route, health check, logs, reboot test | J1, J4 | stage 1 |
| W25 | Installable app, React Bits pass, reduced motion, agent guide, robots file | I3, I4, H11 | stages 2 to 4 |
| W26 | Full data export | J6 | stage 2 |
| W27 | Real-device pass on her kinds of devices, and a full run on real lecture material | all | everything |

W23 and W24 can start as soon as stage 1 is done, so the app runs on the mini with
backups long before it is finished.

## How the work is run

- Stage 0 spikes are independent and run in parallel.
- Within a stage, each lane is one worker in its own worktree; the main session reviews
  every diff, runs the tests, and lands it.
- Model weight per package: schema and MCP design are judgment-heavy and get the strongest
  model; mechanical packages (scaffold, CRUD endpoints, admin commands) get a lighter one.
- Tests run locally. CI workflows are manual-trigger only and run only on Alex's word.
- Merges happen on Alex's word.

## Waiting on Alex

- Lock [features.md](features.md).
- DNS record for `notes.hannahporras.app`.
- Whether the mini is healthy enough to host; if not, where stage 0 and stage 1 run.
- Off-machine backup location.
- A handwritten sample page (stand-in now, real one later).
- An iPad for the device tests in S2 and S3.
