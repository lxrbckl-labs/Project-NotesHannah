import { COURSE_SECTIONS } from "@notes/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ApiClientError, api } from "../src/lib/api";
import { createMockBackend } from "../src/mocks/backend";
import { MOCK_PASSWORD, MOCK_USERNAME } from "../src/mocks/seed";

let backend: ReturnType<typeof createMockBackend>;
let clock = 0;

beforeEach(async () => {
  clock = Date.parse("2026-11-15T12:00:00Z");
  backend = createMockBackend({ now: () => clock });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    backend.fetch(input, init),
  );
  await api.login({ username: MOCK_USERNAME, password: MOCK_PASSWORD });
});

async function fails(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as ApiClientError;
  }
  throw new Error("expected a failure");
}

const find = async (name: string, parent: string | null = null) => {
  const found = (await api.children(parent)).find((n) => n.name === name);
  if (!found) throw new Error(name);
  return found;
};

async function pharm2() {
  const fall = await find("Fall 2026");
  const course = await find("Pharmacology II", fall.id);
  const sections = await api.children(course.id);
  const lectures = sections.find((s) => s.section === "lectures");
  if (!lectures) throw new Error("no lectures section");
  return { fall, course, sections, lectures };
}

describe("accounts", () => {
  it("answers unauthenticated until signed in, and the same error for a wrong user or password", async () => {
    await api.logout();
    expect((await fails(api.me())).code).toBe("unauthenticated");
    const wrongUser = await fails(api.login({ username: "nobody", password: "x" }));
    const wrongPass = await fails(api.login({ username: MOCK_USERNAME, password: "x" }));
    expect(wrongUser.code).toBe("unauthenticated");
    expect(wrongUser.message).toBe(wrongPass.message);
  });

  it("rate limits after repeated failures, with retryAfter, then recovers", async () => {
    await api.logout();
    for (let i = 0; i < 4; i++) {
      expect((await fails(api.login({ username: MOCK_USERNAME, password: "x" }))).code).toBe(
        "unauthenticated",
      );
    }
    const limited = await fails(api.login({ username: MOCK_USERNAME, password: "x" }));
    expect(limited.code).toBe("rate_limited");
    expect(limited.retryAfter).toBe(30);
    // even the right password is refused while limited
    expect(
      (await fails(api.login({ username: MOCK_USERNAME, password: MOCK_PASSWORD }))).code,
    ).toBe("rate_limited");
    clock += 31_000;
    await expect(
      api.login({ username: MOCK_USERNAME, password: MOCK_PASSWORD }),
    ).resolves.toBeTruthy();
  });

  it("changes the password only with the right current one", async () => {
    const bad = await fails(
      api.changePassword({ currentPassword: "nope", newPassword: "another-password" }),
    );
    expect(bad.code).toBe("invalid_input");
    await api.changePassword({ currentPassword: MOCK_PASSWORD, newPassword: "another-password" });
    await api.logout();
    await expect(
      api.login({ username: MOCK_USERNAME, password: "another-password" }),
    ).resolves.toBeTruthy();
  });
});

describe("api keys", () => {
  it("shows the secret only at creation; the list holds a preview", async () => {
    const created = await api.createKey({ name: "Codex", scope: "write" });
    expect(created.secret).toMatch(/^nh_write_[A-Za-z0-9_-]{43}$/);
    expect(created.key.preview).toBe(created.secret.slice(0, 12));
    const listed = await api.listKeys();
    expect(listed[0]?.name).toBe("Codex");
    expect(JSON.stringify(listed)).not.toContain(created.secret);
  });

  it("revokes and keeps the revoked key in the list", async () => {
    const created = await api.createKey({ name: "Temp", scope: "read" });
    await api.revokeKey(created.key.id);
    const row = (await api.listKeys()).find((k) => k.id === created.key.id);
    expect(row?.revokedAt).not.toBeNull();
    expect((await fails(api.revokeKey("key_missing"))).code).toBe("not_found");
  });
});

