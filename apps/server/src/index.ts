import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { migrate, openDatabase, snapshotBeforeMigration } from "./db/client.js";
import { startQueueWatcher, stopQueueWatcher } from "./domains/files/index.js";
import { AppError } from "./http/errors.js";
import { createServices } from "./services.js";
import { bindStorage } from "./storage/binding.js";
import { openStorage } from "./storage/storage.js";

try {
  const config = loadConfig();
  // Storage first: if the drive is missing, stop before touching anything.
  const storage = openStorage(config.DATA_DIR);
  const db = openDatabase(config.DB_PATH);
  // A restore point before any migration changes her data: a full copy of the database on the storage
  // drive. If it cannot be written the server stops here, before anything is applied.
  const applied = migrate(db, undefined, {
    beforeFirst: (pending) => {
      const file = snapshotBeforeMigration(db, join(storage.root, "backups"), pending);
      console.log(`pre-migration snapshot: ${file} (before ${pending.join(", ")})`);
    },
  });
  if (applied.length > 0) console.log(`applied migrations: ${applied.join(", ")}`);
  bindStorage(db, storage);
  // One instance of every domain service, shared by the routes and the queue watcher.
  const services = createServices({ config, db, now: Date.now }, { files: { storage } });
  const app = createApp(config, { db, services });
  // Ingest the converter's result files (queue/done, queue/failed) and fail stuck jobs.
  const queueWatcher = startQueueWatcher(
    { config, db, now: Date.now },
    { service: services.files },
  );
  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`notes server listening on :${info.port} (${config.NODE_ENV})`);
    console.log(`storage ${storage.root} (id ${storage.marker.storageId})`);
  });
  const shutdown = () => {
    stopQueueWatcher(queueWatcher);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  if (error instanceof AppError && error.code === "storage_unavailable") {
    console.error(`storage_unavailable: ${error.message}`);
    if (error.hint) console.error(error.hint);
    console.error("Refusing to start.");
    process.exit(1);
  }
  throw error;
}
