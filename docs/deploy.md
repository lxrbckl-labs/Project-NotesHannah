# Deploying to the Mac mini

Step by step for the always-on Mac mini (Apple Silicon, Docker Desktop, `linux/arm64`) with an existing Caddy on
the host. Backups are in [backups.md](backups.md); the converter's design is in [converter.md](converter.md).

What runs: two containers from `deploy/docker-compose.yml`, configured by `deploy/.env`.

| | `app` | `converter` |
|---|---|---|
| Does | web app, API, SQLite | PPTX/PDF/HEIC to page images (LibreOffice, poppler, libheif) |
| Network | one private network, published on `127.0.0.1:<APP_PORT>` only | none |
| Root filesystem | read-only (`/tmp` is a 64 MB tmpfs) | read-only (`/tmp` is a 1 GB `noexec` tmpfs) |
| User, capabilities | `10001:10001`, all dropped, `no-new-privileges` | same |
| Limits | 1 GB memory, 512 pids | 3 GB, no swap, 2 CPUs, 256 pids, no core dumps |
| Mounts | database volume `notes-db` at `/db`; the data directory at `/data` | `originals/` read-only, `pages/` and `queue/` read-write, nothing else |
| Logs | json-file, 5 files of 10 MB | same |

A third one-shot container, `db-init`, gives the app's uid ownership of the database volume at each `up` and exits.

## Prerequisites

- Docker Desktop, with `/Volumes` shared (it is by default: Settings, Resources, File sharing).
- `restic` (`brew install restic`). Without it everything runs, but the originals and page images are **not**
  backed up; `scripts/status.sh` shows that in red.
- The two external drives mounted and formatted APFS (or HFS+). exFAT/FAT drives have no permissions and weak
  fsync guarantees; I did not test them.
- Git checkout of this repository on the mini, for example `~/Documents/HiveDeck-Labs/Project-NotesHannah`.
- Task 1 of [mini-handoff.md](mini-handoff.md) done (Caddy site block and a reserved host port).

## Paths on the external drives

| What | Default | Why there |
|---|---|---|
| Storage (`DATA_DIR`) | `/Volumes/NVME1/notes` | originals, page images, queue, and `backups/` (database snapshots, status files) |
| Second copy (`BACKUP_COPY_DIR`) | `/Volumes/NVME2/notes-backups` | database snapshots and the local restic repository; must be a **different drive** |

Create the two directories yourself, with the drives mounted. The scripts never create them: an unmounted drive
would otherwise be replaced by an empty folder on the internal disk.

```sh
mkdir /Volumes/NVME1/notes /Volumes/NVME2/notes-backups
```

## First run

```sh
cd ~/Documents/HiveDeck-Labs/Project-NotesHannah
scripts/setup.sh --data-dir /Volumes/NVME1/notes --backup-copy-dir /Volumes/NVME2/notes-backups \
    --origin https://notes.hannahporras.app --port 3000 --username hannah
```

`--port` is the host port reserved in Task 1. Setup: creates `deploy/.env` from `deploy/.env.example` (mode 600, with a
generated restic password), builds the two images (the first build downloads LibreOffice and takes several
minutes), writes the `.notes-storage` marker and layout, creates the account with a generated password (printed once,
stored only as a hash), and starts the stack.

Then **immediately**:

1. Copy the `RESTIC_PASSWORD=` line from `deploy/.env` into a password manager. If the mini is lost and the password
   with it, every restic repository is unreadable.
2. Write down the account password.
3. Add the Caddy block below and reload Caddy.
4. Install the launchd jobs (below) and run `scripts/backup.sh` once, then `scripts/status.sh`.

## Caddy

The app binds `127.0.0.1:<port>` only, so the site block is a plain reverse proxy. The app's upload limit is 200 MiB
(209,715,200 bytes), so Caddy's limit must be a little above it; `210MiB` is accepted by Caddy (it takes any go-humanize
size).

```caddy
notes.hannahporras.app {
	request_body {
		max_size 210MiB
	}
	header X-Robots-Tag "noindex, nofollow"
	reverse_proxy 127.0.0.1:3000
}
```

