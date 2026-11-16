# Backups and restore

The owner's requirement: her data must not be lost. Her work is two things: **rows in the SQLite database** (library tree,
documents, revisions, transcripts, accounts) and **files on the data drive** (the uploaded originals and the page images made
from them). The database lives in a Docker volume, inside Docker's Linux VM, where a Docker reset, a `docker volume prune`
or a failed Docker Desktop upgrade can erase it; the files live on the first external drive.

## What protects against what

| Failure | What survives | How you get back | Worst-case loss |
|---|---|---|---|
| Docker reset or volume deleted (database gone, drive fine) | newest database snapshot on the data drive and on the second drive | `scripts/restore.sh --db-only` | up to 5 minutes of edits |
| The data drive dies | second drive: database snapshots and the local restic repository | `scripts/restore.sh --restic local --db newest` onto a new drive | edits since the last 5-minute snapshot; uploads since the last nightly file backup (the rows are restored and reported, the files are gone) |
| A file is damaged or deleted by mistake | restic history (30 daily, 26 weekly, 24 monthly) | `restic restore` of that path from a snapshot | nothing older than the last nightly |
| The app corrupts the database | database snapshots (hourly for 2 days, daily for 30 days, weekly for 26 weeks, monthly for 24 months) | `restore.sh --db-only --db <file>` | depends on the snapshot you choose |
| The whole mini is lost (fire, theft, power surge taking both drives) | **only a remote restic repository** | `restore.sh --restic remote` on a new machine | up to a day |

**Not covered until a remote repository is configured:** the last row. With only the two external drives and the mini in one
room, one event can take all three. Until `RESTIC_REMOTE_REPOSITORY` is set, `scripts/status.sh` says so in plain words on
every run. Also not covered, ever: deleting something and emptying the trash is a deliberate permanent delete; it is in the
backups only until the retention ladder ages those copies out. Corruption that is copied into every backup before anyone
notices is limited by the monthly snapshots, not eliminated.

## Where each copy lives

| Copy | Location | Written by | Contents | Kept |
|---|---|---|---|---|
| Live database | Docker volume `notes-db` | the app | everything in the database | n/a |
| Snapshots, data drive | `<DATA_DIR>/backups/db/notes-<UTC time>.db` + `.json` manifest | every `backup.sh` run | one consistent, verified database | the retention ladder |
| Snapshots, second drive | `<BACKUP_COPY_DIR>/db/` | same run | the same files, checksum-verified after copy | same ladder |
| restic, local | `<BACKUP_COPY_DIR>/restic` | nightly | `originals/`, `pages/`, the storage marker, and that night's database snapshot, encrypted and deduplicated | 30 daily, 26 weekly, 24 monthly |
| restic, remote (optional) | any restic backend | nightly | same | same |
| Status files | `<DATA_DIR>/backups/status/*.json` | the scripts | last snapshot, last full backup, last check, last drill | latest only |

## The jobs

| Job | Schedule | What |
|---|---|---|
| snapshot | every 5 minutes | `backup.sh --db-only`: snapshot, second-drive copy, ladder. Seconds of work, so the worst case after a Docker reset is minutes |
| full backup | 03:15 daily | `backup.sh`: the same, then restic to the local and the remote repository, then `forget --prune` |
| restic check | Sunday 05:00 | `restic-check.sh`: `restic check --read-data-subset 5%` on each repository |
| restore drill | 1st of the month, 04:00 | `drill.sh`: restores the newest restic snapshot into a throwaway project, verifies it, starts the app on it, answers, and deletes it |

`scripts/install-launchd.sh` installs them (`docs/deploy.md`). The first three also run by hand any time.

### The database snapshot

