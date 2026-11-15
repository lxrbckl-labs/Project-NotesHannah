# Handoff to the Mac mini session

Standing instructions for work that has to happen on the Mac mini. Each task has a
status; update it here when done.

## Task 1: add `notes.hannahporras.app` to Caddy

**Status:** open (requested by Alex 2026-11-15).

**Context.** `notes.hannahporras.app` will serve the Project-NotesHannah web app from a
Docker container on the mini. The app does not exist yet; this task only prepares the
front door. DNS is already live: an A record for `notes.hannahporras.app` points at
`99.109.232.114` (the same address as `relay.hivedeck.app`), served by Porkbun's
nameservers.

**Do this.**

1. Back up the current Caddyfile (`~/caddyfile`) with a dated copy before editing.
2. Pick a host port on the mini that nothing is using, and reserve it for this app.
3. Add a site block for `notes.hannahporras.app` that reverse-proxies to that port,
   written the same way as the existing site blocks (same snippets, headers and logging
   conventions). Plain HTTP-01 certificates are fine; no DNS plugin is needed.
4. Add a response header telling search engines not to index the site
   (`X-Robots-Tag: noindex, nofollow`).
5. Allow request bodies large enough for slide decks (200 MB) on this site only, if the
   Caddyfile sets a global limit.
6. Validate the Caddyfile, then reload Caddy. Reload, do not restart, so the other sites
   stay up.
7. Check the result: Caddy obtained a certificate for the hostname, and
   `https://notes.hannahporras.app` answers (a 502 is expected until the app is deployed).
8. Confirm every other site still responds.

**Do not.**

- Do not change, reorder or reformat any other site block.
- Do not deploy or start any container for this app.
- Do not put the site behind a proxy or tunnel service.

**Report back to Alex:** the port you reserved, the exact block you added, and the result
of the checks. Then record the port in this file under Task 1 and set the status to done.
