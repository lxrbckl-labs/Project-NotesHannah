import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import {
  FIGURES,
  type FigureId,
  GUIDE_PDF_PATH,
  PARTS,
  QUICK_REFERENCE,
  QUICK_REFERENCE_ID,
  SECTIONS,
  SHOWCASE,
  SHOWCASE_TITLE,
  TYPING_SHORTCUTS,
} from "./content";
import FIGURE_SIZES from "./figures.json";
import { GuidePage, GuidePrintPage } from "./GuidePage";
import { edition, PAGE_RULES } from "./GuidePrint";
import { FIGURE_NUMBER, OUTLINE_SECTIONS, SHOWCASE_ID } from "./outline";

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/help", element: <GuidePage /> },
      { path: "/help/print", element: <GuidePrintPage /> },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

test("the guide shows every part, section and showcase card", () => {
  renderAt("/help");
  expect(
    screen.getByRole("heading", { level: 1, name: "Your guide to Notes" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Built for you, by Alex.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: SHOWCASE_TITLE })).toBeInTheDocument();
  for (const item of SHOWCASE) {
    expect(screen.getByRole("heading", { level: 3, name: item.title })).toBeInTheDocument();
  }
  for (const part of PARTS) {
    expect(screen.getByRole("heading", { level: 2, name: part.title })).toBeInTheDocument();
  }
  for (const section of SECTIONS) {
    const heading = screen.getByRole("heading", { level: 2, name: section.title });
    expect(heading.closest("section")).toHaveAttribute("id", section.id);
  }
});

test("every section is in exactly one part, in reading order", () => {
  expect(PARTS).toHaveLength(4);
  expect(PARTS.flatMap((p) => p.sections)).toEqual(SECTIONS.map((s) => s.id));
  expect(OUTLINE_SECTIONS.map((s) => s.number)).toEqual(SECTIONS.map((_, i) => i + 1));
  expect(SECTIONS[0]?.id).toBe("what-this-is");
  expect(SECTIONS[1]?.title).toBe("Finals: divide and conquer");
  for (const section of SECTIONS) expect(section.lead.length).toBeGreaterThan(10);
});

test("every figure is used once, numbered in order, with a caption and a committed size", () => {
  const used = SECTIONS.flatMap((s) => s.blocks).flatMap((b) =>
    b.kind === "figure" ? [b.id] : [],
  );
  expect(new Set(used).size).toBe(used.length);
  expect([...used].sort()).toEqual(Object.keys(FIGURES).sort());
  expect(used.map((id) => FIGURE_NUMBER[id])).toEqual(used.map((_, i) => i + 1));
  for (const id of used as FigureId[]) {
    const figure = FIGURES[id];
    expect(figure.src).toBe(`/guide/figures/${id}.webp`);
    expect(figure.width).toBe(FIGURE_SIZES[id].width);
    expect(figure.caption.length).toBeGreaterThan(20);
    expect(figure.alt.length).toBeGreaterThan(20);
  }
});

