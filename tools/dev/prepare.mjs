// Storage, database and a first user for a local data directory. Shared by `pnpm local` and the
// built-app test run (`tools/dev/built.mjs`), so both set up their data the same way.
import { existsSync, writeFileSync } from "node:fs";
import { credentialsFile } from "./env.mjs";
import { capture } from "./run.mjs";

/** Initialise the storage and database, and create the first user when there is none (exits on failure). */
export function prepareData(env, say) {
  const init = capture(
    "pnpm",
    ["--filter", "@notes/server", "admin", "init-storage", "--create-dir"],
    { env },
  );
  if (init.status !== 0) {
    console.error(init.stdout + init.stderr);
    process.exit(1);
  }
  say(init.stdout.trim().split("\n").at(-1) ?? "storage ready");

  const users = capture("pnpm", ["--filter", "@notes/server", "admin", "list-users"], { env });
  if (users.status !== 0) {
    console.error(users.stdout + users.stderr);
    process.exit(1);
  }
  if (users.stdout.includes("No users.")) {
    const username = process.env.NOTES_LOCAL_USER ?? "hannah";
    const made = capture(
      "pnpm",
      [
        "--filter",
        "@notes/server",
        "admin",
        "create-user",
        username,
        "--name",
        "Hannah",
        "--generate",
      ],
      { env },
    );
    if (made.status !== 0) {
      console.error(made.stdout + made.stderr);
      process.exit(1);
    }
    const password = /Password \(shown once\): (\S+)/.exec(made.stdout)?.[1];
    if (!password) {
      console.error(made.stdout);
      process.exit(1);
    }
    // Kept so `pnpm local:seed` and the tests can sign in. It lives in the git-ignored data folder.
    writeFileSync(credentialsFile, JSON.stringify({ username, password }), { mode: 0o600 });
    console.log("\n================================================");
    console.log(`  First user created. Sign in with:`);
    console.log(`    username: ${username}`);
    console.log(`    password: ${password}`);
    console.log("  This is shown once (it is also in data/local/credentials.json,");
    console.log("  which is git-ignored). Change it under Settings.");
    console.log("================================================\n");
  } else {
    say(
      `user exists${existsSync(credentialsFile) ? " (credentials in data/local/credentials.json)" : ""}`,
    );
  }
}
