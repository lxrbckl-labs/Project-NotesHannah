import {
  CreateReferenceInput,
  NodeId,
  REFERENCE_KINDS,
  REFERENCE_SITES,
  ReferenceKind,
  type ReferenceSite,
  type SavedReference,
} from "@notes/schema";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import { exampleId } from "../errors.js";
import type { ReferencesToolPort } from "../ports.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { defineTool, parseAction, type ToolContext } from "../tool.js";

const NODE = exampleId("node");

function port(ctx: ToolContext): ReferencesToolPort {
  const p = ctx.backend.references;
  if (!p) throw new AppError("internal", "References are not available.");
  return p;
}

function siteLines(site: ReferenceSite): string[] {
  return [
    `- ${site.name} <${site.home}>: ${site.blurb}${site.searchPattern ? ` Search: ${site.searchPattern} (words URL-encoded, spaces as +).` : ""}`,
    ...site.parts.map((p) => `  - ${p.label} <${p.href}>: for ${p.useFor}.`),
  ];
}

export function referenceLine(r: SavedReference): string {
  const places = r.places.filter((p) => !p.trashed);
  return [
    `- ${r.id} "${r.title}" <${r.url}>`,
    r.kind ? ` (${r.kind})` : "",
    r.source ? `, from ${r.source}` : "",
    r.favourite ? ", pinned" : "",
    places.length ? `. Tied to: ${places.map((p) => `${p.path} (${p.nodeId})`).join("; ")}` : "",
    r.note ? `. Her note: ${r.note}` : "",
  ].join("");
}

const BRANCHES = {
  list: z.strictObject({
    nodeId: NodeId.optional(),
    within: z.boolean().default(true),
    kind: ReferenceKind.optional(),
    query: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  add: z.strictObject({ ...CreateReferenceInput.shape }),
};
type Action = keyof typeof BRANCHES;

const EXAMPLES: Record<Action, Record<string, unknown>> = {
  list: { action: "list", nodeId: NODE },
  add: {
    action: "add",
    title: "ACC/AHA high blood pressure guideline",
    url: "https://doi.org/10.1161/HYP.0000000000000065",
    note: "BP targets and first-line choices.",
    kind: "guideline",
    nodeIds: [NODE],
  },
};

export const referencesTool = defineTool({
  name: "references",
  title: "Trusted references: PharmGuides and her saved pages",
  description:
    'Trusted outside references for checking and extending her notes: the built-in sites (PharmGuides: its guideline index, AntibioticDex, DoseDex, TNKalc, Pharmacy Notes, and its search address) and the pages she saved herself, tied to courses, lectures or documents. "list" them (optionally for one place and what is inside it) before writing or revising notes on a topic. When writing: her slides and notes come first; check the matching trusted reference with your own web access (DoseDex for emergency doses, AntibioticDex for spectrum, the guideline index for current guidelines); where they disagree keep her slide, cite it and add a source_conflict flag naming the reference; anything taken from a reference goes in the block\'s "references" so it is labelled apart from her sources, never as if it came from her slides. Summarise in your own words and link; never paste long passages, tables or figures from a site. "add" a saved reference only when she asks in a request. You cannot change or delete hers, and the app does not fetch pages for you.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describe(
    flattenActions(
      "action",
      Object.fromEntries(Object.entries(BRANCHES).map(([k, v]) => [k, jsonOf(v)])),
      '"list" her saved references; "add" one she asked for.',
    ),
    {
      nodeId: `list: only those tied to this place, e.g. "${NODE}".`,
      within: "list: with nodeId, also those tied to anything inside it (default true).",
      kind: `list: only this kind. add: one of $REFERENCE_KINDS.join(", "), or null.`,
      query: "list: words that must appear in the title, note or address.",
      limit: "list: how many (default 30).",
      title: "add: a short title in your own words, up to 200 characters.",
      url: "add: the page's full https address.",
      note: "add: one line on what it is for, in your own words (no copied text), up to 2000 characters.",
      nodeIds: "add: the courses, folders, lectures or documents it belongs with (up to 20).",
      favourite: "add: pin it to the top of her list (default false).",
    },
  ),
  parse: (raw) => parseAction("references", "action", BRANCHES, EXAMPLES, raw),
  writes: (input) => (input as { action: string }).action === "add",
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const p = port(ctx);
    const { action, value } = input as unknown as {
      action: Action;
      value: Record<string, unknown>;
    };
    if (action === "list") {
      const v = value as unknown as z.output<typeof BRANCHES.list>;
      const page = p.list(ctx.auth, {
        nodeId: v.nodeId,
        within: v.within,
        kind: v.kind,
        q: v.query,
        limit: v.limit,
      });
      const lines = [
        "Trusted built-in references (check them; link, do not copy):",
        ...REFERENCE_SITES.flatMap(siteLines),
        `${page.items.length} saved reference(s) of hers (trusted: she chose them).`,
        ...page.items.map(referenceLine),
      ];
      return {
        text: lines.join("\n"),
        structured: {
          builtIn: REFERENCE_SITES.map((s) => ({ ...s, trusted: true })),
          items: page.items.map((r) => ({ ...r, trusted: true })),
        },
      };
    }
    const r = p.create(ctx.auth, value);
    return {
      text: ["Saved:", referenceLine(r)].join("\n"),
      structured: { action, reference: r },
    };
  },
});
