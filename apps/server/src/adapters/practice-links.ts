import type { QuestionLink } from "@notes/schema";
import type { Db } from "../db/client.js";
import type { ConceptQuestions } from "../domains/concepts/ports.js";
import type { TargetInfo } from "../domains/requests/lookup.js";

const flat = (text: string, max: number): string => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/**
 * The concepts domain's `ConceptQuestions`, answered from the practice tables: the questions
 * tagged with a concept (or with an ID merged into it) that she can see, i.e. not in the trash
 * and filed under at least one node that is not in the trash.
 */
export function createConceptQuestions(db: Db): ConceptQuestions {
  const find = db.prepare(
    `SELECT q.id AS question_id, q.text,
            (SELECT n.node_id FROM question_nodes n
             WHERE n.question_id = q.id AND n.node_trashed = 0 ORDER BY n.rowid LIMIT 1) AS node_id
     FROM question_concepts c JOIN questions q ON q.id = c.question_id
     WHERE c.user_id = ? AND c.concept_id = ? AND q.trashed_at IS NULL
       AND EXISTS (SELECT 1 FROM question_nodes n WHERE n.question_id = q.id AND n.node_trashed = 0)
     ORDER BY q.seq LIMIT 200`,
  );
  return {
    questions(userId, conceptIds) {
      const out: QuestionLink[] = [];
      const seen = new Set<string>();
      for (const conceptId of conceptIds) {
        const rows = find.all(userId, conceptId) as Array<{
          question_id: string;
          text: string;
          node_id: string | null;
        }>;
        for (const row of rows) {
          if (seen.has(row.question_id)) continue;
          seen.add(row.question_id);
          out.push({
            questionId: row.question_id,
            stem: flat(row.text, 200),
            nodeId: row.node_id,
          } as QuestionLink);
        }
      }
      return out;
    },
  };
}

/**
 * How the requests domain describes a question, read from the practice tables: its first words,
 * where it is filed, and whether it is in the trash (itself, or because everything it is filed
 * under is). `null` means it does not exist for this user.
 */
export function createQuestionTargets(
  db: Db,
): (userId: string, questionId: string) => Partial<TargetInfo> | null {
  const question = db.prepare(
    "SELECT text, trashed_at FROM questions WHERE id = ? AND user_id = ?",
  );
  const homes = db.prepare(
    "SELECT node_id, node_trashed FROM question_nodes WHERE question_id = ? ORDER BY rowid",
  );
  const chain = db.prepare(
    `WITH RECURSIVE up(id, parent_id, name, depth) AS (
       SELECT id, parent_id, name, 0 FROM nodes WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT n.id, n.parent_id, n.name, up.depth + 1 FROM nodes n JOIN up ON n.id = up.parent_id
     ) SELECT name FROM up ORDER BY depth DESC`,
  );
  return (userId, questionId) => {
    const row = question.get(questionId, userId) as
      | { text: string; trashed_at: string | null }
      | undefined;
    if (!row) return null;
    const where = homes.all(questionId) as Array<{ node_id: string; node_trashed: number }>;
    const live = where.find((w) => w.node_trashed === 0) ?? where[0];
    const path = live
      ? (chain.all(live.node_id, userId) as Array<{ name: string }>).map((n) => n.name).join(" / ")
      : null;
    return {
      exists: true,
      trashed:
        row.trashed_at !== null || (where.length > 0 && where.every((w) => w.node_trashed === 1)),
      name: flat(row.text, 60),
      path,
      preview: flat(row.text, 140),
      nodeId: live?.node_id ?? null,
    };
  };
}
