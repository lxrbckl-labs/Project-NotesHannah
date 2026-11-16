-- Which blocks mention which concept, so a concept page finds its mentions with an index
-- instead of scanning every block's JSON. A mention is `{ "concept": "con_…", "text": "…" }`
-- anywhere inside a block's `data`. Kept in step by triggers, so every write path (and the
-- cascade when a document is deleted) is covered without the documents code knowing.
CREATE TABLE block_concepts (
  block_seq  INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  PRIMARY KEY (block_seq, concept_id)
) WITHOUT ROWID;
CREATE INDEX block_concepts_concept ON block_concepts (user_id, concept_id);

INSERT OR IGNORE INTO block_concepts (block_seq, user_id, concept_id)
SELECT b.seq, b.user_id, j.value
FROM blocks b, json_tree(b.data) j
WHERE j.key = 'concept' AND j.type = 'text' AND j.value LIKE 'con\_%' ESCAPE '\';

CREATE TRIGGER block_concepts_insert AFTER INSERT ON blocks BEGIN
  INSERT OR IGNORE INTO block_concepts (block_seq, user_id, concept_id)
  SELECT new.seq, new.user_id, j.value FROM json_tree(new.data) j
  WHERE j.key = 'concept' AND j.type = 'text' AND j.value LIKE 'con\_%' ESCAPE '\';
END;

CREATE TRIGGER block_concepts_update AFTER UPDATE OF data ON blocks BEGIN
  DELETE FROM block_concepts WHERE block_seq = old.seq;
  INSERT OR IGNORE INTO block_concepts (block_seq, user_id, concept_id)
  SELECT new.seq, new.user_id, j.value FROM json_tree(new.data) j
  WHERE j.key = 'concept' AND j.type = 'text' AND j.value LIKE 'con\_%' ESCAPE '\';
END;

CREATE TRIGGER block_concepts_delete AFTER DELETE ON blocks BEGIN
  DELETE FROM block_concepts WHERE block_seq = old.seq;
END;
