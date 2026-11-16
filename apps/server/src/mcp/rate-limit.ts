/** Token bucket per API key, in memory (one server process). */
export interface RateLimitOptions {
  /** Burst size: calls allowed at once. */
  capacity: number;
  /** Calls regained per second. */
  refillPerSecond: number;
}

/** Generous: a busy agent makes a few calls a second at most. */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { capacity: 120, refillPerSecond: 2 };

export function createRateLimiter(options: RateLimitOptions, now: () => number) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    /** Take one call. Returns 0 when allowed, else whole seconds until the next call is allowed. */
    take(key: string): number {
      const t = now();
      const bucket = buckets.get(key) ?? { tokens: options.capacity, at: t };
      const tokens = Math.min(
        options.capacity,
        bucket.tokens + ((t - bucket.at) / 1000) * options.refillPerSecond,
      );
      if (tokens >= 1) {
        buckets.set(key, { tokens: tokens - 1, at: t });
        return 0;
      }
      buckets.set(key, { tokens, at: t });
      return Math.max(1, Math.ceil((1 - tokens) / options.refillPerSecond));
    },
  };
}
