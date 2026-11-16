import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { type Db, migrate, openDatabase } from "../src/db/client.js";
import { createServices, type Services } from "../src/services.js";
import { initStorage } from "../src/storage/storage.js";
import { agentAuth, userAuth } from "./composed.support.js";
import { fx } from "./practice-helpers.js";

/**
 * Two years of one student's material on a FILE database: 12 courses, 400 lectures, 6,000
 * questions, 60,000 attempts, 3,000 concepts, 2,000 documents with 60,000 blocks. The hot paths
 * are timed and printed. The ceilings below are loose on purpose (a busy machine runs the gate);
 * the target is 200 ms, and the printed table is what to read.
 */

const COURSES = 12;
const LECTURES = 400;
const QUESTIONS_PER_LECTURE = 15; // 6,000
const ATTEMPTS = 60_000;
const CONCEPT_PAIRS = 1_500; // 3,000 concepts
const DOCUMENTS = 2_000;
const BLOCKS_PER_DOCUMENT = 30; // 60,000
const CEILING_MS = 2_000;
const TARGET_MS = 200;

const WORDS = [
  "bradycardia",
  "hypotension",
  "cardioselective",
  "lipophilic",
  "renal",
  "clearance",
  "half-life",
  "titration",
  "contraindicated",
  "adrenergic",
  "receptor",
  "antagonist",
  "agonist",
  "metabolism",
  "dosing",
  "monitoring",
];

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Seeded {
  db: Db;
  services: Services;
  userId: string;
  courseIds: string[];
  lectureIds: string[];
  sectionIds: string[];
  conceptIds: string[];
  documentIds: string[];
  seconds: Record<string, number>;
}

