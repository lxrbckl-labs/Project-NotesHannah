import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type CliIo, runAdmin } from "../src/cli/commands.js";
import { migrate, openDatabase } from "../src/db/client.js";
import { PasswordHasher } from "../src/domains/accounts/passwords.js";
import { createSession, resolveSession } from "../src/domains/accounts/sessions.js";
import { findUserByUsername, getPasswordHash } from "../src/domains/accounts/users.js";
import { TEST_ARGON2 } from "./helpers.js";

function harness(passwords: string[] = []) {
  const base = mkdtempSync(join(tmpdir(), "notes-cli-"));
  const env = { DATA_DIR: join(base, "storage"), DB_PATH: join(base, "db", "notes.db") };
  const out: string[] = [];
  const err: string[] = [];
  const queue = [...passwords];
  const io: CliIo = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    readPassword: async () => queue.shift() ?? "",
    interactive: false,
    env,
    hasher: new PasswordHasher(TEST_ARGON2),
  };
  const run = (...argv: string[]) => runAdmin(argv, io);
  const db = () => {
    const d = openDatabase(env.DB_PATH);
    migrate(d);
    return d;
  };
  return { base, env, out, err, io, run, db, queue };
}

describe("admin CLI", () => {
  test("commands that need storage refuse before init-storage", async () => {
    const h = harness(["a long password"]);
    expect(await h.run("create-user", "hannah")).toBe(1);
    expect(h.err.join("\n")).toContain("storage_unavailable");
    expect(existsSync(h.env.DATA_DIR)).toBe(false);
  });

  test("init-storage, create-user with --generate, list-users", async () => {
    const h = harness();
    expect(await h.run("init-storage")).toBe(1); // directory missing, not created implicitly
    expect(await h.run("init-storage", "--create-dir")).toBe(0);
    expect(await h.run("create-user", "Hannah", "--name", "Hannah Porras", "--generate")).toBe(0);
    const line = h.out.find((l) => l.startsWith("Password (shown once): ")) as string;
    const password = line.slice("Password (shown once): ".length);
    expect(password).toMatch(/^[A-Za-z0-9_-]{20}$/);
    const db = h.db();
    const user = findUserByUsername(db, "hannah");
    expect(user?.display_name).toBe("Hannah Porras");
    const hash = getPasswordHash(db, user?.id as string) as string;
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await new PasswordHasher(TEST_ARGON2).verify(hash, password)).toBe(true);
    // per-user directories are made on demand, not at account creation
    expect(readdirSync(join(h.env.DATA_DIR, "originals"))).toEqual([]);
    db.close();
    h.out.length = 0;
    expect(await h.run("list-users")).toBe(0);
    expect(h.out[0]).toMatch(/^hannah\tHannah Porras\tusr_/);
    expect(await h.run("create-user", "hannah", "--generate")).toBe(1);
    expect(h.err.join("\n")).toContain("conflict");
  });

  test("create-user with a typed password; too short is refused", async () => {
    const h = harness(["short", "a long enough password"]);
    await h.run("init-storage", "--create-dir");
    expect(await h.run("create-user", "hannah")).toBe(1);
    expect(await h.run("create-user", "hannah")).toBe(0);
    const db = h.db();
    const user = findUserByUsername(db, "hannah");
    const hash = getPasswordHash(db, user?.id as string) as string;
    expect(await new PasswordHasher(TEST_ARGON2).verify(hash, "a long enough password")).toBe(true);
    db.close();
  });

  test("interactive mode asks twice and refuses a mismatch", async () => {
    const h = harness(["a long enough password", "a different password"]);
    h.io.interactive = true;
    await h.run("init-storage", "--create-dir");
    expect(await h.run("create-user", "hannah")).toBe(1);
    expect(h.err.join("\n")).toMatch(/do not match/);
  });

  test("reset-password ends sessions; disable and enable", async () => {
    const h = harness(["first password!!", "second password!"]);
    await h.run("init-storage", "--create-dir");
    await h.run("create-user", "hannah");
    let db = h.db();
    const user = findUserByUsername(db, "hannah");
    const { token } = createSession(db, user?.id as string, Date.now(), null);
    db.close();

    expect(await h.run("reset-password", "hannah")).toBe(0);
    db = h.db();
    expect(resolveSession(db, token, Date.now())).toBeNull();
    const hash = getPasswordHash(db, user?.id as string) as string;
    expect(await new PasswordHasher(TEST_ARGON2).verify(hash, "second password!")).toBe(true);
    const { token: t2 } = createSession(db, user?.id as string, Date.now(), null);
    db.close();

    expect(await h.run("disable-user", "hannah")).toBe(0);
    db = h.db();
    expect(findUserByUsername(db, "hannah")?.disabled_at).not.toBeNull();
    expect(resolveSession(db, t2, Date.now())).toBeNull();
    db.close();
    expect(await h.run("enable-user", "hannah")).toBe(0);
    db = h.db();
    expect(findUserByUsername(db, "hannah")?.disabled_at).toBeNull();
    db.close();

    expect(await h.run("disable-user", "nobody")).toBe(1);
    expect(h.err.join("\n")).toContain("not_found");
  });

  test("unknown command prints usage", async () => {
    const h = harness();
    expect(await h.run("sign-up", "x")).toBe(1);
    expect(h.err.join("\n")).toContain("Usage: admin");
  });
});
