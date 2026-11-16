import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../src/db/client.js";
import {
  createDbNameCache,
  createFakeDrugNameChecker,
  createMemoryNameCache,
  createRateLimiter,
  createRxNavChecker,
  type DrugNameChecker,
  nameCheckerFromEnv,
  rxnormEnabled,
} from "../src/domains/concepts/index.js";
import { setupConcepts } from "./concepts-helpers.js";

// No test may reach the network: a real fetch is a failure.
let realFetch: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  realFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("a test reached the network");
  });
});
afterEach(() => {
  expect(realFetch).not.toHaveBeenCalled();
  realFetch.mockRestore();
});

const FIXTURES = JSON.parse(
  readFileSync(new URL("./concepts-rxnav-fixtures.json", import.meta.url), "utf8"),
).responses as Record<string, unknown>;

/** A fetch that answers from the recorded responses and records what it was asked. */
function recordedFetch(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const urls: string[] = [];
  const fn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    urls.push(`${url.origin}${path}`);
    const override = overrides[path];
    if (override) return override();
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const body = FIXTURES[path];
    if (body === undefined) return new Response("not recorded", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fn, urls };
}

const instant = createRateLimiter({ perSecond: 1000, now: () => 0, sleep: async () => {} });

describe("the fake checker", () => {
  it("matches, suggests, does not know, fails and recovers", async () => {
    const fake = createFakeDrugNameChecker();
    fake.match("Metoprolol", "6918");
    fake.suggest("metoprolo", "metoprolol", "6918");
    expect(await fake.check("metoprolol")).toEqual({ status: "matched", rxcui: "6918" });
    expect(await fake.check("METOPROLO")).toEqual({
      status: "suggestion",
      suggested: "metoprolol",
      rxcui: "6918",
    });
    expect(await fake.check("zzzqqxx")).toEqual({ status: "unknown" });
    fake.fail("offline");
    expect(await fake.check("metoprolol")).toEqual({ status: "failed", reason: "offline" });
    fake.recover();
    expect((await fake.check("metoprolol")).status).toBe("matched");
    expect(fake.calls).toEqual(["metoprolol", "METOPROLO", "zzzqqxx", "metoprolol", "metoprolol"]);
  });
});

