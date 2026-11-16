# The conversion worker

`apps/converter` (`@notes/converter`) turns an uploaded original (PDF, PPTX, JPEG, PNG, HEIC) into numbered
page images plus the text the file itself carries. It runs as one long-lived, locked-down container. It has no
network and no database; the app and the worker talk only through files in a **queue directory** on the data
volume. This document is the protocol the server follows.

Decided 2026-11-15, after spike S5 (`spikes/s5-converter/FINDINGS.md`). Container-per-job would need Docker
access from the app, which is root-equivalent; a resident container with a file queue does not.

## Data volume

`DATA_DIR` on the host holds:

```
originals/<userId>/<sha256>          the uploaded bytes, content-addressed. Mounted READ-ONLY into the converter
pages/<userId>/<fileId>/             the converter's output, one directory per file. Read-write
queue/pending/<jobId>.json           jobs waiting (server writes)
queue/processing/<jobId>.json        the job being worked (converter only)
queue/done/<jobId>.json              success results (converter writes, server reads and removes)
queue/failed/<jobId>.json            failure results (same)
queue/heartbeat                      liveness (converter writes)
```

`deploy/docker-compose.converter.yml` mounts `originals`, `pages` and `queue` as three separate binds, so the
converter cannot modify an original and cannot see anything else on the volume. The worker creates the
`queue/*` directories and `pages/` if they are missing, but refuses to start if `originals/` is not there
(the data volume is not mounted). IDs are the schema's prefixed ULIDs (`usr_`, `fil_`, `job_` plus 26 Crockford
base32 characters), `sha256` is 64 lower-case hex characters.

## Job file

The server writes `queue/pending/<jobId>.json`:

```json
{ "jobId": "job_01...", "userId": "usr_01...", "fileId": "fil_01...", "sha256": "<64 hex>", "createdAt": "2026-11-15T18:20:00.000Z" }
```

**It must write the file under a temporary name in `queue/pending/` (for example `.<jobId>.tmp`) and rename it
to `<jobId>.json`.** The worker only looks at names matching `^job_<ULID>\.json$`, so a half-written file is
never picked up. (As a second line of defence, a file with a valid name that does not parse is left alone until
it is two seconds old, and only then refused as malformed.)

The worker validates every field with a strict pattern before any of them reaches a path, and the `jobId`
inside must equal the file name. Anything else is refused (see "Failures", reason `invalid_job`) and nothing is
read or written outside `originals/<userId>/<sha256>`, `pages/<userId>/` and `queue/`. The converter adds
`"attempts": n` to the file while it works on it.

Before converting, the worker checks that the original is a regular file (not a symlink) of an allowed size
and that its SHA-256 equals the job's `sha256`. A mismatch is reported as a failure, never converted.

## What the worker does

1. Claims the oldest job by an atomic `rename` from `pending/` to `processing/`. One job at a time.
2. Counts the attempt (`attempts` + 1, rewritten atomically in `processing/`).
3. Runs the conversion in a **child process** (see "Isolation").
4. On success, renames `pages/<userId>/<fileId>.tmp-<jobId>/` to `pages/<userId>/<fileId>/`, replacing any
   earlier output for that file (a retry), then writes `queue/done/<jobId>.json`.
5. On failure, removes the staging directory (an earlier good output is left as it was) and writes
   `queue/failed/<jobId>.json`.
6. Removes `processing/<jobId>.json` last.

Result files are written to a temporary name (`.tmp-...`) and renamed, so the server never reads a half-written
file. The server should read `done/` and `failed/` by the `jobId` it created, and remove the result file once it
has recorded it.

## Output

In `pages/<userId>/<fileId>/`:

```
0001.webp  0002.webp ...        long edge at most 1568 px, EXIF rotation applied, metadata stripped
thumbs/0001.webp ...            long edge at most 320 px
```

PDF and PPTX pages are rendered to exactly 1568 px on the long edge; photos are only ever shrunk. Pages are
numbered from 1 with four digits (the limit is 500 pages). A PPTX hidden slide is kept as a page.

## Result files

Success, `queue/done/<jobId>.json`:

