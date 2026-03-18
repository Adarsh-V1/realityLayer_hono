import { Hono } from "hono";
import { z } from "zod";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import {
  createMemory,
  getMemoriesByUser,
  getMemoryById,
  updateMemory,
  deleteMemory,
  getMemoryInsights,
} from "../db/queries/memories.js";
import type { MemoryCategory } from "../db/schema/memories.js";

export const memoryRoute = new Hono<AuthedEnv>();

memoryRoute.use("/*", requireAuth);

const VALID_CATEGORIES: MemoryCategory[] = [
  "general",
  "electronics",
  "furniture",
  "clothing",
  "food",
  "vehicle",
  "nature",
  "art",
  "sports",
  "tools",
  "other",
];

const createMemorySchema = z.object({
  title: z.string().min(1).max(255),
  category: z
    .enum(VALID_CATEGORIES as [string, ...string[]])
    .optional()
    .default("general"),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  objects: z
    .array(
      z.object({
        name: z.string(),
        confidence: z.number().min(0).max(1),
        summary: z.string(),
        recommendation: z.string(),
        price: z.string(),
      }),
    )
    .optional()
    .default([]),
  imageUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  notes: z.string().max(2000).optional(),
  scanId: z.string().uuid().optional(),
  isFavorite: z.boolean().optional().default(false),
  totalValue: z.string().max(50).optional(),
  metadata: z
    .object({
      scanDuration: z.number().optional(),
      pluginsUsed: z.array(z.string()).optional(),
      location: z
        .object({ lat: z.number(), lng: z.number() })
        .optional(),
      deviceModel: z.string().optional(),
    })
    .optional(),
});

const updateMemorySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  category: z
    .enum(VALID_CATEGORIES as [string, ...string[]])
    .optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  notes: z.string().max(2000).optional(),
  isFavorite: z.boolean().optional(),
  metadata: z
    .object({
      scanDuration: z.number().optional(),
      pluginsUsed: z.array(z.string()).optional(),
      location: z
        .object({ lat: z.number(), lng: z.number() })
        .optional(),
      deviceModel: z.string().optional(),
    })
    .optional(),
});

/**
 * GET /api/memories
 * List memories with pagination, search, and filters.
 */
memoryRoute.get("/memories", async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);

  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const category = url.searchParams.get("category") as MemoryCategory | null;
  const search = url.searchParams.get("search");
  const isFavorite = url.searchParams.get("favorite");
  const tagsParam = url.searchParams.get("tags");

  const filters = {
    ...(category && VALID_CATEGORIES.includes(category) ? { category } : {}),
    ...(search ? { search } : {}),
    ...(isFavorite !== null ? { isFavorite: isFavorite === "true" } : {}),
    ...(tagsParam ? { tags: tagsParam.split(",").map((t) => t.trim()) } : {}),
  };

  const memories = await getMemoriesByUser(user.id, limit, offset, filters);
  return success(c, { memories, limit, offset });
});

/**
 * GET /api/memories/insights
 * Aggregated stats and insights from user's memory collection.
 */
memoryRoute.get("/memories/insights", async (c) => {
  const user = c.get("user");
  const insights = await getMemoryInsights(user.id);
  return success(c, insights);
});

/**
 * GET /api/memories/:id
 * Get a single memory by ID.
 */
memoryRoute.get("/memories/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const memory = await getMemoryById(id, user.id);
  if (!memory) {
    return error(c, "NOT_FOUND", "Memory not found", 404);
  }

  return success(c, memory);
});

/**
 * POST /api/memories
 * Create a new memory (from a scan or manually).
 */
memoryRoute.post("/memories", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const parsed = createMemorySchema.safeParse(body);

  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const memory = await createMemory({
    ...parsed.data,
    userId: user.id,
    objectCount: parsed.data.objects.length,
    category: parsed.data.category as MemoryCategory,
  });

  return success(c, memory, 201);
});

/**
 * PATCH /api/memories/:id
 * Update a memory.
 */
memoryRoute.patch("/memories/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();
  const parsed = updateMemorySchema.safeParse(body);

  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const updated = await updateMemory(id, user.id, {
    ...parsed.data,
    category: parsed.data.category as import("../db/schema/memories.js").MemoryCategory | undefined,
  });
  if (!updated) {
    return error(c, "NOT_FOUND", "Memory not found", 404);
  }

  return success(c, updated);
});

/**
 * DELETE /api/memories/:id
 * Delete a memory.
 */
memoryRoute.delete("/memories/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const deleted = await deleteMemory(id, user.id);
  if (!deleted) {
    return error(c, "NOT_FOUND", "Memory not found", 404);
  }

  return success(c, { deleted: true });
});