`deploy/tools/db-snapshot.mjs` runs inside the app image (so it uses the server's own SQLite build) and never copies the live
file. It uses SQLite's online backup API (`better-sqlite3`'s `backup()`, which is `sqlite3_backup_*`), which takes a consistent
copy page by page while the app keeps writing, then on the copy: switches it out of WAL mode so it is one self-contained file,
runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check` (any problem deletes the copy and fails the job), hashes it, and
renames it into place. The host then re-hashes the file that reached the drive and compares. The manifest next to it records
the time, kind (`light` or `full`), a label (`pre-update`), size, sha256, the integrity results, **the list of applied schema
migrations**, the storage id the database is bound to, and row counts:

```json
{ "createdAt": "2026-11-16T01:31:30.000Z", "kind": "full", "file": "notes-20261116T013130Z.db",
  "bytes": 380928, "sha256": "…", "integrityCheck": "ok",
  "schemaMigrations": ["0000_placeholder.sql", "0001_accounts.sql", "…"],
  "storageId": "0fa2378e-…", "counts": { "users": 1, "sourceFiles": 3, "pages": 18, "documents": 1 } }
```

### Retention ladder (database snapshots)

The newest snapshot of each bucket is kept; everything else falls off. Configure in `deploy/.env`:

| Variable | Default | Keeps |
|---|---|---|
| `RETAIN_ALL_HOURS` | 2 | every snapshot younger than this (the 5-minute ones) |
| `RETAIN_HOURLY_HOURS` | 48 | one per hour |
| `RETAIN_DAILY_DAYS` | 30 | one per day |
| `RETAIN_WEEKLY_WEEKS` | 26 | one per ISO week |
| `RETAIN_MONTHLY_MONTHS` | 24 | one per month |

The newest three snapshots are never removed, so a stalled clock or stopped job cannot let the ladder eat the last good copies.
Restic keeps its own history with `RESTIC_KEEP_DAILY/WEEKLY/MONTHLY` (30/26/24). A database snapshot is about the size of the
database (hundreds of KB to a few MB), so the whole ladder is small.

## Why snapshot first, files second is safe

The full backup takes the database snapshot at time T0 and captures the file tree afterwards, at T1 > T0.

- **Originals are content-addressed and never modified.** An original is stored at `originals/<user>/<sha256 of its bytes>`,
  written once and never touched again. A path therefore always means the same bytes. Everything the T0 database points to
  existed at T0 and still exists at T1, with identical content, unless it was permanently deleted in between.
- **Page images only ever appear.** The converter writes a file's page directory by rename once it has succeeded (`docs/converter.md`).
  A database row for a page exists only after its images exist, so the T0 snapshot cannot describe an image the T1 tree lacks.
  Pages that appeared between T0 and T1 are in the backup but not in the database snapshot: harmless orphans.
- **The opposite order would be unsafe.** Files first, database second would let a row created in between point at an upload
  the file backup never saw.
- **The one gap:** a permanent delete (emptying the trash) that happens between T0 and T1 removes a file the snapshot still
  references. That is a deliberate user action, and `restore.sh` reports such a row as a failed verification of the paired
  restore rather than hiding it. A retried conversion that replaces a file's pages in that window is caught the same way
  (the page count check).

The restic snapshot also carries the database snapshot (`backups/staging/notes.db` plus its manifest), so one restic snapshot
is a **self-consistent pair**: restoring it needs nothing else.

## restic

- Encrypted and deduplicated. The local repository is `<BACKUP_COPY_DIR>/restic` (override with `RESTIC_REPOSITORY`).
- `RESTIC_PASSWORD` is in `deploy/.env`, generated by `setup.sh`. **Keep a copy outside the mini.** There is no recovery.
- If `restic` is not installed, `backup.sh` says so loudly, exits non-zero, and still does the database snapshot, the second-drive copy and
  the ladder.
- Remote repository: any restic backend. Set in `deploy/.env` and nothing else changes; the same night's run backs up to both.

  | Backend | Variables |
  |---|---|
  | Backblaze B2 | `RESTIC_REMOTE_REPOSITORY=b2:<bucket>:notes`, `B2_ACCOUNT_ID`, `B2_ACCOUNT_KEY` |
  | Cloudflare R2 | `RESTIC_REMOTE_REPOSITORY=s3:https://<account-id>.r2.cloudflarestorage.com/<bucket>/notes`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION=auto` |

  `RESTIC_REMOTE_PASSWORD` defaults to `RESTIC_PASSWORD`. Use an API key limited to that bucket. I did not run against either
  service (no accounts); the local repository path exercises the same code.
