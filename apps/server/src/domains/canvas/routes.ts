import { CANVAS_EXAMPLES, DocumentId, type Problem } from "@notes/schema";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { type AppEnv, getAuth, requireAuth, requireWrite } from "../../http/auth-context.js";
import { AppError } from "../../http/errors.js";
import type { CanvasService, ChangeOutcome, LayoutVariant } from "./service.js";

const HEARTBEAT_MS = 25_000;
const Variant = z.enum(["wide", "tall"]);

function documentId(value: string | undefined): string {
  const parsed = DocumentId.safeParse(value);
  if (!parsed.success) {
    throw new AppError("not_found", "No such document.", {
      hint: "A document ID looks like doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8.",
    });
  }
  return parsed.data as string;
}

function variant(value: string | undefined): LayoutVariant {
  const parsed = Variant.safeParse(value);
  if (!parsed.success) {
    throw new AppError("not_found", "No such layout variant.", {
      hint: 'The variant is "wide" (tablet, computer) or "tall" (phone).',
    });
  }
  return parsed.data;
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
function withDocument(body: Record<string, unknown>, id: string): Record<string, unknown> {
  if (body.documentId !== undefined && body.documentId !== id) {
    throw new AppError("invalid_input", "The body's documentId differs from the one in the URL.", {
      hint: "Leave documentId out of the body, or make them the same.",
    });
  }
  return { ...body, documentId: id };
}

const STATUS = { invalid: 400, conflict: 409, protected: 403, forbidden: 403 } as const;
const CODE = {
  invalid: "invalid_input",
  conflict: "conflict",
  protected: "forbidden",
  forbidden: "forbidden",
} as const;

/**
 * The shared `{ error: ApiError }` body, with the problems the validators found in `error.problems`
 * and, for the web store (which reads them at the top), again as `problems`.
 */
function refusalBody(kind: keyof typeof STATUS, problems: readonly Problem[]) {
  const first = problems[0];
  const message = !first
    ? "The change was refused."
    : problems.length === 1
      ? `${first.path}: ${first.message}`
      : `${problems.length} problems. First, at ${first.path}: ${first.message}`;
  const hint =
    kind === "conflict"
      ? "Read the canvas again (GET /api/documents/:id/canvas), check the change still makes sense, and resend with the current revision."
      : kind === "protected"
        ? "She made, edited or pinned it. To change it anyway, claim a request of hers about this document and pass its ID as requestId; otherwise add your own cards next to hers."
        : "Fix the value at the path named and send again.";
  return {
    error: {
      code: CODE[kind],
      message,
      hint,
      ...(first?.example !== undefined ? { example: first.example } : {}),
      problems,
    },
    problems,
    message,
  };
}

export function canvasRoutes(service: CanvasService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const respond = (
    c: { json(body: unknown, status?: 200 | 400 | 403 | 409): Response },
    outcome: ChangeOutcome,
  ): Response => {
    if (outcome.ok) return c.json({ canvas: outcome.canvas, report: outcome.report });
    return c.json(refusalBody(outcome.kind, outcome.problems), STATUS[outcome.kind]);
  };

  app.get("/documents/:id/canvas", requireAuth, (c) =>
    c.json(service.get(getAuth(c), documentId(c.req.param("id")))),
  );

  app.post("/documents/:id/canvas/ops", requireWrite, async (c) => {
    const id = documentId(c.req.param("id"));
    const body = withDocument(await readBody(c, CANVAS_EXAMPLES.change), id);
    return respond(c, service.change(getAuth(c), id, body));
  });

  app.put("/documents/:id/canvas/structure", requireWrite, async (c) => {
    const id = documentId(c.req.param("id"));
    const body = withDocument(await readBody(c, CANVAS_EXAMPLES.setStructure), id);
    return respond(c, service.setStructure(getAuth(c), id, body));
  });

  app.put("/documents/:id/canvas/placements", requireWrite, async (c) => {
    const id = documentId(c.req.param("id"));
    const body = await readBody(c, {
      placements: [{ id: "crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", x: 120, y: 80 }],
    });
    const out = service.savePlacements(getAuth(c), id, body);
    if ("ok" in out) return c.json(refusalBody("invalid", out.problems), 400);
    return c.json({ canvas: out.canvas, placed: out.placed, ignored: out.ignored });
  });

  app.post("/documents/:id/canvas/arrange", requireWrite, async (c) => {
    const id = documentId(c.req.param("id"));
    const body = await readBody(c, { releasePins: false }, true);
    return respond(c, service.arrange(getAuth(c), id, { releasePins: body.releasePins === true }));
  });

  app.get("/documents/:id/canvas/layout-cache/:variant", requireAuth, (c) => {
    const positions = service.getLayoutCache(
      getAuth(c),
      documentId(c.req.param("id")),
      variant(c.req.param("variant")),
    );
    return positions ? c.json({ positions }) : c.body(null, 204);
  });

  app.put("/documents/:id/canvas/layout-cache/:variant", requireWrite, async (c) => {
    const body = await readBody(c, {
      positions: { crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8: { x: 120, y: 80 } },
    });
    return c.json(
      service.saveLayoutCache(
        getAuth(c),
        documentId(c.req.param("id")),
        variant(c.req.param("variant")),
        body.positions,
      ),
    );
  });

  /**
   * Server-Sent Events: `event: canvas` with a `LoadedCanvas` after every change to the canvas or to
   * the document's blocks. Each message is the whole state, so a missed one costs nothing and the
   * browser's automatic reconnect needs no replay. A comment line every 25 seconds keeps idle
   * connections open through the reverse proxy; `X-Accel-Buffering: no` stops nginx-style buffering
   * (Caddy flushes event streams as they come).
   */
  app.get("/documents/:id/canvas/events", requireAuth, (c) => {
    const auth = getAuth(c);
    const id = documentId(c.req.param("id"));
    service.assertVisible(auth, id);
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let closed = false;
      const done = new Promise<void>((resolve) => {
        const finish = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          clearInterval(beat);
          resolve();
        };
        const send = () => {
          if (closed) return;
          try {
            const loaded = service.get(auth, id);
            void stream
              .writeSSE({
                event: "canvas",
                data: JSON.stringify(loaded),
                id: String(loaded.canvas.revision),
              })
              .catch(finish);
          } catch {
            // The document went to the trash or was deleted: nothing more to say.
            finish();
          }
        };
        const unsubscribe = service.events.subscribe(id, send);
        const beat = setInterval(() => {
          void stream.write(": ping\n\n").catch(finish);
        }, HEARTBEAT_MS);
        beat.unref();
        stream.onAbort(finish);
      });
      await stream.write("retry: 3000\n\n");
      await done;
    });
  });

  return app;
}
