import { UPLOAD_LIMITS } from "@notes/schema";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ACCEPT, ACCEPT_EXTENSIONS, ACCEPT_MIME } from "../src/features/uploads/accept";
import { UploadManager } from "../src/features/uploads/manager";
import { ApiClientError, setUploadTransport, type UploadTransport } from "../src/lib/api";
import { uploadFailure } from "../src/lib/messages";
import { renderReady, startBackend } from "./utils";

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

/** A transport the test controls: resolve, fail or watch progress by hand. */
function controlled() {
  const calls: Array<{
    file: File;
    nodeId: string | null;
    progress: (n: number) => void;
    resolve: (f: never) => void;
    reject: (e: unknown) => void;
    cancelled: boolean;
  }> = [];
  const transport: UploadTransport = (f, nodeId, progress) => {
    let resolve: (f: never) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<never>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const call = { file: f, nodeId, progress, resolve, reject, cancelled: false };
    calls.push(call);
    return {
      promise,
      cancel: () => {
        call.cancelled = true;
        reject(new ApiClientError(0, { code: "cancelled", message: "Upload canceled." }));
      },
    };
  };
  setUploadTransport(transport);
  return calls;
}

describe("the file picker", () => {
  it("offers every coursework format by extension and by type, and not SVG or spreadsheets", () => {
    for (const ext of [
      ".pdf",
      ".pptx",
      ".ppt",
      ".odp",
      ".docx",
      ".doc",
      ".odt",
      ".jpg",
      ".jpeg",
      ".png",
      ".heic",
      ".heif",
      ".webp",
      ".gif",
      ".tif",
      ".tiff",
      ".avif",
      ".bmp",
    ]) {
      expect(ACCEPT_EXTENSIONS).toContain(ext);
    }
    expect(ACCEPT_MIME).toEqual(
      expect.arrayContaining([
        "application/pdf",
        "application/msword",
        "application/vnd.ms-powerpoint",
        "image/jpeg",
        "image/png",
        "image/heic",
        "image/heif",
        "image/webp",
        "image/gif",
        "image/tiff",
        "image/avif",
        "image/bmp",
      ]),
    );
    expect(ACCEPT.split(",")).toContain(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(ACCEPT.split(",")).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    // nothing outside what the server detects: no spreadsheets, SVG (it can carry scripts) or text, and
    // no wildcard that would admit them
    expect(ACCEPT).not.toMatch(/\.xlsx?|\.svg|svg\+xml|\.txt|image\/\*|\*\/\*/);
  });
});

describe("upload queue", () => {
  it("runs two at a time with progress, then finishes", async () => {
    const calls = controlled();
    const client = new QueryClient();
    const manager = new UploadManager(client);
    manager.enqueue([file("a.pdf"), file("b.pdf"), file("c.pdf")], {
      nodeId: null,
      label: "the inbox",
    });
    expect(calls).toHaveLength(2);
    calls[0]?.progress(0.5);
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "uploading", progress: 0.5 });
    expect(manager.getSnapshot()[2]?.status).toBe("queued");
    calls[0]?.resolve({ id: "fil_1" } as never);
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(manager.getSnapshot()[0]?.status).toBe("done");
  });

  it("cancels, retries, and keeps a clear message for each refusal", async () => {
    const calls = controlled();
    const manager = new UploadManager(new QueryClient());
    manager.enqueue([file("a.pdf")], { nodeId: "nod_x", label: "Lecture 7" });
    manager.cancel(1);
    await vi.waitFor(() => expect(manager.getSnapshot()[0]?.status).toBe("cancelled"));
    manager.retry(1);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.nodeId).toBe("nod_x");
    calls[1]?.reject(new ApiClientError(415, { code: "unsupported_type", message: "nope" }));
    await vi.waitFor(() => expect(manager.getSnapshot()[0]?.status).toBe("error"));
    expect(manager.getSnapshot()[0]?.error?.message).toMatch(/not a file type/);
    expect(manager.getSnapshot()[0]?.error?.hint).toMatch(/PDF, PowerPoint/);
  });

  it("refuses a file over the size limit before sending it", () => {
    const calls = controlled();
    const manager = new UploadManager(new QueryClient());
    const big = new File([new Uint8Array(1)], "huge.pdf");
    Object.defineProperty(big, "size", { value: UPLOAD_LIMITS.maxBytes + 1 });
    manager.enqueue([big], { nodeId: null, label: "the inbox" });
    expect(calls).toHaveLength(0);
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "error" });
    expect(manager.getSnapshot()[0]?.error?.message).toMatch(/Too large: the limit is 200 MB/);
  });

  it("explains too large, unsupported and dropped connections in plain words", () => {
    expect(
      uploadFailure(new ApiClientError(413, { code: "too_large", message: "x" })).message,
    ).toMatch(/200 MB/);
    expect(uploadFailure(new ApiClientError(0, { code: "network", message: "x" })).hint).toMatch(
      /Retry/,
    );
  });
});

describe("uploads in the app", () => {
  it("shows progress in the tray, keeps going across screens, and the file lands in the inbox", async () => {
    const { user } = await startBackend();
    const { router } = await renderReady("/inbox");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    const before = (await screen.findAllByTestId("file-row")).length;

    const input = screen.getByTestId("upload-input");
    fireEvent.change(input, { target: { files: [file("Beta notes.pdf"), file("slides.pptx")] } });
    const tray = await screen.findByTestId("upload-tray");
    expect(within(tray).getAllByTestId("upload-item").length).toBe(2);

    // moving around does not stop it
    await router.navigate("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    await waitFor(
      () => expect(within(screen.getByTestId("upload-tray")).getAllByText("Open")).toHaveLength(2),
      {
        timeout: 5000,
      },
    );

    await router.navigate("/inbox");
    await waitFor(async () =>
      expect(await screen.findAllByTestId("file-row")).toHaveLength(before + 2),
    );
    expect(
      within(screen.getByRole("list", { name: "Unfiled files" })).getByText("Beta notes.pdf"),
    ).toBeInTheDocument();
    void user;
  }, 15000);

  it("says why an unsupported file was refused and keeps it out of the inbox", async () => {
    await startBackend();
    await renderReady("/inbox");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    const before = (await screen.findAllByTestId("file-row")).length;
    fireEvent.change(screen.getByTestId("upload-input"), {
      target: { files: [file("figure.svg")] },
    });
    const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(alert).toHaveTextContent(/not a file type the app can read/);
    expect(alert).toHaveTextContent(/PDF, PowerPoint/);
    expect(screen.getAllByTestId("file-row")).toHaveLength(before);
  }, 15000);
});
