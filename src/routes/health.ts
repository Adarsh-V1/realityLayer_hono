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

// Full sign-up simulation (body parse + DB queries + hash)
healthRoute.post("/health/test-signup", async (c) => {
  const timings: Record<string, number> = {};
  const start = Date.now();
  try {
    // 1. Parse body
    const body = await c.req.json();
    timings.bodyParseMs = Date.now() - start;

    // 2. DB read
    let t = Date.now();
    await db.execute(sql`SELECT * FROM "user" WHERE email = 'nobody@test.com' LIMIT 1`);
    timings.dbReadMs = Date.now() - t;

    // 3. Scrypt hash
    t = Date.now();
    const crypto = await import("node:crypto");
    await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt("TestPass123", "salt1234567890123456", 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    timings.hashMs = Date.now() - t;

    // 4. DB write
    t = Date.now();
    await db.execute(sql`SELECT 1`);
    timings.dbWriteMs = Date.now() - t;

    timings.totalMs = Date.now() - start;
    return success(c, { timings, body });
  } catch (err: any) {
    timings.totalMs = Date.now() - start;
    return error(c, "TEST_ERROR", `${err.message} | timings: ${JSON.stringify(timings)}`, 500);
  }
});

healthRoute.get("/", (c) => {
  return success(c, {
    name: "Reality Layer API",
    version: process.env.npm_package_version ?? "0.1.0",
  });
});
