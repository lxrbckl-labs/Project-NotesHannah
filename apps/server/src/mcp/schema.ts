import { z } from "zod";

/** A JSON Schema object as published in tools/list. */
export type JsonSchema = Record<string, unknown> & {
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
};

/** JSON Schema of a shared zod schema, input side, without the `$schema` line. */
export function jsonOf(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  delete json.$schema;
  const defs = (json.$defs ?? {}) as Record<string, JsonSchema>;
  delete json.$defs;
  return stripPatterns(inlineRefs(json, defs)) as JsonSchema;
}

/** Drop the long generated regex where a `format` already says it (dates, times). */
function stripPatterns(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPatterns);
  if (value === null || typeof value !== "object") return value;
  const obj = { ...(value as Record<string, unknown>) };
  if (typeof obj.format === "string") delete obj.pattern;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, stripPatterns(v)]));
}

/**
 * Replace `$ref: "#/$defs/X"` with a copy of X. Shared schemas such as
 * Citation carry an id and would otherwise land in `$defs`; inlined, each
 * field can carry its own description and clients need no ref resolution.
 */
function inlineRefs(value: unknown, defs: Record<string, JsonSchema>): unknown {
  if (Array.isArray(value)) return value.map((v) => inlineRefs(v, defs));
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj.$ref === "string" && obj.$ref.startsWith("#/$defs/")) {
    const target = defs[obj.$ref.slice("#/$defs/".length)];
    const { $ref: _ref, ...rest } = obj;
    return inlineRefs({ ...structuredClone(target), ...rest }, defs);
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, inlineRefs(v, defs)]));
}

/**
 * Merge the branches of an action-discriminated input into one flat object
 * schema. Clients reject `oneOf` at the top level of a tool's input (the
 * Anthropic API does), so the published schema is flat: the discriminator is
 * required, everything else optional, and each field's description says which
 * actions use it. The exact per-action shape is still enforced on the server.
 */
export function flattenActions(
  discriminator: string,
  branches: Record<string, JsonSchema>,
  discriminatorDescription: string,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    [discriminator]: {
      type: "string",
      enum: Object.keys(branches),
      description: discriminatorDescription,
    },
  };
  const usedBy = new Map<string, string[]>();
  for (const [name, branch] of Object.entries(branches)) {
    for (const [key, prop] of Object.entries(branch.properties ?? {})) {
      if (key === discriminator) continue;
      if (!properties[key]) properties[key] = structuredClone(prop);
      const required = branch.required?.includes(key) ?? false;
      usedBy.set(key, [...(usedBy.get(key) ?? []), required ? `${name} (required)` : name]);
    }
  }
  for (const [key, users] of usedBy) {
    const prop = properties[key] as JsonSchema;
    prop.description = `${prop.description ?? ""} [Used by: ${users.join(", ")}.]`.trim();
  }
  return {
    type: "object",
    properties,
    required: [discriminator],
    additionalProperties: false,
  };
}

/**
 * Set descriptions by dotted path ("lecture.number"; array items with "[]",
 * e.g. "files[].name"). An existing description from the shared schema is
 * kept and the given text appended only when it adds something.
 */
export function describe(schema: JsonSchema, descriptions: Record<string, string>): JsonSchema {
  for (const [path, text] of Object.entries(descriptions)) {
    const nodes = nodesAt([schema], path);
    if (nodes.length === 0) throw new Error(`describe: no property at ${path}`);
    // Every branch of a union that has the field gets the description.
    for (const node of nodes) {
      node.description = node.description ? `${text} ${node.description}` : text;
    }
  }
  return schema;
}

function objectBranches(node: JsonSchema): JsonSchema[] {
  const out: JsonSchema[] = [];
  if (node.properties) out.push(node);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const list = node[key];
    if (Array.isArray(list)) for (const b of list as JsonSchema[]) out.push(...objectBranches(b));
  }
  return out;
}

function nodesAt(roots: JsonSchema[], path: string): JsonSchema[] {
  let current = roots;
  for (const raw of path.split(".")) {
    const isArray = raw.endsWith("[]");
    const key = isArray ? raw.slice(0, -2) : raw;
    const next: JsonSchema[] = [];
    for (const node of current) {
      for (const branch of objectBranches(node)) {
        const prop = branch.properties?.[key];
        if (!prop) continue;
        if (!isArray) {
          next.push(prop);
          continue;
        }
        const items =
          prop.items ??
          ((prop.anyOf as JsonSchema[] | undefined)?.find((b) => b.items)?.items as
            | JsonSchema
            | undefined);
        if (items) next.push(items);
      }
    }
    current = [...new Set(next)];
  }
  return current;
}

/** Property paths without a description (for tests: every field must explain itself). */
export function undescribed(schema: JsonSchema, prefix = ""): string[] {
  const missing: string[] = [];
  for (const branch of objectBranches(schema)) {
    for (const [key, prop] of Object.entries(branch.properties ?? {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!prop.description) missing.push(path);
      missing.push(...undescribed(prop, path));
      const items = prop.items as JsonSchema | undefined;
      if (items) missing.push(...undescribed(items, `${path}[]`));
    }
  }
  return [...new Set(missing)];
}