describe("the check inside the concepts service", () => {
  function setup() {
    const checker = createFakeDrugNameChecker();
    checker.match("metoprolol", "6918");
    checker.suggest("metoprolo", "metoprolol", "6918");
    const t = setupConcepts({ ports: { nameChecker: checker } });
    return { t, checker };
  }
  const drug = (name: string, extra: Record<string, unknown> = {}) => ({
    type: "drug" as const,
    name,
    generalKnowledge: true,
    ...extra,
  });
  const statusOf = (t: ReturnType<typeof setup>["t"], id: string) =>
    t.service.getConcept(t.she, id).concept.drug?.nameCheck;

  it("saves at once as unchecked, then records a match and its RxCUI", async () => {
    const { t } = setup();
    const { concept } = t.service.createConcept(t.bot, drug("metoprolol"));
    expect(concept.drug?.nameCheck).toEqual({ status: "unchecked" });
    await t.service.idle();
    expect(statusOf(t, concept.id)).toMatchObject({ status: "matched", rxcui: "6918" });
    const after = t.service.getConcept(t.she, concept.id).concept;
    expect(after.drug?.rxcui).toBe("6918");
    // The check is not an edit: provenance and review status are as they were.
    expect(after.provenance.lastEditedAt).toBe(concept.provenance.lastEditedAt);
    expect(after.reviewStatus).toBe("unverified");
  });

  it("keeps an RxCUI already given, suggests a spelling, never renames", async () => {
    const { t } = setup();
    const given = t.service.createConcept(
      t.bot,
      drug("metoprolol", { drug: { rxcui: "11111" } }),
    ).concept;
    const typo = t.service.createConcept(t.bot, drug("metoprolo")).concept;
    await t.service.idle();
    expect(t.service.getConcept(t.she, given.id).concept.drug?.rxcui).toBe("11111");
    expect(statusOf(t, typo.id)).toMatchObject({
      status: "suggestion",
      suggested: "metoprolol",
      rxcui: "6918",
    });
    expect(t.service.getConcept(t.she, typo.id).concept.name).toBe("metoprolo");
  });

  it("records unknown for a name RxNorm has never heard of, and ignores non-drugs", async () => {
    const { t, checker } = setup();
    const unknown = t.service.createConcept(t.bot, drug("zzzqqxx")).concept;
    const effect = t.service.createConcept(t.bot, {
      type: "adverse_effect",
      name: "bradycardia",
      generalKnowledge: true,
    }).concept;
    await t.service.idle();
    expect(statusOf(t, unknown.id)).toMatchObject({ status: "unknown" });
    expect(t.service.getConcept(t.she, effect.id).concept.drug).toBeNull();
    // only drug names were sent, and only the name
    expect(checker.calls).toEqual(["zzzqqxx"]);
  });

  it("never blocks saving: a failing checker leaves the concept unchecked, and a hung one does not hold the call", async () => {
    const { t, checker } = setup();
    checker.fail();
    const failed = t.service.createConcept(t.bot, drug("metoprolol")).concept;
    await t.service.idle();
    expect(statusOf(t, failed.id)).toEqual({ status: "unchecked" });

    const hung: DrugNameChecker = { check: () => new Promise(() => {}) };
    const t2 = setupConcepts({ ports: { nameChecker: hung } });
    const started = Date.now();
    const saved = t2.service.createConcept(t2.bot, drug("atenolol")).concept;
    expect(Date.now() - started).toBeLessThan(500);
    expect(t2.service.getConcept(t2.she, saved.id).concept.drug?.nameCheck.status).toBe(
      "unchecked",
    );
    // a checker that throws is swallowed too
    const t3 = setupConcepts({
      ports: { nameChecker: { check: () => Promise.reject(new Error("boom")) } },
    });
    t3.service.createConcept(t3.bot, drug("atenolol"));
    await expect(t3.service.idle()).resolves.toBeUndefined();
  });

  it("checks again later: pending names, once the service is back", async () => {
    const { t, checker } = setup();
    checker.fail();
    const a = t.service.createConcept(t.bot, drug("metoprolol")).concept;
    t.service.createConcept(t.bot, drug("zzzqqxx"));
    await t.service.idle();
    checker.recover();
    expect(await t.service.checkPending(t.she)).toEqual({ checked: 2, remaining: 0 });
    expect(statusOf(t, a.id)).toMatchObject({ status: "matched" });
    // and a limit leaves the rest for next time
    checker.fail();
    t.service.createConcept(t.bot, drug("a1"));
    t.service.createConcept(t.bot, drug("a2"));
    await t.service.idle();
    checker.recover();
    expect(await t.service.checkPending(t.she, 1)).toEqual({ checked: 1, remaining: 1 });
  });

  it("starts again when the name changes, and ignores an answer for the old name", async () => {
    const { t, checker } = setup();
    const c = t.service.createConcept(t.bot, drug("metoprolo")).concept;
    await t.service.idle();
    expect(statusOf(t, c.id)).toMatchObject({ status: "suggestion" });
    t.service.updateConcept(t.bot, c.id, { name: "metoprolol" });
    expect(statusOf(t, c.id)).toEqual({ status: "unchecked" });
    await t.service.idle();
    expect(statusOf(t, c.id)).toMatchObject({ status: "matched" });
    // a late answer for a name that has since been replaced is dropped
    const answers: Array<
      (value: { status: "matched"; rxcui: string } | { status: "unknown" }) => void
    > = [];
    const slow: DrugNameChecker = { check: () => new Promise((resolve) => answers.push(resolve)) };
    const t2 = setupConcepts({ ports: { nameChecker: slow } });
    const d = t2.service.createConcept(t2.bot, drug("old name")).concept;
    t2.service.updateConcept(t2.bot, d.id, { name: "new name" });
    expect(answers).toHaveLength(2);
    answers[0]?.({ status: "matched", rxcui: "OLD" }); // for "old name"
    answers[1]?.({ status: "unknown" }); // for "new name"
    await t2.service.idle();
    const settled = t2.service.getConcept(t2.she, d.id).concept.drug;
    expect(settled?.nameCheck.status).toBe("unknown");
    expect(settled?.rxcui).toBeNull();
    expect(checker.calls.length).toBeGreaterThan(0);
  });

  it("can be asked for by hand over HTTP, and says when it is switched off", async () => {
    const { t } = setup();
    const made = t.service.createConcept(t.bot, drug("metoprolol")).concept;
    await t.service.idle();
    const res = await t.call(t.asUser(t.alice), "POST", `/api/concepts/${made.id}/name-check`);
    expect(res.status).toBe(200);
    expect(res.body.concept.drug.nameCheck.status).toBe("matched");
    const batch = await t.call(t.asUser(t.alice), "POST", "/api/concepts/name-checks", {
      limit: 5,
    });
    expect(batch.body).toEqual({ checked: 0, remaining: 0 });

    const off = setupConcepts();
    const c = off.service.createConcept(off.bot, drug("metoprolol")).concept;
    const refused = await off.call(
      off.asUser(off.alice),
      "POST",
      `/api/concepts/${c.id}/name-check`,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/switched off/);
    expect(refused.body.error.hint).toMatch(/RXNORM_CHECK=1/);
    await off.service.idle();
    expect(off.service.getConcept(off.she, c.id).concept.drug?.nameCheck.status).toBe("unchecked");
    // another user's concept is not found
    expect(
      (await t.call(t.asUser(t.bob), "POST", `/api/concepts/${made.id}/name-check`)).status,
    ).toBe(404);
  });

  it("is switched on only by RXNORM_CHECK=1", () => {
    const db = createTestDatabase();
    expect(rxnormEnabled({})).toBe(false);
    expect(rxnormEnabled({ RXNORM_CHECK: "0" })).toBe(false);
    expect(rxnormEnabled({ RXNORM_CHECK: "true" })).toBe(false);
    expect(rxnormEnabled({ RXNORM_CHECK: "1" })).toBe(true);
    expect(nameCheckerFromEnv(db, {})).toBeUndefined();
    expect(nameCheckerFromEnv(db, { RXNORM_CHECK: "1" })).toBeDefined();
  });
});

