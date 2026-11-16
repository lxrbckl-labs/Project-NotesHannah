import type { Context } from "hono";
import type { z } from "zod";
import { AppError } from "./errors.js";

/** Parse a JSON body against a schema, or throw `invalid_input` with the problems as a hint. */
export async function parseJson<T extends z.ZodType>(
  c: Context,
  schema: T,
  example?: unknown,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError("invalid_input", "The request body must be JSON.", { example });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const hint = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`)
      .join("; ");
    throw new AppError("invalid_input", "The request body is not valid.", { hint, example });
  }
  return parsed.data;
}
