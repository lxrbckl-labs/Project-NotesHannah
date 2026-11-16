import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, api, describeError, onUnauthenticated } from "../src/lib/api";

function reply(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
  );
}

async function caught(promise: Promise<unknown>): Promise<ApiClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiClientError);
    return error as ApiClientError;
  }
  throw new Error("expected the call to fail");
}

afterEach(() => vi.unstubAllGlobals());

describe("api client errors", () => {
  it("turns an {error} body into a typed error with message, hint and example", async () => {
    vi.stubGlobal(
      "fetch",
      reply(400, {
        error: {
          code: "invalid_input",
          message: "A course cannot go inside a folder.",
          hint: "Courses live in terms.",
          example: { parentId: "nod_x" },
        },
      }),
    );
    const error = await caught(api.trashNode("nod_1"));
    expect(error.code).toBe("invalid_input");
    expect(error.status).toBe(400);
    expect(error.message).toBe("A course cannot go inside a folder.");
    expect(error.hint).toBe("Courses live in terms.");
    expect(error.example).toEqual({ parentId: "nod_x" });
    expect(describeError(error)).toEqual({
      message: "A course cannot go inside a folder.",
      hint: "Courses live in terms.",
    });
  });

  it("carries retryAfter, and falls back to the Retry-After header", async () => {
    vi.stubGlobal(
      "fetch",
      reply(429, { error: { code: "rate_limited", message: "Slow down.", retryAfter: 12 } }),
    );
    expect((await caught(api.logout())).retryAfter).toBe(12);

    vi.stubGlobal(
      "fetch",
      reply(
        429,
        { error: { code: "rate_limited", message: "Slow down." } },
        { "Retry-After": "7" },
      ),
    );
    expect((await caught(api.logout())).retryAfter).toBe(7);
  });

  it("reports a network failure and an unreadable error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect((await caught(api.me())).code).toBe("network");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })),
    );
    const error = await caught(api.me());
    expect(error.code).toBe("internal");
    expect(error.status).toBe(502);
  });

  it("rejects a success body that does not match the schema", async () => {
    vi.stubGlobal("fetch", reply(200, { user: { id: "nope" } }));
    expect((await caught(api.me())).code).toBe("bad_response");
  });

  it("returns nothing for 204 and sends JSON with query parameters", async () => {
    const fetchMock = reply(204);
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.logoutAll()).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/auth/logout-all");
    expect(init.method).toBe("POST");

    const list = reply(200, { items: [], nextCursor: null });
    vi.stubGlobal("fetch", list);
    await api.children("nod_01HZX3K9Q2V7M4N8P6R5T0W1YB");
    const [listUrl] = list.mock.calls[0] as unknown as [URL];
    expect(listUrl.searchParams.get("parentId")).toBe("nod_01HZX3K9Q2V7M4N8P6R5T0W1YB");
  });

  it("announces an ended session, except for sign-in itself", async () => {
    const heard = vi.fn();
    const stop = onUnauthenticated(heard);
    vi.stubGlobal(
      "fetch",
      reply(401, { error: { code: "unauthenticated", message: "Sign in to continue." } }),
    );
    await caught(api.listKeys());
    expect(heard).toHaveBeenCalledTimes(1);

    await caught(api.me());
    await caught(api.login({ username: "hannah", password: "wrong" }));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });
});
