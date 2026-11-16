import type { z } from "zod";
import type { Actor } from "../common.js";
import type { Origin } from "./common.js";
import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  type BlockInput,
  type BlockPath,
  envelopeIssues,
  isBlockType,
  SERVER_FIELDS,
} from "./registry.js";
import { citationRuleIssue } from "./rules.js";

/**
 * Validation that teaches. Every problem says where it is (a JSON path such
 * as `$.content.items[2].text`), what is wrong in plain language, and gives
 * a minimal valid block of the same type to copy from.
 */
export interface Problem {
  /** JSON path to the offending value, from `$` (the block, or the request body). */
  path: string;
  message: string;
  /**
   * A minimal valid example to copy: a block of the intended type (a paragraph
   * when the type is unknown), or an operation body for problems outside blocks.
   */
  example: unknown;
}

export type BlockValidation = { ok: true; block: BlockInput } | { ok: false; problems: Problem[] };

export interface ValidateOptions {
  /** Who is writing. Agents are held to the citation rule; she is not. Default "agent". */
  writer?: Origin | Actor;
  /** Path prefix for problems, e.g. "$.blocks[3]" when the block sits inside a request. */
  pathPrefix?: string;
}

/** `["content", "items", 2]` → `$.content.items[2]`. */
export function formatPath(path: ReadonlyArray<PropertyKey>, prefix = "$"): string {
  let out = prefix;
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else if (typeof segment === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))
      out += `.${segment}`;
    else out += `[${JSON.stringify(String(segment))}]`;
  }
  return out;
}

interface FlatIssue {
  path: PropertyKey[];
  message: string;
}

type Issue = z.core.$ZodIssue;

function receivedUndefined(issue: Issue): boolean {
  return issue.code === "invalid_type" && /received undefined/.test(issue.message);
}

function depth(branch: Issue[]): number {
  return Math.max(...branch.map((issue) => issue.path.length));
}

/**
 * Flatten a zod issue into plain problems. For a union that failed, follow
 * the alternative that got furthest, so the agent hears "bold must be true
 * or false" rather than "no alternative matched".
 */
function flatten(issue: Issue, base: PropertyKey[]): FlatIssue[] {
  const path = [...base, ...issue.path];
  if (issue.code === "invalid_union" && issue.errors.length > 0) {
    const branches = issue.errors.filter((branch) => branch.length > 0);
    if (branches.every((branch) => branch.every((inner) => receivedUndefined(inner)))) {
      const name = path[path.length - 1];
      return [{ path, message: `Missing required field "${String(name)}". ${issue.message}` }];
    }
    const informative = branches.filter(
      (branch) => !(branch.length === 1 && branch[0]?.path.length === 0),
    );
    if (informative.length === 0) return [{ path, message: issue.message }];
    const best = informative.reduce((a, b) => {
      const da = depth(a);
      const db = depth(b);
      if (da !== db) return da > db ? a : b;
      return b.length < a.length ? b : a;
    });
    return best.flatMap((inner) => flatten(inner, path));
  }
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      path: [...path, key],
      message: `Unknown field "${key}" here. Check the spelling against the example; fields not in the schema are not stored.`,
    }));
  }
  if (receivedUndefined(issue)) {
    const name = path[path.length - 1];
    return [{ path, message: `Missing required field "${String(name)}".` }];
  }
  return [{ path, message: issue.message }];
}

const SERVER_FIELD_MESSAGES: Record<(typeof SERVER_FIELDS)[number], string> = {
  id: 'The block ID is assigned by the server; leave out "id". To change an existing block, use the update operation with its blockId.',
  origin: 'The server records who wrote a block; leave out "origin".',
  review:
    'Review status is set when she reviews a block; leave out "review". Use "flags" to point out what she should check.',
  provenance:
    'The server records who created and edited a block, and when; leave out "provenance".',
};

function originOf(writer: Origin | Actor | undefined): Origin {
  if (writer === undefined) return "agent";
  if (typeof writer === "string") return writer;
  return writer.type === "user" ? "user" : "agent";
}

function closestType(value: string): string | null {
  const simplified = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (isBlockType(simplified)) return simplified;
  const prefix = BLOCK_TYPES.find((type) => type.startsWith(simplified.slice(0, 4)));
  return prefix ?? null;
}

/**
 * Validate one block from a writer. Returns the normalised block (rich-text
 * strings turned into runs, defaults filled) or every problem found.
 */
export function validateBlockInput(input: unknown, options: ValidateOptions = {}): BlockValidation {
  const prefix = options.pathPrefix ?? "$";
  const fallback = BLOCK_REGISTRY.paragraph.example;

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      problems: [
        {
          path: prefix,
          message: `A block is an object with "type" and "content". Valid types: ${BLOCK_TYPES.join(", ")}.`,
          example: fallback,
        },
      ],
    };
  }

  const record = input as Record<string, unknown>;
  const type = record.type;
  if (!isBlockType(type)) {
    const guess = typeof type === "string" ? closestType(type) : null;
    const said =
      type === undefined ? 'No "type" given.' : `Unknown block type ${JSON.stringify(type)}.`;
    return {
      ok: false,
      problems: [
        {
          path: formatPath(["type"], prefix),
          message: `${said} Valid types: ${BLOCK_TYPES.join(", ")}.${guess ? ` Did you mean "${guess}"?` : ""}`,
          example: guess && isBlockType(guess) ? BLOCK_REGISTRY[guess].example : fallback,
        },
      ],
    };
  }

  const entry = BLOCK_REGISTRY[type];
  const problems: Problem[] = [];
  const rest: Record<string, unknown> = { ...record };
  for (const field of SERVER_FIELDS) {
    if (field in rest) {
      problems.push({
        path: formatPath([field], prefix),
        message: SERVER_FIELD_MESSAGES[field],
        example: entry.example,
      });
      delete rest[field];
    }
  }

  const parsed = entry.inputSchema.safeParse(rest);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      for (const flat of flatten(issue, [])) {
        problems.push({
          path: formatPath(flat.path, prefix),
          message: flat.message,
          example: entry.example,
        });
      }
    }
    return { ok: false, problems };
  }

  const block = parsed.data as BlockInput;
  const issues = [...envelopeIssues(block)];
  const rule = citationRuleIssue(block, originOf(options.writer));
  if (rule) issues.push(rule);
  for (const issue of issues) {
    problems.push({
      path: formatPath(issue.path, prefix),
      message: issue.message,
      example: entry.example,
    });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, block };
}

/** Validate a list of blocks, e.g. the `blocks` of an insert request. Paths read `$.blocks[2].content…`. */
export function validateBlockInputs(
  inputs: unknown,
  options: ValidateOptions & { field?: BlockPath } = {},
): { ok: true; blocks: BlockInput[] } | { ok: false; problems: Problem[] } {
  const listPath = formatPath(options.field ?? ["blocks"], options.pathPrefix ?? "$");
  if (!Array.isArray(inputs)) {
    return {
      ok: false,
      problems: [
        {
          path: listPath,
          message: "Expected a list of blocks.",
          example: BLOCK_REGISTRY.paragraph.example,
        },
      ],
    };
  }
  const blocks: BlockInput[] = [];
  const problems: Problem[] = [];
  inputs.forEach((input, index) => {
    const result = validateBlockInput(input, {
      ...options,
      pathPrefix: `${listPath}[${index}]`,
    });
    if (result.ok) blocks.push(result.block);
    else problems.push(...result.problems);
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, blocks };
}
