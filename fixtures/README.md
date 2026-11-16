# Fixtures

Stand-in files for the converter's tests. All content is made up (no third-party material).

- `generated/` holds the files (about 3.5 MB, committed so tests need no Docker to read them).
- `expectations.json` says what the converter must do with each one: type, page count, text and notes it
  must find, warnings, or the error code and reason. `apps/converter/scripts/integration-check.mjs` reads it.
- `generator/` rebuilds `generated/` from scratch: `fixtures/generator/build.sh` (needs Docker). The generator
  is `make_fixtures.py` (python-pptx, Pillow, reportlab, pikepdf, msoffcrypto-tool, and `heif-enc` for HEIC).

| File | What it is |
|---|---|
| `lecture.pptx` (+ `lecture.expected.json`) | 12 slides: bullets, tables, a picture, speaker notes, fonts, a hidden slide |
| `deck-visual.pptx` (+ `deck-visual.expected.json`) | gradient background, a native chart, nested grouped shapes standing in for SmartArt |
| `macro.pptx`, `macro.pptm` | the visual deck carrying an inert `vbaProject.bin` part; the `.pptm` also declares the macro-enabled content type |
| `text-layer.pdf`, `image-only.pdf` | 5 pages with text; 4 pages of handwriting-like images with no text |
| `photo-exif6.jpg`, `photo-exif3.png` | stored sideways / upside down with EXIF orientation 6 / 3 |
| `photo.heic`, `photo-rotated.heic` | HEVC HEIC, the second stored sideways with an `irot` transform box |
| `encrypted-userpw.pdf`, `encrypted.pptx` | need a password |
| `encrypted-ownerpw-only.pdf` | restricted but opens with an empty password |
| `truncated.pptx`, `junkxml.pptx`, `corrupt.pdf`, `truncated.jpg` | damaged |
| `zipbomb.pptx`, `lying-zip-header.pptx`, `pixelbomb.png` | 700 MB of zeros in a zip; the same with a header that lies about the size; 20000 x 20000 PNG |
| `toomany-501pages.pdf` | one page over the 500-page limit |
| `other-office.docx`, `plain-text.pdf` | not a presentation; text with a `.pdf` name |

The converter never sees a file name (originals are stored under their SHA-256), so "lying extension" cases
reduce to the content cases above. Too-large and a few other cases are made at run time by the integration
script (a sparse 201 MiB file, an empty file, a legacy `.ppt` header, random bytes).