```json
{
  "jobId": "job_01...", "fileId": "fil_01...", "ok": true,
  "type": "pptx",
  "pageCount": 12,
  "pages": [
    { "index": 1, "width": 1568, "height": 882, "bytes": 41234,
      "hasTextLayer": true, "nativeText": "Beta-Adrenergic Antagonists\n...", "speakerNotes": "Welcome. ..." }
  ],
  "toolVersions": { "node": "...", "sharp": "...", "libvips": "...", "libreoffice": "...", "poppler": "...", "libheif": "...", "libde265": "..." },
  "timings": { "detect": 1, "zipscan": 40, "libreoffice": 2100, "render+encode": 900, "total": 3200, "queueWait": 120, "elapsed": 3300 },
  "warnings": [ { "code": "HIDDEN_SLIDE", "message": "hidden slide, kept as a page", "page": 11 } ],
  "peakRssBytes": 308281344,
  "attempt": 1
}
```

- `type` is the schema `FileType`, detected from the content (magic bytes), never from a name. A macro-enabled
  `.pptm` is `pptx`.
- `pages[]` maps one-to-one onto the schema's `Page` (`index`, `width`, `height`, `hasTextLayer`,
  `nativeText`, `speakerNotes`); `bytes` is the size of the full-size image. `width`/`height` are the pixels of
  `NNNN.webp`.
- `nativeText` is text taken from the file: the PDF text layer, or the slide's text in reading order (title
  first, tables as tab-separated rows). It is `null` when there is none (handwriting PDFs, photos), and then
  `hasTextLayer` is `false`. `speakerNotes` is PPTX notes or `null`.
- `timings` are milliseconds: the pipeline's stages and `total` (the child's wall time), plus `queueWait`
  (job `createdAt` to claim) and `elapsed` (claim to done).
- `peakRssBytes` is the sampled peak resident memory of the conversion (child plus tools, summed per process,
  so shared pages count more than once); `null` where `/proc` is not available.
- `attempt` is 1 for a first run, 2 after a crash recovery.

Warning codes: `HIDDEN_SLIDE`, `UNEXTRACTED_OBJECTS` (a chart, SmartArt or embedded object whose text was not
extracted; it is still in the image), `MACROS_PRESENT` (a VBA project exists; macros are disabled and never
run), `EXTERNAL_LINKS` (not fetched), `NO_TEXT_LAYER` (per PDF page), `PDF_OWNER_RESTRICTED`,
`PDF_TEXT_RESTRICTED`, `PAGE_COUNT_MISMATCH`, `EXIF_ORIENTATION_APPLIED`, `SLIDE_XML_MISSING`.

Failure, `queue/failed/<jobId>.json`:

```json
{ "jobId": "job_01...", "fileId": "fil_01...", "ok": false,
  "errorCode": "encrypted_file", "message": "PDF requires a password", "reason": "optional_tag",
  "attempt": 1, "elapsedMs": 480 }
```

`errorCode` is always one of the schema's `ErrorCode` values: `unsupported_type`, `encrypted_file`,
`corrupt_file`, `too_many_pages`, `too_large`, `conversion_failed`. `message` is plain text safe to show
(control characters stripped, 300 characters at most, never file contents). `reason` is a finer tag the server
may use to word the message; it is not part of the schema:

| errorCode | reason | Cause |
|---|---|---|
| `unsupported_type` | (none) | Unrecognised content |
| | `legacy_office` | Old binary `.ppt`/`.doc`/`.xls` (OLE) |
| | `other_zip` | A zip that is not a PowerPoint package (docx, xlsx, ...) |
| `encrypted_file` | | Password-protected PDF or Office file |
| `corrupt_file` | | Damaged, truncated, empty, or a zip whose entries do not match their headers |
| `too_many_pages` | | More than 500 pages or slides |
| `too_large` | `file_too_large` | Original over 200 MiB |
| | `decompression_bomb` | A zip that inflates past 600 MiB or has over 10,000 entries |
| | `pixel_bomb` | An image over 120 million pixels |
| `conversion_failed` | `timeout` | Over the wall clock (10 minutes) |
| | `memory_limit` | Over 2 GiB resident, killed by the watchdog |
| | `resource_limit` | Killed by a signal (out of memory in the container, CPU time) |
| | `crashed` | The child died without a result, or the worker crashed twice on this job |
| | `invalid_job` | The job file is not valid (see above); `fileId` is `null` if it could not be read |
| | `original_missing` | No regular file at `originals/<userId>/<sha256>` |
| | `original_mismatch` | The stored bytes do not hash to `sha256` |
| | `internal` | Anything else unexpected |

