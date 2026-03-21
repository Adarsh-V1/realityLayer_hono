import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and, sql } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import { collections, collectionItems } from "../db/schema/features.js";

export const collectionRoute = new Hono<AuthedEnv>();

collectionRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createCollectionSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  coverImageUrl: z.string().url().optional(),
});

const updateCollectionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  totalValue: z.string().max(50).optional(),
  coverImageUrl: z.string().url().optional(),
});

const addItemSchema = z.object({
  memoryId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  imageUrl: z.string().url().optional(),
  estimatedValue: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  condition: z.string().max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

// ---------------------------------------------------------------------------
// POST /collections — Create a collection
// ---------------------------------------------------------------------------

collectionRoute.post("/collections", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const parsed = createCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { name, description, category, coverImageUrl } = parsed.data;

  const [collection] = await db
    .insert(collections)
    .values({
      userId: user.id,
      name,
      description: description ?? null,
      category: category ?? null,
      coverImageUrl: coverImageUrl ?? null,
      totalValue: null,
      itemCount: 0,
    })
    .returning();

  return success(c, collection, 201);
});

// ---------------------------------------------------------------------------
// GET /collections — List user's collections
// ---------------------------------------------------------------------------

collectionRoute.get("/collections", async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const userCollections = await db
    .select()
    .from(collections)
    .where(eq(collections.userId, user.id))
    .orderBy(desc(collections.createdAt))
    .limit(limit)
    .offset(offset);

  return success(c, { collections: userCollections, limit, offset });
});

// ---------------------------------------------------------------------------
// GET /collections/total-value — Get total value of all user's collections
// ---------------------------------------------------------------------------

collectionRoute.get("/collections/total-value", async (c) => {
  const user = c.get("user");

  const userCollections = await db
    .select({
      totalValue: collections.totalValue,
      name: collections.name,
      id: collections.id,
    })
    .from(collections)
    .where(eq(collections.userId, user.id));

  // Parse and sum all collection values
  let totalEstimatedValue = 0;
  const breakdown: { id: string; name: string; value: string | null }[] = [];

  for (const col of userCollections) {
    breakdown.push({
      id: col.id,
      name: col.name,
      value: col.totalValue,
    });

    if (col.totalValue) {
      // Try to parse numeric value from strings like "$1,200" or "1200"
      const numericMatch = col.totalValue.replace(/[^0-9.]/g, "");
      const parsed = parseFloat(numericMatch);
      if (!isNaN(parsed)) {
        totalEstimatedValue += parsed;
      }
    }
  }

  return success(c, {
    totalEstimatedValue: `$${totalEstimatedValue.toFixed(2)}`,
    collectionCount: userCollections.length,
    breakdown,
  });
});

// ---------------------------------------------------------------------------
// GET /collections/:id — Get collection with items
// ---------------------------------------------------------------------------

collectionRoute.get("/collections/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const [collection] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, user.id)))
    .limit(1);

  if (!collection) {
    return error(c, "NOT_FOUND", "Collection not found", 404);
  }

  const items = await db
    .select()
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, id))
    .orderBy(desc(collectionItems.createdAt));

  return success(c, { collection, items });
});

// ---------------------------------------------------------------------------
// PATCH /collections/:id — Update collection
// ---------------------------------------------------------------------------

collectionRoute.patch("/collections/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = updateCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined)
    updates.description = parsed.data.description;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category;
  if (parsed.data.totalValue !== undefined)
    updates.totalValue = parsed.data.totalValue;
  if (parsed.data.coverImageUrl !== undefined)
    updates.coverImageUrl = parsed.data.coverImageUrl;

  const [updated] = await db
    .update(collections)
    .set(updates)
    .where(and(eq(collections.id, id), eq(collections.userId, user.id)))
    .returning();

  if (!updated) {
    return error(c, "NOT_FOUND", "Collection not found", 404);
  }

  return success(c, updated);
});

// ---------------------------------------------------------------------------
// DELETE /collections/:id — Delete collection (cascades items)
// ---------------------------------------------------------------------------

collectionRoute.delete("/collections/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const [deleted] = await db
    .delete(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, user.id)))
    .returning();

  if (!deleted) {
    return error(c, "NOT_FOUND", "Collection not found", 404);
  }

  return success(c, { deleted: true });
});

// ---------------------------------------------------------------------------
// POST /collections/:id/items — Add item to collection
// ---------------------------------------------------------------------------

collectionRoute.post("/collections/:id/items", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = addItemSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  // Verify collection belongs to user
  const [collection] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, user.id)))
    .limit(1);

  if (!collection) {
    return error(c, "NOT_FOUND", "Collection not found", 404);
  }

  const { name, memoryId, imageUrl, estimatedValue, notes, condition, metadata } =
    parsed.data;

  const [item] = await db
    .insert(collectionItems)
    .values({
      collectionId: id,
      memoryId: memoryId ?? null,
      name,
      imageUrl: imageUrl ?? null,
      estimatedValue: estimatedValue ?? null,
      notes: notes ?? null,
      condition: condition ?? null,
      metadata,
    })
    .returning();

  // Update collection item count
  await db
    .update(collections)
    .set({
      itemCount: sql`${collections.itemCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(collections.id, id));

  return success(c, item, 201);
});

// ---------------------------------------------------------------------------
// DELETE /collections/:id/items/:itemId — Remove item from collection
// ---------------------------------------------------------------------------

collectionRoute.delete("/collections/:id/items/:itemId", async (c) => {
  const user = c.get("user");
  const { id, itemId } = c.req.param();

  // Verify collection belongs to user
  const [collection] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.userId, user.id)))
    .limit(1);

  if (!collection) {
    return error(c, "NOT_FOUND", "Collection not found", 404);
  }

  const [deleted] = await db
    .delete(collectionItems)
    .where(
      and(
        eq(collectionItems.id, itemId),
        eq(collectionItems.collectionId, id),
      ),
    )
    .returning();

  if (!deleted) {
    return error(c, "NOT_FOUND", "Item not found", 404);
  }

  // Update collection item count
  await db
    .update(collections)
    .set({
      itemCount: sql`GREATEST(${collections.itemCount} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(collections.id, id));

  return success(c, { deleted: true });
});
