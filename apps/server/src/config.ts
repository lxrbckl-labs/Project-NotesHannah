import { isIP } from "node:net";
import { resolve } from "node:path";
import { z } from "zod";

/** A single origin such as `https://notes.example.app` (scheme, host, optional port; nothing else). */
const OriginString = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
    } catch {
      return false;
    }
  },
  { message: 'Expected an origin like "https://notes.example.app" (no path, no trailing slash)' },
);

/** Comma-separated IP addresses or CIDR ranges, e.g. "172.16.0.0/12,127.0.0.1". */
const ProxyList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .refine(
    (entries) =>
      entries.every((entry) => {
        const [address, bits, ...rest] = entry.split("/");
        if (rest.length > 0 || !address) return false;
        const family = isIP(address);
        if (family === 0) return false;
        if (bits === undefined) return true;
        if (!/^\d{1,3}$/.test(bits)) return false;
        return Number(bits) <= (family === 4 ? 32 : 128);
      }),
    { message: "Expected comma-separated IP addresses or CIDR ranges" },
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Uploaded originals and page images. Must hold the `.notes-storage` marker. */
    DATA_DIR: z.string().min(1).default("./data/storage"),
    /** SQLite database file; kept apart from DATA_DIR. */
    DB_PATH: z.string().min(1).default("./data/notes.db"),
    WEB_DIST: z.string().min(1).optional(),
    /** The origin the web app is served from; state-changing browser requests must match it. */
    APP_ORIGIN: OriginString.optional(),
    /** Reverse proxies whose X-Forwarded-For is believed. Empty: use the socket address only. */
    TRUSTED_PROXIES: ProxyList,
    /**
     * "1" switches the drug-name check on: concept names of type drug (the name itself, never notes or
     * user data) are sent to the US National Library of Medicine's RxNav service. Anything else (or
     * unset): off, and nothing leaves the server.
     */
    RXNORM_CHECK: z
      .string()
      .default("0")
      .refine((value) => ["", "0", "1"].includes(value), {
        message: 'Expected "1" (on) or "0" (off, the default)',
      })
      .transform((value) => value === "1"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.APP_ORIGIN) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: 'Required in production, e.g. "https://notes.example.app"',
      });
    }
  })
  .transform((env) => ({
    ...env,
    // Vite's dev server (which proxies /api) is the browser origin during development.
    APP_ORIGIN: env.APP_ORIGIN ?? "http://localhost:5173",
  }));

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
