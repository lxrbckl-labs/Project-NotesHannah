# Spike S5: sandboxed file conversion

Run 2026-11-15 on Docker, linux/arm64. Written by the integrator from the worker's report.

## Verdict

Works. 24 of 24 fixtures behaved as expected through the sandbox, with 65 of 65 content checks.

## Toolchain

| Piece | Version | Licence |
|---|---|---|
| Base image | Debian trixie-slim arm64 | |
| LibreOffice Impress (headless) | 25.2.3 | MPL-2.0 |
| poppler (run as separate processes) | 25.03 | GPL |
| libheif + libde265 (`heif-dec`) | 1.23.6 | LGPL-3 |
| sharp / libvips | 0.34.5 / 8.17.3 | Apache-2.0 / LGPL |
| Node with yauzl, fast-xml-parser | 24 | MIT |
| Fonts: Liberation, Carlito, Caladea, Noto, DejaVu | | OFL, Apache-2.0, Bitstream Vera |

sharp's prebuilt binaries do not decode HEIC, so HEIC goes through `heif-dec`.
Image size: 700 MB on disk, about 247 MB compressed.

## Results

| Fixture | Result | Time |
|---|---|---|
| 12-slide PPTX | text, speaker notes and tables match; hidden slide kept | 3.4 s, 188 MB peak |
| PDF with text layer; image-only PDF | text-layer flags correct | 1.4 s; 2.5 s |
| JPEG and PNG with EXIF rotation; HEIC | upright; HEIC decoded | 0.6 to 0.8 s |
| Files with a lying extension | detected by content | 0.6 to 3.0 s |
| Encrypted, corrupt, zip bomb, pixel bomb, too many pages, too large, timeout, unsupported | rejected with the right code, nothing written | 0.3 to 1.5 s |

A 301-page PDF took 47 s and 160 MB (about 0.16 s per page). A 2000 px long edge costs
31 to 47 percent more bytes than 1568 px.

## Sandbox, probed from inside the container

All held: no network, read-only root and input, non-root user (uid 10001), no
capabilities, no-new-privileges, `noexec` on `/tmp`, memory limit (OOM-killed a stress
process), PID limit (blocked a fork loop), wall-clock watchdog.

## Gaps

- Slide rendering tested on plain slides only: no SmartArt, charts or gradients.
- Impress has no external-link setting; the protection is the missing network.
- Not tested: a real macro payload, a lying zip header, HEIC with a rotation box, real lecture decks.

## Decision for the production worker

Container-per-job needs Docker access from the app, which is root-equivalent. The
production worker is instead one long-lived, locked-down converter container (no
network, read-only root, non-root, no capabilities) that takes jobs from a queue
directory on a shared volume and runs each conversion as a resource-limited subprocess.
See `docs/converter.md`.
