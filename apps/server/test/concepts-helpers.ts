import { type ConceptType, newId, type RelationType } from "@notes/schema";
import { Hono } from "hono";
import { createTestDatabase } from "../src/db/client.js";
import {
  type ConceptsPorts,
  conceptsRoutes,
  createConceptsService,
  createFakeConceptMentions,
  createFakeConceptQuestions,
  createFakeConceptSources,
} from "../src/domains/concepts/index.js";
import type { AppEnv, AuthContext } from "../src/http/auth-context.js";
import { handleError } from "../src/http/errors.js";

// biome-ignore lint/suspicious/noExplicitAny: response bodies are inspected loosely in tests
export type Json = any;

export function userAuth(userId: string): AuthContext {
  return {
    userId,
    actor: { type: "user", userId },
    via: "session",
    scope: "write",
    sessionId: "ses_x",
  };
}

export function agentAuth(
  userId: string,
  keyId = newId("apiKey"),
  scope: "read" | "write" = "write",
  label = "Claude Code",
): AuthContext {
  return { userId, actor: { type: "agent", keyId, label }, via: "key", scope };
}

export function thrown(fn: () => unknown): {
  code: string;
  message: string;
  hint?: string;
  example?: unknown;
} {
  try {
    fn();
  } catch (error) {
    return error as never;
  }
  throw new Error("expected the call to throw");
}

export function setupConcepts(options: { ports?: ConceptsPorts } = {}) {
  const db = createTestDatabase();
  let ms = Date.UTC(2026, 10, 15, 12, 0, 0);
  const now = () => {
    ms += 1000;
    return ms;
  };
  const sources = createFakeConceptSources();
  const mentions = createFakeConceptMentions();
  const questions = createFakeConceptQuestions();
  const deps = { db, now };
  const service = createConceptsService(deps, { sources, mentions, questions, ...options.ports });

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const user = c.req.header("x-user");
    const key = c.req.header("x-key");
    const scope = (c.req.header("x-scope") ?? "write") as "read" | "write";
    let auth: AuthContext | null = null;
    if (user && key) auth = agentAuth(user, key, scope);
    else if (user) auth = { ...userAuth(user), scope };
    c.set("auth", auth);
    await next();
  });
  app.route("/api", conceptsRoutes(deps, {}, service));
  app.onError(handleError);

  const alice = newId("user");
  const bob = newId("user");
  const she = userAuth(alice);
  const herBob = userAuth(bob);
  const bot = agentAuth(alice);
  const otherBot = agentAuth(alice, newId("apiKey"), "write", "Codex");
  const readBot = agentAuth(alice, newId("apiKey"), "read");
  const bobBot = agentAuth(bob);

  async function call(
    who: { user?: string; key?: string; scope?: string } | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Json }> {
    const headers: Record<string, string> = {};
    if (who?.user) headers["x-user"] = who.user;
    if (who?.key) headers["x-key"] = who.key;
    if (who?.scope) headers["x-scope"] = who.scope;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  const asUser = (userId: string) => ({ user: userId });
  const asKey = (auth: AuthContext) => ({
    user: auth.userId,
    key: (auth.actor as { keyId: string }).keyId,
    scope: auth.scope,
  });

  let pageCounter = 0;
  /** A page the fake source lookup knows, whose transcript holds `quote`. */
  function page(userId: string, quote: string, label = `Slide ${++pageCounter}`) {
    const fileId = newId("file");
    const pageId = newId("page");
    sources.addPage({
      userId,
      fileId,
      pageId,
      fileName: `${label}.pdf`,
      pageIndex: 1,
      transcript: `${label}. ${quote} More text.`,
    });
    return { fileId, pageId, quote, label };
  }

  return {
    db,
    deps,
    service,
    app,
    sources,
    mentions,
    questions,
    alice,
    bob,
    she,
    herBob,
    bot,
    otherBot,
    readBot,
    bobBot,
    call,
    asUser,
    asKey,
    page,
    clock: { now: () => ms },
  };
}

export type Concepts = ReturnType<typeof setupConcepts>;

// ---- the invented dataset: two courses, about forty concepts ---------------------------------------------

type Ref = string;

/**
 * Real drug-class structure, generic content: beta blockers and ACE inhibitors from a
 * pharmacology course, calcium channel blockers, macrolides and QT-prolonging drugs from a
 * cardiology course. Nothing here is clinical advice; it only has the right shape.
 */
