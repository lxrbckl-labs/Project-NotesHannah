import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { EXAMPLE_CITATION } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { createLibraryService } from "../src/domains/library/index.js";
import { AppError } from "../src/http/errors.js";
import { sqliteAudit } from "../src/mcp/audit.js";
import { fakeChanges, fakeDocuments, fakeFiles, TINY_PNG } from "../src/mcp/fakes.js";
import { undescribed } from "../src/mcp/schema.js";
import { connect, mcpSetup } from "./mcp-harness.js";

function allPorts() {
  const files = fakeFiles();
  const documents = fakeDocuments();
  const changes = fakeChanges([
    {
      id: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
      kind: "node",
      change: "created",
      at: "2026-11-15T10:00:00.000Z",
      name: "Fall 2026",
      by: null,
    },
    {
      id: "fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
      kind: "file",
      change: "updated",
      at: "2026-11-15T11:00:00.000Z",
      name: "lecture-07.pdf",
      by: null,
    },
  ]);
  return {
    files,
    documents,
    changes,
    ports: { files: files.port, documents: documents.port, changes: changes.port },
  };
}

const CORE = ["start_here", "browse_library", "get_item", "search_notes", "edit_library"];
const ALL = [
  ...CORE,
  "changes",
  "source_files",
  "get_page",
  "save_transcript",
  "request_upload_links",
  "write_document",
  "edit_blocks",
];

describe("tool surface", () => {
  test("only backed tools are advertised", async () => {
    const bare = await mcpSetup();
    const a = await bare.agent();
    expect((await a.client.listTools()).tools.map((t) => t.name)).toEqual(CORE);
    const unknown = await a.fail("source_files", { action: "list" });
    expect(unknown.error.code).toBe("not_found");
    expect(unknown.error.hint).toContain("start_here");

    const full = await mcpSetup({ ports: allPorts().ports });
    const b = await full.agent();
    expect((await b.client.listTools()).tools.map((t) => t.name)).toEqual(ALL);
  });

  test("small, described, valid schemas with correct annotations", async () => {
    const { agent } = await mcpSetup({ ports: allPorts().ports });
    const a = await agent();
    const { tools } = await a.client.listTools();
    expect(tools.length).toBeLessThanOrEqual(15);
    const ajv = new AjvJsonSchemaValidator();
    for (const tool of tools) {
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(80);
      expect(tool.inputSchema.type).toBe("object");
      for (const key of ["oneOf", "anyOf", "allOf", "$ref", "$defs"]) {
        expect(tool.inputSchema, `${tool.name} top-level ${key}`).not.toHaveProperty(key);
      }
      expect(undescribed(tool.inputSchema as never), tool.name).toEqual([]);
      expect(JSON.stringify(tool.inputSchema).length, tool.name).toBeLessThan(8000);
      expect(() => ajv.getValidator(tool.inputSchema as never), tool.name).not.toThrow();
      const ann = tool.annotations;
      expect(ann?.openWorldHint, tool.name).toBe(false);
      const readOnly = [
        "start_here",
        "browse_library",
        "get_item",
        "search_notes",
        "changes",
        "get_page",
      ];
      expect(ann?.readOnlyHint, tool.name).toBe(readOnly.includes(tool.name));
      expect(ann?.destructiveHint, tool.name).toBe(
        ["edit_library", "edit_blocks"].includes(tool.name),
      );
    }
    expect(tools[0]?.description).toMatch(/^CALL THIS FIRST/);
  });
});

