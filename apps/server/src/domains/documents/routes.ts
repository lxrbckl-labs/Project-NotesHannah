import { BlockId, DocumentId, FileId, NodeId, PageId, WRITER_OPERATIONS } from "@notes/schema";
import { Hono } from "hono";
import { z } from "zod";
import {
  type AppEnv,
  getAuth,
  requireAuth,
  requireSession,
  requireWrite,
} from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { EXAMPLE_REQUEST_ID } from "./errors.js";
import { createDocumentsService, type DocumentsPorts, type DocumentsService } from "./service.js";

const ID = "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";
const BLOCK = "blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";

const PageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const ContentQuery = z.object({
  from: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
const ReviewBody = z.strictObject({
  status: z.enum(["reviewed", "unverified"]),
  blockIds: z.array(BlockId).min(1).max(1000).optional(),
  expectedRevision: z.number().int().min(1).optional(),
});
const BatchBody = z.strictObject({
  operations: z
    .array(
      z.strictObject({
        operation: z.enum(Object.keys(WRITER_OPERATIONS) as [string, ...string[]]),
        input: z.unknown(),
      }),
    )
    .min(1)
    .max(50),
});
const RevisionNumber = z.coerce.number().int().min(1);

function parse<T extends z.ZodType>(schema: T, data: unknown, example: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
  );
  throw new AppError("invalid_input", problems.join("; "), {
    hint: "Fix the field named above and send again.",
    example,
  });
}

function id<T extends z.ZodType>(schema: T, value: string | undefined, what: string): string {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("not_found", `No such ${what}.`, {
      hint: `A ${what} ID looks like the examples in docs/api.md.`,
    });
  }
  return result.data as string;
}

async function readBody(
  c: { req: { json(): Promise<unknown> } },
  example: unknown,
  optional = false,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    if (optional) return {};
    throw new AppError("invalid_input", "The request body must be JSON.", {
      hint: "Send a JSON object with the header Content-Type: application/json.",
      example,
    });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("invalid_input", "The request body must be a JSON object.", { example });
  }
  return body as Record<string, unknown>;
}

/** The path names the document; a body that names another one is a mistake worth saying so. */
function withDocument(body: Record<string, unknown>, documentId: string): Record<string, unknown> {
  if (body.documentId !== undefined && body.documentId !== documentId) {
    throw new AppError("invalid_input", "The body's documentId differs from the one in the URL.", {
      hint: "Leave documentId out of the body, or make them the same.",
    });
  }
  return { ...body, documentId };
}

