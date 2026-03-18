import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
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
 */
export const requireAuth = createMiddleware<{
  Variables: {
    user: SessionUser;
    session: SessionData;
  };
}>(async (c, next) => {
  const result = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!result?.user) {
    throw new HTTPException(401, { message: "Authentication required" });
  }

  c.set("user", result.user);
  c.set("session", result.session);

  await next();
});
