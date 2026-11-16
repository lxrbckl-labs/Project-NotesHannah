import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { migrate, openDatabase } from "./db/client.js";
import { AppError } from "./http/errors.js";
import { bindStorage } from "./storage/binding.js";
import { openStorage } from "./storage/storage.js";

try {
  const config = loadConfig();
  // Storage first: if the drive is missing, stop before touching anything.
  const storage = openStorage(config.DATA_DIR);
  const db = openDatabase(config.DB_PATH);
  const applied = migrate(db);
  if (applied.length > 0) console.log(`applied migrations: ${applied.join(", ")}`);
  bindStorage(db, storage);
  const app = createApp(config, { db });
  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`notes server listening on :${info.port} (${config.NODE_ENV})`);
    console.log(`storage ${storage.root} (id ${storage.marker.storageId})`);
  });
  const shutdown = () => {
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
