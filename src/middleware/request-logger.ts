import { createMiddleware } from "hono/factory";
import { logger } from "../lib/logger.js";

export const requestLogger = createMiddleware(async (c, next) => {
  const start = performance.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Math.round(performance.now() - start);
  const status = c.res.status;

  const log = status >= 500 ? logger.error : status >= 400 ? logger.warn : logger.info;

  log.call(logger, {
    method,
    path,
    status,
    duration: `${duration}ms`,
    requestId: c.get("requestId"),
  }, `${method} ${path} ${status} ${duration}ms`);
});
