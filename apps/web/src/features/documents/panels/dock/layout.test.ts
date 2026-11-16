import { describe, expect, it } from "vitest";
import {
  arrange,
  closedPanels,
  closePanel,
  defaultDock,
  MIN_COLUMN,
  movePanel,
  movePanelBy,
  openPanel,
  parseDock,
  setCollapsed,
  setWidth,
  sideOf,
} from "./layout";

describe("dock layout", () => {
  it("starts with the defaults per kind of screen", () => {
    expect(defaultDock("computer").left.panels).toEqual(["outline"]);
    expect(defaultDock("computer").right.panels).toEqual(["notes", "resources"]);
    expect(defaultDock("tablet-landscape").left.collapsed).toBe(true);
    expect(defaultDock("tablet-landscape").right.panels).toEqual(["notes"]);
    expect(closedPanels(defaultDock("tablet-landscape"))).toEqual(["resources"]);
  });

  it("moves a panel across, into a place, and opens the sidebar it lands in", () => {
    let s = setCollapsed(defaultDock("computer"), "left", true);
    s = movePanel(s, "notes", "left", 0);
    expect(s.left.panels).toEqual(["notes", "outline"]);
    expect(s.right.panels).toEqual(["resources"]);
    expect(s.left.collapsed).toBe(false);
  });

  it("moves down within one sidebar counting the gap it leaves", () => {
    const s = movePanel(defaultDock("computer"), "notes", "right", 2);
    expect(s.right.panels).toEqual(["resources", "notes"]);
    expect(movePanelBy(s, "notes", -1).right.panels).toEqual(["notes", "resources"]);
    expect(movePanelBy(s, "resources", -1)).toBe(s);
  });

  it("closes and reopens in its home sidebar", () => {
    let s = closePanel(defaultDock("computer"), "outline");
    expect(sideOf(s, "outline")).toBeNull();
    s = openPanel(s, "outline");
    expect(s.left.panels).toEqual(["outline"]);
  });

  it("docks while the page keeps its minimum column, the left giving way first", () => {
    const s = defaultDock("computer");
    const both = s.left.width + s.right.width;
    expect(arrange(s, "computer", MIN_COLUMN + both)).toEqual({ left: "docked", right: "docked" });
    expect(arrange(s, "computer", MIN_COLUMN + both - 1)).toEqual({
      left: "auto",
      right: "docked",
    });
    expect(arrange(s, "computer", MIN_COLUMN + 10)).toEqual({ left: "auto", right: "auto" });
    expect(arrange(s, "phone", 2000)).toEqual({ left: "hidden", right: "hidden" });
    const upright = setCollapsed(defaultDock("tablet-portrait"), "right", false);
    expect(arrange(upright, "tablet-portrait", 2000)).toEqual({ left: "hidden", right: "auto" });
  });

  it("keeps widths in bounds and reads back only sensible saved state", () => {
    expect(setWidth(defaultDock("computer"), "left", 9999).left.width).toBe(440);
    const parsed = parseDock(
      { left: { panels: ["notes", "bogus", "notes"], width: 10 }, right: { panels: ["notes"] } },
      "computer",
    );
    expect(parsed.left.panels).toEqual(["notes"]);
    expect(parsed.left.width).toBe(240);
    expect(parsed.right.panels).toEqual([]);
    expect(parseDock("nonsense", "computer")).toEqual(defaultDock("computer"));
  });
});