describe("the RxNav client, against recorded responses", () => {
  it("matches a name RxNorm knows, preferring the ingredient when there are several", async () => {
    const { fetch, urls } = recordedFetch();
    const checker = createRxNavChecker({ fetch, limiter: instant });
    // two RxCUIs come back for "metoprolol": the ingredient (IN) and a precise ingredient (PIN)
    expect(await checker.check("metoprolol")).toEqual({ status: "matched", rxcui: "6918" });
    expect(urls[0]).toBe("https://rxnav.nlm.nih.gov/REST/rxcui.json?name=metoprolol&search=1");
    expect(urls.slice(1)).toEqual([
      "https://rxnav.nlm.nih.gov/REST/rxcui/221124/properties.json",
      "https://rxnav.nlm.nih.gov/REST/rxcui/6918/properties.json",
    ]);
    // a single answer needs no second look
    urls.length = 0;
    expect(await checker.check("atenolol")).toEqual({ status: "matched", rxcui: "1202" });
    expect(urls).toHaveLength(1);
    // a brand name is a name RxNorm knows
    expect(await checker.check("lopressor")).toEqual({ status: "matched", rxcui: "203344" });
  });

  it("suggests the nearest name when the exact one is unknown", async () => {
    const { fetch, urls } = recordedFetch();
    const checker = createRxNavChecker({ fetch, limiter: instant });
    expect(await checker.check("metoprolo")).toEqual({
      status: "suggestion",
      suggested: "metoprolol",
      rxcui: "6918",
    });
    expect(urls).toEqual([
      "https://rxnav.nlm.nih.gov/REST/rxcui.json?name=metoprolo&search=1",
      "https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=metoprolo&maxEntries=4",
      "https://rxnav.nlm.nih.gov/REST/rxcui/6918/properties.json",
    ]);
  });

  it("says unknown when nothing comes close, and for names with nothing to look up", async () => {
    const { fetch, urls } = recordedFetch();
    const checker = createRxNavChecker({ fetch, limiter: instant });
    expect(await checker.check("zzzqqxx")).toEqual({ status: "unknown" });
    urls.length = 0;
    expect(await checker.check("  !!! ")).toEqual({ status: "unknown" });
    expect(urls).toEqual([]);
    // a weak match is not offered as a suggestion
    const weak = recordedFetch({
      "/REST/approximateTerm.json?term=zzzqqxx&maxEntries=4": () =>
        Response.json({
          approximateGroup: { candidate: [{ rxcui: "6918", score: "1.2", rank: "1" }] },
        }),
    });
    expect(
      await createRxNavChecker({ fetch: weak.fetch, limiter: instant }).check("zzzqqxx"),
    ).toEqual({ status: "unknown" });
  });

  it("sends only the drug name, to the documented endpoints, encoded", async () => {
    const { fetch, urls } = recordedFetch();
    const checker = createRxNavChecker({ fetch, limiter: instant, cache: createMemoryNameCache() });
    await checker.check("metoprolol tartrate & more");
    expect(urls[0]).toBe(
      "https://rxnav.nlm.nih.gov/REST/rxcui.json?name=metoprolol%20tartrate%20%26%20more&search=1",
    );
    for (const url of urls) expect(new URL(url).origin).toBe("https://rxnav.nlm.nih.gov");
  });

  it("answers from its cache the second time, even through another client and a restart", async () => {
    const db = createTestDatabase();
    const first = recordedFetch();
    const a = createRxNavChecker({
      fetch: first.fetch,
      limiter: instant,
      cache: createDbNameCache(db),
    });
    expect((await a.check("metoprolo")).status).toBe("suggestion");
    const asked = first.urls.length;
    expect(await a.check(" Metoprolo ")).toMatchObject({ status: "suggestion" });
    expect(first.urls).toHaveLength(asked);
    // a new client over the same database (a restart) asks nothing
    const second = recordedFetch();
    const b = createRxNavChecker({
      fetch: second.fetch,
      limiter: instant,
      cache: createDbNameCache(db),
    });
    expect(await b.check("metoprolo")).toMatchObject({
      status: "suggestion",
      suggested: "metoprolol",
    });
    expect(second.urls).toEqual([]);
    // unknown answers are cached too
    expect((await b.check("zzzqqxx")).status).toBe("unknown");
    const third = recordedFetch();
    expect(
      (
        await createRxNavChecker({
          fetch: third.fetch,
          limiter: instant,
          cache: createDbNameCache(db),
        }).check("zzzqqxx")
      ).status,
    ).toBe("unknown");
    expect(third.urls).toEqual([]);
  });

  it("expires cached answers after the time to live", () => {
    const db = createTestDatabase();
    let now = 1_000;
    const cache = createDbNameCache(db, () => now, 10_000);
    cache.set("metoprolol", { status: "matched", rxcui: "6918" });
    now += 9_999;
    expect(cache.get("metoprolol")).toEqual({ status: "matched", rxcui: "6918" });
    now += 2;
    expect(cache.get("metoprolol")).toBeNull();
    cache.set("metoprolol", { status: "unknown" });
    expect(cache.get("metoprolol")).toEqual({ status: "unknown" });
    expect(cache.get("never asked")).toBeNull();
  });

  describe("when RxNav misbehaves, the answer is failed and nothing is cached", () => {
    const cases: Array<[string, () => Response | Promise<Response>, RegExp]> = [
      ["a server error", () => new Response("down", { status: 503 }), /answered 503/],
      ["rate limiting", () => new Response("slow down", { status: 429 }), /answered 429/],
      [
        "a body that is not JSON",
        () => new Response("<html>oops</html>", { status: 200 }),
        /not JSON/,
      ],
      [
        "a dropped connection",
        () => Promise.reject(new TypeError("fetch failed")),
        /could not be reached/,
      ],
    ];
    for (const [name, respond, reason] of cases) {
      it(`${name}`, async () => {
        const cache = createMemoryNameCache();
        const { fetch } = recordedFetch({ "/REST/rxcui.json?name=metoprolol&search=1": respond });
        const checker = createRxNavChecker({ fetch, limiter: instant, cache });
        const outcome = await checker.check("metoprolol");
        expect(outcome.status).toBe("failed");
        if (outcome.status === "failed") expect(outcome.reason).toMatch(reason);
        expect(cache.size()).toBe(0);
      });
    }

    it("a request that never answers times out", async () => {
      const hang = (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      const checker = createRxNavChecker({
        fetch: hang as typeof fetch,
        limiter: instant,
        timeoutMs: 20,
      });
      const outcome = await checker.check("metoprolol");
      expect(outcome).toEqual({ status: "failed", reason: "RxNav timed out" });
    });

    it("rests after a failure instead of asking again at once, then tries again", async () => {
      let now = 0;
      let up = false;
      const { fetch, urls } = recordedFetch({
        "/REST/rxcui.json?name=atenolol&search=1": () =>
          up
            ? Response.json(FIXTURES["/REST/rxcui.json?name=atenolol&search=1"])
            : new Response("down", { status: 500 }),
      });
      const checker = createRxNavChecker({
        fetch,
        limiter: instant,
        now: () => now,
        backoffMs: 60_000,
      });
      expect((await checker.check("atenolol")).status).toBe("failed");
      expect(urls).toHaveLength(1);
      now = 30_000;
      expect(await checker.check("atenolol")).toMatchObject({
        status: "failed",
        reason: expect.stringMatching(/rest/),
      });
      expect(urls).toHaveLength(1); // no request while it rests
      // a name already in the cache is still answered during the rest
      now = 61_000;
      up = true;
      expect(await checker.check("atenolol")).toEqual({ status: "matched", rxcui: "1202" });
    });

    it("fails the service-level check quietly: the concept stays unchecked", async () => {
      const { fetch } = recordedFetch({
        "/REST/rxcui.json?name=atenolol&search=1": () => new Response("x", { status: 500 }),
      });
      const t = setupConcepts({
        ports: { nameChecker: createRxNavChecker({ fetch, limiter: instant }) },
      });
      const c = t.service.createConcept(t.bot, {
        type: "drug",
        name: "atenolol",
        generalKnowledge: true,
      }).concept;
      await t.service.idle();
      expect(t.service.getConcept(t.she, c.id).concept.drug?.nameCheck).toEqual({
        status: "unchecked",
      });
    });
  });

  it("goes through the service end to end with recorded answers", async () => {
    const { fetch } = recordedFetch();
    const t = setupConcepts({
      ports: { nameChecker: createRxNavChecker({ fetch, limiter: instant }) },
    });
    const ok = t.service.createConcept(t.bot, {
      type: "drug",
      name: "metoprolol",
      generalKnowledge: true,
    }).concept;
    const typo = t.service.createConcept(t.bot, {
      type: "drug",
      name: "metoprolo",
      generalKnowledge: true,
    }).concept;
    const nonsense = t.service.createConcept(t.bot, {
      type: "drug",
      name: "zzzqqxx",
      generalKnowledge: true,
    }).concept;
    await t.service.idle();
    const status = (id: string) => t.service.getConcept(t.she, id).concept.drug;
    expect(status(ok.id)).toMatchObject({
      rxcui: "6918",
      nameCheck: { status: "matched", rxcui: "6918" },
    });
    expect(status(typo.id)?.nameCheck).toMatchObject({
      status: "suggestion",
      suggested: "metoprolol",
    });
    expect(status(nonsense.id)?.nameCheck).toMatchObject({ status: "unknown" });
  });
});

describe("the rate limiter", () => {
  it("spaces requests, five a second by default, however many ask at once", async () => {
    let now = 10_000;
    const slept: number[] = [];
    const limiter = createRateLimiter({
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });
    for (let i = 0; i < 6; i++) await limiter.acquire();
    // the first goes at once; each later one waits for its 200 ms slot
    expect(slept).toEqual([200, 200, 200, 200, 200]);
  });

  it("stays well under 20 requests per second in any window", async () => {
    let now = 0;
    const stamps: number[] = [];
    const limiter = createRateLimiter({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    for (let i = 0; i < 100; i++) {
      await limiter.acquire();
      stamps.push(now);
    }
    for (let i = 0; i < stamps.length; i++) {
      const inWindow = stamps.filter(
        (s) => s >= (stamps[i] as number) && s < (stamps[i] as number) + 1000,
      );
      expect(inWindow.length).toBeLessThanOrEqual(5);
    }
  });

  it("lets a quiet client go straight away", async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = createRateLimiter({ now: () => now, sleep: async (ms) => void slept.push(ms) });
    await limiter.acquire();
    now = 5_000;
    await limiter.acquire();
    expect(slept).toEqual([]);
  });

  it("is used for every request the client makes", async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = createRateLimiter({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
        slept.push(ms);
      },
    });
    const { fetch, urls } = recordedFetch();
    await createRxNavChecker({ fetch, limiter, now: () => now }).check("metoprolo");
    expect(urls).toHaveLength(3);
    expect(slept).toEqual([200, 200]);
  });
});
