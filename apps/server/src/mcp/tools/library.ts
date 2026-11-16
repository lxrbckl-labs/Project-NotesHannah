import {
  CreateNodeInput,
  MoveNodeInput,
  NodeId,
  type NodeWithLinks,
  PageRequest,
  UpdateNodeInput,
} from "@notes/schema";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import { exampleId, translateLibraryError } from "../errors.js";
import { childKindsOf, json, type NodeItem, nodeItem, nodeLine, placementRule } from "../format.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { defineTool, parseAction, parseWith, type ToolContext } from "../tool.js";

const NODE = exampleId("node");
const Cursor = PageRequest.shape.cursor;
const limit = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback);

const CURSOR_TEXT =
  "Opaque paging cursor: pass the nextCursor of the previous result unchanged; omit for the first page.";

// ---------------------------------------------------------------------------
// browse_library
// ---------------------------------------------------------------------------

const BrowseInput = z.strictObject({
  parentId: NodeId.nullable().optional(),
  view: z.enum(["children", "trash", "favourites", "recents"]).default("children"),
  cursor: Cursor,
  limit: limit(100, 50),
});

function parentKindOf(ctx: ToolContext, parentId: string | null): NodeWithLinks | null {
  return parentId === null ? null : ctx.library.get(ctx.userId, parentId);
}

