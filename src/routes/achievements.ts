import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and, sql } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import { achievements, userStreaks } from "../db/schema/features.js";
import { memories } from "../db/schema/memories.js";

export const achievementRoute = new Hono<AuthedEnv>();

achievementRoute.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Achievement definitions
// ---------------------------------------------------------------------------

interface AchievementDef {
  type: string;
  title: string;
  description: string;
  icon: string;
  check: (ctx: AchievementCheckContext) => boolean;
}

interface AchievementCheckContext {
  totalScans: number;
  totalObjects: number;
  currentStreak: number;
  longestStreak: number;
  hasFavorite: boolean;
  categoryCount: number;
  level: number;
}

const ACHIEVEMENT_DEFS: AchievementDef[] = [
  {
    type: "first_scan",
    title: "First Scan",
    description: "Complete your very first scan",
    icon: "\u{1F50D}",
    check: (ctx) => ctx.totalScans >= 1,
  },
  {
    type: "scans_10",
    title: "Getting Started",
    description: "Complete 10 scans",
    icon: "\u{1F4F7}",
    check: (ctx) => ctx.totalScans >= 10,
  },
  {
    type: "scans_50",
    title: "Scanner Pro",
    description: "Complete 50 scans",
    icon: "\u{1F3AF}",
    check: (ctx) => ctx.totalScans >= 50,
  },
  {
    type: "scans_100",
    title: "Century Club",
    description: "Complete 100 scans",
    icon: "\u{1F4AF}",
    check: (ctx) => ctx.totalScans >= 100,
  },
  {
    type: "first_favorite",
    title: "Sentimental",
    description: "Favorite your first memory",
    icon: "\u{2764}\u{FE0F}",
    check: (ctx) => ctx.hasFavorite,
  },
  {
    type: "categories_5",
    title: "Explorer",
    description: "Scan items in 5 different categories",
    icon: "\u{1F30D}",
    check: (ctx) => ctx.categoryCount >= 5,
  },
  {
    type: "streak_7",
    title: "Week Warrior",
    description: "Maintain a 7-day scanning streak",
    icon: "\u{1F525}",
    check: (ctx) => ctx.longestStreak >= 7,
  },
  {
    type: "streak_30",
    title: "Monthly Master",
    description: "Maintain a 30-day scanning streak",
    icon: "\u{26A1}",
    check: (ctx) => ctx.longestStreak >= 30,
  },
  {
    type: "objects_100",
    title: "Object Collector",
    description: "Identify 100 total objects",
    icon: "\u{1F9E9}",
    check: (ctx) => ctx.totalObjects >= 100,
  },
  {
    type: "level_5",
    title: "Leveling Up",
    description: "Reach level 5",
    icon: "\u{2B50}",
    check: (ctx) => ctx.level >= 5,
  },
  {
    type: "level_10",
    title: "Veteran",
    description: "Reach level 10",
    icon: "\u{1F451}",
    check: (ctx) => ctx.level >= 10,
  },
];

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const checkAchievementsSchema = z.object({
  scannedObjectCount: z.number().int().min(0).optional().default(0),
});

// ---------------------------------------------------------------------------
// GET /achievements — Get user's achievements and streak info
// ---------------------------------------------------------------------------

