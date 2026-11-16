/**
 * File names from clients are display text only. They are cleaned here, stored
 * for showing, and never used to build a path (originals are named by their
 * SHA-256, page images by index).
 */

const MAX_NAME_LENGTH = 200;

/** Characters that are never kept: C0/C1 controls, DEL, bidi overrides, zero-width and line separators. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/gu;
const SEPARATORS = /[/\\:*?"<>|]/g;

export function sanitizeFileName(raw: string): string {
  let name = raw.normalize("NFC").replace(INVISIBLE, " ").replace(SEPARATORS, "_");
  name = name.replace(/\s+/g, " ").trim();
  // No hidden files, no "." / ".." look-alikes.
  name = name.replace(/^[.\s]+/, "");
  const chars = [...name];
  if (chars.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = `${chars.slice(0, MAX_NAME_LENGTH - [...ext].length - 1).join("")}…${ext}`;
  }
  return name.length > 0 ? name : "file";
}

/** A `Content-Disposition` value with an ASCII fallback and the full name in `filename*`. */
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const safe = sanitizeFileName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
