import { ErrorCode, FileType, newId, UPLOAD_LIMITS } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { loadLimits } from "../src/config.js";
import { CONVERT_ERROR_CODES } from "../src/errors.js";
import { FILE_ID, JOB_FILE, JOB_ID, SHA256, USER_ID } from "../src/ids.js";
import { CONVERTED_TYPES, InvalidJobError, validateJob } from "../src/protocol.js";
import { FILE, JOB, USER } from "./helpers.js";

describe("agreement with the schema package", () => {
  test("every error code the converter can produce is a schema ErrorCode", () => {
    for (const c of CONVERT_ERROR_CODES) expect(ErrorCode.options).toContain(c);
  });
  test("default limits equal the upload limits", () => {
    const l = loadLimits({});
    expect(l.maxInputBytes).toBe(UPLOAD_LIMITS.maxBytes);
    expect(l.maxPages).toBe(UPLOAD_LIMITS.maxPages);
  });
  test("the produced types are the schema FileTypes", () => {
    expect([...FileType.options].sort()).toEqual([...CONVERTED_TYPES].sort());
  });
  test("the id patterns accept the ids the schema generates", () => {
    for (let i = 0; i < 200; i++) {
      expect(USER_ID.test(newId("user"))).toBe(true);
      expect(FILE_ID.test(newId("file"))).toBe(true);
      expect(JOB_ID.test(newId("job"))).toBe(true);
    }
  });
});

describe("validateJob", () => {
  const good = {
    jobId: JOB,
    userId: USER,
    fileId: FILE,
    sha256: "a".repeat(64),
    createdAt: "2026-11-15T18:20:00.000Z",
  };
  test("accepts a well-formed job and defaults attempts to 0", () => {
    expect(validateJob(good, JOB)).toEqual({ ...good, attempts: 0 });
  });
  test("keeps a valid file id on the error so the failure can be reported against it", () => {
    try {
      validateJob({ ...good, sha256: "nope" }, JOB);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidJobError);
      expect((e as InvalidJobError).fileId).toBe(FILE);
    }
  });
  test("extra fields are ignored, not trusted", () => {
    expect(validateJob({ ...good, path: "/etc/passwd" }, JOB)).not.toHaveProperty("path");
  });
});

describe("patterns", () => {
  test("job file name", () => {
    expect(JOB_FILE.exec(`${JOB}.json`)?.[1]).toBe(JOB);
    expect(JOB_FILE.test(`${JOB}.json\n`)).toBe(false);
    expect(JOB_FILE.test(`../${JOB}.json`)).toBe(false);
  });
  test("sha256", () => {
    expect(SHA256.test("f".repeat(64))).toBe(true);
    expect(SHA256.test(`${"f".repeat(64)}\n`)).toBe(false);
  });
});
