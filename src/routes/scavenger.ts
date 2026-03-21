import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and, or } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import {
  scavengerHunts,
  huntParticipants,
  type ScavengerHuntItem,
  type FoundItem,
} from "../db/schema/features.js";
import { generateJson } from "../plugins/ai-helper.js";

export const scavengerRoute = new Hono<AuthedEnv>();

scavengerRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const huntItemSchema = z.object({
  name: z.string().min(1).max(100),
  found: z.boolean().default(false),
  hint: z.string().max(255).optional(),
});

const createHuntSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  items: z.array(huntItemSchema).min(1).max(50),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  timeLimit: z.number().int().positive().optional(),
  isPublic: z.boolean().default(true),
});

const generateHuntSchema = z.object({
  theme: z.string().min(1).max(255),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  itemCount: z.number().int().min(3).max(20).default(10),
  timeLimit: z.number().int().positive().optional(),
  isPublic: z.boolean().default(true),
});

const foundItemSchema = z.object({
  itemName: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// POST /hunts — Create a hunt (manual or AI-generated)
// ---------------------------------------------------------------------------

scavengerRoute.post("/hunts", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  // Check if this is a "generate" request
  if (body.mode === "generate") {
    const parsed = generateHuntSchema.safeParse(body);
    if (!parsed.success) {
      return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
    }

    const { theme, difficulty, itemCount, timeLimit, isPublic } = parsed.data;

    const generated = await generateJson<{
      title: string;
      description: string;
      items: { name: string; hint?: string }[];
    }>(`You are a scavenger hunt designer. Create a scavenger hunt based on the theme: "${theme}".
Difficulty: ${difficulty}. Number of items: ${itemCount}.

Return a JSON object with:
- "title": a catchy title for the hunt
- "description": a brief description (1-2 sentences)
- "items": an array of objects with "name" (the item to find) and "hint" (optional helpful hint)

Make items appropriate for the ${difficulty} difficulty level.
- easy: common household items
- medium: items you'd find around a neighborhood
- hard: specific or rare items

Return ONLY valid JSON, no markdown fences.`);

    const items: ScavengerHuntItem[] = generated.items.map((item) => ({
      name: item.name,
      found: false,
      hint: item.hint,
    }));

    const [hunt] = await db
      .insert(scavengerHunts)
      .values({
        creatorId: user.id,
        title: generated.title,
        description: generated.description,
        items,
        difficulty,
        timeLimit: timeLimit ?? null,
        isPublic,
      })
      .returning();

    return success(c, hunt, 201);
  }

  // Manual creation
  const parsed = createHuntSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { title, description, items, difficulty, timeLimit, isPublic } =
    parsed.data;

  const huntItems: ScavengerHuntItem[] = items.map((item) => ({
    name: item.name,
    found: false,
    hint: item.hint,
  }));

  const [hunt] = await db
    .insert(scavengerHunts)
    .values({
      creatorId: user.id,
      title,
      description: description ?? null,
      items: huntItems,
      difficulty,
      timeLimit: timeLimit ?? null,
      isPublic,
    })
    .returning();

  return success(c, hunt, 201);
});

// ---------------------------------------------------------------------------
// GET /hunts — List public hunts + user's own
// ---------------------------------------------------------------------------

scavengerRoute.get("/hunts", async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const hunts = await db
    .select()
    .from(scavengerHunts)
    .where(
      or(
        eq(scavengerHunts.isPublic, true),
        eq(scavengerHunts.creatorId, user.id),
      ),
    )
    .orderBy(desc(scavengerHunts.createdAt))
    .limit(limit)
    .offset(offset);

  return success(c, { hunts, limit, offset });
});

// ---------------------------------------------------------------------------
// GET /hunts/:id — Get hunt details
// ---------------------------------------------------------------------------

scavengerRoute.get("/hunts/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const [hunt] = await db
    .select()
    .from(scavengerHunts)
    .where(eq(scavengerHunts.id, id))
    .limit(1);

  if (!hunt) {
    return error(c, "NOT_FOUND", "Hunt not found", 404);
  }

  // Only allow access if public or owned by user
  if (!hunt.isPublic && hunt.creatorId !== user.id) {
    return error(c, "FORBIDDEN", "You do not have access to this hunt", 403);
  }

  return success(c, hunt);
});

