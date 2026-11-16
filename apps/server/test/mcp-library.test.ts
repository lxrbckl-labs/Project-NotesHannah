import { describe, expect, test } from "vitest";
import { fakeChanges, fakeDocuments, fakeFiles } from "../src/mcp/fakes.js";
import { START_HERE_MAX_CHARS } from "../src/mcp/tools/start-here.js";
import { mcpSetup } from "./mcp-harness.js";

type Agent = Awaited<ReturnType<Awaited<ReturnType<typeof mcpSetup>>["agent"]>>;

interface Item {
  id: string;
  kind: string;
  name: string;
  label: string;
}

async function seed(a: Agent) {
  const term = (
    await a.ok("edit_library", {
      action: "create",
      parentId: null,
      kind: "term",
      name: "Fall 2026",
    })
  ).structured.node as Item;
  const created = await a.ok("edit_library", {
    action: "create",
    parentId: term.id,
    kind: "course",
    name: "Pharmacology II",
    course: { code: "PHAR 7340" },
  });
  const course = created.structured.node as Item;
  const sections = created.structured.sections as Item[];
  const lectures = sections.find((s) => s.name === "Lectures") as Item;
  return { term, course, sections, lectures, createdText: created.text };
}

/** Errors must never point an agent at the web API. */
function expectAgentFacing(error: { message: string; hint?: string; example?: unknown }) {
  expect(JSON.stringify(error)).not.toMatch(/\/api\//);
}

describe("start_here", () => {
  test("orients a new agent with live facts, within budget for every topic", async () => {
    const { agent } = await mcpSetup({
      ports: {
        files: fakeFiles().port,
        documents: fakeDocuments().port,
        changes: fakeChanges().port,
      },
    });
    const a = await agent("hannah");
    await seed(a);
    const r = await a.ok("start_here");
    expect(r.text).toContain("hannah's private study-notes app");
    expect(r.text).toContain("Your key is read-write");
    expect(r.text).toContain("Library: 1 term(s), 1 course(s)");
    expect(r.text).toContain(
      "Inbox: 0 file(s) not filed (0 converting, 0 ready, 0 failed); converter online.",
    );
    for (const word of [
      "Sources, Lectures, Study guides, Practice, Exams",
      "generalKnowledge",
      "dose",
      "source_files",
      "write_document",
    ]) {
      expect(r.text).toContain(word);
    }
    expect(r.structured.key).toEqual({ name: "agent", scope: "write" });
    // Both kinds of move are explained (topic library).
    const library = await a.ok("start_here", { topic: "library" });
    expect(library.text).toContain("Moving things");
    expect(library.text).toContain('edit_library {"action":"move"');
    expect(library.text).toContain('source_files {"action":"move"');
    for (const topic of [
      "overview",
      "workflow",
      "library",
      "transcription",
      "citations",
      "blocks",
      "practice",
      "concepts",
      "requests",
    ]) {
      const t = await a.ok("start_here", { topic });
      expect(t.text.length, topic).toBeLessThan(START_HERE_MAX_CHARS);
      expect(t.text.length, topic).toBeGreaterThan(200);
    }
    const blocks = await a.ok("start_here", { topic: "blocks" });
    expect(blocks.text).toContain("drug_card (cites)");
  });

  test("without the files and documents ports it does not mention their tools as available", async () => {
    const { agent } = await mcpSetup();
    const a = await agent("hannah");
    const r = await a.ok("start_here");
    expect(r.text).not.toContain("Inbox:");
    expect(r.text).not.toMatch(/- write_document:/);
    expect(r.text).not.toMatch(/- source_files:/);
    const library = await a.ok("start_here", { topic: "library" });
    expect(library.text).toContain("Uploaded files cannot be moved over MCP on this server yet.");
    expect(r.structured.tools).toEqual([
      "start_here",
      "browse_library",
      "get_item",
      "search_notes",
      "edit_library",
    ]);
  });
});

describe("library flows", () => {
  test("create a term, a course (with its sections) and numbered lectures; browse and open them", async () => {
    const { agent } = await mcpSetup();
    const a = await agent();
    const { term, course, sections, lectures, createdText } = await seed(a);
    expect(sections.map((s) => s.name)).toEqual([
      "Sources",
      "Lectures",
      "Study guides",
      "Practice",
      "Exams",
    ]);
    expect(createdText).toContain(lectures.id);
    for (const [n, name] of [
      [1, "Introduction to autonomic pharmacology"],
      [2, "Adrenergic agonists"],
      [3, "Beta blockers"],
    ] as const) {
      await a.ok("edit_library", {
        action: "create",
        parentId: lectures.id,
        kind: "lecture",
        name,
        lecture: { number: n, date: null },
      });
    }
    const listed = await a.ok("browse_library", { parentId: lectures.id });
    const items = listed.structured.items as Item[];
    expect(items.map((i) => i.label)).toEqual([
      "01 · Introduction to autonomic pharmacology",
      "02 · Adrenergic agonists",
      "03 · Beta blockers",
    ]);
    expect(listed.structured.canCreateHere).toEqual(["folder", "lecture", "document"]);
    expect(listed.text).toContain("you can create: folder, lecture, document");

    const got = await a.ok("get_item", { id: course.id });
    const links = got.structured.links as {
      parent: string;
      ancestors: Item[];
      children: Item[];
      canCreateHere: string[];
    };
    expect(links.parent).toBe(term.id);
    expect(links.ancestors.map((x) => x.name)).toEqual(["Fall 2026"]);
    expect(links.children).toHaveLength(5);
    expect(got.text).toContain("Path: Fall 2026 / Pharmacology II");

    const found = await a.ok("search_notes", { query: "beta" });
    expect((found.structured.hits as Array<{ node: Item }>).map((h) => h.node.name)).toEqual([
      "Beta blockers",
    ]);
  });

  test("rename, move, duplicate, trash and restore", async () => {
    const { agent } = await mcpSetup();
    const a = await agent();
    const { lectures, sections } = await seed(a);
    const guides = sections.find((s) => s.name === "Study guides") as Item;
    const folder = (
      await a.ok("edit_library", {
        action: "create",
        parentId: guides.id,
        kind: "folder",
        name: "Week 1",
      })
    ).structured.node as Item;
    const renamed = await a.ok("edit_library", {
      action: "update",
      id: folder.id,
      name: "Week one",
      favourite: true,
    });
    expect((renamed.structured.node as Item).name).toBe("Week one");
    const lecture = (
      await a.ok("edit_library", {
        action: "create",
        parentId: lectures.id,
        kind: "lecture",
        name: "Beta blockers",
        lecture: { number: 7, date: "2026-10-14" },
      })
    ).structured.node as Item;
    expect(lecture.label).toBe("07 · Beta blockers · Oct 14");
    const doc = (
      await a.ok("edit_library", {
        action: "create",
        parentId: folder.id,
        kind: "document",
        name: "Summary",
      })
    ).structured.node as Item;
    await a.ok("edit_library", { action: "move", id: doc.id, parentId: lecture.id });
    // Reorder: put the folder's sibling order explicitly, then move a lecture first.
    const second = (
      await a.ok("edit_library", {
        action: "create",
        parentId: lectures.id,
        kind: "lecture",
        name: "Intro",
        lecture: { number: 1, date: null },
      })
    ).structured.node as Item;
    await a.ok("edit_library", {
      action: "move",
      id: second.id,
      parentId: lectures.id,
      afterId: null,
    });
    const order = (await a.ok("browse_library", { parentId: lectures.id })).structured
      .items as Item[];
    expect(order.map((i) => i.name)).toEqual(["Intro", "Beta blockers"]);
    const misplaced = await a.fail("edit_library", {
      action: "move",
      id: lecture.id,
      parentId: sections[0]?.id ?? "",
      afterId: guides.id,
    });
    expect(misplaced.error.message).toContain("afterId must be a sibling");
    expect(misplaced.error.example).toMatchObject({ action: "move" });
    const copy = await a.ok("edit_library", { action: "duplicate", id: lecture.id });
    expect((copy.structured.node as Item).name).toBe("Beta blockers copy");
    await a.ok("edit_library", { action: "trash", id: folder.id });
    const trash = await a.ok("browse_library", { view: "trash" });
    expect((trash.structured.items as Item[]).map((i) => i.id)).toEqual([folder.id]);
    const again = await a.fail("edit_library", { action: "trash", id: folder.id });
    expect(again.error.code).toBe("conflict");
    expect(again.error.hint).toContain(`edit_library {"action":"restore","id":"${folder.id}"}`);
    expect(again.error.hint).toContain("only she can do in the browser");
    expectAgentFacing(again.error);
    await a.ok("edit_library", { action: "restore", id: folder.id });
    const favs = await a.ok("browse_library", { view: "favourites" });
    expect((favs.structured.items as Item[]).map((i) => i.id)).toEqual([folder.id]);
  });

  test("paging: limit and nextCursor walk every item once", async () => {
    const { agent } = await mcpSetup();
    const a = await agent();
    for (let i = 1; i <= 5; i++) {
      await a.ok("edit_library", {
        action: "create",
        parentId: null,
        kind: "term",
        name: `Term ${i}`,
      });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await a.ok("browse_library", { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...(page.structured.items as Item[]).map((i) => i.name));
      cursor = page.structured.nextCursor as string | null;
      if (cursor) expect(page.text).toContain(`cursor "${cursor}"`);
    } while (cursor);
    expect(seen).toEqual(["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"]);
    const bad = await a.fail("browse_library", { cursor: "garbage!" });
    expect(bad.error.code).toBe("invalid_input");
    expect(bad.error.hint).toContain("nextCursor");
  });
});

describe("rule violations teach: code, message, hint and a valid example", () => {
  test("a document at the top level", async () => {
    const { agent } = await mcpSetup();
    const a = await agent();
    const r = await a.fail("edit_library", {
      action: "create",
      parentId: null,
      kind: "document",
      name: "Notes",
    });
    expect(r.error.code).toBe("invalid_input");
    expect(r.error.message).toBe("A document cannot be created in the top level of the library.");
    expect(r.error.hint).toContain("A document goes inside section or folder or lecture");
    expect(r.error.example).toMatchObject({ action: "create", kind: "document" });
    expect(r.text).toContain("Hint:");
    expect(r.text).toContain("Example:");
    expectAgentFacing(r.error);
  });

  test("placement, sections, depth, cycles and kind-specific fields", async () => {
    const { agent } = await mcpSetup();
    const a = await agent();
    const { term, course, lectures, sections } = await seed(a);
    const cases: Array<[Record<string, unknown>, string, RegExp]> = [
      [
        { action: "create", parentId: term.id, kind: "lecture", name: "L" },
        "invalid_input",
        /cannot be created in a term/,
      ],
      [
        { action: "create", parentId: course.id, kind: "folder", name: "F" },
        "invalid_input",
        /cannot be created in a course/,
      ],
      [
        { action: "update", id: lectures.id, name: "Talks" },
        "invalid_input",
        /section cannot be renamed/,
      ],
      [{ action: "trash", id: lectures.id }, "invalid_input", /section cannot be trashed/],
      [{ action: "move", id: term.id, parentId: course.id }, "invalid_input", /into itself/],
      [
        {
          action: "create",
          parentId: lectures.id,
          kind: "folder",
          name: "F",
          lecture: { number: 1, date: null },
        },
        "invalid_input",
        /lecture details only apply to a lecture/,
      ],
      [
        { action: "update", id: course.id, lecture: { number: 1, date: null } },
        "invalid_input",
        /has no lecture details/,
      ],
    ];
    for (const [input, code, message] of cases) {
      const r = await a.fail("edit_library", input);
      expect(r.error.code, JSON.stringify(input)).toBe(code);
      expect(r.error.message).toMatch(message);
      expect(r.error.hint).toBeTruthy();
      expect(r.error.example).toBeTruthy();
      expect((r.error.example as { action: string }).action).toBeTruthy();
      expectAgentFacing(r.error);
    }
    const sources = sections.find((s) => s.name === "Sources") as Item;
    let parent = sources.id;
    for (const name of ["A", "B"]) {
      parent = (
        (await a.ok("edit_library", { action: "create", parentId: parent, kind: "folder", name }))
          .structured.node as Item
      ).id;
    }
    const deep = await a.fail("edit_library", {
      action: "create",
      parentId: parent,
      kind: "folder",
      name: "C",
    });
    expect(deep.error.message).toMatch(/nest at most 2 deep/);
  });

  test("schema problems name the field and show that action's example", async () => {
    const { agent } = await mcpSetup();
    const a = await agent();
    const { lectures } = await seed(a);

    const missing = await a.fail("edit_library", {
      action: "create",
      parentId: lectures.id,
      kind: "lecture",
    });
    expect(missing.error.message).toContain("name: missing (required");
    expect(missing.error.message).toContain('action "create"');
    expect(missing.error.example).toMatchObject({ action: "create", kind: "lecture" });

    const partial = await a.fail("edit_library", {
      action: "create",
      parentId: lectures.id,
      kind: "lecture",
      name: "X",
      lecture: { number: 1 },
    });
    expect(partial.error.message).toContain("lecture.date: missing");

    const unknownField = await a.fail("edit_library", {
      action: "create",
      parentId: lectures.id,
      kind: "lecture",
      name: "X",
      lectureNumber: 1,
    });
    expect(unknownField.error.message).toContain('unknown field "lectureNumber"');

    const noAction = await a.fail("edit_library", { name: "X" });
    expect(noAction.error.message).toContain(
      '"action" is missing. It must be one of: create, update, move, duplicate, trash, restore',
    );

    const rename = await a.fail("edit_library", { action: "rename", id: lectures.id, name: "X" });
    expect(rename.error.message).toContain('rename with "update"');

    const del = await a.fail("edit_library", { action: "delete", id: lectures.id });
    expect(del.error.code).toBe("forbidden");
    expect(del.error.example).toMatchObject({ action: "trash" });
  });

  test("IDs: wrong kind, malformed, unknown prefix, unopenable kind", async () => {
    const { agent } = await mcpSetup();
    const a = await agent();
    const wrongKind = await a.fail("edit_library", {
      action: "trash",
      id: "fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
    });
    expect(wrongKind.error.message).toContain("id: Expected a node ID");
    expect(wrongKind.error.message).toContain("You sent an uploaded file ID (fil_…)");

    const malformed = await a.fail("get_item", { id: "nod_123" });
    expect(malformed.error.message).toContain("known prefix but is malformed");

    const unknown = await a.fail("get_item", { id: "Fall 2026" });
    expect(unknown.error.message).toContain("is not an ID this app uses");
    expect(unknown.error.hint).toContain("nod_");

    const notYet = await a.fail("get_item", { id: "fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" });
    expect(notYet.error.message).toContain("which get_item cannot open yet");

    const account = await a.fail("get_item", { id: "key_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" });
    expect(account.error.message).toContain("account objects are not visible to agents");

    const absent = await a.fail("get_item", { id: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" });
    expect(absent.error.code).toBe("not_found");
    expectAgentFacing(absent.error);
    expect(absent.error.hint).toContain("browse_library");
  });
});

describe("isolation", () => {
  test("another user's IDs are not_found, exactly like missing ones, and never listed", async () => {
    const { agent } = await mcpSetup();
    const hannah = await agent("hannah");
    const other = await agent("mallory");
    const { term, course } = await seed(hannah);
    const missing = await other.fail("get_item", { id: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" });
    for (const [tool, args] of [
      ["get_item", { id: term.id }],
      ["browse_library", { parentId: course.id }],
      ["edit_library", { action: "update", id: term.id, name: "Mine" }],
      ["edit_library", { action: "create", parentId: term.id, kind: "course", name: "X" }],
      ["edit_library", { action: "trash", id: course.id }],
    ] as const) {
      const r = await other.fail(tool, args);
      expect(r.error.code, `${tool} ${JSON.stringify(args)}`).toBe("not_found");
      expect(r.error.message).toBe(missing.error.message);
      expect(r.text).not.toContain("Fall 2026");
    }
    expect((await other.ok("browse_library")).structured.items).toEqual([]);
    expect((await other.ok("search_notes", { query: "Pharmacology" })).structured.hits).toEqual([]);
    expect((await hannah.ok("get_item", { id: term.id })).text).toContain("Fall 2026");
  });
});
