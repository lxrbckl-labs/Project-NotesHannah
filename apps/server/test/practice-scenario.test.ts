import { newId, type practice } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { createPracticeService } from "../src/domains/practice/index.js";
import {
  fx,
  type Json,
  rightAnswer,
  sessionItems,
  setupPractice,
  wrongAnswer,
} from "./practice-helpers.js";

/**
 * One realistic evening: an agent writes a lecture's worth of questions, she
 * practises on her phone, misses two, and the agent builds follow-ups from
 * the results until the notebook is empty. Every drug name is invented.
 */
describe("a beta-blocker lecture, end to end", () => {
  it("authoring, a phone session, the notebook, weak areas, follow-ups and clearing it", async () => {
    const env = setupPractice();
    const sp = env.spine(env.alice, 1);
    const lecture = sp.lectures[0] as string;
    const { cite } = env.addPage();
    const lorvanol = newId("concept");
    const tenzolol = newId("concept");

    // 1. The agent authors 12 questions in one batch.
    const dosing = (n: number) =>
      fx.calc(cite, {
        prompt: `Dose set ${n}: a patient weighs {weightKg} kg and the order is {doseMgPerKg} mg/kg of tenzolol (fictional). How many mg?`,
        tags: ["dosing", "beta-blockers"],
        conceptIds: [tenzolol],
      });
    const batch = [
      fx.mc(cite, { conceptIds: [lorvanol] }),
      fx.mc(cite, {
        prompt: "Which adverse effect needs monitoring with tenzolol (fictional)?",
        options: [
          { id: "a", text: "Bradycardia", correct: true },
          { id: "b", text: "Alopecia" },
        ],
        conceptIds: [tenzolol],
      }),
      fx.mc(cite, {
        prompt: "Which class does lorvanol (fictional) belong to?",
        options: [
          { id: "a", text: "Beta blocker", correct: true },
          { id: "b", text: "Loop diuretic" },
          { id: "c", text: "ACE inhibitor" },
        ],
      }),
      fx.selectAll(cite, { conceptIds: [lorvanol] }),
      fx.matching(cite),
      fx.fill(cite, { conceptIds: [lorvanol] }),
      fx.fill(cite, {
        text: "Tenzolol (fictional) is cardio{{1}}.",
        blanks: [{ answers: ["selective"] }],
        tags: ["beta-blockers"],
      }),
      dosing(1),
      dosing(2),
      fx.case(cite),
      fx.flash(cite),
      fx.free(cite),
    ];
    const created = await env.call(env.bot, "POST", "/api/practice/questions", {
      nodeIds: [lecture],
      questions: batch,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.stored).toBe(12);
    const all = (await env.call(env.she, "GET", `/api/practice/questions?nodeId=${lecture}`)).body
      .items as Json[];
    expect(all).toHaveLength(12);
    expect(all.every((q) => q.review === "unverified" && q.author.type === "agent")).toBe(true);

    // She reads and approves what the agent wrote.
    const approved = await env.call(env.she, "POST", "/api/practice/questions/review", {
      questionIds: all.map((q) => q.id),
      status: "reviewed",
    });
    expect(approved.body.changed).toBe(12);

    // 2. On her phone she starts a 10-question session of the app-graded types (no card decks tonight).
    const formats = [
      "multiple_choice",
      "select_all",
      "matching",
      "fill_blank",
      "calculation",
      "case",
    ];
    const start = await env.call(env.she, "POST", "/api/practice/sessions", {
      scope: { kind: "nodes", nodeIds: [lecture] },
      formats,
      length: 10,
      seed: 20261115,
    });
    expect(start.status).toBe(201);
    const sid = start.body.session.id as string;
    expect(start.body.session.total).toBe(10);
    expect(start.body.session.shortfall).toBe(0);

    // She misses the two dose calculations and answers the rest correctly. The phone only ever sees
    // questions without their keys; halfway she picks the session up again on another device.
    let next = start.body.next as Json;
    let answered = 0;
    while (next) {
      expect(JSON.stringify(next)).not.toMatch(
        /EXPLAIN|RATIONALE|"correct"|"expression"|"variables"|quillarate|zorvanide/,
      );
      const item = sessionItems(env, sid)[next.position] as practice.SessionItem;
      const question = env.service.getQuestion(env.she, next.questionId).question;
      const isDose = next.type === "calculation";
      const answer = isDose ? wrongAnswer(question) : rightAnswer(question, item.variantSeed);
      if (answered === 5) {
        const laptop = createPracticeService(env.deps, { sources: env.sources });
        const resumed = laptop.nextQuestion(env.she, sid);
        expect(resumed.next?.position).toBe(next.position);
        expect(JSON.stringify(resumed.next)).toBe(JSON.stringify(next));
      }
      env.advance(20_000);
      const out = await env.call(env.she, "POST", `/api/practice/sessions/${sid}/answer`, {
        position: next.position,
        answer,
        timeTakenMs: 20_000,
      });
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      expect(out.body.result.correct).toBe(!isDose);
      answered++;
      next = out.body.next;
    }
    expect(answered).toBe(10);

    // 3. The session is over; her results.
    const results = (await env.call(env.she, "GET", `/api/practice/sessions/${sid}/results`)).body;
    expect(results.session.status).toBe("finished");
    expect(results.summary).toMatchObject({
      total: 10,
      answered: 10,
      correct: 8,
      incorrect: 2,
      accuracy: 0.8,
      timeTakenMs: 200_000,
    });

    // 4. The notebook holds exactly the two she missed, each needing two in a row.
    const notebook = (await env.call(env.she, "GET", "/api/practice/notebook")).body;
    const missed = results.items
      .filter((i: Json) => !i.correct)
      .map((i: Json) => i.questionId)
      .sort();
    expect(notebook.items.map((i: Json) => i.questionId).sort()).toEqual(missed);
    expect(notebook.counts).toEqual({ total: 2, byType: { calculation: 2 } });
    expect(notebook.items.every((i: Json) => i.stillNeeds === 2 && i.timesMissed === 1)).toBe(true);

    // 5. Weak areas: the lecture and the broad tag are fine; the dosing tag is where she slips.
    const weak = (
      await env.call(env.she, "GET", "/api/practice/weak-areas?minAttempts=2&minQuestions=2")
    ).body;
    expect(weak.byTag[0]).toMatchObject({ key: "dosing", attempts: 2, correct: 0, status: "weak" });
    expect(weak.byTag.find((t: Json) => t.key === "beta-blockers")).toMatchObject({
      attempts: 9,
      correct: 7,
      status: "ok",
    });
    expect(weak.byNode.find((n: Json) => n.key === lecture)).toMatchObject({
      attempts: 10,
      correct: 8,
      label: "Fall 2026 / Pharmacology II / Lectures / Lecture 5",
    });
    expect(weak.byConcept[0]).toMatchObject({ key: tenzolol, status: "weak" });
    const quiet = (await env.call(env.she, "GET", "/api/practice/weak-areas")).body;
    expect(quiet.byTag.find((t: Json) => t.key === "dosing").status).toBe("insufficient_data");

    // 6. The agent reads the results and writes three follow-ups on exactly what she missed.
    const read = (await env.call(env.bot, "GET", `/api/practice/sessions/${sid}/results`)).body;
    const slips = read.items.filter((i: Json) => i.correct === false);
    expect(slips).toHaveLength(2);
    const slipTags = [...new Set(slips.flatMap((i: Json) => i.tags))] as string[];
    expect(slipTags).toContain("dosing");
    const followUps = [1, 2, 3].map((n) =>
      fx.calc(cite, {
        prompt: `Follow-up ${n}: a child weighs {weightKg} kg and the tenzolol (fictional) order is {doseMgPerKg} mg/kg. How many mg?`,
        tags: ["dosing", "follow-up"],
        conceptIds: [tenzolol],
        answer: {
          kind: "expression",
          expression: "weightKg * doseMgPerKg",
          variables: {
            weightKg: { kind: "range", min: 10 * n, max: 10 * n + 20, step: 5 },
            doseMgPerKg: { kind: "list", values: [1, 2] },
          },
        },
      }),
    );
    const more = await env.call(env.bot, "POST", "/api/practice/questions", {
      nodeIds: [lecture],
      questions: followUps,
    });
    expect(more.body.stored).toBe(3);
    const dosingList = (await env.call(env.bot, "GET", "/api/practice/questions?tag=dosing")).body
      .items as Json[];
    expect(dosingList).toHaveLength(5);
    // the follow-ups are the agent's and wait for her review; they are not in the notebook
    expect(dosingList.filter((q) => q.review === "unverified")).toHaveLength(3);
    expect((await env.call(env.she, "GET", "/api/practice/notebook")).body.counts.total).toBe(2);

    // 7. She clears the notebook: a session on what she missed, right twice in a row.
    for (let round = 0; round < 2; round++) {
      const again = await env.call(env.she, "POST", "/api/practice/sessions", {
        scope: { kind: "missed" },
        length: 10,
      });
      expect(again.status).toBe(201);
      expect(again.body.session.items.map((i: Json) => i.questionId).sort()).toEqual(missed);
      let q = again.body.next as Json;
      while (q) {
        const item = sessionItems(env, again.body.session.id)[q.position] as practice.SessionItem;
        const question = env.service.getQuestion(env.she, q.questionId).question;
        const out = await env.call(
          env.she,
          "POST",
          `/api/practice/sessions/${again.body.session.id}/answer`,
          { answer: rightAnswer(question, item.variantSeed) },
        );
        expect(out.body.result.correct).toBe(true);
        q = out.body.next;
      }
      const nb = (await env.call(env.she, "GET", "/api/practice/notebook")).body;
      expect(nb.counts.total).toBe(round === 0 ? 2 : 0);
      if (round === 0) expect(nb.items.every((i: Json) => i.stillNeeds === 1)).toBe(true);
    }
    const empty = await env.call(env.she, "POST", "/api/practice/sessions", {
      scope: { kind: "missed" },
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error.hint).toContain("notebook");

    // The history is all still there for the agent: three sessions, 14 attempts on the dose questions' lecture.
    const sessions = (await env.call(env.readBot, "GET", "/api/practice/sessions")).body.items;
    expect(sessions).toHaveLength(3);
    const weakNow = (
      await env.call(env.bot, "GET", "/api/practice/weak-areas?minAttempts=2&minQuestions=2")
    ).body;
    expect(weakNow.byTag.find((t: Json) => t.key === "dosing")).toMatchObject({
      attempts: 6,
      correct: 4,
      status: "weak",
    });
  });
});