// ---------------------------------------------------------------------------
// POST /hunts/:id/join — Join a hunt
// ---------------------------------------------------------------------------

scavengerRoute.post("/hunts/:id/join", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  // Verify hunt exists
  const [hunt] = await db
    .select()
    .from(scavengerHunts)
    .where(eq(scavengerHunts.id, id))
    .limit(1);

  if (!hunt) {
    return error(c, "NOT_FOUND", "Hunt not found", 404);
  }

  // Check if already joined
  const [existing] = await db
    .select()
    .from(huntParticipants)
    .where(
      and(
        eq(huntParticipants.huntId, id),
        eq(huntParticipants.userId, user.id),
      ),
    )
    .limit(1);

  if (existing) {
    return success(c, existing);
  }

  const [participant] = await db
    .insert(huntParticipants)
    .values({
      huntId: id,
      userId: user.id,
      foundItems: [],
      score: 0,
    })
    .returning();

  return success(c, participant, 201);
});

// ---------------------------------------------------------------------------
// POST /hunts/:id/found — Mark item as found
// ---------------------------------------------------------------------------

scavengerRoute.post("/hunts/:id/found", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = foundItemSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { itemName, confidence } = parsed.data;

  // Verify participant exists
  const [participant] = await db
    .select()
    .from(huntParticipants)
    .where(
      and(
        eq(huntParticipants.huntId, id),
        eq(huntParticipants.userId, user.id),
      ),
    )
    .limit(1);

  if (!participant) {
    return error(c, "NOT_FOUND", "You have not joined this hunt", 404);
  }

  if (participant.completedAt) {
    return error(c, "ALREADY_COMPLETED", "You have already completed this hunt", 400);
  }

  // Verify the hunt has this item
  const [hunt] = await db
    .select()
    .from(scavengerHunts)
    .where(eq(scavengerHunts.id, id))
    .limit(1);

  if (!hunt) {
    return error(c, "NOT_FOUND", "Hunt not found", 404);
  }

  const huntItem = hunt.items.find(
    (item) => item.name.toLowerCase() === itemName.toLowerCase(),
  );

  if (!huntItem) {
    return error(c, "INVALID_ITEM", "This item is not part of the hunt", 400);
  }

  // Check if already found
  const currentFound = participant.foundItems as FoundItem[];
  const alreadyFound = currentFound.find(
    (item) => item.name.toLowerCase() === itemName.toLowerCase(),
  );

  if (alreadyFound) {
    return error(c, "ALREADY_FOUND", "You have already found this item", 400);
  }

  // Add the found item
  const newFoundItem: FoundItem = {
    name: itemName,
    foundAt: new Date().toISOString(),
    confidence,
  };

  const updatedFoundItems = [...currentFound, newFoundItem];
  const newScore = updatedFoundItems.length;
  const allFound = updatedFoundItems.length === hunt.items.length;

  const [updated] = await db
    .update(huntParticipants)
    .set({
      foundItems: updatedFoundItems,
      score: newScore,
      ...(allFound ? { completedAt: new Date() } : {}),
    })
    .where(eq(huntParticipants.id, participant.id))
    .returning();

  return success(c, {
    ...updated,
    allFound,
    remaining: hunt.items.length - updatedFoundItems.length,
  });
});

// ---------------------------------------------------------------------------
// GET /hunts/:id/leaderboard — Get scores
// ---------------------------------------------------------------------------

scavengerRoute.get("/hunts/:id/leaderboard", async (c) => {
  const { id } = c.req.param();

  // Verify hunt exists
  const [hunt] = await db
    .select()
    .from(scavengerHunts)
    .where(eq(scavengerHunts.id, id))
    .limit(1);

  if (!hunt) {
    return error(c, "NOT_FOUND", "Hunt not found", 404);
  }

  const participants = await db
    .select()
    .from(huntParticipants)
    .where(eq(huntParticipants.huntId, id))
    .orderBy(desc(huntParticipants.score));

  return success(c, {
    hunt: { id: hunt.id, title: hunt.title, totalItems: hunt.items.length },
    leaderboard: participants.map((p, i) => ({
      rank: i + 1,
      userId: p.userId,
      score: p.score,
      foundItems: (p.foundItems as FoundItem[]).length,
      completedAt: p.completedAt,
      startedAt: p.startedAt,
    })),
  });
});
