# Project-NotesHannah

A private web app that builds study material for a pharmacy student from her own lecture
slides and handwritten notes. She uploads files; an agent (Claude Code or Codex) working
through the app's MCP layer transcribes them, organises them, and generates study guides
and practice questions that reference their sources. She can then edit anything.

**Status (2026-11-15):** design only. Nothing is built.

Served at `notes.hannahporras.app`, from a Docker container on the Mac mini behind Caddy.

## Documentation

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | What the app is, the decisions made and why, the flow, the content model, the MCP layer, hosting and data safety, open questions |
| [docs/features.md](docs/features.md) | The version-one feature list, with an ID per line, and the proposed build order (draft, not locked) |
| [docs/tech-stack.md](docs/tech-stack.md) | The chosen libraries and tools, the reasons, and the choices still open |
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

Requires Node 25 and pnpm 10 (see `.nvmrc`). Copy `.env.example` to `.env` to change defaults.

```sh
pnpm install            # install the workspace
pnpm dev                # server on :3000, web on :5173 (proxies /api and /mcp to the server)
pnpm test               # unit tests in every package
pnpm gate               # lint + typecheck + test + build: run before every commit
pnpm format             # apply Biome formatting and safe fixes
pnpm exec playwright install chromium   # once, for the end-to-end layout check
pnpm e2e                # Playwright smoke spec at phone, tablet and computer sizes
```

Layout: `apps/web` (React, Vite, Tailwind 4), `apps/server` (Hono: API, MCP endpoint, static
files), `apps/converter` (file conversion worker), `packages/schema` (shared Zod schema),
`deploy/` (Dockerfile and compose file), `fixtures/` (test material).

Container, from the repository root:

```sh
docker build -f deploy/Dockerfile -t notes-app .
docker run --rm -p 3000:3000 notes-app && curl localhost:3000/healthz
# or, with a named volume for the database and a bind mount for DATA_DIR:
PORT=3000 DATA_DIR=./data docker compose -f deploy/docker-compose.yml up --build
```
