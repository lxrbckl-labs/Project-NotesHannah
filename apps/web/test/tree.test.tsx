import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { moveBlockedReason, toDestination } from "../src/features/library/rules";
import { api } from "../src/lib/api";
import { findByName, renderReady, startBackend } from "./utils";

const sidebar = () => within(screen.getByTestId("sidebar"));

async function pharm2Ids() {
  const fall = await findByName("Fall 2026");
  const course = await findByName("Pharmacology II", fall.id);
  const sections = await api.children(course.id);
  const lectures = sections.find((s) => s.section === "lectures");
  if (!lectures) throw new Error("no lectures");
  const list = await api.children(lectures.id);
  return { fall, course, sections, lectures, list };
}

describe("sidebar tree", () => {
  it("loads children lazily when a node is expanded, and collapses again", async () => {
    const { user, fetch } = await startBackend();
    await renderReady("/trash");
    expect(await sidebar().findByRole("treeitem", { name: "Fall 2026" })).toBeInTheDocument();
    const fallId = (await findByName("Fall 2026")).id;
    const loadedChildren = () =>
      fetch.mock.calls.filter(([url]) => String(url).includes(`parentId=${fallId}`)).length;
    expect(loadedChildren()).toBe(0);

    await user.click(sidebar().getByRole("button", { name: "Expand Fall 2026" }));
    expect(await sidebar().findByRole("treeitem", { name: "Pharmacology II" })).toBeInTheDocument();
    expect(loadedChildren()).toBe(1);
    expect(sidebar().getByRole("treeitem", { name: "Fall 2026" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.click(sidebar().getByRole("button", { name: "Collapse Fall 2026" }));
    expect(sidebar().queryByRole("treeitem", { name: "Pharmacology II" })).toBeNull();
  });

  it("highlights the current item, opens its ancestors, and labels lectures", async () => {
    await startBackend();
    const { list } = await pharm2Ids();
    const beta = list[6];
    await renderReady(`/library/${beta?.id}`);
    const current = await sidebar().findByRole("treeitem", { name: "07 · Beta blockers · Oct 14" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("aria-level", "4");
    expect(sidebar().getByRole("treeitem", { name: "Lectures" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(sidebar().getByRole("treeitem", { name: "Pharmacology II" })).toBeInTheDocument();
    expect(sidebar().getAllByRole("treeitem", { name: /^0\d · / }).length).toBe(9);
  });

  it("moves through the tree with the arrow keys and opens with Enter", async () => {
    const { user } = await startBackend();
    const { router } = await renderReady("/trash");
    const fall = await sidebar().findByRole("treeitem", { name: "Fall 2026" });
    fall.focus();
    await user.keyboard("{ArrowRight}");
    const course = await sidebar().findByRole("treeitem", { name: "Pharmacology II" });
    await user.keyboard("{ArrowDown}");
    expect(course).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/library\/nod_/));
    await user.keyboard("{ArrowLeft}");
    expect(fall).toHaveFocus();
  });

  it("renames in place with F2, optimistically, and the server keeps it", async () => {
    const { user } = await startBackend();
    await renderReady("/library");
    const item = await sidebar().findByRole("treeitem", { name: "Spring 2027" });
    item.focus();
    await user.keyboard("{F2}");
    const input = await sidebar().findByRole("textbox", { name: "Rename Spring 2027" });
    await user.clear(input);
    await user.type(input, "Spring 2028{Enter}");
    expect(await sidebar().findByRole("treeitem", { name: "Spring 2028" })).toBeInTheDocument();
    await waitFor(async () =>
      expect((await api.children(null)).map((n) => n.name)).toContain("Spring 2028"),
    );
  });

  it("rolls a rename back and shows the server's message and hint when it fails", async () => {
    const { user, fetch } = await startBackend();
    await renderReady("/library");
    const real = fetch.getMockImplementation();
    fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(
          JSON.stringify({
            error: {
              code: "conflict",
              message: "Someone else changed this.",
              hint: "Reload and try again.",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return real?.(input, init) as Promise<Response>;
    });
    const item = await sidebar().findByRole("treeitem", { name: "Spring 2027" });
    item.focus();
    await user.keyboard("{F2}");
    const input = await sidebar().findByRole("textbox", { name: "Rename Spring 2027" });
    await user.clear(input);
    await user.type(input, "Broken{Enter}");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Someone else changed this.");
    expect(alert).toHaveTextContent("Reload and try again.");
    expect(await sidebar().findByRole("treeitem", { name: "Spring 2027" })).toBeInTheDocument();
    expect(sidebar().queryByRole("treeitem", { name: "Broken" })).toBeNull();
  });
});

describe("creating in the library", () => {
  it("creates a course in a term and shows its five sections", async () => {
    const { user } = await startBackend();
    const fall = await findByName("Fall 2026");
    await renderReady(`/library/${fall.id}`);
    await screen.findByRole("heading", { level: 1, name: "Fall 2026" });
    await user.click(screen.getByRole("button", { name: "New course" }));
    const dialog = await screen.findByRole("dialog", { name: "New course" });
    await user.type(within(dialog).getByLabelText("Name", { exact: true }), "Biochemistry");
    await user.type(within(dialog).getByLabelText(/Course code/), "PHAR 7300");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Biochemistry" }),
    ).toBeInTheDocument();
    const sections = await screen.findByRole("list", { name: "Sections" });
    expect(
      within(sections)
        .getAllByRole("link")
        .map((l) => l.textContent?.split("Section")[0]),
    ).toEqual(["Sources", "Lectures", "Study guides", "Practice", "Exams"]);
  });

  it("offers only what a parent can hold: a term takes courses, a section takes folders, lectures and documents", async () => {
    await startBackend();
    const { fall, lectures } = await pharm2Ids();
    const first = await renderReady(`/library/${fall.id}`);
    await screen.findByRole("heading", { level: 1, name: "Fall 2026" });
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("button", { name: "New course" })).toBeInTheDocument();
    expect(main.queryByRole("button", { name: "New lecture" })).toBeNull();
    first.unmount();

    await renderReady(`/library/${lectures.id}`);
    await screen.findByRole("heading", { level: 1, name: "Lectures" });
    const inSection = within(screen.getByRole("main"));
    expect(inSection.getByRole("button", { name: "New folder" })).toBeInTheDocument();
    expect(inSection.getByRole("button", { name: "New lecture" })).toBeInTheDocument();
    expect(inSection.getByRole("button", { name: "New document" })).toBeInTheDocument();
    expect(inSection.queryByRole("button", { name: "New course" })).toBeNull();
  });

  it("creates a lecture with the next number and a date", async () => {
    const { user } = await startBackend();
    const { lectures } = await pharm2Ids();
    await renderReady(`/library/${lectures.id}`);
    await screen.findByText("09 · Diuretics · Oct 28");
    await user.click(screen.getByRole("button", { name: "New lecture" }));
    const dialog = await screen.findByRole("dialog", { name: "New lecture" });
    expect(within(dialog).getByLabelText("Number")).toHaveValue(10);
    await user.type(within(dialog).getByLabelText("Name", { exact: true }), "Vasodilators");
    fireEvent.change(within(dialog).getByLabelText("Date taught"), {
      target: { value: "2026-11-04" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("10 · Vasodilators · Nov 4")).toBeInTheDocument();
  });

  it("shows a lecture page with a place for her notes, and breadcrumbs", async () => {
    await startBackend();
    const { list } = await pharm2Ids();
    await renderReady(`/library/${list[6]?.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "07 · Beta blockers · Oct 14" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("No notes of your own yet")).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    await waitFor(() =>
      expect(within(crumbs).getByRole("link", { name: "Pharmacology II" })).toBeInTheDocument(),
    );
    expect(within(crumbs).getByRole("link", { name: "Lectures" })).toBeInTheDocument();
  });

  it("gives sections no rename, move, duplicate or trash", async () => {
    const { user } = await startBackend();
    const { lectures } = await pharm2Ids();
    await renderReady(`/library/${lectures.id}`);
    await screen.findByRole("heading", { level: 1, name: "Lectures" });
    await user.click(screen.getByRole("button", { name: "More actions for Lectures" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: /Rename|Duplicate|Move|trash/i }),
    ).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: /favourites/ })).toBeInTheDocument();
  });
});

describe("move rules in the picker", () => {
  it("disables invalid destinations and enables valid ones", async () => {
    const { user } = await startBackend();
    const { list, fall } = await pharm2Ids();
    const other = await findByName("Pharmacotherapy I", fall.id);
    const otherLectures = (await api.children(other.id)).find((s) => s.section === "lectures");

    const target = list[1];
    await renderReady(`/library/${target?.id}`);
    await screen.findByRole("heading", { level: 1, name: "02 · Cholinergic agents · Sep 2" });
    await user.click(screen.getByRole("button", { name: "More actions for Cholinergic agents" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog", { name: /Move "Cholinergic agents"/ });
    // its own place is open; a different course's Lectures section is a valid destination
    await user.click(
      await within(dialog).findByRole("button", { name: "Expand Pharmacotherapy I" }),
    );
    const destination = await within(dialog).findAllByRole("button", { name: /^Lectures/ });
    const states = destination.map((b) => (b as HTMLButtonElement).disabled);
    expect(states).toContain(true); // the section it is already in
    expect(states).toContain(false); // the other course's lectures
    expect(
      within(dialog).getByRole("button", {
        name: "Pharmacotherapy I",
        description: "Not allowed here.",
      }),
    ).toBeDisabled();
    expect(otherLectures).toBeDefined();
  });

  it("encodes the same rules as the server", async () => {
    await startBackend();
    const { fall, course, lectures, list } = await pharm2Ids();
    const lecture = list[0];
    if (!lecture) throw new Error("seed");
    const asLectures = toDestination(lectures, 0);
    expect(moveBlockedReason(lecture, asLectures)).toBeNull();
    expect(moveBlockedReason(lecture, toDestination(course, 0))).toBe("Not allowed here.");
    expect(moveBlockedReason(lecture, null)).toBe("Not allowed here.");
    // a course may go into a term, never into itself or beneath itself
    expect(moveBlockedReason(course, toDestination(fall, 0))).toBeNull();
    expect(moveBlockedReason(fall, toDestination(course, 0))).toBe(
      "Cannot move something into itself.",
    );
    expect(moveBlockedReason(course, toDestination(lectures, 0))).not.toBeNull();
    // sections never move
    expect(moveBlockedReason(lectures, toDestination(course, 0))).toBe("Sections cannot be moved.");
    // folders: two deep at most
    const folder = { ...lecture, kind: "folder" as const };
    expect(moveBlockedReason(folder, { ...toDestination(lectures, 0) })).toBeNull();
    expect(
      moveBlockedReason(folder, { id: "nod_x", kind: "folder", folderDepth: 1, ancestors: [] }),
    ).toBeNull();
    expect(
      moveBlockedReason(folder, { id: "nod_x", kind: "folder", folderDepth: 2, ancestors: [] }),
    ).toBe("Folders can only nest two deep.");
  });

  it("moves a lecture to another course through the sheet", async () => {
    const { user } = await startBackend();
    const { list, fall } = await pharm2Ids();
    const other = await findByName("Pharmacotherapy I", fall.id);
    const otherLectures = (await api.children(other.id)).find((s) => s.section === "lectures");
    const lecture = list[1];
    await renderReady(`/library/${lecture?.id}`);
    await screen.findByRole("heading", { level: 1, name: "02 · Cholinergic agents · Sep 2" });
    await user.click(screen.getByRole("button", { name: "More actions for Cholinergic agents" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      await within(dialog).findByRole("button", { name: "Expand Pharmacotherapy I" }),
    );
    const lecturesButtons = await within(dialog).findAllByRole("button", { name: /^Lectures/ });
    const enabled = lecturesButtons.find((b) => !(b as HTMLButtonElement).disabled);
    if (!enabled) throw new Error("no valid destination");
    await user.click(enabled);
    await user.click(within(dialog).getByRole("button", { name: "Move here" }));
    await waitFor(async () => {
      const moved = await api.children(otherLectures?.id ?? null);
      expect(moved.some((n) => n.id === lecture?.id)).toBe(true);
    });
  });
});
