-- Practice: questions, sessions, attempts and card states.
-- `user_id` and `node_id` carry no foreign keys on purpose (the users and
-- library tables belong to other lanes; the node hooks keep them in step).

-- A stored question. `data` is the full validated JSON (the shared `Question`);
-- the other columns are extracted for filtering and listing.
CREATE TABLE questions (
  seq             INTEGER PRIMARY KEY,
  id              TEXT NOT NULL UNIQUE,
  user_id         TEXT NOT NULL,
  type            TEXT NOT NULL,
  difficulty      INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  review_status   TEXT NOT NULL CHECK (review_status IN ('unverified', 'reviewed')),
  author_type     TEXT NOT NULL CHECK (author_type IN ('agent', 'user')),
  author          TEXT NOT NULL,
  general_knowledge INTEGER NOT NULL CHECK (general_knowledge IN (0, 1)),
  text            TEXT NOT NULL,
  data            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  trashed_at      TEXT
);
CREATE INDEX questions_user ON questions (user_id, seq);
CREATE INDEX questions_user_type ON questions (user_id, type);

-- Where a question lives: one or more lectures, folders or documents.
-- `node_trashed` is set by the node hooks when that node goes to the trash.
CREATE TABLE question_nodes (
  question_id  TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  node_trashed INTEGER NOT NULL DEFAULT 0 CHECK (node_trashed IN (0, 1)),
  PRIMARY KEY (question_id, node_id)
);
CREATE INDEX question_nodes_node ON question_nodes (user_id, node_id);

CREATE TABLE question_tags (
  question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  tag         TEXT NOT NULL,
  PRIMARY KEY (question_id, tag)
);
CREATE INDEX question_tags_tag ON question_tags (user_id, tag);

CREATE TABLE question_concepts (
  question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  concept_id  TEXT NOT NULL,
  PRIMARY KEY (question_id, concept_id)
);
CREATE INDEX question_concepts_concept ON question_concepts (user_id, concept_id);

-- One row per citation on a question, for "what cites this page" (K5).
CREATE TABLE question_citations (
  seq         INTEGER PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  file_id     TEXT NOT NULL,
  page_id     TEXT NOT NULL,
  quote       TEXT NOT NULL,
  region      TEXT
);
CREATE INDEX question_citations_page ON question_citations (user_id, page_id, seq);
CREATE INDEX question_citations_file ON question_citations (user_id, file_id, seq);
CREATE INDEX question_citations_question ON question_citations (question_id);

-- A practice session. The server stores the question order and every seed, so
-- a session is reproducible and resumes on any device.
CREATE TABLE practice_sessions (
  seq          INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL,
  scope        TEXT NOT NULL,
  formats      TEXT NOT NULL,
  length       INTEGER NOT NULL,
  seed         INTEGER NOT NULL,
  items        TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('active', 'finished', 'abandoned')),
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  abandoned_at TEXT
);
CREATE INDEX practice_sessions_user ON practice_sessions (user_id, seq DESC);

-- One graded answer. A question deleted for good leaves its attempts behind
-- (history), so there is no foreign key on `question_id`.
CREATE TABLE attempts (
  seq           INTEGER PRIMARY KEY,
  id            TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL,
  session_id    TEXT REFERENCES practice_sessions (id) ON DELETE CASCADE,
  position      INTEGER,
  question_id   TEXT NOT NULL,
  variant_seed  INTEGER,
  answer_type   TEXT NOT NULL,
  answer        TEXT NOT NULL,
  result        TEXT NOT NULL,
  correct       INTEGER NOT NULL CHECK (correct IN (0, 1)),
  score         REAL NOT NULL,
  time_taken_ms INTEGER NOT NULL,
  at            TEXT NOT NULL
);
-- A position in a session is answered once.
CREATE UNIQUE INDEX attempts_slot ON attempts (session_id, position) WHERE session_id IS NOT NULL;
CREATE INDEX attempts_user_time ON attempts (user_id, at, seq);
CREATE INDEX attempts_question ON attempts (user_id, question_id, seq);

-- Spaced-repetition state per (user, question). `state` is the scheduler's CardState.
CREATE TABLE card_states (
  seq         INTEGER PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  state       TEXT NOT NULL,
  phase       TEXT NOT NULL CHECK (phase IN ('new', 'review')),
  due         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX card_states_question ON card_states (user_id, question_id);
CREATE INDEX card_states_due ON card_states (user_id, phase, due);