describe("library rules", () => {
  it("seeds two terms with courses and numbered, dated lectures", async () => {
    expect((await api.children(null)).map((n) => n.name)).toEqual(["Fall 2026", "Spring 2027"]);
    const { fall, lectures } = await pharm2();
    expect((await api.children(fall.id)).map((n) => n.name)).toEqual([
      "Pharmacology II",
      "Pharmacotherapy I",
      "Medicinal Chemistry",
    ]);
    const list = await api.children(lectures.id);
    expect(list[6]?.lecture).toEqual({ number: 7, date: "2026-10-14" });
  });

  it("creates the five sections, in order, with a new course", async () => {
    const fall = await find("Fall 2026");
    const course = await api.createNode({
      parentId: fall.id,
      kind: "course",
      name: "Biochem",
      course: { code: "PHAR 1" },
    });
    expect(course.course?.code).toBe("PHAR 1");
    expect((await api.children(course.id)).map((n) => n.name)).toEqual(
      COURSE_SECTIONS.map((s) => s.name),
    );
    expect((await api.node(course.id)).childCount).toBe(5);
    expect(course.path).toBe("Fall 2026 / Biochem");
  });

  it("refuses a placement canContain forbids, with a hint", async () => {
    const { fall, lectures, course } = await pharm2();
    const bad = await fails(api.createNode({ parentId: fall.id, kind: "lecture", name: "Oops" }));
    expect(bad.code).toBe("invalid_input");
    expect(bad.hint).toMatch(/courses/);
    expect((await fails(api.createNode({ parentId: null, kind: "course", name: "x" }))).code).toBe(
      "invalid_input",
    );
    // sections cannot be created at all
    expect(
      (await fails(api.createNode({ parentId: course.id, kind: "section" as never, name: "x" })))
        .code,
    ).toBe("invalid_input");
    // a lecture only holds documents
    const lecture = (await api.children(lectures.id))[0];
    expect(
      (await fails(api.createNode({ parentId: lecture?.id ?? "", kind: "folder", name: "f" })))
        .code,
    ).toBe("invalid_input");
  });

  it("keeps sections fixed", async () => {
    const { sections } = await pharm2();
    const section = sections[0];
    if (!section) throw new Error("no section");
    expect((await fails(api.updateNode(section.id, { name: "Mine" }))).code).toBe("invalid_input");
    expect((await fails(api.moveNode(section.id, { parentId: null }))).code).toBe("invalid_input");
    expect((await fails(api.duplicateNode(section.id))).code).toBe("invalid_input");
    expect((await fails(api.trashNode(section.id))).code).toBe("invalid_input");
  });

  it("limits folder depth and refuses moving into itself", async () => {
    const { lectures } = await pharm2();
    const one = await api.createNode({ parentId: lectures.id, kind: "folder", name: "One" });
    const two = await api.createNode({ parentId: one.id, kind: "folder", name: "Two" });
    const tooDeep = await fails(
      api.createNode({ parentId: two.id, kind: "folder", name: "Three" }),
    );
    expect(tooDeep.code).toBe("invalid_input");
    expect((await fails(api.moveNode(one.id, { parentId: two.id }))).code).toBe("invalid_input");
    expect((await fails(api.moveNode(one.id, { parentId: one.id }))).code).toBe("invalid_input");
  });

  it("moves between parents and orders siblings with afterId", async () => {
    const { lectures } = await pharm2();
    const list = await api.children(lectures.id);
    const [first, second, third] = list;
    if (!first || !second || !third) throw new Error("seed");
    await api.moveNode(third.id, { parentId: lectures.id, afterId: null });
    expect((await api.children(lectures.id)).slice(0, 3).map((n) => n.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    await api.moveNode(third.id, { parentId: lectures.id, afterId: first.id });
    expect((await api.children(lectures.id)).slice(0, 3).map((n) => n.id)).toEqual([
      first.id,
      third.id,
      second.id,
    ]);

    const other = await find("Pharmacotherapy I", (await find("Fall 2026")).id);
    const otherLectures = (await api.children(other.id)).find((s) => s.section === "lectures");
    await api.moveNode(first.id, { parentId: otherLectures?.id ?? null });
    expect((await api.children(otherLectures?.id ?? null)).at(-1)?.id).toBe(first.id);
    expect((await api.children(lectures.id)).some((n) => n.id === first.id)).toBe(false);
  });

  it("trashes a subtree, lists only the top item, and restores it whole", async () => {
    const { course, fall } = await pharm2();
    await api.trashNode(course.id);
    expect((await api.children(fall.id)).some((n) => n.id === course.id)).toBe(false);
    const trash = await api.trash();
    expect(trash.map((n) => n.id)).toEqual([course.id]);
    expect((await fails(api.children(course.id))).code).toBe("conflict");
    await api.restoreNode(course.id);
    expect((await api.children(course.id)).length).toBe(5);
    expect(await api.trash()).toEqual([]);
  });

  it("refuses to restore into a trashed parent", async () => {
    const { course, lectures } = await pharm2();
    const lecture = (await api.children(lectures.id))[0];
    if (!lecture) throw new Error("seed");
    await api.trashNode(lecture.id);
    await api.trashNode(course.id);
    const refused = await fails(api.restoreNode(lecture.id));
    expect(refused.code).toBe("conflict");
    expect(refused.hint).toMatch(/Pharmacology II/);
  });

  it("deletes for good only from the trash", async () => {
    const { lectures } = await pharm2();
    const lecture = (await api.children(lectures.id))[0];
    if (!lecture) throw new Error("seed");
    expect((await fails(api.deleteForever(lecture.id))).code).toBe("conflict");
    await api.trashNode(lecture.id);
    await api.deleteForever(lecture.id);
    expect((await fails(api.node(lecture.id))).code).toBe("not_found");
  });

  it("duplicates after the original, with its contents, and keeps favourites and recents", async () => {
    const { lectures } = await pharm2();
    const list = await api.children(lectures.id);
    const original = list[6];
    if (!original) throw new Error("seed");
    const copy = await api.duplicateNode(original.id);
    const after = await api.children(lectures.id);
    expect(after[7]?.id).toBe(copy.id);
    expect(copy.favourite).toBe(false);
    expect(copy.childCount).toBe(original.childCount);

    expect((await api.favourites()).map((n) => n.name)).toEqual(
      expect.arrayContaining(["Pharmacology II", "Beta blockers"]),
    );
    await api.updateNode(copy.id, { favourite: true });
    expect((await api.favourites()).some((n) => n.id === copy.id)).toBe(true);
    await api.node(list[0]?.id ?? "");
    expect((await api.recents())[0]?.id).toBe(list[0]?.id);
  });

  it("searches node names, never the trash", async () => {
    const hits = await api.search("beta");
    expect(hits.map((h) => h.node.name)).toContain("Beta blockers");
    expect(hits[0]?.snippet).toContain("Fall 2026");
    const { lectures } = await pharm2();
    const lecture = (await api.children(lectures.id))[6];
    await api.trashNode(lecture?.id ?? "");
    expect((await api.search("beta blockers")).some((h) => h.node.id === lecture?.id)).toBe(false);
    expect((await fails(api.search("  "))).code).toBe("invalid_input");
  });
});
