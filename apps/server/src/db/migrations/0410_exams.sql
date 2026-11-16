-- Exams: a date on a course, and the library nodes it covers.
-- `trashed_at` is set by the node hooks when the course goes to the trash.
CREATE TABLE exams (
  seq            INTEGER PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,
  user_id        TEXT NOT NULL,
  course_node_id TEXT NOT NULL,
  title          TEXT NOT NULL,
  exam_date      TEXT NOT NULL,
  notes          TEXT NOT NULL DEFAULT '',
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  trashed_at     TEXT
);
CREATE INDEX exams_user_date ON exams (user_id, exam_date, seq);
CREATE INDEX exams_course ON exams (user_id, course_node_id);

CREATE TABLE exam_coverage (
  exam_id  TEXT NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (exam_id, node_id)
);
CREATE INDEX exam_coverage_node ON exam_coverage (user_id, node_id);
