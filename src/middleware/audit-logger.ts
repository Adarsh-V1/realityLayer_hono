import { createMiddleware } from "hono/factory";
import { db } from "../db/connection.js";
import { auditLogs } from "../db/schema/saas.js";
import { logger } from "../lib/logger.js";

/**
 * Maps request path patterns to human-readable action/resource pairs.
 */
function classifyRequest(
  method: string,
  path: string,
): { action: string; resource: string } {
  const m = method.toUpperCase();

  if (path.includes("/auth/")) return { action: `auth.${path.split("/auth/")[1]?.split("?")[0] ?? "unknown"}`, resource: "auth" };
  if (path.includes("/scan")) return { action: "scan.create", resource: "scan" };
  if (path.includes("/voice/transcribe")) return { action: "voice.transcribe", resource: "voice" };
  if (path.includes("/voice")) return { action: "voice.interact", resource: "voice" };
  if (path.includes("/plugins") && m === "POST") return { action: "plugin.execute", resource: "plugin" };
  if (path.includes("/plugins")) return { action: "plugin.read", resource: "plugin" };
  if (path.includes("/memories")) {
    const actionMap: Record<string, string> = {
      GET: "memory.read",
      POST: "memory.create",
      PATCH: "memory.update",
      DELETE: "memory.delete",
    };
    return { action: actionMap[m] ?? "memory.access", resource: "memory" };
  }
  if (path.includes("/api-keys")) {
    const actionMap: Record<string, string> = {
      GET: "apikey.list",
      POST: "apikey.create",
      DELETE: "apikey.revoke",
    };
    return { action: actionMap[m] ?? "apikey.access", resource: "api_key" };
  }
  if (path.includes("/subscription")) return { action: `subscription.${m.toLowerCase()}`, resource: "subscription" };
  if (path.includes("/analytics")) return { action: "analytics.read", resource: "analytics" };

  return { action: `${m.toLowerCase()}.${path.replace(/\//g, ".")}`, resource: "unknown" };
}

/**
 * Audit logging middleware.
 * Logs significant API actions to the audit_logs table.
 * Runs after the response is sent to avoid adding latency.
 *
 * Skips logging for health checks and static asset requests.
 */
export const auditLogger = createMiddleware(async (c, next) => {
  const startTime = Date.now();

  await next();

  const path = c.req.path;

  // Skip noisy endpoints
  if (path === "/health" || path.startsWith("/api/auth/")) return;

  // Only log mutating requests or authenticated reads on sensitive endpoints
  const method = c.req.method;
  if (method === "GET" && !path.includes("/analytics") && !path.includes("/api-keys")) return;
  if (method === "OPTIONS") return;

  const user = c.get("user") as { id: string } | null;
  const requestId = c.get("requestId") as string | undefined;
  const { action, resource } = classifyRequest(method, path);
  const durationMs = Date.now() - startTime;

  // Extract resource ID from path (last segment if UUID-like)
  const segments = path.split("/");
  const lastSegment = segments[segments.length - 1];
  const resourceId = lastSegment && lastSegment.length > 8 && lastSegment !== resource
    ? lastSegment
    : undefined;

  // Fire-and-forget audit log insert
  db.insert(auditLogs)
    .values({
      userId: user?.id ?? null,
      action,
      resource,
      resourceId,
      method,
      path,
      statusCode: c.res.status,
      ipAddress: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip"),
      userAgent: c.req.header("user-agent"),
      requestId,
      durationMs,
    })
    .catch((err) =>
      logger.error({ err, action, resource }, "Audit log insert failed"),
    );
});
