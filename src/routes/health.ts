import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { AppEnv } from "../lib/types.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";

export const healthRoute = new Hono<AppEnv>();

healthRoute.get("/health", (c) => {
  return success(c, {
    status: "healthy",
    version: process.env.npm_package_version ?? "0.1.0",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// DB connectivity test
healthRoute.get("/health/db", async (c) => {
  const start = Date.now();
  try {
    const result = await db.execute(sql`SELECT 1 as ok`);
    return success(c, {
      db: "connected",
      latencyMs: Date.now() - start,
      result: result.rows?.[0] ?? result,
    });
  } catch (err: any) {
    return error(c, "DB_ERROR", err.message ?? String(err), 500);
  }
});

healthRoute.get("/", (c) => {
  return success(c, {
    name: "Reality Layer API",
    version: process.env.npm_package_version ?? "0.1.0",
  });
});
