import {
  canTransition,
  REQUEST_KIND_INFO,
  type RequestKind,
  type RequestLink,
  type RequestStatus,
  type RequestTarget,
} from "@notes/schema";
import type { StudyRequestWithContext } from "../types";

/** Status in plain words, as she reads it. */
export const STATUS_LABEL: Record<RequestStatus, string> = {
  waiting: "Waiting for an agent",
  in_progress: "An agent is working on it",
  done: "Done",
  declined: "Needs a change",
  cancelled: "Cancelled",
};

/** One gentle line under the status, for the detail of a card. */
export const STATUS_HELP: Record<RequestStatus, string> = {
  waiting: "Agents pick this up the next time one runs.",
  in_progress: "It is being looked at right now. This page refreshes by itself.",
  done: "An agent answered. Not what you wanted? You can reopen it.",
  declined: "An agent could not do this as asked. Read why, then reopen it with more detail.",
  cancelled: "You withdrew this request.",
};

/** Short names for the filter chips. */
export const FILTER_LABEL: Record<RequestStatus, string> = {
  waiting: "Waiting",
  in_progress: "In progress",
  done: "Done",
  declined: "Needs a change",
  cancelled: "Cancelled",
};

export const STATUS_ORDER: readonly RequestStatus[] = [
  "waiting",
  "in_progress",
  "done",
  "declined",
  "cancelled",
];

export type Filter = "all" | RequestStatus;

export function filterStatuses(filter: Filter): RequestStatus[] | undefined {
  return filter === "all" ? undefined : [filter];
}

export type StatusTone = "neutral" | "accent" | "success" | "danger";

export function statusTone(status: RequestStatus): StatusTone {
  switch (status) {
    case "waiting":
      return "neutral";
    case "in_progress":
      return "accent";
    case "done":
      return "success";
    case "declined":
      return "danger";
    case "cancelled":
      return "neutral";
  }
}

/** What she may do to a request in this status (her side of the state machine). */
export function actionsFor(status: RequestStatus): {
  edit: boolean;
  cancel: boolean;
  reopen: boolean;
} {
  return {
    edit: canTransition(status, "edit", "user").ok,
    cancel: canTransition(status, "cancel", "user").ok,
    reopen: canTransition(status, "reopen", "user").ok,
  };
}

// ---- quick actions ----------------------------------------------------------------------------

export const KIND_ORDER: readonly RequestKind[] = [
  "wrong",
  "unclear",
  "expand",
  "more_like_this",
  "make_questions",
  "summarise",
  "quiz_me",
];

export function kindLabel(kind: RequestKind): string {
  return REQUEST_KIND_INFO[kind].label;
}

/** The quick actions that make sense for each kind of target, in display order. */
export const KINDS_FOR_TARGET: Record<RequestTarget["type"], readonly RequestKind[]> = {
  library: ["summarise", "make_questions", "quiz_me", "expand"],
  node: ["summarise", "make_questions", "quiz_me", "expand", "unclear", "more_like_this"],
  document: [
    "wrong",
    "unclear",
    "expand",
    "more_like_this",
    "make_questions",
    "summarise",
    "quiz_me",
  ],
  block: ["wrong", "unclear", "expand", "more_like_this", "make_questions", "summarise"],
  source: ["wrong", "unclear", "summarise", "make_questions", "expand"],
  question: ["wrong", "unclear", "expand", "more_like_this", "quiz_me"],
};

/** Examples that teach what is possible: tapping one fills the box. */
export const EXAMPLES_FOR_TARGET: Record<RequestTarget["type"], readonly string[]> = {
  library: [
    "Make a one-page summary of everything I added this week.",
    "Which lectures have no practice questions yet? Write some.",
    "Build a study plan for my cardiology exam on the 14th.",
  ],
  node: [
    "Summarise this lecture in a page I can read before class.",
    "Write 15 practice questions from this lecture, mostly on mechanisms.",
    "Make a comparison table of the drugs in this lecture.",
  ],
  document: [
    "Add a short table comparing atenolol, metoprolol and carvedilol.",
    "Explain the renin-angiotensin system more simply, with an example.",
    "Check this whole page against the slides and flag anything off.",
  ],
  block: [
    "Atenolol is hydrophilic, not lipophilic. Check slide 12.",
    "I do not follow this step. Explain it with a worked example.",
    "Add a mnemonic for these side effects.",
  ],
  source: [
    "The transcript of this page has the wrong dose in the table.",
    "Pull the key points from this page into my notes.",
    "Make flashcards from this page.",
  ],
  question: [
    "The answer key looks wrong to me: explain why option C is correct.",
    "Explain this with a different example.",
    "Write three more questions like this one.",
  ],
};

export const TARGET_NOUN: Record<RequestTarget["type"], string> = {
  library: "your library",
  node: "this item",
  document: "this document",
  block: "this block",
  source: "this source page",
  question: "this question",
};

/** "Agents pick these up the next time one runs." Said once, kindly, wherever she leaves a request. */
export const HONEST_NOTE =
  "Agents pick these up the next time one runs. Nothing happens until then, so a request can wait a while.";

// ---- what a request is about ------------------------------------------------------------------

export function targetTypeLabel(type: RequestTarget["type"]): string {
  switch (type) {
    case "library":
      return "Library";
    case "node":
      return "Item";
    case "document":
      return "Document";
    case "block":
      return "Block";
    case "source":
      return "Source page";
    case "question":
      return "Question";
  }
}

