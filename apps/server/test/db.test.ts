import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../src/db/client.js";
import { AppError, statusFor } from "../src/http/errors.js";

describe("database", () => {
  it("opens, migrates and enforces foreign keys", () => {
    const db = createTestDatabase();
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    const names = db.prepare("SELECT name FROM _migrations").all();
    expect(names.length).toBeGreaterThan(0);
    db.exec("CREATE VIRTUAL TABLE fts_check USING fts5(body)");
  });
});

describe("errors", () => {
  it("maps codes to statuses and keeps hints", () => {
    const error = new AppError("read_only_key", "Read-only.", { hint: "Use a write key." });
    expect(statusFor(error.code)).toBe(403);
    expect(error.toApiError()).toEqual({
      code: "read_only_key",
      message: "Read-only.",
      hint: "Use a write key.",
    });
  });
});
