import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default("./data"),
  DB_PATH: z.string().min(1).default("./data/notes.db"),
  WEB_DIST: z.string().min(1).optional(),
});

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(env)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

/** Directory holding the built web app. */
export function webDistDir(config: Config): string {
  return resolve(config.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname);
}
