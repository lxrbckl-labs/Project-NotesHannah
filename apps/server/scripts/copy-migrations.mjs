// tsc compiles only .ts files; the SQL migrations must sit beside the compiled db client.
import { cpSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../src/db/migrations", import.meta.url));
const to = fileURLToPath(new URL("../dist/db/migrations", import.meta.url));
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith(".ts") });
const count = readdirSync(to).filter((name) => name.endsWith(".sql")).length;
if (count === 0) throw new Error(`No migrations copied to ${to}`);
console.log(`copied ${count} migration(s) to dist/db/migrations`);
