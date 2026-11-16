/**
 * The authoring validator: what the MCP layer calls to check a question an
 * agent wants to create. It returns either the normalised question or a list
 * of problems, each with a JSON path, a plain-language message, and a minimal
 * valid example for that question type, so the agent can correct itself.
 */
import { z } from "zod";
import type { Actor } from "../common.js";
import { newId } from "../ids.js";
import { type CoreLike, coreIssues } from "./checks.js";
import {
  QUESTION_INPUT_SCHEMAS,
  QUESTION_TYPES,
  Question,
  type QuestionInput,
  QuestionInput as QuestionInputSchema,
  type QuestionType,
} from "./content.js";
import { exampleFor } from "./registry.js";

export interface Problem {
  /** JSON path to the field, e.g. `$.options[2].text`. `$` is the whole question. */
  path: string;
  /** What is wrong and how to fix it, in plain language. */
  message: string;
  /** A minimal valid question of the type (multiple_choice when the type is missing or unknown). */
  example: Record<string, unknown>;
}

export type ValidationResult =
  | { ok: true; question: QuestionInput }
  | { ok: false; problems: Problem[] };

/** `$.options[2].text` style path. */
export function jsonPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    const name = String(seg);
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      ? `${acc}.${name}`
      : `${acc}[${JSON.stringify(name)}]`;
  }, "$");
}

type JsonNode = Record<string, unknown>;

const jsonSchemaCache = new Map<string, JsonNode>();
function jsonSchemaOf(type: QuestionType): JsonNode {
  let s = jsonSchemaCache.get(type);
  if (!s) {
    s = z.toJSONSchema(QUESTION_INPUT_SCHEMAS[type], {
      io: "input",
      unrepresentable: "any",
    }) as JsonNode;
    jsonSchemaCache.set(type, s);
  }
  return s;
}

function at(value: unknown, key: string | number): unknown {
  return value !== null && typeof value === "object"
    ? (value as Record<string | number, unknown>)[key]
    : undefined;
}

/** The JSON Schema node for a path, choosing between alternatives by the `kind` or `type` value in the input. */
function nodeAt(root: JsonNode, input: unknown, path: ReadonlyArray<PropertyKey>): JsonNode | null {
  let node: JsonNode | undefined = root;
  let value: unknown = input;
  const pick = (n: JsonNode, v: unknown): JsonNode => {
    const alts = (n.anyOf ?? n.oneOf) as JsonNode[] | undefined;
    if (!alts) return n;
    const found = alts.find((alt) => {
      const props = alt.properties as Record<string, JsonNode> | undefined;
      return ["type", "kind", "mode"].some(
        (d) => props?.[d]?.const !== undefined && props[d]?.const === at(v, d),
      );
    });
    return found ?? (alts[0] as JsonNode);
  };
  for (const seg of path) {
    if (!node) return null;
    node = pick(node, value);
    if (typeof seg === "number") node = node.items as JsonNode | undefined;
    else node = (node.properties as Record<string, JsonNode> | undefined)?.[String(seg)];
    value = at(value, seg as string | number);
  }
  return node ? pick(node, value) : null;
}

function describeKeys(node: JsonNode | null): string {
  const props = node?.properties as Record<string, unknown> | undefined;
  return props ? Object.keys(props).join(", ") : "";
}

function friendly(
  issue: z.core.$ZodIssue,
  input: unknown,
  type: QuestionType | null,
): Array<{ path: PropertyKey[]; message: string }> {
  const path = issue.path;
  if (issue.code === "unrecognized_keys") {
    const root = type ? jsonSchemaOf(type) : null;
    const allowed = root ? describeKeys(nodeAt(root, input, path)) : "";
    return (issue as { keys: string[] }).keys.map((key) => ({
      path: [...path, key],
      message: `Unknown field "${key}".${allowed ? ` Fields allowed here: ${allowed}.` : ""}`,
    }));
  }
  if (issue.code === "invalid_type" && (issue as { input?: unknown }).input === undefined) {
    const field = String(path[path.length - 1] ?? "value");
    if (issue.message.startsWith("Required:")) return [{ path, message: issue.message }];
    return [{ path, message: `Missing required field "${field}". ${issue.message}` }];
  }
  return [{ path, message: issue.message }];
}

