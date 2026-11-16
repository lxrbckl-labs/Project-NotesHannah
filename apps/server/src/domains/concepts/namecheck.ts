import { normalizeName } from "@notes/schema";
import type { Db } from "../../db/client.js";

/**
 * The drug-name check (F4): does RxNorm know this name, and if not, what does
 * it think was meant? It is advisory. A failure leaves the concept unchecked
 * and never stops a concept from being saved.
 */
export type NameCheckOutcome =
  | { status: "matched"; rxcui: string | null }
  | { status: "suggestion"; suggested: string; rxcui: string | null }
  | { status: "unknown" }
  /** The check could not be done (network, timeout, a bad answer). Never stored. */
  | { status: "failed"; reason: string };

export interface DrugNameChecker {
  /** Only a name goes in: never a note, a citation or anything about the user. */
  check(name: string): Promise<NameCheckOutcome>;
}

/**
 * The check is off unless `RXNORM_CHECK=1`: it sends drug names (never notes
 * or user data) to the US National Library of Medicine's public RxNav service.
 */
export function rxnormEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RXNORM_CHECK === "1";
}

// ---- a fake for tests ------------------------------------------------------------------

export interface FakeDrugNameChecker extends DrugNameChecker {
  /** Names (any case) that match, with an optional RxCUI. */
  match(name: string, rxcui?: string): void;
  /** Names that do not match but have a suggestion. */
  suggest(name: string, suggested: string, rxcui?: string): void;
  /** Make every call fail until `recover`. */
  fail(reason?: string): void;
  recover(): void;
  /** Names it was asked about, in order. */
  readonly calls: string[];
}

/** Knows only what it is told; anything else is "unknown". */
export function createFakeDrugNameChecker(): FakeDrugNameChecker {
  const matches = new Map<string, string | null>();
  const suggestions = new Map<string, { suggested: string; rxcui: string | null }>();
  let failure: string | null = null;
  const calls: string[] = [];
  return {
    calls,
    match(name, rxcui) {
      matches.set(normalizeName(name), rxcui ?? null);
    },
    suggest(name, suggested, rxcui) {
      suggestions.set(normalizeName(name), { suggested, rxcui: rxcui ?? null });
    },
    fail(reason = "the service is down") {
      failure = reason;
    },
    recover() {
      failure = null;
    },
    async check(name) {
      calls.push(name);
      if (failure !== null) return { status: "failed", reason: failure };
      const key = normalizeName(name);
      if (matches.has(key)) return { status: "matched", rxcui: matches.get(key) ?? null };
      const suggestion = suggestions.get(key);
      if (suggestion) return { status: "suggestion", ...suggestion };
      return { status: "unknown" };
    },
  };
}

// ---- rate limiting ------------------------------------------------------------------------

/**
 * RxNav allows 20 requests per second per IP. This spaces requests at least
 * `1000 / perSecond` ms apart (default 5 per second, a quarter of the limit),
 * one after another, whoever asks.
 */
export interface RateLimiter {
  /** Resolves when the caller may send one request. */
  acquire(): Promise<void>;
}

export function createRateLimiter(
  options: { perSecond?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): RateLimiter {
  const interval = 1000 / (options.perSecond ?? 5);
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let nextSlot = 0;
  return {
    async acquire() {
      const t = now();
      const slot = Math.max(t, nextSlot);
      nextSlot = slot + interval;
      if (slot > t) await sleep(slot - t);
    },
  };
}

// ---- cache ---------------------------------------------------------------------------------------

export type CachedOutcome = Exclude<NameCheckOutcome, { status: "failed" }>;

export interface NameCheckCache {
  get(key: string): CachedOutcome | null;
  set(key: string, outcome: CachedOutcome): void;
}

export function createMemoryNameCache(): NameCheckCache & { size(): number } {
  const map = new Map<string, CachedOutcome>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, outcome) => void map.set(key, outcome),
    size: () => map.size,
  };
}

const DAY = 24 * 60 * 60_000;

/** Answers kept in the database, so a restart does not ask again. They expire after `ttlMs` (default 30 days). */
export function createDbNameCache(
  db: Db,
  now: () => number = Date.now,
  ttlMs = 30 * DAY,
): NameCheckCache {
  const read = db.prepare("SELECT outcome, fetched_at FROM rxnorm_cache WHERE name_key = ?");
  const write = db.prepare(
    `INSERT INTO rxnorm_cache (name_key, outcome, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT (name_key) DO UPDATE SET outcome = excluded.outcome, fetched_at = excluded.fetched_at`,
  );
  return {
    get(key) {
      const row = read.get(key) as { outcome: string; fetched_at: number } | undefined;
      if (!row || now() - row.fetched_at > ttlMs) return null;
      try {
        return JSON.parse(row.outcome) as CachedOutcome;
      } catch {
        return null;
      }
    },
    set(key, outcome) {
      write.run(key, JSON.stringify(outcome), now());
    },
  };
}

// ---- the real client ---------------------------------------------------------------------------------

