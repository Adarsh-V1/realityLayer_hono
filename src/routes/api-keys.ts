import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success, error } from "../lib/api-response.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/connection.js";
import { apiKeys, subscriptions } from "../db/schema/saas.js";
import { getPlanLimits } from "../lib/plans.js";
import { generateApiKey, hashApiKey } from "../middleware/api-key-auth.js";
import type { SubscriptionTier } from "../db/schema/saas.js";

export const apiKeyRoute = new Hono<AuthedEnv>();

apiKeyRoute.use("/*", requireAuth);

/**
 * GET /api/api-keys
 * List all active (non-revoked) API keys for the authenticated user.
 * The full key is never stored — only the prefix is returned.
 */
apiKeyRoute.get("/api-keys", async (c) => {
  const user = c.get("user");

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)));

  return success(c, { keys });
});

/**
 * POST /api/api-keys
 * Create a new API key. The full key is returned ONCE in the response.
 */
apiKeyRoute.post("/api-keys", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name: string;
    scopes?: string[];
    expiresInDays?: number;
  }>();

  if (!body.name || body.name.length > 100) {
    return error(c, "INVALID_INPUT", "Name is required and must be under 100 characters", 400);
  }

  // Check API key limit based on subscription tier
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1);

  const tier = (sub?.tier ?? "free") as SubscriptionTier;
  const limits = getPlanLimits(tier);

  const existingCount = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)));

  if (existingCount.length >= limits.maxApiKeys) {
    return error(
      c,
      "API_KEY_LIMIT",
      `You can have at most ${limits.maxApiKeys} active API keys on the ${tier} plan`,
      403,
    );
  }

  // Generate key
  const fullKey = generateApiKey();
  const keyHash = await hashApiKey(fullKey);
  const keyPrefix = fullKey.slice(0, 12);

  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 86_400_000)
    : null;

  const validScopes = ["scan", "voice", "plugins", "memories"];
  const scopes = body.scopes
    ? body.scopes.filter((s) => validScopes.includes(s))
    : validScopes;

  const [created] = await db
    .insert(apiKeys)
    .values({
      userId: user.id,
      name: body.name,
      keyPrefix,
      keyHash,
      scopes,
      expiresAt,
    })
    .returning();

  logger.info(
    { userId: user.id, keyPrefix, keyId: created.id },
    "API key created",
  );

  return success(
    c,
    {
      key: {
        id: created.id,
        name: created.name,
        keyPrefix: created.keyPrefix,
        scopes: created.scopes,
        expiresAt: created.expiresAt,
        createdAt: created.createdAt,
      },
      // Full key only returned at creation time
      secretKey: fullKey,
    },
    201,
  );
});

/**
 * DELETE /api/api-keys/:id
 * Revoke an API key. The key is soft-deleted (revokedAt timestamp set).
 */
apiKeyRoute.delete("/api-keys/:id", async (c) => {
  const user = c.get("user");
  const keyId = c.req.param("id");

  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, user.id)))
    .limit(1);

  if (!key) {
    return error(c, "NOT_FOUND", "API key not found", 404);
  }

  if (key.revokedAt) {
    return error(c, "ALREADY_REVOKED", "API key is already revoked", 400);
  }

  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, keyId));

  logger.info({ userId: user.id, keyId, keyPrefix: key.keyPrefix }, "API key revoked");

  return success(c, { revoked: true });
});