achievementRoute.get("/achievements", async (c) => {
  const user = c.get("user");

  const userAchievements = await db
    .select()
    .from(achievements)
    .where(eq(achievements.userId, user.id))
    .orderBy(desc(achievements.unlockedAt));

  const [streak] = await db
    .select()
    .from(userStreaks)
    .where(eq(userStreaks.userId, user.id))
    .limit(1);

  return success(c, {
    achievements: userAchievements,
    streak: streak ?? {
      currentStreak: 0,
      longestStreak: 0,
      totalScans: 0,
      totalObjects: 0,
      xp: 0,
      level: 1,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /achievements/leaderboard — Global XP leaderboard
// ---------------------------------------------------------------------------

achievementRoute.get("/achievements/leaderboard", async (c) => {
  const url = new URL(c.req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));

  const leaderboard = await db
    .select({
      userId: userStreaks.userId,
      xp: userStreaks.xp,
      level: userStreaks.level,
      totalScans: userStreaks.totalScans,
      currentStreak: userStreaks.currentStreak,
      longestStreak: userStreaks.longestStreak,
    })
    .from(userStreaks)
    .orderBy(desc(userStreaks.xp))
    .limit(limit);

  return success(c, {
    leaderboard: leaderboard.map((entry, i) => ({
      rank: i + 1,
      ...entry,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /achievements/check — Check and award achievements after a scan
// ---------------------------------------------------------------------------

achievementRoute.post("/achievements/check", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const parsed = checkAchievementsSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, "INVALID_INPUT", parsed.error.issues[0].message, 400);
  }

  const { scannedObjectCount } = parsed.data;

  // Get or create user streak
  let [streak] = await db
    .select()
    .from(userStreaks)
    .where(eq(userStreaks.userId, user.id))
    .limit(1);

  if (!streak) {
    [streak] = await db
      .insert(userStreaks)
      .values({
        userId: user.id,
        currentStreak: 0,
        longestStreak: 0,
        totalScans: 0,
        totalObjects: 0,
        xp: 0,
        level: 1,
      })
      .returning();
  }

  // Update streak
  const now = new Date();
  const lastScan = streak.lastScanDate ? new Date(streak.lastScanDate) : null;
  let newCurrentStreak = streak.currentStreak;

  if (lastScan) {
    const diffMs = now.getTime() - lastScan.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 48 && diffHours >= 20) {
      // Within a reasonable day window — continue streak
      newCurrentStreak += 1;
    } else if (diffHours >= 48) {
      // Streak broken
      newCurrentStreak = 1;
    }
    // If less than 20 hours (same day), keep current streak
  } else {
    newCurrentStreak = 1;
  }

  const newLongestStreak = Math.max(streak.longestStreak, newCurrentStreak);
  const newTotalScans = streak.totalScans + 1;
  const newTotalObjects = streak.totalObjects + scannedObjectCount;

  // XP calculation: base 10 per scan + 2 per object + streak bonus
  const xpGain = 10 + scannedObjectCount * 2 + newCurrentStreak * 5;
  const newXp = streak.xp + xpGain;

  // Level calculation: level = floor(sqrt(xp / 100)) + 1
  const newLevel = Math.floor(Math.sqrt(newXp / 100)) + 1;

  [streak] = await db
    .update(userStreaks)
    .set({
      currentStreak: newCurrentStreak,
      longestStreak: newLongestStreak,
      lastScanDate: now,
      totalScans: newTotalScans,
      totalObjects: newTotalObjects,
      xp: newXp,
      level: newLevel,
      updatedAt: now,
    })
    .where(eq(userStreaks.id, streak.id))
    .returning();

  // Check for favorites
  const [favoriteResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(
      and(eq(memories.userId, user.id), eq(memories.isFavorite, true)),
    );
  const hasFavorite = (favoriteResult?.count ?? 0) > 0;

  // Check distinct categories
  const categoryRows = await db
    .select({ category: memories.category })
    .from(memories)
    .where(eq(memories.userId, user.id))
    .groupBy(memories.category);
  const categoryCount = categoryRows.length;

  // Get existing achievements
  const existingAchievements = await db
    .select({ type: achievements.type })
    .from(achievements)
    .where(eq(achievements.userId, user.id));
  const existingTypes = new Set(existingAchievements.map((a) => a.type));

  // Check for new achievements
  const ctx: AchievementCheckContext = {
    totalScans: newTotalScans,
    totalObjects: newTotalObjects,
    currentStreak: newCurrentStreak,
    longestStreak: newLongestStreak,
    hasFavorite,
    categoryCount,
    level: newLevel,
  };

  const newAchievements: typeof achievements.$inferSelect[] = [];

  for (const def of ACHIEVEMENT_DEFS) {
    if (existingTypes.has(def.type)) continue;
    if (!def.check(ctx)) continue;

    const [achievement] = await db
      .insert(achievements)
      .values({
        userId: user.id,
        type: def.type,
        title: def.title,
        description: def.description,
        icon: def.icon,
        metadata: {},
      })
      .returning();

    newAchievements.push(achievement);
  }

  return success(c, {
    streak,
    xpGain,
    newAchievements,
    totalAchievements: existingTypes.size + newAchievements.length,
  });
});
