import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { activityHref } from "../src/features/activity/ActivityPage";
import { hitHref } from "../src/features/search/SearchPanel";
import { api } from "../src/lib/api";
import { renderReady, startBackend } from "./utils";

const row = (name: string) =>
  screen.getByText(name).closest('[data-testid="file-row"]') as HTMLElement;

describe("inbox", () => {
  it("lists unfiled files with their status in plain words, and the failure reason", async () => {
    await startBackend();
    await renderReady("/inbox");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    const photo = await screen.findByText("Whiteboard photo.jpeg");
    expect(photo.closest('[data-testid="file-row"]')).toHaveTextContent(
      "Waiting for an agent to transcribe it",
    );
    const locked = row("Locked notes.pdf");
    expect(locked).toHaveAttribute("data-status", "failed");
    expect(locked).toHaveTextContent("password protected");
    expect(
      within(locked).getByRole("button", { name: "Retry Locked notes.pdf" }),
    ).toBeInTheDocument();
    expect(
      within(row("Whiteboard photo.jpeg")).queryByRole("button", { name: /^Retry/ }),
    ).toBeNull();
  });

  it("retries a failed file", async () => {
    const { user } = await startBackend();
    await renderReady("/inbox");
    await screen.findByText("Locked notes.pdf");
    await user.click(
      within(row("Locked notes.pdf")).getByRole("button", { name: "Retry Locked notes.pdf" }),
    );
    await waitFor(() =>
      expect(row("Locked notes.pdf")).not.toHaveAttribute("data-status", "failed"),
    );
  });

  it("files a file under a lecture with the tree picker, and it leaves the inbox", async () => {
    const { user } = await startBackend();
    await renderReady("/inbox");
    await screen.findByText("Whiteboard photo.jpeg");
    await user.click(
      within(row("Whiteboard photo.jpeg")).getByRole("button", {
        name: /File Whiteboard photo.jpeg under/,
      }),
    );
    const sheet = await screen.findByRole("dialog", { name: /under/ });
    await user.click(await within(sheet).findByRole("button", { name: "Expand Fall 2026" }));
    await user.click(await within(sheet).findByRole("button", { name: "Expand Pharmacology II" }));
    await user.click(await within(sheet).findByRole("button", { name: "Expand Lectures" }));
    // a term is not a place for a file; a lecture is
    expect(
      within(sheet).getByRole("button", { name: "Fall 2026", description: "Not allowed here." }),
    ).toBeDisabled();
    await user.click(await within(sheet).findByRole("button", { name: "Autonomic overview" }));
    await user.click(within(sheet).getByRole("button", { name: "File here" }));
    await waitFor(() => expect(screen.queryByText("Whiteboard photo.jpeg")).toBeNull());
    const filed = (await api.allFiles()).find((f) => f.originalName === "Whiteboard photo.jpeg");
    expect(filed?.nodeId).not.toBeNull();
  });

  it("trashes a file and restores it from the trash page", async () => {
    const { user } = await startBackend();
    await renderReady("/inbox");
    await screen.findByText("Whiteboard photo.jpeg");
    await user.click(
      within(row("Whiteboard photo.jpeg")).getByRole("button", {
        name: "Actions for Whiteboard photo.jpeg",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Move to trash" }));
    await waitFor(() => expect(screen.queryByText("Whiteboard photo.jpeg")).toBeNull());
    expect((await api.trashedFiles()).map((f) => f.originalName)).toEqual([
      "Whiteboard photo.jpeg",
    ]);
  });

  it("renames a file", async () => {
    const { user } = await startBackend();
    await renderReady("/inbox");
    await screen.findByText("Whiteboard photo.jpeg");
    await user.click(
      within(row("Whiteboard photo.jpeg")).getByRole("button", {
        name: "Actions for Whiteboard photo.jpeg",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByRole("textbox", { name: "Rename Whiteboard photo.jpeg" });
    fireEvent.change(input, { target: { value: "Cardio board.jpeg" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Cardio board.jpeg")).toBeInTheDocument();
    await waitFor(async () =>
      expect((await api.allFiles()).map((f) => f.originalName)).toContain("Cardio board.jpeg"),
    );
  });

  it("says nothing about the converter while it is online", async () => {
    await startBackend();
    await renderReady("/inbox");
    await screen.findByText("Whiteboard photo.jpeg");
    expect(screen.queryByTestId("converter-notice")).toBeNull();
  });

  it("shows a quiet notice when the converter is down", async () => {
    const { fetch } = await startBackend();
    const real = fetch.getMockImplementation();
    fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/converter/status")) {
        return new Response(
          JSON.stringify({
            converter: {
              state: "offline",
              lastSeenAt: null,
              ageSeconds: null,
              queued: 2,
              processing: 0,
              heartbeat: null,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return real?.(input, init) as Promise<Response>;
    });
    await renderReady("/inbox");
    expect(await screen.findByTestId("converter-notice")).toHaveTextContent(
      /not running right now/,
    );
  });
});

describe("search and activity", () => {
  it("groups hits by kind and links each to the right place", async () => {
    await startBackend();
    await renderReady("/search?q=beta");
    const field = await screen.findByRole("searchbox", { name: "Search your library" });
    expect(field).toHaveValue("beta");
    const library = await screen.findByTestId("results-node");
    expect(within(library).getAllByRole("link").length).toBeGreaterThan(0);
    const study = await screen.findByTestId("results-block");
    expect(within(study).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/doc\/nod_.+\?block=blk_/),
    );
    const transcripts = await screen.findByTestId("results-page");
    const first = within(transcripts).getAllByRole("link")[0];
    expect(first).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/files\/fil_.+\?page=pag_.+&quote=beta$/),
    );
  });

  it("maps a search hit and an activity link to routes", () => {
    expect(
      hitHref(
        {
          kind: "block",
          documentId: "doc_1",
          nodeId: "nod_1",
          documentTitle: "T",
          blockId: "blk_1",
          blockType: "paragraph",
          snippet: "s",
        } as never,
        "q",
      ),
    ).toBe("/doc/nod_1?block=blk_1");
    expect(activityHref({ type: "file", id: "fil_1" })).toBe("/files/fil_1");
    expect(activityHref({ type: "node", id: "nod_1" })).toBe("/library/nod_1");
    expect(activityHref({ type: "document", id: "doc_1", nodeId: "nod_2" })).toBe("/doc/nod_2");
    expect(activityHref({ type: "request", id: "req_1" })).toBeNull();
  });

  it("lists what agents did, newest first, linked to the objects", async () => {
    await startBackend();
    await renderReady("/activity");
    const entries = await screen.findAllByTestId("activity-entry");
    expect(entries[0]).toHaveTextContent("Filed Lecture 07 slides.pptx under lecture 07");
    expect(entries[0]).toHaveTextContent("Claude Code");
    expect(
      within(entries[0] as HTMLElement).getByRole("link", { name: "Beta blockers" }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/library\/nod_/));
    expect(within(entries[1] as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/files\/fil_/),
    );
  });
});

describe("mount points", () => {
  it("shows coming soon where a feature module has not landed yet (requests, concepts)", async () => {
    await startBackend();
    for (const [path, title] of [
      ["/requests", "Requests"],
      ["/concepts/con_x", "Concepts"],
    ] as const) {
      const view = await renderReady(path);
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
      expect(screen.getByText("Coming soon")).toBeInTheDocument();
      view.unmount();
    }
  });
});
