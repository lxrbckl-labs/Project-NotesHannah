import type { Db } from "../../db/client.js";

export interface ExamRow {
  seq: number;
  id: string;
  user_id: string;
  course_node_id: string;
  title: string;
  exam_date: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
}

/** Data access for exams. No other domain's code is imported here (practice reads exams through this file). */
export function createExamsRepo(db: Db) {
  const q = {
    byId: db.prepare("SELECT * FROM exams WHERE id = ? AND user_id = ?"),
    coverage: db.prepare(
      "SELECT node_id FROM exam_coverage WHERE exam_id = ? ORDER BY position, node_id",
    ),
    insert: db.prepare(
      `INSERT INTO exams (id, user_id, course_node_id, title, exam_date, notes, created_by, created_at, updated_at)
       VALUES (@id, @user_id, @course_node_id, @title, @exam_date, @notes, @created_by, @created_at, @updated_at)`,
    ),
    update: db.prepare(
      "UPDATE exams SET title = @title, exam_date = @exam_date, notes = @notes, updated_at = @updated_at WHERE id = @id AND user_id = @user_id",
    ),
    clearCoverage: db.prepare("DELETE FROM exam_coverage WHERE exam_id = ?"),
    addCoverage: db.prepare(
      "INSERT INTO exam_coverage (exam_id, user_id, node_id, position) VALUES (?, ?, ?, ?)",
    ),
    del: db.prepare("DELETE FROM exams WHERE id = ? AND user_id = ?"),
  };
  const coverage = (examId: string): string[] =>
    (q.coverage.all(examId) as Array<{ node_id: string }>).map((r) => r.node_id);
  return {
    byId: (userId: string, id: string) => q.byId.get(id, userId) as ExamRow | undefined,
    coverage,
    insert: (row: Omit<ExamRow, "seq" | "trashed_at">) => q.insert.run(row),
    update: (row: {
      id: string;
      user_id: string;
      title: string;
      exam_date: string;
      notes: string;
      updated_at: string;
    }) => q.update.run(row),
    setCoverage(examId: string, userId: string, nodeIds: readonly string[]) {
      q.clearCoverage.run(examId);
      for (const [i, n] of nodeIds.entries()) q.addCoverage.run(examId, userId, n, i);
    },
    delete: (userId: string, id: string) => q.del.run(id, userId).changes,
    /** Live exams of a user with the nodes each covers (used for question scoping). */
    liveCoverage(userId: string): Array<{ id: string; nodeIds: string[] }> {
      const exams = db
        .prepare("SELECT id FROM exams WHERE user_id = ? AND trashed_at IS NULL ORDER BY seq")
        .all(userId) as Array<{ id: string }>;
      return exams.map((e) => ({ id: e.id, nodeIds: coverage(e.id) }));
    },
    liveExam(userId: string, id: string): { row: ExamRow; nodeIds: string[] } | undefined {
      const row = q.byId.get(id, userId) as ExamRow | undefined;
      if (!row || row.trashed_at !== null) return undefined;
      return { row, nodeIds: coverage(row.id) };
    },
  };
}

export type ExamsRepo = ReturnType<typeof createExamsRepo>;
