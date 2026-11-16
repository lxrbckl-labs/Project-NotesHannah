import {
  type CreateRequestInput,
  canTransition,
  type EditRequestInput,
  kindNeedsMessage,
  newId,
  type RequestCounts,
  type RequestLink,
  type RequestStatus,
  type StudyRequest,
  type StudyRequestWithContext,
} from "@notes/schema";
import { ApiClientError } from "../../../lib/api";
import type { RequestListQuery, RequestsStore } from "../types";
import { describeTarget, seedRequests } from "./seed";

export interface MockRequestsOptions {
  /** Start with no requests. */
  empty?: boolean;
  /** Delay every call by this many milliseconds (to see loading states). */
  delayMs?: number;
  /** Make every call fail with this message. */
  failWith?: string;
  /** The clock; defaults to the real time. */
  now?: () => number;
}

export interface MockRequestsStore extends RequestsStore {
  /** The agent's side, so a demo or test can act as the agent: claim, answer or refuse. */
  agent: {
    claim(id: string): StudyRequestWithContext;
    complete(id: string, text: string, links?: RequestLink[]): StudyRequestWithContext;
    decline(id: string, reason: string): StudyRequestWithContext;
  };
  /** Calls made, as `[name, ...args]`. */
  calls: unknown[][];
  /** Every request, as the store holds it. */
  all(): StudyRequestWithContext[];
  setFailure(message: string | undefined): void;
}

const fail = (code: "not_found" | "conflict" | "invalid_input", message: string, hint?: string) =>
  new ApiClientError(code === "not_found" ? 404 : code === "conflict" ? 409 : 400, {
    code,
    message,
    ...(hint ? { hint } : {}),
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An in-memory store that behaves like the server's routes, for the demo and tests. */
export function createMockRequestsStore(options: MockRequestsOptions = {}): MockRequestsStore {
  const clock = options.now ?? (() => Date.now());
  const items = new Map<string, StudyRequestWithContext>();
  for (const request of options.empty ? [] : seedRequests(clock())) items.set(request.id, request);
  const calls: unknown[][] = [];
  let failure = options.failWith;

  const iso = () => new Date(clock()).toISOString();
  const find = (id: string) => {
    const found = items.get(id);
    if (!found) throw fail("not_found", "No such request.");
    return found;
  };
  async function enter(name: string, ...args: unknown[]) {
    calls.push([name, ...args]);
    if (options.delayMs) await sleep(options.delayMs);
    if (failure)
      throw new ApiClientError(500, {
        code: "internal",
        message: failure,
        hint: "Try again in a moment.",
      });
  }
  function move(id: string, action: Parameters<typeof canTransition>[1], actor: "user" | "agent") {
    const request = find(id);
    const check = canTransition(request.status, action, actor);
    if (!check.ok) throw fail("conflict", check.message, check.hint);
    return { request, to: check.to };
  }
  function put(next: StudyRequestWithContext) {
    items.set(next.id, next);
    return structuredClone(next);
  }
  const countsOf = (): RequestCounts => {
    const counts = { waiting: 0, in_progress: 0, done: 0, declined: 0, cancelled: 0 };
    for (const request of items.values()) counts[request.status]++;
    return { ...counts, open: counts.waiting + counts.in_progress };
  };

  return {
    calls,
    all: () => structuredClone([...items.values()]),
    setFailure(message) {
      failure = message;
    },
    async list(query: RequestListQuery = {}) {
      await enter("list", query);
      const statuses: RequestStatus[] = query.status ?? [
        "waiting",
        "in_progress",
        "done",
        "declined",
      ];
      let list = [...items.values()].filter(
        (r) =>
          statuses.includes(r.status) && (!query.targetType || r.target.type === query.targetType),
      );
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (query.order === "oldest") list = list.reverse();
      return { items: structuredClone(list.slice(0, query.limit ?? 100)), nextCursor: null };
    },
    async counts() {
      await enter("counts");
      return countsOf();
    },
    async get(id) {
      await enter("get", id);
      return structuredClone(find(id));
    },
    async create(input: CreateRequestInput) {
      await enter("create", input);
      if (kindNeedsMessage(input.kind) && input.message.trim().length === 0) {
        throw fail(
          "invalid_input",
          'A request of kind "other" needs a message: say what you want.',
        );
      }
      const at = iso();
      const request: StudyRequestWithContext = {
        id: newId("request", clock()),
        userId: "usr_00000000000000000000000001",
        target: input.target,
        kind: input.kind,
        message: input.message.trim(),
        status: "waiting",
        createdBy: { type: "user", userId: "usr_00000000000000000000000001" },
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
        reply: null,
        reopens: [],
        createdAt: at,
        updatedAt: at,
        closedAt: null,
        context: describeTarget(input.target),
      };
      return put(request);
    },
    async update(id, input: EditRequestInput) {
      await enter("update", id, input);
      const { request } = move(id, "edit", "user");
      const next = {
        ...request,
        kind: input.kind ?? request.kind,
        message: input.message === undefined ? request.message : input.message.trim(),
        updatedAt: iso(),
      };
      if (kindNeedsMessage(next.kind) && next.message.length === 0) {
        throw fail(
          "invalid_input",
          'A request of kind "other" needs a message: say what you want.',
        );
      }
      return put(next);
    },
    async cancel(id) {
      await enter("cancel", id);
      const { request, to } = move(id, "cancel", "user");
      const at = iso();
      return put({
        ...request,
        status: to,
        claimedBy: null,
        claimedAt: null,
        claimExpiresAt: null,
        updatedAt: at,
        closedAt: at,
      });
    },
    async reopen(id, note = "") {
      await enter("reopen", id, note);
      const { request, to } = move(id, "reopen", "user");
      const at = iso();
      return put({
        ...request,
        status: to,
        reopens: [
          ...request.reopens,
          {
            at,
            note: note.trim(),
            previousStatus: request.status as "done" | "declined",
            previousReply: request.reply,
          },
        ],
        updatedAt: at,
        closedAt: null,
      });
    },
    agent: {
      claim(id) {
        const { request, to } = move(id, "claim", "agent");
        const now = clock();
        return put({
          ...request,
          status: to,
          claimedBy: {
            type: "agent",
            keyId: "key_00000000000000000000000007",
            label: "Study agent",
          },
          claimedAt: new Date(now).toISOString(),
          claimExpiresAt: new Date(now + 30 * 60_000).toISOString(),
          updatedAt: iso(),
        });
      },
      complete(id, text, links = []) {
        const { request, to } = move(id, "complete", "agent");
        const at = iso();
        return put({
          ...request,
          status: to,
          reply: {
            text,
            links,
            by: { type: "agent", keyId: "key_00000000000000000000000007", label: "Study agent" },
            at,
          },
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
          updatedAt: at,
          closedAt: at,
        });
      },
      decline(id, reason) {
        const { request, to } = move(id, "decline", "agent");
        const at = iso();
        return put({
          ...request,
          status: to,
          reply: {
            text: reason,
            links: [],
            by: { type: "agent", keyId: "key_00000000000000000000000007", label: "Study agent" },
            at,
          },
          claimedBy: null,
          claimedAt: null,
          claimExpiresAt: null,
          updatedAt: at,
          closedAt: at,
        });
      },
    },
  };
}

export type { StudyRequest };
