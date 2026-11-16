import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "../config.js";
import { DEVICE_TTL_MS } from "../domains/accounts/devices.js";
import { SESSION_TTL_MS } from "../domains/accounts/sessions.js";

/**
 * In production the cookies use the `__Host-` prefix: the browser then only
 * accepts them over HTTPS, for this exact host, with Path=/ and no Domain, so
 * a sibling subdomain cannot plant or overwrite them.
 */
function names(config: Config) {
  const prefix = config.NODE_ENV === "production" ? "__Host-" : "";
  return { session: `${prefix}nh_session`, device: `${prefix}nh_device` };
}

function options(config: Config, maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "Strict" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export function readSessionCookie(c: Context, config: Config): string | undefined {
  return getCookie(c, names(config).session);
}

export function writeSessionCookie(c: Context, config: Config, token: string): void {
  setCookie(c, names(config).session, token, options(config, SESSION_TTL_MS));
}

export function clearSessionCookie(c: Context, config: Config): void {
  const { maxAge: _ignored, ...rest } = options(config, 0);
  deleteCookie(c, names(config).session, rest);
}

export function readDeviceCookie(c: Context, config: Config): string | undefined {
  return getCookie(c, names(config).device);
}

export function writeDeviceCookie(c: Context, config: Config, token: string): void {
  setCookie(c, names(config).device, token, options(config, DEVICE_TTL_MS));
}
