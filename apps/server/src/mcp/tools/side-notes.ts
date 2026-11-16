import { DocumentId } from "@notes/schema";
import { z } from "zod";
import type { AgentMarginNote, RecentMarginNote } from "../../domains/margin-notes/index.js";
import { AppError } from "../../http/errors.js";
import { exampleId } from "../errors.js";
import type { MarginNotesToolPort } from "../ports.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { defineTool, parseAction, type ToolContext } from "../tool.js";

const DOC = exampleId("document");

function port(ctx: ToolContext): MarginNotesToolPort {
  const p = ctx.backend.marginNotes;
  if (!p) throw new AppError("internal", "Side notes are not available.");
  return p;
}

/** One note in a line: the anchor first (so the agent can find the block), then her words. */
function noteLine(n: AgentMarginNote): string {
  const state = [
    n.resolved ? "resolved" : "open",
    n.detached ? "detached: its block is gone" : "",
    n.colour ? n.colour : "",
  ].filter(Boolean);
  const anchor = n.detached
    ? `was on block ${n.blockId} ("${n.snippet}")`
    : `on ${n.blockType ?? "block"} ${n.blockId} ("${n.snippet}")`;
  return [
    `- ${n.id} (${state.join(", ")}) ${anchor}`,
    n.quote ? `, about the words "${n.quote}"` : "",
    `, written ${n.createdAt}: ${n.text.replace(/\n+/g, " / ")}`,
  ].join("");
}

function recentLine(n: RecentMarginNote): string {
  return `${noteLine(n)} [in "${n.documentTitle}", document ${n.documentId}]`;
}

const BRANCHES = {
  list: z.strictObject({ documentId: DocumentId }),
  recent: z.strictObject({ limit: z.number().int().min(1).max(100).default(20) }),
};
type Action = keyof typeof BRANCHES;

const EXAMPLES: Record<Action, Record<string, unknown>> = {
  list: { action: "list", documentId: DOC },
  recent: { action: "recent", limit: 20 },
};

/**
 * side_notes: read her private margin notes. Read only by design: they are hers, so the tool
 * offers no way to add, change or delete one (the HTTP routes refuse every API key too).
 */
export const sideNotesTool = defineTool({
  name: "side_notes",
  title: "Her side notes (read only)",
  description:
    'Her private side notes: remarks she keeps in the margin of a document, each beside one block (sometimes about a few quoted words). They tell you where she is confused or what she wants changed. Read them before revising a document: "list" a document\'s notes (open ones first, in block order; detached ones lost their block and say what it was), then address her open notes in your edits or in a request reply. "recent" lists her open notes across all documents, newest first. You cannot create, edit or delete them; only she can. Writing blocks never changes a note; a note whose block you delete or regenerate shows to her as detached.',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: describe(
    flattenActions(
      "action",
      Object.fromEntries(Object.entries(BRANCHES).map(([k, v]) => [k, jsonOf(v)])),
      '"list" her notes on one document; "recent" her open notes across documents.',
    ),
    {
      documentId: `list: the document, e.g. "${DOC}".`,
      limit: "recent: how many, newest first (default 20, at most 100).",
    },
  ),
  parse: (raw) => parseAction("side_notes", "action", BRANCHES, EXAMPLES, raw),
  writes: () => false,
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const p = port(ctx);
    const { action, value } = input as unknown as {
      action: Action;
      value: Record<string, unknown>;
    };
    if (action === "list") {
      const v = value as z.output<typeof BRANCHES.list>;
      const { document, items } = p.forAgent(ctx.auth, v.documentId);
      const open = items.filter((n) => !n.resolved).length;
      const lines = [
        `${items.length} side note(s) of hers on "${document.title}" (document ${document.id}), ${open} open. Her private remarks: address the open ones; you cannot change them.`,
        ...items.map(noteLine),
      ];
      return { text: lines.join("\n"), structured: { document, items } };
    }
    const v = value as z.output<typeof BRANCHES.recent>;
    const items = p.recent(ctx.auth, { limit: v.limit });
    const lines = [
      `${items.length} open side note(s) of hers, newest first. Her private remarks: address them in your edits or a request reply; you cannot change them.`,
      ...items.map(recentLine),
    ];
    return { text: lines.join("\n"), structured: { items } };
  },
});
