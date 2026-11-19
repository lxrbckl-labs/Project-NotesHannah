import { CALENDAR_MAX_DAYS, type CalendarDay, type CalendarResponse } from "@notes/schema";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";

/**
 * The calendar is a read-only view over what other domains record: exams, graded answers and her own
 * edits to documents. It writes nothing and owns no table, so it reads those tables directly here
 * instead of reaching into the other domains' code.
 */

const DAY_MS = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const iso = (ms: number) => new Date(ms).toISOString();
/** The calendar day of an instant, in a zone `offsetMinutes` east of UTC. */
const localDay = (ms: number, offsetMinutes: number) =>
  iso(ms + offsetMinutes * 60_000).slice(0, 10);

interface AttemptRow {
  at: string;
  correct: number;
  time_taken_ms: number;
  question_id: string;
}
interface TopicRow {
  question_id: string;
  node_id: string;
  name: string;
}
interface EditRow {
  at: string;
  node_id: string;
  name: string;
}

/** How long one answer may count for: a tab left open overnight is not eight hours of study. */
const MAX_ANSWER_MS = 5 * 60_000;
/** How far back the streak looks. */
const STREAK_DAYS = 400;

export function readCalendar(
  db: Db,
  userId: string,
  nowMs: number,
  opts: { from: string; to: string; utcOffsetMinutes?: number | undefined },
): CalendarResponse {
  const offset = opts.utcOffsetMinutes ?? 0;
  const { from, to } = opts;
  const span = Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1;
  if (span < 1) {
    throw new AppError("invalid_input", "`to` must not be before `from`.", {
      hint: "Send from and to as YYYY-MM-DD with from on or before to.",
    });
  }
  if (span > CALENDAR_MAX_DAYS) {
    throw new AppError("invalid_input", `Ask for at most ${CALENDAR_MAX_DAYS} days at a time.`, {
      hint: "Ask for one month, or split the range.",
    });
  }
  // Her local days from..to, as UTC instants.
  const start = iso(dayMs(from) - offset * 60_000);
  const end = iso(dayMs(to) + DAY_MS - offset * 60_000);

  const exams = (
    db
      .prepare(
        `SELECT e.id, e.title, e.exam_date AS date, e.course_node_id AS courseId,
                COALESCE(n.name, '') AS courseName
           FROM exams e LEFT JOIN nodes n ON n.id = e.course_node_id
          WHERE e.user_id = ? AND e.trashed_at IS NULL AND e.exam_date >= ? AND e.exam_date <= ?
          ORDER BY e.exam_date, e.seq`,
      )
      .all(userId, from, to) as CalendarResponse["exams"]
  ).map((e) => ({ ...e }));

  const attempts = db
    .prepare(
      `SELECT at, correct, time_taken_ms, question_id FROM attempts
        WHERE user_id = ? AND at >= ? AND at < ? ORDER BY at, seq`,
    )
    .all(userId, start, end) as AttemptRow[];

  // The lectures, folders and courses each answered question belongs to.
  const topicsOf = new Map<string, Array<{ nodeId: string; name: string }>>();
  if (attempts.length > 0) {
    const rows = db
      .prepare(
        `SELECT DISTINCT qn.question_id, qn.node_id, n.name
           FROM attempts a
           JOIN question_nodes qn ON qn.question_id = a.question_id AND qn.user_id = a.user_id
           JOIN nodes n ON n.id = qn.node_id AND n.trashed_at IS NULL
          WHERE a.user_id = ? AND a.at >= ? AND a.at < ? AND qn.node_trashed = 0`,
      )
      .all(userId, start, end) as TopicRow[];
    for (const r of rows) {
      const list = topicsOf.get(r.question_id) ?? [];
      list.push({ nodeId: r.node_id, name: r.name });
      topicsOf.set(r.question_id, list);
    }
  }

  // Her own writing: blocks she added or changed, never an agent's.
  const edits = db
    .prepare(
      `SELECT c.at, c.node_id, n.name
         FROM changes c JOIN nodes n ON n.id = c.node_id AND n.trashed_at IS NULL
        WHERE c.user_id = ? AND c.at >= ? AND c.at < ?
          AND c.object_type = 'document' AND c.action LIKE 'block.%'
          AND json_extract(c.actor, '$.type') = 'user'
        ORDER BY c.seq`,
    )
    .all(userId, start, end) as EditRow[];

  interface Draft {
    answered: number;
    correct: number;
    ms: number;
    topics: Map<string, { nodeId: string; name: string; count: number }>;
    notes: Map<string, { nodeId: string; title: string; edits: number }>;
  }
  const drafts = new Map<string, Draft>();
  const draft = (date: string): Draft => {
    let d = drafts.get(date);
    if (!d) {
      d = { answered: 0, correct: 0, ms: 0, topics: new Map(), notes: new Map() };
      drafts.set(date, d);
    }
    return d;
  };
  for (const a of attempts) {
    const d = draft(localDay(Date.parse(a.at), offset));
    d.answered += 1;
    d.correct += a.correct;
    d.ms += Math.min(Math.max(a.time_taken_ms, 0), MAX_ANSWER_MS);
    for (const t of topicsOf.get(a.question_id) ?? []) {
      const have = d.topics.get(t.nodeId);
      if (have) have.count += 1;
      else d.topics.set(t.nodeId, { ...t, count: 1 });
    }
  }
  for (const e of edits) {
    const d = draft(localDay(Date.parse(e.at), offset));
    const have = d.notes.get(e.node_id);
    if (have) have.edits += 1;
    else d.notes.set(e.node_id, { nodeId: e.node_id, title: e.name, edits: 1 });
  }
  const days: CalendarDay[] = [...drafts.entries()]
    .filter(([date]) => date >= from && date <= to)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      answered: d.answered,
      correct: d.correct,
      minutes: Math.round(d.ms / 60_000),
      topics: [...d.topics.values()].sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name),
      ),
      notes: [...d.notes.values()].sort(
        (a, b) => b.edits - a.edits || a.title.localeCompare(b.title),
      ),
    }));

  // The streak: every local day with an answer or an edit of hers, counted back from today.
  const today = localDay(nowMs, offset);
  const since = iso(nowMs - STREAK_DAYS * DAY_MS);
  const moments = db
    .prepare(
      `SELECT at FROM attempts WHERE user_id = ? AND at >= ?
       UNION ALL
       SELECT at FROM changes WHERE user_id = ? AND at >= ? AND object_type = 'document'
          AND action LIKE 'block.%' AND json_extract(actor, '$.type') = 'user'`,
    )
    .all(userId, since, userId, since) as Array<{ at: string }>;
  const studied = new Set(moments.map((m) => localDay(Date.parse(m.at), offset)));
  let streak = 0;
  let cursor = dayMs(today);
  // A day that has not been studied yet does not break a streak that ran through yesterday.
  if (!studied.has(today)) cursor -= DAY_MS;
  while (studied.has(iso(cursor).slice(0, 10))) {
    streak += 1;
    cursor -= DAY_MS;
  }

  return { from, to, today, exams, days, streak };
}
