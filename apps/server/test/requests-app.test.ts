import { CreatedApiKey } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { errorCode, makeTestApp } from "./helpers.js";

const PW = "correct horse battery";

/** The whole stack: real sign-in, real Origin check, real API keys, requests and concepts mounted. */
async function setup() {
  const t = makeTestApp();
  await t.addUser("hannah", PW);
  const { cookies } = await t.signIn("hannah", PW);
  const key = async (scope: "read" | "write") => {
    const res = await t.request("/api/keys", { cookies, body: { name: scope, scope } });
    return CreatedApiKey.parse(res.body).secret;
  };
  return { t, cookies, write: await key("write"), read: await key("read") };
}

describe("requests and concepts in the real app", () => {
  test("a request goes from her browser to an agent and back", async () => {
    const { t, cookies, write, read } = await setup();
    const created = await t.request("/api/requests", {
      cookies,
      body: { target: { type: "library" }, kind: "quiz_me", message: "Beta blockers" },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { request: { id: string } }).request.id;

    // The Origin check applies to her browser, and she has no origin-free path.
    const noOrigin = await t.request("/api/requests", {
      cookies,
      origin: "https://evil.example",
      body: { target: { type: "library" }, kind: "quiz_me" },
    });
    expect(errorCode(noOrigin.body)).toBe("forbidden");

    // An agent key cannot create, a read key cannot claim, a write key can.
    const agentCreate = await t.request("/api/requests", {
      bearer: write,
      body: { target: { type: "library" }, kind: "quiz_me" },
    });
    expect(agentCreate.status).toBe(403);
    expect((agentCreate.body as { error: { message: string } }).error.message).toMatch(
      /Agents cannot create/,
    );
    expect((await t.request(`/api/requests/${id}/claim`, { bearer: read, body: {} })).status).toBe(
      403,
    );
    expect((await t.request("/api/requests?status=waiting", { bearer: read })).status).toBe(200);
    const claim = await t.request(`/api/requests/${id}/claim`, { bearer: write, body: {} });
    expect(claim.status).toBe(200);
    // she cannot complete her own request
    expect(
      (await t.request(`/api/requests/${id}/complete`, { cookies, body: { reply: "me" } })).status,
    ).toBe(403);
    const done = await t.request(`/api/requests/${id}/complete`, {
      bearer: write,
      body: { reply: "Made a quiz." },
    });
    expect((done.body as { request: { status: string } }).request.status).toBe("done");
    const counts = await t.request("/api/requests/counts", { cookies });
    expect((counts.body as { counts: { done: number; open: number } }).counts).toMatchObject({
      done: 1,
      open: 0,
    });
    expect(
      (await t.request(`/api/requests/${id}/reopen`, { cookies, body: { note: "More" } })).status,
    ).toBe(200);
  });

  test("concepts: an agent files them in bulk, she reads and reviews", async () => {
    const { t, cookies, write, read } = await setup();
    const bulk = await t.request("/api/concepts/bulk", {
      bearer: write,
      body: {
        concepts: [
          {
            type: "drug",
            name: "metoprolol",
            drug: { brandNames: ["Lopressor"] },
            generalKnowledge: true,
          },
          { type: "adverse_effect", name: "bradycardia", generalKnowledge: true },
        ],
        relations: [
          {
            from: { type: "drug", name: "metoprolol" },
            to: { type: "adverse_effect", name: "bradycardia" },
            type: "causes_adverse_effect",
            generalKnowledge: true,
          },
        ],
      },
    });
    expect(bulk.status).toBe(200);
    const search = await t.request("/api/concepts/search?q=lopress", { bearer: read });
    expect(search.status).toBe(200);
    const [hit] = (search.body as { items: Array<{ id: string; name: string }> }).items;
    expect(hit?.name).toBe("metoprolol");
    const page = await t.request(`/api/concepts/${hit?.id}/page`, { cookies });
    expect((page.body as { groups: unknown[] }).groups).toHaveLength(1);
    expect(
      (
        await t.request(`/api/concepts/${hit?.id}/review`, {
          cookies,
          body: { status: "reviewed" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.request(`/api/concepts/${hit?.id}/review`, {
          bearer: write,
          body: { status: "reviewed" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await t.request("/api/concepts/bulk", { bearer: read, body: { concepts: [] } })).status,
    ).toBe(403);
    expect((await t.request("/api/concepts")).status).toBe(401);
  });

  test("two accounts never see each other's requests or concepts", async () => {
    const { t, cookies } = await setup();
    await t.addUser("other", PW);
    const second = await t.signIn("other", PW);
    const made = await t.request("/api/requests", {
      cookies,
      body: { target: { type: "library" }, kind: "expand" },
    });
    const id = (made.body as { request: { id: string } }).request.id;
    expect((await t.request(`/api/requests/${id}`, { cookies: second.cookies })).status).toBe(404);
    expect(
      ((await t.request("/api/requests", { cookies: second.cookies })).body as { items: unknown[] })
        .items,
    ).toEqual([]);
    const concept = await t.request("/api/concepts", {
      cookies,
      body: { type: "drug", name: "atenolol" },
    });
    const cid = (concept.body as { concept: { id: string } }).concept.id;
    expect((await t.request(`/api/concepts/${cid}`, { cookies: second.cookies })).status).toBe(404);
  });
});
