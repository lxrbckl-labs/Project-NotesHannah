import {
  CancelRequestInput,
  ClaimRequestInput,
  CompleteRequestInput,
  CreateRequestInput,
  DeclineRequestInput,
  EditRequestInput,
  REQUEST_EXAMPLES,
  REQUEST_TARGET_TYPES,
  ReleaseRequestInput,
  ReopenRequestInput,
  RequestId,
  RequestStatus,
} from "@notes/schema";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, getAuth, requireAuth, requireWrite } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { createRequestsService, type RequestsPorts, type RequestsService } from "./service.js";

const ID = "req_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";

const StatusList = z
  .string()
  .max(100)
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(RequestStatus).min(1).max(5));

const ListQuery = z.object({
  status: StatusList.optional(),
  targetType: z.enum(REQUEST_TARGET_TYPES).optional(),
  nodeId: z.string().max(60).optional(),
  documentId: z.string().max(60).optional(),
  blockId: z.string().max(60).optional(),
  fileId: z.string().max(60).optional(),
  questionId: z.string().max(60).optional(),
  order: z.enum(["newest", "oldest"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

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

function idOf(value: string | undefined): string {
  const result = RequestId.safeParse(value);
  if (!result.success) {
    throw new AppError("not_found", "No such request.", {
      hint: `A request ID looks like ${ID}. List requests with GET /api/requests.`,
    });
  }
  return result.data as string;
}

async function readBody(
  c: { req: { json(): Promise<unknown> } },
  example: unknown,
  optional = false,
) {
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
  return body;
}

/**
 * Mounted at /api. Her side (create, edit, cancel, reopen) is for a browser
 * session; the agent's side (claim, release, complete, decline) is for API
 * keys with write scope. Reads are open to both, including read-only keys.
 */
export function requestsRoutes(
  deps: Pick<ServerDeps, "db" | "now">,
  ports: RequestsPorts = {},
  service: RequestsService = createRequestsService(deps, ports),
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/requests", requireAuth, (c) => {
    const q = parse(ListQuery, c.req.query(), { status: "waiting", order: "oldest" });
    return c.json(service.list(getAuth(c), q));
  });

  // Registered before `/requests/:id`, which would otherwise take "counts" for an ID.
  app.get("/requests/counts", requireAuth, (c) => c.json({ counts: service.counts(getAuth(c)) }));

  app.post("/requests", requireWrite, async (c) => {
    const body = parse(
      CreateRequestInput,
      await readBody(c, REQUEST_EXAMPLES.create),
      REQUEST_EXAMPLES.create,
    );
    return c.json({ request: service.create(getAuth(c), body) }, 201);
  });

  app.get("/requests/:id", requireAuth, (c) => {
    return c.json({ request: service.get(getAuth(c), idOf(c.req.param("id"))) });
  });

  app.patch("/requests/:id", requireWrite, async (c) => {
    const body = parse(
      EditRequestInput,
      await readBody(c, REQUEST_EXAMPLES.edit),
      REQUEST_EXAMPLES.edit,
    );
    return c.json({ request: service.edit(getAuth(c), idOf(c.req.param("id")), body) });
  });

  app.post("/requests/:id/cancel", requireWrite, async (c) => {
    parse(CancelRequestInput, await readBody(c, {}, true), {});
    return c.json({ request: service.cancel(getAuth(c), idOf(c.req.param("id"))) });
  });

  app.post("/requests/:id/reopen", requireWrite, async (c) => {
    const body = parse(
      ReopenRequestInput,
      await readBody(c, REQUEST_EXAMPLES.reopen, true),
      REQUEST_EXAMPLES.reopen,
    );
    return c.json({ request: service.reopen(getAuth(c), idOf(c.req.param("id")), body) });
  });

  app.post("/requests/:id/claim", requireWrite, async (c) => {
    const body = parse(
      ClaimRequestInput,
      await readBody(c, REQUEST_EXAMPLES.claim, true),
      REQUEST_EXAMPLES.claim,
    );
    return c.json({ request: service.claim(getAuth(c), idOf(c.req.param("id")), body) });
  });

  app.post("/requests/:id/release", requireWrite, async (c) => {
    const body = parse(ReleaseRequestInput, await readBody(c, {}, true), {});
    return c.json({ request: service.release(getAuth(c), idOf(c.req.param("id")), body) });
  });

  app.post("/requests/:id/complete", requireWrite, async (c) => {
    const body = parse(
      CompleteRequestInput,
      await readBody(c, REQUEST_EXAMPLES.complete),
      REQUEST_EXAMPLES.complete,
    );
    return c.json({ request: service.complete(getAuth(c), idOf(c.req.param("id")), body) });
  });

  app.post("/requests/:id/decline", requireWrite, async (c) => {
    const body = parse(
      DeclineRequestInput,
      await readBody(c, REQUEST_EXAMPLES.decline),
      REQUEST_EXAMPLES.decline,
    );
    return c.json({ request: service.decline(getAuth(c), idOf(c.req.param("id")), body) });
  });

  return app;
}
