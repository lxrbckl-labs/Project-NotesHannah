# Tech stack

Proposed 2026-11-15. TypeScript end to end, one repository, shipped as two containers.
Check current versions of each library against its documentation before scaffolding.

## Choices

| Layer | Choice | Why |
|---|---|---|
| Front end | React 19 with Vite, single-page app | Login-gated, so no server rendering is needed; React Bits targets React 19 |
| Styling | Tailwind 4 with colour tokens; shadcn/ui for base components | React Bits installs through the shadcn tooling; tokens give light and dark mode |
| Components | React Bits, copied in and modified | Owned by the project once copied; licence (MIT plus Commons Clause) allows private use |
| Canvas | React Flow, with ELK (elkjs) for automatic layout | Free licence; cards and connectors are its native model |
| Editor | Tiptap, open-source core | Custom interactive blocks as React components, stored as structured JSON |
| Mind maps | markmap | Renders from an outline |
| Server | Node with Hono, one process | Serves the web app, the API and the MCP endpoint together |
| Agent layer | Official MCP TypeScript SDK, stateless HTTP, API-key login | Works with Claude Code and Codex using a bearer token |
| Shared schema | Zod definitions in a shared package | One definition of every block and object for the UI, the API and MCP |
| Database | SQLite with Drizzle; built-in full-text search (FTS5) | One user, simple to back up, no separate database server |
| Login | argon2id password hashing, sessions in the database, hashed API keys | Standard; no third-party auth service |
| File conversion | A second container with LibreOffice, poppler and sharp, fed by a job table | Keeps untrusted files away from the app, with no network access |
| Tests | Vitest; Playwright at iPad and phone sizes | Catches layout regressions on the devices that matter |
| Packaging | pnpm workspace, Docker Compose, a route in the existing Caddyfile | Same tooling as the other projects on the mini |
| Backups | Nightly database snapshot, restic for files | Encrypted, with a restore that can be tested |

## Proposed repository layout

```
apps/web        React app
apps/server     Hono server: API, MCP endpoint, static files
apps/converter  file conversion worker
packages/schema Zod definitions shared by all three
docs/           this documentation
```

## Still open

- **Tiptap or BlockNote.** Both fit. BlockNote gives a Notion-style editor sooner; Tiptap
  gives more control over custom blocks. Decide after trying both on a real iPad. If
  BlockNote, avoid its `xl-*` packages (copyleft or commercial).
- **SQLite or Postgres.** SQLite for one user. Postgres in a third container if several
  users with heavier concurrent use are expected.
- **Hono or Fastify.** Follow whichever the MCP SDK's current server examples support best.

## Deliberately absent

No Next.js, no Redis, no auth provider, no model SDK, no git-based storage.

## Rejected libraries

- **tldraw:** production use needs a key; the hobby key is discretionary and forces a watermark.
- **BlockSuite (AFFiNE's editor):** unstable, not React, storage format hostile to agents.
- **Mermaid in version one:** recurring injection advisories; if added later, pin the
  version and use its sandbox mode.