`fileId` in a failure is `null` only when the job file was too broken to yield a valid one. `elapsedMs` is
present for failures that happened during a conversion.

## Crash safety

- On start, jobs left in `processing/` are examined. If a result already exists for the job, only the stale
  processing file is removed. Otherwise: `attempts` below 2 means the job goes back to `pending/` (one retry);
  `attempts` of 2 means it is failed with `conversion_failed` / `crashed`. Stale `*.tmp-<jobId>` staging
  directories under `pages/` and leftover `.tmp-` files in `processing/`, `done/` and `failed/` are removed.
- **SIGTERM** (what `docker stop` sends): the running conversion is killed, its staging directory removed, the
  attempt is not counted, and the job returns to `pending/`. The container's stop grace period is 30 s;
  stopping took about 1 s in the integration run.
- Output replacement is `rename`-based: the old directory is moved aside, the new one moved in, then the old
  one deleted.

## Heartbeat

`queue/heartbeat` is rewritten (temp name plus rename) every 5 seconds and on every state change:

```json
{ "pid": 7, "version": "1.0.0", "startedAt": "...", "updatedAt": "...", "heartbeatMs": 5000,
  "state": "idle", "currentJobId": null, "currentSince": null,
  "processed": 12, "failed": 20, "requeued": 0, "lastJobId": "job_01...", "lastFinishedAt": "..." }
```

`state` is `starting`, `idle`, `processing` or `stopping`. The server can call the converter alive when
`updatedAt` is under about 15 seconds old. The compose healthcheck uses the file's modification time (30 s).
A conversion may take several minutes, but the heartbeat keeps ticking meanwhile.

## Isolation

The container (`deploy/docker-compose.converter.yml`): `network_mode: none`, read-only root filesystem,
`/tmp` as a 1 GiB `noexec` tmpfs (scratch; counts against memory), user `10001:10001`, `cap_drop: ALL`,
`no-new-privileges`, no IPC, 3 GiB memory with no swap, 2 CPUs, 256 PIDs, open files 1024, no core dumps, file
size 2 GiB. `init: true` reaps stray processes.

Each conversion is a child process of the worker (`dist/convert/child.js`), started with:

- `prlimit`: CPU seconds (twice the wall clock), file size 2 GiB, open files 1024, no core dumps;
- Node heap capped at 1 GiB;
- a **wall-clock kill** (the conversion's own deadline, 10 minutes by default, plus 15 s grace, after which the
  worker kills the child, its process group and every process it started);
- a **resident-memory watchdog** that samples the child and everything it started every 250 ms from `/proc`
  and kills them past 2 GiB (`CHILD_RSS_MB`);
- a minimal environment (no inherited variables other than `PATH`) and its own scratch directory under `/tmp`,
  with `HOME` and `TMPDIR` pointed at it and a fresh LibreOffice profile (macros disabled at the highest
  security level, no first-run, no crash reporter); the scratch directory is removed afterwards, even on failure.

The child reports its outcome in a file in its scratch directory, not on stdout, so tool noise cannot corrupt
it. Logs go to stdout as one JSON object per line (`ts`, `level`, `msg`, ids, counts, timings); file contents and
names are never logged.

Detection is by content only: JPEG, PNG, PDF (`%PDF-` in the first 1 KiB), HEIC (`ftyp` brands), a zip that
contains `ppt/presentation.xml` with a PowerPoint content type (presentation, slideshow, template, macro-enabled
or not), and old OLE files (told apart: `EncryptedPackage` means password protected, otherwise legacy). Every
zip entry is inflated into a counter before LibreOffice sees the file, so the real decompressed size is known;
header sizes are not trusted.

## Configuration

Environment variables (empty means the default):

