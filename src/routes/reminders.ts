import { Hono } from "hono";
import { z } from "zod";
import { eq, and, lte, gte, sql } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import { reminders } from "../db/schema/features.js";

export const reminderRoute = new Hono<AuthedEnv>();

reminderRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createReminderSchema = z.object({
  memoryId: z.string().uuid().optional(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  reminderDate: z.string().datetime(),
  type: z.enum(["expiry", "warranty", "maintenance", "custom"]).default("custom"),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .default({}),
});

const updateReminderSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  reminderDate: z.string().datetime().optional(),
  type: z.enum(["expiry", "warranty", "maintenance", "custom"]).optional(),
  isCompleted: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// POST /reminders — Create a reminder
// ---------------------------------------------------------------------------

reminderRoute.post("/reminders", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const parsed = createReminderSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { memoryId, title, description, reminderDate, type, metadata } =
    parsed.data;

  const [reminder] = await db
    .insert(reminders)
    .values({
      userId: user.id,
      memoryId: memoryId ?? null,
      title,
      description: description ?? null,
      reminderDate: new Date(reminderDate),
      type,
      isCompleted: false,
      metadata,
    })
    .returning();

  return success(c, reminder, 201);
});

// ---------------------------------------------------------------------------
// GET /reminders — List user's reminders (upcoming, overdue)
// ---------------------------------------------------------------------------

reminderRoute.get("/reminders", async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const filter = url.searchParams.get("filter"); // "upcoming" | "overdue" | "completed" | null
  const now = new Date();

  const conditions = [eq(reminders.userId, user.id)];

  if (filter === "upcoming") {
    conditions.push(
      gte(reminders.reminderDate, now),
      eq(reminders.isCompleted, false),
    );
  } else if (filter === "overdue") {
    conditions.push(
      lte(reminders.reminderDate, now),
      eq(reminders.isCompleted, false),
    );
  } else if (filter === "completed") {
    conditions.push(eq(reminders.isCompleted, true));
  }

  const userReminders = await db
    .select()
    .from(reminders)
    .where(and(...conditions))
    .orderBy(reminders.reminderDate)
    .limit(limit)
    .offset(offset);

  // Also get counts for each category
  const [overdueCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reminders)
    .where(
      and(
        eq(reminders.userId, user.id),
        lte(reminders.reminderDate, now),
        eq(reminders.isCompleted, false),
      ),
    );

  const [upcomingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reminders)
    .where(
      and(
        eq(reminders.userId, user.id),
        gte(reminders.reminderDate, now),
        eq(reminders.isCompleted, false),
      ),
    );

  return success(c, {
    reminders: userReminders,
    counts: {
      overdue: overdueCount?.count ?? 0,
      upcoming: upcomingCount?.count ?? 0,
    },
    limit,
    offset,
  });
});

// ---------------------------------------------------------------------------
// PATCH /reminders/:id — Update/complete reminder
// ---------------------------------------------------------------------------

reminderRoute.patch("/reminders/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const body = await c.req.json();

  const parsed = updateReminderSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined)
    updates.description = parsed.data.description;
  if (parsed.data.reminderDate !== undefined)
    updates.reminderDate = new Date(parsed.data.reminderDate);
  if (parsed.data.type !== undefined) updates.type = parsed.data.type;
  if (parsed.data.isCompleted !== undefined)
    updates.isCompleted = parsed.data.isCompleted;
  if (parsed.data.metadata !== undefined) updates.metadata = parsed.data.metadata;

  if (Object.keys(updates).length === 0) {
    return error(c, "INVALID_INPUT", "No fields to update", 400);
  }

  const [updated] = await db
    .update(reminders)
    .set(updates)
    .where(and(eq(reminders.id, id), eq(reminders.userId, user.id)))
    .returning();

  if (!updated) {
    return error(c, "NOT_FOUND", "Reminder not found", 404);
  }

  return success(c, updated);
});

// ---------------------------------------------------------------------------
// DELETE /reminders/:id — Delete a reminder
// ---------------------------------------------------------------------------

reminderRoute.delete("/reminders/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const [deleted] = await db
    .delete(reminders)
    .where(and(eq(reminders.id, id), eq(reminders.userId, user.id)))
    .returning();

  if (!deleted) {
    return error(c, "NOT_FOUND", "Reminder not found", 404);
  }

  return success(c, { deleted: true });
});
