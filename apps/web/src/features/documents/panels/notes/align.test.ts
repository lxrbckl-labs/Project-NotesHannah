import { describe, expect, it } from "vitest";
import { GAP, stack } from "./align";

describe("stacking side notes", () => {
  const items = [
    { id: "a", anchor: 100, height: 80 },
    { id: "b", anchor: 120, height: 60 },
    { id: "c", anchor: 400, height: 40 },
  ];

  it("sits each card at its block and pushes overlapping ones down", () => {
    const tops = stack(items, null);
    expect(tops.get("a")).toBe(100);
    expect(tops.get("b")).toBe(100 + 80 + GAP);
    expect(tops.get("c")).toBe(400);
  });

  it("keeps the focused card exactly level and moves its neighbours out of the way", () => {
    const tops = stack(items, "b");
    expect(tops.get("b")).toBe(120);
    expect(tops.get("a")).toBe(120 - 80 - GAP);
    expect(tops.get("c")).toBe(400);
  });

  it("never overlaps, whatever the order given", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, anchor: 50, height: 30 }));
    const tops = [...stack(many.reverse(), "n3").values()].sort((x, y) => x - y);
    for (let i = 1; i < tops.length; i++)
      expect(tops[i] as number).toBeGreaterThanOrEqual((tops[i - 1] as number) + 30 + GAP);
  });
});
