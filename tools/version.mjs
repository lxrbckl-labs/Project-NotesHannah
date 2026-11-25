// The app's version: one number, kept the same in every package.json of the repo.
//
//   pnpm version:show                 print it
//   pnpm version:bump patch           1.4.2 -> 1.4.3   a fix or a small change to how something looks
//   pnpm version:bump minor           1.4.2 -> 1.5.0   something new she can do
//   pnpm version:bump major           1.4.2 -> 2.0.0   Alex's call only
//   pnpm version:bump 1.6.0           set it outright
//
// Where it shows: the hint on the home button at the top left of the app (built in by Vite from the root
// package.json, apps/web/vite.config.ts) and GET /healthz (apps/server reads its own package.json), so the
// number on the live site says which build is running. The rule for when to bump is in docs/deploy.md,
// "Version number".

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "package.json",
  "apps/web/package.json",
  "apps/server/package.json",
  "apps/converter/package.json",
  "packages/schema/package.json",
];

export function nextVersion(current, how) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`"${current}" is not a version like 1.4.2`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (how === "patch") return `${major}.${minor}.${patch + 1}`;
  if (how === "minor") return `${major}.${minor + 1}.0`;
  if (how === "major") return `${major + 1}.0.0`;
  if (/^\d+\.\d+\.\d+$/.test(how ?? "")) return how;
  throw new Error(`Say patch, minor, major or a version like 1.4.2 (got "${how ?? ""}")`);
}

const read = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8"));

function main() {
  const [command, how] = process.argv.slice(2);
  const current = read("package.json").version;
  if (command === "show") {
    console.log(current);
    return;
  }
  if (command !== "bump") throw new Error("Use: version.mjs show | bump <patch|minor|major|x.y.z>");
  const next = nextVersion(current, how);
  for (const file of FILES) {
    const path = resolve(root, file);
    const text = readFileSync(path, "utf8");
    // Change the one line, so the file's own layout and key order stay as they are.
    const changed = text.replace(/("version":\s*")[^"]*(")/, `$1${next}$2`);
    if (changed === text && read(file).version !== next) {
      throw new Error(`${file} has no "version" line to change`);
    }
    writeFileSync(path, changed);
  }
  console.log(`${current} -> ${next}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