export const browseLibrary = defineTool({
  name: "browse_library",
  title: "Browse the library tree",
  description: `List what is inside one place of her library: the top level (no parentId), or the children of a term, course, section, folder or lecture (parentId), in display order. Also lists the trash, favourites or recently changed items with "view". Items are light (id, kind, name, path, how many items are inside); open one fully with get_item. The library tree is term > course > section (Sources, Lectures, Study guides, Practice, Exams; fixed) > folder > lecture or document. Paged: at most "limit" items, then pass nextCursor.`,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: describe(jsonOf(BrowseInput), {
    parentId: `The node whose children to list, e.g. "${NODE}". Omit or null for the top level of the library. Only used with view "children".`,
    view: `"children" (default) lists one level of the tree; "trash" lists trashed items (restore them with edit_library); "favourites" and "recents" list those across the library.`,
    cursor: CURSOR_TEXT,
    limit: "How many items per page, 1 to 100 (default 50).",
  }),
  parse: (raw) =>
    parseWith("browse_library", BrowseInput, raw, { parentId: NODE, limit: 50 }) as z.output<
      typeof BrowseInput
    >,
  writes: () => false,
  action: (input) => input.view,
  run(ctx, input) {
    const parentId = input.parentId ?? null;
    let page: { items: NodeWithLinks[]; nextCursor: string | null };
    let heading: string;
    let parent: NodeWithLinks | null = null;
    if (input.view === "children") {
      try {
        parent = parentKindOf(ctx, parentId);
        page = ctx.library.list(ctx.userId, {
          parentId,
          cursor: input.cursor,
          limit: input.limit,
        });
      } catch (error) {
        throw translateLibraryError(error, null, parentId ?? undefined);
      }
      if (parent?.trashedAt) {
        throw new AppError("conflict", `"${parent.name}" is in the trash.`, {
          hint: `List the trash with browse_library {"view":"trash"}, or restore it with edit_library {"action":"restore","id":"${parent.id}"}.`,
          example: { action: "restore", id: parent.id },
        });
      }
      heading = parent
        ? `Inside ${parent.kind} "${parent.path}" (${parent.id}). ${placementRule(parent.kind)}`
        : `Top level of the library. ${placementRule(null)}`;
    } else if (input.view === "trash") {
      page = ctx.library.listTrash(ctx.userId, { cursor: input.cursor, limit: input.limit });
      heading = `Trash (top-most trashed item of each subtree). Restore with edit_library {"action":"restore","id":"…"}; only she can delete for good.`;
    } else if (input.view === "favourites") {
      page = ctx.library.favourites(ctx.userId);
      heading = "Favourites.";
    } else {
      page = ctx.library.recents(ctx.userId, { limit: input.limit });
      heading = "Recently opened or changed.";
    }
    const items = page.items.map(nodeItem);
    const lines = [heading, ...items.map(nodeLine)];
    if (items.length === 0) {
      if (input.view === "children" && parentId === null) {
        lines.push(
          `The library is empty. Start with a term: edit_library ${json({ action: "create", parentId: null, kind: "term", name: "Fall 2026" })}`,
        );
      } else lines.push("(nothing here)");
    }
    if (page.nextCursor) {
      lines.push(`More items: call browse_library again with cursor "${page.nextCursor}".`);
    }
    return {
      text: lines.join("\n"),
      structured: {
        view: input.view,
        parent: parent ? nodeItem(parent) : null,
        canCreateHere: input.view === "children" ? childKindsOf(parent?.kind ?? null) : [],
        items,
        nextCursor: page.nextCursor,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// edit_library
// ---------------------------------------------------------------------------

const IdOnly = z.strictObject({ id: NodeId });

const EDIT_BRANCHES = {
  create: z.strictObject(CreateNodeInput.shape),
  update: z.strictObject({ id: NodeId, ...UpdateNodeInput.shape }),
  move: z.strictObject({ id: NodeId, ...MoveNodeInput.shape }),
  duplicate: IdOnly,
  trash: IdOnly,
  restore: IdOnly,
};
type EditAction = keyof typeof EDIT_BRANCHES;

export const EDIT_EXAMPLES: Record<EditAction, Record<string, unknown>> = {
  create: {
    action: "create",
    parentId: NODE,
    kind: "lecture",
    name: "Beta blockers",
    lecture: { number: 7, date: "2026-10-14" },
  },
  update: { action: "update", id: NODE, name: "New name" },
  move: { action: "move", id: NODE, parentId: NODE, afterId: null },
  duplicate: { action: "duplicate", id: NODE },
  trash: { action: "trash", id: NODE },
  restore: { action: "restore", id: NODE },
};

const editSchema = describe(
  flattenActions(
    "action",
    Object.fromEntries(Object.entries(EDIT_BRANCHES).map(([k, v]) => [k, jsonOf(v)])),
    'What to do: "create" a node; "update" its name or details (rename); "move" it to another parent or position; "duplicate" it with everything inside; "trash" it with everything inside (restorable); "restore" it from the trash.',
  ),
  {
    id: `The node to change, e.g. "${NODE}".`,
    parentId: `create: where the new node goes. move: the new parent. null means the top level (only terms live there). Example "${NODE}".`,
    kind: 'create: "term" (top level), "course" (in a term; its five sections are made for you), "folder", "lecture" or "document" (in a section, a folder, or for a document also a lecture).',
    name: "create: the name. update: the new name (this is how to rename). 1 to 200 characters.",
    course: 'Course details (only for a course), e.g. {"code": "PHAR 7340"}.',
    "course.code": 'Catalogue code such as "PHAR 7340", or null.',
    lecture:
      'Lecture details (only for a lecture), e.g. {"number": 7, "date": "2026-10-14"}. Lectures sort by number; give both fields (null when unknown).',
    "lecture.number": "Teaching order within the course, 0 to 999, or null.",
    "lecture.date": 'The day it was taught, "YYYY-MM-DD", or null.',
    favourite: "update: mark or unmark as a favourite.",
    afterId:
      "move: put it right after this sibling in the destination; null puts it first; omit to put it last.",
  },
);

function describeCreated(node: NodeItem, sections: NodeItem[]): string {
  const lines = [`Created ${node.kind} "${node.label}" (${node.id}) at "${node.path}".`];
  if (sections.length > 0) {
    lines.push("Its sections (fixed):", ...sections.map(nodeLine));
  }
  lines.push(placementRule(node.kind));
  return lines.join("\n");
}

export const editLibrary = defineTool({
  name: "edit_library",
  title: "Create, rename, move, duplicate, trash or restore library items",
  description: `Change the library tree with one "action": create, update (rename or change details), move, duplicate, trash, restore. Placement rules: top level holds terms; a term holds courses; a course holds exactly its five fixed sections (Sources, Lectures, Study guides, Practice, Exams), created automatically and never changed by hand; a section or folder holds folders, lectures and documents; a lecture holds documents. Lectures carry a number and date and sort in teaching order. Trash is restorable; permanent deletion is only possible for her, in the browser. A refused change returns the rule and a valid example. Needs a read-write key.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: editSchema,
  parse(raw) {
    const action = (raw as { action?: unknown } | undefined)?.action;
    if (action === "delete" || action === "permanent_delete" || action === "empty_trash") {
      throw new AppError(
        "forbidden",
        "Agents cannot delete permanently. Only she can, from the trash in the browser.",
        {
          hint: 'Use action "trash" instead; it is restorable and she can empty the trash herself.',
          example: EDIT_EXAMPLES.trash,
        },
      );
    }
    if (action === "rename") {
      throw new AppError("invalid_input", 'There is no "rename" action: rename with "update".', {
        hint: 'Send action "update" with the node id and the new name.',
        example: EDIT_EXAMPLES.update,
      });
    }
    return parseAction("edit_library", "action", EDIT_BRANCHES, EDIT_EXAMPLES, raw);
  },
  writes: () => true,
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const { action, value } = input as ReturnType<typeof parseAction<typeof EDIT_BRANCHES>> as {
      action: EditAction;
      value: Record<string, unknown>;
    };
    const id = typeof value.id === "string" ? value.id : undefined;
    let node: NodeWithLinks;
    try {
      switch (action) {
        case "create":
          node = ctx.library.create(ctx.userId, value as z.output<typeof EDIT_BRANCHES.create>);
          break;
        case "update": {
          const { id: _id, ...changes } = value as z.output<typeof EDIT_BRANCHES.update>;
          node = ctx.library.update(ctx.userId, id as string, changes);
          break;
        }
        case "move": {
          const { id: _id, ...to } = value as z.output<typeof EDIT_BRANCHES.move>;
          node = ctx.library.move(ctx.userId, id as string, to);
          break;
        }
        case "duplicate":
          node = ctx.library.duplicate(ctx.userId, id as string);
          break;
        case "trash":
          node = ctx.library.trash(ctx.userId, id as string);
          break;
        case "restore":
          node = ctx.library.restore(ctx.userId, id as string);
          break;
      }
    } catch (error) {
      throw translateLibraryError(error, action, id);
    }
    const item = nodeItem(node);
    let sections: NodeItem[] = [];
    if (action === "create" && node.kind === "course") {
      sections = ctx.library.list(ctx.userId, { parentId: node.id, limit: 10 }).items.map(nodeItem);
    }
    const verbs: Record<EditAction, string> = {
      create: "",
      update: "Updated",
      move: "Moved",
      duplicate: "Duplicated as",
      trash: "Trashed",
      restore: "Restored",
    };
    const text =
      action === "create"
        ? describeCreated(item, sections)
        : action === "trash"
          ? `Trashed ${item.kind} "${item.label}" (${item.id}) and everything inside it. Undo with edit_library {"action":"restore","id":"${item.id}"}.`
          : `${verbs[action]} ${item.kind} "${item.label}" (${item.id}), now at "${item.path}".`;
    return {
      text,
      structured: { action, node: item, ...(sections.length ? { sections } : {}) },
      targets: [node.id, ...(id && id !== node.id ? [id] : [])],
    };
  },
});

// ---------------------------------------------------------------------------
// search_notes
// ---------------------------------------------------------------------------

export function searchTool(ctx: {
  transcripts: boolean;
  documents: boolean;
}): ReturnType<typeof defineTool> {
  const scopes = [
    "library",
    ...(ctx.transcripts ? ["transcripts"] : []),
    ...(ctx.documents ? ["documents"] : []),
  ] as [string, ...string[]];
  const SearchInput = z.strictObject({
    query: z.string().trim().min(1).max(200),
    scope: z.enum(scopes).default("library"),
    cursor: Cursor,
    limit: limit(50, 20),
  });
  const scopeText = [
    '"library" (default): names of terms, courses, folders, lectures and documents',
    ctx.transcripts ? '"transcripts": the text of transcribed pages' : null,
    ctx.documents ? '"documents": the text of study material' : null,
  ]
    .filter(Boolean)
    .join("; ");
  return defineTool({
    name: "search_notes",
    title: "Search her notes",
    description: `Find things by words. Scopes: ${scopeText}. Each hit has the ID to open with get_item and a short snippet. Matching is by word prefix ("beta" finds "Beta blockers"). Paged with cursor.`,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: describe(jsonOf(SearchInput), {
      query: 'Words to look for, e.g. "beta blockers". 1 to 200 characters.',
      scope: `Where to search: ${scopeText}.`,
      cursor: CURSOR_TEXT,
      limit: "Hits per page, 1 to 50 (default 20).",
    }),
    parse: (raw) =>
      parseWith("search_notes", SearchInput, raw, { query: "beta blockers" }) as z.output<
        typeof SearchInput
      >,
    writes: () => false,
    action: (input) => input.scope,
    run(c, input) {
      const opts = { cursor: input.cursor, limit: input.limit };
      let hits: Array<Record<string, unknown>>;
      let nextCursor: string | null;
      let lines: string[];
      if (input.scope === "transcripts" && c.ports.files?.searchTranscripts) {
        const page = c.ports.files.searchTranscripts(c.userId, input.query, opts);
        hits = page.items.map((h) => ({ ...h }));
        nextCursor = page.nextCursor;
        lines = page.items.map(
          (h) =>
            `- page ${h.pageId} (p.${h.pageIndex} of "${h.fileName}", transcript ${h.transcriptId}): ${h.snippet}`,
        );
      } else if (input.scope === "documents" && c.ports.documents?.searchDocuments) {
        const page = c.ports.documents.searchDocuments(c.userId, input.query, opts);
        hits = page.items.map((h) => ({ ...h }));
        nextCursor = page.nextCursor;
        lines = page.items.map(
          (h) =>
            `- ${h.blockId ?? h.documentId} in "${h.title}" (document ${h.documentId}): ${h.snippet}`,
        );
      } else {
        const page = c.library.search(c.userId, { q: input.query, ...opts });
        hits = page.items.map((h) => ({ ...nodeItem(h.node), snippet: h.snippet }));
        nextCursor = page.nextCursor;
        lines = page.items.map((h) => `${nodeLine(nodeItem(h.node))} at "${h.node.path}"`);
      }
      const head = `${hits.length} hit${hits.length === 1 ? "" : "s"} for "${input.query}" in ${input.scope}.`;
      if (nextCursor) lines.push(`More: call search_notes again with cursor "${nextCursor}".`);
      return {
        text: [head, ...lines].join("\n"),
        structured: { scope: input.scope, query: input.query, hits, nextCursor },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// changes
// ---------------------------------------------------------------------------

const ChangesInput = z.strictObject({
  cursor: z.string().max(400).optional(),
  since: z.iso.datetime().optional(),
  limit: limit(200, 100),
});

export const changesTool = defineTool({
  name: "changes",
  title: "What changed since",
  description:
    "The change feed: what was created, changed, moved, trashed or restored since your last call (pass the returned cursor) or since a time. Oldest first. Use it at the start of a session to see what she did since the last agent session.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: describe(jsonOf(ChangesInput), {
    cursor: "The cursor returned by the previous changes call; omit on the first call.",
    since:
      'On the first call: report changes after this time (ISO 8601, e.g. "2026-11-15T09:00:00Z"). Default: the last 24 hours.',
    limit: "Most changes to return, 1 to 200 (default 100).",
  }),
  parse: (raw) =>
    parseWith("changes", ChangesInput, raw, { since: "2026-11-15T09:00:00Z" }) as z.output<
      typeof ChangesInput
    >,
  writes: () => false,
  action: () => null,
  run(ctx, input) {
    const port = ctx.ports.changes;
    if (!port) throw new AppError("internal", "The change feed is not available.");
    const result = port.changesSince(ctx.userId, input);
    const lines = result.items.map(
      (c) => `- ${c.at} ${c.change} ${c.kind} ${c.id}${c.name ? ` "${c.name}"` : ""}`,
    );
    lines.unshift(`${result.items.length} change(s). Next time pass cursor "${result.cursor}".`);
    if (result.more) lines.push("More changes waiting: call changes again with that cursor now.");
    return { text: lines.join("\n"), structured: { ...result } };
  },
});
