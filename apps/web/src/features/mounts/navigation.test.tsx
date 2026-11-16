import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("../../lib/api", () => ({ appHttp: { get: (path: string) => get(path) } }));

import { useModuleNavigation } from "./navigation";

function setup() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/requests"]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ nav: useModuleNavigation(), at: useLocation() }), { wrapper });
}

beforeEach(() => {
  get.mockReset();
});

describe("links from requests and concepts", () => {
  it("a reply link by document id opens the library node's page, with the block", async () => {
    get.mockImplementation(async (path: string) => {
      if (path === "/documents/doc_1") return { document: { nodeId: "nod_lec" } };
      if (path === "/nodes/nod_lec") return { node: { id: "nod_lec", kind: "lecture" } };
      throw new Error(`unexpected ${path}`);
    });
    const { result } = setup();
    await result.current.nav.onOpenDocument({ documentId: "doc_1", blockId: "blk_9" });
    await vi.waitFor(() => expect(result.current.at.pathname).toBe("/doc/nod_lec"));
    expect(result.current.at.search).toBe("?block=blk_9");
  });

  it("a link that already carries the node id needs no lookup", async () => {
    get.mockImplementation(async () => ({ node: { id: "nod_lec", kind: "lecture" } }));
    const { result } = setup();
    await result.current.nav.onOpenDocument({ nodeId: "nod_lec" });
    await vi.waitFor(() => expect(result.current.at.pathname).toBe("/doc/nod_lec"));
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("/documents/"));
  });

  it("a practice question link opens the item it belongs to", async () => {
    get.mockImplementation(async (path: string) => {
      if (path === "/practice/questions/qst_1") return { question: { nodeIds: ["nod_lec"] } };
      return { node: { id: "nod_lec", kind: "lecture" } };
    });
    const { result } = setup();
    await result.current.nav.onOpenQuestion({ questionId: "qst_1" });
    await vi.waitFor(() => expect(result.current.at.pathname).toBe("/doc/nod_lec"));
  });

  it("falls back to somewhere sensible when the lookup fails", async () => {
    get.mockRejectedValue(new Error("gone"));
    const { result } = setup();
    await result.current.nav.onOpenQuestion({ questionId: "qst_x" });
    await vi.waitFor(() => expect(result.current.at.pathname).toBe("/practice"));
    await result.current.nav.onOpenDocument({ documentId: "doc_x" });
    await vi.waitFor(() => expect(result.current.at.pathname).toBe("/library"));
  });

  it("opens concepts", async () => {
    const { result } = setup();
    result.current.nav.onOpenConcept("con_1");
    await vi.waitFor(() => expect(result.current.at.pathname).toBe("/concepts/con_1"));
  });
});
