import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get("requestId") as string | undefined;

  if (err instanceof HTTPException) {
    logger.warn({ err: err.message, status: err.status, requestId }, "HTTP exception");
    return c.json(
      {
        ok: false,
        error: {
          code: `HTTP_${err.status}`,
          message: err.message,
        },
      },
      err.status,
    );
  }

  logger.error({ err, requestId }, "Unhandled error");

  return c.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message:
          env.NODE_ENV === "production"
            ? "An unexpected error occurred"
            : (err as Error).message,
      },
    },
    500,
  );
};
