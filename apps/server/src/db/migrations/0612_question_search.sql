-- Text search over practice questions (the prompt text), for the unified search. An
-- external-content FTS5 table kept in step by triggers, like the blocks' one.
CREATE VIRTUAL TABLE questions_fts USING fts5 (
  text,
  content = 'questions',
  content_rowid = 'seq',
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO questions_fts (questions_fts) VALUES ('rebuild');

CREATE TRIGGER questions_fts_insert AFTER INSERT ON questions BEGIN
  INSERT INTO questions_fts (rowid, text) VALUES (new.seq, new.text);
END;

CREATE TRIGGER questions_fts_delete AFTER DELETE ON questions BEGIN
  INSERT INTO questions_fts (questions_fts, rowid, text) VALUES ('delete', old.seq, old.text);
END;

CREATE TRIGGER questions_fts_update AFTER UPDATE OF text ON questions BEGIN
  INSERT INTO questions_fts (questions_fts, rowid, text) VALUES ('delete', old.seq, old.text);
  INSERT INTO questions_fts (rowid, text) VALUES (new.seq, new.text);
END;