/** The name to show for the target: the server's, or a plain fallback. */
export function targetName(request: Pick<StudyRequestWithContext, "target" | "context">): string {
  const { target, context } = request;
  if (target.type === "library") return "Your whole library";
  if (context.name) return context.name;
  if (context.preview) return context.preview;
  return `A ${targetTypeLabel(target.type).toLowerCase()} that is no longer listed`;
}

/** What she asked, in one line: her words, else the quick action. */
export function headline(request: Pick<StudyRequestWithContext, "kind" | "message">): string {
  const message = request.message.trim();
  if (request.kind === "other") return message || "Something else";
  return message || kindLabel(request.kind);
}

// ---- links in an agent's reply -------------------------------------------------------------------

export function linkLabel(link: RequestLink): string {
  if (link.label) return link.label;
  switch (link.type) {
    case "node":
      return "Library item";
    case "document":
      return "Document";
    case "block":
      return "Block in a document";
    case "question":
      return "Practice question";
    case "concept":
      return "Concept";
    case "source":
      return "Source page";
  }
}

export type OpenAction =
  | { kind: "node"; nodeId: string }
  | { kind: "document"; documentId: string; nodeId: string | null; blockId?: string }
  | { kind: "question"; questionId: string; nodeId: string | null }
  | { kind: "concept"; conceptId: string }
  | { kind: "source"; fileId: string; pageId?: string };

/** Where a reply link leads. `nodeId` is the library item for documents when known (see openTarget). */
export function openLink(link: RequestLink): OpenAction {
  switch (link.type) {
    case "node":
      return { kind: "node", nodeId: link.nodeId };
    case "document":
      return { kind: "document", documentId: link.documentId, nodeId: null };
    case "block":
      return {
        kind: "document",
        documentId: link.documentId,
        nodeId: null,
        blockId: link.blockId,
      };
    case "question":
      return { kind: "question", questionId: link.questionId, nodeId: null };
    case "concept":
      return { kind: "concept", conceptId: link.conceptId };
    case "source":
      return link.pageId
        ? { kind: "source", fileId: link.fileId, pageId: link.pageId }
        : { kind: "source", fileId: link.fileId };
  }
}

/** Where tapping a request's target leads; null for the whole library (nothing to open). */
export function openTarget(
  request: Pick<StudyRequestWithContext, "target" | "context">,
): OpenAction | null {
  const { target, context } = request;
  switch (target.type) {
    case "library":
      return null;
    case "node":
      return { kind: "node", nodeId: target.nodeId };
    case "document":
      return { kind: "document", documentId: target.documentId, nodeId: context.nodeId };
    case "block":
      return {
        kind: "document",
        documentId: target.documentId,
        nodeId: context.nodeId,
        blockId: target.blockId,
      };
    case "source":
      return target.pageId
        ? { kind: "source", fileId: target.fileId, pageId: target.pageId }
        : { kind: "source", fileId: target.fileId };
    case "question":
      return { kind: "question", questionId: target.questionId, nodeId: context.nodeId };
  }
}

// ---- badge and unread ----------------------------------------------------------------------------

/**
 * The number on the badge: requests still waiting plus answers she has not looked at yet.
 * "Looked at" is kept on her device (the server has no read flag).
 */
export function badgeCount(
  waiting: number,
  done: ReadonlyArray<Pick<StudyRequestWithContext, "id">>,
  seen: ReadonlySet<string>,
): number {
  return waiting + done.filter((request) => !seen.has(request.id)).length;
}

export function isUnread(
  request: Pick<StudyRequestWithContext, "id" | "status">,
  seen: ReadonlySet<string>,
): boolean {
  return (request.status === "done" || request.status === "declined") && !seen.has(request.id);
}

const SEEN_KEY = "notes-requests-seen";
const SEEN_LIMIT = 400;

let firstLoadSeen = false;

/**
 * A shell turns this on so a device that has never looked (no record at all) treats the answers
 * already there as seen: otherwise a new phone or a cleared browser shows every old answer as new.
 */
export function setFirstLoadCountsAsSeen(on: boolean): void {
  firstLoadSeen = on;
}

/** On the very first look on this device, mark what is already answered as seen. Returns true if it did. */
export function baselineSeen(ids: Iterable<string>): boolean {
  if (!firstLoadSeen) return false;
  try {
    if (localStorage.getItem(SEEN_KEY) !== null) return false;
  } catch {
    return false;
  }
  writeSeen(ids);
  return true;
}

export function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeSeen(ids: Iterable<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-SEEN_LIMIT)));
  } catch {
    // storage unavailable: the badge just counts every answer
  }
}

/** Marks answers as looked at; returns the new set. */
export function markSeen(ids: Iterable<string>): Set<string> {
  const seen = readSeen();
  for (const id of ids) seen.add(id);
  writeSeen(seen);
  return seen;
}

// ---- polling ---------------------------------------------------------------------------------------

/** How often to look again: quickly while an agent is working, slowly while only waiting, never otherwise. */
export function pollDelay(statuses: readonly RequestStatus[]): number | null {
  if (statuses.includes("in_progress")) return 4000;
  if (statuses.includes("waiting")) return 30000;
  return null;
}
