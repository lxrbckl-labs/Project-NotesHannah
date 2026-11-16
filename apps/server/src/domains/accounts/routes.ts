import { ChangePasswordInput, CreateApiKeyInput, LoginInput } from "@notes/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { type AppEnv, getAuth, requireAuth, requireSession } from "../../http/auth-context.js";
import { proxyMatcher, resolveClientAddress, socketAddress } from "../../http/client-address.js";
import {
  clearSessionCookie,
  readDeviceCookie,
  readSessionCookie,
  writeDeviceCookie,
  writeSessionCookie,
} from "../../http/cookies.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { parseJson } from "../../http/validate.js";
import { createApiKey, listApiKeys, revokeApiKey } from "./keys.js";
import { BAD_CREDENTIALS, changePassword, login } from "./service.js";
import { deleteSession, deleteUserSessions, resolveSession } from "./sessions.js";
import { findUserById, normaliseUsername, toUser } from "./users.js";

/** Account and key bodies are tiny; refuse anything big before parsing it. */
const smallBody = bodyLimit({
  maxSize: 16 * 1024,
  onError: () => {
    throw new AppError("too_large", "The request body is too large.");
  },
});

/** Sign-in body before username normalisation; `LoginInput` is applied afterwards. */
const LoginBody = z.object({
  username: z.string().max(256),
  password: LoginInput.shape.password,
});

/** Sign-in, sign-out, the current user and password change (A1 to A4). */
export function accountRoutes(deps: ServerDeps): Hono<AppEnv> {
  const { db, config } = deps;
  const isTrustedProxy = proxyMatcher(config.TRUSTED_PROXIES);
  const clientAddress = (c: Context) =>
    resolveClientAddress(socketAddress(c), c.req.header("x-forwarded-for"), isTrustedProxy);

  const app = new Hono<AppEnv>();

  app.post("/auth/login", smallBody, async (c) => {
    // Usernames are normalised before the schema check, so " Hannah " signs in as "hannah".
    const raw = await parseJson(c, LoginBody, { username: "hannah", password: "your password" });
    const input = LoginInput.safeParse({ ...raw, username: normaliseUsername(raw.username) });
    if (!input.success) {
      // A malformed username cannot be anybody's: same answer as a wrong password, no hash needed.
      throw new AppError("unauthenticated", BAD_CREDENTIALS);
    }
    const result = await login(deps, {
      username: input.data.username,
      password: input.data.password,
      address: clientAddress(c),
      deviceToken: readDeviceCookie(c, config),
      userAgent: c.req.header("user-agent")?.slice(0, 200) ?? null,
    });
    // End the session this browser held before, so a planted token cannot survive sign-in.
    const previous = readSessionCookie(c, config);
    const old = previous ? resolveSession(db, previous, deps.now()) : null;
    if (old) deleteSession(db, old.sessionId);
    writeSessionCookie(c, config, result.sessionToken);
    writeDeviceCookie(c, config, result.deviceToken);
    return c.json({ user: result.user });
  });

  app.post("/auth/logout", (c) => {
    const auth = c.get("auth");
    if (auth?.via === "session" && auth.sessionId) deleteSession(db, auth.sessionId);
    clearSessionCookie(c, config);
    return c.body(null, 204);
  });

  app.post("/auth/logout-all", requireSession, (c) => {
    deleteUserSessions(db, getAuth(c).userId);
    clearSessionCookie(c, config);
    return c.body(null, 204);
  });

  app.get("/me", requireAuth, (c) => {
    const user = findUserById(db, getAuth(c).userId);
    if (!user) throw new AppError("unauthenticated", "Sign in again.");
    return c.json({ user: toUser(user) });
  });

  app.post("/me/password", requireSession, smallBody, async (c) => {
    const auth = getAuth(c);
    const input = await parseJson(c, ChangePasswordInput, {
      currentPassword: "your current password",
      newPassword: "at least ten characters",
    });
    await changePassword(deps, {
      userId: auth.userId,
      sessionId: auth.sessionId as string,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      address: clientAddress(c),
      deviceToken: readDeviceCookie(c, config),
    });
    return c.body(null, 204);
  });

  return app;
}

/** API key management (A5). Browser session only, never an API key. */
export function keyRoutes(deps: ServerDeps): Hono<AppEnv> {
  const { db } = deps;
  const app = new Hono<AppEnv>();
  app.use("/keys", requireSession);
  app.use("/keys/*", requireSession);

  app.get("/keys", (c) => c.json({ items: listApiKeys(db, getAuth(c).userId) }));

  app.post("/keys", smallBody, async (c) => {
    const input = await parseJson(c, CreateApiKeyInput, { name: "Claude Code", scope: "write" });
    return c.json(createApiKey(db, getAuth(c).userId, input, deps.now()), 201);
  });

  app.delete("/keys/:id", (c) => {
    revokeApiKey(db, getAuth(c).userId, c.req.param("id"), deps.now());
    return c.body(null, 204);
  });

  return app;
}
