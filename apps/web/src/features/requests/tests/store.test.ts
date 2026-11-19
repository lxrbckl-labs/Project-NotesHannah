import { StudyRequestWithContext } from "@notes/schema";
import { describe, expect, it } from "vitest";
import type { AppHttp } from "../../../lib/api";
import { ApiClientError } from "../../../lib/api";
import { createHttpRequestsStore } from "../store/http";
import { createMockRequestsStore } from "../store/mock";
import { did, nid, rid, seedRequests } from "../store/seed";

const NOW = Date.parse("2026-11-15T10:00:00Z");
const sample = StudyRequestWithContext.parse(seedRequests(NOW)[0]);

function fakeHttp(answer: (method: string, path: string) => unknown) {
  const calls: Array<{ method: string; path: string; query?: unknown; body?: unknown }> = [];
  const make = (method: string) => async (path: string, a?: unknown) => {
    calls.push({ method, path, ...(method === "GET" ? { query: a } : { body: a }) });
    return answer(method, path);
  };
  const http = {
    get: make("GET"),
    post: make("POST"),
    patch: make("PATCH"),
    put: make("PUT"),
    del: make("DELETE"),
  } as unknown as AppHttp;
  return { http, calls };
}

describe("the HTTP store", () => {
  it("lists newest first, with the statuses joined by commas", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [sample], nextCursor: null }));
    const store = createHttpRequestsStore(http);
    await store.list({ status: ["waiting", "in_progress"] });
    await store.list();
    expect(calls[0]).toEqual({
      method: "GET",
      path: "/requests",
      query: {
        status: "waiting,in_progress",
        targetType: undefined,
        order: "newest",
        cursor: undefined,
        limit: 100,
      },
    });
    expect(calls[1]?.query).toMatchObject({ status: undefined, order: "newest" });
  });

  it("reads the counts out of their envelope", async () => {
    const counts = { waiting: 2, in_progress: 1, done: 3, declined: 1, cancelled: 0, open: 3 };
    const { http, calls } = fakeHttp(() => ({ counts }));
    expect(await createHttpRequestsStore(http).counts()).toEqual(counts);
    expect(calls[0]?.path).toBe("/requests/counts");
  });

  it("uses the documented routes and bodies for each action", async () => {
    const { http, calls } = fakeHttp(() => ({ request: sample }));
    const store = createHttpRequestsStore(http);
    const target = { type: "library" } as const;
    await store.create({ target, kind: "summarise", message: "" });
    await store.update(rid(1), { message: "new words" });
    await store.cancel(rid(1));
    await store.reopen(rid(1), "still wrong");
    await store.reopen(rid(1));
    await store.get(rid(1));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /requests",
      `PATCH /requests/${rid(1)}`,
      `POST /requests/${rid(1)}/cancel`,
      `POST /requests/${rid(1)}/reopen`,
      `POST /requests/${rid(1)}/reopen`,
      `GET /requests/${rid(1)}`,
    ]);
    expect(calls[0]?.body).toEqual({ target, kind: "summarise", message: "" });
    expect(calls[1]?.body).toEqual({ message: "new words" });
    expect(calls[3]?.body).toEqual({ note: "still wrong" });
    expect(calls[4]?.body).toEqual({ note: "" });
  });

  it("refuses an answer that does not match the shared schema", async () => {
    const { http } = fakeHttp(() => ({ request: { id: "nope" } }));
    await expect(createHttpRequestsStore(http).get(rid(1))).rejects.toMatchObject({
      code: "bad_response",
    });
  });
});

describe("the mock store", () => {
  const make = () => createMockRequestsStore({ now: () => NOW });

  it("lists newest first, hiding canceled by default, and counts all states", async () => {
    const store = make();
    const page = await store.list();
    expect(page.items.length).toBe(11);
    const times = page.items.map((r) => r.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect((await store.list({ status: ["cancelled"] })).items.length).toBe(1);
    const counts = await store.counts();
    expect(counts.open).toBe(counts.waiting + counts.in_progress);
    expect(counts.waiting).toBe(3);
  });

  it("creates, edits, cancels and reopens by the state machine", async () => {
    const store = make();
    const created = await store.create({
      target: { type: "node", nodeId: nid(1) },
      kind: "summarise",
      message: "",
    });
    expect(created.status).toBe("waiting");
    const edited = await store.update(created.id, { message: "short please" });
    expect(edited.message).toBe("short please");
    expect((await store.cancel(created.id)).status).toBe("cancelled");
    await expect(store.update(created.id, { message: "x" })).rejects.toMatchObject({
      code: "conflict",
    });

    const done = (await store.list({ status: ["done"] })).items[0] as {
      id: string;
      reply: unknown;
    };
    const reopened = await store.reopen(done.id, "still not right");
    expect(reopened.status).toBe("waiting");
    expect(reopened.reopens.at(-1)).toMatchObject({
      note: "still not right",
      previousStatus: "done",
    });
    expect(reopened.reopens.at(-1)?.previousReply).toEqual(done.reply);
    await expect(store.reopen(done.id)).rejects.toBeInstanceOf(ApiClientError);
  });

  it("needs words for a free-text request", async () => {
    await expect(
      make().create({ target: { type: "library" }, kind: "other", message: "  " }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("lets a demo act as the agent", async () => {
    const store = make();
    const waiting = (await store.list({ status: ["waiting"] })).items[0]?.id as string;
    expect(store.agent.claim(waiting).status).toBe("in_progress");
    expect(
      store.agent.complete(waiting, "Done it.", [{ type: "document", documentId: did(1) }]).status,
    ).toBe("done");
    expect(() => store.agent.decline(waiting, "no")).toThrow(ApiClientError);
  });

  it("can be slow, empty or broken, for the states around the list", async () => {
    expect((await createMockRequestsStore({ empty: true }).list()).items).toEqual([]);
    await expect(createMockRequestsStore({ failWith: "Down." }).list()).rejects.toThrow("Down.");
  });
});
