import type { BlockOf } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { guideDocument } from "../store/fixture";
import {
  buildReferenceIndex,
  flagRanges,
  locateQuote,
  looseFlags,
  markerCitation,
  segmentTranscript,
} from "./references";

describe("references numbering (K2, K7)", () => {
  const doc = guideDocument();
  const index = buildReferenceIndex(doc.blocks);

  it("numbers from 1 in order of first appearance, without gaps", () => {
    expect(index.references.map((r) => r.number)).toEqual(index.references.map((_, i) => i + 1));
    expect(index.references[0]?.citation).toEqual(doc.blocks[0]?.citations[0]);
  });

  it("gives the same passage one number wherever it is cited", () => {
    const keys = index.references.map((r) => `${r.citation.pageId}|${r.citation.quote}`);
    expect(new Set(keys).size).toBe(keys.length);
    const definition = doc.blocks[0] as BlockOf<"callout">;
    const card = doc.blocks.find((b) => b.type === "drug_card") as BlockOf<"drug_card">;
    const mechanism = card.content.mechanism?.citations[0];
    if (!mechanism) throw new Error("fixture");
    expect(index.numberOf(mechanism)).toBe(index.numberOf(definition.citations[0] as never));
    const ref = index.byNumber(index.numberOf(mechanism));
    expect(ref?.uses.map((u) => u.field)).toEqual([null, "$.content.mechanism"]);
  });

  it("lists field citations after the block's own, in reading order", () => {
    const card = doc.blocks.find((b) => b.type === "drug_card") as BlockOf<"drug_card">;
    const own = index.numberOf(card.citations[0] as never);
    const drugClass = index.numberOf(card.content.drugClass?.citations[0] as never);
    expect(own).toBeGreaterThan(0);
    expect(drugClass).toBeGreaterThan(0);
  });

  it("resolves a marker against the field's list first, then the block's", () => {
    const block = { citations: [{ quote: "block" }] } as never;
    expect(markerCitation(block, { citations: [{ quote: "field" }] } as never, 1)).toEqual({
      quote: "field",
    });
    expect(markerCitation(block, { citations: [] } as never, 1)).toEqual({ quote: "block" });
    expect(markerCitation(block, undefined, 2)).toBeUndefined();
  });
});

describe("citation panel highlight", () => {
  const text =
    "Title\nCardioselective agents (atenolol, metoprolol)\npreferentially block β1 receptors.\nMore.";

  it("finds an exact quote", () => {
    expect(locateQuote("abc def", "def")).toEqual({ start: 4, end: 7, loose: false });
  });

  it("finds a quote across a line break as a loose match", () => {
    const range = locateQuote(text, "metoprolol) preferentially block");
    expect(range?.loose).toBe(true);
    expect(text.slice(range?.start, range?.end)).toBe("metoprolol)\npreferentially block");
  });

  it("returns null when the quote is not there", () => {
    expect(locateQuote(text, "propranolol")).toBeNull();
    expect(locateQuote(text, "   ")).toBeNull();
  });

  it("segments the transcript around the highlighted passage", () => {
    expect(segmentTranscript("one two three", "two")).toEqual([
      { text: "one ", highlight: false },
      { text: "two", highlight: true },
      { text: " three", highlight: false },
    ]);
    expect(segmentTranscript("one", "one")).toEqual([{ text: "one", highlight: true }]);
    expect(segmentTranscript("one", "zzz")).toEqual([{ text: "one", highlight: false }]);
    expect(segmentTranscript("", null)).toEqual([]);
  });
});

describe("flags on text", () => {
  it("places flags on their quoted words, skipping overlaps and missing quotes", () => {
    const flags = [
      { kind: "dose" as const, quote: "25 mg" },
      { kind: "unit" as const, quote: "mg" },
      { kind: "uncertain" as const, quote: "absent" },
      { kind: "illegible" as const },
    ];
    expect(flagRanges("Start 25 mg BID", flags)).toEqual([
      { start: 6, end: 11, flag: flags[0], index: 0 },
    ]);
    expect(looseFlags(flags, ["Start 25 mg BID"])).toEqual([flags[2], flags[3]]);
  });
});
