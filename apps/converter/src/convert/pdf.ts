import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Limits } from "../config.js";
import { ConvertError, cleanMessage } from "../errors.js";
import { type Deadline, run } from "./exec.js";

export interface PdfInfo {
  pages: number;
  encryptedButReadable: boolean;
}

export async function pdfInfo(file: string, deadline: Deadline): Promise<PdfInfo> {
  const r = await run(deadline, "pdfinfo", ["-enc", "UTF-8", file]);
  const err = r.stderr;
  if (r.code !== 0) {
    if (/incorrect password|password/i.test(err))
      throw new ConvertError("encrypted_file", "PDF requires a password");
    throw new ConvertError(
      "corrupt_file",
      `pdfinfo failed: ${cleanMessage(err.trim().split("\n")[0] ?? "")}`,
    );
  }
  const out = r.stdout.toString("utf8");
  const pages = Number(/^Pages:\s+(\d+)/m.exec(out)?.[1] ?? 0);
  if (!pages) throw new ConvertError("corrupt_file", "PDF has no pages");
  return { pages, encryptedButReadable: /^Encrypted:\s+yes/m.test(out) };
}

/**
 * Render a single page to a PNG in scratch and return its bytes. The long edge is exactly `lim.pageLongEdge`
 * pixels, so output size is bounded regardless of the page's declared size. (poppler 25.03 cannot write a PNG to stdout.)
 */
export async function renderPage(
  file: string,
  page: number,
  lim: Limits,
  scratch: string,
  deadline: Deadline,
): Promise<Buffer> {
  const prefix = path.join(scratch, `pg-${page}`);
  const r = await run(deadline, "pdftoppm", [
    "-png",
    "-singlefile",
    "-scale-to",
    String(lim.pageLongEdge),
    "-f",
    String(page),
    "-l",
    String(page),
    file,
    prefix,
  ]);
  if (r.code !== 0) {
    if (r.signal === "SIGKILL")
      throw new ConvertError(
        "conversion_failed",
        `pdftoppm was killed on page ${page}`,
        "resource_limit",
      );
    throw new ConvertError(
      "corrupt_file",
      `pdftoppm failed on page ${page}: ${cleanMessage(r.stderr.trim().split("\n")[0] ?? "")}`,
    );
  }
  const buf = await readFile(`${prefix}.png`);
  await rm(`${prefix}.png`, { force: true });
  return buf;
}

/** One call, pages separated by form feed. Returns exactly `pages` strings. */
export async function pdfText(
  file: string,
  pages: number,
  deadline: Deadline,
): Promise<{ texts: string[]; restricted: boolean }> {
  const r = await run(deadline, "pdftotext", ["-enc", "UTF-8", file, "-"]);
  if (r.code !== 0) {
    // e.g. permissions forbid copying text. Not fatal: the page images are the product.
    return { texts: Array.from({ length: pages }, () => ""), restricted: true };
  }
  const parts = r.stdout.toString("utf8").split("\f");
  const texts = Array.from({ length: pages }, (_, i) => (parts[i] ?? "").replace(/\s+$/g, ""));
  return { texts, restricted: false };
}

export function hasTextLayer(text: string): boolean {
  return text.replace(/\s+/g, "").length >= 3;
}
