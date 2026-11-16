import { expect, test, vi } from "vitest";
import { createHttpStore } from "../store/http";
import { PracticeApiError } from "../types";

function fakeFetch(
  handler: (url: string, init: RequestInit) => { status?: number; body?: unknown },
) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const { status = 200, body } = handler(String(url), init ?? {});
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

test("sends the assumed routes with JSON bodies and cookies", async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const f = fakeFetch((url, init) => {
    calls.push({
      url,
      method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (init.method === "DELETE") return { status: 204 };
    return { body: { ok: true } };
  });
  const store = createHttpStore({
    baseUrl: "https://x.test",
    fetch: f,
    headers: () => ({ "x-csrf": "t" }),
  });
  await store.getOverview({ currentNodeId: "nod_1" });
  await store.startSession({ scope: { kind: "missed" }, formats: ["multiple_choice"], length: 5 });
  await store.getSession("prs_1");
  await store.submitAnswer("prs_1", 2, { type: "multiple_choice", optionId: "o1" }, 1500);
  await store.reveal("prs_1", 2, 1);
  await store.skip("prs_1", 2);
  await store.finishSession("prs_1");
  await store.deleteExam("exm_1");
  expect(calls.map((c) => `${c.method} ${c.url.replace("https://x.test", "")}`)).toEqual([
    "GET /api/practice/overview?currentNodeId=nod_1",
    "POST /api/practice/sessions",
    "GET /api/practice/sessions/prs_1",
    "POST /api/practice/sessions/prs_1/answers",
    "POST /api/practice/sessions/prs_1/reveal",
    "POST /api/practice/sessions/prs_1/skip",
    "POST /api/practice/sessions/prs_1/finish",
    "DELETE /api/exams/exm_1",
  ]);
  expect(calls[3]?.body).toEqual({
    index: 2,
    answer: { type: "multiple_choice", optionId: "o1" },
    timeTakenMs: 1500,
  });
  expect(calls[4]?.body).toEqual({ index: 2, partIndex: 1 });
  const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
  expect(init.credentials).toBe("include");
  expect((init.headers as Record<string, string>)["x-csrf"]).toBe("t");
});

test("a failed request becomes a PracticeApiError with the server's message", async () => {
  const store = createHttpStore({
    fetch: fakeFetch(() => ({ status: 404, body: { error: { message: "No such session." } } })),
  });
  await expect(store.getSession("prs_x")).rejects.toMatchObject({
    name: "PracticeApiError",
    status: 404,
    message: "No such session.",
  });
  await expect(store.getSession("prs_x")).rejects.toBeInstanceOf(PracticeApiError);
});
