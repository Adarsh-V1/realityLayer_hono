import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { usageRecords } from "../db/schema/saas.js";
import { logger } from "../lib/logger.js";

/**
 * Cost estimates in microdollars per endpoint category.
 * Adjust based on actual provider pricing.
 */
const COST_MAP: Record<string, number> = {
  scan: 5_000,      // ~$0.005 per scan (Gemini Vision)
  voice: 3_000,     // ~$0.003 per voice request
  transcribe: 1_500, // ~$0.0015 per transcription
  plugins: 2_000,   // ~$0.002 per plugin execution
  memories: 100,    // ~$0.0001 per memory CRUD
  default: 50,      // ~$0.00005 for other endpoints
};

function categorizeEndpoint(path: string, method: string): string {
  if (path.includes("/scan")) return "scan";
  if (path.includes("/voice/transcribe")) return "transcribe";
  if (path.includes("/voice")) return "voice";
  if (path.includes("/plugins") && method === "POST") return "plugins";
  if (path.includes("/memories")) return "memories";
  return "default";
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Tracks API usage per user per day per endpoint category.
 * Runs after the response is sent (fire-and-forget) to avoid
 * adding latency to the request.
 */
export const usageTracker = createMiddleware(async (c, next) => {
  await next();

  // Only track for authenticated users
  const user = c.get("user") as { id: string } | null;
  if (!user) return;

  const path = c.req.path;
  const method = c.req.method;
  const endpoint = categorizeEndpoint(path, method);
  const date = todayISO();
  const costMicros = COST_MAP[endpoint] ?? COST_MAP.default;

  // Upsert usage record (fire-and-forget)
  trackUsage(user.id, date, endpoint, costMicros).catch((err) =>
    logger.error({ err, userId: user.id, endpoint }, "Usage tracking failed"),
  );
});

async function trackUsage(
  userId: string,
  date: string,
  endpoint: string,
  costMicros: number,
): Promise<void> {
  // Try to find existing record for this user/date/endpoint
  const [existing] = await db
    .select()
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, userId),
        eq(usageRecords.date, date),
        eq(usageRecords.endpoint, endpoint),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(usageRecords)
      .set({
        requestCount: existing.requestCount + 1,
        estimatedCostMicros: existing.estimatedCostMicros + costMicros,
      })
      .where(eq(usageRecords.id, existing.id));
  } else {
    await db.insert(usageRecords).values({
      userId,
      date,
      endpoint,
      requestCount: 1,
      estimatedCostMicros: costMicros,
    });
  }
}
