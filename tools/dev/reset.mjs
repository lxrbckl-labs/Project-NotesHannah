// `pnpm local:reset`: wipe the local data after a typed confirmation.

import { existsSync, rmSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { composeFile, composeProject, localDir, storageDir } from "./env.mjs";
import { capture, dockerRunning } from "./run.mjs";

console.log(`This deletes ALL local data in ${localDir}:`);
console.log("the database, every uploaded file and every user. It cannot be undone.");
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('Type "reset" to continue: ')).trim();
rl.close();
if (answer !== "reset") {
  console.log("Nothing was deleted.");
  process.exit(1);
}
if (dockerRunning()) {
  capture("docker", ["compose", "-p", composeProject, "-f", composeFile, "down"], {
    env: { ...process.env, DATA_DIR: storageDir },
    stdio: "pipe",
  });
}
if (existsSync(localDir)) rmSync(localDir, { recursive: true, force: true });
console.log("Local data wiped. `pnpm local` will create a fresh database and a new first user.");