/**
 * Check what an agent supplied. On success returns the question with defaults
 * filled in and tags tidied; on failure returns every problem found (not just
 * the first).
 */
export function validateQuestionInput(input: unknown): ValidationResult {
  const rawType =
    input !== null && typeof input === "object" ? (input as { type?: unknown }).type : undefined;
  const type = QUESTION_TYPES.find((t) => t === rawType) ?? null;
  const fallbackExample = exampleFor(type ?? "multiple_choice");

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      problems: [
        {
          path: "$",
          message: `A question must be an object with a "type" field. type is one of: ${QUESTION_TYPES.join(", ")}.`,
          example: fallbackExample,
        },
      ],
    };
  }

  const parsed = QuestionInputSchema.safeParse(input);
  if (!parsed.success) {
    const problems: Problem[] = [];
    const seen = new Set<string>();
    for (const issue of parsed.error.issues) {
      for (const f of friendly(issue, input, type)) {
        const path = jsonPath(f.path);
        const key = `${path}|${f.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const message =
          path === "$.type" && type === null
            ? rawType === undefined
              ? `Missing required field "type". It must be one of: ${QUESTION_TYPES.join(", ")}.`
              : `type "${String(rawType)}" is not a question type. It must be one of: ${QUESTION_TYPES.join(", ")}.`
            : f.message;
        problems.push({ path, message, example: fallbackExample });
      }
    }
    return { ok: false, problems };
  }

  const question = parsed.data;
  const deep = coreIssues(question as unknown as CoreLike, true);
  if (deep.length > 0) {
    return {
      ok: false,
      problems: deep.map((i) => ({
        path: jsonPath(i.path),
        message: i.message,
        example: fallbackExample,
      })),
    };
  }
  return { ok: true, question: tidy(question) };
}

/** Lower-case and de-duplicate tags and concept links; trim text fields that frame the question. */
function tidy(q: QuestionInput): QuestionInput {
  const tags = [...new Set(q.tags.map((t) => t.trim().toLowerCase()).filter((t) => t !== ""))];
  return { ...q, tags, conceptIds: [...new Set(q.conceptIds)] };
}

/** Pick ids for items that have none, never reusing one already in the list. */
function withIds<T extends { id?: string | undefined }>(
  items: T[],
  prefix: string,
): Array<T & { id: string }> {
  const used = new Set(items.map((i) => i.id).filter((i): i is string => i !== undefined));
  let n = 1;
  return items.map((item) => {
    if (item.id !== undefined) return item as T & { id: string };
    while (used.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    used.add(id);
    return { ...item, id };
  });
}

function giveIds<T extends { type: string }>(core: T): T {
  const c = core as unknown as Record<string, unknown>;
  if (core.type === "multiple_choice" || core.type === "select_all") {
    return { ...core, options: withIds(c.options as Array<{ id?: string }>, "o") };
  }
  if (core.type === "matching")
    return { ...core, pairs: withIds(c.pairs as Array<{ id?: string }>, "p") };
  if (core.type === "case") {
    return { ...core, questions: (c.questions as Array<{ type: string }>).map((p) => giveIds(p)) };
  }
  return core;
}

export interface StoreContext {
  author: Actor;
  /** Current time, ISO 8601 UTC. */
  now: string;
  /** Use this id instead of making a new one. */
  id?: string;
}

/**
 * Turn a validated input into a stored question: assigns the question id,
 * option and pair ids, author, timestamps and review status "unverified".
 * Throws if the input was not validated first.
 */
export function toStoredQuestion(input: QuestionInput, ctx: StoreContext): Question {
  return Question.parse({
    ...giveIds(input),
    id: ctx.id ?? newId("question", Date.parse(ctx.now)),
    author: ctx.author,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    review: "unverified",
  });
}
