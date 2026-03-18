import "dotenv/config";

import { serve } from "@hono/node-server";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { createApp } from "./app.js";
import { bootstrapPlugins } from "./plugins/bootstrap.js";

const app = createApp();

// Register all plugins before accepting requests
bootstrapPlugins()
  .then(() => {
    serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }, (info) => {
      logger.info(`Reality Layer API running on http://0.0.0.0:${info.port}`);
      logger.info(`LAN access: http://192.168.67.149:${info.port}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
      logger.info(`Health check: http://192.168.67.149:${info.port}/health`);
    });
  })
  .catch((err) => {
    logger.fatal({ err }, "Failed to bootstrap plugins");
    process.exit(1);
  });