| Variable | Default | Meaning |
|---|---|---|
| `DATA_DIR` | `/data` | Data volume root inside the container |
| `MAX_INPUT_BYTES` | 209715200 | Largest original (schema `UPLOAD_LIMITS.maxBytes`) |
| `MAX_PAGES` | 500 | Most pages or slides (schema `UPLOAD_LIMITS.maxPages`) |
| `WALL_CLOCK_MS` | 600000 | One conversion's time limit |
| `CHILD_RSS_MB` | 2048 | One conversion's memory limit |
| `MAX_ZIP_UNCOMPRESSED_BYTES`, `MAX_ZIP_ENTRIES`, `MAX_XML_ENTRY_BYTES`, `MAX_PIXELS` | 600 MiB, 10000, 32 MiB, 120000000 | Bomb limits |
| `PAGE_LONG_EDGE`, `THUMB_LONG_EDGE`, `WEBP_QUALITY`, `RENDER_CONCURRENCY` | 1568, 320, 80, 2 | Output |
| `POLL_MS`, `HEARTBEAT_MS`, `SETTLE_MS`, `MAX_ATTEMPTS`, `KILL_GRACE_MS` | 1000, 5000, 2000, 2, 15000 | Queue timing |

The worker polls `queue/pending/` every `POLL_MS` and also wakes on a file-system event; the poll is the
guarantee, since events do not reliably cross bind mounts from macOS.

## What the server must do

1. Store the upload as `originals/<userId>/<sha256>` (write to a temp name, `fsync`, rename; never touch it
   again). Detecting the type by content is still worth doing at upload time for a fast error, but the converter
   decides.
2. Create the job: temp name in `queue/pending/`, rename to `<jobId>.json`. Set the file to `converting`.
3. Watch `queue/done/` and `queue/failed/` (poll by `jobId`; directory events do not cross the Docker Desktop
   mount reliably). On `done`, insert the `Page` rows from `pages[]` (the page id is the server's), set
   `pageCount`, status `converted`, then delete the result file. On `failed`, set status `failed` with
   `errorCode`/`message`, delete the result file.
4. Serve page images from `pages/<userId>/<fileId>/NNNN.webp` and `thumbs/NNNN.webp`. When trashing a file,
   leave pages in place; when purging, delete the whole `pages/<userId>/<fileId>/` directory.
5. Treat a job as lost if it has no result and the heartbeat is stale; surface "converter not running". A
   `pending` job simply waits.
6. Retries are new jobs for the same `fileId` (new `jobId`); the output directory is replaced only on success.
7. Make the data directories usable by both containers: the converter runs as `${CONVERTER_USER:-10001:10001}`
   and must be able to create `pages/<userId>/` and rename inside `queue/*`; its files are created with
   umask 002 (mode 664, directories 775). Either create `pages/` and `queue/` as group-writable with a shared
   group (`group_add` in compose), or set `CONVERTER_USER` to the server's uid:gid.
8. The marker-file check for the external drive belongs to the server; the converter only refuses to start when
   `originals/` is absent.

## Image and toolchain

`deploy/converter.Dockerfile`, built from the repository root, two stages: Node 25 (trixie slim) installs and
compiles, `pnpm deploy --prod` assembles production dependencies only; the runtime stage is Debian trixie slim
(arm64) with LibreOffice Impress headless, poppler, libheif with libde265 (`heif-dec`, since sharp's prebuilt
binaries cannot decode HEVC), util-linux (`prlimit`), and the Liberation, Carlito, Caladea, Noto and DejaVu
fonts, plus the Node binary. Pages are rasterised by poppler (PPTX goes through LibreOffice to PDF first),
encoded by sharp. Versions are recorded in every result's `toolVersions`.

## Testing

- `pnpm --filter @notes/converter test`: unit tests without Docker. The queue state machine runs against a fake
  converter (claim, success, failure, crash recovery, retry cap, malformed job files, path-escape attempts in
  every job field, symlinked or tampered originals, half-written files, shutdown, heartbeat); the child-process
  runner against stub children (timeout, memory watchdog, abort, killed, crashed, clean environment, scratch
  cleanup); detection; and agreement with `@notes/schema` (error codes, limits, id shapes).
- `apps/converter/scripts/integration.sh`: builds the image, runs it with the compose fragment against a temp
  data directory, plays the server for every fixture in `fixtures/`, and checks results, originals by checksum,
  that nothing is written outside `pages/` and `queue/`, and the sandbox. It also restarts the container for
  the limit cases, a SIGTERM, and crash recovery. Not part of `pnpm gate` (needs Docker; CI runs only on
  request).
- Fixtures and their expected outcomes: `fixtures/README.md`, `fixtures/expectations.json`.
