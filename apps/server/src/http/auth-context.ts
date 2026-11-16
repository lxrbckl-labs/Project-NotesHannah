import type { Actor, ApiKeyScope } from "@notes/schema";
import type { MiddlewareHandler } from "hono";
import { AppError } from "./errors.js";

/** Who is making this request. Set by the `authenticate` middleware (accounts domain). */
export interface AuthContext {
  userId: string;
  actor: Actor;
  /** A browser session can do everything; an API key is limited to its scope. */
  via: "session" | "key";
  scope: ApiKeyScope;
}

/** Hono environment shared by every route. */
export type AppEnv = {
  Variables: {
    auth: AuthContext | null;
  };
};

/** The signed-in caller, or an `unauthenticated` error. Every domain service takes this. */
export function getAuth(c: { get(key: "auth"): AuthContext | null }): AuthContext {
  const auth = c.get("auth");
  if (!auth) throw new AppError("unauthenticated", "Sign in or send an API key.");
  return auth;
}

/** Require any signed-in caller. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  getAuth(c);
  await next();
};

/** Require a caller allowed to change things (a session, or a write key). */
export const requireWrite: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = getAuth(c);
  if (auth.scope !== "write") {
    throw new AppError("read_only_key", "This API key is read-only.", {
      hint: "Create a read-write key in Settings to make changes.",
    });
  }
  await next();
};

/** Require a browser session; API keys are refused. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = getAuth(c);
  if (auth.via !== "session") {
    throw new AppError("forbidden", "This action needs a signed-in browser session.");
  }
  await next();
};