const CONCEPTS: Array<[ConceptType, string, string?]> = [
  ["drug_class", "beta blockers"],
  ["drug_class", "cardioselective beta blockers"],
  ["drug_class", "non-selective beta blockers"],
  ["drug_class", "ACE inhibitors"],
  ["drug_class", "non-dihydropyridine calcium channel blockers"],
  ["drug_class", "macrolide antibiotics"],
  ["drug", "metoprolol"],
  ["drug", "atenolol"],
  ["drug", "bisoprolol"],
  ["drug", "propranolol"],
  ["drug", "carvedilol"],
  ["drug", "sotalol"],
  ["drug", "lisinopril"],
  ["drug", "enalapril"],
  ["drug", "ramipril"],
  ["drug", "verapamil"],
  ["drug", "azithromycin"],
  ["drug", "clarithromycin"],
  ["drug", "ondansetron"],
  ["mechanism", "beta-1 receptor antagonism"],
  ["mechanism", "beta-1 and beta-2 receptor antagonism"],
  ["mechanism", "ACE inhibition"],
  ["mechanism", "L-type calcium channel blockade"],
  ["target", "beta-1 adrenergic receptor"],
  ["target", "beta-2 adrenergic receptor"],
  ["target", "angiotensin-converting enzyme"],
  ["indication", "hypertension"],
  ["indication", "heart failure"],
  ["indication", "migraine prophylaxis"],
  ["adverse_effect", "bradycardia"],
  ["adverse_effect", "bronchospasm"],
  ["adverse_effect", "hyperkalemia"],
  ["adverse_effect", "dry cough"],
  ["adverse_effect", "angioedema"],
  ["adverse_effect", "QT prolongation"],
  ["adverse_effect", "hypotension"],
  ["contraindication", "severe bradycardia"],
  ["contraindication", "pregnancy"],
  ["monitoring_parameter", "heart rate"],
  ["monitoring_parameter", "serum potassium"],
  ["counselling_point", "do not stop beta blockers abruptly"],
  ["drug", "Lopressor"],
];

const BRANDS: Record<string, string[]> = {
  metoprolol: ["Lopressor", "Toprol-XL"],
  atenolol: ["Tenormin"],
  bisoprolol: ["Zebeta"],
  propranolol: ["Inderal"],
  carvedilol: ["Coreg"],
  lisinopril: ["Zestril", "Prinivil"],
  enalapril: ["Vasotec"],
  ramipril: ["Altace"],
  verapamil: ["Calan"],
  azithromycin: ["Zithromax"],
  ondansetron: ["Zofran"],
};

/** Which of two courses taught it: "A" is the pharmacology course, "B" the cardiology one. */
const COURSE_B = new Set([
  "non-dihydropyridine calcium channel blockers",
  "macrolide antibiotics",
  "verapamil",
  "azithromycin",
  "clarithromycin",
  "ondansetron",
  "sotalol",
  "L-type calcium channel blockade",
  "QT prolongation",
  "hypotension",
]);

type RelSpec = [RelationType, Ref, Ref, Record<string, unknown>?];

