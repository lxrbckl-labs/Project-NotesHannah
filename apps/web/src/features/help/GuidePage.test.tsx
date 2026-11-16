import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { GUIDE_PDF_PATH, SECTIONS, SHOWCASE, SHOWCASE_TITLE } from "./content";
import { GuidePage, GuidePrintPage } from "./GuidePage";

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

test("the guide shows every section and every showcase card", () => {
  renderAt("/help");
  expect(screen.getByRole("heading", { level: 1, name: "Guide" })).toBeInTheDocument();
  expect(screen.getByText(/Built for you, by Alex\./)).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: SHOWCASE_TITLE })).toBeInTheDocument();
  for (const item of SHOWCASE) {
    expect(screen.getByRole("heading", { level: 3, name: item.title })).toBeInTheDocument();
  }
  for (const section of SECTIONS) {
    const heading = screen.getByRole("heading", { level: 2, name: new RegExp(section.title) });
    const region = heading.closest("section");
    expect(region).toHaveAttribute("id", section.id);
  }
});

test("the second section is Finals, right after what this is", () => {
  expect(SECTIONS[0]?.id).toBe("what-this-is");
  expect(SECTIONS[1]?.title).toBe("Finals: divide and conquer");
});

test("the contents list links to every section", () => {
  renderAt("/help");
  const nav = screen.getByRole("navigation", { name: "On this page, side list", hidden: true });
  const hrefs = within(nav)
    .getAllByRole("link", { hidden: true })
    .map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual(["#what-makes-this-different", ...SECTIONS.map((s) => `#${s.id}`)]);
});

test("the download link points at the PDF asset", () => {
  renderAt("/help");
  const link = screen.getByRole("link", { name: "Download PDF" });
  expect(link).toHaveAttribute("href", GUIDE_PDF_PATH);
  expect(link).toHaveAttribute("download");
  expect(GUIDE_PDF_PATH).toBe("/guide/notes-guide.pdf");
});

test("the editor section describes the toolbar", () => {
  renderAt("/help");
  expect(screen.getByRole("heading", { name: "The toolbar" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Formatting as you type" })).toBeInTheDocument();
});

test("the print page renders the whole guide with no app around it", () => {
  renderAt("/help/print");
  expect(
    screen.getByRole("heading", { level: 1, name: "Your guide to Notes" }),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("sidebar")).toBeNull();
  for (const section of SECTIONS) {
    expect(
      screen.getByRole("heading", { level: 2, name: new RegExp(section.title) }),
    ).toBeInTheDocument();
  }
  expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
});

test("the words use no exclamation marks, em dashes or developer terms", () => {
  // The typing shortcut `!! ` is a key, not an exclamation.
  const all = JSON.stringify([SECTIONS, SHOWCASE]).replace(/`[^`]*`/g, "");
  expect(all).not.toContain("!");
  expect(all).not.toContain("—");
  for (const word of ["MCP", "schema", " node "]) expect(all).not.toContain(word);
});
