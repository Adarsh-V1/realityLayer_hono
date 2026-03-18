import { createMiddleware } from "hono/factory";
import type { SubscriptionTier } from "../db/schema/saas.js";
import { getPlanLimits } from "../lib/plans.js";
import { logger } from "../lib/logger.js";

/**
 * Sliding-window rate limiter backed by an in-memory store.
 *
 * For production multi-instance deployments, swap the store
 * implementation for Redis (e.g. @upstash/ratelimit).
 */

interface WindowEntry {
  /** Timestamps of requests in the current window */
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

// Sweep stale entries every 60s to prevent memory leaks
setInterval(() => {
  const cutoff = Date.now() - 120_000; // 2-minute lookback
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 60_000);

function checkLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Drop timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  const remaining = Math.max(0, limit - entry.timestamps.length);
  const resetAt = entry.timestamps.length > 0
    ? entry.timestamps[0] + windowMs
    : now + windowMs;

  if (entry.timestamps.length >= limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: remaining - 1, resetAt };
}

/**
 * Rate limiting middleware that enforces per-minute limits
 * based on the user's subscription tier.
 *
 * Expects `user` to be set on context (via resolveSession or API key auth).
 * Falls back to IP-based limiting for unauthenticated requests.
 */
export const rateLimiter = createMiddleware(async (c, next) => {
  const user = c.get("user") as { id: string } | null;
  const tier = ((c.get("subscriptionTier") as string) ?? "free") as SubscriptionTier;
  const limits = getPlanLimits(tier);

  // Rate limit key: user ID or IP address
  const identifier = user?.id ?? c.req.header("x-forwarded-for") ?? "anonymous";
  const rpmKey = `rpm:${identifier}`;
  const rpdKey = `rpd:${identifier}`;

  // Check per-minute limit
  const rpmResult = checkLimit(rpmKey, limits.rpm, 60_000);
  if (!rpmResult.allowed) {
    logger.warn(
      { identifier, tier, limit: limits.rpm },
      "Rate limit exceeded (per-minute)",
    );

    c.header("X-RateLimit-Limit", String(limits.rpm));
    c.header("X-RateLimit-Remaining", "0");
    c.header("X-RateLimit-Reset", String(Math.ceil(rpmResult.resetAt / 1000)));
    c.header("Retry-After", String(Math.ceil((rpmResult.resetAt - Date.now()) / 1000)));

    return c.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: `Rate limit exceeded. Upgrade to ${tier === "free" ? "Pro" : "Enterprise"} for higher limits.`,
          retryAfter: Math.ceil((rpmResult.resetAt - Date.now()) / 1000),
        },
      },
      429,
    );
  }

  // Check per-day limit
  const rpdResult = checkLimit(rpdKey, limits.rpd, 86_400_000);
  if (!rpdResult.allowed) {
    logger.warn(
      { identifier, tier, limit: limits.rpd },
      "Rate limit exceeded (per-day)",
    );

    c.header("X-RateLimit-Limit", String(limits.rpd));
    c.header("X-RateLimit-Remaining", "0");
    c.header("X-RateLimit-Reset", String(Math.ceil(rpdResult.resetAt / 1000)));
    c.header("Retry-After", String(Math.ceil((rpdResult.resetAt - Date.now()) / 1000)));

    return c.json(
      {
        ok: false,
        error: {
          code: "DAILY_LIMIT_EXCEEDED",
          message: "Daily request limit exceeded. Limits reset at midnight UTC.",
          retryAfter: Math.ceil((rpdResult.resetAt - Date.now()) / 1000),
        },
      },
      429,
    );
  }

  // Set standard rate limit headers
  c.header("X-RateLimit-Limit", String(limits.rpm));
  c.header("X-RateLimit-Remaining", String(rpmResult.remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(rpmResult.resetAt / 1000)));

  await next();
});
