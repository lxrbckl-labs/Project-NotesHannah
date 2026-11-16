import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../src/db/client.js";

const MIGRATION = join(
  fileURLToPath(new URL("../src/db/migrations", import.meta.url)),
  "0620_activity_names.sql",
);

const FEED: Array<[string, string]> = [
  ["node.created", "library.created"],
  ["node.trashed", "library.trashed"],
  ["document.updated", "document.edited"],
  ["document.reviewed", "block.reviewed"],
  ["document.restored_from_trash", "document.untrashed"],
  ["request.claim", "request.claimed"],
  ["request.complete", "request.completed"],
  ["question.created", "question.authored"],
  ["concept.bulk_upserted", "concept.upserted"],
  ["concept.source_deleted", "concept.unsourced"],
  ["canvas.structure_set", "canvas.arranged"],
  ["canvas.changed", "canvas.edited"],
  ["canvas.merged", "canvas.synced"],
  // already in the scheme: untouched
  ["file.filed", "file.filed"],
  ["document.created", "document.created"],
  ["canvas.placed", "canvas.placed"],
];

const ACTIVITY: Array<[string, string]> = [
  ["create_document", "document.created"],
  ["insert_blocks", "block.inserted"],
  ["update_block", "block.edited"],
  ["move_blocks", "block.moved"],
  ["delete_blocks", "block.deleted"],
  ["replace_generated", "block.regenerated"],
  ["restore_revision", "document.restored"],
  ["batch", "document.edited"],
  ["request.release", "request.released"],
  ["request.decline", "request.declined"],
  ["canvas.structure_set", "canvas.arranged"],
  ["library.created", "library.created"],
  ["file.uploaded", "file.uploaded"],
];

describe("migration 0620: one naming scheme for activity and the change feed", () => {
  it("rewrites the rows written under the old names and leaves the others alone", () => {
    const db = createTestDatabase();
    const feed = db.prepare(
      `INSERT INTO changes (user_id, at, action, object_type, object_ids, actor, summary)
       VALUES ('usr_x', '2026-11-15T00:00:00Z', ?, 'x', '[]', '{}', 's')`,
    );
    const log = db.prepare(
      `INSERT INTO activity (user_id, at, key_id, action, summary, links)
       VALUES ('usr_x', '2026-11-15T00:00:00Z', 'key_x', ?, 's', '[]')`,
    );
    for (const [old] of FEED) feed.run(old);
    for (const [old] of ACTIVITY) log.run(old);

    db.exec(readFileSync(MIGRATION, "utf8"));

    const after = (table: string) =>
      (
        db.prepare(`SELECT action FROM ${table} ORDER BY seq`).all() as Array<{ action: string }>
      ).map((r) => r.action);
    expect(after("changes")).toEqual(FEED.map(([, now]) => now));
    expect(after("activity")).toEqual(ACTIVITY.map(([, now]) => now));
    // idempotent: a second run changes nothing
    db.exec(readFileSync(MIGRATION, "utf8"));
    expect(after("changes")).toEqual(FEED.map(([, now]) => now));
  });
});
