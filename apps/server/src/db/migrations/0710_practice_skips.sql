-- Positions of a practice session she skipped (a JSON array), kept on the server so a session
-- resumes the same way on another device. A skipped question comes back after the others.
ALTER TABLE practice_sessions ADD COLUMN skipped TEXT NOT NULL DEFAULT '[]';
