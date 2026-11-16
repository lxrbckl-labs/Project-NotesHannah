import {
  CONCEPT_EXAMPLES,
  CONCEPT_TYPES,
  ConceptId,
  ConceptType,
  MergeConceptsInput,
  RELATION_RULES,
  RELATION_TYPES,
  RelationId,
  RelationType,
  ReviewInput,
} from "@notes/schema";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, getAuth, requireAuth, requireWrite } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { type ConceptsPorts, type ConceptsService, createConceptsService } from "./service.js";

const CONCEPT = "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";

const Limit = z.coerce.number().int().min(1).max(500);
const TypeList = z
  .string()
  .max(300)
  .transform((value) =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  )
  .pipe(z.array(RelationType).max(RELATION_TYPES.length));

const ListQuery = z.object({
  type: ConceptType.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().max(300).optional(),
  limit: Limit.default(50),
});
const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  type: ConceptType.optional(),
  limit: Limit.default(20),
});
const GraphQueryParams = z.object({
  hops: z.coerce.number().int().min(1).max(4).optional(),
  maxNodes: z.coerce.number().int().min(2).max(200).optional(),
  relationTypes: TypeList.optional(),
});
const PathQueryParams = z.object({
  from: z.string().max(60),
  to: z.string().max(60),
  maxHops: z.coerce.number().int().min(1).max(8).optional(),
  relationTypes: TypeList.optional(),
});
const BrandQuery = z.object({
  classId: z.string().max(60).optional(),
  limit: Limit.optional(),
});
const RelationListQuery = z.object({
  from: z.string().max(60).optional(),
  to: z.string().max(60).optional(),
  type: RelationType.optional(),
});
const NameChecksBody = z.strictObject({ limit: z.number().int().min(1).max(100).optional() });

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

