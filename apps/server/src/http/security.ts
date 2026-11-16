import type { MiddlewareHandler } from "hono";
import type { Config } from "../config.js";
import type { AppEnv } from "./auth-context.js";
import { AppError } from "./errors.js";

/**
 * CSP for the Vite-built SPA served from this origin: scripts, styles,
 * fonts and API calls from 'self' only, no inline script, no plugins, no
 * framing. Inline `style` attributes (React's `style` prop) stay allowed
 * through style-src-attr; <style> elements do not. Images may also be
 * blob:/data: (previews of a file being uploaded, page thumbnails).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Headers on every response, including errors and static files. */
export function securityHeaders(config: Config): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "no-referrer");
    h.set("X-Robots-Tag", "noindex, nofollow");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    h.set("Permissions-Policy", "geolocation=(), microphone=(), payment=(), usb=()");
    if (config.NODE_ENV === "production") {
      h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    if (c.req.path.startsWith("/api/") || c.req.path === "/api") {
      h.set("Cache-Control", "no-store");
    }
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request refusal for browser requests. Every state-changing
 * request that is not authenticated by an API key (a session cookie, or no
 * credential at all, as at sign-in) is refused with `forbidden` when its
 * Origin header is present and differs from APP_ORIGIN, or when it has no
 * Origin but the browser marks it `Sec-Fetch-Site: cross-site`. API-key
 * requests are exempt: they carry no ambient credential a third-party page
 * could borrow. Runs after `authenticate`.
 */
export function originCheck(config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.get("auth")?.via !== "key") {
      const origin = c.req.header("origin");
      const fetchSite = c.req.header("sec-fetch-site");
      const refused =
        origin !== undefined ? origin !== config.APP_ORIGIN : fetchSite === "cross-site";
      if (refused) {
        throw new AppError("forbidden", "Cross-site request refused.", {
          hint: `Requests that change data must come from ${config.APP_ORIGIN}.`,
        });
      }
    }
    await next();
  };
}