export interface RxNavOptions {
  /** Default https://rxnav.nlm.nih.gov. */
  baseUrl?: string;
  /** Injected in tests, which never touch the network. */
  fetch?: typeof fetch;
  cache?: NameCheckCache;
  limiter?: RateLimiter;
  /** Per request. Default 5 seconds. */
  timeoutMs?: number;
  now?: () => number;
  /** After a failure, stay quiet this long instead of asking again. Default 60 seconds. */
  backoffMs?: number;
  /** Candidates scoring below this are not offered as suggestions. Default 5. */
  minScore?: number;
}

interface ApproximateAnswer {
  approximateGroup?: { candidate?: Array<{ rxcui?: string; score?: string; rank?: string }> };
}
interface IdAnswer {
  idGroup?: { rxnormId?: string[] };
}
interface PropertiesAnswer {
  properties?: { rxcui?: string; name?: string; tty?: string };
}

class CheckFailure extends Error {}

/** Term types, best first: an ingredient is what a drug concept names. */
const TTY_ORDER = ["IN", "PIN", "MIN", "BN"];

/**
 * Checks names against RxNav, the National Library of Medicine's free RxNorm
 * REST API (https://rxnav.nlm.nih.gov/REST, no key). A name is looked up as an
 * exact (normalised) match first; if RxNorm does not know it, the approximate
 * matcher proposes the nearest name, which becomes a suggestion. Requests are
 * spaced well under the 20 per second limit, time out, and any trouble yields
 * `failed`, which the caller treats as "still unchecked".
 */
export function createRxNavChecker(options: RxNavOptions = {}): DrugNameChecker {
  const base = (options.baseUrl ?? "https://rxnav.nlm.nih.gov").replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;
  const cache = options.cache ?? createMemoryNameCache();
  const limiter = options.limiter ?? createRateLimiter();
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = options.now ?? Date.now;
  const backoffMs = options.backoffMs ?? 60_000;
  const minScore = options.minScore ?? 5;
  let quietUntil = 0;

  async function get<T>(path: string): Promise<T> {
    await limiter.acquire();
    let response: Response;
    try {
      response = await doFetch(`${base}/REST/${path}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new CheckFailure(timedOut ? "RxNav timed out" : "RxNav could not be reached");
    }
    if (!response.ok) throw new CheckFailure(`RxNav answered ${response.status}`);
    try {
      return (await response.json()) as T;
    } catch {
      throw new CheckFailure("RxNav sent an answer that is not JSON");
    }
  }

  const props = async (rxcui: string) =>
    (await get<PropertiesAnswer>(`rxcui/${encodeURIComponent(rxcui)}/properties.json`)).properties;

  /** Of several RxCUIs for one name, the ingredient if there is one. */
  async function pickBest(ids: string[]): Promise<string> {
    const first = ids[0] as string;
    if (ids.length === 1) return first;
    let best = first;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const id of ids.slice(0, 3)) {
      const tty = (await props(id))?.tty ?? "";
      const rank = TTY_ORDER.indexOf(tty);
      const score = rank === -1 ? TTY_ORDER.length : rank;
      if (score < bestRank) {
        best = id;
        bestRank = score;
      }
    }
    return best;
  }

  async function lookup(name: string): Promise<CachedOutcome> {
    const exact = await get<IdAnswer>(`rxcui.json?name=${encodeURIComponent(name)}&search=1`);
    const ids = exact.idGroup?.rxnormId ?? [];
    if (ids.length > 0) return { status: "matched", rxcui: await pickBest(ids) };

    const near = await get<ApproximateAnswer>(
      `approximateTerm.json?term=${encodeURIComponent(name)}&maxEntries=4`,
    );
    const candidates = (near.approximateGroup?.candidate ?? [])
      .filter((c) => c.rxcui && Number(c.score) >= minScore)
      .sort((a, b) => Number(a.rank) - Number(b.rank) || Number(b.score) - Number(a.score));
    const top = candidates[0]?.rxcui;
    if (!top) return { status: "unknown" };
    const named = await props(top);
    if (!named?.name) return { status: "unknown" };
    if (normalizeName(named.name) === normalizeName(name)) return { status: "matched", rxcui: top };
    return { status: "suggestion", suggested: named.name, rxcui: top };
  }

  return {
    async check(name) {
      const key = normalizeName(name);
      if (key.length === 0) return { status: "unknown" };
      const cached = cache.get(key);
      if (cached) return cached;
      if (now() < quietUntil)
        return { status: "failed", reason: "RxNav is being given a rest after an error" };
      try {
        const outcome = await lookup(name.trim());
        cache.set(key, outcome);
        return outcome;
      } catch (error) {
        quietUntil = now() + backoffMs;
        return {
          status: "failed",
          reason: error instanceof CheckFailure ? error.message : "the check failed",
        };
      }
    },
  };
}

/** The checker the server should use: RxNav with a database cache when `RXNORM_CHECK=1`, otherwise none. */
export function nameCheckerFromEnv(
  db: Db,
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): DrugNameChecker | undefined {
  if (!rxnormEnabled(env)) return undefined;
  return createRxNavChecker({ cache: createDbNameCache(db, now), now });
}
