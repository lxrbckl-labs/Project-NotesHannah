import type { Actor, ApiKeyScope } from "@notes/schema";
import type { z } from "zod";
import type { Db } from "../db/client.js";
import type { LibraryService } from "../domains/library/index.js";
import type { AuthContext } from "../http/auth-context.js";
import { AppError } from "../http/errors.js";
import { invalidInput } from "./errors.js";
import type { McpBackend } from "./ports.js";
import type { JsonSchema } from "./schema.js";

/** Everything a tool handler may use. Built per request from the key. */
export interface ToolContext {
  /** The caller, passed to the domain services as is (they check scope and log as this actor). */
  auth: AuthContext;
  userId: string;
  keyId: string;
  scope: ApiKeyScope;
  actor: Actor;
  db: Db;
  library: LibraryService;
  backend: McpBackend;
  /** Names of the tools registered for this server, so text can point only at real tools. */
  available: ReadonlySet<string>;
  now: () => number;
}

export interface ToolOutput {
  /** Compact, human-readable; carries every ID the agent needs. */
  text: string;
  /** The same facts as JSON. */
  structured: Record<string, unknown>;
  images?: Array<{ data: string; mimeType: string }>;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDef<I = unknown> {
  name: string;
  title: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: JsonSchema;
  parse(raw: unknown): I;
  /** True when this input changes something (needs a write key; audited). */
  writes(input: I): boolean;
  /** The action or operation name, for audit rows and error context. */
  action(input: I): string | null;
  run(ctx: ToolContext, input: I): Promise<ToolOutput> | ToolOutput;
}

export function defineTool<I>(def: ToolDef<I>): ToolDef<unknown> {
  return def as ToolDef<unknown>;
}

/** Parse with a zod schema, turning failure into a teaching `invalid_input`. */
export function parseWith<T extends z.ZodType>(
  tool: string,
  schema: T,
  raw: unknown,
  example: unknown,
  context?: string,
): z.output<T> {
  const result = schema.safeParse(raw ?? {});
  if (result.success) return result.data;
  throw invalidInput(tool, result.error, raw, example, context);
}

/**
 * Parse an action-discriminated input: first the action itself (listing the
 * valid ones), then the branch for that action, so errors name the action and
 * show that action's example.
 */
export function parseAction<B extends Record<string, z.ZodType>>(
  tool: string,
  discriminator: string,
  branches: B,
  examples: { [K in keyof B]: unknown },
  raw: unknown,
): { [K in keyof B]: { action: K; value: z.output<B[K]> } }[keyof B] {
  const body = (raw ?? {}) as Record<string, unknown>;
  const name = body[discriminator];
  const names = Object.keys(branches);
  if (typeof name !== "string" || !Object.hasOwn(branches, name)) {
    throw new AppError(
      "invalid_input",
      name === undefined
        ? `Invalid input for ${tool}: "${discriminator}" is missing. It must be one of: ${names.join(", ")}.`
        : `Invalid input for ${tool}: "${discriminator}" is ${JSON.stringify(name)}, which is not one of: ${names.join(", ")}.`,
      {
        hint: `Pick the ${discriminator} that matches what you want to do; the example shows "${names[0]}".`,
        example: examples[names[0] as keyof B],
      },
    );
  }
  const { [discriminator]: _drop, ...rest } = body;
  const schema = branches[name] as z.ZodType;
  const value = parseWith(
    tool,
    schema,
    rest,
    examples[name as keyof B],
    `${discriminator} "${name}"`,
  );
  return { action: name, value } as never;
}