function seed(): Seeded {
  const dir = mkdtempSync(join(tmpdir(), "notes-perf-"));
  const { storage } = initStorage(join(dir, "storage"), { createDir: true });
  const db = openDatabase(join(dir, "notes.db"));
  migrate(db);
  const start = Date.UTC(2026, 10, 15, 12, 0, 0);
  const services = createServices(
    {
      config: { DATA_DIR: join(dir, "storage"), APP_ORIGIN: "http://localhost:5173" },
      db,
      now: () => start,
    },
    { files: { storage, signingSecret: "perf", log: () => {} } },
  );
  const userId = newId("user");
  const she = userAuth(userId);
  const bot = agentAuth(userId, newId("apiKey"));
  const rnd = rng(7);
  const seconds: Record<string, number> = {};
  const timed = <T>(name: string, run: () => T): T => {
    const t0 = performance.now();
    const out = run();
    seconds[name] = Math.round(performance.now() - t0) / 1000;
    return out;
  };
  const { library, practice, concepts } = services;

  // ---- library
  const courseIds: string[] = [];
  const sectionIds: string[] = [];
  const lectureIds: string[] = [];
  const practiceSections: string[] = [];
  timed("library", () => {
    for (let t = 0; t < 4; t++) {
      const term = library.create(userId, { parentId: null, kind: "term", name: `Term ${t + 1}` });
      for (let c = 0; c < COURSES / 4; c++) {
        const course = library.create(userId, {
          parentId: term.id,
          kind: "course",
          name: `Course ${t * 3 + c + 1}`,
        });
        courseIds.push(course.id);
        const sections = library.list(userId, { parentId: course.id }).items;
        const lectures = sections.find((s) => s.section === "lectures");
        const practiceSection = sections.find((s) => s.section === "study_guides");
        sectionIds.push(lectures?.id as string);
        practiceSections.push(practiceSection?.id as string);
      }
    }
    for (let i = 0; i < LECTURES; i++) {
      const course = i % COURSES;
      const lecture = library.create(userId, {
        parentId: sectionIds[course] as string,
        kind: "lecture",
        name: `Lecture ${Math.floor(i / COURSES) + 1} ${WORDS[i % WORDS.length]}`,
        lecture: { number: Math.floor(i / COURSES) + 1, date: null },
      });
      lectureIds.push(lecture.id);
    }
  });

  // ---- concepts
  const conceptIds: string[] = [];
  timed("concepts", () => {
    for (let from = 0; from < CONCEPT_PAIRS; from += 100) {
      const items = Array.from({ length: Math.min(100, CONCEPT_PAIRS - from) }, (_, k) => from + k);
      const result = concepts.bulkUpsert(bot, {
        concepts: items.flatMap((i) => [
          { type: "drug", name: `Drug${i} ${WORDS[i % WORDS.length]}`, generalKnowledge: true },
          {
            type: "adverse_effect",
            name: `Effect${i} ${WORDS[(i + 3) % WORDS.length]}`,
            generalKnowledge: true,
          },
        ]),
        relations: items.map((i) => ({
          from: { type: "drug", name: `Drug${i} ${WORDS[i % WORDS.length]}` },
          to: { type: "adverse_effect", name: `Effect${i} ${WORDS[(i + 3) % WORDS.length]}` },
          type: "causes_adverse_effect",
          generalKnowledge: true,
        })),
      });
      for (const c of result.concepts) if (c.id) conceptIds.push(c.id);
    }
  });

  // ---- questions
  const questionIds: string[] = [];
  timed("questions", () => {
    for (const [index, lectureId] of lectureIds.entries()) {
      const questions = Array.from({ length: QUESTIONS_PER_LECTURE }, (_, k) => {
        const word = WORDS[(index + k) % WORDS.length];
        const over = {
          sources: [],
          generalKnowledge: true,
          conceptIds: [conceptIds[(index * 7 + k) % conceptIds.length] as string],
        };
        const cite = { fileId: "", pageId: "", quote: "" };
        if (k % 5 === 4) {
          return fx.flash(cite, {
            ...over,
            front: `Brand of ${word} drug ${index}-${k}?`,
            back: `Answer ${k}`,
          });
        }
        return fx.mc(cite, {
          ...over,
          prompt: `Which effect of ${word} is expected in lecture ${index} item ${k}?`,
        });
      });
      const made = practice.createQuestions(bot, { nodeIds: [lectureId], questions });
      for (const q of made.created) questionIds.push(q.id);
    }
  });

  // ---- documents: raw rows through the same tables and triggers (a service call per block set is slow)
  const documentIds: string[] = [];
  timed("documents", () => {
    const template = services.documents.createDocument(bot, {
      parentId: practiceSections[0],
      kind: "study_guide",
      title: "Template",
      blocks: [{ type: "paragraph", content: { text: "template" }, generalKnowledge: true }],
    } as never);
    const sample = JSON.parse(
      (
        db.prepare("SELECT data FROM blocks WHERE id = ?").get(template.blockIds[0]) as {
          data: string;
        }
      ).data,
    ) as Record<string, unknown> & { content: { text: unknown } };
    const sampleBlock = db
      .prepare("SELECT * FROM blocks WHERE id = ?")
      .get(template.blockIds[0]) as Record<string, unknown>;
    const insertDoc = db.prepare(
      `INSERT INTO documents (id, user_id, node_id, kind, title, review_status, revision, created_by,
         created_at, last_edited_by, updated_at) VALUES (?, ?, ?, 'study_guide', ?, 'unverified', 1, ?, ?, ?, ?)`,
    );
    const insertBlock = db.prepare(
      `INSERT INTO blocks (id, document_id, user_id, position, type, origin, review_status, last_edited_by,
         plain_text, data) VALUES (?, ?, ?, ?, 'paragraph', ?, ?, ?, ?, ?)`,
    );
    const who = JSON.stringify(bot.actor);
    const stamp = new Date(start).toISOString();
    db.transaction(() => {
      for (let d = 0; d < DOCUMENTS; d++) {
        const node = library.create(userId, {
          parentId: practiceSections[d % COURSES] as string,
          kind: "document",
          name: `Guide ${d} ${WORDS[d % WORDS.length]}`,
        });
        const id = newId("document");
        documentIds.push(id);
        insertDoc.run(
          id,
          userId,
          node.id,
          `Guide ${d} ${WORDS[d % WORDS.length]}`,
          who,
          stamp,
          who,
          stamp,
        );
        for (let b = 0; b < BLOCKS_PER_DOCUMENT; b++) {
          const blockId = newId("block");
          const word = WORDS[(d + b) % WORDS.length];
          const concept =
            rnd() < 0.2 ? (conceptIds[Math.floor(rnd() * conceptIds.length)] as string) : null;
          const text = `Notes on ${word} for guide ${d}, part ${b}: dosing and monitoring.`;
          const runs = concept
            ? [{ text: "See " }, { concept, text: "a drug" }, { text: `. ${text}` }]
            : [{ text }];
          const data = { ...sample, id: blockId, content: { ...sample.content, text: runs } };
          insertBlock.run(
            blockId,
            id,
            userId,
            b,
            String(sampleBlock.origin),
            String(sampleBlock.review_status),
            who,
            text,
            JSON.stringify(data),
          );
        }
      }
    })();
  });

  // ---- attempts: two years of answers, raw (a session per ten answers would take minutes)
  timed("attempts", () => {
    const insert = db.prepare(
      `INSERT INTO attempts (id, user_id, session_id, position, question_id, variant_seed, answer_type,
         answer, result, correct, score, time_taken_ms, at)
       VALUES (?, ?, NULL, NULL, ?, NULL, 'multiple_choice', '{"type":"multiple_choice","optionId":"a"}',
         ?, ?, ?, 4000, ?)`,
    );
    const first = start - 2 * 365 * 86_400_000;
    db.transaction(() => {
      for (let i = 0; i < ATTEMPTS; i++) {
        const correct = rnd() < 0.7 ? 1 : 0;
        const at = new Date(
          first + Math.floor((i / ATTEMPTS) * (start - first - 3_600_000)),
        ).toISOString();
        insert.run(
          newId("attempt"),
          userId,
          questionIds[Math.floor(rnd() * questionIds.length)],
          JSON.stringify({ correct: correct === 1, score: correct }),
          correct,
          correct,
          at,
        );
      }
    })();
  });

  // ---- exams, one per course covering its first lectures
  timed("exams", () => {
    for (const [c, courseId] of courseIds.entries()) {
      const covered = lectureIds.filter((_, i) => i % COURSES === c).slice(0, 10);
      services.exams.createExam(she, {
        courseId,
        title: `Exam ${c + 1}`,
        date: "2026-12-14",
        nodeIds: covered,
      });
    }
  });

  db.exec("ANALYZE");
  return {
    db,
    services,
    userId,
    courseIds,
    lectureIds,
    sectionIds,
    conceptIds,
    documentIds,
    seconds,
  };
}

