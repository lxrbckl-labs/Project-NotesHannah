// The built app, the way it is deployed: `pnpm build`, then the server in production mode serving
// apps/web/dist on one port, with its own throwaway data directory and a test user. The built-app
// Playwright suite (`pnpm e2e:built`) runs against this. Ctrl-C (or SIGTERM) stops it and removes the data.
//
// What production asks for, and what we give it:
// - APP_ORIGIN is required and must equal the origin the browser uses: http://localhost:<port>.
// - Session cookies are `Secure` in production. Chromium still stores and sends a Secure cookie for
//   http://localhost (it counts as a secure context), so no cookie setting needs to change.
// - Port, data directory and the converter are set with E2E_BUILT_PORT, E2E_BUILT_DIR and
//   E2E_BUILT_CONVERTER=1 (starts the converter container; off by default to keep the run fast).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = process.env.E2E_BUILT_PORT ?? "3460";
// env.mjs reads these when it loads, so they are set first (hence the dynamic imports below).
process.env.NOTES_SERVER_PORT = port;
process.env.NOTES_WEB_PORT = port;
process.env.NOTES_LOCAL_DIR = resolve(process.env.E2E_BUILT_DIR ?? join(root, "data", "e2e-built"));

const { appOrigin, composeFile, composeProject, localDir, serverEnv, serverUrl, storageDir } =
  await import("./env.mjs");
const { prepareData } = await import("./prepare.mjs");
const { capture, dockerRunning, portInUse, run, waitFor } = await import("./run.mjs");

const say = (line) => console.log(`[built] ${line}`);
const env = { ...serverEnv(), NODE_ENV: "production" };
let server;
let converterStarted = false;

function stopAll() {
  server?.kill("SIGTERM");
  if (converterStarted) {
    capture("docker", ["compose", "-p", composeProject, "-f", composeFile, "down"], {
      env: { ...env, DATA_DIR: storageDir },
      stdio: "pipe",
    });
  }
  rmSync(localDir, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}

if (await portInUse(Number(port))) {
  console.error(`Port ${port} is already in use. Set E2E_BUILT_PORT to another port.`);
  process.exit(1);
}
rmSync(localDir, { recursive: true, force: true });
mkdirSync(localDir, { recursive: true });

if (process.env.E2E_BUILT_SKIP_BUILD !== "1") {
  say("building everything (pnpm build)");
  if ((await run("pnpm", ["build"], { env: { ...process.env } })) !== 0) process.exit(1);
}

prepareData(env, say);

if (process.env.E2E_BUILT_CONVERTER === "1" && dockerRunning()) {
  say("starting the converter container");
  const code = await run(
    "docker",
    ["compose", "-p", composeProject, "-f", composeFile, "up", "-d", "--build"],
    { env: { ...env, DATA_DIR: storageDir, CONVERTER_USER: process.env.CONVERTER_USER ?? "" } },
  );
  converterStarted = code === 0;
} else {
  say("converter not started: uploads will wait in 'converting' (E2E_BUILT_CONVERTER=1 starts it)");
}

say(`starting the production server on :${port} (APP_ORIGIN ${appOrigin})`);
server = spawn("node", ["apps/server/dist/index.js"], { cwd: root, env, stdio: "inherit" });
server.on("exit", (code) => {
  say(`the server exited (${code}); stopping`);
  stopAll();
  process.exit(code ?? 1);
});
await waitFor(`${serverUrl}/healthz`, "the server");

// The seed needs the converter for the study guide; without it only the library tree and uploads are
// made (it prints that it skipped the rest), and the suite's global setup writes the documents it needs.
say("seeding a small library");
await run("node", ["tools/dev/seed.mjs"], {
  env: { ...env, NOTES_SEED_WAIT: converterStarted ? "120" : "0" },
});
console.log(`\n[built] Ready. Open ${appOrigin}\n`);
