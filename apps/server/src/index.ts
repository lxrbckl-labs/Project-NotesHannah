import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

try {
  const config = loadConfig();
  const app = createApp(config);
  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`notes server listening on :${info.port} (${config.NODE_ENV})`);
  });
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
