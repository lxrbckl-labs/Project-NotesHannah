import { hash, parseOptions, verify } from "@node-rs/argon2";
import { AppError } from "../../http/errors.js";

/**
 * Argon2id parameters. The PHC string stored for each user records the
 * parameters it was made with, so these can be raised at any time: a stored
 * hash weaker than the current parameters is replaced at the next successful
 * sign-in.
 */
export interface Argon2Params {
  /** KiB of memory per hash. */
  memoryCost: number;
  /** Passes over memory. */
  timeCost: number;
  parallelism: number;
}

/**
 * 64 MiB, 3 passes, 1 lane: above the OWASP Password Storage Cheat Sheet
 * minimum for Argon2id (19 MiB, t=2, p=1) and equal to RFC 9106's second
 * recommended option in memory and passes.
 */
export const DEFAULT_ARGON2: Argon2Params = { memoryCost: 65536, timeCost: 3, parallelism: 1 };

/** `Algorithm.Argon2id` in @node-rs/argon2 (a const enum, which isolatedModules cannot import). */
const ARGON2ID = 2;

/** Hashes running at once (each holds `memoryCost` KiB) and requests allowed to wait for one. */
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 32;

/**
 * Passwords are normalised to NFC so the same password typed on different
 * keyboards (composed vs decomposed accents) hashes the same.
 */
function normalise(password: string): string {
  return password.normalize("NFC");
}

export class PasswordHasher {
  readonly params: Argon2Params;
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private dummy: Promise<string> | null = null;

  constructor(params: Argon2Params = DEFAULT_ARGON2) {
    this.params = params;
  }

  /** Bound memory use: at most MAX_CONCURRENT hashes at once, a short queue, then `rate_limited`. */
  private async withSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= MAX_CONCURRENT) {
      if (this.waiting.length >= MAX_QUEUED) {
        throw new AppError("rate_limited", "The server is busy. Try again in a moment.", {
          retryAfter: 2,
        });
      }
      // The finishing holder hands its slot straight to us; `running` is unchanged.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running -= 1;
    }
  }

  hash(password: string): Promise<string> {
    return this.withSlot(() =>
      hash(normalise(password), {
        memoryCost: this.params.memoryCost,
        timeCost: this.params.timeCost,
        parallelism: this.params.parallelism,
        outputLen: 32,
      }),
    );
  }

  /** False for a wrong password and for a malformed stored hash. */
  verify(stored: string, password: string): Promise<boolean> {
    return this.withSlot(async () => {
      try {
        return await verify(stored, normalise(password));
      } catch {
        return false;
      }
    });
  }

  /**
   * Spend the same time as a real verify, for usernames that do not exist,
   * so response timing does not reveal which usernames are real.
   */
  async verifyDummy(password: string): Promise<false> {
    await this.verify(await this.dummyHash(), password);
    return false;
  }

  /** Compute the dummy hash ahead of the first sign-in. */
  warmUp(): Promise<unknown> {
    return this.dummyHash();
  }

  private dummyHash(): Promise<string> {
    this.dummy ??= this.hash(`dummy-${Math.random()}-${Date.now()}`);
    return this.dummy;
  }

  /** True when the stored hash is not Argon2id or is weaker than the current parameters. */
  needsRehash(stored: string): boolean {
    try {
      const parsed = parseOptions(stored);
      return (
        (parsed.algorithm as number) !== ARGON2ID ||
        parsed.memoryCost < this.params.memoryCost ||
        parsed.timeCost < this.params.timeCost ||
        parsed.parallelism < this.params.parallelism ||
        parsed.outputLen < 32
      );
    } catch {
      return true;
    }
  }
}
