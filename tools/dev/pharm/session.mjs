// Her signed-in browser session, shared by `pnpm local:seed:pharm` and `pnpm local:seed:pharm:notes`.
// Same credentials and the same cookie handling as the web app: whatever goes through `call` shows as hers.
import { readFileSync } from "node:fs";
import { appOrigin, credentialsFile, serverUrl } from "../env.mjs";

/** NOTES_LOCAL_USER and NOTES_LOCAL_PASSWORD, or the credentials `pnpm local` wrote. Exits when neither is there. */
export function loadCredentials() {
  if (process.env.NOTES_LOCAL_PASSWORD) {
    return {
      username: process.env.NOTES_LOCAL_USER ?? "hannah",
      password: process.env.NOTES_LOCAL_PASSWORD,
    };
  }
  try {
    return JSON.parse(readFileSync(credentialsFile, "utf8"));
  } catch {
    console.error(
      `No credentials found at ${credentialsFile}. Run \`pnpm local\` first (it creates the user),\n` +
        "or set NOTES_LOCAL_USER and NOTES_LOCAL_PASSWORD.",
    );
    process.exit(1);
  }
}

export function apiError(method, path, status, json) {
  const e = json.error ?? json;
  const detail = [e.message, e.hint, e.problems ? JSON.stringify(e.problems).slice(0, 1500) : ""]
    .filter(Boolean)
    .join("\n  ");
  return new Error(`${method} ${path} -> ${status}\n  ${detail}`);
}

/** A cookie jar and `call(method, path, body, form)` against the server's /api, as her browser does it. */
export function createSession() {
  let cookie = "";
  async function call(method, path, body, form) {
    const response = await fetch(`${serverUrl}/api${path}`, {
      method,
      headers: {
        Origin: appOrigin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const set = response.headers.getSetCookie?.() ?? [];
    if (set.length) {
      const jar = new Map(
        cookie
          .split("; ")
          .filter(Boolean)
          .map((c) => c.split(/=(.*)/s).slice(0, 2)),
      );
      for (const line of set) {
        const [pair] = line.split(";");
        const [name, value] = pair.split(/=(.*)/s);
        jar.set(name, value);
      }
      cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    if (response.status === 204) return undefined;
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(method, path, response.status, json);
    return json;
  }
  const list = async (path) => (await call("GET", path)).items ?? [];
  return { call, list };
}

/** Checks the server is up and signs in. Exits with a message when the server is not running. */
export async function signIn(call, credentials) {
  try {
    await fetch(`${serverUrl}/healthz`);
  } catch {
    console.error(`The server is not running at ${serverUrl}. Start \`pnpm local\` first.`);
    process.exit(1);
  }
  await call("POST", "/auth/login", credentials);
}