function idOf(
  schema: typeof ConceptId | typeof RelationId,
  value: string | undefined,
  what: string,
): string {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("not_found", `No such ${what}.`, {
      hint: `A ${what} ID looks like ${CONCEPT}. Find concepts with GET /api/concepts/search?q=.`,
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
 * Mounted at /api. Reads (including the query and compare routes, which are
 * POSTs only because their bodies are structured) are open to any key; changes
 * need write; deleting and reviewing need her browser session.
 */
export function conceptsRoutes(
  deps: Pick<ServerDeps, "db" | "now">,
  ports: ConceptsPorts = {},
  service: ConceptsService = createConceptsService(deps, ports),
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // ---- fixed paths first, so ":id" never swallows them -------------------------------------

  app.get("/concepts", requireAuth, (c) => {
    const q = parse(ListQuery, c.req.query(), { type: "drug", limit: 50 });
    return c.json(service.list(getAuth(c), q));
  });

  app.get("/concepts/search", requireAuth, (c) => {
    const q = parse(SearchQuery, c.req.query(), { q: "metop" });
    return c.json({ items: service.search(getAuth(c), q.q, { type: q.type, limit: q.limit }) });
  });

  app.get("/concepts/types", requireAuth, (c) =>
    c.json({
      concepts: CONCEPT_TYPES,
      relations: RELATION_TYPES.map((type) => ({ type, ...RELATION_RULES[type] })),
    }),
  );

  app.get("/concepts/brand-generic", requireAuth, (c) => {
    const q = parse(BrandQuery, c.req.query(), { classId: CONCEPT });
    return c.json({ items: service.brandGenericPairs(getAuth(c), q) });
  });

  app.get("/concepts/path", requireAuth, (c) => {
    const q = parse(PathQueryParams, c.req.query(), { from: CONCEPT, to: CONCEPT });
    return c.json(
      service.path(
        getAuth(c),
        idOf(ConceptId, q.from, "concept"),
        idOf(ConceptId, q.to, "concept"),
        {
          maxHops: q.maxHops,
          relationTypes: q.relationTypes,
        },
      ),
    );
  });

  app.post("/concepts/query", requireAuth, async (c) => {
    const body = await readBody(c, {
      kind: "in_class",
      class: { type: "drug_class", name: "beta blockers" },
    });
    return c.json(service.filter(getAuth(c), body));
  });

  app.post("/concepts/compare", requireAuth, async (c) => {
    const body = await readBody(c, {
      conceptIds: [CONCEPT, CONCEPT],
      attributes: ["causes_adverse_effect"],
    });
    return c.json(service.compare(getAuth(c), body));
  });

  app.post("/concepts/bulk", requireWrite, async (c) => {
    const body = await readBody(c, CONCEPT_EXAMPLES.bulk);
    const result = service.bulkUpsert(getAuth(c), body);
    if (!result.applied) {
      const shown = result.problems.slice(0, 20);
      throw new AppError(
        "invalid_input",
        `Nothing was written: ${result.problems.length} problem${result.problems.length === 1 ? "" : "s"}. First, at ${shown[0]?.path}: ${shown[0]?.message}`,
        {
          hint: `${shown.map((p) => `${p.path}: ${p.message}`).join("\n")}\nFix these and send again, or send "partial": true to write the items that are fine.`,
          example: shown[0]?.example,
        },
      );
    }
    return c.json(result);
  });

  app.post("/concepts/name-checks", requireWrite, async (c) => {
    const body = parse(NameChecksBody, await readBody(c, {}, true), { limit: 20 });
    return c.json(await service.checkPending(getAuth(c), body.limit));
  });

  app.post("/concepts", requireWrite, async (c) => {
    const body = await readBody(c, CONCEPT_EXAMPLES.concept);
    const made = service.createConcept(getAuth(c), body);
    return c.json(made, 201);
  });

  // ---- one concept ----------------------------------------------------------------------------------

  app.get("/concepts/:id", requireAuth, (c) =>
    c.json(service.getConcept(getAuth(c), idOf(ConceptId, c.req.param("id"), "concept"))),
  );

  app.get("/concepts/:id/page", requireAuth, (c) =>
    c.json(service.page(getAuth(c), idOf(ConceptId, c.req.param("id"), "concept"))),
  );

  app.get("/concepts/:id/graph", requireAuth, (c) => {
    const q = parse(GraphQueryParams, c.req.query(), { hops: 2, maxNodes: 60 });
    return c.json(
      service.neighbourhood(getAuth(c), idOf(ConceptId, c.req.param("id"), "concept"), q),
    );
  });

  app.get("/concepts/:id/suggestions", requireAuth, (c) =>
    c.json({
      items: service.suggestionsFor(getAuth(c), idOf(ConceptId, c.req.param("id"), "concept")),
    }),
  );

  app.patch("/concepts/:id", requireWrite, async (c) => {
    const body = await readBody(c, { aliases: ["metoprolol tartrate"] });
    return c.json({
      concept: service.updateConcept(
        getAuth(c),
        idOf(ConceptId, c.req.param("id"), "concept"),
        body,
      ),
    });
  });

  app.delete("/concepts/:id", requireWrite, (c) => {
    service.deleteConcept(getAuth(c), idOf(ConceptId, c.req.param("id"), "concept"));
    return c.body(null, 204);
  });

  app.post("/concepts/:id/merge", requireWrite, async (c) => {
    const body = parse(MergeConceptsInput, await readBody(c, { mergeId: CONCEPT }), {
      mergeId: CONCEPT,
    });
    return c.json(
      service.merge(getAuth(c), idOf(ConceptId, c.req.param("id"), "concept"), body.mergeId),
    );
  });

  app.post("/concepts/:id/review", requireWrite, async (c) => {
    const body = parse(ReviewInput, await readBody(c, { status: "reviewed" }), {
      status: "reviewed",
    });
    return c.json({
      concept: service.setReview(
        getAuth(c),
        "concept",
        idOf(ConceptId, c.req.param("id"), "concept"),
        body.status,
      ),
    });
  });

  app.post("/concepts/:id/name-check", requireWrite, async (c) => {
    return c.json({
      concept: await service.checkName(getAuth(c), idOf(ConceptId, c.req.param("id"), "concept")),
    });
  });

  // ---- relations ---------------------------------------------------------------------------------------

  app.get("/relations", requireAuth, (c) => {
    const q = parse(RelationListQuery, c.req.query(), { from: CONCEPT });
    return c.json({ items: service.listRelations(getAuth(c), q) });
  });

  app.post("/relations", requireWrite, async (c) => {
    const body = await readBody(c, CONCEPT_EXAMPLES.relation);
    return c.json({ relation: service.createRelation(getAuth(c), body) }, 201);
  });

  app.get("/relations/:id", requireAuth, (c) =>
    c.json({
      relation: service.getRelation(getAuth(c), idOf(RelationId, c.req.param("id"), "relation")),
    }),
  );

  app.patch("/relations/:id", requireWrite, async (c) => {
    const body = await readBody(c, { note: "Dose related." });
    return c.json({
      relation: service.updateRelation(
        getAuth(c),
        idOf(RelationId, c.req.param("id"), "relation"),
        body,
      ),
    });
  });

  app.delete("/relations/:id", requireWrite, (c) => {
    service.deleteRelation(getAuth(c), idOf(RelationId, c.req.param("id"), "relation"));
    return c.body(null, 204);
  });

  app.post("/relations/:id/review", requireWrite, async (c) => {
    const body = parse(ReviewInput, await readBody(c, { status: "reviewed" }), {
      status: "reviewed",
    });
    return c.json({
      relation: service.setReview(
        getAuth(c),
        "relation",
        idOf(RelationId, c.req.param("id"), "relation"),
        body.status,
      ),
    });
  });

  return app;
}
