import { BlockList, isIP } from "node:net";
import type { Context } from "hono";

/** `::ffff:1.2.3.4` and `1.2.3.4` are the same client. */
export function normaliseAddress(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped?.[1] ?? trimmed.toLowerCase();
}

/** Build a matcher for TRUSTED_PROXIES entries (addresses or CIDR ranges). */
export function proxyMatcher(entries: string[]): (address: string) => boolean {
  if (entries.length === 0) return () => false;
  const list = new BlockList();
  for (const entry of entries) {
    const [address = "", bits] = entry.split("/");
    const normal = normaliseAddress(address);
    const type = isIP(normal) === 6 ? "ipv6" : "ipv4";
    if (bits === undefined) list.addAddress(normal, type);
    else list.addSubnet(normal, Number(bits), type);
  }
  return (address) => {
    const normal = normaliseAddress(address);
    const family = isIP(normal);
    if (family === 0) return false;
    return list.check(normal, family === 6 ? "ipv6" : "ipv4");
  };
}

/**
 * The client address used for rate limits. It is the TCP peer, unless the
 * peer is a trusted proxy: then X-Forwarded-For is walked from the right
 * (entries appended by our own proxies) and the first address that is not a
 * trusted proxy is the client. Entries to the left of it were written by the
 * client and are ignored, so a client cannot choose its own address.
 */
export function resolveClientAddress(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
  isTrusted: (address: string) => boolean,
): string {
  const peer = socketAddress ? normaliseAddress(socketAddress) : "unknown";
  if (!socketAddress || !isTrusted(peer) || !forwardedFor) return peer;
  const hops = forwardedFor
    .split(",")
    .map((hop) => normaliseAddress(hop))
    .filter((hop) => hop.length > 0);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i] as string;
    if (isIP(hop) === 0) return `invalid:${hop.slice(0, 64)}`;
    if (!isTrusted(hop)) return hop;
  }
  // Every hop is a trusted proxy: the left-most is the closest we have to a client.
  return hops[0] ?? peer;
}

/** The TCP peer address from @hono/node-server's bindings (absent under `app.request` in tests). */
export function socketAddress(c: Context): string | undefined {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress;
}
