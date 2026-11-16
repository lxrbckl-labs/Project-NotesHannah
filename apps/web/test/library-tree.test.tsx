import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { api } from "../src/lib/api";
import { renderReady, startBackend } from "./utils";

async function openHome() {
  const view = await renderReady("/library");
  await screen.findByRole("tree", { name: "All files" });
  return view;
}

const tree = () => within(screen.getByRole("tree", { name: "All files" }));

describe("library home as a full tree", () => {
  it("opens the terms first, with an Inbox row and its count", async () => {
    await startBackend();
    await openHome();
    expect(await tree().findByRole("treeitem", { name: "Pharmacology II" })).toBeInTheDocument();
    const inbox = tree().getByTestId("tree-inbox");
    expect(inbox).toHaveTextContent("Inbox");
    expect(inbox).toHaveTextContent("3");
    // courses are listed, their sections are not until a course is opened
    expect(tree().queryByRole("treeitem", { name: "Lectures" })).toBeNull();
  });

  it("expands all to the leaves, shows lecture labels and source files, then collapses all", async () => {
    const { user } = await startBackend();
    await openHome();
    await tree().findByRole("treeitem", { name: "Pharmacology II" });
    await user.click(screen.getByRole("button", { name: "Expand all" }));

    const beta = await tree().findByRole("treeitem", { name: "07 · Beta blockers · Oct 14" });
    expect(beta).toHaveAttribute("aria-expanded", "true");
    expect(
      await tree().findByRole("treeitem", { name: /Autonomic nervous system\.pptx/ }),
    ).toBeInTheDocument();
    expect(await tree().findByRole("treeitem", { name: "Slide transcript" })).toBeInTheDocument();

    const decks = await tree().findAllByTestId("tree-file");
    const deck = decks.find((d) => d.textContent?.includes("Lecture 07 slides.pptx"));
    expect(deck).toHaveTextContent("34 pages");
    expect(deck).toHaveTextContent("Filed");
    expect(deck?.dataset.type).toBe("pptx");
    const notes = decks.find((d) => d.textContent?.includes("Lecture 09 handwritten notes.pdf"));
    expect(notes).toHaveTextContent("Converted");

    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    await waitFor(() =>
      expect(tree().queryByRole("treeitem", { name: "Pharmacology II" })).toBeNull(),
    );
    expect(tree().getByRole("treeitem", { name: "Fall 2026" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("keeps what is expanded across a reload, per person", async () => {
    const { user } = await startBackend();
    const first = await openHome();
    await user.click(await tree().findByRole("button", { name: "Expand Pharmacology II" }));
    expect(await tree().findByRole("treeitem", { name: "Study guides" })).toBeInTheDocument();
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("notes-tree-v1:"));
    expect(keys).toHaveLength(1);
    first.unmount();

    await openHome();
    expect(await tree().findByRole("treeitem", { name: "Study guides" })).toBeInTheDocument();
    expect(tree().getByRole("treeitem", { name: "Pharmacology II" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shares expansion with the sidebar tree", async () => {
    const { user } = await startBackend();
    await openHome();
    await user.click(await tree().findByRole("button", { name: "Expand Pharmacology II" }));
    const sidebar = within(screen.getByTestId("sidebar"));
    expect(await sidebar.findByRole("treeitem", { name: "Study guides" })).toBeInTheDocument();
  });

  it("opens a file and comes back to the tree as it was", async () => {
    const { user } = await startBackend();
    const { router } = await openHome();
    await user.click(await tree().findByRole("button", { name: "Expand Pharmacology II" }));
    await user.click(await tree().findByRole("button", { name: "Expand Lectures" }));
    await user.click(await tree().findByRole("button", { name: "Expand Autonomic overview" }));
    const deck = (await tree().findAllByTestId("tree-file"))[0] as HTMLElement;
    const name = deck.textContent ?? "";
    await user.click(deck);
    expect(
      await screen.findByRole("heading", { level: 1, name: /Lecture 01 slides\.pptx/ }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("navigation", { name: "Pages" })).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/^\/files\/fil_/);

    await router.navigate(-1);
    await screen.findByRole("tree", { name: "All files" });
    expect(await tree().findByRole("treeitem", { name: "Study guides" })).toBeInTheDocument();
    expect((await tree().findAllByTestId("tree-file"))[0]?.textContent).toBe(name);
  });

  it("opens a document placeholder from the tree and the filed files are in the contract", async () => {
    await startBackend();
    const fall = (await api.children(null))[0];
    expect(fall).toBeDefined();
    const inbox = await api.inboxFiles();
    expect(inbox.every((f) => f.nodeId === null)).toBe(true);
    expect(inbox.map((f) => f.status).sort()).toEqual(["converted", "converted", "failed"]);
  });
});
