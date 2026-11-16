-- The structured layer: typed concepts and typed relations between them.
-- No foreign keys to other lanes' tables (users, files, documents): a
-- concept lives across courses and its sources are only named by citations.

CREATE TABLE concepts (
  seq               INTEGER PRIMARY KEY,
  id                TEXT NOT NULL UNIQUE,
  user_id           TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('drug', 'drug_class', 'mechanism', 'target', 'indication',
                      'adverse_effect', 'interaction', 'contraindication', 'monitoring_parameter',
                      'counselling_point', 'other')),
  name              TEXT NOT NULL,
  -- The normalised name: what makes two concepts "the same" (with the type).
  name_key          TEXT NOT NULL,
  aliases           TEXT NOT NULL DEFAULT '[]',     -- string[], as JSON
  drug              TEXT,                           -- DrugInfo, as JSON (drugs only)
  summary           TEXT NOT NULL DEFAULT '[]',     -- rich text, as JSON
  citations         TEXT NOT NULL DEFAULT '[]',     -- Citation[], as JSON
  general_knowledge INTEGER NOT NULL DEFAULT 0 CHECK (general_knowledge IN (0, 1)),
  review_status     TEXT NOT NULL CHECK (review_status IN ('unverified', 'reviewed')),
  origin            TEXT NOT NULL CHECK (origin IN ('agent', 'user')),
  created_by        TEXT NOT NULL,                  -- Actor, as JSON
  created_at        TEXT NOT NULL,
  last_edited_by    TEXT NOT NULL,
  last_edited_at    TEXT NOT NULL,
  -- Name, aliases, generic and brand names, normalised, for the search index.
  search_text       TEXT NOT NULL
);

-- One concept per type and normalised name, per user.
CREATE UNIQUE INDEX concepts_identity ON concepts (user_id, type, name_key);
CREATE INDEX concepts_browse ON concepts (user_id, name_key, seq);

-- Name, alias and brand search with prefix matching: external-content FTS5
-- kept in step by triggers.
CREATE VIRTUAL TABLE concepts_fts USING fts5 (
  search_text,
  content = 'concepts',
  content_rowid = 'seq',
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);

CREATE TRIGGER concepts_fts_insert AFTER INSERT ON concepts BEGIN
  INSERT INTO concepts_fts (rowid, search_text) VALUES (new.seq, new.search_text);
END;

CREATE TRIGGER concepts_fts_delete AFTER DELETE ON concepts BEGIN
  INSERT INTO concepts_fts (concepts_fts, rowid, search_text) VALUES ('delete', old.seq, old.search_text);
END;

CREATE TRIGGER concepts_fts_update AFTER UPDATE OF search_text ON concepts BEGIN
  INSERT INTO concepts_fts (concepts_fts, rowid, search_text) VALUES ('delete', old.seq, old.search_text);
  INSERT INTO concepts_fts (rowid, search_text) VALUES (new.seq, new.search_text);
END;

-- Merged concepts: the old ID keeps working and leads to the one that remains.
-- Always one hop: a merge re-points earlier redirects.
CREATE TABLE concept_redirects (
  from_id   TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  to_id     TEXT NOT NULL,
  merged_at TEXT NOT NULL
);
CREATE INDEX concept_redirects_to ON concept_redirects (user_id, to_id);

CREATE TABLE concept_relations (
  seq               INTEGER PRIMARY KEY,
  id                TEXT NOT NULL UNIQUE,
  user_id           TEXT NOT NULL,
  from_id           TEXT NOT NULL,
  to_id             TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('belongs_to_class', 'has_mechanism', 'acts_on', 'treats',
                      'causes_adverse_effect', 'interacts_with', 'contraindicated_in', 'monitored_by',
                      'brand_of', 'related_to')),
  -- type plus both ends, ordered when the relation is symmetric: one row per fact.
  pair_key          TEXT NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  interaction       TEXT,                           -- { severity, effect }, as JSON
  citations         TEXT NOT NULL DEFAULT '[]',
  general_knowledge INTEGER NOT NULL DEFAULT 0 CHECK (general_knowledge IN (0, 1)),
  review_status     TEXT NOT NULL CHECK (review_status IN ('unverified', 'reviewed')),
  origin            TEXT NOT NULL CHECK (origin IN ('agent', 'user')),
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  last_edited_by    TEXT NOT NULL,
  last_edited_at    TEXT NOT NULL,
  CHECK (from_id != to_id)
);

CREATE UNIQUE INDEX concept_relations_identity ON concept_relations (user_id, pair_key);
CREATE INDEX concept_relations_from ON concept_relations (user_id, from_id, type);
CREATE INDEX concept_relations_to ON concept_relations (user_id, to_id, type);

-- One row per cited page of a concept or relation, for "what cites this page" (K5)
-- and for finding what a deleted source leaves without a citation.
CREATE TABLE concept_citations (
  seq        INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('concept', 'relation')),
  owner_id   TEXT NOT NULL,
  file_id    TEXT NOT NULL,
  page_id    TEXT NOT NULL
);
CREATE INDEX concept_citations_page ON concept_citations (user_id, page_id);
CREATE INDEX concept_citations_file ON concept_citations (user_id, file_id);
CREATE INDEX concept_citations_owner ON concept_citations (owner_kind, owner_id);
