// Shared settings for the local scripts. Everything can be overridden with NOTES_* variables,
// so a test run can use its own ports and its own data directory beside the everyday one.
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const localDir = resolve(process.env.NOTES_LOCAL_DIR ?? join(root, "data", "local"));
export const serverPort = Number(process.env.NOTES_SERVER_PORT ?? 3000);
export const webPort = Number(process.env.NOTES_WEB_PORT ?? 5173);
export const appOrigin = `http://localhost:${webPort}`;
export const serverUrl = `http://localhost:${serverPort}`;
export const storageDir = join(localDir, "storage");
export const dbPath = join(localDir, "notes.db");
export const credentialsFile = join(localDir, "credentials.json");
export const composeFile = join(root, "deploy", "docker-compose.converter.yml");
/** One compose project per data directory, so two local runs never share a container. */
export const composeProject = `notes-local-${createHash("sha256").update(localDir).digest("hex").slice(0, 8)}`;

/** The environment the server and the admin commands run with. */
export function serverEnv() {
  const env = { ...process.env };
  env.NODE_ENV = "development";
  env.PORT = String(serverPort);
  env.DATA_DIR = storageDir;
  env.DB_PATH = dbPath;
  env.APP_ORIGIN = appOrigin;
  // The mock must never be on when talking to the real server.
  delete env.VITE_MOCK_API;
  return env;
}
