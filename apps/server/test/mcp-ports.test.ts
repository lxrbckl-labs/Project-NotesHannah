import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { EXAMPLE_CITATION } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { AppError } from "../src/http/errors.js";
import { fakeChanges, fakeDocuments, fakeFiles, TINY_PNG } from "../src/mcp/fakes.js";
import { undescribed } from "../src/mcp/schema.js";
import { connect, mcpSetup } from "./mcp-harness.js";

/** Unit tests of the ported tools over the in-memory fakes. The real domains: mcp-real.test.ts. */

function allPorts() {
  const files = fakeFiles();
  const documents = fakeDocuments();
  const changes = fakeChanges([
    {
      seq: 1,
      at: "2026-11-15T10:00:00.000Z",
      action: "node.created",
      objectType: "node",
      objectIds: ["nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"],
      summary: "Created term Fall 2026",
      actor: { type: "user" },
    },
    {
      seq: 2,
      at: "2026-11-15T11:00:00.000Z",
      action: "file.filed",
      objectType: "file",
      objectIds: ["fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"],
      summary: "Filed lecture-07.pdf",
      actor: { type: "agent" },
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
    const { agent } = await mcpSetup({
      ports: { ...allPorts().ports, search: { search: () => ({ items: [], nextCursor: null }) } },
    });
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

  test("result shape: the full text is structuredContent.message; the text block is its first line", async () => {
    const { agent } = await mcpSetup();
    const a = await agent();
    const r = await a.ok("start_here");
    expect(r.headline).toBe("# Study notes: start here");
    expect(r.structured.message).toContain("## Tools");
    const e = await a.call("edit_library", { action: "rename" });
    expect(e.isError).toBe(true);
    expect(e.structured).toEqual({});
    expect(e.headline).toMatch(/^Error invalid_input: /);
  });
});

describe("source files, pages and transcripts (fakes)", () => {
  test("list with progress, claim, conflict for another key, release, file with a warning, move", async () => {
    const p = allPorts();
    const s = await mcpSetup({ ports: p.ports });
    const a = await s.agent("hannah");
    const { fileId, pageIds } = p.files.addFile(a.user.id, "lecture-07.pdf", 3);
    const list = await a.ok("source_files", { action: "list" });
    expect(list.text).toContain("Converter: online");
    expect(list.text).toContain(
      `${fileId} "lecture-07.pdf": pdf, status converted (ready to transcribe), 0 of 3 pages transcribed`,
    );
    await a.ok("source_files", { action: "claim", fileId });
    const second = await connect(s.app, s.key(a.user.id, "write", "codex").secret);
    expect((await second.fail("source_files", { action: "claim", fileId })).error.code).toBe(
      "conflict",
    );
    expect((await second.fail("source_files", { action: "release", fileId })).error.code).toBe(
      "conflict",
    );
    const saved = await a.ok("save_transcript", { pageId: pageIds[0], text: "Beta blockers" });
    expect(saved.text).toContain("2 page(s) of this file still need a transcript");
    const missingNode = await a.fail("source_files", { action: "file", fileId });
    expect(missingNode.error.message).toContain("nodeId: missing");
    const filed = await a.ok("source_files", {
      action: "file",
      fileId,
      nodeId: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
    });
    expect(filed.text).toContain("Warning: 2 of 3 page(s) have no transcript yet");
    expect(filed.structured.untranscribedPages).toEqual(pageIds.slice(1));
    const back = await a.ok("source_files", { action: "move", fileId, nodeId: null });
    expect(back.text).toContain("Returned to the inbox (was under nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8)");
    await a.ok("source_files", { action: "release", fileId });
    expect(
      (await (await s.agent("mallory")).fail("source_files", { action: "claim", fileId })).error
        .code,
    ).toBe("not_found");
  });

  test("wait returns when conversion finishes, and reports what is still converting at the timeout", async () => {
    const p = allPorts();
    const s = await mcpSetup({ ports: p.ports });
    const a = await s.agent();
    const { fileId } = p.files.addFile(a.user.id, "deck.pptx", 0, { status: "converting" });
    const timedOut = await a.ok("source_files", {
      action: "wait",
      fileIds: [fileId],
      timeoutSeconds: 1,
    });
    expect(timedOut.text).toContain("1 still converting after 1 s. Call wait again");
    expect(timedOut.structured.done).toBe(false);
    setTimeout(() => p.files.finishConversion(fileId, 4), 300);
    const done = await a.ok("source_files", {
      action: "wait",
      fileIds: [fileId],
      timeoutSeconds: 5,
    });
    expect(done.text).toContain("All converted");
    expect(done.text).toContain("0 of 4 pages transcribed");
  });

  test("get_page returns the image, the current transcript and neighbours; a link on request", async () => {
    const p = allPorts();
    const s = await mcpSetup({ ports: p.ports });
    const a = await s.agent();
    const { pageIds } = p.files.addFile(a.user.id, "slides.pdf", 2, {
      nativeText: "Beta blockers",
    });
    await a.ok("save_transcript", { pageId: pageIds[0], text: "Beta blockers end in -olol" });
    const r = await a.ok("get_page", { pageId: pageIds[0] });
    expect(r.images).toHaveLength(1);
    expect(Buffer.from(r.images[0]?.data ?? "", "base64").equals(TINY_PNG)).toBe(true);
    expect(r.text).toContain(`Next page: ${pageIds[1]}`);
    expect(r.text).toContain("Current transcript");
    expect(r.text).toContain("Beta blockers end in -olol");
    const link = await a.ok("get_page", { pageId: pageIds[1], image: "link", size: "thumb" });
    expect(link.images).toHaveLength(0);
    expect(link.text).toMatch(/curl -sS -o page-2\.webp "http:\/\/127\.0\.0\.1\/api\/pages\//);
    const wrong = await a.fail("get_page", { pageId: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" });
    expect(wrong.error.message).toContain("You sent a library item");
  });

  test("get_item on a file with text: every page's text in one call, windowed", async () => {
    const p = allPorts();
    const s = await mcpSetup({ ports: p.ports });
    const a = await s.agent();
    const { fileId, pageIds } = p.files.addFile(a.user.id, "slides.pdf", 3, {
      nativeText: "native words",
    });
    await a.ok("save_transcript", { pageId: pageIds[1], text: "Transcribed page two" });
    const r = await a.ok("get_item", { id: fileId, text: true });
    expect(r.text).toContain("--- page 1");
    expect(r.text).toContain("[no transcript; native text from the file]\nnative words");
    expect(r.text).toContain("[transcript revision 1]\nTranscribed page two");
    const window = await a.ok("get_item", { id: fileId, text: true, offset: 1, limit: 1 });
    expect(window.text).toContain("--- page 2");
    expect(window.text).not.toContain("--- page 1");
    expect(window.text).toContain(`get_item {"id":"${fileId}","text":true,"offset":2}`);
  });

  test("save_transcript enforces flags with an example to copy", async () => {
    const p = allPorts();
    const s = await mcpSetup({ ports: p.ports });
    const a = await s.agent();
    const { pageIds } = p.files.addFile(a.user.id, "handwritten.png", 1);
    const pageId = pageIds[0] as string;
    const text = "Metoprolol 25 mg PO BID\nCrCl 72.5 mL/min\nHold if HR < 55";
    const unflagged = await a.fail("save_transcript", { pageId, text });
    expect(unflagged.error.message).toContain('"25 mg"');
    expect(unflagged.error.message).toContain('"72.5 mL"');
    const example = unflagged.error.example as { flags: Array<{ quote: string }> };
    expect(example.flags.map((f) => f.quote)).toEqual(["25 mg", "72.5 mL"]);
    const badQuote = await a.fail("save_transcript", {
      pageId,
      text,
      flags: [{ kind: "dose", quote: "25mg" }],
    });
    expect(badQuote.error.message).toContain('flags[0].quote "25mg" does not appear in text');
    const lab = await a.ok("save_transcript", {
      pageId,
      text: "K+ 3.5-5.0 mEq/L",
      flags: [
        { kind: "decimal", quote: "3.5" },
        { kind: "decimal", quote: "5.0" },
      ],
    });
    expect(lab.text).toContain("revision 1");
  });

  test("request_upload_links returns curl-ready links", async () => {
    const { agent } = await mcpSetup({ ports: allPorts().ports });
    const a = await agent();
    const r = await a.ok("request_upload_links", {
      files: [{ name: "lecture 07.pdf", bytes: 2_400_000 }],
    });
    expect(r.text).toContain('curl -sS -X PUT --data-binary @"lecture 07.pdf"');
    expect(r.text).toContain('source_files {"action":"wait"');
    const tooBig = await a.fail("request_upload_links", {
      files: [{ name: "x.pdf", bytes: 10 ** 10 }],
    });
    expect(tooBig.error.message).toContain("files[0].bytes");
  });
});

describe("documents (fakes)", () => {
  test("write_document checks the citation rule before the domain; edit_blocks guards revisions", async () => {
    const p = allPorts();
    const { agent } = await mcpSetup({ ports: p.ports });
    const a = await agent();
    const parentId = "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";
    const uncited = await a.fail("write_document", {
      parentId,
      kind: "study_guide",
      title: "Beta blockers",
      blocks: [{ type: "paragraph", content: { text: "Atenolol is cardioselective." } }],
    });
    expect(uncited.error.message).toContain("$.blocks[0].citations");
    expect(uncited.error.example).toMatchObject({ type: "paragraph" });
    const created = await a.ok("write_document", {
      parentId,
      kind: "study_guide",
      title: "Beta blockers",
      blocks: [
        { type: "paragraph", content: { text: "Atenolol." }, citations: [EXAMPLE_CITATION] },
      ],
    });
    const documentId = created.structured.documentId as string;
    const inserted = await a.ok("edit_blocks", {
      operation: "insert_blocks",
      documentId,
      blocks: [{ type: "heading", content: { level: 1, text: "Beta blockers" } }],
      expectedRevision: 1,
    });
    expect(inserted.text).toContain("now revision 2");
    const stale = await a.fail("edit_blocks", {
      operation: "delete_blocks",
      documentId,
      blockIds: inserted.structured.written,
      expectedRevision: 1,
    });
    expect(stale.error.code).toBe("conflict");
    const doc = await a.ok("get_item", { id: documentId });
    expect(doc.text).toContain("References:");
  });

  test("changes: cursor paging, and from now", async () => {
    const { agent } = await mcpSetup({ ports: allPorts().ports });
    const a = await agent();
    const first = await a.ok("changes", { limit: 1 });
    expect(first.text).toContain("1 change(s)");
    expect(first.text).toContain("More waiting");
    const next = await a.ok("changes", { cursor: first.structured.cursor });
    expect(next.text).toContain("file.filed by an agent: Filed lecture-07.pdf");
    const now = await a.ok("changes", { from: "now" });
    expect(now.structured.cursor).toBe("2");
  });
});

describe("safety", () => {
  test("rate limit per key with retryAfter", async () => {
    const s = await mcpSetup({ rateLimit: { capacity: 3, refillPerSecond: 1 } });
    const a = await s.agent("hannah");
    for (let i = 0; i < 3; i++) await a.ok("browse_library");
    const limited = await a.fail("browse_library");
    expect(limited.error.code).toBe("rate_limited");
    expect(limited.error.retryAfter).toBe(1);
    const other = await connect(s.app, s.key(a.user.id, "write", "second").secret);
    await other.ok("browse_library");
    s.t.clock.advance(1000);
    await a.ok("browse_library");
  });

  test("refused writes are noted in the server log; reads are not", async () => {
    const lines: string[] = [];
    const s = await mcpSetup({ log: (line) => lines.push(line) });
    const a = await s.agent("hannah");
    const reader = await connect(s.app, s.key(a.user.id, "read", "reader").secret);
    await a.fail("edit_library", { action: "create", parentId: null, kind: "document", name: "x" });
    await reader.fail("edit_library", {
      action: "create",
      parentId: null,
      kind: "term",
      name: "x",
    });
    await a.fail("get_item", { id: "nope" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^mcp refused edit_library create key=key_\w+ code=invalid_input$/);
    expect(lines[1]).toContain("code=read_only_key");
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
    } finally {
      console.error = original;
    }
  });

  test("domain hints that name web routes are rewritten into tool calls", async () => {
    const p = allPorts();
    p.ports.files.claim = () => {
      throw new AppError(
        "conflict",
        "Only a converted file can be claimed; this one is converting.",
        {
          hint: "Check GET /api/files/fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8 or GET /api/converter/status.",
          example: { method: "GET", path: "/api/files/fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" },
        },
      );
    };
    const { agent } = await mcpSetup({ ports: p.ports });
    const a = await agent();
    const r = await a.fail("source_files", {
      action: "claim",
      fileId: "fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
    });
    expect(r.error.hint).toBe(
      'Check get_item {"id":"fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"} or source_files {"action":"list"} (it shows the converter\'s state).',
    );
    expect(r.error.example).toBeUndefined();
  });
});
