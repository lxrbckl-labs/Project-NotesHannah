import type { Actor } from "@notes/schema";
import type { ActivityLink, ActivityPort } from "./activity.js";
import type { ChangeInput } from "./changes.js";

/** Where a domain writes the change feed entry. The feed's `record` fits. */
export interface ChangeRecorder {
  record(userId: string, input: ChangeInput): unknown;
}

/** The two places every change leaves a trace: the change feed (everyone), the activity log (agents only). */
export interface Trace {
  changes?: ChangeRecorder | undefined;
  activity?: ActivityPort | undefined;
}

export interface TraceEntry {
  /** The change feed's action, e.g. "question.created"; the activity log gets the same code. */
  action: string;
  objectType: string;
  objectIds: readonly string[];
  /** In plain words, e.g. "Wrote 4 questions for lecture Beta blockers". */
  summary: string;
  nodeId?: string | null | undefined;
  documentId?: string | null | undefined;
  requestId?: string | null | undefined;
  links?: readonly ActivityLink[] | undefined;
  /** Leave it out of the activity log (the entry would only repeat another one). */
  quiet?: boolean | undefined;
}

/**
 * Record one change. The feed always gets it; the activity log gets it when an agent
 * made it (the log itself ignores entries for the signed-in user).
 */
export function leaveTrace(trace: Trace, userId: string, actor: Actor, entry: TraceEntry): void {
  trace.changes?.record(userId, {
    action: entry.action,
    objectType: entry.objectType,
    objectIds: entry.objectIds,
    nodeId: entry.nodeId ?? null,
    documentId: entry.documentId ?? null,
    requestId: entry.requestId ?? null,
    actor,
    summary: entry.summary,
  });
  if (entry.quiet) return;
  trace.activity?.record(userId, {
    actor,
    action: entry.action,
    summary: entry.summary,
    links:
      entry.links ?? entry.objectIds.slice(0, 15).map((id) => ({ type: entry.objectType, id })),
  });
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
