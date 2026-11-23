import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { newId } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { createTestDatabase } from "../src/db/client.js";
import { AppError } from "../src/http/errors.js";
import { bindStorage } from "../src/storage/binding.js";
import {
  ensureDir,
  initStorage,
  isSafeSegment,
  openStorage,
  originalPath,
  originalsDir,
  pageImagePath,
  pagesDir,
  queueDir,
  resolveInside,
  STORAGE_MARKER,
  TOP_LEVEL_DIRS,
  tmpDir,
} from "../src/storage/storage.js";

const temp = () => mkdtempSync(join(tmpdir(), "notes-storage-"));

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : `not-app-error: ${String(error)}`;
  }
  return undefined;
}

describe("storage guard", () => {
  test("a missing directory is storage_unavailable and is never created", () => {
    const dir = join(temp(), "drive");
    expect(code(() => openStorage(dir))).toBe("storage_unavailable");
    expect(existsSync(dir)).toBe(false);
  });

  test("a directory without the marker is storage_unavailable", () => {
    const dir = temp();
    expect(code(() => openStorage(dir))).toBe("storage_unavailable");
    expect(existsSync(join(dir, STORAGE_MARKER))).toBe(false);
  });

  test("an invalid marker is storage_unavailable", () => {
    const dir = temp();
    writeFileSync(join(dir, STORAGE_MARKER), "{}");
    expect(code(() => openStorage(dir))).toBe("storage_unavailable");
  });

  test("init-storage writes the marker and layout; then it opens", () => {
    const dir = temp();
    const result = initStorage(dir);
    expect(result.status).toBe("created");
    const marker = JSON.parse(readFileSync(join(dir, STORAGE_MARKER), "utf8"));
    expect(marker.storageId).toBe(result.storage.marker.storageId);
    for (const top of [
      "originals",
      "pages",
      "queue/pending",
      "queue/processing",
      "queue/done",
      "queue/failed",
      "tmp",
    ]) {
      expect(statSync(join(dir, top)).isDirectory(), top).toBe(true);
    }
    expect(existsSync(join(dir, "users"))).toBe(false);
    expect(openStorage(dir).marker.storageId).toBe(marker.storageId);
    // idempotent: the id does not change
    const again = initStorage(dir);
    expect(again.status).toBe("exists");
    expect(again.storage.marker.storageId).toBe(marker.storageId);
  });

  test("with the marker there, missing top-level folders are made again and the marker is kept", () => {
    const dir = temp();
    const first = initStorage(dir);
    const id = first.storage.marker.storageId;
    rmSync(join(dir, "originals"), { recursive: true });
    rmSync(join(dir, "queue"), { recursive: true });
    const again = initStorage(dir);
    expect(again.status).toBe("exists");
    if (again.status !== "exists") throw new Error("unreachable");
    expect(again.restored).toContain("originals");
    expect(again.restored.some((name) => name.startsWith("queue/"))).toBe(true);
    expect(again.restored).not.toContain("pages");
    for (const top of TOP_LEVEL_DIRS) expect(existsSync(join(dir, top))).toBe(true);
    expect(again.storage.marker.storageId).toBe(id);
    // Nothing missing: nothing restored.
    const third = initStorage(dir);
    expect(third.status === "exists" && third.restored).toEqual([]);
  });

  test("init-storage will not create a missing directory unless asked", () => {
    const dir = join(temp(), "drive");
    expect(code(() => initStorage(dir))).toBe("storage_unavailable");
    expect(existsSync(dir)).toBe(false);
    expect(initStorage(dir, { createDir: true }).status).toBe("created");
  });

  test("init-storage refuses a non-empty unmarked directory unless forced", () => {
    const dir = temp();
    writeFileSync(join(dir, "something.pdf"), "x");
    expect(code(() => initStorage(dir))).toBe("conflict");
    expect(initStorage(dir, { force: true }).status).toBe("created");
  });

  test("the database is bound to one storage id", () => {
    const db = createTestDatabase();
    const a = initStorage(temp()).storage;
    const b = initStorage(temp()).storage;
    expect(bindStorage(db, a)).toBe("bound");
    expect(bindStorage(db, a)).toBe("matched");
    expect(code(() => bindStorage(db, b))).toBe("storage_unavailable");
  });
});

