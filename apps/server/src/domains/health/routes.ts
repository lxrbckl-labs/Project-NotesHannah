import { readFileSync } from "node:fs";
import { Hono } from "hono";

function readVersion(): string {
  const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

export const healthRoutes = new Hono().get("/healthz", (c) =>
  c.json({ ok: true as const, version: readVersion() }),
);
