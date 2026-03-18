import { eq, desc, and, ilike, or, sql, count } from "drizzle-orm";
import { db } from "../connection.js";
import {
  memories,
  type NewMemory,
  type Memory,
  type MemoryCategory,
} from "../schema/memories.js";
import { MemoryCache } from "../../lib/cache.js";

// Cache: 2-minute TTL for list queries, 5 minutes for insights
const listCache = new MemoryCache<Memory[]>(2 * 60_000);
const insightsCache = new MemoryCache<MemoryInsights>(5 * 60_000);

export interface MemoryFilters {
  category?: MemoryCategory;
  isFavorite?: boolean;
  search?: string;
  tags?: string[];
}

export interface MemoryInsights {
  totalMemories: number;
  totalObjects: number;
  categoryCounts: Record<string, number>;
  topObjects: { name: string; count: number }[];
  favoriteCount: number;
  recentActivity: { date: string; count: number }[];
}

export async function createMemory(data: NewMemory): Promise<Memory> {
  const [memory] = await db.insert(memories).values(data).returning();
  listCache.invalidate(`memories:${data.userId}`);
  insightsCache.invalidate(`insights:${data.userId}`);
  return memory;
}

export async function getMemoriesByUser(
  userId: string,
  limit = 20,
  offset = 0,
  filters: MemoryFilters = {},
): Promise<Memory[]> {
  // Only cache unfiltered first-page requests
  const isDefaultQuery =
    !filters.category &&
    !filters.isFavorite &&
    !filters.search &&
    !filters.tags?.length &&
    offset === 0 &&
    limit === 20;

  if (isDefaultQuery) {
    const cached = listCache.get(`memories:${userId}:default`);
    if (cached) return cached;
  }

  const conditions = [eq(memories.userId, userId)];

  if (filters.category) {
    conditions.push(eq(memories.category, filters.category));
  }
  if (filters.isFavorite !== undefined) {
    conditions.push(eq(memories.isFavorite, filters.isFavorite));
  }
  if (filters.search) {
    const searchPattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(memories.title, searchPattern),
        ilike(memories.notes, searchPattern),
      )!,
    );
  }
  if (filters.tags?.length) {
    // Check if any of the provided tags exist in the JSONB array
    conditions.push(
      sql`${memories.tags} ?| array[${sql.join(
        filters.tags.map((t) => sql`${t}`),
        sql`,`,
      )}]`,
    );
  }

  const result = await db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
    .offset(offset);

  if (isDefaultQuery) {
    listCache.set(`memories:${userId}:default`, result);
  }

  return result;
}

export async function getMemoryById(
  id: string,
  userId: string,
): Promise<Memory | undefined> {
  return db.query.memories.findFirst({
    where: and(eq(memories.id, id), eq(memories.userId, userId)),
  });
}

export async function updateMemory(
  id: string,
  userId: string,
  data: Partial<
    Pick<
      NewMemory,
      "title" | "category" | "tags" | "notes" | "isFavorite" | "metadata"
    >
  >,
): Promise<Memory | undefined> {
  const [updated] = await db
    .update(memories)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning();

  if (updated) {
    listCache.invalidate(`memories:${userId}`);
    insightsCache.invalidate(`insights:${userId}`);
  }

  return updated;
}

export async function deleteMemory(
  id: string,
  userId: string,
): Promise<boolean> {
  const [deleted] = await db
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning({ id: memories.id });

  if (deleted) {
    listCache.invalidate(`memories:${userId}`);
    insightsCache.invalidate(`insights:${userId}`);
  }

  return !!deleted;
}

export async function getMemoryInsights(
  userId: string,
): Promise<MemoryInsights> {
  const cached = insightsCache.get(`insights:${userId}`);
  if (cached) return cached;

  // Run all insight queries concurrently
  const [totalResult, favResult, categoryResult, allMemories] =
    await Promise.all([
      db
        .select({ count: count() })
        .from(memories)
        .where(eq(memories.userId, userId)),
      db
        .select({ count: count() })
        .from(memories)
        .where(
          and(eq(memories.userId, userId), eq(memories.isFavorite, true)),
        ),
      db
        .select({
          category: memories.category,
          count: count(),
        })
        .from(memories)
        .where(eq(memories.userId, userId))
        .groupBy(memories.category),
      db
        .select({
          objects: memories.objects,
          objectCount: memories.objectCount,
          createdAt: memories.createdAt,
        })
        .from(memories)
        .where(eq(memories.userId, userId)),
    ]);

  // Aggregate object counts
  const objectNameCounts = new Map<string, number>();
  let totalObjects = 0;
  for (const m of allMemories) {
    totalObjects += m.objectCount;
    if (Array.isArray(m.objects)) {
      for (const obj of m.objects) {
        const name = obj.name;
        objectNameCounts.set(name, (objectNameCounts.get(name) ?? 0) + 1);
      }
    }
  }

  const topObjects = [...objectNameCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Recent activity: memories per day for last 7 days
  const now = new Date();
  const recentActivity: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const dayCount = allMemories.filter((m) => {
      const mDate = new Date(m.createdAt).toISOString().split("T")[0];
      return mDate === dateStr;
    }).length;
    recentActivity.push({ date: dateStr, count: dayCount });
  }

  const categoryCounts: Record<string, number> = {};
  for (const row of categoryResult) {
    categoryCounts[row.category] = row.count;
  }

  const insights: MemoryInsights = {
    totalMemories: totalResult[0].count,
    totalObjects,
    categoryCounts,
    topObjects,
    favoriteCount: favResult[0].count,
    recentActivity,
  };

  insightsCache.set(`insights:${userId}`, insights);
  return insights;
}

export async function getMemoryCount(userId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(memories)
    .where(eq(memories.userId, userId));
  return result.count;
}
