import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { migrate, openDatabase } from "../src/db/client.js";

const MIGRATIONS = join(import.meta.dirname, "../src/db/migrations");
const REBUILD = "0630_file_types.sql";

/** Copy the migrations before (or from) the table rebuild into a directory of their own. */
function dirWith(pick: (name: string) => boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "notes-mig-"));
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql") && pick(n)))
    copyFileSync(join(MIGRATIONS, name), join(dir, name));
  return dir;
}

describe("the file-types migration", () => {
  test("keeps every file, page and job of a database that is already in use", () => {
    const db = openDatabase(":memory:");
    migrate(
      db,
      dirWith((n) => n < REBUILD),
    );
    // A file with a page and a job, as the app had them before this change.
    db.prepare(
      `INSERT INTO source_files (id, user_id, original_name, sha256, bytes, type, status,
         uploaded_by, created_at, updated_at, parked_node_id)
       VALUES ('fil_1', 'usr_1', 'a.pdf', ?, 10, 'pdf', 'converted', '{}', 1, 1, 'nod_parked')`,
    ).run("a".repeat(64));
    db.prepare(
      `INSERT INTO pages (id, file_id, user_id, idx, width, height, image_bytes, has_text_layer)
       VALUES ('pag_1', 'fil_1', 'usr_1', 1, 10, 10, 10, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO conversion_jobs (id, file_id, user_id, sha256, state, created_at)
       VALUES ('job_1', 'fil_1', 'usr_1', ?, 'done', 1)`,
    ).run("a".repeat(64));

    const applied = migrate(
      db,
      dirWith((n) => n >= REBUILD),
    );
    expect(applied).toContain(REBUILD);

    // Nothing cascaded away while the table was rebuilt, and nothing was lost from the row.
    expect(db.prepare("SELECT count(*) AS n FROM pages").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM conversion_jobs").get()).toEqual({ n: 1 });
    expect(
      db.prepare("SELECT type, parked_node_id, conversion_notes FROM source_files").get(),
    ).toEqual({ type: "pdf", parked_node_id: "nod_parked", conversion_notes: null });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    // Keys are back on, and the children still point at the rebuilt table.
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() => db.prepare("DELETE FROM source_files WHERE id = 'fil_1'").run()).not.toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM pages").get()).toEqual({ n: 0 });
  });

  test("the new types are allowed, an unknown one still is not, and the indexes and trigger are back", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const insert = (id: string, type: string) =>
      db
        .prepare(
          `INSERT INTO source_files (id, user_id, original_name, sha256, bytes, type, status,
             uploaded_by, created_at, updated_at)
           VALUES (?, 'usr_1', 'x', ?, 1, ?, 'uploaded', '{}', 1, 1)`,
        )
        .run(id, "b".repeat(64), type);
    for (const type of [
      "pdf",
      "pptx",
      "ppt",
      "docx",
      "doc",
      "odp",
      "odt",
      "jpeg",
      "png",
      "heic",
      "webp",
      "gif",
      "tiff",
      "avif",
      "bmp",
    ])
      expect(() => insert(`fil_${type}`, type), type).not.toThrow();
    expect(() => insert("fil_svg", "svg")).toThrow(/CHECK/);
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE tbl_name = 'source_files'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "source_files_user",
        "source_files_status",
        "source_files_node",
        "source_files_sha",
        "source_files_parked",
        "source_files_unfiled",
      ]),
    );
  });
});
