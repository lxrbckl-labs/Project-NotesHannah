import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { request } from "@playwright/test";
import { credentials, dataDir, type Ids } from "./built";

/**
 * Seed what the converter would otherwise make possible. The server's seed (`tools/dev/seed.mjs`) builds the
 * library and uploads files, but its study guide, questions and canvas wait for converted pages, and the built
 * suite runs without the converter. A document, concepts, practice questions and a canvas can all be written
 * without citations when they are marked as general knowledge, so this writes them through the API.
 */
export default async function globalSetup(config: { projects: { use: { baseURL?: string } }[] }) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3460";
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> => {
    const response = await api.fetch(`/api${path}`, {
      method,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      data: body,
    });
    if (!response.ok()) {
      throw new Error(`${method} ${path} -> ${response.status()} ${await response.text()}`);
    }
    return (await response.json()) as T;
  };

  await call("POST", "/auth/login", credentials());
  type Node = { id: string; name: string; section?: string };
  const list = async (query: string) =>
    (await call<{ items: Node[] }>("GET", `/nodes?${query}`)).items;
  const terms = await list("limit=50");
  const fall = terms.find((t) => t.name === "Fall 2026");
  const course = (await list(`parentId=${fall?.id}&limit=50`)).find(
    (c) => c.name === "Pharmacology II",
  );
  if (!course) throw new Error("The seeded course is missing (did the seed run?)");
  const sections = await list(`parentId=${course.id}&limit=50`);
  const lectures = await list(
    `parentId=${sections.find((s) => s.section === "lectures")?.id}&limit=50`,
  );
  const lecture = lectures.find((l) => l.name === "Autonomic overview");
  if (!lecture) throw new Error("The seeded lecture is missing");
  const files = await call<{ items: { id: string }[] }>(
    "GET",
    `/files?nodeId=${lecture.id}&limit=5`,
  );
  const fileId = files.items[0]?.id;
  if (!fileId) throw new Error("The seeded file is missing");

  // An agent's key writes the study material, as it does in real use.
  const { secret } = await call<{ secret: string }>("POST", "/keys", {
    name: "Built suite",
    scope: "write",
  });
  const asAgent = <T>(method: string, path: string, body?: unknown) =>
    call<T>(method, path, body, secret);
  const general = { generalKnowledge: true };
  const guide = await asAgent<{ documentId: string; nodeId: string; blockIds: string[] }>(
    "POST",
    "/documents",
    {
      nodeId: lecture.id,
      kind: "lecture_note",
      title: "Autonomic overview",
      blocks: [
        { type: "heading", content: { level: 2, text: "Beta blockers" }, ...general },
        {
          type: "paragraph",
          content: { text: "Beta blockers reduce heart rate and blood pressure." },
          ...general,
        },
        {
          type: "bulleted_list",
          content: {
            items: ["Cardioselective: atenolol, metoprolol", "Non-selective: propranolol"],
          },
          ...general,
        },
      ],
    },
  );
  const studyGuides = sections.find((s) => s.section === "study_guides");
  const edit = await asAgent<{ documentId: string; nodeId: string }>("POST", "/documents", {
    parentId: studyGuides?.id,
    kind: "study_guide",
    title: "Editor practice",
    blocks: [{ type: "paragraph", content: { text: "Start here." }, ...general }],
  });

  const concepts = await asAgent<{ concepts: { id: string; name: string }[] }>(
    "POST",
    "/concepts/bulk",
    {
      concepts: [
        { type: "drug_class", name: "beta blockers", ...general },
        { type: "drug", name: "metoprolol", ...general },
      ],
      relations: [
        {
          from: { type: "drug", name: "metoprolol" },
          to: { type: "drug_class", name: "beta blockers" },
          type: "belongs_to_class",
          ...general,
        },
      ],
    },
  );
  const conceptId = concepts.concepts.find((c) => c.name === "metoprolol")?.id ?? "";

  const authored = await asAgent<{ created: { id: string }[] }>("POST", "/practice/questions", {
    nodeIds: [lecture.id],
    questions: [
      {
        type: "multiple_choice",
        prompt: "Which effect do beta blockers have on the heart?",
        options: [
          {
            text: "Slower heart rate",
            correct: true,
            rationale: "Beta blockade lowers heart rate.",
          },
          { text: "Faster heart rate" },
        ],
        explanation: "Beta blockers slow the heart rate.",
        ...general,
      },
      {
        type: "flashcard",
        front: "Name a cardioselective beta blocker.",
        back: "Metoprolol.",
        ...general,
      },
    ],
  });
  const started = await call<{ session: { id: string } }>("POST", "/practice/sessions", {
    scope: { kind: "nodes", nodeIds: [lecture.id] },
    length: 2,
  });
  await call("POST", "/exams", {
    courseId: course.id,
    title: "Exam 1",
    date: new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10),
    nodeIds: [lecture.id],
  });

  // One request waiting for an agent, and a canvas built from the guide's blocks.
  await call("POST", "/requests", {
    target: { type: "block", documentId: guide.documentId, blockId: guide.blockIds[1] },
    kind: "unclear",
    message: "Why do beta blockers lower blood pressure?",
  });
  await asAgent("PUT", `/documents/${guide.documentId}/canvas/structure`, {
    documentId: guide.documentId,
    cards: [
      { ref: "a", content: { kind: "block", blockIds: [guide.blockIds[1]] } },
      { ref: "b", content: { kind: "block", blockIds: [guide.blockIds[2]] } },
    ],
    connectors: [{ from: "a", to: "b", label: "two groups", kind: "leads_to" }],
  });

  const out: Ids = {
    courseId: course.id,
    lectureId: lecture.id,
    docNodeId: guide.nodeId,
    editNodeId: edit.nodeId,
    editDocId: edit.documentId,
    fileId,
    conceptId,
    questionId: authored.created[0]?.id ?? "",
    sessionId: started.session.id,
  };
  writeFileSync(resolve(dataDir, "ids.json"), JSON.stringify(out));
  await api.dispose();
}
