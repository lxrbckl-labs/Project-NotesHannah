-- Answers from the RxNorm drug-name check, so a name is looked up once, not
-- every time. Keyed by the normalised name only: no note text and no user data
-- is stored here or sent to RxNav.
CREATE TABLE rxnorm_cache (
  name_key   TEXT PRIMARY KEY,
  outcome    TEXT NOT NULL,            -- NameCheckOutcome, as JSON
  fetched_at INTEGER NOT NULL
);
