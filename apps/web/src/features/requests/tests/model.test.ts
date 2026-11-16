import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  actionsFor,
  badgeCount,
  EXAMPLES_FOR_TARGET,
  headline,
  isUnread,
  KINDS_FOR_TARGET,
  linkLabel,
  openLink,
  openTarget,
  pollDelay,
  STATUS_HELP,
  STATUS_LABEL,
  targetName,
} from "../model/wording";
import { did, nid, rid, seedRequests } from "../store/seed";

const NOW = Date.parse("2026-11-15T10:00:00Z");

describe("status wording", () => {
  it("says every status in plain words", () => {
    expect(STATUS_LABEL).toEqual({
      waiting: "Waiting for an agent",
      in_progress: "An agent is working on it",
      done: "Done",
      declined: "Needs a change",
      cancelled: "Cancelled",
    });
    for (const text of Object.values(STATUS_HELP)) expect(text.length).toBeGreaterThan(10);
  });

  it("offers her only the moves the state machine allows", () => {
    expect(actionsFor("waiting")).toEqual({ edit: true, cancel: true, reopen: false });
    expect(actionsFor("in_progress")).toEqual({ edit: false, cancel: true, reopen: false });
    expect(actionsFor("done")).toEqual({ edit: false, cancel: false, reopen: true });
    expect(actionsFor("declined")).toEqual({ edit: false, cancel: false, reopen: true });
    expect(actionsFor("cancelled")).toEqual({ edit: false, cancel: false, reopen: false });
  });

  it("polls fast while an agent works, slowly while waiting, never when nothing is open", () => {
    expect(pollDelay(["in_progress", "waiting"])).toBe(4000);
    expect(pollDelay(["waiting"])).toBe(30000);
    expect(pollDelay([])).toBeNull();
  });
});

describe("what a request says", () => {
  const all = seedRequests(NOW);
  const byNumber = (n: number) => all.find((r) => r.id === rid(n)) as (typeof all)[number];

  it("shows her words, else the quick action", () => {
    expect(headline({ kind: "make_questions", message: "" })).toBe("Make questions");
    expect(headline({ kind: "wrong", message: "Check slide 12" })).toBe("Check slide 12");
    expect(headline({ kind: "other", message: "" })).toBe("Something else");
  });

  it("names the target with a fallback", () => {
    expect(targetName(byNumber(2))).toBe("ACE inhibitors and ARBs");
    expect(targetName(byNumber(9))).toBe("Your whole library");
    const lost = { ...byNumber(2), context: { ...byNumber(2).context, name: null, preview: null } };
    expect(targetName(lost)).toBe("A item that is no longer listed");
  });

  it("leads each target to the right place", () => {
    expect(openTarget(byNumber(9))).toBeNull();
    expect(openTarget(byNumber(2))).toEqual({ kind: "node", nodeId: nid(2) });
    expect(openTarget(byNumber(1))).toMatchObject({
      kind: "document",
      documentId: did(1),
      blockId: expect.any(String),
    });
    expect(openTarget(byNumber(7))).toMatchObject({ kind: "source", pageId: expect.any(String) });
    expect(openTarget(byNumber(6))).toMatchObject({ kind: "question" });
  });

  it("labels and opens reply links of every type", () => {
    const links = all.flatMap((r) => r.reply?.links ?? []);
    expect(new Set(links.map((l) => l.type))).toEqual(
      new Set(["document", "block", "source", "question", "concept", "node"]),
    );
    for (const link of links) {
      expect(linkLabel(link).length).toBeGreaterThan(0);
      expect(openLink(link).kind).toBe(link.type === "block" ? "document" : link.type);
    }
    expect(linkLabel({ type: "concept", conceptId: "con_00000000000000000000000001" })).toBe(
      "Concept",
    );
  });
});

describe("badge and unread", () => {
  it("counts waiting requests plus answers she has not seen", () => {
    const done = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(badgeCount(2, done, new Set(["b"]))).toBe(4);
    expect(badgeCount(0, done, new Set(["a", "b", "c"]))).toBe(0);
  });

  it("treats only answered requests as unread", () => {
    const seen = new Set(["x"]);
    expect(isUnread({ id: "y", status: "done" }, seen)).toBe(true);
    expect(isUnread({ id: "x", status: "done" }, seen)).toBe(false);
    expect(isUnread({ id: "y", status: "waiting" }, seen)).toBe(false);
  });
});

describe("quick actions and examples", () => {
  it("has actions and examples for every kind of target", () => {
    for (const type of ["library", "node", "document", "block", "source", "question"] as const) {
      expect(KINDS_FOR_TARGET[type].length).toBeGreaterThanOrEqual(4);
      expect(EXAMPLES_FOR_TARGET[type].length).toBe(3);
    }
  });
});

describe("the demo dataset", () => {
  it("has a dozen requests in every state, newest first once sorted", () => {
    const all = seedRequests(NOW);
    expect(all.length).toBe(12);
    expect(new Set(all.map((r) => r.status))).toEqual(
      new Set(["waiting", "in_progress", "done", "declined", "cancelled"]),
    );
    for (const r of all.filter((x) => x.status === "done" || x.status === "declined")) {
      expect(r.reply?.text.length).toBeGreaterThan(20);
    }
  });
});

describe("token contrast", () => {
  const css = readFileSync(`${process.cwd()}/src/features/requests/requests.css`, "utf8");
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  it("keeps the amber pair at AA in both themes", () => {
    const pairs = [
      ...css.matchAll(/--rq-amber-bg:\s*(#[0-9a-f]{6});\s*--rq-amber-fg:\s*(#[0-9a-f]{6})/gi),
    ];
    expect(pairs.length).toBe(3);
    for (const [, bg, fg] of pairs)
      expect(ratio(bg as string, fg as string)).toBeGreaterThanOrEqual(4.5);
  });
});
