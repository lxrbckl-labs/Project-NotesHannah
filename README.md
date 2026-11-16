# Project-NotesHannah

A private web app that builds study material for a pharmacy student from her own lecture
slides and handwritten notes. She uploads files; an agent (Claude Code or Codex) working
through the app's MCP layer transcribes them, organises them, and generates study guides
and practice questions that reference their sources. She can then edit anything.

**Status (2026-11-15):** built and running locally; not deployed, not yet tried on a real iPad or with real lecture material. See [docs/status.md](docs/status.md).

Served at `notes.hannahporras.app`, from a Docker container on the Mac mini behind Caddy.

## Documentation

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | What the app is, the decisions made and why, the flow, the content model, the MCP layer, hosting and data safety, open questions |
| [docs/features.md](docs/features.md) | The version-one feature list, with an ID per line, and the proposed build order (draft, not locked) |
| [docs/tech-stack.md](docs/tech-stack.md) | The chosen libraries and tools, the reasons, and the choices still open |
| [docs/status.md](docs/status.md) | What is built, what is not, what is unverified, and what waits on Alex |
| [docs/plan.md](docs/plan.md) | The work plan: spikes, stages, work packages with dependencies, and what waits on Alex |
| [docs/risks.md](docs/risks.md) | Research findings from 2026-11-15: what could go wrong, with sources, and what has not been verified |

## The decisions in one place

- **No AI inside the app.** It stores, structures and displays. It holds no model key.
- **Agents work from outside** through the MCP layer, signed in with an app-issued API key.
- **Upload only.** No integrations with note-taking or document apps.
- **One block tree, two views:** a linear page and a canvas.
- **Login-gated, per-user data, no sharing.** Accounts are created by the admin.
- **Her data must not be lost:** originals kept, revision history, trash, backups with a tested restore.

## Development

Requires Node 25 and pnpm 10 (see `.nvmrc`).

### Quick start: run everything locally

```sh
pnpm install
pnpm local          # prepares ./data/local, creates a first user, starts the converter, the server and the web app
```

One command, no mock. On the first run it:

1. builds the shared schema and marks `data/local/storage` as the storage drive (`init-storage`);
2. creates the user `hannah` if there is none and **prints the password once** (it is also kept in
   `data/local/credentials.json`, which is git-ignored, so the seed script and tests can sign in);
3. builds and starts the conversion worker with its lockdown flags
   (`deploy/docker-compose.converter.yml`: no network, read-only root, non-root, dropped
   capabilities) against the same data directory. If Docker is not running it says so and carries
   on: uploads are stored and wait in "Converting" until you start Docker and run `pnpm local` again;
4. starts the server on `:3210` and the web dev server on `:5273` (strict port; chosen so they do not collide with other dev servers on 3000 and 5173), with `APP_ORIGIN`
   and the Vite proxy agreeing, so sign-in works. Open <http://localhost:5273>.

Ctrl-C stops the server, the web app and the converter container. `NOTES_LOCAL_SEED=1 pnpm local` seeds once it is up.

```sh
pnpm local:seed     # a small library, the fixture files, and (needs the converter) a cited study guide, four questions, an exam, a small concept set with relations, one waiting and one answered request, and a canvas with frames and labelled connectors
pnpm local:reset    # wipes ./data/local after you type "reset": database, uploads and users
```

`local:seed` needs `pnpm local` running (in another terminal); it does nothing if the library already
has terms. Variables: `NOTES_LOCAL_DIR` (data directory), `NOTES_SERVER_PORT`, `NOTES_WEB_PORT`,
`NOTES_CONVERTER=0` (skip the container), `NOTES_LOCAL_USER`, `NOTES_LOCAL_PASSWORD`. Two runs with
different `NOTES_LOCAL_DIR` get their own converter container.

The web app without a server, for UI work and the unit tests, is the mock: `VITE_MOCK_API=1 pnpm --filter
@notes/web dev` (in-memory library, simulated uploads and conversion; sign in as `hannah` /
`study-notes-2026`). A normal build refuses to include it.

### Manual dev mode

```sh
cp .env.example .env     # defaults: server :3000, web :5173, APP_ORIGIN=http://localhost:5173
pnpm --filter @notes/server admin init-storage --create-dir   # once: marks DATA_DIR as the storage drive
pnpm --filter @notes/server admin create-user hannah --generate   # once: prints a password, once
pnpm dev                 # server on :3000, web on :5173 (proxies /api and /mcp to the server)
```

The server refuses to start without the storage marker (`init-storage`) and refuses
state-changing browser requests whose `Origin` is not `APP_ORIGIN`, so keep `APP_ORIGIN` equal to
the address in the browser's address bar. Relative paths in `.env` (`DATA_DIR`, `DB_PATH`) are
relative to `apps/server`, where the commands run; the data lands in `apps/server/data/`
(git-ignored). Uploaded files wait in `converting` until the converter worker is running.

```sh
pnpm test               # unit tests in every package
pnpm gate               # lint + typecheck + test + build: run before every commit
pnpm format             # apply Biome formatting and safe fixes
pnpm exec playwright install chromium   # once, for the end-to-end layout check
pnpm e2e                # Playwright: the mock suite, then the same journeys against the real server
                        # (E2E_PORT / E2E_REAL_* variables: see apps/web/playwright.real.config.ts)
# Screenshots go to apps/web/screenshots-out/ (git-ignored). The committed set in apps/web/screenshots/
# (16 states, three sizes, both themes, JPEG) is refreshed on purpose:
#   SHOTS=curated pnpm --filter @notes/web exec playwright test -c playwright.real.config.ts screenshots
```

Layout: `apps/web` (React, Vite, Tailwind 4), `apps/server` (Hono: API, MCP endpoint, static
files), `apps/converter` (file conversion worker), `packages/schema` (shared Zod schema),
`deploy/` (Dockerfile and compose file), `fixtures/` (test material).

### Quick start, Docker

The image runs in production mode: it needs `APP_ORIGIN`, a data directory that holds the
storage marker, and a user. The database lives on a named volume (`notes-db`), the data
directory is a bind mount. From the repository root:

```sh
docker build -f deploy/Dockerfile -t notes-app .

export APP_ORIGIN=http://localhost:3000     # the address you will open in the browser
export DATA_DIR="$PWD/data/storage"         # absolute: Compose resolves relative paths against deploy/
mkdir -p "$DATA_DIR"

# once, in one-off containers (the server will not start before the first one)
docker compose -f deploy/docker-compose.yml run --rm app node dist/cli/admin.js init-storage
docker compose -f deploy/docker-compose.yml run --rm app node dist/cli/admin.js create-user hannah --generate

docker compose -f deploy/docker-compose.yml up -d
curl localhost:3000/healthz                 # {"ok":true,"version":"0.0.0"}
```

Set `PORT` too if 3000 is taken (and put the same port in `APP_ORIGIN`). `docker run notes-app`
on its own stops at once with `APP_ORIGIN: Required in production`. In production mode the
session cookie is `Secure`, so sign in from a browser that accepts it over `http://localhost`
(Chrome and Firefox) or put https in front, as Caddy does on the Mac mini. `docker compose -f
deploy/docker-compose.yml down -v` removes the container and the database volume; the data
directory stays.
