import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrate, openDatabase, snapshotBeforeMigration } from "../src/db/client.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "notes-premig-"));
  const migrations = join(root, "migrations");
  mkdirSync(migrations);
  writeFileSync(join(migrations, "0001_first.sql"), "CREATE TABLE things (name TEXT NOT NULL);");
  const db = openDatabase(join(root, "db", "notes.db"));
  const backups = join(root, "backups");
  const calls: string[][] = [];
  const run = () =>
    migrate(db, migrations, {
      beforeFirst: (pending) => {
        calls.push([...pending]);
        snapshotBeforeMigration(db, backups, pending, new Date("2026-11-24T18:00:00.000Z"));
      },
    });
  return { root, migrations, db, backups, calls, run };
}

describe("the snapshot before a migration", () => {
  test("a new database is migrated without one: there is nothing to lose yet", () => {
    const { run, calls } = setup();
    expect(run()).toEqual(["0001_first.sql"]);
    expect(calls).toEqual([]);
  });

  test("nothing pending, no snapshot", () => {
    const { run, calls } = setup();
    run();
    expect(run()).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("a later migration is preceded by a full copy that holds the data as it was", () => {
    const { run, calls, db, migrations, backups } = setup();
    run();
    db.prepare("INSERT INTO things (name) VALUES (?)").run("metoprolol");
    writeFileSync(join(migrations, "0002_second.sql"), "DELETE FROM things;");
    writeFileSync(join(migrations, "0003_third.sql"), "ALTER TABLE things ADD COLUMN dose TEXT;");
    expect(run()).toEqual(["0002_second.sql", "0003_third.sql"]);
    // Asked once, for both, before the first of them.
    expect(calls).toEqual([["0002_second.sql", "0003_third.sql"]]);
    expect(db.prepare("SELECT count(*) AS n FROM things").get()).toEqual({ n: 0 });
    const files = readdirSync(join(backups, "pre-migration"));
    expect(files).toEqual(["notes-20261124T180000Z-before-0002_second.db"]);
    const copy = new Database(join(backups, "pre-migration", files[0] as string), {
      readonly: true,
    });
    expect(copy.prepare("SELECT name FROM things").all()).toEqual([{ name: "metoprolol" }]);
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    copy.close();
  });

  test("if the copy cannot be written, nothing is applied", () => {
    const { db, migrations, root } = setup();
    migrate(db, migrations);
    db.prepare("INSERT INTO things (name) VALUES (?)").run("warfarin");
    writeFileSync(join(migrations, "0002_second.sql"), "DELETE FROM things;");
    // A file where the backups folder should be: the copy has nowhere to go.
    const blocked = join(root, "not-a-folder");
    writeFileSync(blocked, "x");
    expect(() =>
      migrate(db, migrations, {
        beforeFirst: (pending) => void snapshotBeforeMigration(db, blocked, pending),
      }),
    ).toThrow();
    expect(db.prepare("SELECT name FROM things").all()).toEqual([{ name: "warfarin" }]);
    expect(db.prepare("SELECT count(*) AS n FROM _migrations").get()).toEqual({ n: 1 });
  });
});
