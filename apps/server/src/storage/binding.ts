import type { Db } from "../db/client.js";
import { AppError } from "../http/errors.js";
import type { Storage } from "./storage.js";

const KEY = "storage_id";

/**
 * Tie the database to one storage directory. The first start records the
 * marker's storage id; later starts refuse a different one, which catches a
 * wrong drive (or an empty, freshly initialised directory) mounted where the
 * real files should be. After a deliberate move to a new drive, copy the old
 * marker file across with the files.
 */
export function bindStorage(db: Db, storage: Storage): "bound" | "matched" {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(KEY) as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(
      KEY,
      storage.marker.storageId,
    );
    return "bound";
  }
  if (row.value !== storage.marker.storageId) {
    throw new AppError(
      "storage_unavailable",
      `The storage at ${storage.root} (id ${storage.marker.storageId}) is not the one this database uses (id ${row.value}).`,
      {
        hint: "A different drive or directory may be mounted. Mount the right one, or copy the original .notes-storage marker across after a deliberate move.",
      },
    );
  }
  return "matched";
}
