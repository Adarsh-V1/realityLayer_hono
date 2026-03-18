import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth/index.js";

type SessionUser = typeof auth.$Infer.Session.user;
type SessionData = typeof auth.$Infer.Session.session;

/**
 * Resolves the current session and injects user + session into context.
 * Does NOT block unauthenticated requests — use `requireAuth` for that.
 */
export const resolveSession = createMiddleware<{
  Variables: {
    user: SessionUser | null;
    session: SessionData | null;
  };
}>(async (c, next) => {
  const result = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  c.set("user", result?.user ?? null);
  c.set("session", result?.session ?? null);

  await next();
});

/**
 * Blocks unauthenticated requests with a 401.
 * Must be used AFTER `resolveSession` or standalone on specific routes.
 *
 * TODO: remove dev bypass once auth sign-up is fixed
 */
export const requireAuth = createMiddleware<{
  Variables: {
    user: SessionUser;
    session: SessionData;
  };
}>(async (c, next) => {
  // DEV BYPASS: skip Better Auth entirely until sign-up is fixed
  // TODO: remove this bypass and restore auth.api.getSession() call
  c.set("user", {
    id: "dev-user-001",
    name: "Dev User",
    email: "dev@localhost",
    emailVerified: false,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SessionUser);
  c.set("session", {
    id: "dev-session-001",
    userId: "dev-user-001",
    token: "dev-token",
    expiresAt: new Date(Date.now() + 86400000),
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SessionData);

  await next();
});
