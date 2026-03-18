import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { apiKeys } from "../db/schema/saas.js";
import { subscriptions } from "../db/schema/saas.js";
import { authUsers } from "../db/schema/auth.js";
import { logger } from "../lib/logger.js";

const API_KEY_PREFIX = "rl_live_";

/**
 * Hash an API key using SHA-256 for storage/lookup.
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a new API key with the standard prefix.
 */
export function generateApiKey(): string {
  const random = crypto.randomUUID().replace(/-/g, "");
  return `${API_KEY_PREFIX}${random}`;
}

/**
 * Middleware that checks for API key authentication via the
 * `X-API-Key` header or `Authorization: Bearer rl_live_...` header.
 *
 * If a valid API key is found, it populates `user` and `subscriptionTier`
 * on the context. If no API key is present, it falls through to allow
 * session-based auth to handle authentication.
 */
export const apiKeyAuth = createMiddleware(async (c, next) => {
  // Check for API key in headers
  let rawKey = c.req.header("x-api-key");

  if (!rawKey) {
    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer rl_live_")) {
      rawKey = authHeader.slice(7); // Remove "Bearer "
    }
  }

  // No API key present — skip to session auth
  if (!rawKey || !rawKey.startsWith(API_KEY_PREFIX)) {
    await next();
    return;
  }

  const keyHash = await hashApiKey(rawKey);

  // Look up the key
  const [keyRecord] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!keyRecord) {
    return c.json(
      { ok: false, error: { code: "INVALID_API_KEY", message: "Invalid API key" } },
      401,
    );
  }

  // Check revocation
  if (keyRecord.revokedAt) {
    return c.json(
      { ok: false, error: { code: "API_KEY_REVOKED", message: "This API key has been revoked" } },
      401,
    );
  }

  // Check expiration
  if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
    return c.json(
      { ok: false, error: { code: "API_KEY_EXPIRED", message: "This API key has expired" } },
      401,
    );
  }

  // Load the user
  const [user] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, keyRecord.userId))
    .limit(1);

  if (!user) {
    return c.json(
      { ok: false, error: { code: "USER_NOT_FOUND", message: "API key owner not found" } },
      401,
    );
  }

  // Load subscription tier
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, keyRecord.userId))
    .limit(1);

  // Populate context
  c.set("user", user);
  c.set("session", null);
  c.set("subscriptionTier", sub?.tier ?? "free");
  c.set("apiKeyId", keyRecord.id);
  c.set("apiKeyScopes", keyRecord.scopes ?? []);

  // Update last-used timestamp (fire-and-forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, keyRecord.id))
    .catch((err) => logger.error({ err }, "Failed to update API key last-used"));

  logger.info(
    { userId: user.id, keyPrefix: keyRecord.keyPrefix, requestId: c.get("requestId") },
    "API key authenticated",
  );

  await next();
});
