import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import type { PasswordHasher } from "../domains/accounts/passwords.js";

/** What route factories and middleware need. Tests pass their own clock and a cheap hasher. */
export interface ServerDeps {
  config: Config;
  db: Db;
  /** Milliseconds since the epoch. */
  now: () => number;
  hasher: PasswordHasher;
}
