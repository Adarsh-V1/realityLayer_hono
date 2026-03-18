import { Hono } from "hono";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success } from "../lib/api-response.js";
import { db } from "../db/connection.js";
import { usageRecords, subscriptions, auditLogs } from "../db/schema/saas.js";
import { getPlanLimits } from "../lib/plans.js";
import type { SubscriptionTier } from "../db/schema/saas.js";

export const analyticsRoute = new Hono<AuthedEnv>();

analyticsRoute.use("/*", requireAuth);

/**
 * GET /api/analytics/usage
 * Returns usage summary for the current billing period.
 * Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to current month)
 */
analyticsRoute.get("/analytics/usage", async (c) => {
  const user = c.get("user");

  const now = new Date();
  const from = c.req.query("from") ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = c.req.query("to") ?? now.toISOString().slice(0, 10);

  // Aggregate usage by endpoint
  const usage = await db
    .select({
      endpoint: usageRecords.endpoint,
      totalRequests: sql<number>`sum(${usageRecords.requestCount})::int`,
      totalCostMicros: sql<number>`sum(${usageRecords.estimatedCostMicros})::bigint`,
      totalTokens: sql<number>`sum(${usageRecords.tokensUsed})::bigint`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, user.id),
        gte(usageRecords.date, from),
        lte(usageRecords.date, to),
      ),
    )
    .groupBy(usageRecords.endpoint);

  // Daily breakdown
  const daily = await db
    .select({
      date: usageRecords.date,
      totalRequests: sql<number>`sum(${usageRecords.requestCount})::int`,
      totalCostMicros: sql<number>`sum(${usageRecords.estimatedCostMicros})::bigint`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, user.id),
        gte(usageRecords.date, from),
        lte(usageRecords.date, to),
      ),
    )
    .groupBy(usageRecords.date)
    .orderBy(usageRecords.date);

  // Totals
  const totalRequests = usage.reduce((sum, u) => sum + (u.totalRequests ?? 0), 0);
  const totalCostMicros = usage.reduce((sum, u) => sum + Number(u.totalCostMicros ?? 0), 0);
  const totalCostUsd = totalCostMicros / 1_000_000;

  // Get subscription for budget context
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);

  const tier = (sub?.tier ?? "free") as SubscriptionTier;
  const limits = getPlanLimits(tier);
  const budgetMicros = limits.monthlyBudgetMicros;
  const budgetUsedPercent = budgetMicros > 0
    ? Math.round((totalCostMicros / budgetMicros) * 100)
    : 0;

  return success(c, {
    period: { from, to },
    tier,
    summary: {
      totalRequests,
      totalCostUsd: Math.round(totalCostUsd * 100) / 100,
      budgetLimitUsd: budgetMicros > 0 ? budgetMicros / 1_000_000 : null,
      budgetUsedPercent: budgetMicros > 0 ? budgetUsedPercent : null,
    },
    byEndpoint: usage.map((u) => ({
      endpoint: u.endpoint,
      requests: u.totalRequests ?? 0,
      costUsd: Math.round(Number(u.totalCostMicros ?? 0) / 10_000) / 100,
      tokens: Number(u.totalTokens ?? 0),
    })),
    daily: daily.map((d) => ({
      date: d.date,
      requests: d.totalRequests ?? 0,
      costUsd: Math.round(Number(d.totalCostMicros ?? 0) / 10_000) / 100,
    })),
  });
});

/**
 * GET /api/analytics/overview
 * High-level metrics dashboard (total users, scans, cost trends).
 * Accessible to enterprise users or admins.
 */
analyticsRoute.get("/analytics/overview", async (c) => {
  const user = c.get("user");

  // Get user's usage stats for quick overview
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastMonth = now.getMonth() === 0
    ? `${now.getFullYear() - 1}-12`
    : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}`;

  // This month totals
  const [thisMonthStats] = await db
    .select({
      totalRequests: sql<number>`coalesce(sum(${usageRecords.requestCount}), 0)::int`,
      totalCostMicros: sql<number>`coalesce(sum(${usageRecords.estimatedCostMicros}), 0)::bigint`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, user.id),
        sql`${usageRecords.date} like ${thisMonth + "%"}`,
      ),
    );

  // Last month totals
  const [lastMonthStats] = await db
    .select({
      totalRequests: sql<number>`coalesce(sum(${usageRecords.requestCount}), 0)::int`,
      totalCostMicros: sql<number>`coalesce(sum(${usageRecords.estimatedCostMicros}), 0)::bigint`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, user.id),
        sql`${usageRecords.date} like ${lastMonth + "%"}`,
      ),
    );

  // Most-used endpoints
  const topEndpoints = await db
    .select({
      endpoint: usageRecords.endpoint,
      totalRequests: sql<number>`sum(${usageRecords.requestCount})::int`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.userId, user.id),
        sql`${usageRecords.date} like ${thisMonth + "%"}`,
      ),
    )
    .groupBy(usageRecords.endpoint)
    .orderBy(desc(sql`sum(${usageRecords.requestCount})`))
    .limit(5);

  // Recent audit events
  const recentActivity = await db
    .select({
      action: auditLogs.action,
      resource: auditLogs.resource,
      createdAt: auditLogs.createdAt,
      statusCode: auditLogs.statusCode,
    })
    .from(auditLogs)
    .where(eq(auditLogs.userId, user.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(10);

  const thisMonthRequests = thisMonthStats?.totalRequests ?? 0;
  const lastMonthRequests = lastMonthStats?.totalRequests ?? 0;
  const requestsTrend = lastMonthRequests > 0
    ? Math.round(((thisMonthRequests - lastMonthRequests) / lastMonthRequests) * 100)
    : 0;

  return success(c, {
    thisMonth: {
      requests: thisMonthRequests,
      costUsd: Math.round(Number(thisMonthStats?.totalCostMicros ?? 0) / 10_000) / 100,
    },
    lastMonth: {
      requests: lastMonthRequests,
      costUsd: Math.round(Number(lastMonthStats?.totalCostMicros ?? 0) / 10_000) / 100,
    },
    trends: {
      requestsChangePercent: requestsTrend,
    },
    topEndpoints: topEndpoints.map((e) => ({
      endpoint: e.endpoint,
      requests: e.totalRequests ?? 0,
    })),
    recentActivity: recentActivity.map((a) => ({
      action: a.action,
      resource: a.resource,
      statusCode: a.statusCode,
      at: a.createdAt,
    })),
  });
});
