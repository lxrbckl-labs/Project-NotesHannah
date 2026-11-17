// `pnpm local`: prepare data, start the converter (if Docker is up), the server and the web dev
// server, all without the mock. Ctrl-C stops everything it started.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import {
  appOrigin,
  composeFile,
  composeProject,
  localDir,
  root,
  serverEnv,
  serverPort,
  serverUrl,
  storageDir,
  webPort,
} from "./env.mjs";
import { prepareData } from "./prepare.mjs";
import { capture, dockerRunning, portInUse, run, waitFor } from "./run.mjs";

const env = serverEnv();
const children = [];
let converterStarted = false;

function say(line) {
  console.log(`[local] ${line}`);
}

async function stopAll() {
  for (const child of children) child.kill("SIGTERM");
  if (converterStarted) {
    say("stopping the converter container");
    capture("docker", ["compose", "-p", composeProject, "-f", composeFile, "down"], {
      env: { ...env, DATA_DIR: storageDir },
      stdio: "pipe",
    });
  }
}

process.on("SIGINT", async () => {
  await stopAll();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await stopAll();
  process.exit(0);
});

for (const [port, what, variable] of [
  [serverPort, "the server", "NOTES_SERVER_PORT"],
  [webPort, "the web app", "NOTES_WEB_PORT"],
]) {
  if (await portInUse(port)) {
    console.error(
      `Port ${port} (${what}) is already in use. Stop whatever is using it, or set ${variable} to another port.`,
    );
    process.exit(1);
  }
}

mkdirSync(localDir, { recursive: true });

say("building the shared schema");
if ((await run("pnpm", ["build:schema"], { stdio: "pipe", env })) !== 0) process.exit(1);

// 1. storage and database, and 2. a first user, if there is none
prepareData(env, say);

// 3. the converter, locked down, against the same data directory
if (process.env.NOTES_CONVERTER === "0") {
  say("converter skipped (NOTES_CONVERTER=0): uploads will wait in 'converting'");
} else if (!dockerRunning()) {
  say("NOTICE: Docker is not running, so the converter is not started.");
  say(
    "        Uploads will be stored but wait in 'converting' until you start Docker and run this again.",
  );
} else {
  say("building and starting the converter container (first build takes a few minutes)");
  const code = await run(
    "docker",
    ["compose", "-p", composeProject, "-f", composeFile, "up", "-d", "--build"],
    { env: { ...env, DATA_DIR: storageDir, CONVERTER_USER: process.env.CONVERTER_USER ?? "" } },
  );
  if (code === 0) converterStarted = true;
  else
    say(
      "NOTICE: the converter did not start (see the output above). Uploads will wait in 'converting'.",
    );
}

// 4. server and web, no mock
say(`starting the server on :${serverPort} (APP_ORIGIN ${appOrigin})`);
children.push(
  spawn("pnpm", ["--filter", "@notes/server", "dev"], { cwd: root, env, stdio: "inherit" }),
);
say(`starting the web app on :${webPort}, proxying /api to ${serverUrl}`);
children.push(
  spawn(
    "pnpm",
    [
      "--filter",
      "@notes/web",
      "exec",
      "vite",
      "--port",
      String(webPort),
      "--strictPort",
      // NOTES_WEB_HOST=0.0.0.0 serves the web app to the home network (set NOTES_APP_ORIGIN to match).
      ...(process.env.NOTES_WEB_HOST ? ["--host", process.env.NOTES_WEB_HOST] : []),
    ],
    {
      cwd: root,
      env: { ...env, SERVER_URL: serverUrl },
      stdio: "inherit",
    },
  ),
);
for (const child of children) {
  child.on("exit", async (code) => {
    say(`a process exited (${code}); stopping`);
    await stopAll();
    process.exit(code ?? 1);
  });
}

await waitFor(`${serverUrl}/healthz`, "the server");
await waitFor(appOrigin, "the web app");
if (process.env.NOTES_LOCAL_SEED === "1") {
  say("seeding a small library (NOTES_LOCAL_SEED=1)");
  const code = await run("node", ["tools/dev/seed.mjs"], { env });
  if (code !== 0) say("the seed did not finish; continuing without it");
}
console.log(`\n[local] Ready. Open ${appOrigin}\n`);
