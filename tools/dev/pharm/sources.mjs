// The demo files and the helpers that point at their pages, shared by both pharmacy seeders.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "../env.mjs";

/** fixtures/demo/files/manifest.json: every file with its pages, transcripts and flags. */
export function loadManifest() {
  return JSON.parse(readFileSync(join(root, "fixtures", "demo", "files", "manifest.json"), "utf8"));
}

/**
 * Citation and page helpers over uploaded files. `byKey` is the manifest by key, `uploads` the
 * uploaded file per key and `pages` its pages in order. `c` refuses a quote that is not in the
 * transcript of that page, so every citation really is in her sources.
 */
export function sourceHelpers({ byKey, uploads, pages }) {
  return {
    c(key, n, quote) {
      const entry = byKey[key];
      const page = pages[key]?.[n - 1];
      if (!entry || !page) throw new Error(`No page ${n} in ${key}`);
      if (!entry.pages[n - 1].text.includes(quote)) {
        throw new Error(
          `Quote not in the transcript of ${entry.name} page ${n}: ${JSON.stringify(quote)}`,
        );
      }
      const label = entry.file.endsWith(".pptx")
        ? `Slide ${n}`
        : entry.file.endsWith(".jpg")
          ? "Photo"
          : `Page ${n}`;
      return { fileId: uploads[key].id, pageId: page.id, quote, label };
    },
    page: (key, n) => ({ fileId: uploads[key].id, pageId: pages[key][n - 1].id }),
    hot(key) {
      const points = byKey[key].hotspots.points;
      return Object.fromEntries(Object.entries(points).map(([k, [x, y]]) => [k, { x, y }]));
    },
  };
}