interface Timing {
  path: string;
  runs: number[];
}

function measure(path: string, runs: number, run: (i: number) => unknown): Timing {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    run(i);
    times.push(performance.now() - t0);
  }
  return { path, runs: times };
}

describe("performance with two years of material", () => {
  it("keeps the hot paths quick", { timeout: 600_000 }, () => {
    const t0 = performance.now();
    const s = seed();
    const seeding = (performance.now() - t0) / 1000;
    const she = userAuth(s.userId);
    const { services } = s;
    const counts = {
      nodes: (s.db.prepare("SELECT COUNT(*) AS n FROM nodes").get() as { n: number }).n,
      questions: (s.db.prepare("SELECT COUNT(*) AS n FROM questions").get() as { n: number }).n,
      attempts: (s.db.prepare("SELECT COUNT(*) AS n FROM attempts").get() as { n: number }).n,
      concepts: (s.db.prepare("SELECT COUNT(*) AS n FROM concepts").get() as { n: number }).n,
      documents: (s.db.prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }).n,
      blocks: (s.db.prepare("SELECT COUNT(*) AS n FROM blocks").get() as { n: number }).n,
    };
    expect(counts.questions).toBe(LECTURES * QUESTIONS_PER_LECTURE);
    expect(counts.attempts).toBe(ATTEMPTS);
    expect(counts.concepts).toBe(CONCEPT_PAIRS * 2);
    expect(counts.documents).toBe(DOCUMENTS + 1);
    expect(counts.blocks).toBe(DOCUMENTS * BLOCKS_PER_DOCUMENT + 1);

    const lectureNode = s.lectureIds[3] as string;
    const timings: Timing[] = [];

    timings.push(
      measure("library: children of a section (34 lectures)", 5, () =>
        services.library.list(s.userId, { parentId: s.sectionIds[0] as string, limit: 50 }),
      ),
      measure("library: root", 5, () => services.library.list(s.userId, {})),
    );

    // sessions: a lecture, a whole course, everything
    let session = services.practice.startSession(she, {
      scope: { kind: "nodes", nodeIds: [lectureNode] },
      length: 10,
    }).session;
    timings.push(
      measure("practice: start session (one lecture)", 5, () =>
        services.practice.startSession(she, {
          scope: { kind: "nodes", nodeIds: [lectureNode] },
          length: 10,
        }),
      ),
      measure("practice: start session (all questions)", 5, () => {
        session = services.practice.startSession(she, {
          scope: { kind: "all" },
          length: 10,
        }).session;
      }),
      measure("practice: next question", 5, () => services.practice.nextQuestion(she, session.id)),
    );
    const submits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const next = services.practice.nextQuestion(she, session.id).next;
      if (!next) break;
      const view = next.view;
      const answer =
        view.type === "flashcard"
          ? { type: "flashcard", rating: "good" }
          : {
              type: "multiple_choice",
              optionId: (view as { options: Array<{ id: string }> }).options[0]?.id,
            };
      const t1 = performance.now();
      services.practice.submitAnswer(session.id === "" ? she : she, session.id, {
        answer: answer as never,
      });
      submits.push(performance.now() - t1);
    }
    timings.push({ path: "practice: submit an answer", runs: submits });

    timings.push(
      measure("practice: weak areas", 3, () => services.practice.weakAreas(she)),
      measure("practice: notebook", 3, () => services.practice.notebook(she, {})),
      measure("practice: due list", 3, () => services.practice.dueList(she, {})),
      measure("exams: one exam with progress", 3, () => {
        const exam = services.exams.listExams(she, { limit: 1 }).items[0];
        return services.exams.getExam(she, exam?.id as string);
      }),
      measure("search: unified, common word, all kinds", 5, () =>
        services.search.search(s.userId, { q: "bradycardia dosing", limit: 20 }),
      ),
      measure("search: unified, names only", 5, () =>
        services.search.search(s.userId, { q: "lecture", kinds: ["node"], limit: 20 }),
      ),
      measure("concepts: bulk upsert of 100 new (3,000 exist)", 3, (i) =>
        services.concepts.bulkUpsert(agentAuth(s.userId, newId("apiKey")), {
          concepts: Array.from({ length: 100 }, (_, k) => ({
            type: "mechanism",
            name: `Mechanism ${i}-${k} ${WORDS[k % WORDS.length]}`,
            generalKnowledge: true,
          })),
          relations: [],
        }),
      ),
      measure("practice: list questions of a lecture", 5, () =>
        services.practice.listQuestions(she, { nodeId: lectureNode }),
      ),
      measure("concept page (a drug with relations and mentions)", 5, (i) =>
        services.concepts.page(she, s.conceptIds[i * 2] as string),
      ),
      measure("document load: light", 5, (i) =>
        services.documents.getDocument(she, s.documentIds[i + 1] as string),
      ),
      measure("document load: content (200 blocks)", 5, (i) =>
        services.documents.getFull(she, s.documentIds[i + 1] as string, { limit: 200 }),
      ),
      measure("document references", 5, (i) =>
        services.documents.references(she, s.documentIds[i + 1] as string),
      ),
    );

    const lines = timings.map((t) => {
      const sorted = [...t.runs].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const worst = sorted[sorted.length - 1] ?? 0;
      return { path: t.path, median, worst };
    });
    const table = lines
      .map(
        (l) =>
          `${l.path.padEnd(58)} median ${l.median.toFixed(1).padStart(8)} ms   worst ${l.worst
            .toFixed(1)
            .padStart(8)} ms${l.worst > TARGET_MS ? "   <-- over 200 ms" : ""}`,
      )
      .join("\n");
    console.log(
      `\nSeeded ${JSON.stringify(counts)} in ${seeding.toFixed(1)} s (${JSON.stringify(s.seconds)})\n${table}\n`,
    );
    for (const l of lines) expect(l.worst, l.path).toBeLessThan(CEILING_MS);
  });
});
