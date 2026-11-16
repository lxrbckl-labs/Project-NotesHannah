import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_KEY_PATTERN } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { type CliIo, runAdmin } from "../src/cli/commands.js";
import { migrate, openDatabase } from "../src/db/client.js";
import { authenticateApiKey, listApiKeys } from "../src/domains/accounts/keys.js";
import { PasswordHasher } from "../src/domains/accounts/passwords.js";
import { findUserByUsername } from "../src/domains/accounts/users.js";
import { TEST_ARGON2 } from "./helpers.js";

/** `admin create-key`: how an operator gives an agent its key without a browser. */
describe("admin create-key", () => {
  test("prints a working secret once, stores only its hash, and refuses bad input", async () => {
    const base = mkdtempSync(join(tmpdir(), "notes-cli-key-"));
    const env = { DATA_DIR: join(base, "storage"), DB_PATH: join(base, "notes.db") };
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      readPassword: async () => "",
      interactive: false,
      env,
      hasher: new PasswordHasher(TEST_ARGON2),
    };
    const run = (...argv: string[]) => runAdmin(argv, io);
    expect(await run("init-storage", "--create-dir")).toBe(0);
    expect(await run("create-user", "hannah", "--generate")).toBe(0);

    out.length = 0;
    expect(await run("create-key", "hannah", "--name", "Claude Code", "--scope", "write")).toBe(0);
    expect(out[0]).toMatch(/^Created write key "Claude Code" \(key_\w+\) for hannah\.$/);
    const secret = (out[1] ?? "").replace("Secret (shown once): ", "");
    expect(secret).toMatch(API_KEY_PATTERN);

    const db = openDatabase(env.DB_PATH);
    migrate(db);
    const user = findUserByUsername(db, "hannah");
    const auth = authenticateApiKey(db, secret, Date.now());
    expect(auth?.userId).toBe(user?.id);
    expect(auth?.scope).toBe("write");
    expect(JSON.stringify(db.prepare("SELECT * FROM api_keys").all())).not.toContain(secret);
    expect(listApiKeys(db, user?.id as string).map((k) => k.name)).toEqual(["Claude Code"]);
    db.close();

    expect(await run("create-key", "hannah", "--name", "x", "--scope", "admin")).toBe(1);
    expect(err.at(-1)).toContain("--scope read or --scope write");
    expect(await run("create-key", "hannah", "--scope", "read")).toBe(1);
    expect(err.at(-1)).toContain('--name "Name"');
    expect(await run("create-key", "nobody", "--name", "x", "--scope", "read")).toBe(1);
    expect(err.at(-1)).toContain("No user named nobody");
  });
});
