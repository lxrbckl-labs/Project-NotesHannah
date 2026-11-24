import { describe, expect, it } from "vitest";
import {
  activateTab,
  closeTab,
  inAppPath,
  initialTabs,
  MAX_TABS,
  openTab,
  parseTabs,
  setActivePath,
  setTitle,
  titleForPath,
} from "./model";

describe("open tabs", () => {
  it("starts with one tab on the page she is on", () => {
    const s = initialTabs("/practice");
    expect(s.tabs).toEqual([{ id: "t1", path: "/practice", title: "Practice" }]);
    expect(s.active).toBe("t1");
  });

  it("opens a new tab right after the active one and shows it", () => {
    let s = openTab(initialTabs("/library"), "/calendar");
    s = activateTab(s, "t1");
    s = openTab(s, "/inbox");
    expect(s.tabs.map((t) => t.path)).toEqual(["/library", "/inbox", "/calendar"]);
    expect(s.active).toBe("t3");
  });

  it("opens a tab behind the current page when asked, with the link's name", () => {
    const s = openTab(initialTabs("/library"), "/doc/nod_1", {
      activate: false,
      title: " Renal dosing ",
    });
    expect(s.active).toBe("t1");
    expect(s.tabs[1]).toEqual({ id: "t2", path: "/doc/nod_1", title: "Renal dosing" });
  });

  it("refuses a tab past the limit", () => {
    let s = initialTabs("/library");
    for (let i = 0; i < MAX_TABS + 3; i++) s = openTab(s, "/search");
    expect(s.tabs).toHaveLength(MAX_TABS);
  });

  it("never closes the last tab", () => {
    const s = initialTabs("/library");
    expect(closeTab(s, "t1")).toBe(s);
  });

  it("closing the active tab shows its right neighbour, or the left one at the end", () => {
    let s = openTab(openTab(initialTabs("/library"), "/calendar"), "/inbox"); // t1 t2 t3, active t3
    s = activateTab(s, "t2");
    expect(closeTab(s, "t2").active).toBe("t3");
    expect(closeTab(activateTab(s, "t3"), "t3").active).toBe("t2");
    expect(closeTab(s, "t1").active).toBe("t2");
  });

  it("never reuses the id of a closed tab while others are open", () => {
    let s = openTab(initialTabs("/library"), "/calendar");
    s = closeTab(s, "t1");
    s = openTab(s, "/inbox");
    expect(s.tabs.map((t) => t.id)).toEqual(["t2", "t3"]);
  });

  it("follows the active tab to a new address and drops the old heading", () => {
    let s = setTitle(initialTabs("/library"), "t1", "My library");
    s = setActivePath(s, "/library?sort=name");
    expect(s.tabs[0]?.title).toBe("My library");
    s = setActivePath(s, "/doc/nod_9");
    expect(s.tabs[0]).toEqual({ id: "t1", path: "/doc/nod_9", title: "Document" });
  });

  it("names a page from its first path segment", () => {
    expect(titleForPath("/help#shortcuts")).toBe("Guide");
    expect(titleForPath("/")).toBe("Notes");
  });

  it("reads back what it saved and drops anything odd", () => {
    const s = openTab(initialTabs("/library"), "/calendar");
    expect(parseTabs(JSON.stringify(s))).toEqual(s);
    expect(parseTabs("not json")).toBeNull();
    expect(parseTabs(JSON.stringify({ tabs: [], active: "t1" }))).toBeNull();
    const odd = {
      tabs: [
        { id: "t1", path: "//evil.example", title: "x" },
        { id: "t2", path: "/inbox", title: "Inbox" },
      ],
      active: "t1",
    };
    expect(parseTabs(JSON.stringify(odd))).toEqual({
      tabs: [{ id: "t2", path: "/inbox", title: "Inbox" }],
      active: "t2",
    });
  });

  it("takes only links to pages of this app", () => {
    const origin = "https://notes.example";
    expect(inAppPath("/doc/nod_1?x=1#b", origin)).toBe("/doc/nod_1?x=1#b");
    expect(inAppPath("https://notes.example/library", origin)).toBe("/library");
    expect(inAppPath("https://other.example/library", origin)).toBeNull();
    expect(inAppPath("/api/files/1/original", origin)).toBeNull();
    expect(inAppPath("mailto:a@b.c", origin)).toBeNull();
  });
});