describe("path helpers", () => {
  const storage = initStorage(temp()).storage;
  const userId = newId("user");
  const fileId = newId("file");
  const sha = "a".repeat(64);

  test("build the split layout", () => {
    expect(originalsDir(storage, userId)).toBe(join(storage.root, "originals", userId));
    expect(originalPath(storage, userId, sha)).toBe(join(storage.root, "originals", userId, sha));
    expect(pagesDir(storage, userId, fileId)).toBe(join(storage.root, "pages", userId, fileId));
    expect(pageImagePath(storage, userId, fileId, 1, "page")).toBe(
      join(storage.root, "pages", userId, fileId, "0001.webp"),
    );
    expect(pageImagePath(storage, userId, fileId, 42, "thumb")).toBe(
      join(storage.root, "pages", userId, fileId, "thumbs", "0042.webp"),
    );
    expect(queueDir(storage, "processing")).toBe(join(storage.root, "queue", "processing"));
    expect(tmpDir(storage)).toBe(join(storage.root, "tmp"));
  });

  test("reject unsafe segments", () => {
    const bad = [
      "..",
      ".",
      "",
      "../x",
      "a/b",
      "a\\b",
      "/etc/passwd",
      "x\0y",
      "..pdf",
      "a..b",
      ".hidden",
      "%2e%2e",
      "a b",
      "x".repeat(200),
      "\uffa0",
    ];
    for (const segment of bad) expect(isSafeSegment(segment), segment).toBe(false);
    expect(code(() => resolveInside(storage.root, "..", "etc"))).toBe("invalid_input");
    expect(code(() => resolveInside(storage.root, "tmp", "../../etc"))).toBe("invalid_input");
  });

  test("reject anything that is not a user ID, file ID or SHA-256", () => {
    for (const id of ["../../etc", "usr_..", newId("file"), "usr_short", "", "usr_/x"]) {
      expect(
        code(() => originalsDir(storage, id)),
        id,
      ).toBe("invalid_input");
      expect(
        code(() => pagesDir(storage, id, fileId)),
        id,
      ).toBe("invalid_input");
    }
    for (const id of ["../x", newId("user"), "fil_", ""]) {
      expect(
        code(() => pagesDir(storage, userId, id)),
        id,
      ).toBe("invalid_input");
    }
    for (const digest of [
      `../${"a".repeat(61)}`,
      "A".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
      "",
      "..",
      "g".repeat(64),
    ]) {
      expect(
        code(() => originalPath(storage, userId, digest)),
        digest,
      ).toBe("invalid_input");
    }
  });

  test("reject bad page indexes, sizes and queue states", () => {
    for (const index of [0, -1, 1.5, 10_000, Number.NaN]) {
      expect(
        code(() => pageImagePath(storage, userId, fileId, index, "page")),
        String(index),
      ).toBe("invalid_input");
    }
    expect(code(() => pageImagePath(storage, userId, fileId, 1, "../x" as "page"))).toBe(
      "invalid_input",
    );
    expect(code(() => queueDir(storage, "../../etc" as "done"))).toBe("invalid_input");
  });

  test("ensureDir creates on demand and refuses symlinks and paths outside the root", () => {
    ensureDir(storage, pagesDir(storage, userId, fileId));
    expect(statSync(join(storage.root, "pages", userId, fileId)).isDirectory()).toBe(true);
    const victim = newId("user");
    const outside = temp();
    symlinkSync(outside, join(storage.root, "originals", victim));
    expect(code(() => ensureDir(storage, originalsDir(storage, victim)))).toBe(
      "storage_unavailable",
    );
    const dangling = newId("user");
    symlinkSync(join(outside, "nowhere"), join(storage.root, "pages", dangling));
    expect(code(() => ensureDir(storage, pagesDir(storage, dangling, fileId)))).toBe(
      "storage_unavailable",
    );
    expect(existsSync(join(outside, "nowhere"))).toBe(false);
    expect(code(() => ensureDir(storage, outside))).toBe("invalid_input");
  });
});

describe("server start", () => {
  const serverDir = fileURLToPath(new URL("..", import.meta.url));
  const start = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: serverDir,
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "development", PORT: "39871", ...env },
      encoding: "utf8",
      timeout: 20_000,
    });

  test("refuses to start without the drive, and creates nothing", () => {
    const base = temp();
    const dataDir = join(base, "drive");
    const dbPath = join(base, "db", "notes.db");
    const res = start({ DATA_DIR: dataDir, DB_PATH: dbPath });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("storage_unavailable");
    expect(res.stderr).toMatch(/mounted/);
    expect(existsSync(dataDir)).toBe(false);
    expect(existsSync(dbPath)).toBe(false);
  });

  test("refuses to start when the marker is missing from an existing directory", () => {
    const base = temp();
    const dataDir = join(base, "drive");
    mkdirSync(dataDir);
    const res = start({ DATA_DIR: dataDir, DB_PATH: join(base, "notes.db") });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("storage_unavailable");
    expect(existsSync(join(dataDir, STORAGE_MARKER))).toBe(false);
  });

  test("starts with a marked drive, migrates, and binds the storage id", async () => {
    const base = temp();
    const dataDir = join(base, "drive");
    initStorage(dataDir, { createDir: true });
    const dbPath = join(base, "db", "notes.db");
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "development",
        PORT: String(40_000 + Math.floor(Math.random() * 10_000)),
        DATA_DIR: dataDir,
        DB_PATH: dbPath,
      },
    });
    let output = "";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no start: ${output}`)), 20_000);
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("exit", () => reject(new Error(`exited: ${output}`)));
    });
    child.kill("SIGTERM");
    expect(output).toContain("0001_accounts.sql");
    expect(existsSync(dbPath)).toBe(true);
  });
});
