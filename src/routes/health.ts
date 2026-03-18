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

// Diagnose: test scrypt password hashing speed + BETTER_AUTH_URL
healthRoute.get("/health/diag", async (c) => {
  const crypto = await import("node:crypto");
  const start = Date.now();
  const authUrl = process.env.BETTER_AUTH_URL ?? "NOT_SET";

  try {
    // Test scrypt with Better Auth's default params (N=16384, r=8, p=1)
    await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt("TestPassword123", "randomsalt1234567890", 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    const hashMs = Date.now() - start;

    return success(c, {
      scryptMs: hashMs,
      authUrl: authUrl.slice(0, 30) + "...",
      nodeVersion: process.version,
    });
  } catch (err: any) {
    return error(c, "DIAG_ERROR", err.message ?? String(err), 500);
  }
});

healthRoute.get("/", (c) => {
  return success(c, {
    name: "Reality Layer API",
    version: process.env.npm_package_version ?? "0.1.0",
  });
});