- A drive that is not mounted is never silently replaced: the second drive must carry a `.notes-backup-target` marker (written by
  `setup.sh`), or the copy and the local repository are skipped with a warning. The marker is what keeps a missing `/Volumes/NVME2`
  from becoming a folder on the internal disk.

## Restore

`scripts/restore.sh` restores into a **fresh, empty** target and verifies the result. It never starts the stack.

```sh
# Docker reset: the database volume is gone, the drive is fine.
scripts/down.sh
scripts/restore.sh --db-only                  # newest snapshot from the second drive or the data drive
scripts/up.sh

# Drive lost: mount the replacement, create the empty directory, restore everything.
scripts/restore.sh --restic local --db newest # files from the latest restic snapshot, newest database
scripts/restore.sh --restic local             # or: the database that was snapshotted with those files
scripts/restore.sh --restic remote            # the mini itself lost: on a new machine with a new deploy/.env
scripts/up.sh
```

- `--db newest` keeps her latest notes (up to 5 minutes old). If it is newer than the file backup, rows for uploads made since
  the last nightly point at originals the tree does not have. The restore says how many (`N file row(s) point at originals...`),
  and still verifies everything else. `--db paired` (default with `--restic`) avoids that but loses up to a day of notes.
- `--snapshot ID` picks an older restic snapshot; `--db FILE` an older database snapshot.
- **A live target is refused.** Not empty (a storage marker or any files; a database in the volume), or the stack running, and
  `restore.sh` stops. `--overwrite` allows it only after you **type** `overwrite <project>`; the old files and database are moved
  aside into `<DATA_DIR>/.replaced-<time>/`, not deleted.
- **Verification** (`deploy/tools/verify.mjs`, in the app image): `PRAGMA integrity_check` and `foreign_key_check`; the storage
  marker matches the storage id the database is bound to; every `source_files` row has its original at
  `originals/<user>/<sha256>` with the recorded size **and content that hashes to that file name**; every converted file has exactly
  `page_count` page images and thumbnails, and as many `pages` rows. `--quick` checks existence and size only.

## The drills

- `scripts/restore-test.sh` (about 2 minutes): the full proof on synthetic data. Builds the stack, creates a user and library
  content, uploads the PPTX, PDF and HEIC fixtures through the real converter, takes a backup, destroys the stack, its volume and the
  drive, restores, starts it and asserts that she can sign in and that every library node, document, file, original, page image,
  thumbnail and transcript is identical byte for byte. It then repeats with only the volume lost, and with the drive lost after a
  newer upload, and asserts that a live target and a wrongly typed confirmation are refused. Run it after changing anything here.
- `scripts/drill.sh` (monthly, launchd): the same restore applied to the **real** newest restic snapshot, into a temporary project and
  directory on the second drive, with a full sha256 verification, an app start and a health check, then deleted. It writes
  `status/last-drill.json`; `status.sh` turns red if the last pass is older than 40 days. Needs free space equal to the data.

## What status.sh checks

Containers healthy; converter heartbeat younger than 30 s; live database present; newest snapshot on each drive younger than
`STALE_SNAPSHOT_MINUTES` (20); last full backup younger than `STALE_FULL_HOURS` (30) with no failed part; restic installed;
last `restic check` passed within 9 days; last drill passed within 40 days. It exits 1 when anything is red, so it can be used from a monitor.

## Known limits

- Backups run only while the mini is on, logged in, and Docker is up. `status.sh` shows how old the last one is; nothing
  alerts you by itself. (Wire `status.sh`'s exit status into whatever you use to look at the mini.)
- The 5-minute snapshot of a 200 MB database copies 200 MB every 5 minutes (to two places). Today the database is small; if it
  grows past a few hundred MB, lengthen the interval in `deploy/launchd/snapshot.plist.template`.
- The database is encrypted nowhere except in the restic repositories: the snapshot files on the two drives are plain SQLite
  (the drives are in her home). The remote repository is encrypted before it leaves the machine.
- `queue/` is not backed up (transient). After a restore, a file that was `converting` when the snapshot was taken is failed
  by the app after its 15-minute pickup timeout and can be retried from the inbox.
