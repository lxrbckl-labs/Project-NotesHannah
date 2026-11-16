import { createApp } from "../src/app.js";
import { type Config, loadConfig } from "../src/config.js";
import { createTestDatabase, type Db } from "../src/db/client.js";
import { type Argon2Params, PasswordHasher } from "../src/domains/accounts/passwords.js";
import { insertUser } from "../src/domains/accounts/users.js";

/** Cheap Argon2id parameters so tests run fast. Never use outside tests. */
export const TEST_ARGON2: Argon2Params = { memoryCost: 256, timeCost: 1, parallelism: 1 };

export const ORIGIN = "http://localhost:5173";

export class Clock {
  constructor(public ms = Date.UTC(2026, 10, 15, 12, 0, 0)) {}
  now = () => this.ms;
  advance(ms: number) {
    this.ms += ms;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  cookies?: Record<string, string>;
  origin?: string | null;
  bearer?: string;
  address?: string;
  headers?: Record<string, string>;
}

export interface TestResponse {
  status: number;
  body: unknown;
  headers: Headers;
  setCookies: Map<string, { value: string; raw: string }>;
}

export function makeTestApp(
  options: { env?: Record<string, string>; hasher?: PasswordHasher; db?: Db } = {},
) {
  const clock = new Clock();
  const db = options.db ?? createTestDatabase();
  const config: Config = loadConfig({ NODE_ENV: "test", ...options.env });
  const hasher = options.hasher ?? new PasswordHasher(TEST_ARGON2);
  const app = createApp(config, { db, now: clock.now, hasher });

  async function request(path: string, opts: RequestOptions = {}): Promise<TestResponse> {
    const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (method !== "GET" && opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (opts.cookies) {
      headers.cookie = Object.entries(opts.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }
    const env = { incoming: { socket: { remoteAddress: opts.address ?? "203.0.113.10" } } };
    const res = await app.request(path, init, env);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // keep text
    }
    const setCookies = new Map<string, { value: string; raw: string }>();
    for (const raw of res.headers.getSetCookie()) {
      const [pair = ""] = raw.split(";");
      const eq = pair.indexOf("=");
      setCookies.set(pair.slice(0, eq), { value: pair.slice(eq + 1), raw });
    }
    return { status: res.status, body, headers: res.headers, setCookies };
  }

  async function addUser(username: string, password: string, params: Argon2Params = TEST_ARGON2) {
    const hash = await new PasswordHasher(params).hash(password);
    return insertUser(db, { username, displayName: username, passwordHash: hash }, clock.now());
  }

  /** Sign in and return the cookies a browser would hold afterwards. */
  async function signIn(username: string, password: string, opts: RequestOptions = {}) {
    const res = await request("/api/auth/login", { ...opts, body: { username, password } });
    if (res.status !== 200)
      throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
    const cookies: Record<string, string> = { ...opts.cookies };
    for (const [name, { value }] of res.setCookies) cookies[name] = value;
    return { res, cookies };
  }

  return { app, db, clock, config, hasher, request, addUser, signIn };
}

export function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } })?.error?.code;
}
