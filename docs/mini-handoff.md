# Handoff to the Mac mini session

Standing instructions for work that has to happen on the Mac mini. Each task has a
status; update it here when done.

## Task 1: add `notes.hannahporras.app` to Caddy

**Status:** done 2026-11-16. Port **8060** (`127.0.0.1:8060` to the app's 3000). Caddy runs as the container `caddy`,
so the block proxies to `host.docker.internal:8060`, not `127.0.0.1`. The 210MiB body limit went in with the block.
Backup of the old file: `~/caddyfile.bak-notes-2026-11-16`. Certificate obtained; checked from outside the mini.

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

## Task 2: deploy the stack

**Status:** done through step 9 on 2026-11-16; live at <https://notes.hannahporras.app>. Open items below.

**Result.** Checkout on the mini: `~/lxrbckl-dev/Project-NotesHannah`. App and converter healthy. First backup, second
copy and `restic-check` passed. Five `app.notes` jobs loaded. `restore-test.sh` passed in 110 s. First account: `alex`.

**Open items.**

- **Scheduled backups fail.** The `app.notes.snapshot` job (every 5 minutes) and the nightly backup cannot read the
  external drives: macOS has not granted `/bin/bash` access to removable volumes. Alex, at the mini's keyboard: grant
  `/bin/bash` Full Disk Access (or Files and Folders, Removable Volumes), then
  `launchctl kickstart gui/501/app.notes.snapshot` and read `~/Library/Logs/notes/snapshot.log`. Until then
  `scripts/backup.sh` from a terminal is the backup, and each failed run leaves an unverified `.db` and `.json` pair in
  `/Volumes/NVME1/notes/backups/db`.
- **Step 10 (reboot test)** not run.
- **No remote backup repository** is configured.
- `setup.sh` left `deploy/.env` at mode 644; set to 600 by hand on the mini. Fixed in the script afterwards (`set_var` keeps the file at 600); the mini's checkout does not have that fix until its next pull.
- `X-Robots-Tag` is sent twice (app and Caddy). Harmless.
- From the mini itself the public name is unreliable (no hairpin); check the site from another machine.

**The go:** given by Alex on 2026-11-16 08:01 CST, from his phone, away from home: "Can you deploy this to the
domain on the Mac mini so I can access it away?" Task 1 is still open, so do it first.

**For this run (Alex is away from the keyboard):**

- The first account is `alex` (`--username alex`), so he can sign in himself. Do not create an account for Hannah yet.
- Show the generated account password and the `RESTIC_PASSWORD=` line only in the mini session's own transcript, where
  Alex reads it on his phone. Do not put either in a message to another session.
- Skip step 10 (the reboot test). It waits until Alex is home.
- Stop and report rather than improvise if a drive is not mounted, a port is taken, or another site stops answering.

**Context.** The app and the file converter now deploy as one compose stack with a full backup system
(`deploy/docker-compose.yml`, `scripts/`). Read `docs/deploy.md` and `docs/backups.md` first. Task 1 (Caddy) must be done:
this task needs the reserved host port.

**Do this.**

1. Pull the repository on the mini and install `restic` (`brew install restic`). Confirm Docker Desktop is running and that
   `/Volumes/NVME1` and `/Volumes/NVME2` are mounted.
2. Create the two directories on the drives, with the drives mounted: `mkdir /Volumes/NVME1/notes /Volumes/NVME2/notes-backups`.
3. Run `scripts/setup.sh --data-dir /Volumes/NVME1/notes --backup-copy-dir /Volumes/NVME2/notes-backups --origin
   https://notes.hannahporras.app --port <the Task 1 port> --username <the owner's username>`. The first build takes several
   minutes.
4. Tell Alex the generated account password (it is printed once) and the `RESTIC_PASSWORD=` line of `deploy/.env`, so he can store
   both in a password manager. Do not paste either into any file, commit or chat history beyond that report.
5. Set `TRUSTED_PROXIES` and `APP_ORIGIN` in `deploy/.env` exactly as in `docs/deploy.md` ("TRUSTED_PROXIES"), then `scripts/up.sh`.
6. Add `request_body { max_size 210MiB }` to the `notes.hannahporras.app` Caddy site block (the app's own cap is 200 MiB),
   `caddy validate`, reload Caddy (do not restart), and check `https://notes.hannahporras.app` now answers with the app.
7. Run `scripts/backup.sh`, then `scripts/status.sh`. Everything except "restic check", "restore drill" and the remote
   repository should be green. Then run `scripts/restic-check.sh`.
8. Install the jobs: `scripts/install-launchd.sh`, then `launchctl list | grep app.notes` shows five.
9. Run `scripts/restore-test.sh` once on the mini (about 2 minutes; temporary paths) and report its result.
10. Reboot test: reboot the mini and do not log in at the keyboard (automatic login must bring Docker Desktop up). Report
    whether the stack came back by itself and how long it took (`scripts/status.sh`). This closes the "Docker Desktop may not
    start after a power loss" risk in `docs/risks.md`, or shows it is real.

**Do not.**

- Do not run `docker volume prune` / `docker system prune --volumes`, ever, on this machine's stack; do not run `scripts/down.sh`
  options that delete volumes (the script refuses them).
- Do not put the app on a LAN-visible port: it must stay on `127.0.0.1`.
- Do not format or repartition either drive; do not move the data directory after the first run.

**Report back to Alex:** the port, the `status.sh` output, the `restore-test.sh` result and time, the reboot test result, and
anything that differed from `docs/deploy.md`. Then set the status to done.
