import { AppError } from "../http/errors.js";
import type { ToolContext } from "./tool.js";

/**
 * Citation quotes are checked by the domains (character for character, after
 * collapsing whitespace, against the page's transcript, native text and
 * speaker notes). Agents that get one wrong tend to give up and mark the
 * content general knowledge instead (seen in the live check). So before a
 * write, the MCP layer runs the same check over every citation in the input
 * and, for each quote not found, names its path and suggests the closest
 * passage that IS on the page, ready to copy.
 */

const norm = (text: string) => text.replace(/\s+/gu, " ").trim();
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}.]+/u)
      .filter((w) => w.length > 1),
  );

interface Found {
  path: string;
  pageId: string;
  quote: string;
}

/** Every object with a pageId and a quote, with its JSON path. */
function citationsIn(value: unknown, path: string, out: Found[]): Found[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      citationsIn(v, `${path}[${i}]`, out);
    });
  } else if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.pageId === "string" && typeof o.quote === "string") {
      out.push({ path, pageId: o.pageId, quote: o.quote });
    }
    for (const [k, v] of Object.entries(o)) citationsIn(v, `${path}.${k}`, out);
  }
  return out;
}

/** The page's texts as the domains read them, or null when the page cannot be read. */
function pageTexts(ctx: ToolContext, pageId: string): string[] | null {
  const files = ctx.backend.files;
  if (!files) return null;
  try {
    const page = files.getPage(ctx.auth, pageId);
    const t = files.getTranscript(ctx.auth, pageId);
    return [t?.text, page.nativeText, page.speakerNotes]
      .filter((x): x is string => typeof x === "string")
      .map(norm)
      .filter((x) => x !== "");
  } catch {
    return null; // a missing page is the domain's error to report
  }
}

/** The passage of the page (a line or sentence) sharing the most words with the quote. */
export function closestPassage(texts: readonly string[], quote: string): string | null {
  const want = words(quote);
  let best: { text: string; score: number } | null = null;
  for (const text of texts) {
    for (const piece of text.split(/(?<=[.!?])\s+|\s*[•·]\s*|\s{2,}/u)) {
      const candidate = piece.trim();
      if (candidate.length < 3) continue;
      const have = words(candidate);
      let shared = 0;
      for (const w of want) if (have.has(w)) shared++;
      const score = shared / Math.max(1, Math.max(want.size, have.size) ** 0.5 * want.size ** 0.5);
      if (shared > 0 && (!best || score > best.score)) best = { text: candidate, score };
    }
  }
  return best ? best.text.slice(0, 300) : null;
}

/**
 * Refuse, before anything is written, citations whose quote is not on its
 * page, each with the closest passage to copy. Pages without any text yet
 * are left to the domain (it accepts them; transcribe first).
 */
export function checkQuotes(ctx: ToolContext, input: unknown, root = "$"): void {
  const problems: string[] = [];
  let example: unknown;
  for (const c of citationsIn(input, root, [])) {
    const texts = pageTexts(ctx, c.pageId);
    if (!texts || texts.length === 0) continue;
    const quote = norm(c.quote);
    if (quote !== "" && texts.some((t) => t.includes(quote))) continue;
    const near = closestPassage(texts, quote);
    problems.push(
      `${c.path}.quote "${c.quote.slice(0, 80)}" is not on page ${c.pageId}${near ? `; the closest passage there is "${near}"` : ""}`,
    );
    example ??= { pageId: c.pageId, quote: near ?? "(copy a sentence from the page)" };
  }
  if (problems.length === 0) return;
  throw new AppError(
    "invalid_input",
    `${problems.length} citation quote(s) are not on the cited page: ${problems.slice(0, 8).join(" | ")}${problems.length > 8 ? " | …" : ""}`,
    {
      hint: 'A quote must be copied character for character from the page\'s transcript or slide text (get_item {"id":"fil_…","text":true} shows them all). Use the closest passage above, or cite another page. Mark content generalKnowledge only when it truly is not in her material.',
      example,
    },
  );
}