export function documentsRoutes(
  deps: Pick<ServerDeps, "db" | "now">,
  ports: DocumentsPorts = {},
  service: DocumentsService = createDocumentsService(deps, ports),
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // ---- create and read ---------------------------------------------------

  app.post("/documents", requireWrite, async (c) => {
    const body = await readBody(c, WRITER_EXAMPLES.create);
    return c.json(service.createDocument(getAuth(c), body as never), 201);
  });

  app.post("/documents/batch", requireWrite, async (c) => {
    const body = parse(BatchBody, await readBody(c, WRITER_EXAMPLES.batch), WRITER_EXAMPLES.batch);
    const results = service.batch(
      getAuth(c),
      body.operations as Array<{ operation: keyof typeof WRITER_OPERATIONS; input: unknown }>,
    );
    return c.json({ results });
  });

  app.get("/documents/:id", requireAuth, (c) => {
    return c.json(service.getDocument(getAuth(c), id(DocumentId, c.req.param("id"), "document")));
  });

  app.get("/nodes/:nodeId/document", requireAuth, (c) => {
    return c.json(
      service.getDocumentByNode(getAuth(c), id(NodeId, c.req.param("nodeId"), "library item")),
    );
  });

  app.get("/documents/:id/content", requireAuth, (c) => {
    const q = parse(ContentQuery, c.req.query(), { from: 0, limit: 200 });
    return c.json(
      service.getFull(getAuth(c), id(DocumentId, c.req.param("id"), "document"), {
        from: q.from,
        limit: q.limit,
      }),
    );
  });

  app.get("/documents/:id/blocks/:blockId", requireAuth, (c) => {
    const block = service.getBlock(
      getAuth(c),
      id(DocumentId, c.req.param("id"), "document"),
      id(BlockId, c.req.param("blockId"), "block"),
    );
    return c.json({ block });
  });

  app.get("/documents/:id/references", requireAuth, (c) => {
    return c.json(service.references(getAuth(c), id(DocumentId, c.req.param("id"), "document")));
  });

  app.get("/documents/:id/revisions", requireAuth, (c) => {
    const q = parse(PageQuery, c.req.query(), { limit: 50 });
    return c.json(
      service.listRevisions(getAuth(c), id(DocumentId, c.req.param("id"), "document"), q),
    );
  });

  app.get("/documents/:id/revisions/:number", requireAuth, (c) => {
    const n = parse(RevisionNumber, c.req.param("number"), 3);
    return c.json({
      revision: service.getRevision(getAuth(c), id(DocumentId, c.req.param("id"), "document"), n),
    });
  });

  app.get("/pages/:pageId/citations", requireAuth, (c) => {
    const q = parse(PageQuery, c.req.query(), { limit: 50 });
    const pageId = id(PageId, c.req.param("pageId"), "page");
    return c.json(service.citedBy(getAuth(c), { pageId }, q));
  });

  app.get("/files/:fileId/citations", requireAuth, (c) => {
    const q = parse(PageQuery, c.req.query(), { limit: 50 });
    const fileId = id(FileId, c.req.param("fileId"), "file");
    return c.json(service.citedBy(getAuth(c), { fileId }, q));
  });

  // ---- writes -------------------------------------------------------------

  app.post("/documents/:id/blocks", requireWrite, async (c) => {
    const documentId = id(DocumentId, c.req.param("id"), "document");
    const body = withDocument(await readBody(c, WRITER_EXAMPLES.insert), documentId);
    return c.json(service.insertBlocks(getAuth(c), body as never), 201);
  });

  app.patch("/documents/:id/blocks/:blockId", requireWrite, async (c) => {
    const documentId = id(DocumentId, c.req.param("id"), "document");
    const blockId = id(BlockId, c.req.param("blockId"), "block");
    const raw = await readBody(c, WRITER_EXAMPLES.update);
    const mode = raw.mode ?? ("block" in raw ? "replace" : "patch");
    const body = { ...withDocument(raw, documentId), blockId, mode };
    return c.json(service.updateBlock(getAuth(c), body as never));
  });

  app.post("/documents/:id/blocks/move", requireWrite, async (c) => {
    const documentId = id(DocumentId, c.req.param("id"), "document");
    const body = withDocument(await readBody(c, WRITER_EXAMPLES.move), documentId);
    return c.json(service.moveBlocks(getAuth(c), body as never));
  });

  app.post("/documents/:id/blocks/delete", requireWrite, async (c) => {
    const documentId = id(DocumentId, c.req.param("id"), "document");
    const body = withDocument(await readBody(c, WRITER_EXAMPLES.delete), documentId);
    return c.json(service.deleteBlocks(getAuth(c), body as never));
  });

  app.post("/documents/:id/regenerate", requireWrite, async (c) => {
    const documentId = id(DocumentId, c.req.param("id"), "document");
    const body = withDocument(await readBody(c, WRITER_EXAMPLES.regenerate), documentId);
    return c.json(service.replaceGenerated(getAuth(c), body as never));
  });

  app.post("/documents/:id/revisions/:number/restore", requireWrite, async (c) => {
    const documentId = id(DocumentId, c.req.param("id"), "document");
    const revision = parse(RevisionNumber, c.req.param("number"), 3);
    const raw = await readBody(c, { expectedRevision: 5 }, true);
    const body = { ...withDocument(raw, documentId), revision };
    return c.json(service.restoreRevision(getAuth(c), body as never));
  });

  app.post("/documents/:id/review", requireWrite, requireSession, async (c) => {
    const documentId = id(DocumentId, c.req.param("id"), "document");
    const body = parse(
      ReviewBody,
      await readBody(c, WRITER_EXAMPLES.review),
      WRITER_EXAMPLES.review,
    );
    return c.json(service.setReview(getAuth(c), { documentId, ...body }));
  });

  return app;
}

const WRITER_EXAMPLES = {
  create: {
    parentId: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
    kind: "study_guide",
    title: "Beta blockers",
  },
  insert: { blocks: [{ type: "divider" }], position: "end", expectedRevision: 3 },
  update: {
    mode: "patch",
    patch: { content: { text: "New text" } },
    requestId: EXAMPLE_REQUEST_ID,
  },
  move: { blockIds: [BLOCK], position: "start" },
  delete: { blockIds: [BLOCK] },
  regenerate: { blocks: [{ type: "divider" }] },
  review: { status: "reviewed", blockIds: [BLOCK], expectedRevision: 4 },
  batch: {
    operations: [{ operation: "delete_blocks", input: { documentId: ID, blockIds: [BLOCK] } }],
  },
};