describe("source files, pages and transcripts (files port)", () => {
  test("move a filed file to another lecture, back to the inbox, and refuse a bad destination", async () => {
    let check: (userId: string, nodeId: string) => void = () => {};
    const files = fakeFiles({ checkDestination: (u, n) => check(u, n) });
    const s = await mcpSetup({ ports: { files: files.port } });
    // Stand-in for the files domain rule: under a lecture or a folder only.
    const library = createLibraryService(s.t.db);
    check = (userId, nodeId) => {
      const node = library.get(userId, nodeId);
      if (node.kind !== "lecture" && node.kind !== "folder") {
        throw new AppError("invalid_input", `A file cannot be filed under a ${node.kind}.`, {
          hint: "File it under a lecture or a folder. To undo a filing use POST /api/files/fil_X/file.",
          example: { nodeId: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" },
        });
      }
    };
    const a = await s.agent("hannah");
    const term = (
      await a.ok("edit_library", {
        action: "create",
        parentId: null,
        kind: "term",
        name: "Fall 2026",
      })
    ).structured.node as { id: string };
    const course = await a.ok("edit_library", {
      action: "create",
      parentId: term.id,
      kind: "course",
      name: "Pharm",
    });
    const lecturesId = (course.structured.sections as Array<{ id: string; name: string }>)[1]
      ?.id as string;
    const make = async (n: number) =>
      (
        (
          await a.ok("edit_library", {
            action: "create",
            parentId: lecturesId,
            kind: "lecture",
            name: `L${n}`,
            lecture: { number: n, date: null },
          })
        ).structured.node as { id: string }
      ).id;
    const l1 = await make(1);
    const l2 = await make(2);
    const { fileId } = files.addFile(a.user.id, "lecture-02.pdf", 1);
    await a.ok("source_files", { action: "file", fileId, nodeId: l1 });
    const moved = await a.ok("source_files", { action: "move", fileId, nodeId: l2 });
    expect(moved.text).toContain(`Moved (was under ${l1})`);
    expect(moved.structured.previousNodeId).toBe(l1);
    const under = await a.ok("source_files", { action: "list", nodeId: l2 });
    expect(under.text).toContain(fileId);
    const got = await a.ok("get_item", { id: l2 });
    expect(got.text).toContain("Source files filed here:");
    const bad = await a.fail("source_files", { action: "move", fileId, nodeId: term.id });
    expect(bad.error.code).toBe("invalid_input");
    expect(bad.error.message).toBe("A file cannot be filed under a term.");
    expect(bad.error.hint).toContain('source_files {"action":"move","fileId":"fil_X"');
    expect(bad.error.hint).not.toContain("/api/");
    const back = await a.ok("source_files", { action: "move", fileId, nodeId: null });
    expect(back.text).toContain(`Returned to the inbox (was under ${l2})`);
    expect((await a.ok("source_files", { action: "list" })).text).toContain(fileId);
    const viaLibrary = await a.fail("edit_library", { action: "move", id: fileId, parentId: l1 });
    expect(viaLibrary.error.message).toContain("move it with source_files");
    const reader = await connect(s.app, s.key(a.user.id, "read", "reader").secret);
    expect(
      (await reader.fail("source_files", { action: "move", fileId, nodeId: l1 })).error.code,
    ).toBe("read_only_key");
    expect((await reader.ok("source_files", { action: "list" })).isError).toBe(false);
  });

  test("list, claim, conflict for another key, release, file", async () => {
    const p = allPorts();
    const s = await mcpSetup({ ports: p.ports });
    const a = await s.agent("hannah");
    const { fileId } = p.files.addFile(a.user.id, "lecture-07.pdf", 3);
    const list = await a.ok("source_files", { action: "list" });
    expect(list.text).toContain("Inbox: 1 file(s) pending");
    expect(list.text).toContain(fileId);
    await a.ok("source_files", { action: "claim", fileId });
    await a.ok("source_files", { action: "claim", fileId });
    const second = await connect(s.app, s.key(a.user.id, "write", "codex").secret);
    const taken = await second.fail("source_files", { action: "claim", fileId });
    expect(taken.error.code).toBe("conflict");
    const notMine = await second.fail("source_files", { action: "release", fileId });
    expect(notMine.error.code).toBe("conflict");
    await a.ok("source_files", { action: "release", fileId });
    const missingNode = await a.fail("source_files", { action: "file", fileId });
    expect(missingNode.error.message).toContain("nodeId: missing");
    expect(missingNode.error.example).toMatchObject({ action: "file" });
    const filed = await a.ok("source_files", {
      action: "file",
      fileId,
      nodeId: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
    });
    expect(filed.text).toContain("Filed");
    expect(filed.text).toContain("3 of 3 page(s) have no transcript yet");
    expect((await a.ok("source_files", { action: "list" })).text).toContain("(nothing waiting)");
    const otherUser = await s.agent("mallory");
    expect((await otherUser.fail("source_files", { action: "claim", fileId })).error.code).toBe(
      "not_found",
    );
  });

  test("get_page returns the image inline, or a link, with neighbours", async () => {
    const p = allPorts();
    const s = await mcpSetup({ ports: p.ports });
    const a = await s.agent();
    const { pageIds } = p.files.addFile(a.user.id, "slides.pdf", 2, {
      nativeText: "Beta blockers",
    });
    const r = await a.ok("get_page", { pageId: pageIds[0] });
    expect(r.images).toHaveLength(1);
    expect(r.images[0]?.mimeType).toBe("image/png");
    expect(Buffer.from(r.images[0]?.data ?? "", "base64").equals(TINY_PNG)).toBe(true);
    expect(r.text).toContain(`Next page: ${pageIds[1]}`);
    expect(r.text).toContain("Native text from the file");
    expect(r.text).toContain("Not transcribed yet");
    const link = await a.ok("get_page", { pageId: pageIds[1], image: "link", size: "thumb" });
    expect(link.images).toHaveLength(0);
    expect(link.text).toMatch(/curl -sS -o page-2\.img "http:\/\/127\.0\.0\.1\/files\/pages\//);
    const wrong = await a.fail("get_page", { pageId: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" });
    expect(wrong.error.message).toContain("You sent a library item");
  });

  test("save_transcript enforces flags with an example to copy, then saves revisions", async () => {
    const p = allPorts();
    const s = await mcpSetup({ ports: p.ports });
    const a = await s.agent();
    const { pageIds } = p.files.addFile(a.user.id, "handwritten.png", 1);
    const pageId = pageIds[0] as string;
    const text = "Metoprolol 25 mg PO BID\nCrCl 72.5 mL/min\nHold if HR < 55";
    const unflagged = await a.fail("save_transcript", { pageId, text });
    expect(unflagged.error.code).toBe("invalid_input");
    expect(unflagged.error.message).toContain('"25 mg"');
    expect(unflagged.error.message).toContain('"72.5 mL"');
    const example = unflagged.error.example as { flags: Array<{ kind: string; quote: string }> };
    expect(example.flags.map((f) => f.quote)).toEqual(["25 mg", "72.5 mL"]);

    const badQuote = await a.fail("save_transcript", {
      pageId,
      text,
      flags: [{ kind: "dose", quote: "25mg" }],
    });
    expect(badQuote.error.message).toContain('flags[0].quote "25mg" does not appear in text');

    const badKind = await a.fail("save_transcript", {
      pageId,
      text,
      flags: [{ kind: "dosage", quote: "25 mg" }],
    });
    expect(badKind.error.message).toContain("flags[0].kind");

    // A flag on the digits covers the value however much of it is quoted.
    const lab = await a.ok("save_transcript", {
      pageId,
      text: "K+ 3.5-5.0 mEq/L",
      flags: [
        { kind: "decimal", quote: "3.5" },
        { kind: "decimal", quote: "5.0" },
      ],
    });
    expect(lab.text).toContain("revision 1");
    const saved = await a.ok("save_transcript", {
      pageId,
      text,
      flags: [
        { kind: "dose", quote: "25 mg" },
        { kind: "unit", quote: "72.5 mL/min" },
      ],
    });
    expect(saved.text).toContain("revision 2");
    const again = await a.ok("save_transcript", { pageId, text: "Metoprolol" });
    expect(again.text).toContain("revision 3");
    const t = (again.structured.transcript as { id: string }).id;
    const got = await a.ok("get_item", { id: t });
    expect(got.text).toContain("Metoprolol");
    const page = await a.ok("get_page", { pageId, image: "none" });
    expect(page.text).toContain(`Transcript: ${t}, revision 3`);
    const found = await a.ok("search_notes", { query: "metoprolol", scope: "transcripts" });
    expect(found.text).toContain(pageId);
  });

  test("request_upload_links returns curl-ready links", async () => {
    const p = allPorts();
    const { agent } = await mcpSetup({ ports: p.ports });
    const a = await agent();
    const r = await a.ok("request_upload_links", {
      files: [
        { name: "lecture 07.pdf", bytes: 2_400_000 },
        { name: "notes.heic", bytes: 900_000 },
      ],
    });
    expect((r.structured.tickets as unknown[]).length).toBe(2);
    expect(r.text).toContain('curl -sS -X PUT --data-binary @"lecture 07.pdf"');
    const tooBig = await a.fail("request_upload_links", {
      files: [{ name: "x.pdf", bytes: 10 ** 10 }],
    });
    expect(tooBig.error.message).toContain("files[0].bytes");
  });
});

describe("documents port", () => {
  test("write_document enforces the citation rule; edit_blocks inserts and protects", async () => {
    const p = allPorts();
    const { agent } = await mcpSetup({ ports: p.ports });
    const a = await agent();
    const parentId = "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";
    const uncited = await a.fail("write_document", {
      parentId,
      kind: "study_guide",
      title: "Beta blockers",
      blocks: [
        { type: "heading", content: { level: 1, text: "Beta blockers" } },
        { type: "paragraph", content: { text: "Atenolol is cardioselective." } },
      ],
    });
    expect(uncited.error.code).toBe("invalid_input");
    expect(uncited.error.message).toContain("$.blocks[1].citations");
    expect(uncited.error.example).toMatchObject({ type: "paragraph" });

    const unknownType = await a.fail("write_document", {
      parentId,
      kind: "study_guide",
      title: "X",
      blocks: [{ type: "paragraf", content: { text: "x" }, generalKnowledge: true }],
    });
    expect(unknownType.error.message).toContain("paragraph");

    const both = await a.fail("write_document", { kind: "free", title: "X", blocks: [] });
    expect(both.error.message).toContain('exactly one of "nodeId"');

    const created = await a.ok("write_document", {
      parentId,
      kind: "study_guide",
      title: "Beta blockers",
      blocks: [
        { type: "heading", content: { level: 1, text: "Beta blockers" } },
        {
          type: "paragraph",
          content: { text: "Atenolol is cardioselective." },
          citations: [EXAMPLE_CITATION],
        },
      ],
    });
    const documentId = created.structured.documentId as string;
    expect(created.text).toContain("now revision 1");
    const inserted = await a.ok("edit_blocks", {
      operation: "insert_blocks",
      documentId,
      blocks: [
        {
          type: "callout",
          content: { kind: "exam_tip", text: "Know the cardioselective ones." },
          generalKnowledge: true,
        },
      ],
      position: "start",
      expectedRevision: 1,
    });
    expect(inserted.text).toContain("revision 2");
    const stale = await a.fail("edit_blocks", {
      operation: "delete_blocks",
      documentId,
      blockIds: inserted.structured.written,
      expectedRevision: 1,
    });
    expect(stale.error.code).toBe("conflict");
    const createViaEdit = await a.fail("edit_blocks", { operation: "create_document" });
    expect(createViaEdit.error.message).toContain("write_document");
    const badOp = await a.fail("edit_blocks", { operation: "insert", documentId });
    expect(badOp.error.example).toMatchObject({ operation: "insert_blocks" });
    const doc = await a.ok("get_item", { id: documentId });
    expect(doc.text).toContain("Blocks 0-3 of 3");
    expect((doc.structured.blocks as unknown[]).length).toBe(3);
  });

  test("changes feed returns a cursor to continue from", async () => {
    const p = allPorts();
    const { agent } = await mcpSetup({ ports: p.ports });
    const a = await agent();
    const first = await a.ok("changes", { limit: 1 });
    expect(first.text).toContain("1 change(s)");
    expect(first.text).toContain("More changes waiting");
    const next = await a.ok("changes", { cursor: first.structured.cursor });
    expect(next.text).toContain("lecture-07.pdf");
  });
});

describe("safety", () => {
  test("every mutating call is audited, refused ones too; reads are not", async () => {
    const s = await mcpSetup();
    const a = await s.agent("hannah");
    const reader = await connect(s.app, s.key(a.user.id, "read", "reader").secret);
    const term = await a.ok("edit_library", {
      action: "create",
      parentId: null,
      kind: "term",
      name: "Fall 2026",
    });
    const termId = (term.structured.node as { id: string }).id;
    await a.fail("edit_library", { action: "create", parentId: null, kind: "document", name: "x" });
    await reader.fail("edit_library", { action: "trash", id: termId });
    await a.ok("browse_library");
    await a.ok("start_here");
    const rows = sqliteAudit(s.t.db).list(a.user.id);
    expect(rows.map((r) => [r.tool, r.action, r.outcome])).toEqual([
      ["edit_library", "trash", "read_only_key"],
      ["edit_library", "create", "invalid_input"],
      ["edit_library", "create", "ok"],
    ]);
    expect(rows[2]?.targetIds).toEqual([termId]);
    expect(rows[2]?.keyId).toBe(a.key.key.id);
    expect(rows[0]?.keyId).not.toBe(a.key.key.id);
  });

  test("rate limit per key with retryAfter", async () => {
    const s = await mcpSetup({ rateLimit: { capacity: 3, refillPerSecond: 1 } });
    const a = await s.agent("hannah");
    for (let i = 0; i < 3; i++) await a.ok("browse_library");
    const limited = await a.fail("browse_library");
    expect(limited.error.code).toBe("rate_limited");
    expect(limited.error.retryAfter).toBe(1);
    expect(limited.text).toContain("Retry after 1 s.");
    const other = await connect(s.app, s.key(a.user.id, "write", "second").secret);
    await other.ok("browse_library");
    s.t.clock.advance(1000);
    await a.ok("browse_library");
  });

  test("unexpected failures are internal errors without details", async () => {
    const p = allPorts();
    p.ports.files.getPage = () => {
      throw new Error("SQLITE_CORRUPT at /secret/path/notes.db");
    };
    const { agent } = await mcpSetup({ ports: p.ports });
    const a = await agent();
    const original = console.error;
    console.error = () => {};
    try {
      const r = await a.fail("get_page", { pageId: "pag_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" });
      expect(r.error.code).toBe("internal");
      expect(r.text).not.toContain("SQLITE");
      expect(r.text).not.toContain("/secret");
    } finally {
      console.error = original;
    }
  });
});
