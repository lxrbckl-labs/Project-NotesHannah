import type { MiddlewareHandler } from "hono";
import { authenticateApiKey } from "../domains/accounts/keys.js";
import { resolveSession } from "../domains/accounts/sessions.js";
import type { AppEnv, AuthContext } from "./auth-context.js";
import { readSessionCookie, writeSessionCookie } from "./cookies.js";
import type { ServerDeps } from "./deps.js";
import { AppError } from "./errors.js";

export const AGENT_LABEL_MAX = 80;

/** The optional `X-Agent-Label` header: trimmed, control characters removed, at most 80 characters. */
export function agentLabel(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const label = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (label.length === 0) return undefined;
  if (label.length > AGENT_LABEL_MAX) {
    throw new AppError(
      "invalid_input",
      `X-Agent-Label is longer than ${AGENT_LABEL_MAX} characters.`,
      {
        example: "Claude Code",
      },
    );
  }
  return label;
}

/**
 * Resolve the caller into `c.get("auth")`: an `Authorization: Bearer` API key
 * or the session cookie, else null. When an Authorization header is present
 * it alone decides (no fallback to the cookie), so a request is never
 * half-key, half-session. Mount on /api/* and /mcp.
 */
export function authenticate(deps: ServerDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let auth: AuthContext | null = null;
    const header = c.req.header("authorization");
    if (header !== undefined) {
      const match = /^Bearer[ ]+(\S+)\s*$/i.exec(header);
      const key = match?.[1] ? authenticateApiKey(deps.db, match[1], deps.now()) : null;
      if (key) {
        const label = agentLabel(c.req.header("x-agent-label"));
        auth = {
          userId: key.userId,
          actor: { type: "agent", keyId: key.keyId, ...(label ? { label } : {}) },
          via: "key",
          scope: key.scope,
        };
      }
    } else {
      const token = readSessionCookie(c, deps.config);
      const session = token ? resolveSession(deps.db, token, deps.now()) : null;
      if (session && token) {
        if (session.refreshed) writeSessionCookie(c, deps.config, token);
        auth = {
          userId: session.userId,
          actor: { type: "user", userId: session.userId },
          via: "session",
          scope: "write",
          sessionId: session.sessionId,
        };
      }
    }
    c.set("auth", auth);
    await next();
  };
}
