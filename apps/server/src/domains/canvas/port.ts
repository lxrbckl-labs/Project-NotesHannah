import type { AuthContext } from "../../http/auth-context.js";
import type { AgentCanvasView } from "./render.js";
import type { CanvasService, ChangeOutcome } from "./service.js";

/** What an MCP tool gets back from a canvas write: the report, or the teach-by-error problems. */
export type CanvasPortResult =
  | {
      ok: true;
      documentId: string;
      revision: number;
      /** False when the body changed nothing (sending it twice makes no new revision). */
      changed: boolean;
      /** added, updated, removed, skipped (with the pin rule's reason) and refs (ref to new ID). */
      report: Extract<ChangeOutcome, { ok: true }>["report"];
    }
  | {
      ok: false;
      /** invalid (fix the input), conflict (read again), protected (the pin rule), forbidden (hers alone). */
      kind: Extract<ChangeOutcome, { ok: false }>["kind"];
      /** Each with a `$` path, a plain message and a valid example. */
      problems: Extract<ChangeOutcome, { ok: false }>["problems"];
    };

/**
 * The narrow view of the canvas the MCP layer calls (docs/canvas.md: `canvas_get`,
 * `canvas_set_structure`, `canvas_change`). Every method takes the caller's `AuthContext`; another
 * user's document is `not_found`, a read-only key is `read_only_key` on the two writes. Validation
 * problems are returned, not thrown, so a tool can show the agent the path, message and example.
 */
export interface CanvasPort {
  /** Frames with their cards as short previews, connectors as "A -[label]-> B", never coordinates. */
  get(
    auth: AuthContext,
    documentId: string,
    options?: { include?: "structure" | "full" },
  ): AgentCanvasView & { structure?: unknown };
  /** The whole structure, without coordinates (`SetCanvasStructureInput`, `documentId` inside). */
  setStructure(auth: AuthContext, input: unknown): CanvasPortResult;
  /** Incremental ops (`CanvasChangeInput`, `documentId` inside). Place, release and insert are hers. */
  change(auth: AuthContext, input: unknown): CanvasPortResult;
}

const BAD_DOCUMENT = {
  ok: false,
  kind: "invalid",
  problems: [
    {
      path: "$.documentId",
      message:
        'Name the document: "documentId" is the doc_… ID of the document whose canvas this is.',
      example: { documentId: "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" },
    },
  ],
} as const satisfies CanvasPortResult;

function documentIdOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const id = (input as { documentId?: unknown }).documentId;
  return typeof id === "string" ? id : undefined;
}

function toResult(outcome: ChangeOutcome): CanvasPortResult {
  if (!outcome.ok) return { ok: false, kind: outcome.kind, problems: outcome.problems };
  return {
    ok: true,
    documentId: outcome.canvas.documentId,
    revision: outcome.canvas.revision,
    changed: outcome.changed,
    report: outcome.report,
  };
}

export function createCanvasPort(canvas: CanvasService): CanvasPort {
  return {
    get: (auth, documentId, options) => canvas.view(auth, documentId, options?.include),
    setStructure(auth, input) {
      const id = documentIdOf(input);
      return id ? toResult(canvas.setStructure(auth, id, input)) : { ...BAD_DOCUMENT };
    },
    change(auth, input) {
      const id = documentIdOf(input);
      return id ? toResult(canvas.change(auth, id, input)) : { ...BAD_DOCUMENT };
    },
  };
}