const RELATIONS: RelSpec[] = [
  ["belongs_to_class", "metoprolol", "cardioselective beta blockers"],
  ["belongs_to_class", "atenolol", "cardioselective beta blockers"],
  ["belongs_to_class", "bisoprolol", "cardioselective beta blockers"],
  ["belongs_to_class", "cardioselective beta blockers", "beta blockers"],
  ["belongs_to_class", "non-selective beta blockers", "beta blockers"],
  ["belongs_to_class", "propranolol", "non-selective beta blockers"],
  ["belongs_to_class", "carvedilol", "non-selective beta blockers"],
  ["belongs_to_class", "sotalol", "non-selective beta blockers"],
  ["belongs_to_class", "lisinopril", "ACE inhibitors"],
  ["belongs_to_class", "enalapril", "ACE inhibitors"],
  ["belongs_to_class", "ramipril", "ACE inhibitors"],
  ["belongs_to_class", "verapamil", "non-dihydropyridine calcium channel blockers"],
  ["belongs_to_class", "azithromycin", "macrolide antibiotics"],
  ["belongs_to_class", "clarithromycin", "macrolide antibiotics"],
  ["has_mechanism", "cardioselective beta blockers", "beta-1 receptor antagonism"],
  ["has_mechanism", "non-selective beta blockers", "beta-1 and beta-2 receptor antagonism"],
  ["has_mechanism", "ACE inhibitors", "ACE inhibition"],
  [
    "has_mechanism",
    "non-dihydropyridine calcium channel blockers",
    "L-type calcium channel blockade",
  ],
  ["has_mechanism", "ramipril", "ACE inhibition"],
  ["acts_on", "beta-1 receptor antagonism", "beta-1 adrenergic receptor"],
  ["acts_on", "beta-1 and beta-2 receptor antagonism", "beta-1 adrenergic receptor"],
  ["acts_on", "beta-1 and beta-2 receptor antagonism", "beta-2 adrenergic receptor"],
  ["acts_on", "ACE inhibition", "angiotensin-converting enzyme"],
  ["acts_on", "metoprolol", "beta-1 adrenergic receptor"],
  ["treats", "beta blockers", "hypertension"],
  ["treats", "metoprolol", "heart failure"],
  ["treats", "propranolol", "migraine prophylaxis"],
  ["treats", "ACE inhibitors", "hypertension"],
  ["treats", "ACE inhibitors", "heart failure"],
  ["treats", "verapamil", "hypertension"],
  ["causes_adverse_effect", "beta blockers", "bradycardia"],
  ["causes_adverse_effect", "non-selective beta blockers", "bronchospasm"],
  ["causes_adverse_effect", "ACE inhibitors", "dry cough"],
  ["causes_adverse_effect", "ACE inhibitors", "hyperkalemia"],
  ["causes_adverse_effect", "ACE inhibitors", "angioedema"],
  ["causes_adverse_effect", "macrolide antibiotics", "QT prolongation"],
  ["causes_adverse_effect", "sotalol", "QT prolongation"],
  ["causes_adverse_effect", "ondansetron", "QT prolongation"],
  ["causes_adverse_effect", "verapamil", "bradycardia"],
  ["causes_adverse_effect", "verapamil", "hypotension"],
  ["causes_adverse_effect", "lisinopril", "hypotension"],
  ["contraindicated_in", "beta blockers", "severe bradycardia"],
  ["contraindicated_in", "ACE inhibitors", "pregnancy"],
  ["monitored_by", "beta blockers", "heart rate"],
  ["monitored_by", "ACE inhibitors", "serum potassium"],
  [
    "interacts_with",
    "metoprolol",
    "verapamil",
    { interaction: { severity: "major", effect: "additive bradycardia and AV block" } },
  ],
  [
    "interacts_with",
    "azithromycin",
    "ondansetron",
    { interaction: { severity: "moderate", effect: "additive QT prolongation" } },
  ],
  ["brand_of", "Lopressor", "metoprolol"],
  ["related_to", "do not stop beta blockers abruptly", "beta blockers"],
];

export interface Dataset {
  /** Concept IDs by name. */
  id: Record<string, string>;
  /** Relation IDs by "type|from|to". */
  rel: Record<string, string>;
  /** The pages cited, by course. */
  pages: { A: ReturnType<Concepts["page"]>; B: ReturnType<Concepts["page"]> };
  conceptCount: number;
  relationCount: number;
}

/** Load the dataset as the agent `t.bot`, in one atomic bulk call. */
export function seedDataset(t: Concepts, auth: AuthContext = t.bot): Dataset {
  const userId = auth.userId;
  const quoteA = "Course A: beta blockers and ACE inhibitors are first-line cardiovascular drugs.";
  const quoteB = "Course B: calcium channel blockers, macrolides and QT-prolonging drugs.";
  const A = t.page(userId, quoteA, "Pharmacology II, lecture 7");
  const B = t.page(userId, quoteB, "Cardiology therapeutics, lecture 3");
  const typeOf = new Map(CONCEPTS.map(([type, name]) => [name, type]));
  const cite = (name: string) =>
    [COURSE_B.has(name) ? B : A].map((p) => ({
      fileId: p.fileId,
      pageId: p.pageId,
      quote: p.quote,
      label: p.label.slice(0, 40),
    }));

  const concepts = CONCEPTS.map(([type, name]) => ({
    type,
    name,
    citations: cite(name),
    ...(type === "drug" && BRANDS[name] ? { drug: { brandNames: BRANDS[name] } } : {}),
  }));
  const relations = RELATIONS.map(([type, from, to, extra]) => ({
    type,
    from: { type: typeOf.get(from) as ConceptType, name: from },
    to: { type: typeOf.get(to) as ConceptType, name: to },
    citations: cite(
      COURSE_B.has(from) || COURSE_B.has(to) ? (COURSE_B.has(from) ? from : to) : from,
    ),
    ...extra,
  }));

  const result = t.service.bulkUpsert(auth, { concepts, relations });
  if (!result.applied)
    throw new Error(`seed failed: ${JSON.stringify(result.problems.slice(0, 3))}`);
  const id: Record<string, string> = {};
  for (const r of result.concepts) id[r.name] = r.id as string;
  const rel: Record<string, string> = {};
  result.relations.forEach((r, i) => {
    const [type, from, to] = RELATIONS[i] as RelSpec;
    rel[`${type}|${from}|${to}`] = r.id as string;
  });
  return {
    id,
    rel,
    pages: { A, B },
    conceptCount: concepts.length,
    relationCount: relations.length,
  };
}
