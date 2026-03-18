import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import type { AppEnv } from "./lib/types.js";
import { env } from "./config/env.js";
import { auth } from "./lib/auth/index.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { apiKeyAuth } from "./middleware/api-key-auth.js";
// import { rateLimiter } from "./middleware/rate-limiter.js";
import { usageTracker } from "./middleware/usage-tracker.js";
import { auditLogger } from "./middleware/audit-logger.js";
import { healthRoute } from "./routes/health.js";
import { meRoute } from "./routes/me.js";
import { scanRoute } from "./routes/scan.js";
import { pluginRoute } from "./routes/plugins.js";
import { memoryRoute } from "./routes/memories.js";
import { voiceRoute } from "./routes/voice.js";
import { subscriptionRoute, stripeWebhookRoute } from "./routes/subscriptions.js";
import { apiKeyRoute } from "./routes/api-keys.js";
import { analyticsRoute } from "./routes/analytics.js";

export function createApp() {
  const app = new Hono<AppEnv>();

  // --- Global middleware ---
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: (origin) => {
        // Allow requests from Expo dev client, LAN, and configured auth URL
        if (!origin) return env.BETTER_AUTH_URL;
        if (
          origin.includes("localhost") ||
          origin.includes("127.0.0.1") ||
          origin.includes("192.168.") ||
          origin.includes("10.0.") ||
          origin === env.BETTER_AUTH_URL
        ) {
          return origin;
        }
        return env.BETTER_AUTH_URL;
      },
      allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  app.use("*", requestId);
  app.use("*", requestLogger);

  // API key authentication (runs before session auth — populates user if key is valid)
  app.use("/api/*", apiKeyAuth);

  // Rate limiting disabled for development
  // app.use("/api/*", rateLimiter);

  // Usage tracking & audit logging (runs after response)
  app.use("/api/*", usageTracker);
  app.use("/api/*", auditLogger);

  // --- Global error handler ---
  app.onError(errorHandler);

  // --- Not found handler ---
  app.notFound((c) =>
    c.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Route not found" } },
      404,
    ),
  );

  // --- Stripe webhook (raw body needed, before auth) ---
  app.route("/", stripeWebhookRoute);

  // --- Better Auth handler ---
  app.on(["POST", "GET"], "/api/auth/*", (c) => {
    return auth.handler(c.req.raw);
  });

  // --- Routes ---
  app.route("/", healthRoute);
  app.route("/api", meRoute);

  app.route("/api", scanRoute);

  app.route("/api", pluginRoute);

  app.route("/api", memoryRoute);

  app.route("/api", voiceRoute);

  // --- SaaS routes ---
  app.route("/api", subscriptionRoute);
  app.route("/api", apiKeyRoute);
  app.route("/api", analyticsRoute);

  return app;
}
