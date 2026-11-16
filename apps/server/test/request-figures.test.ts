import { describe, expect, it } from "vitest";
import { figuresIn, figuresNotIn } from "../src/domains/files/figures.js";
import { setupRequests, thrown } from "./requests-helpers.js";

describe("figures: numbers with units, ranges and decimals", () => {
  it("finds values, ranges and decimals and ignores bare integers and words", () => {
    expect(figuresIn("Give 25 mg BID, or 50-200 mg daily; K+ 3.5 mEq/L. Page 12 of 30.")).toEqual([
      { text: "50-200 mg", keys: ["50|mg", "200|mg"], range: true },
      { text: "25 mg", keys: ["25|mg"], range: false },
      { text: "3.5 mEq", keys: ["3.5|meq"], range: false },
    ]);
  });

  it("matches whitespace, case, a decimal comma, mcg for µg and a range written out", () => {
    const source = ["Digoxin 0,125 mg daily. Fentanyl 25 µg/h. Range 50 mg to 200 mg."];
    expect(figuresNotIn("digoxin 0.125mg; 25 mcg", source)).toEqual([]);
    expect(figuresNotIn("50 – 200 MG", source)).toEqual([]);
  });

  it("flags what no source has: a changed range end, a new maximum, a different unit", () => {
    const source = ["Metoprolol tartrate: usual daily dose 50-200 mg, twice daily."];
    expect(figuresNotIn("50-100 mg twice daily; maximum 400 mg", source)).toEqual([
      "50-100 mg",
      "400 mg",
    ]);
    expect(figuresNotIn("50-200 mcg", source)).toEqual(["50-200 mcg"]);
    expect(figuresNotIn("A single 50 mg dose", source)).toEqual([]);
    expect(figuresNotIn("A single 75 mg dose", source)).toEqual(["75 mg"]);
  });

  it("never trips on a reply without figures, and reports each figure once", () => {
    expect(figuresNotIn("Fixed the sentence; see slide 12.", [])).toEqual([]);
    expect(figuresNotIn("400 mg, again 400 mg", [])).toEqual(["400 mg"]);
  });
});

describe("completing a request: the reply's figures against its sources", () => {
  const DOSE = "Metoprolol tartrate: usual daily dose 50-200 mg, twice daily.";

  function onDose() {
    const t = setupRequests();
    const doc = t.newDoc([DOSE, "Maximum 400 mg per day for angina."]);
    const [dose, max] = doc.blockIds as [string, string];
    const ask = (target: Parameters<typeof t.service.create>[1]["target"], message = "") => {
      const id = t.service.create(t.she, { target, kind: "wrong", message }).id;
      t.service.claim(t.bot, id);
      return id;
    };
    const onBlock = ask({ type: "block", documentId: doc.documentId, blockId: dose });
    return { t, doc, dose, max, ask, onBlock };
  }

  it("refuses an agent's reply whose figures the target does not contain, and completes nothing", () => {
    const { t, onBlock } = onDose();
    const refused = thrown(() =>
      t.service.complete(t.bot, onBlock, {
        reply: "Corrected: 50-100 mg twice daily; maximum 400 mg.",
        links: [],
      }),
    );
    expect(refused.code).toBe("invalid_input");
    expect(refused.message).toContain('"50-100 mg", "400 mg"');
    expect(refused.message).toContain("Nothing was completed");
    expect(refused.hint).toContain("acknowledgeUnsourced");
    expect(t.service.get(t.she, onBlock).status).toBe("in_progress");
  });

  it("accepts figures the target contains, with no flag", () => {
    const { t, onBlock } = onDose();
    const done = t.service.complete(t.bot, onBlock, {
      reply: "The slide says 50-200 mg twice daily; fixed.",
      links: [],
    });
    expect(done.status).toBe("done");
    expect(done.reply?.unsourcedFigures).toBe(false);
    expect(done.reply?.unsourcedFigureList).toBeUndefined();
  });

  it("accepts figures that a cited block or source contains", () => {
    const { t, onBlock, doc, max } = onDose();
    const done = t.service.complete(t.bot, onBlock, {
      reply: "Dose 50-200 mg; the maximum is 400 mg.",
      links: [{ type: "block", documentId: doc.documentId, blockId: max }],
    });
    expect(done.reply?.unsourcedFigures).toBe(false);
  });

  it("accepts figures she wrote in her own request", () => {
    const { t, ask, doc } = onDose();
    const id = ask(
      { type: "document", documentId: doc.documentId },
      "Please say the target is under 130 mmHg.",
    );
    const done = t.service.complete(t.bot, id, { reply: "Added: under 130 mmHg.", links: [] });
    expect(done.reply?.unsourcedFigures).toBe(false);
  });

  it("completes with acknowledgeUnsourced and stores the flag and the figures for her", () => {
    const { t, onBlock } = onDose();
    const done = t.service.complete(t.bot, onBlock, {
      reply: "General knowledge: usual maximum 450 mg/day in some sources.",
      links: [],
      acknowledgeUnsourced: true,
    });
    expect(done.status).toBe("done");
    expect(done.reply).toMatchObject({ unsourcedFigures: true, unsourcedFigureList: ["450 mg"] });
    // she sees it when she reads the request, over HTTP too
    expect(t.service.get(t.she, onBlock).reply?.unsourcedFigures).toBe(true);
  });

  it("does not check a decline, or her own words", async () => {
    const { t, ask, doc } = onDose();
    const id = ask({ type: "document", documentId: doc.documentId });
    const declined = t.service.decline(t.bot, id, { reason: "Slide says nothing about 900 mg." });
    expect(declined.status).toBe("declined");
    expect(declined.reply?.unsourcedFigures).toBe(false);
  });

  it("applies over the HTTP API for an agent key", async () => {
    const { t, onBlock } = onDose();
    const refused = await t.call(t.asKey(t.bot), "POST", `/api/requests/${onBlock}/complete`, {
      reply: "Use 300 mg.",
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toContain('"300 mg"');
    const ok = await t.call(t.asKey(t.bot), "POST", `/api/requests/${onBlock}/complete`, {
      reply: "Use 300 mg.",
      acknowledgeUnsourced: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.request.reply.unsourcedFigures).toBe(true);
  });
});
