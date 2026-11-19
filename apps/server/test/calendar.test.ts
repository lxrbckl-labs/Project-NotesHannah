import { CalendarResponse } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { errorCode, makeTestApp } from "./helpers.js";

const PW = "correct horse battery";

async function setup() {
  const t = makeTestApp();
  await t.addUser("hannah", PW);
  const cookies = (await t.signIn("hannah", PW)).cookies;
  const get = (query: string) => t.request(`/api/calendar?${query}`, { cookies });
  return { t, cookies, get };
}

describe("GET /api/calendar", () => {
  test("needs a sign-in", async () => {
    const { t } = await setup();
    const res = await t.request("/api/calendar?from=2026-11-01&to=2026-11-30");
    expect(res.status).toBe(401);
  });

  test("an account with nothing has no exams, no study days and no streak", async () => {
    const { get } = await setup();
    const res = await get("from=2026-11-01&to=2026-11-30");
    expect(res.status).toBe(200);
    const body = CalendarResponse.parse(res.body);
    expect(body.exams).toEqual([]);
    expect(body.days).toEqual([]);
    expect(body.streak).toBe(0);
    expect(body.from).toBe("2026-11-01");
    expect(body.to).toBe("2026-11-30");
  });

  test("refuses a missing date, a backwards range and a range that is too long", async () => {
    const { get } = await setup();
    for (const query of [
      "from=2026-11-01",
      "from=2026-11-30&to=2026-11-01",
      "from=2026-01-01&to=2026-06-30",
      "from=nope&to=2026-11-30",
    ]) {
      const res = await get(query);
      expect(res.status, query).toBe(400);
      expect(errorCode(res.body), query).toBe("invalid_input");
    }
  });
});