Use the reserved port in place of `3000`, and follow the conventions of the existing site blocks (Task 1). I could not
run Caddy here, so the block is checked against the Caddy documentation only: run `caddy validate` before reloading.

In `deploy/.env`:

```
APP_ORIGIN=https://notes.hannahporras.app
TRUSTED_PROXIES=10.77.88.1,127.0.0.1
NOTES_SUBNET=10.77.88.0/24
```

### TRUSTED_PROXIES

Caddy runs on the host, outside Docker. A connection from the host to a published loopback port reaches the app from
the **gateway address of the compose network**. I measured this on Docker Desktop for Mac with a probe container on a
user-defined network: the app saw `172.21.0.1` for network `172.21.0.0/16`, i.e. the `.1` of the subnet. So the compose
file pins the network to `NOTES_SUBNET` (default `10.77.88.0/24`, chosen to stay clear of Docker's own `172.x`/`192.168.x`
pools and your LAN) and the gateway is predictably `10.77.88.1`. `scripts/stack-test.sh` proves it both ways: it sends a
failed sign-in with `X-Forwarded-For: 203.0.113.77` and checks that the app's rate-limit table is keyed by `203.0.113.77`,
and it reads the gateway from `docker network inspect`.

`127.0.0.1` is listed as well because on a native Linux Docker host (userland proxy off) the peer can be loopback. Only
processes on the mini can reach a loopback-published port, so trusting both addresses lets nobody forge a client address.
If `10.77.88.0/24` collides with a network you use, change `NOTES_SUBNET` and the first `TRUSTED_PROXIES` entry together.

## File ownership (app, converter, drive)

The app writes `originals/<user>/<sha256>` and the queue job files; the converter must read the originals, write
`pages/<user>/<file>/` and rename inside `queue/`; the app must then read the pages and delete queue files. The app creates
its directories with mode 700 and files 600 (`apps/server/src/storage`), so a different uid on the other side could not
even enter them.

**Solution: both containers run as the same uid and gid** (`NOTES_UID:NOTES_GID`, default `10001:10001`). Permissions then
never get in the way, whatever modes the code picks. The converter still cannot modify an original, because that mount
is read-only, and cannot see anything but its three mounts. (`docs/converter.md` suggests a shared group with group-writable
directories as the alternative; that would need the server to create group-writable directories, which it does not.)

What differs by platform:

- **Docker Desktop for Mac (the mini).** I tested a bind mount here: files and directories created by one container uid
  are readable and writable by any other uid, regardless of mode (a mode 700 directory created as 10001 was listable and
  writable as uid 12345), and on the host everything belongs to the macOS user. Ownership is therefore a non-issue on the
  mini, and the same-uid rule costs nothing.
- **Linux host.** The kernel enforces permissions. `scripts/setup.sh` chowns the data directory to `NOTES_UID:NOTES_GID`
  (using a root container with only `CAP_CHOWN`), and `scripts/restore.sh` does the same for a restored tree. If you change
  `NOTES_UID`, the `db-init` container re-owns the database volume on the next `up`. `scripts/stack-test.sh` section 7
  proves the Linux behaviour on an ext4 volume in Docker's VM: the same uid works end to end (read originals, write pages,
  rename in the queue, the app deletes), and a different uid (app 1000, converter 10001) cannot read the 700 directory.

## Start-up and the missing drive

- The compose file binds the data directory with `create_host_path: false`. If the path does not exist, Docker refuses to create
  the container instead of creating an empty directory on the internal disk. Tested: with a missing path `compose up` fails and
  nothing is created.
- If the directory exists but is an empty mount point, the converter's bind sources (`originals/`, `pages/`, `queue/`) are
  missing, so Docker refuses again, before anything starts. If the layout is there but the `.notes-storage` marker is not,
  the app itself exits with `storage_unavailable ... Refusing to start.` and the converter, which waits for a healthy app,
  never starts. Both tested.
- A stack that was stopped while the drive was away fails to start (`docker compose start`), also tested. After a reboot
  Docker's `restart: unless-stopped` brings the containers back by itself when the drive is already mounted;
  `scripts/start-when-ready.sh` (the `app.notes.start` job) covers the case where Docker comes up first: it waits for Docker
  and for the marker, then runs `scripts/up.sh`, and exits with an error after 45 minutes if either never arrives.

