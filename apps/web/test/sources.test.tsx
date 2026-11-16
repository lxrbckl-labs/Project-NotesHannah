import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { createQueryClient, Providers } from "../src/app/providers";
import { segmentText } from "../src/features/sources/highlight";
import { SourceViewer } from "../src/features/sources/SourceViewer";
import { api } from "../src/lib/api";
import { renderReady, startBackend } from "./utils";

async function slides7() {
  const files = await api.allFiles();
  const file = files.find((f) => f.originalName === "Lecture 07 slides.pptx");
  if (!file) throw new Error("seed");
  const pages = await api.pagesOf(file.id);
  return { file, pages };
}

describe("highlight", () => {
  it("cuts a transcript at flags and at a cited quote, tolerating whitespace changes", () => {
    const text = "Metoprolol 50 mg PO BID\nTitrate slowly.";
    const segs = segmentText(text, [{ kind: "dose", quote: "50 mg", note: "check" }], "PO  BID");
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.find((s) => s.flag)?.text).toBe("50 mg");
    expect(segs.find((s) => s.quoted)?.text).toBe("PO BID");
    expect(segmentText("plain", [], "absent")).toEqual([{ text: "plain" }]);
    // a search term matches without regard to case
    expect(segmentText("Metoprolol 50 mg", [], "metoprolol")[0]).toEqual({
      text: "Metoprolol",
      quoted: true,
    });
  });
});

describe("source viewer", () => {
  it("shows the page, thumbnails, the transcript with flags, and moves between pages", async () => {
    const { user } = await startBackend();
    const { file, pages } = await slides7();
    await renderReady(`/files/${file.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Lecture 07 slides.pptx" }),
    ).toBeInTheDocument();
    const nav = await screen.findByRole("navigation", { name: "Pages" });
    expect(within(nav).getAllByTestId("thumb")).toHaveLength(pages.length);
    expect(screen.getByTestId("page-position")).toHaveTextContent(`Page 1 of ${pages.length}`);
    expect(screen.getByRole("img", { name: "Page 1" })).toHaveAttribute(
      "src",
      expect.stringMatching(/\/api\/pages\/pag_[A-Z0-9]+\/image\?size=page/),
    );

    const text = await screen.findByTestId("transcript-text");
    expect(text).toHaveTextContent("Metoprolol");
    const marks = text.querySelectorAll("mark[data-flag]");
    expect([...marks].map((m) => m.getAttribute("data-flag"))).toEqual(
      expect.arrayContaining(["dose", "drug_name"]),
    );
    expect(
      within(screen.getByRole("region", { name: "Flags" })).getAllByTestId("flag-note").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Check the dose against the slide.")).toBeInTheDocument();
    // native text and speaker notes
    expect(screen.getByText("Text from the file")).toBeInTheDocument();
    expect(screen.getByText(/start low and go slow/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByTestId("page-position")).toHaveTextContent("Page 2 of");
  });

  it("marks the transcript reviewed, and takes the review back", async () => {
    const { user } = await startBackend();
    const { file } = await slides7();
    await renderReady(`/files/${file.id}`);
    expect(await screen.findByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText(/nobody has checked this/i)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Mark as reviewed" }));
    expect(await screen.findByText("Reviewed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take back review" }));
    expect(await screen.findByText("Unverified")).toBeInTheDocument();
  });

  it("shows revision history and restores an older revision as a new one", async () => {
    const { user } = await startBackend();
    const { file } = await slides7();
    await renderReady(`/files/${file.id}`);
    await user.click(await screen.findByRole("button", { name: /History/ }));
    const list = await screen.findByTestId("revision-list");
    const revisions = within(list).getAllByTestId("revision");
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toHaveTextContent("Revision 2");
    expect(revisions[0]).toHaveTextContent("current");

    await user.click(within(list).getByRole("button", { name: "View" }));
    expect(await screen.findByText(/Viewing revision 1/)).toBeInTheDocument();
    expect(screen.getByTestId("transcript-text")).toHaveTextContent("5O mg");
    await user.click(screen.getByRole("button", { name: "Back to current" }));

    await user.click(within(list).getByRole("button", { name: "Restore revision 1" }));
    await waitFor(() =>
      expect(within(screen.getByTestId("revision-list")).getAllByTestId("revision")).toHaveLength(
        3,
      ),
    );
    expect(screen.getByTestId("transcript-text")).toHaveTextContent("5O mg");
  });

  it("opens at a deep-linked page and highlights a quote", async () => {
    await startBackend();
    const { file, pages } = await slides7();
    const second = pages[1];
    if (!second) throw new Error("seed");
    render(
      <Providers client={createQueryClient()}>
        <MemoryRouter>
          <SourceViewer
            fileId={file.id}
            pageId={second.id}
            highlightQuote="PO BID"
            region={{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }}
          />
        </MemoryRouter>
      </Providers>,
    );
    expect(await screen.findByTestId("page-position")).toHaveTextContent("Page 2 of");
    const quoted = await screen.findByTestId("transcript-text");
    await waitFor(() =>
      expect(quoted.querySelector("mark[data-quote]")?.textContent).toBe("PO BID"),
    );
    fireEvent.load(screen.getByRole("img", { name: "Page 2" }));
    expect(await screen.findByTestId("region")).toHaveStyle({ left: "10%", width: "30%" });
  });

  it("says nothing is transcribed yet, and explains a file that is not ready", async () => {
    await startBackend();
    const files = await api.allFiles();
    const untranscribed = files.find((f) => f.originalName === "Lecture 08 handwritten notes.pdf");
    if (!untranscribed) throw new Error("seed");
    const view = await renderReady(`/files/${untranscribed.id}`);
    expect(await screen.findByText("Nothing transcribed yet")).toBeInTheDocument();
    view.unmount();

    const locked = files.find((f) => f.originalName === "Locked notes.pdf");
    if (!locked) throw new Error("seed");
    await renderReady(`/files/${locked.id}`);
    expect(await screen.findByText("This file could not be converted")).toBeInTheDocument();
    expect(screen.getByText(/password protected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry conversion" })).toBeInTheDocument();
  });

  it("offers the original for download", async () => {
    await startBackend();
    const { file } = await slides7();
    await renderReady(`/files/${file.id}`);
    const link = await screen.findByRole("link", { name: /Download original/ });
    expect(link).toHaveAttribute("href", `/api/files/${file.id}/original?download=true`);
  });

  it("shows a single image as one page with its details and no strip or pager", async () => {
    await startBackend();
    const files = await api.allFiles();
    const photo = files.find((f) => f.originalName === "Whiteboard photo.jpeg");
    if (!photo) throw new Error("seed");
    await renderReady(`/files/${photo.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Whiteboard photo.jpeg" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Page 1" })).toBeInTheDocument();
    // one page: nothing to pick between
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-position")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
    // the file details name the original type and size
    expect(screen.getByTestId("file-details")).toHaveTextContent(/Original: JPEG photo, /);
    expect(screen.getByText("1 page")).toBeInTheDocument();
  });
});
