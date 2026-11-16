import { z } from "zod";
import { Actor, Timestamp } from "./common.js";
import { NodeId, ReferenceId } from "./ids.js";

/**
 * References (features O1 to O6): outside pages she relies on (a guideline, a calculator, a
 * chart), saved as a title and a web address with an optional note, and tied to the places in her
 * library where she studies them. The app stores the address and her own words only; it never
 * fetches, copies or frames the page itself (docs/references.md says why).
 */

export const REFERENCE_LIMITS = {
  titleChars: 200,
  urlChars: 2000,
  noteChars: 2000,
  /** Library places one reference can be tied to. */
  nodes: 20,
  /** Saved references per person. Generous for a reading list, small enough to list in one page. */
  perUser: 500,
} as const;

/** What sort of page it is. Optional: she can leave it out. */
export const ReferenceKind = z.enum(["guideline", "calculator", "chart", "article", "other"]);
export type ReferenceKind = z.infer<typeof ReferenceKind>;
export const REFERENCE_KINDS: readonly ReferenceKind[] = ReferenceKind.options;

export const REFERENCE_KIND_LABEL: Record<ReferenceKind, string> = {
  guideline: "Guideline",
  calculator: "Calculator",
  chart: "Chart",
  article: "Article",
  other: "Other",
};

/** Built-in sites the app knows by name. A saved address on one of them is tagged with it. */
export const ReferenceSource = z.enum(["pharmguides"]);
export type ReferenceSource = z.infer<typeof ReferenceSource>;

const SOURCE_HOSTS: Record<ReferenceSource, string> = { pharmguides: "pharmguides.com" };

interface ParsedUrl {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  href: string;
}
/** `URL` exists in browsers and in Node; typed here so the package needs no DOM typings. */
const UrlCtor = (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL;

function parseUrl(value: string): ParsedUrl | null {
  try {
    return new UrlCtor(value);
  } catch {
    return null;
  }
}

/**
 * Why an address is refused, or null when it is fine. Only http and https: a `javascript:` or
 * `data:` address would run or render something when she taps it, and a `file:` one points at a
 * disk the app cannot see. A user name or password in the address would be stored in plain text.
 */
export function webAddressProblem(value: string): string | null {
  const parsed = parseUrl(value);
  if (!parsed) return "Enter a full web address, starting with https://";
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Only web addresses (http or https) can be saved.";
  }
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
    return "That address has no site name, like www.example.org.";
  }
  if (parsed.username || parsed.password) {
    return "Leave out any user name or password from the address.";
  }
  return null;
}

/** A web address she can open: http or https, at most 2000 characters, stored as the browser writes it. */
export const WebAddress = z
  .string()
  .trim()
  .min(1, "Enter a web address")
  .max(REFERENCE_LIMITS.urlChars)
  .superRefine((value, ctx) => {
    const problem = webAddressProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  })
  .transform((value) => parseUrl(value)?.href ?? value);

/** Most outside references on one block. */
export const MAX_REFERENCES_PER_BLOCK = 5;

/**
 * An outside reference a block draws on (a guideline page, DoseDex): shown as its own chip,
 * apart from the numbered chips of her slides, so material from a reference never reads as if it
 * came from her notes. `referenceId` names her saved reference when there is one.
 */
export const ReferenceAttribution = z
  .strictObject({
    title: z.string().trim().min(1).max(REFERENCE_LIMITS.titleChars),
    url: WebAddress,
    referenceId: ReferenceId.optional(),
  })
  .meta({ id: "ReferenceAttribution" });
export type ReferenceAttribution = z.infer<typeof ReferenceAttribution>;

/** The built-in site an address belongs to (by its host), or null. */
export function referenceSourceOf(url: string): ReferenceSource | null {
  const host = parseUrl(url)?.hostname.toLowerCase();
  if (!host) return null;
  for (const [source, domain] of Object.entries(SOURCE_HOSTS) as Array<[ReferenceSource, string]>) {
    if (host === domain || host.endsWith(`.${domain}`)) return source;
  }
  return null;
}

const Title = z.string().trim().min(1, "Give it a title").max(REFERENCE_LIMITS.titleChars);
const Note = z.string().trim().max(REFERENCE_LIMITS.noteChars);
const NodeIds = z
  .array(NodeId)
  .max(REFERENCE_LIMITS.nodes, `At most ${REFERENCE_LIMITS.nodes} places per reference.`);

export const CreateReferenceInput = z.strictObject({
  title: Title,
  url: WebAddress,
  note: Note.default(""),
  kind: ReferenceKind.nullable().default(null),
  /** Courses, folders, lectures or documents of hers it belongs with. */
  nodeIds: NodeIds.default([]),
  /** Pinned to the top of her list. */
  favourite: z.boolean().default(false),
});
export type CreateReferenceInput = z.input<typeof CreateReferenceInput>;

export const UpdateReferenceInput = z
  .strictObject({
    title: Title.optional(),
    url: WebAddress.optional(),
    note: Note.optional(),
    kind: ReferenceKind.nullable().optional(),
    nodeIds: NodeIds.optional(),
    favourite: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    error: "Send at least one of title, url, note, kind, nodeIds, favourite.",
  });
export type UpdateReferenceInput = z.input<typeof UpdateReferenceInput>;

/** One library place a reference is tied to, resolved for display. */
export const ReferencePlace = z.object({
  nodeId: NodeId,
  name: z.string(),
  kind: z.string(),
  /** "Fall 2026 / Pharmacotherapy I / Lectures / Hypertension" */
  path: z.string(),
  /** The course it sits in, for the course filter; null above or outside a course. */
  courseId: NodeId.nullable(),
  courseName: z.string().nullable(),
  /** The place is in the trash: the tie is kept, and comes back with it. */
  trashed: z.boolean(),
});
export type ReferencePlace = z.infer<typeof ReferencePlace>;

export const SavedReference = z.object({
  id: ReferenceId,
  title: z.string(),
  url: z.string(),
  note: z.string(),
  kind: ReferenceKind.nullable(),
  /** The built-in site the address is on, from its host ("pharmguides"), or null. */
  source: ReferenceSource.nullable(),
  favourite: z.boolean(),
  /** Every tied place, in the order set, trashed ones included (marked). */
  places: z.array(ReferencePlace),
  createdBy: Actor,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type SavedReference = z.infer<typeof SavedReference>;

/**
 * Query of `GET /api/references`. `nodeId` lists those tied to that place, and with `within`
 * (the default) also to anything inside it, so a course shows the references of its lectures.
 * `courseId` keeps those tied to anything in that course. `q` matches title, note and address.
 */
export const ReferenceListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  kind: ReferenceKind.optional(),
  nodeId: NodeId.optional(),
  within: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(true),
  courseId: NodeId.optional(),
  favourite: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(REFERENCE_LIMITS.perUser).default(100),
});
export type ReferenceListQuery = z.output<typeof ReferenceListQuery>;
