import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import { timeCapsules, type TimeCapsuleChanges } from "../db/schema/features.js";
import { generateJson } from "../plugins/ai-helper.js";

export const timeCapsuleRoute = new Hono<AuthedEnv>();

timeCapsuleRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const objectSchema = z.object({
  name: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const createCapsuleSchema = z.object({
  title: z.string().min(1).max(255),
  location: z.string().max(255).optional(),
  objects: z.array(objectSchema).min(1),
  imageUrl: z.string().url().optional(),
});

const rescanSchema = z.object({
  objects: z.array(objectSchema).min(1),
  imageUrl: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// POST /time-capsules — Create a time capsule
// ---------------------------------------------------------------------------

timeCapsuleRoute.post("/time-capsules", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const parsed = createCapsuleSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { title, location, objects, imageUrl } = parsed.data;

  const [capsule] = await db
    .insert(timeCapsules)
    .values({
      userId: user.id,
      title,
      location: location ?? null,
      originalScan: objects,
      originalImageUrl: imageUrl ?? null,
      scanCount: 1,
    })
    .returning();

  return success(c, capsule, 201);
});

// ---------------------------------------------------------------------------
// GET /time-capsules — List user's capsules
// ---------------------------------------------------------------------------

timeCapsuleRoute.get("/time-capsules", async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const capsules = await db
    .select()
    .from(timeCapsules)
    .where(eq(timeCapsules.userId, user.id))
    .orderBy(desc(timeCapsules.createdAt))
    .limit(limit)
    .offset(offset);

  return success(c, { capsules, limit, offset });
});

// ---------------------------------------------------------------------------
// GET /time-capsules/:id — Get capsule
// ---------------------------------------------------------------------------

timeCapsuleRoute.get("/time-capsules/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const [capsule] = await db
    .select()
    .from(timeCapsules)
    .where(and(eq(timeCapsules.id, id), eq(timeCapsules.userId, user.id)))
    .limit(1);

  if (!capsule) {
    return error(c, "NOT_FOUND", "Time capsule not found", 404);
  }

  return success(c, capsule);
});

// ---------------------------------------------------------------------------
// POST /time-capsules/:id/rescan — Compare new scan with original
// ---------------------------------------------------------------------------

timeCapsuleRoute.post("/time-capsules/:id/rescan", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = rescanSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { objects, imageUrl } = parsed.data;

  const [capsule] = await db
    .select()
    .from(timeCapsules)
    .where(and(eq(timeCapsules.id, id), eq(timeCapsules.userId, user.id)))
    .limit(1);

  if (!capsule) {
    return error(c, "NOT_FOUND", "Time capsule not found", 404);
  }

  // Use AI to compute a meaningful diff
  const originalNames = capsule.originalScan.map((o) => o.name);
  const newNames = objects.map((o) => o.name);

  const diff = await generateJson<TimeCapsuleChanges>(
    `Compare two scans of the same location/scene and identify changes.

Original scan objects: ${JSON.stringify(originalNames)}
New scan objects: ${JSON.stringify(newNames)}

Return a JSON object with:
- "added": array of item names that appear in the new scan but not the original
- "removed": array of item names that were in the original but are missing from the new scan
- "moved": array of item names that are in both but might have been rearranged (use your judgment based on name similarity)

Be smart about matching — "Red Chair" and "red chair" are the same item.
Return ONLY valid JSON, no markdown fences.`,
  );

  const [updated] = await db
    .update(timeCapsules)
    .set({
      latestScan: objects,
      latestImageUrl: imageUrl ?? null,
      changes: diff,
      scanCount: capsule.scanCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(timeCapsules.id, id))
    .returning();

  return success(c, updated);
});

// ---------------------------------------------------------------------------
// DELETE /time-capsules/:id — Delete a capsule
// ---------------------------------------------------------------------------

timeCapsuleRoute.delete("/time-capsules/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const [deleted] = await db
    .delete(timeCapsules)
    .where(and(eq(timeCapsules.id, id), eq(timeCapsules.userId, user.id)))
    .returning();

  if (!deleted) {
    return error(c, "NOT_FOUND", "Time capsule not found", 404);
  }

  return success(c, { deleted: true });
});