## Backups and start-up jobs (launchd)

```sh
scripts/install-launchd.sh            # fills deploy/launchd/*.plist.template and loads them for this user
launchctl list | grep app.notes       # five jobs
scripts/install-launchd.sh --uninstall
```

| Job | When | Runs |
|---|---|---|
| `app.notes.snapshot` | every 5 minutes (and at load) | `backup.sh --db-only --quiet` |
| `app.notes.backup` | 03:15 daily | `backup.sh` (full) |
| `app.notes.restic-check` | Sundays 05:00 | `restic-check.sh` |
| `app.notes.drill` | 1st of the month 04:00 | `drill.sh` (needs free space for a full copy of the data) |
| `app.notes.start` | at load | `start-when-ready.sh 45` |

Logs of these jobs are in `~/Library/Logs/notes/`. They are LaunchAgents: **they run only while the mini's user is logged
in**, and so does Docker Desktop. To have everything back after a power cut without anyone at the keyboard:

1. System Settings, Users and Groups: automatic login for the user that owns Docker Desktop (not possible with FileVault on).
2. Docker Desktop, Settings, General: "Start Docker Desktop when you sign in".
3. Energy: "Start up automatically after a power failure" on.
4. First time the jobs touch an external drive, macOS may ask for access to removable volumes; approve it once at the
   keyboard, or grant `/bin/bash` Full Disk Access.

**What I could and could not verify.** Verified here (on a MacBook with Docker Desktop): every script, the compose file,
that the plist templates fill in and pass `plutil -lint`. **Not verified**, because it needs the mini: that launchd actually
fires the five jobs; the automatic-login/Docker Desktop start sequence after a real power loss (the risk in
[risks.md](risks.md) stands until you do a reboot test); the removable-volume permission prompt; Caddy; the two real drives
and their mount timing; restic against the real drives' speed.

## Everyday commands

| Command | What it does |
|---|---|
| `scripts/status.sh` | containers, converter heartbeat, database size, storage use, age of every backup, last check and drill |
| `scripts/up.sh [--build]` / `scripts/down.sh` | start (waits until healthy) / stop. `down.sh` refuses `-v`: it never deletes the database volume |
| `scripts/logs.sh [app\|converter]` | follow logs |
| `scripts/admin.sh create-user NAME --generate` | accounts: `create-user`, `reset-password`, `list-users`, `disable-user`, `enable-user` |
| `scripts/backup.sh` / `--db-only` | see [backups.md](backups.md) |

## Updating

```sh
scripts/update.sh
```

Takes a full backup labelled `pre-update` (the update stops if it fails), `git pull --ff-only`, tags the running images as
`:previous`, rebuilds, restarts (the app applies pending database migrations when it starts) and takes a fresh snapshot.
Migrations only move forward. To go back: `scripts/down.sh`, restore the pre-update backup (`scripts/restore.sh --db-only
--db <the pre-update snapshot>`), set `APP_IMAGE=notes-app:previous` and `CONVERTER_IMAGE=notes-converter:previous` in
`deploy/.env`, `scripts/up.sh`.

## Where things are

| | |
|---|---|
| Container logs | `scripts/logs.sh`; rotated at 5 x 10 MB per container inside Docker's VM |
| Job logs | `~/Library/Logs/notes/*.log` |
| Live database | named volume `notes-db`, inside Docker's VM (never edit by hand; snapshots are in `<DATA_DIR>/backups/db`) |
| Backup and drill results | `<DATA_DIR>/backups/status/*.json`, shown by `status.sh` |
| Env file | `deploy/.env` (mode 600, not in git) |

**Do not run `docker volume prune` or `docker system prune --volumes` while the stack is down**: an unused `notes-db` is exactly
what they delete. The 5-minute snapshots exist for that day, and so does `restore.sh --db-only`.

## Testing the deployment itself

`scripts/stack-test.sh` (about 2.5 minutes with warm image caches; the first build is longer) and `scripts/restore-test.sh` (about 2 minutes) use temporary
paths and private Docker projects (`notes-st`, `notes-rt`) and clean up after themselves. They need Docker, Node and restic.
