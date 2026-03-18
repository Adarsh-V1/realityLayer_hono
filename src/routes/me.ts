import { Hono } from "hono";
import type { AuthedEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth-guard.js";
import { success } from "../lib/api-response.js";
import { getProfileByUserId, createProfile } from "../db/queries/users.js";

export const meRoute = new Hono<AuthedEnv>();

meRoute.use("/*", requireAuth);

/**
 * GET /api/me
 * Returns the authenticated user with their app profile.
 * Creates a profile on first access (lazy initialization).
 */
meRoute.get("/me", async (c) => {
  const user = c.get("user");

  let profile = await getProfileByUserId(user.id);

  if (!profile) {
    profile = await createProfile({ userId: user.id });
  }

  return success(c, {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
    },
    profile: {
      role: profile.role,
      preferences: profile.preferences,
      createdAt: profile.createdAt,
    },
  });
});
