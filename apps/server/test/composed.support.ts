import { existsSync } from "node:fs";
import { newId } from "@notes/schema";
import { createTestDatabase } from "../src/db/client.js";
import { createServices, type Services } from "../src/services.js";
import { originalPath } from "../src/storage/storage.js";
import { agentAuth, type Json, userAuth } from "./documents-helpers.js";
import { FakeConverter, PDF, tempStorage, variant } from "./files.support.js";
import { Clock } from "./helpers.js";

export { agentAuth, userAuth };

/** The composed services over an in-memory database and a temporary storage directory. */
export function composed() {
  const db = createTestDatabase();
  const clock = new Clock();
  const { dir, storage } = tempStorage();
  const services: Services = createServices(
    { config: { DATA_DIR: dir, APP_ORIGIN: "http://localhost:5173" }, db, now: clock.now },
    { files: { storage, signingSecret: "test-secret", partialGraceMs: 0, log: () => {} } },
  );
  const converter = new FakeConverter(storage.root);
  const alice = newId("user");
  const bob = newId("user");
  const she = userAuth(alice);
  const bot = agentAuth(alice, newId("apiKey"));
  const bobUser = userAuth(bob);

  /** term > course > sections, plus a lecture under Lectures. */
  function spine(userId = alice, lectureName = "Beta blockers") {
    const { library } = services;
    const term = library.create(userId, { parentId: null, kind: "term", name: "Fall 2026" });
    const course = library.create(userId, {
      parentId: term.id,
      kind: "course",
      name: "Pharmacology II",
    });
    const sections = Object.fromEntries(
      library.list(userId, { parentId: course.id }).items.map((s) => [s.section as string, s.id]),
    ) as Record<string, string>;
    const lecture = library.create(userId, {
      parentId: sections.lectures as string,
      kind: "lecture",
      name: lectureName,
      lecture: { number: 7, date: "2026-10-14" },
    });
    return { term, course, sections, lecture };
  }

  /** Upload, play the converter, ingest: a converted file with its pages. */
  async function convertedFile(
    auth = she,
    options: {
      name?: string;
      pages?: number;
      nodeId?: string;
      mutate?: (result: Json) => void;
    } = {},
  ) {
    const data = variant(PDF, `c${Math.random()}`);
    const file = await services.files.upload(auth, {
      body: (async function* () {
        yield data;
      })(),
      name: options.name ?? "beta-blockers.pdf",
      ...(options.nodeId ? { nodeId: options.nodeId } : {}),
    });
    const jobId = converter.pending().at(-1);
    if (!jobId) throw new Error("no job queued");
    converter.succeed(jobId, {
      pages: options.pages ?? 2,
      type: "pdf",
      ...(options.mutate ? { mutate: options.mutate } : {}),
    });
    services.files.processQueue();
    const pages = services.files.listPages(auth.userId, file.id);
    return { file: services.files.getFile(auth.userId, file.id), pages, bytes: data };
  }

  const originalExists = (userId: string, sha256: string) =>
    existsSync(originalPath(storage, userId, sha256));

  /** Every change entry of the user, oldest first. */
  const changes = (userId = alice) => services.changes.changesSince(userId, "0", 500).items;
  const activity = (userId = alice) => services.activity.list(userId, { limit: 200 }).items;

  return {
    db,
    clock,
    dir,
    storage,
    services,
    converter,
    alice,
    bob,
    she,
    bot,
    bobUser,
    spine,
    convertedFile,
    originalExists,
    changes,
    activity,
  };
}

export type Composed = ReturnType<typeof composed>;
export type { Json };
