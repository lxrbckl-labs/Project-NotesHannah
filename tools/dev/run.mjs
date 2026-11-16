import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { root } from "./env.mjs";

/** Run a command to the end and return its output. */
export function capture(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...options });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Run a command with its output shown; resolves with the exit code. */
export function run(cmd, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", ...options });
    child.on("exit", (code) => resolveRun(code ?? 1));
  });
}

export async function waitFor(url, label, seconds = 60) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not come up at ${url} within ${seconds}s`);
}

export function dockerRunning() {
  return capture("docker", ["info"], { stdio: "pipe" }).status === 0;
}

/** Is something already listening on this port? (Checks both IPv4 and IPv6 loopback.) */
export async function portInUse(port) {
  for (const host of ["127.0.0.1", "::1"]) {
    const busy = await new Promise((resolveProbe) => {
      const probe = createServer();
      probe.once("error", (error) => resolveProbe(error.code === "EADDRINUSE"));
      probe.once("listening", () => probe.close(() => resolveProbe(false)));
      probe.listen(port, host);
    });
    if (busy) return true;
  }
  return false;
}
