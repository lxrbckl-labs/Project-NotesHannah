-- Accounts, sessions, API keys and sign-in throttling.
-- Times are integer milliseconds since the epoch (UTC); the API turns them into ISO strings.
-- Secrets (session tokens, API keys, device tokens) are stored only as SHA-256 digests.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
) STRICT;

CREATE TABLE password_hashes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Argon2id PHC string; carries its own parameters so they can be raised later.
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BLOB NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
) STRICT;
CREATE INDEX sessions_by_user ON sessions(user_id);
CREATE INDEX sessions_by_expiry ON sessions(expires_at);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  secret_hash BLOB NOT NULL UNIQUE,
  preview TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
) STRICT;
CREATE INDEX api_keys_by_user ON api_keys(user_id, created_at);

-- Failure counters for sign-in, per account (by submitted username, so unknown
-- usernames behave exactly like real ones) and per client address.
CREATE TABLE login_throttle (
  kind TEXT NOT NULL CHECK (kind IN ('account', 'address')),
  subject TEXT NOT NULL,
  failures INTEGER NOT NULL,
  last_failure_at INTEGER NOT NULL,
  locked_until INTEGER,
  PRIMARY KEY (kind, subject)
) STRICT;

-- Browsers that have signed in to an account before. A known device may sign
-- in while the account is locked (the per-address limit still applies), so an
-- attacker cannot lock the real user out. See accounts/throttle.ts.
CREATE TABLE known_devices (
  token_hash BLOB NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (token_hash, user_id)
) STRICT;
CREATE INDEX known_devices_by_user ON known_devices(user_id);

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