test("figures show with their number and open larger when tapped", async () => {
  const user = userEvent.setup();
  renderAt("/help");
  const figure = document.querySelector('[data-figure="source-page"]') as HTMLElement;
  expect(within(figure).getByText("Figure 3")).toBeInTheDocument();
  expect(within(figure).getByRole("img")).toHaveAttribute("src", "/guide/figures/source-page.webp");
  await user.click(within(figure).getByRole("button", { name: "Enlarge Figure 3" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByTestId("guide-figure-zoom")).toBeInTheDocument();
  expect(within(dialog).getByText(FIGURES["source-page"].caption)).toBeInTheDocument();
});

test("the side contents list links to everything, grouped by part", () => {
  renderAt("/help");
  const nav = screen.getByRole("navigation", { name: "On this page, side list", hidden: true });
  const hrefs = within(nav)
    .getAllByRole("link", { hidden: true })
    .map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual([
    `#${SHOWCASE_ID}`,
    ...SECTIONS.map((s) => `#${s.id}`),
    `#${QUICK_REFERENCE_ID}`,
  ]);
  for (const part of PARTS) {
    expect(within(nav).getByText(`${part.label} · ${part.title}`)).toBeInTheDocument();
  }
});

test("the narrow contents bar shows the current section and opens the list", async () => {
  const user = userEvent.setup();
  renderAt("/help");
  const button = screen.getByRole("button", { name: /On this page/ });
  expect(button).toHaveAttribute("aria-expanded", "false");
  await user.click(button);
  const nav = screen.getByRole("navigation", { name: "On this page" });
  await user.click(within(nav).getByRole("link", { name: /Exams/ }));
  expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
});

test("the download link points at the PDF asset", () => {
  renderAt("/help");
  const link = screen.getByRole("link", { name: "Download PDF" });
  expect(link).toHaveAttribute("href", GUIDE_PDF_PATH);
  expect(link).toHaveAttribute("download");
  expect(GUIDE_PDF_PATH).toBe("/guide/notes-guide.pdf");
});

test("the quick reference holds every typing shortcut and key", () => {
  renderAt("/help");
  const section = document.getElementById(QUICK_REFERENCE_ID) as HTMLElement;
  for (const group of QUICK_REFERENCE) {
    expect(within(section).getByRole("heading", { name: group.title })).toBeInTheDocument();
  }
  expect(QUICK_REFERENCE[0]?.rows).toBe(TYPING_SHORTCUTS.rows);
  for (const [, meaning] of TYPING_SHORTCUTS.rows) {
    expect(within(section).getByText(meaning as string)).toBeInTheDocument();
  }
});

test("the editor section describes the toolbar", () => {
  renderAt("/help");
  expect(screen.getByRole("heading", { name: "The toolbar" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Formatting as you type" })).toBeInTheDocument();
});

test("the print page is a booklet: cover, contents, parts, sections, quick reference", () => {
  renderAt("/help/print");
  expect(
    screen.getByRole("heading", { level: 1, name: "Your guide to Notes" }),
  ).toBeInTheDocument();
  expect(screen.getByText(edition())).toBeInTheDocument();
  expect(screen.queryByTestId("sidebar")).toBeNull();
  const contents = screen.getByRole("navigation", { name: "Contents" });
  for (const section of SECTIONS) {
    expect(screen.getByRole("heading", { level: 2, name: section.title })).toBeInTheDocument();
    expect(within(contents).getByRole("link", { name: new RegExp(section.title) })).toHaveAttribute(
      "href",
      `#${section.id}`,
    );
    expect(document.querySelectorAll(`[data-page-of="${section.id}"]`)).toHaveLength(2);
  }
  expect(document.querySelectorAll(".gp-part")).toHaveLength(PARTS.length);
  expect(document.getElementById(QUICK_REFERENCE_ID)).not.toBeNull();
  expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Enlarge/ })).toBeNull();
});

test("each section prints on its own named page with a running head", () => {
  OUTLINE_SECTIONS.forEach(({ section, number, part }) => {
    expect(PAGE_RULES).toContain(`@page gp-s${number} {`);
    expect(PAGE_RULES).toContain(`#${section.id} { page: gp-s${number}; }`);
    expect(PAGE_RULES).toContain(`"${part.label} · ${part.title}"`);
  });
  expect(edition(new Date(2026, 10, 16))).toBe("November 2026");
});

test("the words use no exclamation marks, em dashes or developer terms", () => {
  // The typing shortcut `!! ` is a key, not an exclamation.
  const all = JSON.stringify([SECTIONS, SHOWCASE, PARTS, FIGURES, QUICK_REFERENCE]).replace(
    /`[^`]*`/g,
    "",
  );
  expect(all).not.toContain("!");
  expect(all).not.toContain("—");
  for (const word of ["MCP", "schema", " node "]) expect(all).not.toContain(word);
});
