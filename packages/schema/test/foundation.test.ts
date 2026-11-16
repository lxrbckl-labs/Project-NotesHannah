import { describe, expect, it } from "vitest";
import {
  API_KEY_PATTERN,
  COURSE_SECTIONS,
  CreateNodeInput,
  FileId,
  LectureMeta,
  NodeId,
  NodeName,
  RequestUploadsInput,
  SaveTranscriptInput,
  Timestamp,
  UPLOAD_LIMITS,
  Username,
  canContain,
  idKind,
  lectureLabel,
  newId,
} from "../src/index.js";

describe("ids", () => {
  it("creates well-formed, self-describing IDs", () => {
    const id = newId("node");
    expect(id).toMatch(/^nod_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(idKind(id)).toBe("node");
    expect(NodeId.safeParse(id).success).toBe(true);
  });

  it("rejects an ID of the wrong kind with a helpful message", () => {
    const result = FileId.safeParse(newId("node"));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("fil_");
  });

  it("rejects malformed IDs", () => {
    expect(idKind("nod_short")).toBeNull();
    expect(idKind("nope")).toBeNull();
    expect(idKind("zzz_01HZX3K9Q2V7M4N8P6R5T0W1YB")).toBeNull();
  });

  it("sorts by creation time", () => {
    const earlier = newId("file", 1_000_000);
    const later = newId("file", 2_000_000);
    expect(earlier < later).toBe(true);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => newId("page")));
    expect(seen.size).toBe(2000);
  });
});

describe("library tree rules", () => {
  it("follows term, course, section, lecture, document", () => {
    expect(canContain(null, "term")).toBe(true);
    expect(canContain("term", "course")).toBe(true);
    expect(canContain("course", "section")).toBe(true);
    expect(canContain("section", "lecture")).toBe(true);
    expect(canContain("lecture", "document")).toBe(true);
  });

  it("refuses shapes that would break the spine", () => {
    expect(canContain(null, "course")).toBe(false);
    expect(canContain("term", "document")).toBe(false);
    expect(canContain("course", "folder")).toBe(false);
    expect(canContain("document", "document")).toBe(false);
    expect(canContain("lecture", "lecture")).toBe(false);
  });

  it("gives every course the same five sections", () => {
    expect(COURSE_SECTIONS.map((s) => s.section)).toEqual([
      "sources",
      "lectures",
      "study_guides",
      "practice",
      "exams",
    ]);
  });

  it("does not let a client create a section directly", () => {
    const result = CreateNodeInput.safeParse({ parentId: newId("node"), kind: "section", name: "Extra" });
    expect(result.success).toBe(false);
  });

  it("trims names and rejects empty or control characters", () => {
    expect(NodeName.parse("  Beta blockers  ")).toBe("Beta blockers");
    expect(NodeName.safeParse("   ").success).toBe(false);
    expect(NodeName.safeParse("bad\u0007name").success).toBe(false);
  });

  it("labels lectures in teaching order", () => {
    const meta = LectureMeta.parse({ number: 7, date: "2026-10-14" });
    expect(lectureLabel("Beta blockers", meta)).toBe("07 · Beta blockers · Oct 14");
    expect(lectureLabel("Beta blockers", null)).toBe("Beta blockers");
  });
});

describe("accounts", () => {
  it("accepts simple usernames only", () => {
    expect(Username.safeParse("hannah").success).toBe(true);
    expect(Username.safeParse("Hannah").success).toBe(false);
    expect(Username.safeParse("a").success).toBe(false);
  });

  it("recognises the API key format", () => {
    expect(API_KEY_PATTERN.test(`nh_write_${"a".repeat(43)}`)).toBe(true);
    expect(API_KEY_PATTERN.test(`nh_admin_${"a".repeat(43)}`)).toBe(false);
  });
});

describe("sources", () => {
  it("requires a real timestamp", () => {
    expect(Timestamp.safeParse("2026-11-15T18:20:00.000Z").success).toBe(true);
    expect(Timestamp.safeParse("yesterday").success).toBe(false);
  });

  it("caps upload size and batch size", () => {
    const tooBig = RequestUploadsInput.safeParse({
      files: [{ name: "deck.pptx", bytes: UPLOAD_LIMITS.maxBytes + 1 }],
    });
    expect(tooBig.success).toBe(false);
    const empty = RequestUploadsInput.safeParse({ files: [] });
    expect(empty.success).toBe(false);
  });

  it("defaults transcript flags to none and validates flag kinds", () => {
    const pageId = newId("page");
    const parsed = SaveTranscriptInput.parse({ pageId, text: "Metoprolol 2.5 mg" });
    expect(parsed.flags).toEqual([]);
    const bad = SaveTranscriptInput.safeParse({
      pageId,
      text: "x",
      flags: [{ kind: "guess", quote: "x" }],
    });
    expect(bad.success).toBe(false);
  });
});
